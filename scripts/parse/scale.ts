import { load } from "cheerio";
import type { RawEntry } from "../types.js";
import { cleanText, extractFirstNumber } from "../util.js";
import { parseAnnotations } from "./annotations.js";

export interface ScaleLeaderboardResult {
  entries: RawEntry[];
  sourceUpdatedAt?: string;
  warnings: string[];
}

/**
 * Scale Labs leaderboards render the main ranking as a series of
 * `p[data-model-name]` rows. The same markup is used by SWE-bench Pro,
 * HLE, MCP Atlas, and the SWE Atlas pages.
 */
export function parseScaleLeaderboard(html: string, sourceUrl: string): ScaleLeaderboardResult {
  const $ = load(html);
  const entries: RawEntry[] = [];
  const seen = new Set<string>();

  $('p[data-model-name="true"]').each((_, element) => {
    const name = cleanText($(element).text());
    if (!name || seen.has(name)) return;

    const row = $(element).closest(".flex.items-center.gap-3");
    const scoreText = row.find("span.text-ink").first().text();
    const score = extractFirstNumber(scoreText);
    if (score === null || !Number.isFinite(score)) return;

    seen.add(name);
    const annotations = parseAnnotations(name);
    entries.push({
      rawName: name,
      score,
      variant: annotations.variant,
      harness: annotations.harness,
      url: sourceUrl,
      extra: {
        rank: extractFirstNumber(row.find("span.font-mono").first().text()) ?? undefined,
      },
    });
  });

  const updateMatch = html.match(
    /(?:Last Updated|Updated|Update)[:\s]*([A-Z][a-z]+ \d{1,2}, 20\d{2})/,
  );
  let sourceUpdatedAt: string | undefined;
  if (updateMatch) {
    const parsed = new Date(`${updateMatch[1]} UTC`);
    if (!Number.isNaN(parsed.getTime())) sourceUpdatedAt = parsed.toISOString().slice(0, 10);
  }

  return {
    entries,
    sourceUpdatedAt,
    warnings: entries.length === 0 ? ["No model rows were found in the Scale leaderboard HTML."] : [],
  };
}
