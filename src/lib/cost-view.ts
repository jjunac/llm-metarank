import type { CostScope, LeaderboardDataset, MetaCostFrontier } from "../../scripts/types";
import { canonicalBasketId } from "../../scripts/costs";

export type CostView =
  | { kind: "single"; sourceId: string; frontier: MetaCostFrontier; medianOnly: boolean }
  | { kind: "basket"; basketId: string; frontier: MetaCostFrontier }
  | { kind: "empty"; reason: "no-source" }
  | { kind: "invalid"; reason: "mixed-median" | "no-frontier" };

export function isMedianOnlySource(data: LeaderboardDataset, sourceId: string): boolean {
  const stats = data.sources.find((source) => source.id === sourceId)?.costCoverage.statistics ?? [];
  return stats.length > 0 && stats.every((statistic) => statistic === "median");
}

export function defaultSourceIds(data: LeaderboardDataset, scope: CostScope): string[] {
  const defaultId = data.costAnalysis.defaultBasketId[scope];
  if (!defaultId) return [];
  const basket = data.costAnalysis.baskets[scope]?.find((item) => item.id === defaultId);
  if (basket) return basket.sourceIds;
  return data.costAnalysis.singleSourceIds[scope]?.includes(defaultId) ? [defaultId] : [];
}

export function selectableSourceIds(data: LeaderboardDataset, scope: CostScope): string[] {
  const selectable = new Set(data.costAnalysis.baskets[scope]?.flatMap((basket) => basket.sourceIds) ?? []);
  for (const sourceId of data.costAnalysis.singleSourceIds[scope] ?? []) selectable.add(sourceId);
  return data.sources.filter((source) => selectable.has(source.id)).map((source) => source.id);
}

export function resolveCostView(data: LeaderboardDataset, scope: CostScope, sourceIds: string[]): CostView {
  if (sourceIds.length === 0) return { kind: "empty", reason: "no-source" };
  if (sourceIds.length === 1) {
    const sourceId = sourceIds[0];
    const frontier = data.costAnalysis.singleSourceFrontiers[scope]?.[sourceId];
    if (!frontier) return { kind: "invalid", reason: "no-frontier" };
    return { kind: "single", sourceId, frontier, medianOnly: isMedianOnlySource(data, sourceId) };
  }
  if (sourceIds.some((sourceId) => isMedianOnlySource(data, sourceId))) {
    return { kind: "invalid", reason: "mixed-median" };
  }
  const basketId = canonicalBasketId(sourceIds);
  const frontier = data.costAnalysis.frontiers[scope]?.[basketId];
  if (!frontier) return { kind: "invalid", reason: "no-frontier" };
  return { kind: "basket", basketId, frontier };
}
