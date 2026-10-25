import type { CostStatistic, TaskCost } from "../types.js";

export function nonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Strict parsing: N/A, token-price pairs, other currencies and blanks are not $0. */
export function parseUsdTaskAmount(text: string): { usd: number; upperBound: boolean } | null {
  const match = text.trim().replace(/,/g, "").match(
    /^(<|≤|<=)?\s*(?:US\$|\$|USD\s+)\s*(\d+(?:\.\d+)?|\.\d+)\s*([kKmM])?(?:\s*\/\s*(?:task|environment))?$/,
  );
  if (!match) return null;
  const multiplier = match[3]?.toLowerCase() === "k" ? 1_000 : match[3]?.toLowerCase() === "m" ? 1_000_000 : 1;
  const usd = Number(match[2]) * multiplier;
  return nonNegative(usd) ? { usd, upperBound: Boolean(match[1]) } : null;
}

export function reportedTaskCost(
  text: string,
  options: { statistic: CostStatistic; sourceUrl: string; fetchedAt: string; scope: string },
): TaskCost | undefined {
  const value = parseUsdTaskAmount(text);
  if (!value) return undefined;
  return {
    ...value,
    ...options,
    currency: "USD",
    unit: "task",
    method: "reported",
    complete: true,
  };
}

export function costFromTotals(
  totalUsd: unknown,
  attempts: unknown,
  options: { sourceUrl: string; fetchedAt: string; scope: string },
): TaskCost | undefined {
  if (!nonNegative(totalUsd) || typeof attempts !== "number" || !Number.isSafeInteger(attempts) || attempts <= 0) return undefined;
  return {
    ...options,
    usd: totalUsd / attempts,
    currency: "USD",
    unit: "task",
    statistic: "mean",
    method: "total-over-attempts",
    complete: true,
    totalUsd,
    attempts,
  };
}
