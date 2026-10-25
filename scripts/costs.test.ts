import { describe, expect, it } from "vitest";
import { basketCombinations, benchmarkModelPoints, buildCostAnalysis, canonicalBasketId, createMetaFrontier, dominates, isUsableTaskCost, median } from "./costs.js";
import { CATEGORIES, type DatasetSource, type ModelRank, type NormalizedSourceEntry, type TaskCost } from "./types.js";

const taskCost = (usd: number, overrides: Partial<TaskCost> = {}): TaskCost => ({
  usd, currency: "USD", unit: "task", statistic: "mean", method: "reported", scope: "test",
  sourceUrl: "https://example.com", fetchedAt: "2026-10-25T00:00:00Z", complete: true, ...overrides,
});

function source(id: string): DatasetSource {
  return {
    id, name: id, shortName: id, url: "https://example.com", access: "json", metricLabel: "Score", scoreType: "percent",
    description: "test", categories: { coding: "coding" }, weight: 1, accent: "#000",
    dataDate: "2026-10-25", fetchedAt: "2026-10-25T00:00:00Z", entryCount: 3, mappedCount: 3, warnings: [], status: "current",
    costCoverage: { status: "available", reportedEntries: 3, mappedModels: 3, usableModels: 3, runTotalEntries: 0, statistics: ["mean"], note: "test" },
  };
}

function entry(sourceId: string, usd: number, percentile: number): NormalizedSourceEntry {
  return {
    sourceId, modelId: "example", rawName: "Example (high)", score: percentile,
    metrics: { coding: percentile }, percentile, metricPercentiles: { overall: percentile, coding: percentile },
    url: "https://example.com", sourceSize: 3, rankInSource: 1, runId: `${sourceId}:high`,
    variant: "high", cost: taskCost(usd), metricCosts: { coding: taskCost(usd * 2) },
  };
}

function model(id: string, sources: NormalizedSourceEntry[]): ModelRank {
  return {
    id, name: id, vendor: "test", overall: 50, rank: 1,
    coverage: { used: sources.length, total: 10, general: 1, coding: 1, agentic: 0, reasoning: 0 },
    categories: Object.fromEntries(CATEGORIES.map((category) => [category, { score: 50, rank: 1, sources: 2, sourceIds: ["a", "b"] }])) as ModelRank["categories"],
    sources, costedRuns: [...sources], missingSourceIds: [], status: "ranked",
  };
}

describe("cost eligibility", () => {
  it("rejects unknown, zero, bounded, incomplete or non-task costs", () => {
    expect(isUsableTaskCost(undefined)).toBe(false);
    for (const usd of [0, -1, Infinity, NaN]) expect(isUsableTaskCost(taskCost(usd))).toBe(false);
    expect(isUsableTaskCost(taskCost(1, { upperBound: true }))).toBe(false);
    expect(isUsableTaskCost(taskCost(1, { complete: false }))).toBe(false);
    expect(isUsableTaskCost(taskCost(1, { unit: "million tokens" as TaskCost["unit"] }))).toBe(false);
    expect(isUsableTaskCost(taskCost(1, { statistic: "median" }), true)).toBe(false);
    expect(isUsableTaskCost(taskCost(1, { statistic: "median" }))).toBe(true);
    expect(isUsableTaskCost(taskCost(1, { statistic: "weighted-mean" }), true)).toBe(true);
  });

  it("computes reference medians without changing the input", () => {
    const values = [9, 1, 3, 5];
    expect(median(values)).toBe(4);
    expect(values).toEqual([9, 1, 3, 5]);
    expect(() => median([])).toThrow();
  });
});

describe("strict Pareto dominance", () => {
  it("handles equal costs, equal scores and identical points", () => {
    expect(dominates({ cost: 1, score: 90 }, { cost: 2, score: 80 })).toBe(true);
    expect(dominates({ cost: 1, score: 90 }, { cost: 1, score: 80 })).toBe(true);
    expect(dominates({ cost: 1, score: 90 }, { cost: 2, score: 90 })).toBe(true);
    expect(dominates({ cost: 1, score: 90 }, { cost: 1, score: 90 })).toBe(false);
    expect(dominates({ cost: 1, score: 80 }, { cost: 2, score: 90 })).toBe(false);
  });
});

describe("matched-basket meta frontier", () => {
  const sources = [source("a"), source("b")];
  const baselines = [
    { sourceId: "a", metric: "overall", statistic: "mean" as const, usd: 10, models: 3 },
    { sourceId: "b", metric: "overall", statistic: "mean" as const, usd: 100, models: 3 },
  ];

  it("uses a weighted geometric cost ratio and a matched-source capability average", () => {
    const m = model("paired", [entry("a", 5, 80), entry("b", 200, 60)]);
    m.overall = 99;
    const result = createMetaFrontier([m], sources, baselines, "overall", ["a", "b"]);
    expect(result.points[0].costIndex).toBeCloseTo(1);
    expect(result.points[0].score).toBe(70);
    expect(m.overall).toBe(99);
  });

  it("requires the same entire basket and never imputes missing costs", () => {
    const missing = model("missing", [entry("a", 1, 90)]);
    const medianCost = model("median", [entry("a", 1, 90), { ...entry("b", 1, 90), cost: taskCost(1, { statistic: "median" }) }]);
    const result = createMetaFrontier([missing, medianCost], sources, baselines, "overall", ["a", "b"]);
    expect(result.points).toHaveLength(0);
    expect(result.excluded.every((item) => item.missingSourceIds.includes("b"))).toBe(true);
    const single = createMetaFrontier([model("one", [entry("a", 1, 90)])], sources, baselines, "overall", ["a"]);
    expect(single.points).toHaveLength(1);
    expect(single.points[0].costIndex).toBeCloseTo(0.1);
    expect(single.points[0].score).toBe(90);
  });

  it("uses category-specific costs, not the model's overall task mix", () => {
    const m = model("category", [entry("a", 5, 80), entry("b", 200, 60)]);
    const result = createMetaFrontier([m], sources, baselines.map((b) => ({ ...b, metric: "coding" })), "coding", ["a", "b"]);
    expect(result.points[0].costIndex).toBeCloseTo(2);
  });

  it("excludes stale and incomplete observations and preserves expensive best-score pairing", () => {
    const m = model("paired", [entry("a", 10, 80), entry("b", 100, 70)]);
    m.costedRuns.push({ ...entry("a", 0.01, 10), variant: "low", runId: "a:low" });
    // The lower-effort alternative must not supply the cost for the high-effort score.
    const result = createMetaFrontier([m], sources, baselines, "overall", ["a", "b"]);
    expect(result.points[0].costIndex).toBeCloseTo(1);
    const stale = sources.map((s) => s.id === "b" ? { ...s, status: "stale" as const } : s);
    expect(createMetaFrontier([m], stale, baselines, "overall", ["a", "b"]).points).toHaveLength(0);
    m.sources[1].cost = taskCost(100, { complete: false });
    expect(createMetaFrontier([m], sources, baselines, "overall", ["a", "b"]).points).toHaveLength(0);
  });

  it("keeps references fixed when models are hidden by UI filters", () => {
    const models = [model("cheap", [entry("a", 1, 50), entry("b", 10, 50)]), model("costly", [entry("a", 9, 90), entry("b", 90, 90)])];
    const analysis = buildCostAnalysis(models, sources);
    const all = createMetaFrontier(models, sources, analysis.baselines, "overall", ["a", "b"]);
    const filtered = createMetaFrontier(models.slice(0, 1), sources, analysis.baselines, "overall", ["a", "b"]);
    expect(filtered.points[0].costIndex).toBe(all.points[0].costIndex);
  });

  it("finds the non-dominated models and keeps identical points", () => {
    const models = [model("cheap", [entry("a", 1, 50), entry("b", 10, 50)]), model("best", [entry("a", 2, 90), entry("b", 20, 90)]), model("worse", [entry("a", 3, 80), entry("b", 30, 80)]), model("tie", [entry("a", 2, 90), entry("b", 20, 90)])];
    const result = createMetaFrontier(models, sources, baselines, "overall", ["a", "b"]);
    expect(result.points.filter((p) => p.frontier).map((p) => p.modelId)).toEqual(["cheap", "best", "tie"]);
    expect(result.points.find((p) => p.modelId === "worse")?.dominatedBy).toEqual(["best", "tie"]);
  });
});

describe("matched basket selection", () => {
  const sources = [source("a"), source("b"), source("c")];
  const baselines = [
    { sourceId: "a", metric: "overall", statistic: "mean" as const, usd: 10, models: 3 },
    { sourceId: "b", metric: "overall", statistic: "mean" as const, usd: 100, models: 3 },
    { sourceId: "c", metric: "overall", statistic: "mean" as const, usd: 1, models: 3 },
  ];

  it("builds canonical ids and every subset up to four sources plus the full set", () => {
    expect(canonicalBasketId(["b", "a"])).toBe("a+b");
    expect(basketCombinations(["a", "b", "c"]).map((set) => canonicalBasketId(set)))
      .toEqual(["a+b", "a+c", "b+c", "a+b+c"]);
    expect(basketCombinations(["a", "b", "c", "d", "e"])).toHaveLength(26);
  });

  it("stores independent frontiers and defaults to the largest eligible basket", () => {
    const pairs = Array.from({ length: 5 }, (_, index) =>
      model(`pair-${index}`, [entry("a", index + 1, 50 + index), entry("b", index + 2, 60 + index)]));
    const triples = [
      model("triple-1", [entry("a", 1, 80), entry("b", 2, 70), entry("c", 3, 60)]),
      model("triple-2", [entry("a", 2, 60), entry("b", 1, 80), entry("c", 1, 50)]),
    ];
    const analysis = buildCostAnalysis([...pairs, ...triples], sources);

    expect(analysis.applicableSourceIds.overall).toEqual(["a", "b", "c"]);
    expect(analysis.baskets.overall.map((basket) => basket.id))
      .toEqual(["a+b", "a+b+c", "a+c", "b+c"]);
    expect(analysis.defaultBasketId.overall).toBe("a+b");
    expect(analysis.frontiers.overall["a+b"].points).toHaveLength(7);
    expect(analysis.frontiers.overall["a+b+c"].excluded.find((item) => item.modelId === "pair-0")?.missingSourceIds)
      .toEqual(["c"]);
    for (const basket of analysis.baskets.overall) {
      expect(analysis.frontiers.overall[canonicalBasketId([...basket.sourceIds].reverse())]).toBe(analysis.frontiers.overall[basket.id]);
    }
  });

  it("computes dominance independently for each basket", () => {
    const x = model("x", [entry("a", 1, 50), entry("b", 1, 50), entry("c", 0.1, 90)]);
    const y = model("y", [entry("a", 0.5, 60), entry("b", 0.5, 60), entry("c", 10, 20)]);

    const pair = createMetaFrontier([x, y], sources, baselines, "overall", ["a", "b"]);
    expect(pair.points.find((point) => point.modelId === "x")?.frontier).toBe(false);
    expect(pair.points.find((point) => point.modelId === "y")?.frontier).toBe(true);

    const triple = createMetaFrontier([x, y], sources, baselines, "overall", ["a", "b", "c"]);
    expect(triple.points.find((point) => point.modelId === "x")?.frontier).toBe(true);
    expect(triple.points.find((point) => point.modelId === "y")?.frontier).toBe(false);
  });

  it("keeps category baskets to the applicable sources", () => {
    const scoped = [
      { ...source("a"), categories: {} },
      { ...source("b"), categories: { coding: "coding" } },
      { ...source("c"), categories: { coding: "coding" } },
    ];
    const models = [
      model("m1", [entry("b", 1, 80), entry("c", 2, 70)]),
      model("m2", [entry("b", 2, 60), entry("c", 1, 50)]),
    ];
    const analysis = buildCostAnalysis(models, scoped);
    expect(analysis.applicableSourceIds.coding).toEqual(["b", "c"]);
    expect(analysis.baskets.coding.map((basket) => basket.id)).toEqual(["b+c"]);
    expect(analysis.defaultBasketId.coding).toBe("b+c");
  });

  it("does not offer median-only sources as basket sources", () => {
    const medianOnly = {
      ...source("c"),
      costCoverage: { ...source("c").costCoverage, statistics: ["median" as const] },
    };
    const models = [
      model("m1", [entry("a", 1, 80), entry("b", 2, 70)]),
      model("m2", [entry("a", 2, 60), entry("b", 1, 50)]),
    ];
    const analysis = buildCostAnalysis(models, [source("a"), source("b"), medianOnly]);
    expect(analysis.applicableSourceIds.overall).toEqual(["a", "b"]);
    expect(analysis.baskets.overall.map((basket) => basket.id)).toEqual(["a+b"]);
  });
});

describe("benchmark model ensemble points", () => {
  it("keeps one best-score point per model and normalizes cost within the benchmark", () => {
    const cheap = model("cheap", [entry("a", 1, 90)]);
    const costly = model("costly", [entry("a", 10, 80)]);
    const points = benchmarkModelPoints([cheap, costly], source("a"), 10);

    expect(points).toHaveLength(2);
    expect(points.map((point) => point.modelId)).toEqual(["cheap", "costly"]);
    expect(points[0].scorePercentile).toBe(90);
    expect(points[0].costPercentile).toBe(0);
    expect(points[0].costMultiple).toBeCloseTo(0.1);
    expect(points[0].frontier).toBe(true);
    expect(points[1].costPercentile).toBe(100);
    expect(points[1].frontier).toBe(false);
  });

  it("ignores alternate harness/effort configurations", () => {
    const configured = model("configured", [entry("a", 10, 90)]);
    configured.costedRuns.push({ ...entry("a", 1, 70), variant: "low", runId: "a:low" });

    const points = benchmarkModelPoints([configured], source("a"));
    expect(points).toHaveLength(1);
    expect(points[0].cost.usd).toBe(10);
    expect(points[0].scorePercentile).toBe(90);
  });

  it("requires the source's cost statistic and an overall percentile", () => {
    const meanSource = {
      ...source("a"),
      costMethodology: { statistic: "mean" as const, url: "https://example.com", note: "test" },
    };
    const medianCost = model("median", [entry("a", 1, 90)]);
    medianCost.sources[0].cost = taskCost(1, { statistic: "median" });
    expect(benchmarkModelPoints([medianCost], meanSource)).toHaveLength(0);

    const noPercentile = model("no-percentile", [entry("a", 1, 90)]);
    noPercentile.sources[0].metricPercentiles = {};
    expect(benchmarkModelPoints([noPercentile], source("a"))).toHaveLength(0);
  });

  it("uses a midrank for tied costs and keeps identical points on the frontier", () => {
    const points = benchmarkModelPoints([
      model("a", [entry("a", 1, 90)]),
      model("b", [entry("a", 1, 90)]),
      model("c", [entry("a", 2, 80)]),
    ], source("a"));
    const byId = new Map(points.map((point) => [point.modelId, point]));

    expect(byId.get("a")!.costPercentile).toBe(25);
    expect(byId.get("b")!.costPercentile).toBe(25);
    expect(byId.get("c")!.costPercentile).toBe(100);
    expect(byId.get("a")!.frontier).toBe(true);
    expect(byId.get("b")!.frontier).toBe(true);
    expect(byId.get("c")!.frontier).toBe(false);
  });

  it("excludes stale sources", () => {
    const stale = { ...source("a"), status: "stale" as const };
    expect(benchmarkModelPoints([model("m", [entry("a", 1, 90)])], stale)).toHaveLength(0);
  });
});

describe("single-benchmark cost views", () => {
  const sources = [source("a"), source("b")];
  const meanBaselines = [
    { sourceId: "a", metric: "overall", statistic: "mean" as const, usd: 10, models: 3 },
    { sourceId: "b", metric: "overall", statistic: "mean" as const, usd: 100, models: 3 },
  ];

  it("allows a median source alone but never inside a multi-source basket", () => {
    const medianModel = model("median", [entry("a", 10, 90), entry("b", 20, 80)]);
    medianModel.sources[0].cost = taskCost(10, { statistic: "median" });
    const baselines = [
      ...meanBaselines,
      { sourceId: "a", metric: "overall", statistic: "median" as const, usd: 10, models: 3 },
    ];

    const single = createMetaFrontier([medianModel], sources, baselines, "overall", ["a"]);
    expect(single.points).toHaveLength(1);
    expect(single.points[0].contributions[0].statistic).toBe("median");
    expect(single.points[0].costIndex).toBeCloseTo(1);

    const multi = createMetaFrontier([medianModel], sources, baselines, "overall", ["a", "b"]);
    expect(multi.points).toHaveLength(0);
    expect(multi.excluded[0].missingSourceIds).toEqual(["a"]);
  });

  it("builds independent single-source frontiers and keeps the largest multi-source default", () => {
    const models = [
      model("m1", [entry("a", 1, 80), entry("b", 10, 70)]),
      model("m2", [entry("a", 2, 60), entry("b", 20, 90)]),
    ];
    models[0].sources[1].cost = taskCost(10, { statistic: "median" });
    models[1].sources[1].cost = taskCost(20, { statistic: "median" });
    const scopedSources = [
      { ...source("a"), costCoverage: { ...source("a").costCoverage, statistics: ["mean" as const] } },
      { ...source("b"), costCoverage: { ...source("b").costCoverage, statistics: ["median" as const] } },
    ];
    const analysis = buildCostAnalysis(models, scopedSources);

    expect(analysis.applicableSourceIds.overall).toEqual(["a"]);
    expect(analysis.singleSourceIds.overall).toEqual(["a", "b"]);
    expect(Object.keys(analysis.singleSourceFrontiers.overall).sort()).toEqual(["a", "b"]);
    expect(analysis.defaultBasketId.overall).toBe("a");
    expect(analysis.singleSourceFrontiers.overall.b.points[0].contributions[0].statistic).toBe("median");
  });
});
