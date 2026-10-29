import { describe, expect, it } from "vitest";
import { leaderboard, toClientDataset } from "./data";

const client = toClientDataset(leaderboard);

describe("client dataset", () => {
  it("drops build-only cost data from every model", () => {
    expect(client.models).toHaveLength(leaderboard.models.length);

    for (const model of client.models) {
      expect(model.costedRuns).toEqual([]);
      for (const entry of model.sources) {
        expect(entry.metricCosts).toBeUndefined();
        expect(entry.date).toBeUndefined();
        expect(entry.runId).toBeUndefined();
        expect(entry.metrics).toEqual({});
        expect(Object.keys(entry.metricPercentiles)).toEqual(["overall"]);
      }
    }
  });

  it("drops the unused dominance lists from the cost frontiers", () => {
    for (const frontiers of [
      client.costAnalysis.frontiers,
      client.costAnalysis.singleSourceFrontiers,
    ]) {
      for (const baskets of Object.values(frontiers)) {
        for (const frontier of Object.values(baskets)) {
          for (const point of frontier.points) expect(point.dominatedBy).toEqual([]);
        }
      }
    }
  });

  it("keeps every value the hydrated components read", () => {
    for (const [index, model] of client.models.entries()) {
      const source = leaderboard.models[index];

      expect(model.overall).toBe(source.overall);
      expect(model.rank).toBe(source.rank);
      expect(model.status).toBe(source.status);
      expect(model.categories).toEqual(source.categories);
      expect(model.coverage).toEqual(source.coverage);
      expect(model.sources.map((entry) => entry.sourceId)).toEqual(
        source.sources.map((entry) => entry.sourceId),
      );
      expect(model.sources.map((entry) => entry.cost)).toEqual(
        source.sources.map((entry) => entry.cost),
      );
      expect(model.sources.map((entry) => entry.percentile)).toEqual(
        source.sources.map((entry) => entry.percentile),
      );
    }
  });

  it("is materially smaller than the full dataset", () => {
    expect(JSON.stringify(client).length).toBeLessThan(JSON.stringify(leaderboard).length * 0.6);
  });
});
