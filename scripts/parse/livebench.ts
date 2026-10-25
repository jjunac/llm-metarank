import type { TaskCost } from "../types.js";
import { costFromTotals } from "./cost.js";

export function liveBenchTaskCost(
  row: Record<string, string> | undefined,
  columns: string[],
  options: { sourceUrl: string; fetchedAt: string; scope: string },
): TaskCost | undefined {
  if (!row || !columns.length) return undefined;
  let total = 0;
  let attempts = 0;
  const breakdown: NonNullable<TaskCost["breakdown"]> = [];
  for (const column of new Set(columns)) {
    const costText = row[column]?.trim();
    const countText = row[`nq_${column}`]?.trim();
    if (!costText || !countText) return undefined;
    const cost = costFromTotals(Number(costText), Number(countText), options);
    if (!cost) return undefined;
    total += cost.totalUsd!;
    attempts += cost.attempts!;
    breakdown.push({ label: column, usdPerTask: cost.usd, tasks: cost.attempts });
  }
  const cost = costFromTotals(total, attempts, options);
  return cost && {
    ...cost, breakdown,
    methodologyUrl: "https://livebench.ai/#/methodology",
    notes: ["Total model-under-test spend divided by task count, including failures. Excludes fixed starting state and harness helper calls; not the mean of suite averages."],
  };
}

/** Costs join on the source's exact model/effort identifier, never canonical aliases. */
export function indexLiveBenchCosts(rows: Record<string, string>[]): Map<string, Record<string, string>> {
  const indexed = new Map<string, Record<string, string>>();
  const duplicates = new Set<string>();
  for (const row of rows) {
    const model = row.model?.trim();
    if (!model) continue;
    if (indexed.has(model)) duplicates.add(model);
    indexed.set(model, row);
  }
  for (const model of duplicates) indexed.delete(model);
  return indexed;
}
