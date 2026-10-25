import type { SourceSnapshot } from "../types.js";
import { fetchText, nowISO } from "../util.js";
import { parseScaleLeaderboard } from "../parse/scale.js";

async function fetchScaleSnapshot(
  sourceId: string,
  url: string,
  expectMinRows: number,
  options: { createdAtFallback?: boolean } = {},
): Promise<SourceSnapshot> {
  const html = await fetchText(url);
  const parsed = parseScaleLeaderboard(html, url);
  let sourceUpdatedAt = parsed.sourceUpdatedAt;
  if (options.createdAtFallback) {
    const dates = [...html.matchAll(/createdAt\\?":\\?"(20\d{2}-\d{2}-\d{2})/g)]
      .map((match) => match[1])
      .sort()
      .reverse();
    if (dates[0]) sourceUpdatedAt = dates[0];
  }
  const warnings = [...parsed.warnings];
  if (parsed.entries.length < expectMinRows) {
    warnings.push(`Expected at least ${expectMinRows} rows, found ${parsed.entries.length}.`);
  }
  return {
    sourceId,
    fetchedAt: nowISO(),
    sourceUpdatedAt,
    url,
    entries: parsed.entries,
    warnings,
    costStatus: {
      status: "not-reported",
      url,
      note: "The public leaderboard payload does not publish monetary task cost matched to these runs. Budget caps, API prices and costs from other evaluators are not substituted.",
    },
  };
}

export function fetchSweBenchPro(): Promise<SourceSnapshot> {
  return fetchScaleSnapshot(
    "swebench-pro-v2",
    "https://labs.scale.com/leaderboard/swe_bench_pro_public_v2",
    10,
  );
}

export function fetchHle(): Promise<SourceSnapshot> {
  return fetchScaleSnapshot(
    "hle",
    "https://labs.scale.com/leaderboard/humanitys_last_exam",
    20,
  );
}

export function fetchMcpAtlas(): Promise<SourceSnapshot> {
  return fetchScaleSnapshot(
    "mcp-atlas",
    "https://labs.scale.com/leaderboard/mcp_atlas",
    15,
    { createdAtFallback: true },
  );
}
