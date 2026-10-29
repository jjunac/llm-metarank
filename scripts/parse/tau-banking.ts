import type { RawEntry } from "../types.js";
import { findDate } from "../util.js";

export const TAU_BANKING_URL = "https://taubench.com/leaderboard/?benchmark=knowledge";
export const TAU_SUBMISSIONS_URL = "https://sierra-tau-bench-public.s3.us-west-2.amazonaws.com/submissions";
export const TAU_BANKING_VERSION = "1.0.1";

export interface TauSubmission {
  model_name?: string;
  model_organization?: string;
  submitting_organization?: string;
  submission_date?: string;
  submission_type?: string;
  modality?: string;
  reasoning_effort?: string;
  trajectories_available?: boolean;
  model_release?: { release_date?: string };
  methodology?: {
    evaluation_date?: string;
    tau2_bench_version?: string;
    user_simulator?: string;
    notes?: string;
    verification?: { modified_prompts?: boolean; omitted_questions?: boolean };
  };
  results?: {
    banking_knowledge?: {
      retrieval_config?: string;
      pass_1?: number | null;
      pass_2?: number | null;
      pass_3?: number | null;
      pass_4?: number | null;
      cost?: number | null;
    } | null;
  };
}

export function parseTauBanking(
  submissions: Array<{ id: string; data: TauSubmission }>,
): { entries: RawEntry[]; warnings: string[]; sourceUpdatedAt?: string } {
  const entries: RawEntry[] = [];
  const dates: string[] = [];
  const seen = new Set<string>();
  let excluded = 0;
  for (const { id, data } of submissions) {
    if (!data || typeof data !== "object") throw new Error(`τ³-Banking: invalid submission ${id}`);
    const result = data.results?.banking_knowledge;
    const method = data.methodology;
    // Older records in the manifest's text-only submissions list predate the
    // explicit modality field. An explicit non-text modality is still excluded.
    if (data.submission_type !== "standard" || (data.modality !== undefined && data.modality !== "text") ||
      result?.retrieval_config !== "alltools" || method?.user_simulator !== "gpt-5.2" ||
      method.tau2_bench_version !== TAU_BANKING_VERSION ||
      method.verification?.modified_prompts !== false || method.verification.omitted_questions !== false) {
      excluded += 1;
      continue;
    }
    if (!data.model_name?.trim() || typeof result.pass_1 !== "number" ||
      !Number.isFinite(result.pass_1) || result.pass_1 < 0 || result.pass_1 > 100) {
      throw new Error(`τ³-Banking: invalid model/pass^1 in ${id}`);
    }
    if (seen.has(id)) throw new Error(`τ³-Banking: duplicate submission ${id}`);
    seen.add(id);
    const metrics: Record<string, number> = {};
    for (const key of ["pass_2", "pass_3", "pass_4"] as const) {
      const value = result[key];
      if (value === null || value === undefined) continue;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
        throw new Error(`τ³-Banking: invalid ${key} in ${id}`);
      }
      metrics[key] = value;
    }
    const date = method.evaluation_date ? findDate(method.evaluation_date) : undefined;
    const submissionDate = data.submission_date ? findDate(data.submission_date) : undefined;
    dates.push(...[date, submissionDate].filter((value): value is string => Boolean(value)));
    entries.push({
      rawName: data.model_name, score: result.pass_1, metrics,
      variant: data.reasoning_effort,
      harness: `τ-bench ${TAU_BANKING_VERSION} · AllTools · GPT-5.2 user`,
      date, url: TAU_BANKING_URL, vendor: data.model_organization,
      runId: id,
      costUnavailableReason: result.cost == null
        ? "No monetary task cost reported for this AllTools run."
        : "The submission's numeric cost has no audited currency/statistic/attempt denominator; it is not used as USD/task.",
      extra: {
        dataUrl: `${TAU_SUBMISSIONS_URL}/${id}/submission.json`,
        benchmarkVersion: method.tau2_bench_version, retrievalConfig: result.retrieval_config,
        userSimulator: method.user_simulator, submissionDate,
        modelReleaseDate: data.model_release?.release_date,
        submittingOrganization: data.submitting_organization,
        trajectoriesAvailable: data.trajectories_available,
        methodologyNotes: method.notes, reportedCost: result.cost,
      },
    });
  }
  if (!entries.length) throw new Error("τ³-Banking: no standard v1.0.1 AllTools / GPT-5.2 text runs found");
  return {
    entries, sourceUpdatedAt: dates.sort().at(-1),
    warnings: excluded ? [`Excluded ${excluded} submissions outside the standard v${TAU_BANKING_VERSION} AllTools / GPT-5.2 text cohort (including custom, other-retrieval or non-banking runs).`] : [],
  };
}
