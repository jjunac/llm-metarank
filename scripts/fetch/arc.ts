import type { RawEntry, SourceSnapshot } from "../types.js";
import { fetchJson, nowISO } from "../util.js";
import { parseAnnotations } from "../parse/annotations.js";
import { nonNegative } from "../parse/cost.js";

interface ArcEvaluation {
  datasetId: string;
  modelId: string;
  modelDisplayName: string;
  modelReleaseDate?: string;
  providerDisplayName?: string;
  score?: number;
  display?: boolean;
  resultsUrl?: string;
  cost?: number;
}

export async function fetchArcAgi3(): Promise<SourceSnapshot> {
  const url = "https://arcprize.org/leaderboard";
  const data = await fetchJson<{
    version?: string;
    generatedAt?: string;
    evaluations?: ArcEvaluation[];
  }>("https://arcprize.org/media/data/leaderboard/v3.json");

  const evaluations = (data.evaluations ?? []).filter(
    (entry) =>
      entry.datasetId === "v3_Semi_Private" &&
      entry.display !== false &&
      typeof entry.score === "number" &&
      !/human_panel|random|baseline/i.test(entry.modelId),
  );

  const entries: RawEntry[] = evaluations.map((entry) => {
    const annotations = parseAnnotations(entry.modelDisplayName);
    return {
      rawName: entry.modelDisplayName,
      score: (entry.score as number) * 100,
      variant: annotations.variant,
      harness: annotations.harness,
      vendor: entry.providerDisplayName,
      date: entry.modelReleaseDate?.slice(0, 10),
      url,
      runId: `${entry.datasetId}:${entry.modelId}`,
      runCostUsd: nonNegative(entry.cost) ? entry.cost : undefined,
      costUnavailableReason: "ARC-AGI-3 publishes total run cost. Per-run attempted-environment counts/completeness are not in this feed; a task denominator is not assumed.",
      extra: {
        modelId: entry.modelId,
        dataset: entry.datasetId,
        resultsUrl: entry.resultsUrl || undefined,
      },
    };
  });

  return {
    sourceId: "arc-agi-3",
    fetchedAt: nowISO(),
    sourceUpdatedAt: data.generatedAt?.slice(0, 10),
    url,
    entries,
    warnings: entries.length < 10 ? [`Only ${entries.length} ARC-AGI-3 rows found.`] : [],
    costStatus: {
      status: "not-reported",
      url: "https://arcprize.org/media/data/leaderboard/v3.json",
      note: "Run totals are retained for auditing, but not treated as $/task. Some results have incomplete coverage; no uniform denominator is assumed and ARC is excluded from the task-cost frontier.",
    },
  };
}
