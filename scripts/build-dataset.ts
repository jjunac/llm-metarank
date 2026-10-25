import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  CATEGORIES,
  type Category,
  type CategoryScore,
  type DatasetSource,
  type LeaderboardDataset,
  type ModelRank,
  type NormalizedSourceEntry,
  type RawEntry,
  type SourceConfig,
  type SourceSnapshot,
} from "./types.js";
import { DATA_DIR, SNAPSHOT_DIR, nowISO, readJson, writeJson } from "./util.js";
import { loadModelRegistry, matchModel, type ModelRegistry } from "./normalize/models.js";
import { buildCostAnalysis, isUsableTaskCost } from "./costs.js";

const MIN_OVERALL_SOURCES = 5;
const MIN_CATEGORY_SOURCES = 2;
const MIN_SOURCE_MODELS = 3;

interface SourceWork {
  config: SourceConfig;
  snapshot: SourceSnapshot;
  bestByModel: Map<string, RawEntry>;
  overallPercentiles: Map<string, number>;
  metricPercentiles: Record<string, Map<string, number>>;
  rankInSource: Map<string, number>;
  warnings: string[];
}

function percentileMap(scores: Map<string, number>): Map<string, number> {
  const values = [...scores.values()].sort((a, b) => a - b);
  const total = values.length;
  const result = new Map<string, number>();
  if (total === 0) return result;

  for (const [modelId, score] of scores) {
    const less = values.filter((value) => value < score).length;
    const equal = values.filter((value) => value === score).length;
    result.set(modelId, ((less + 0.5 * equal) / total) * 100);
  }
  return result;
}

function weightedAverage(items: Array<{ value: number; weight: number }>): number | null {
  if (items.length === 0) return null;
  const weightSum = items.reduce((sum, item) => sum + item.weight, 0);
  if (weightSum === 0) return null;
  return items.reduce((sum, item) => sum + item.value * item.weight, 0) / weightSum;
}

function buildSourceWork(
  registry: ModelRegistry,
  config: SourceConfig,
  snapshot: SourceSnapshot,
): SourceWork {
  const warnings = [...snapshot.warnings];
  const bestByModel = new Map<string, RawEntry>();

  for (const entry of snapshot.entries) {
    const modelId = matchModel(registry, entry.rawName);
    if (!modelId) continue;
    const existing = bestByModel.get(modelId);
    if (!existing || entry.score > existing.score) {
      bestByModel.set(modelId, entry);
    }
  }

  if (bestByModel.size < MIN_SOURCE_MODELS) {
    warnings.push(`Only ${bestByModel.size} tracked models mapped from this source.`);
  }

  const sorted = [...bestByModel.entries()].sort((a, b) => b[1].score - a[1].score);
  const rankInSource = new Map<string, number>();
  sorted.forEach(([modelId], index) => rankInSource.set(modelId, index + 1));

  const overallPercentiles = percentileMap(
    new Map(sorted.map(([modelId, entry]) => [modelId, entry.score])),
  );

  const metricPercentiles: Record<string, Map<string, number>> = { overall: overallPercentiles };
  const metrics = new Set(Object.values(config.categories).filter((metric): metric is string => Boolean(metric)));
  for (const metric of metrics) {
    if (metric === "overall") continue;
    const values = new Map<string, number>();
    for (const [modelId, entry] of bestByModel) {
      const value = entry.metrics?.[metric];
      if (typeof value === "number" && Number.isFinite(value)) values.set(modelId, value);
    }
    metricPercentiles[metric] = percentileMap(values);
  }

  return {
    config,
    snapshot,
    bestByModel,
    overallPercentiles,
    metricPercentiles,
    rankInSource,
    warnings,
  };
}

function categoryScoreFor(
  modelSources: NormalizedSourceEntry[],
  category: Category,
  sourceById: Map<string, SourceWork>,
): CategoryScore {
  const contributions: Array<{ value: number; weight: number; sourceId: string }> = [];

  for (const sourceEntry of modelSources) {
    const source = sourceById.get(sourceEntry.sourceId);
    if (!source) continue;
    const metric = source.config.categories[category];
    if (!metric) continue;
    const value = sourceEntry.metricPercentiles[metric];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    contributions.push({
      value,
      weight: source.config.weight,
      sourceId: sourceEntry.sourceId,
    });
  }

  if (contributions.length < MIN_CATEGORY_SOURCES) {
    return { score: null, rank: null, sources: contributions.length, sourceIds: contributions.map((item) => item.sourceId) };
  }

  return {
    score: weightedAverage(contributions),
    rank: null,
    sources: contributions.length,
    sourceIds: contributions.map((item) => item.sourceId),
  };
}

function normalizeEntry(work: SourceWork, modelId: string, entry: RawEntry): NormalizedSourceEntry {
  const percentile = (score: number, values: number[]) => values.length
    ? 100 * (values.filter((value) => value < score).length + 0.5 * values.filter((value) => value === score).length) / values.length
    : 0;
  const selected = work.bestByModel.get(modelId) === entry;
  const scores = [...work.bestByModel.values()].map((item) => item.score);
  const metricPercentiles: Record<string, number> = {};
  for (const [metric, values] of Object.entries(work.metricPercentiles)) {
    if (selected) {
      const value = values.get(modelId);
      if (typeof value === "number") metricPercentiles[metric] = value;
    } else {
      const value = metric === "overall" ? entry.score : entry.metrics?.[metric];
      const pool = [...work.bestByModel.values()].flatMap((item) => {
        const score = metric === "overall" ? item.score : item.metrics?.[metric];
        return typeof score === "number" && Number.isFinite(score) ? [score] : [];
      });
      if (typeof value === "number" && Number.isFinite(value)) metricPercentiles[metric] = percentile(value, pool);
    }
  }
  return {
    sourceId: work.config.id, rawName: entry.rawName, modelId, score: entry.score,
    metrics: entry.metrics ?? {},
    percentile: selected ? work.overallPercentiles.get(modelId)! : percentile(entry.score, scores),
    metricPercentiles, variant: entry.variant, harness: entry.harness, date: entry.date,
    url: entry.url ?? work.config.url, sourceSize: work.bestByModel.size,
    rankInSource: selected ? work.rankInSource.get(modelId)! : 1 + scores.filter((score) => score > entry.score).length,
    runId: entry.runId, cost: entry.cost, metricCosts: entry.metricCosts,
    costUnavailableReason: entry.costUnavailableReason, runCostUsd: entry.runCostUsd,
  };
}

export async function buildDataset(): Promise<LeaderboardDataset> {
  const registry = await loadModelRegistry();
  const sources = await readJson<SourceConfig[]>(resolve(DATA_DIR, "sources.json"));
  const works: SourceWork[] = [];

  for (const config of sources) {
    let snapshot: SourceSnapshot;
    try {
      snapshot = await readJson<SourceSnapshot>(resolve(SNAPSHOT_DIR, config.id, "latest.json"));
    } catch {
      throw new Error(`Missing snapshot for ${config.id}. Run npm run data:refresh first.`);
    }
    works.push(buildSourceWork(registry, config, snapshot));
  }

  const sourceById = new Map(works.map((work) => [work.config.id, work]));
  const byModel = new Map<string, NormalizedSourceEntry[]>();
  const costedRunsByModel = new Map<string, NormalizedSourceEntry[]>();

  for (const work of works) {
    for (const [modelId, entry] of work.bestByModel) {
      const overallPercentile = work.overallPercentiles.get(modelId);
      if (typeof overallPercentile !== "number") continue;
      const normalized = normalizeEntry(work, modelId, entry);

      const list = byModel.get(modelId) ?? [];
      list.push(normalized);
      byModel.set(modelId, list);
    }
    for (const entry of work.snapshot.entries) {
      if (!entry.cost && !Object.keys(entry.metricCosts ?? {}).length && entry.runCostUsd === undefined) continue;
      const modelId = matchModel(registry, entry.rawName);
      if (!modelId) continue;
      const list = costedRunsByModel.get(modelId) ?? [];
      list.push(normalizeEntry(work, modelId, entry));
      costedRunsByModel.set(modelId, list);
    }
  }

  const modelById = new Map(registry.models.map((model) => [model.id, model]));
  const modelRanks: ModelRank[] = [];

  for (const [modelId, modelSources] of byModel) {
    const model = modelById.get(modelId);
    if (!model) continue;

    const coverage = {
      used: modelSources.length,
      total: sources.length,
      general: 0,
      coding: 0,
      agentic: 0,
      reasoning: 0,
    };

    for (const category of CATEGORIES) {
      coverage[category] = modelSources.filter((sourceEntry) => {
        const source = sourceById.get(sourceEntry.sourceId);
        return Boolean(source?.config.categories[category]);
      }).length;
    }

    const categories = {} as Record<Category, CategoryScore>;
    for (const category of CATEGORIES) {
      categories[category] = categoryScoreFor(modelSources, category, sourceById);
    }

    const overallItems = modelSources
      .map((sourceEntry) => {
        const source = sourceById.get(sourceEntry.sourceId);
        return source ? { value: sourceEntry.percentile, weight: source.config.weight } : null;
      })
      .filter((item): item is { value: number; weight: number } => item !== null);

    const overall = weightedAverage(overallItems);
    const isRanked =
      coverage.used >= MIN_OVERALL_SOURCES && coverage.general >= 1 && coverage.coding >= 1;

    modelRanks.push({
      id: model.id,
      name: model.name,
      vendor: model.vendor,
      releaseDate: model.releaseDate,
      openWeights: model.openWeights,
      overall,
      rank: null,
      coverage,
      categories,
      sources: modelSources.sort((a, b) => b.percentile - a.percentile),
      costedRuns: costedRunsByModel.get(modelId) ?? [],
      missingSourceIds: sources.filter((source) => !modelSources.some((entry) => entry.sourceId === source.id)).map((source) => source.id),
      status: isRanked ? "ranked" : "limited",
    });
  }

  const ranked = modelRanks
    .filter((model) => model.status === "ranked" && model.overall !== null)
    .sort((a, b) => {
      if ((b.overall ?? 0) !== (a.overall ?? 0)) return (b.overall ?? 0) - (a.overall ?? 0);
      if (b.coverage.used !== a.coverage.used) return b.coverage.used - a.coverage.used;
      return a.name.localeCompare(b.name);
    });
  ranked.forEach((model, index) => {
    model.rank = index + 1;
  });

  for (const category of CATEGORIES) {
    const categoryRanked = modelRanks
      .filter((model) => model.categories[category].score !== null)
      .sort((a, b) => {
        const aScore = a.categories[category].score ?? 0;
        const bScore = b.categories[category].score ?? 0;
        if (bScore !== aScore) return bScore - aScore;
        if (b.categories[category].sources !== a.categories[category].sources) {
          return b.categories[category].sources - a.categories[category].sources;
        }
        return a.name.localeCompare(b.name);
      });
    categoryRanked.forEach((model, index) => {
      model.categories[category].rank = index + 1;
    });
  }

  modelRanks.sort((a, b) => {
    if (a.status !== b.status) return a.status === "ranked" ? -1 : 1;
    if (a.status === "ranked") return (a.rank ?? 0) - (b.rank ?? 0);
    if ((b.overall ?? -1) !== (a.overall ?? -1)) return (b.overall ?? -1) - (a.overall ?? -1);
    return a.name.localeCompare(b.name);
  });

  const datasetSources: DatasetSource[] = works.map((work) => {
    const dataDate = work.snapshot.sourceUpdatedAt ?? work.snapshot.fetchedAt.slice(0, 10);
    const mappedCount = work.bestByModel.size;
    const stale = work.warnings.some((warning) => warning.includes("Refresh failed"));
    const reportedEntries = work.snapshot.entries.filter((entry) => entry.cost).length;
    const mappedModels = [...work.bestByModel.values()].filter((entry) => entry.cost).length;
    const usableModels = stale ? 0 : [...work.bestByModel.values()].filter((entry) => isUsableTaskCost(entry.cost)).length;
    const costStatus = work.snapshot.costStatus;
    const costState = costStatus?.status ?? (reportedEntries ? "available" : work.config.costMethodology?.statistic ? "unavailable" : "not-reported");
    return {
      ...work.config,
      dataDate,
      fetchedAt: work.snapshot.fetchedAt,
      entryCount: work.snapshot.entries.length,
      mappedCount,
      warnings: work.warnings,
      status: stale ? "stale" : "current",
      costCoverage: {
        status: stale && reportedEntries > 0 ? "stale" : costState === "available" && reportedEntries < work.snapshot.entries.length ? "partial" : costState,
        reportedEntries, mappedModels, usableModels,
        runTotalEntries: work.snapshot.entries.filter((entry) => entry.runCostUsd !== undefined).length,
        statistics: [...new Set(work.snapshot.entries.flatMap((entry) => entry.cost ? [entry.cost.statistic] : []))],
        note: costStatus?.note ?? work.config.costMethodology?.note ?? "Task cost has not been collected in this snapshot.",
        url: costStatus?.url ?? work.config.costMethodology?.url,
      },
    };
  });

  const categorySources = Object.fromEntries(
    CATEGORIES.map((category) => [
      category,
      works.filter((work) => Boolean(work.config.categories[category])).map((work) => work.config.id),
    ]),
  ) as Record<Category, string[]>;

  const dataset: LeaderboardDataset = {
    generatedAt: nowISO(),
    methodologyVersion: "1.3",
    sourceCount: sources.length,
    trackedModelCount: modelRanks.length,
    rankedModelCount: ranked.length,
    sources: datasetSources,
    models: modelRanks,
    categorySources,
    costAnalysis: buildCostAnalysis(modelRanks, datasetSources),
  };

  await writeJson(resolve(DATA_DIR, "leaderboard.json"), dataset);
  console.log(
    `\nBuilt dataset: ${dataset.trackedModelCount} tracked models, ${dataset.rankedModelCount} ranked, ${dataset.sourceCount} sources.`,
  );
  return dataset;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildDataset().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
