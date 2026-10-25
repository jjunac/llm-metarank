import { describe, expect, it } from "vitest";
import { AA_COST_EVALUATIONS, AA_COST_VERSION, aaTaskCost, extractJsonProperty, extractNextPayload, type AAModel } from "./artificial-analysis.js";
import { costFromTotals, parseUsdTaskAmount } from "./cost.js";
import { liveBenchTaskCost, indexLiveBenchCosts } from "./livebench.js";
import { terminalTaskCost } from "./terminal-bench.js";
import { parseArenaTable } from "./arena.js";

const options = { sourceUrl: "https://example.com/run", fetchedAt: "2026-10-25T00:00:00Z", scope: "test" };

describe("task cost units and denominators", () => {
  it("parses USD amounts and upper bounds without accepting token prices", () => {
    expect(parseUsdTaskAmount("$1,234.50")).toEqual({ usd: 1234.5, upperBound: false });
    expect(parseUsdTaskAmount("$0.0027/task")?.usd).toBe(0.0027);
    expect(parseUsdTaskAmount("<$0.01")).toEqual({ usd: 0.01, upperBound: true });
    expect(parseUsdTaskAmount("$4.7k")?.usd).toBe(4700);
    for (const text of ["", "N/A", "—", "$4 / $20", "$2/M", "€0.01", "-$2", "$NaN"]) {
      expect(parseUsdTaskAmount(text), text).toBeNull();
    }
    expect(parseUsdTaskAmount("$0")?.usd).toBe(0);
  });

  it("requires a measured total and positive integer attempt count", () => {
    expect(costFromTotals(4718.65, 330, options)?.usd).toBeCloseTo(14.2989393939);
    for (const attempts of [0, -1, 2.5, NaN, Infinity, undefined]) expect(costFromTotals(10, attempts, options)).toBeUndefined();
    for (const total of [-1, NaN, Infinity, undefined, null, "20"]) expect(costFromTotals(total, 10, options)).toBeUndefined();
    expect(costFromTotals(0, 10, options)?.usd).toBe(0);
  });

  it("uses all Terminal-Bench trials, not unique tasks or successes", () => {
    const cost = terminalTaskCost({ total_cost_usd: 4718.65, n_trials: 330 }, 330, options);
    expect(cost?.attempts).toBe(330);
    expect(cost?.usd).not.toBeCloseTo(4718.65 / 66);
    expect(terminalTaskCost({ total_cost_usd: 100, n_trials: 330 }, 66, options)).toBeUndefined();
    expect(terminalTaskCost({ total_cost_usd: 100 }, undefined, options)).toBeUndefined();
  });
});

describe("LiveBench cost.csv", () => {
  it("divides total spend by total task count, not an average of suite means", () => {
    const row = { coding: "100", nq_coding: "10", reasoning: "10", nq_reasoning: "100" };
    const cost = liveBenchTaskCost(row, ["coding", "reasoning"], options);
    expect(cost?.usd).toBe(1);
    expect(cost?.attempts).toBe(110);
    expect(liveBenchTaskCost(row, ["coding"], options)?.usd).toBe(10);
  });

  it("does not treat blanks or partial cost coverage as free tasks", () => {
    expect(liveBenchTaskCost({ coding: "", nq_coding: "29" }, ["coding"], options)).toBeUndefined();
    expect(liveBenchTaskCost({ coding: "10", nq_coding: "29" }, ["coding", "reasoning"], options)).toBeUndefined();
    expect(liveBenchTaskCost({ coding: "0", nq_coding: "29" }, ["coding"], options)?.usd).toBe(0);
  });

  it("matches exact model identifiers and rejects ambiguous duplicate cost rows", () => {
    const rows = [{ model: "model-high", coding: "10" }, { model: "model-low", coding: "1" }, { model: "model-high", coding: "20" }];
    const indexed = indexLiveBenchCosts(rows);
    expect(indexed.has("model")).toBe(false);
    expect(indexed.has("model-high")).toBe(false);
    expect(indexed.get("model-low")?.coding).toBe("1");
  });
});

function aaModel(): AAModel {
  return {
    name: "Example (max)", price1mInputTokens: 1, price1mOutputTokens: 2,
    canonicalEvalTokenCounts: Object.fromEntries(AA_COST_EVALUATIONS.map((evaluation) => [evaluation.key, {
      input: 1e6 * evaluation.tasks, answer: 1e6 * evaluation.tasks, reasoning: 0, cacheableInput: null,
    }])),
  };
}

describe("Artificial Analysis's published task-cost calculation", () => {
  it("uses the versioned evaluation weights/counts, not a blended token price", () => {
    expect(AA_COST_EVALUATIONS.reduce((sum, item) => sum + item.weight, 0)).toBeCloseTo(1);
    const result = aaTaskCost(aaModel(), { ...options, version: AA_COST_VERSION });
    expect(result.cost?.usd).toBeCloseTo(3);
    expect(result.cost?.statistic).toBe("weighted-mean");
    expect(result.cost?.breakdown).toHaveLength(10);
  });

  it("includes cache reads/writes, reasoning and per-evaluation fallback rates", () => {
    const model = aaModel();
    model.cacheHitRate = 0.5;
    model.cacheHitPrice = 0.1;
    model.cacheWritePrice = 1.25;
    for (const counts of Object.values(model.canonicalEvalTokenCounts!)) {
      counts.cacheableInput = counts.input;
      counts.reasoning = counts.answer;
    }
    const noFallback = aaTaskCost(model, { ...options, version: AA_COST_VERSION }).cost!;
    expect(noFallback.usd).toBeCloseTo(0.5 * 0.1 + 0.5 * 1.25 + 2 + 2);
    const fallback = {
      fallbackPrice: { input: 10, output: 20, cacheHit: 1, cacheWrite: 12.5 },
      rateByEval: Object.fromEntries(AA_COST_EVALUATIONS.map((item) => [item.slug, { input: 0.5, output: 0.5, reasoning: 0.5 }])),
    };
    const cost = aaTaskCost(model, { ...options, version: AA_COST_VERSION, fallback }).cost!;
    expect(cost.usd).toBeCloseTo(noFallback.usd * 5.5);
  });

  it("does not guess missing cache/usage data or apply old weights to a new index", () => {
    const model = aaModel();
    expect(aaTaskCost(model, { ...options, version: "5.0" }).cost).toBeUndefined();
    model.canonicalEvalTokenCounts!.briefcase.cacheableInput = 100;
    expect(aaTaskCost(model, { ...options, version: AA_COST_VERSION }).cost).toBeUndefined();
    model.cacheHitRate = 2;
    expect(aaTaskCost(model, { ...options, version: AA_COST_VERSION }).cost).toBeUndefined();
    delete model.canonicalEvalTokenCounts!.briefcase;
    expect(aaTaskCost(model, { ...options, version: AA_COST_VERSION }).cost).toBeUndefined();
  });

  it("extracts nested Next.js data safely, including escaped brackets in names", () => {
    const content = 'x:{"initialModels":[{"name":"A [max] \\"quoted\\"","nested":{"a":[1,2]}}]}';
    const html = `<script>self.__next_f.push([1,${JSON.stringify(content)}])</script>`;
    expect(extractJsonProperty<Array<{ name: string }>>(extractNextPayload(html), "initialModels")?.[0].name).toBe('A [max] "quoted"');
    expect(extractJsonProperty(content, "missing")).toBeUndefined();
  });
});

describe("Arena's Cost/Task (P50) column", () => {
  it("follows reordered headers and never reads the adjacent API price", () => {
    const result = parseArenaTable(
      ["Model", "Price $/M", "Score", "Cost/Task (P50)", "Votes", "Rank"],
      [["Model (high)\nVendor · Proprietary", "$4 / $20", "1500±10", "$0.09", "1,000", "1"]],
      { url: options.sourceUrl, fetchedAt: options.fetchedAt },
    );
    expect(result.entries[0].cost?.usd).toBe(0.09);
    expect(result.entries[0].cost?.statistic).toBe("median");
    expect(result.entries[0].extra?.votes).toBe(1000);
    const unknown = parseArenaTable(["Model", "Score", "Price $/M"], [["Example", "1500", "$2 / $10"]], { url: options.sourceUrl, fetchedAt: options.fetchedAt });
    expect(unknown.entries[0].cost).toBeUndefined();
    expect(unknown.warnings).toHaveLength(1);
  });

  it("retains score rows whose task cost is unavailable", () => {
    const result = parseArenaTable(["Model", "Score", "Cost/Task (P50)"], [["Example", "1500", "N/A"]], { url: options.sourceUrl, fetchedAt: options.fetchedAt });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].cost).toBeUndefined();
  });
});
