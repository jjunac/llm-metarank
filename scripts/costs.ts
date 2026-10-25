import {
  CATEGORIES,
  type CostAnalysis,
  type CostBaseline,
  type CostBasket,
  type CostScope,
  type DatasetSource,
  type MetaCostFrontier,
  type MetaCostPoint,
  type ModelRank,
  type NormalizedSourceEntry,
  type TaskCost,
} from "./types.js";

/** Keep arbitrary user-composed baskets from exploding as cost sources are added. */
export const MAX_BASKET_SOURCES = 4;

export function isUsableTaskCost(cost: TaskCost | undefined, meanOnly = false): cost is TaskCost {
  return Boolean(
    cost && cost.currency === "USD" && ["task", "environment"].includes(cost.unit) &&
    ["mean", "weighted-mean", "median"].includes(cost.statistic) && Number.isFinite(cost.usd) && cost.usd > 0 &&
    cost.complete && !cost.upperBound && (!meanOnly || cost.statistic !== "median"),
  );
}

export function costForMetric(entry: NormalizedSourceEntry, metric: string): TaskCost | undefined {
  return metric === "overall" ? entry.cost : entry.metricCosts?.[metric];
}

export function currentCostSource(source: DatasetSource): boolean {
  return source.status === "current" && ["available", "partial"].includes(source.costCoverage.status);
}

/** Order-independent basket id; source ids are sorted so selection order never matters. */
export function canonicalBasketId(sourceIds: string[]): string {
  return [...sourceIds].sort().join("+");
}

function combinations<T>(items: T[], size: number, start = 0, prefix: T[] = []): T[][] {
  if (prefix.length === size) return [[...prefix]];
  return items.slice(start).flatMap((item, index) =>
    combinations(items, size, start + index + 1, [...prefix, item]),
  );
}

/**
 * Every matched basket the picker can compose: all subsets of 2..4 sources, plus the
 * full set when there are more than four applicable sources.
 */
export function basketCombinations<T>(items: T[]): T[][] {
  if (items.length < 2) return [];
  const maxSize = Math.min(items.length, MAX_BASKET_SOURCES);
  const result: T[][] = [];
  for (let size = 2; size <= maxSize; size += 1) result.push(...combinations(items, size));
  if (items.length > MAX_BASKET_SOURCES) result.push([...items]);
  return result;
}

export function median(values: number[]): number {
  if (!values.length) throw new Error("Cannot calculate a cost reference without observations.");
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Strict dominance, without rounding: identical points both remain on the frontier. */
export function dominates(a: { cost: number; score: number }, b: { cost: number; score: number }): boolean {
  return a.cost <= b.cost && a.score >= b.score && (a.cost < b.cost || a.score > b.score);
}

export function createMetaFrontier(
  models: ModelRank[],
  sources: DatasetSource[],
  baselines: CostBaseline[],
  scope: CostScope,
  selectedSourceIds: string[],
): MetaCostFrontier {
  const basket = sources.filter((source) => selectedSourceIds.includes(source.id) && (scope === "overall" || source.categories[scope]));
  const result: MetaCostFrontier = { scope, sourceIds: basket.map((source) => source.id), points: [], excluded: [] };
  // A single benchmark is a self-contained comparison. Its reported statistic is used as-is;
  // multi-source baskets renormalize across sources and therefore require mean costs.
  const allowMedian = basket.length === 1;

  for (const model of models) {
    const contributions: MetaCostPoint["contributions"] = [];
    const missingSourceIds: string[] = [];
    for (const source of basket) {
      const metric = scope === "overall" ? "overall" : source.categories[scope]!;
      const entry = model.sources.find((item) => item.sourceId === source.id);
      const cost = entry && costForMetric(entry, metric);
      const reference = cost && baselines.find((item) =>
        item.sourceId === source.id && item.metric === metric && item.statistic === cost.statistic);
      const percentile = entry?.metricPercentiles[metric];
      if (!currentCostSource(source) || !isUsableTaskCost(cost, !allowMedian) || !reference || reference.usd <= 0 ||
        typeof percentile !== "number" || !Number.isFinite(percentile) || source.weight <= 0) {
        missingSourceIds.push(source.id);
        continue;
      }
      contributions.push({
        sourceId: source.id, metric, runId: entry?.runId, percentile,
        costUsd: cost.usd, statistic: cost.statistic, referenceUsd: reference.usd, weight: source.weight,
      });
    }
    if (basket.length === 0 || missingSourceIds.length > 0 || contributions.length !== basket.length) {
      result.excluded.push({ modelId: model.id, missingSourceIds });
      continue;
    }
    const weight = contributions.reduce((sum, item) => sum + item.weight, 0);
    result.points.push({
      modelId: model.id,
      score: contributions.reduce((sum, item) => sum + item.percentile * item.weight, 0) / weight,
      costIndex: Math.exp(contributions.reduce((sum, item) => sum + Math.log(item.costUsd / item.referenceUsd) * item.weight, 0) / weight),
      frontier: false,
      dominatedBy: [],
      contributions,
    });
  }
  for (const point of result.points) {
    point.dominatedBy = result.points.filter((other) => dominates(
      { cost: other.costIndex, score: other.score }, { cost: point.costIndex, score: point.score },
    )).map((other) => other.modelId);
    point.frontier = point.dominatedBy.length === 0;
  }
  result.points.sort((a, b) => a.costIndex - b.costIndex || b.score - a.score || a.modelId.localeCompare(b.modelId));
  return result;
}

export function buildCostAnalysis(models: ModelRank[], sources: DatasetSource[]): CostAnalysis {
  const baselines: CostBaseline[] = [];
  for (const source of sources) {
    if (!currentCostSource(source)) continue;
    const metrics = new Set(["overall", ...Object.values(source.categories)]);
    for (const metric of metrics) {
      if (!metric) continue;
      for (const statistic of source.costCoverage.statistics) {
        const values = models.flatMap((model) => {
          const entry = model.sources.find((item) => item.sourceId === source.id);
          const cost = entry && costForMetric(entry, metric);
          return entry && cost?.statistic === statistic && Number.isFinite(entry.metricPercentiles[metric]) &&
            isUsableTaskCost(cost) ? [cost.usd] : [];
        });
        if (values.length) {
          baselines.push({ sourceId: source.id, metric, statistic, usd: median(values), models: values.length });
        }
      }
    }
  }

  const scopes = ["overall", ...CATEGORIES] as CostScope[];
  const applicableSourceIds = {} as Record<CostScope, string[]>;
  const singleSourceIds = {} as Record<CostScope, string[]>;
  const baskets = {} as Record<CostScope, CostBasket[]>;
  const defaultBasketId: CostAnalysis["defaultBasketId"] = {};
  const frontiers = {} as CostAnalysis["frontiers"];
  const singleSourceFrontiers = {} as CostAnalysis["singleSourceFrontiers"];

  for (const scope of scopes) {
    const applicable = sources.filter((source) =>
      currentCostSource(source) && source.costCoverage.usableModels > 0 &&
      source.costCoverage.statistics.some((statistic) => statistic !== "median") &&
      (scope === "overall" || Boolean(source.categories[scope])),
    );
    applicableSourceIds[scope] = applicable.map((source) => source.id);

    const singleCandidates = sources.filter((source) =>
      currentCostSource(source) && source.costCoverage.usableModels > 0 &&
      (scope === "overall" || Boolean(source.categories[scope])),
    );
    const scopeSingleIds: string[] = [];
    const scopeSingleFrontiers: Record<string, MetaCostFrontier> = {};
    for (const source of singleCandidates) {
      const frontier = createMetaFrontier(models, sources, baselines, scope, [source.id]);
      if (frontier.points.length < 2) continue;
      scopeSingleIds.push(source.id);
      scopeSingleFrontiers[source.id] = frontier;
    }

    const scopeBaskets: CostBasket[] = [];
    const scopeFrontiers: Record<string, MetaCostFrontier> = {};
    for (const candidate of basketCombinations(applicable)) {
      const frontier = createMetaFrontier(models, sources, baselines, scope, candidate.map((source) => source.id));
      if (frontier.points.length < 2) continue;
      const id = canonicalBasketId(frontier.sourceIds);
      if (scopeFrontiers[id]) continue;
      scopeBaskets.push({ id, sourceIds: [...frontier.sourceIds] });
      scopeFrontiers[id] = frontier;
    }
    scopeBaskets.sort((a, b) =>
      scopeFrontiers[b.id].points.length - scopeFrontiers[a.id].points.length ||
      b.sourceIds.length - a.sourceIds.length ||
      a.id.localeCompare(b.id),
    );

    singleSourceIds[scope] = scopeSingleIds;
    singleSourceFrontiers[scope] = scopeSingleFrontiers;
    baskets[scope] = scopeBaskets;
    frontiers[scope] = scopeFrontiers;
    if (scopeBaskets[0]) defaultBasketId[scope] = scopeBaskets[0].id;
    else if (scopeSingleIds[0]) defaultBasketId[scope] = scopeSingleIds[0];
  }

  return {
    baselines, applicableSourceIds, singleSourceIds, baskets, defaultBasketId,
    frontiers, singleSourceFrontiers,
  };
}

export interface BenchmarkModelPoint {
  id: string;
  modelId: string;
  sourceId: string;
  entry: NormalizedSourceEntry;
  cost: TaskCost;
  scorePercentile: number;
  /** Within-benchmark cost rank: 0 is cheapest, 100 is most expensive. */
  costPercentile: number;
  /** Cost relative to the source's fixed reference median, when available. */
  costMultiple?: number;
  frontier: boolean;
}

/**
 * Model-level points for the benchmark ensemble: one best-score configuration per model,
 * with within-benchmark cost and score percentiles. Alternate harness/effort runs remain
 * in the source data for audit but are not plotted.
 */
export function benchmarkModelPoints(
  models: ModelRank[],
  source: DatasetSource,
  referenceUsd?: number,
): BenchmarkModelPoint[] {
  if (!currentCostSource(source)) return [];
  const points = models.flatMap((model) => {
    const entry = model.sources.find((item) => item.sourceId === source.id);
    const cost = entry?.cost;
    if (!entry || !isUsableTaskCost(cost)) return [];
    if (source.costMethodology?.statistic && cost.statistic !== source.costMethodology.statistic) return [];
    const scorePercentile = entry.metricPercentiles.overall;
    if (typeof scorePercentile !== "number" || !Number.isFinite(scorePercentile)) return [];
    return [{
      id: `${model.id}:${source.id}`,
      modelId: model.id,
      sourceId: source.id,
      entry,
      cost,
      scorePercentile,
      costPercentile: 0,
      costMultiple: referenceUsd && referenceUsd > 0 ? cost.usd / referenceUsd : undefined,
      frontier: false,
    }];
  });

  const sorted = [...points].sort((a, b) => a.cost.usd - b.cost.usd || a.modelId.localeCompare(b.modelId));
  let index = 0;
  while (index < sorted.length) {
    let end = index;
    while (end + 1 < sorted.length && sorted[end + 1].cost.usd === sorted[index].cost.usd) end += 1;
    const percentile = sorted.length === 1 ? 50 : ((index + end) / 2) / (sorted.length - 1) * 100;
    for (let item = index; item <= end; item += 1) sorted[item].costPercentile = percentile;
    index = end + 1;
  }

  for (const point of points) {
    point.frontier = !points.some((other) => other !== point && dominates(
      { cost: other.cost.usd, score: other.scorePercentile },
      { cost: point.cost.usd, score: point.scorePercentile },
    ));
  }
  return points.sort((a, b) => a.costPercentile - b.costPercentile || b.scorePercentile - a.scorePercentile || a.modelId.localeCompare(b.modelId));
}
