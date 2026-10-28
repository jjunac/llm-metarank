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

  it("defaults to all models and places that option first", () => {
    const html = renderToStaticMarkup(<Leaderboard data={data} />);

    expect(html).toMatch(/aria-pressed="true"[^>]*>All models<\/button>/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>5\+ sources<\/button>/);

    const allModelsIndex = html.indexOf(">All models</button>");
    const coverageFloorIndex = html.indexOf(">5+ sources</button>");
    expect(allModelsIndex).toBeGreaterThan(-1);
    expect(coverageFloorIndex).toBeGreaterThan(allModelsIndex);

    const limitedModel = data.models.find(
      (model) => model.status !== "ranked" && model.overall !== null,
    );
    expect(limitedModel).toBeDefined();
    expect(html).toContain(limitedModel!.name);
  });
});
