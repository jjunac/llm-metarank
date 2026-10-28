import type { RawEntry, SourceSnapshot } from "../types.js";
import { fetchJson, nowISO } from "../util.js";

interface GsoModel {
  name: string;
  model_org?: string;
  scaffold?: string;
  setting?: string;
  score?: number;
  score_hack_control?: number;
  date?: string;
  reasoning_effort?: string;
}

export async function fetchGso(): Promise<SourceSnapshot> {
  const url = "https://gso-bench.github.io/";
  const data = await fetchJson<{ models?: GsoModel[]; metadata?: { last_updated?: string } }>(
    "https://gso-bench.github.io/assets/leaderboard.json",
    { cache: "no-cache" },
  );

  const models = (data.models ?? []).filter((model) => model.setting === "Opt@1" && typeof model.score === "number");
  const entries: RawEntry[] = models.map((model) => ({
    rawName: model.name,
    score: model.score as number,
    harness: model.scaffold,
    variant: model.reasoning_effort,
    date: model.date,
    url,
    vendor: model.model_org,
    extra: {
      setting: model.setting,
      scoreHackControl: model.score_hack_control,
    },
  }));

  const dates = [data.metadata?.last_updated, ...models.map((model) => model.date)]
    .filter((value): value is string => Boolean(value))
    .sort()
    .reverse();

  return {
    sourceId: "gso",
    fetchedAt: nowISO(),
    sourceUpdatedAt: dates[0],
    url,
    entries,
    warnings: entries.length < 10 ? [`Only ${entries.length} GSO rows found.`] : [],
    costStatus: {
      status: "not-reported",
      url,
      note: "The public leaderboard and compute profile do not report monetary cost per task. Median runtime and turns are not dollar-cost proxies.",
    },
  };
}
