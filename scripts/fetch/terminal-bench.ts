import type { RawEntry, SourceSnapshot } from "../types.js";
import { fetchJson, nowISO } from "../util.js";
import { terminalTaskCost } from "../parse/terminal-bench.js";

interface TerminalBenchRow {
  id: string;
  rank?: number;
  metadata?: {
    model_display?: { label?: string };
    agent_display?: { label?: string };
    reasoning_effort?: string;
    date?: string;
  };
  metrics?: {
    accuracy?: number;
    n_trials?: number;
    accuracy_ci95_half_width?: number;
    total_cost_usd?: number;
  };
  n_trials?: number;
  updated_at?: string;
}

interface TerminalBenchResponse {
  leaderboard?: { title?: string; updated_at?: string };
  rows?: TerminalBenchRow[];
}

export async function fetchTerminalBench(): Promise<SourceSnapshot> {
  const url = "https://www.tbench.ai/";
  const dataUrl = "https://ofhuhcpkvzjlejydnvyd.supabase.co/functions/v1/leaderboard-read";
  const response = await fetchJson<TerminalBenchResponse>(
    dataUrl,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://www.tbench.ai",
        referer: "https://www.tbench.ai/",
      },
      body: JSON.stringify({
        package: "terminal-bench/terminal-bench",
        name: "4-0-0",
      }),
    },
  );
  const fetchedAt = nowISO();

  const entries: RawEntry[] = (response.rows ?? []).flatMap((row) => {
    const model = row.metadata?.model_display?.label?.trim();
    const accuracy = row.metrics?.accuracy;
    if (!model || typeof accuracy !== "number" || !Number.isFinite(accuracy)) return [];
    const calculatedCost = terminalTaskCost(row.metrics, row.n_trials, {
      sourceUrl: url, fetchedAt, scope: "Terminal-Bench 4.0 · all trials",
    });
    const cost = calculatedCost && { ...calculatedCost, dataUrl, dataMethod: "POST" as const };
    const entry: RawEntry = {
      rawName: model,
      score: accuracy,
      harness: row.metadata?.agent_display?.label,
      variant: row.metadata?.reasoning_effort,
      date: row.updated_at?.slice(0, 10),
      url,
      runId: row.id,
      cost,
      costUnavailableReason: cost ? undefined : "Missing or inconsistent total spend / trial count for this run.",
      extra: {
        trials: row.metrics?.n_trials,
        ci95: row.metrics?.accuracy_ci95_half_width,
        rank: row.rank,
      },
    };
    return [entry];
  });

  const updatedDates = [response.leaderboard?.updated_at, ...(response.rows ?? []).map((row) => row.updated_at)]
    .filter((value): value is string => Boolean(value))
    .sort()
    .reverse();

  return {
    sourceId: "terminal-bench-4",
    fetchedAt,
    sourceUpdatedAt: updatedDates[0]?.slice(0, 10),
    url,
    entries,
    warnings: entries.length === 0 ? ["Terminal-Bench returned no model rows."] : [],
    costStatus: {
      status: entries.some((entry) => entry.cost) ? "available" : "unavailable",
      url: dataUrl,
      note: "Total reported evaluation spend divided by all trial attempts, including failures and repeated tasks. The website's Cost column itself is a run total.",
    },
  };
}
