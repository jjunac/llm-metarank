import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import datasetJson from "../../data/leaderboard.json";
import type { LeaderboardDataset } from "../../scripts/types";
import EnsembleFrontier from "./EnsembleFrontier";

const data = datasetJson as unknown as LeaderboardDataset;

describe("benchmark frontier ensemble", () => {
  it("renders normalized frontiers, the shared core and the membership table", () => {
    const html = renderToStaticMarkup(<EnsembleFrontier data={data} onSelectModel={() => {}} />);
    expect(html).toContain("3 benchmarks");
    expect(html).toContain("13 frontier members");
    expect(html).toContain("3 shared");
    expect(html).toContain("Score percentile within benchmark");
    expect(html).toContain("Cost percentile within benchmark");
    expect(html).toContain("not a cross-benchmark dominance claim");
    expect(html).toContain("GPT-6 Luna");
    expect(html).toContain("Claude Opus 5.5");
    expect(html).toContain("Also on the frontier");
    expect(html).toContain("3/3");
    expect(html).toContain("Gemma 4 31B");
    expect(html).toContain("1/1");
    expect(html).not.toMatch(/\b(?:NaN|Infinity)\b/);
  });

  it("renders one point per benchmark frontier member", () => {
    const html = renderToStaticMarkup(<EnsembleFrontier data={data} onSelectModel={() => {}} />);
    expect(html.match(/role="button"/g)?.length ?? 0).toBe(20);
  });
});
