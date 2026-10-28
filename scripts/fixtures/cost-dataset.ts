import { resolve } from "node:path";
import { buildCostAnalysis } from "../costs.js";
import { CATEGORIES, type DatasetSource, type LeaderboardDataset, type ModelRank, type NormalizedSourceEntry, type SourceConfig, type TaskCost } from "../types.js";
import { DATA_DIR, readJson } from "../util.js";

// Synthetic, fixed observations for UI tests. Live snapshots can legitimately lose
// cost coverage (outages, new benchmark versions) without breaking rendering.
const fetchedAt = "2026-10-25T00:00:00Z";
const configs = await readJson<SourceConfig[]>(resolve(DATA_DIR, "sources.json"));
const configById = new Map(configs.map((config) => [config.id, config]));

function entry(modelId: string, sourceId: string, usd: number | undefined, percentile: number): NormalizedSourceEntry {
  const config = configById.get(sourceId)!;
  const statistic = config.costMethodology?.statistic ?? "mean";
  const cost: TaskCost | undefined = usd === undefined ? undefined : {
    usd, statistic, currency: "USD", unit: "task", method: "reported", scope: "Synthetic test run",
    sourceUrl: config.url, fetchedAt, complete: true,
    ...(statistic === "weighted-mean" ? { breakdown: [{ label: "Synthetic evaluation", usdPerTask: usd, weight: 1, tasks: 1 }] } : {}),
    ...(sourceId === "terminal-bench-4" ? { method: "total-over-attempts", totalUsd: usd * 330, attempts: 330 } : {}),
  };
  const metrics = Object.fromEntries(["overall", ...Object.values(config.categories)].map((metric) => [metric!, percentile]));
  return {
    modelId, sourceId, rawName: modelId, score: percentile, percentile, metrics, metricPercentiles: metrics,
    url: config.url, sourceSize: 4, rankInSource: 1, runId: `${modelId}:${sourceId}`,
    cost, metricCosts: cost ? Object.fromEntries(Object.keys(metrics).map((metric) => [metric, cost])) : undefined,
    runCostUsd: sourceId === "arc-agi-3" ? 100 : undefined,
  };
}

function model(id: string, name: string, percentile: number, observations: Array<[string, number | undefined]>): ModelRank {
  const entries = observations.map(([sourceId, usd]) => entry(id, sourceId, usd, percentile));
  const categories = Object.fromEntries(CATEGORIES.map((category) => {
    const sourceIds = entries.filter((entry) => configById.get(entry.sourceId)?.categories[category]).map((entry) => entry.sourceId);
    return [category, { score: sourceIds.length >= 2 ? percentile : null, rank: sourceIds.length >= 2 ? 1 : null, sources: sourceIds.length, sourceIds }];
  })) as ModelRank["categories"];
  return {
    id, name, vendor: "Test vendor", overall: percentile, rank: entries.length >= 5 ? 1 : null,
    coverage: { used: entries.length, total: configs.length, ...Object.fromEntries(CATEGORIES.map((category) => [category, categories[category].sources])) } as ModelRank["coverage"],
    categories, sources: entries, costedRuns: entries.filter((entry) => entry.cost || entry.runCostUsd !== undefined),
    missingSourceIds: configs.filter((config) => !entries.some((entry) => entry.sourceId === config.id)).map((config) => config.id),
    status: entries.length >= 5 ? "ranked" : "limited",
  };
}

export function createCostDataset(): LeaderboardDataset {
  const models = [
    model("claude-opus-5-5", "Claude Opus 5.5", 95, [["artificial-analysis", 4], ["livebench", 8], ["terminal-bench-4", 4718.65 / 330], ["lmarena-text", 0.1], ["code-arena-webdev", 0.2], ["arc-agi-3", undefined]]),
    model("glm-5-3-flash", "GLM-5.3 Flash", 60, [["artificial-analysis", 1], ["livebench", 0.2], ["terminal-bench-4", 0.4], ["lmarena-text", 0.01], ["code-arena-webdev", 0.02]]),
    model("deepseek-v4-1-flash", "DeepSeek V4.1 Flash", 80, [["artificial-analysis", 0.5], ["livebench", 0.1], ["lmarena-text", 0.02], ["code-arena-webdev", 0.03]]),
    model("gpt-6-1-terra", "GPT-6.1 Terra", 70, [["hle", undefined]]),
    model("gemma-4-31b", "Gemma 4 31B", 20, [["livebench", 0.01]]),
  ];
  const sources: DatasetSource[] = configs.map((config) => {
    const entries = models.flatMap((model) => model.sources.filter((entry) => entry.sourceId === config.id));
    const costed = entries.filter((entry) => entry.cost);
    return {
      ...config, dataDate: fetchedAt.slice(0, 10), sourceUpdatedAt: fetchedAt.slice(0, 10), fetchedAt,
      entryCount: entries.length, mappedCount: entries.length, warnings: [], status: "current",
      costCoverage: {
        status: costed.length ? "available" : "not-reported", reportedEntries: costed.length, mappedModels: costed.length, usableModels: costed.length,
        runTotalEntries: entries.filter((entry) => entry.runCostUsd !== undefined).length,
        statistics: [...new Set(costed.map((entry) => entry.cost!.statistic))], note: "Synthetic fixture",
      },
    };
  });
  return {
    generatedAt: fetchedAt, methodologyVersion: "test", sourceCount: sources.length,
    trackedModelCount: models.length, rankedModelCount: models.filter((model) => model.status === "ranked").length,
    sources, models, categorySources: Object.fromEntries(CATEGORIES.map((category) => [category, sources.filter((source) => source.categories[category]).map((source) => source.id)])) as LeaderboardDataset["categorySources"],
    costAnalysis: buildCostAnalysis(models, sources),
  };
}
