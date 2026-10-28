import { load } from "cheerio";
import type { RawEntry } from "../types.js";
import { cleanText, extractFirstNumber, findDate } from "../util.js";
import { parseAnnotations } from "./annotations.js";
import { extractJsonProperty, extractNextPayload } from "./next-data.js";

export interface ScaleLeaderboardResult {
  entries: RawEntry[];
  sourceUpdatedAt?: string;
  warnings: string[];
}

interface ScaleRow {
  model: string;
  score: number;
  rank?: number;
  createdAt?: string;
  deprecated?: boolean;
  version?: string;
}

/**
 * Prefer the page's structured results: its prose "Last Updated" date can be
 * older than individual results. Keep the selected benchmark variant separate
 * (SWE-bench Pro V2 has full/hard tables) instead of pooling both score scales.
 * Older pages without streamed data still expose `p[data-model-name]` rows.
 */
export function parseScaleLeaderboard(html: string, sourceUrl: string): ScaleLeaderboardResult {
  const $ = load(html);
  const updateMatch = cleanText($("body").text()).match(
    /(?:Last Updated|Updated|Update)[:\s]*([A-Z][a-z]+ \d{1,2}, 20\d{2})/i,
  );
  const pageDate = updateMatch ? findDate(updateMatch[1]) : undefined;
  if (html.includes("self.__next_f.push([1,")) {
    const payload = extractNextPayload(html);
    const variants = extractJsonProperty<Array<{ key: string; entries: ScaleRow[] }>>(payload, "variants");
    const activeTab = payload.match(/"activeTab"\s*:\s*"([^"]+)"/)?.[1];
    const rows = variants
      ? variants.find((variant) => variant.key === activeTab)?.entries
      : extractJsonProperty<ScaleRow[]>(payload, "entries");
    if (variants && !rows) throw new Error("Scale: active leaderboard variant was not found");
    if (rows) {
      const entries: RawEntry[] = rows.filter((row) => row.deprecated !== true).map((row) => {
        if (typeof row.model !== "string" || !row.model.trim() || !Number.isFinite(row.score)) {
          throw new Error("Scale: invalid model/score in leaderboard payload");
        }
        const name = cleanText(row.model);
        const annotations = parseAnnotations(name);
        return {
          rawName: name, score: row.score, variant: annotations.variant, harness: annotations.harness,
          date: row.createdAt ? findDate(row.createdAt) : undefined, url: sourceUrl,
          extra: { rank: row.rank, version: row.version, leaderboardVariant: activeTab },
        };
      });
      return {
        entries,
        sourceUpdatedAt: [pageDate, ...entries.map((entry) => entry.date)].filter((date): date is string => Boolean(date)).sort().at(-1),
        warnings: entries.length ? [] : ["No model rows were found in the Scale leaderboard payload."],
      };
    }
  }
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

  return {
    entries,
    sourceUpdatedAt: pageDate,
    warnings: entries.length === 0 ? ["No model rows were found in the Scale leaderboard HTML."] : [],
  };
}
