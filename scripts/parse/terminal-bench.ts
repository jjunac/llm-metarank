import type { TaskCost } from "../types.js";
import { costFromTotals } from "./cost.js";

export function terminalTaskCost(
  metrics: { total_cost_usd?: number; n_trials?: number } | undefined,
  rowTrials: number | undefined,
  options: { sourceUrl: string; fetchedAt: string; scope: string },
): TaskCost | undefined {
  if (metrics?.n_trials !== undefined && rowTrials !== undefined && metrics.n_trials !== rowTrials) return undefined;
  return costFromTotals(metrics?.total_cost_usd, metrics?.n_trials ?? rowTrials, options);
}
