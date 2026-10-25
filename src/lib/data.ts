import leaderboardJson from "../../data/leaderboard.json";
import type { LeaderboardDataset } from "../../scripts/types";

export const leaderboard = leaderboardJson as unknown as LeaderboardDataset;
export type { LeaderboardDataset };
