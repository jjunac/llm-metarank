import type { RawEntry } from "../types.js";
import { findDate, parseCsv } from "../util.js";
import { parseAnnotations } from "./annotations.js";

export const FRONTIERMATH_URL = "https://epoch.ai/benchmarks/frontiermath-tiers-1-3-v2";
export const FRONTIERMATH_DATA_URL = "https://epoch.ai/data/benchmarks.csv";
export const FRONTIERMATH_TASK = "FrontierMath-Tiers-1-3-v2-Private";
export const FRONTIERMATH_VERSION = "2.0.0";
export const FRONTIERMATH_RELEASE = "2026-06-12";

export function parseFrontierMath(
  csv: string,
): { entries: RawEntry[]; warnings: string[]; sourceUpdatedAt?: string } {
  const rows = parseCsv(csv);
  const required = ["id_runs", "task", "model", "Model", "mean_score", "Status", "task version", "started_at"];
  if (!rows.length || required.some((key) => !(key in rows[0]))) {
    throw new Error("FrontierMath: expected Epoch run CSV columns were not found");
  }
  const entries: RawEntry[] = [];
  const seen = new Set<string>();
  let excluded = 0;
  for (const row of rows) {
    // Never blend earlier datasets, Tier 4, public examples, or unsuccessful runs.
    if (row.task !== FRONTIERMATH_TASK) continue;
    if (row.Status !== "Success" || row["task version"] !== FRONTIERMATH_VERSION) {
      excluded += 1;
      continue;
    }
    const rawName = row["Unique display name"] || row["Display name"] || row.Model;
    const score = row.mean_score.trim() ? Number(row.mean_score) : NaN;
    if (!rawName?.trim() || !row.model || !row.id_runs || !Number.isFinite(score) || score < 0 || score > 1) {
      throw new Error("FrontierMath: invalid model, run id or fractional accuracy");
    }
    if (seen.has(row.id_runs)) throw new Error(`FrontierMath: duplicate run ${row.id_runs}`);
    seen.add(row.id_runs);
    const annotation = parseAnnotations(rawName);
    const effort = annotation.variant ?? row.model.match(/_(xhigh|high|medium|low|minimal|none|max|\d+k)$/i)?.[1];
    const logUrl = row["log viewer"];
    entries.push({
      rawName, score: score * 100,
      variant: [effort, `task v${FRONTIERMATH_VERSION}`].filter(Boolean).join(" · "),
      harness: "Epoch AI · Python tool",
      date: findDate(row.started_at),
      url: /^https?:\/\//.test(logUrl ?? "") ? logUrl : FRONTIERMATH_URL,
      vendor: row.Organization || undefined, runId: row.id_runs,
      costUnavailableReason: "Epoch's run CSV has no paired monetary task cost; token counts and training compute costs are not converted to USD/task.",
      extra: {
        dataUrl: FRONTIERMATH_DATA_URL, task: row.task, taskVersion: row["task version"],
        modelIdentifier: row.model, startedAt: row.started_at || undefined,
        modelReleaseDate: row["Version release date"] || undefined,
        standardError: row.stderr?.trim() && Number.isFinite(Number(row.stderr)) ? Number(row.stderr) : undefined,
        scores: row.Scores || undefined,
      },
    });
  }
  if (!entries.length) throw new Error("FrontierMath: no successful private Tiers 1–3 v2 runs found");
  return {
    entries,
    sourceUpdatedAt: entries.flatMap((entry) => entry.date ? [entry.date] : []).sort().at(-1),
    warnings: excluded ? [`Excluded ${excluded} unsuccessful or unsupported-version FrontierMath Tiers 1–3 v2 runs.`] : [],
  };
}
