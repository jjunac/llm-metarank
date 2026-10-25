import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import datasetJson from "../../data/leaderboard.json";
import type { LeaderboardDataset } from "../../scripts/types";
import Leaderboard from "./Leaderboard";

const data = datasetJson as unknown as LeaderboardDataset;

describe("leaderboard coverage setting", () => {
  it("renders the overall coverage control regardless of the active category", () => {
    const html = renderToStaticMarkup(<Leaderboard data={data} />);

    expect(html).toContain("Overall coverage");
    expect(html).toContain("5+ sources");
    expect(html).toContain("All models");
    expect(html).not.toContain("Show emerging");
    expect(html).not.toContain("Remove 5-source minimum");
  });
});
