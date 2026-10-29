import leaderboardJson from "../../data/leaderboard.json";
import type { LeaderboardDataset, ModelRank, NormalizedSourceEntry } from "../../scripts/types";

export const leaderboard = leaderboardJson as unknown as LeaderboardDataset;
export type { LeaderboardDataset };

function toClientEntry(entry: NormalizedSourceEntry): NormalizedSourceEntry {
  const client = {
    ...entry,
    metrics: {},
    metricPercentiles: { overall: entry.metricPercentiles.overall },
  };
  // Build-time only data: never read by the hydrated components.
  delete client.metricCosts;
  delete client.date;
  delete client.runId;
  return client;
}

function toClientModel(model: ModelRank): ModelRank {
  return {
    ...model,
    // Required by the type but only used while building the dataset.
    costedRuns: [],
    missingSourceIds: [],
    sources: model.sources.map(toClientEntry),
  };
}

/** `dominatedBy` is only consumed while building the dataset. */
function toClientFrontiers(
  frontiers: LeaderboardDataset["costAnalysis"]["frontiers"],
): LeaderboardDataset["costAnalysis"]["frontiers"] {
  return Object.fromEntries(
    Object.entries(frontiers).map(([scope, baskets]) => [
      scope,
      Object.fromEntries(
        Object.entries(baskets).map(([basketId, frontier]) => [
          basketId,
          {
            ...frontier,
            points: frontier.points.map((point) => ({ ...point, dominatedBy: [] })),
          },
        ]),
      ),
    ]),
  ) as unknown as LeaderboardDataset["costAnalysis"]["frontiers"];
}

/**
 * The page is server-rendered from the full dataset. Only send the fields the
 * hydrated islands actually read; `costedRuns` and `metricCosts` alone are
 * ~55% of the serialized payload.
 */
export function toClientDataset(data: LeaderboardDataset): LeaderboardDataset {
  return {
    ...data,
    models: data.models.map(toClientModel),
    costAnalysis: {
      ...data.costAnalysis,
      frontiers: toClientFrontiers(data.costAnalysis.frontiers),
      singleSourceFrontiers: toClientFrontiers(data.costAnalysis.singleSourceFrontiers),
    },
  };
}
