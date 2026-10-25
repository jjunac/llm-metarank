import type { RawEntry } from "../types.js";
import { cleanText, extractFirstNumber, parseNumber } from "../util.js";
import { parseAnnotations } from "./annotations.js";
import { reportedTaskCost } from "./cost.js";

export function parseArenaTable(
  headers: string[],
  rows: string[][],
  options: { url: string; fetchedAt: string },
): { entries: RawEntry[]; warnings: string[] } {
  const labels = headers.map((header) => cleanText(header));
  const modelIndex = labels.findIndex((label) => /^model$/i.test(label));
  const scoreIndex = labels.findIndex((label) => /^score\b/i.test(label));
  const rankIndex = labels.findIndex((label) => /^rank$/i.test(label));
  const votesIndex = labels.findIndex((label) => /^votes\b/i.test(label));
  const priceIndex = labels.findIndex((label) => /^price\s*\$\/m$/i.test(label));
  const contextIndex = labels.findIndex((label) => /^context$/i.test(label));
  // Require the unit AND statistic; never mistake Price $/M or a new unknown column for task cost.
  const costIndex = labels.findIndex((label) => /cost\s*\/\s*task/i.test(label) && /p50|median/i.test(label));
  if (modelIndex < 0 || scoreIndex < 0) throw new Error("Arena: model/score table headers were not recognized");
  const entries: RawEntry[] = [];
  for (const cells of rows) {
    const [modelLine, vendorLine] = (cells[modelIndex] ?? "").split("\n");
    const name = cleanText(modelLine ?? "");
    const score = extractFirstNumber(cells[scoreIndex] ?? "");
    if (!name || score === null) continue;
    const annotations = parseAnnotations(name);
    const costText = costIndex < 0 ? "" : cells[costIndex] ?? "";
    const cost = reportedTaskCost(costText, {
      statistic: "median", sourceUrl: options.url, fetchedAt: options.fetchedAt, scope: "Arena · Cost/Task (P50)",
    });
    entries.push({
      rawName: name, score, variant: annotations.variant, harness: annotations.harness,
      vendor: vendorLine?.split("·")[0]?.trim(), url: options.url,
      runId: `${options.url}:${name}`, cost,
      costUnavailableReason: cost ? undefined : costIndex < 0 ? "A verified Cost/Task (P50) column was not found." : "The source does not report a numeric median task cost for this run.",
      extra: {
        rank: parseNumber(cells[rankIndex] ?? "") ?? undefined,
        votes: parseNumber(cells[votesIndex] ?? "") ?? undefined,
        costPerTask: costText || undefined,
        price: priceIndex >= 0 ? cells[priceIndex] || undefined : undefined,
        context: contextIndex >= 0 ? cells[contextIndex] || undefined : undefined,
      },
    });
  }
  return { entries, warnings: costIndex < 0 ? ["No verified Cost/Task (P50) header; API prices were not used as task costs."] : [] };
}
