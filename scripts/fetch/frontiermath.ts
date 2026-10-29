import type { SourceSnapshot } from "../types.js";
import { fetchText, nowISO } from "../util.js";
import { FRONTIERMATH_DATA_URL, FRONTIERMATH_RELEASE, FRONTIERMATH_URL, parseFrontierMath } from "../parse/frontiermath.js";

export async function fetchFrontierMath(): Promise<SourceSnapshot> {
  const csv = await fetchText(FRONTIERMATH_DATA_URL, { cache: "no-cache" });
  const { entries, warnings, sourceUpdatedAt } = parseFrontierMath(csv);
  return {
    sourceId: "frontiermath", fetchedAt: nowISO(), sourceUpdatedAt,
    benchmarkRelease: FRONTIERMATH_RELEASE, url: FRONTIERMATH_URL, entries, warnings,
    costStatus: {
      status: "not-reported", url: FRONTIERMATH_URL,
      note: "The official Epoch run CSV publishes accuracy, run dates and some token usage, but no paired monetary task cost. Training compute costs and model token prices are not task spend.",
    },
  };
}
