import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createCostDataset } from "../../scripts/fixtures/cost-dataset";
import { buildCostAnalysis } from "../../scripts/costs";
import CostFrontier from "./CostFrontier";
import ModelDetail from "./ModelDetail";
import { defaultSourceIds, resolveCostView, selectableSourceIds } from "../lib/cost-view";
import { formatCostIndex, formatPercentile, formatUsd } from "../lib/format";

const data = createCostDataset();

describe("task-cost UI rendering", () => {
  it("pre-renders the default matched basket, its accessible points and comparison table", () => {
    const html = renderToStaticMarkup(<CostFrontier data={data} onSelectModel={() => {}} />);
    expect(html).toContain("The meta Pareto frontier.");
    expect(html).toContain("Matched-basket percentile");
    expect(html).toContain("not $1/task");
    expect(html).toContain("One selection, one axis.");
    expect(html).toContain("Select cost benchmarks");
    expect(html).toContain("Compare measured models");
    const defaultId = data.costAnalysis.defaultBasketId.overall!;
    const overall = data.costAnalysis.frontiers.overall[defaultId];
    expect(html).toContain(`${overall.points.length} in this basket`);
    expect(html).toContain(`${overall.excluded.length} outside`);
    expect(html).toContain("sources have no usable task cost");
    expect(html).toContain(`${overall.points.length} models · ${overall.points.filter((point) => point.frontier).length} non-dominated`);
    expect(html.match(/role="button"/g)?.length ?? 0).toBe(overall.points.length);
    expect(html).not.toMatch(/\b(?:NaN|Infinity)\b/);
  });

  it("resolves single-benchmark views, including P50 sources, without pooling medians", () => {
    const lmArena = resolveCostView(data, "overall", ["lmarena-text"]);
    expect(lmArena.kind).toBe("single");
    if (lmArena.kind === "single") {
      expect(lmArena.medianOnly).toBe(true);
      expect(lmArena.frontier.points.length).toBeGreaterThan(1);
      expect(lmArena.frontier.points.every((point) => point.contributions[0].statistic === "median")).toBe(true);
    }
    expect(resolveCostView(data, "overall", ["lmarena-text", "livebench"]).kind).toBe("invalid");
    expect(selectableSourceIds(data, "overall")).toContain("lmarena-text");
    expect(selectableSourceIds(data, "overall")).toContain("code-arena-webdev");
  });

  it("falls back to available baskets and single benchmarks when an index changes cost methodology", () => {
    const refreshed = createCostDataset();
    const aa = refreshed.sources.find((source) => source.id === "artificial-analysis")!;
    aa.costCoverage.status = "unavailable";
    aa.costCoverage.usableModels = 0;
    for (const model of refreshed.models) {
      for (const entry of model.sources.filter((entry) => entry.sourceId === aa.id)) {
        delete entry.cost;
        delete entry.metricCosts;
      }
    }
    refreshed.costAnalysis = buildCostAnalysis(refreshed.models, refreshed.sources);
    expect(defaultSourceIds(refreshed, "overall")).toEqual(["livebench", "terminal-bench-4"]);
    expect(defaultSourceIds(refreshed, "reasoning")).toEqual(["livebench"]);
    expect(resolveCostView(refreshed, "reasoning", defaultSourceIds(refreshed, "reasoning")).kind).toBe("single");
    const html = renderToStaticMarkup(<CostFrontier data={refreshed} onSelectModel={() => {}} />);
    expect(html).toContain("LiveBench + Terminal-Bench");
    expect(html).not.toMatch(/\b(?:NaN|Infinity)\b/);
  });

  it("names the missing cost sources for a model outside the default basket", () => {
    const defaultId = data.costAnalysis.defaultBasketId.overall!;
    const excluded = data.costAnalysis.frontiers.overall[defaultId].excluded.find((point) => point.missingSourceIds.length > 0)!;
    const model = data.models.find((candidate) => candidate.id === excluded.modelId)!;
    const missing = data.sources.find((source) => source.id === excluded.missingSourceIds[0])!;
    const html = renderToStaticMarkup(<ModelDetail model={model} data={data} onClose={() => {}} />);

    expect(html).toContain("Not in Artificial Analysis + LiveBench");
    expect(html).toContain(missing.shortName);
    expect(html).toContain("missing costs are not treated as free");
  });

  it("shows per-basket status for a pair-only model and a multi-basket model", () => {
    const deepSeek = data.models.find((model) => model.id === "deepseek-v4-1-flash")!;
    const deepSeekHtml = renderToStaticMarkup(<ModelDetail model={deepSeek} data={data} onClose={() => {}} />);
    expect(deepSeekHtml).toContain("Artificial Analysis + LiveBench frontier");
    expect(deepSeekHtml).toContain("Missing Terminal-Bench");

    const glm = data.models.find((model) => model.id === "glm-5-3-flash")!;
    const glmHtml = renderToStaticMarkup(<ModelDetail model={glm} data={data} onClose={() => {}} />);
    expect(glmHtml).toContain("Frontier on 3 baskets");
    expect(glmHtml).toContain("Dominated");
  });

  it("shows exact-run spend/attempts and the distinction between task and run totals", () => {
    const model = data.models.find((model) => model.id === "claude-opus-5-5")!;
    const html = renderToStaticMarkup(<ModelDetail model={model} data={data} onClose={() => {}} />);
    expect(html).toContain("Measured task cost");
    expect(html).toContain("$4,718.65");
    expect(html).toContain("330 attempts");
    expect(html).toContain("Weighted mean task cost");
    const arcModel = data.models.find((model) => model.sources.some((entry) => entry.runCostUsd !== undefined))!;
    expect(renderToStaticMarkup(<ModelDetail model={arcModel} data={data} onClose={() => {}} />)).toContain("total run cost—not $/task");
  });

  it("does not round small positive costs to free or label the index dollars", () => {
    expect(formatUsd(0.0027)).toBe("$0.0027");
    expect(formatUsd(1e-9)).not.toBe("$0.00");
    expect(formatUsd(undefined)).toBe("—");
    expect(formatCostIndex(1)).toBe("1.00×");
    expect(formatCostIndex(1)).not.toContain("$");
  });

  it("formats ordinal percentiles", () => {
    expect(formatPercentile(1)).toBe("1st");
    expect(formatPercentile(2)).toBe("2nd");
    expect(formatPercentile(3)).toBe("3rd");
    expect(formatPercentile(11)).toBe("11th");
    expect(formatPercentile(93)).toBe("93rd");
    expect(formatPercentile(undefined)).toBe("—");
  });
});
