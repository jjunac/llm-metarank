import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import type { LeaderboardDataset, SourceSnapshot } from "./types.js";
import { DATA_DIR, readJson } from "./util.js";
import { buildCostAnalysis, canonicalBasketId, isUsableTaskCost } from "./costs.js";
import { loadModelRegistry, matchModel } from "./normalize/models.js";

const dataset = await readJson<LeaderboardDataset>(resolve(DATA_DIR, "leaderboard.json"));

describe("generated leaderboard dataset", () => {
  it("contains ten unique sources", () => {
    expect(dataset.sources).toHaveLength(10);
    expect(new Set(dataset.sources.map((source) => source.id)).size).toBe(10);
  });

  it("ranks models with enough overall coverage", () => {
    const ranked = dataset.models.filter((model) => model.status === "ranked");
    expect(ranked.length).toBeGreaterThan(0);
    for (const model of ranked) {
      expect(model.rank, model.name).not.toBeNull();
      expect(model.overall, model.name).not.toBeNull();
      expect(model.coverage.used, model.name).toBeGreaterThanOrEqual(5);
      expect(model.coverage.general, model.name).toBeGreaterThanOrEqual(1);
      expect(model.coverage.coding, model.name).toBeGreaterThanOrEqual(1);
    }
  });

  it("has unique, ordered overall ranks", () => {
    const ranked = dataset.models
      .filter((model) => model.status === "ranked")
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
    expect(new Set(ranked.map((model) => model.rank)).size).toBe(ranked.length);
    ranked.forEach((model, index) => expect(model.rank).toBe(index + 1));

    for (let index = 1; index < ranked.length; index += 1) {
      expect(ranked[index - 1].overall ?? 0).toBeGreaterThanOrEqual(ranked[index].overall ?? 0);
    }
  });

  it("only assigns category scores with at least two sources", () => {
    for (const model of dataset.models) {
      for (const [category, score] of Object.entries(model.categories)) {
        if (score.score === null) {
          expect(score.sources, `${model.name}/${category}`).toBeLessThan(2);
        } else {
          expect(score.sources, `${model.name}/${category}`).toBeGreaterThanOrEqual(2);
          expect(score.score).toBeGreaterThanOrEqual(0);
          expect(score.score).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it("keeps source entries unique and in range", () => {
    for (const model of dataset.models) {
      const sourceIds = model.sources.map((source) => source.sourceId);
      expect(new Set(sourceIds).size, model.name).toBe(sourceIds.length);
      for (const source of model.sources) {
        expect(source.percentile).toBeGreaterThanOrEqual(0);
        expect(source.percentile).toBeLessThanOrEqual(100);
        expect(source.sourceSize).toBeGreaterThan(0);
      }
    }
  });

  it("includes every registered model found in the refreshed source snapshots", async () => {
    const registry = await loadModelRegistry();
    for (const source of dataset.sources) {
      const snapshot = await readJson<SourceSnapshot>(resolve(DATA_DIR, "snapshots", source.id, "latest.json"));
      for (const entry of snapshot.entries) {
        const id = matchModel(registry, entry.rawName);
        if (!id) continue;
        const model = dataset.models.find((model) => model.id === id);
        expect(model?.sources.some((entry) => entry.sourceId === source.id), `${source.id}: ${entry.rawName}`).toBe(true);
      }
    }
  });

  it("reproduces its matched-basket task-cost analysis without changing capability scores", () => {
    expect(buildCostAnalysis(dataset.models, dataset.sources)).toEqual(dataset.costAnalysis);
    for (const [scope, views] of Object.entries(dataset.costAnalysis.frontiers)) {
      const baskets = dataset.costAnalysis.baskets[scope as keyof typeof dataset.costAnalysis.baskets];
      expect(Object.keys(views).sort()).toEqual(baskets.map((basket) => basket.id).sort());
      for (const [basketId, view] of Object.entries(views)) {
        expect(basketId).toBe(canonicalBasketId(view.sourceIds));
        for (const point of view.points) {
          expect(point.contributions.map((entry) => entry.sourceId)).toEqual(view.sourceIds);
          expect(point.costIndex).toBeGreaterThan(0);
          expect(point.score).toBeGreaterThanOrEqual(0);
          expect(point.score).toBeLessThanOrEqual(100);
          expect(point.frontier).toBe(point.dominatedBy.length === 0);
          const model = dataset.models.find((model) => model.id === point.modelId)!;
          for (const contribution of point.contributions) {
            const entry = model.sources.find((entry) => entry.sourceId === contribution.sourceId)!;
            const cost = contribution.metric === "overall" ? entry.cost : entry.metricCosts?.[contribution.metric];
            expect(isUsableTaskCost(cost, true)).toBe(true);
            expect(cost?.usd).toBe(contribution.costUsd);
            expect(entry.runId).toBe(contribution.runId);
          }
        }
      }
    }
    for (const [scope, sourceIds] of Object.entries(dataset.costAnalysis.applicableSourceIds)) {
      const key = scope as keyof typeof dataset.costAnalysis.defaultBasketId;
      if (sourceIds.length >= 2 || dataset.costAnalysis.singleSourceIds[key].length) {
        expect(dataset.costAnalysis.defaultBasketId[key]).toBeTruthy();
      }
    }

    for (const [scope, sourceIds] of Object.entries(dataset.costAnalysis.singleSourceIds)) {
      const views = dataset.costAnalysis.singleSourceFrontiers[scope as keyof typeof dataset.costAnalysis.singleSourceFrontiers];
      expect(Object.keys(views).sort()).toEqual([...sourceIds].sort());
      for (const sourceId of sourceIds) {
        const view = views[sourceId];
        expect(view.sourceIds).toEqual([sourceId]);
        expect(view.points.length).toBeGreaterThanOrEqual(2);
        for (const point of view.points) {
          expect(point.contributions.map((entry) => entry.sourceId)).toEqual([sourceId]);
          expect(point.costIndex).toBeGreaterThan(0);
          expect(point.score).toBeGreaterThanOrEqual(0);
          expect(point.score).toBeLessThanOrEqual(100);
          expect(point.frontier).toBe(point.dominatedBy.length === 0);
          const model = dataset.models.find((model) => model.id === point.modelId)!;
          const entry = model.sources.find((entry) => entry.sourceId === sourceId)!;
          const cost = point.contributions[0].metric === "overall"
            ? entry.cost
            : entry.metricCosts?.[point.contributions[0].metric];
          expect(isUsableTaskCost(cost)).toBe(true);
          expect(cost?.usd).toBe(point.contributions[0].costUsd);
        }
      }
    }
  });
});
