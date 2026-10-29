import * as cheerio from "cheerio";
import type { RawEntry } from "../types.js";
import { cleanText } from "../util.js";
import { reportedTaskCost } from "./cost.js";

export const CURSORBENCH_URL = "https://cursor.com/cursorbench";
export const CURSORBENCH_VERSION = "4.0";
export const CURSORBENCH_RELEASE = "2026-09-10";

export function parseCursorBench(
  html: string,
  fetchedAt: string,
): { entries: RawEntry[]; warnings: string[] } {
  const $ = cheerio.load(html);
  const heading = cleanText($("h1").first().text());
  if (heading !== `CursorBench ${CURSORBENCH_VERSION}`) {
    throw new Error(`CursorBench: expected version ${CURSORBENCH_VERSION}, found "${heading}"`);
  }

  // The source explicitly describes an average repriced from observed task token usage.
  // A cost column alone is not enough to assume its statistic or calculation.
  $("script, style").remove();
  const verifiedCostMethod = /avg(?:erage)?\s+cost\s*\/\s*task\s+is computed by applying/i.test($("body").text());
  const byName = new Map<string, RawEntry>();
  let tables = 0;

  for (const table of $("table").toArray()) {
    const labels = $(table).find("thead th").map((_, cell) => cleanText($(cell).text())).get();
    const modelIndex = labels.findIndex((label) => /^model$/i.test(label));
    const scoreIndex = labels.findIndex((label) => /^score$/i.test(label));
    if (modelIndex < 0 || scoreIndex < 0) continue;
    tables += 1;
    const costIndex = labels.findIndex((label) => /^(?:cost\s*)?cost\s*\/\s*task$/i.test(label));
    const tokensIndex = labels.findIndex((label) => /tokens\s*\/\s*task/i.test(label));
    const stepsIndex = labels.findIndex((label) => /steps\s*\/\s*task/i.test(label));
    const rows = $(table).find("tbody tr").toArray();
    if (!rows.length) throw new Error("CursorBench: score table is empty");

    for (const row of rows) {
      const cells = $(row).find("td").map((_, cell) => cleanText($(cell).text())).get();
      const rawName = cells[modelIndex];
      const scoreText = cells[scoreIndex] ?? "";
      if (!rawName || !/^\d+(?:\.\d+)?\s*%$/.test(scoreText)) {
        throw new Error("CursorBench: incomplete model/score row");
      }
      const score = Number(scoreText.replace(/\s*%$/, ""));
      if (score < 0 || score > 100) throw new Error(`CursorBench: invalid score for ${rawName}`);
      const cost = verifiedCostMethod && costIndex >= 0 ? reportedTaskCost(cells[costIndex] ?? "", {
        statistic: "mean", sourceUrl: CURSORBENCH_URL, fetchedAt,
        scope: `CursorBench ${CURSORBENCH_VERSION} · average model token cost per task`,
      }) : undefined;
      if (cost) {
        cost.method = "usage-estimate";
        cost.methodologyUrl = CURSORBENCH_URL;
        cost.notes = [
          "Cursor applies published input, cache-read, cache-write and output token prices to observed task usage. This is a source-reported usage estimate, not an invoice or an all-in operating cost.",
          "The published score and cost are rounded and belong to this exact reasoning-effort configuration.",
        ];
      }
      const count = (index: number) => {
        const value = cells[index]?.replace(/,/g, "") ?? "";
        return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined;
      };
      const entry: RawEntry = {
        rawName, score,
        variant: rawName.match(/\s(Extra High|High|Medium|Low|Minimal|Max)$/i)?.[1],
        harness: `Cursor · CursorBench ${CURSORBENCH_VERSION}`,
        url: CURSORBENCH_URL,
        runId: `cursorbench-${CURSORBENCH_VERSION}:${rawName}`,
        cost,
        costUnavailableReason: cost ? undefined : "No verified numeric average USD/task was published for this configuration.",
        extra: { tokensPerTask: count(tokensIndex), stepsPerTask: count(stepsIndex) },
      };
      // Cursor renders identical desktop/mobile tables. Never double-count them or
      // silently choose between conflicting copies of the same configuration.
      const previous = byName.get(rawName);
      if (previous && JSON.stringify(previous) !== JSON.stringify(entry)) {
        throw new Error(`CursorBench: conflicting duplicate configuration ${rawName}`);
      }
      byName.set(rawName, entry);
    }
  }
  if (!tables || !byName.size) throw new Error("CursorBench: no model score table found");
  const entries = [...byName.values()];
  return {
    entries,
    warnings: entries.some((entry) => !entry.cost) ? ["Some CursorBench average task costs are unavailable; token prices were not substituted."] : [],
  };
}
