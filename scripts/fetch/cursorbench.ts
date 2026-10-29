import type { SourceSnapshot } from "../types.js";
import { fetchText, nowISO } from "../util.js";
import { CURSORBENCH_RELEASE, CURSORBENCH_URL, parseCursorBench } from "../parse/cursorbench.js";

export async function fetchCursorBench(): Promise<SourceSnapshot> {
  const html = await fetchText(CURSORBENCH_URL, { cache: "no-cache" });
  const fetchedAt = nowISO();
  const { entries, warnings } = parseCursorBench(html, fetchedAt);
  return {
    sourceId: "cursorbench", fetchedAt, benchmarkRelease: CURSORBENCH_RELEASE,
    url: CURSORBENCH_URL, entries, warnings,
    // Changelog dates refer to task/pricing changes, not all current result dates.
    costStatus: {
      status: entries.some((entry) => entry.cost) ? "available" : "unavailable",
      url: CURSORBENCH_URL,
      note: "Cursor's published average cost/task reprices observed input, cache-read, cache-write and output tokens. Paired with the exact score and effort; excludes unreported infrastructure and judging costs.",
    },
  };
}
