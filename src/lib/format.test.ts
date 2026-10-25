import { describe, expect, it } from "vitest";
import datasetJson from "../../data/leaderboard.json";
import type { LeaderboardDataset } from "../../scripts/types";
import { rankAllModels } from "./format";

const data = datasetJson as unknown as LeaderboardDataset;

describe("all-model ranking", () => {
  it("ranks every model with a meta score in descending score order", () => {
    const ranks = rankAllModels(data.models);
    const scored = data.models.filter((model) => model.overall !== null);

    expect(ranks.size).toBe(scored.length);
    expect(Math.min(...ranks.values())).toBe(1);
    expect(Math.max(...ranks.values())).toBe(scored.length);

    const ordered = [...scored].sort((a, b) => ranks.get(a.id)! - ranks.get(b.id)!);
    for (let index = 1; index < ordered.length; index += 1) {
      expect(ordered[index - 1].overall!).toBeGreaterThanOrEqual(ordered[index].overall!);
    }
  });

  it("includes models below the official coverage floor", () => {
    const ranks = rankAllModels(data.models);
    const limited = data.models.find((model) => model.status === "limited");

    expect(limited).toBeDefined();
    expect(ranks.get(limited!.id)).toBeGreaterThan(0);
  });
});
