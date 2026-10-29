import type { SourceSnapshot } from "../types.js";
import { fetchJson, nowISO } from "../util.js";
import { parseTauBanking, TAU_BANKING_URL, TAU_SUBMISSIONS_URL, type TauSubmission } from "../parse/tau-banking.js";

export async function fetchTauBanking(): Promise<SourceSnapshot> {
  const manifest = await fetchJson<{ submissions?: string[] }>(`${TAU_SUBMISSIONS_URL}/manifest.json`, { cache: "no-cache" });
  const ids = manifest.submissions;
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length ||
    ids.some((id) => typeof id !== "string" || !/^[a-zA-Z0-9._-]+$/.test(id))) {
    throw new Error("τ³-Banking: invalid or empty text-submission manifest");
  }
  // A failed submission request fails the refresh; never replace history with a
  // partially downloaded cohort. Voice/legacy manifest lists are not used.
  const submissions = await Promise.all(ids.map(async (id) => ({
    id,
    data: await fetchJson<TauSubmission>(`${TAU_SUBMISSIONS_URL}/${id}/submission.json`, { cache: "no-cache" }),
  })));
  const { entries, warnings, sourceUpdatedAt } = parseTauBanking(submissions);
  return {
    sourceId: "tau3-banking", fetchedAt: nowISO(), sourceUpdatedAt,
    url: TAU_BANKING_URL, entries, warnings,
    costStatus: {
      status: "not-reported", url: TAU_BANKING_URL,
      note: "No audited USD mean cost per attempted task is published for this cohort. Numeric submission cost fields with unverified units/statistics are retained only in raw audit data.",
    },
  };
}
