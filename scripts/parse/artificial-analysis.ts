import type { TaskCost } from "../types.js";
import { nonNegative } from "./cost.js";
export { extractNextPayload, extractJsonProperty } from "./next-data.js";

export const AA_COST_METHODOLOGY_URL = "https://artificialanalysis.ai/methodology/intelligence-benchmarking";

/** Audited against the live v4.3.2 methodology and its public chart calculation.
 * canonicalEvalTokenCounts are already repeat-normalized by AA: do not divide by repeats again.
 * Fail closed on a new index version instead of silently applying obsolete counts/weights.
 */
export const AA_COST_VERSION = "4.3.2";
export const AA_COST_EVALUATIONS = [
  { key: "briefcase", slug: "aa-briefcase", label: "AA-Briefcase v1.1", tasks: 91, weight: 0.15 },
  { key: "gdpval", slug: "gdpval-aa", label: "GDPval-AA v2.1", tasks: 220, weight: 0.10 },
  { key: "automationBench", slug: "automationbench-aa", label: "AutomationBench-AA", tasks: 657, weight: 0.05 },
  { key: "terminalBench40", slug: "terminalbench-4-0", label: "Terminal-Bench 4.0", tasks: 66, weight: 0.10 },
  { key: "scicode", slug: "scicode", label: "SciCode", tasks: 288, weight: 0.10 },
  { key: "hle", slug: "humanitys-last-exam", label: "Humanity's Last Exam", tasks: 2158, weight: 0.10 },
  { key: "gdpPdf", slug: "gdp-pdf", label: "GDP.pdf", tasks: 100, weight: 0.10 },
  { key: "critpt", slug: "critpt", label: "CritPt", tasks: 70, weight: 0.10 },
  { key: "omniscience", slug: "omniscience", label: "AA-Omniscience", tasks: 6000, weight: 0.15 },
  { key: "lcr", slug: "artificial-analysis-long-context-reasoning", label: "AA-LCR v1.1", tasks: 100, weight: 0.05 },
] as const;

interface TokenCounts {
  input: number;
  answer: number;
  reasoning: number;
  cacheableInput?: number | null;
}

interface Prices {
  input: number;
  output: number;
  cacheHit?: number | null;
  cacheWrite?: number | null;
}

export interface AAFallback {
  fallbackPrice: Prices;
  rateByEval: Record<string, { input: number; output: number; reasoning: number }>;
}

export interface AAModel {
  id?: string;
  slug?: string;
  name: string;
  releaseDate?: string;
  deprecated?: boolean;
  isOpenWeights?: boolean;
  creator?: { name?: string };
  intelligenceIndex?: number | null;
  canonicalEvalTokenCounts?: Record<string, TokenCounts>;
  price1mInputTokens?: number | null;
  price1mOutputTokens?: number | null;
  cacheHitPrice?: number | null;
  cacheWritePrice?: number | null;
  cacheHitRate?: number | null;
}

function validPrices(prices: Prices): boolean {
  return nonNegative(prices.input) && nonNegative(prices.output) &&
    (prices.cacheHit == null || nonNegative(prices.cacheHit)) &&
    (prices.cacheWrite == null || nonNegative(prices.cacheWrite));
}

export function aaTaskCost(
  model: AAModel,
  options: { version: string; sourceUrl: string; fetchedAt: string; fallback?: AAFallback },
): { cost?: TaskCost; reason?: string } {
  if (options.version !== AA_COST_VERSION) return { reason: `Task-cost methodology not verified for Intelligence Index v${options.version || "unknown"}.` };
  if (!nonNegative(model.price1mInputTokens) || !nonNegative(model.price1mOutputTokens)) return { reason: "Source has no priced evaluation usage for this run." };
  const prices: Prices = { input: model.price1mInputTokens, output: model.price1mOutputTokens, cacheHit: model.cacheHitPrice, cacheWrite: model.cacheWritePrice };
  if (!validPrices(prices)) return { reason: "Source returned invalid evaluation pricing metadata." };
  const breakdown: NonNullable<TaskCost["breakdown"]> = [];
  for (const evaluation of AA_COST_EVALUATIONS) {
    const tokens = model.canonicalEvalTokenCounts?.[evaluation.key];
    if (!tokens || ![tokens.input, tokens.answer, tokens.reasoning].every(nonNegative)) return { reason: `Missing measured usage for ${evaluation.label}; no partial task mix is substituted.` };
    const cacheable = tokens.cacheableInput;
    const hasCache = cacheable != null;
    if (hasCache && (!nonNegative(cacheable) || cacheable > tokens.input || !nonNegative(model.cacheHitRate) || model.cacheHitRate > 1)) {
      return { reason: `Missing or invalid cache measurements for ${evaluation.label}.` };
    }
    // This matches AA's chart, including cache writes and its measured typical cache-hit rate.
    const read = hasCache ? cacheable * model.cacheHitRate! : 0;
    const parts = {
      nonCacheInput: hasCache ? 0 : tokens.input,
      cacheRead: read,
      cacheWrite: hasCache ? tokens.input - read : 0,
      reasoning: tokens.reasoning,
      answer: tokens.answer,
    };
    const priceParts = (p: Prices) => ({
      nonCacheInput: parts.nonCacheInput * p.input / 1e6,
      cacheRead: parts.cacheRead * (p.cacheHit ?? p.input) / 1e6,
      cacheWrite: parts.cacheWrite * (p.cacheWrite ?? p.input) / 1e6,
      reasoning: parts.reasoning * p.output / 1e6,
      answer: parts.answer * p.output / 1e6,
    });
    const costs = priceParts(prices);
    const rate = options.fallback?.rateByEval?.[evaluation.slug];
    if (rate) {
      if (![rate.input, rate.output, rate.reasoning].every((value) => nonNegative(value) && value <= 1) || !validPrices(options.fallback!.fallbackPrice)) {
        return { reason: `Invalid fallback usage for ${evaluation.label}.` };
      }
      const fallbackCosts = priceParts(options.fallback!.fallbackPrice);
      for (const key of Object.keys(costs) as Array<keyof typeof costs>) {
        const proportion = key === "answer" ? rate.output : key === "reasoning" ? rate.reasoning : rate.input;
        costs[key] = costs[key] * (1 - proportion) + fallbackCosts[key] * proportion;
      }
    }
    const total = Object.values(costs).reduce((sum, value) => sum + value, 0);
    breakdown.push({ label: evaluation.label, usdPerTask: total / evaluation.tasks, weight: evaluation.weight, tasks: evaluation.tasks });
  }
  return { cost: {
    usd: breakdown.reduce((sum, item) => sum + item.usdPerTask * item.weight!, 0),
    currency: "USD", unit: "task", statistic: "weighted-mean", method: "usage-estimate",
    scope: `Intelligence Index v${AA_COST_VERSION}`, sourceUrl: options.sourceUrl,
    methodologyUrl: AA_COST_METHODOLOGY_URL, fetchedAt: options.fetchedAt, complete: true, breakdown,
    notes: ["Source's usage-based estimate, not an invoice. Includes input, cache, reasoning, answer and fallback usage; canonical counts are already repeat-normalized."],
  } };
}
