import type { RawEntry, TaskCost } from "../types.js";
import { cleanText, extractFirstNumber, findDate, parseNumber } from "../util.js";
import { parseAnnotations } from "./annotations.js";
import { nonNegative, reportedTaskCost } from "./cost.js";
import { extractJsonProperty, extractNextPayload } from "./next-data.js";

export interface ArenaParseResult {
  entries: RawEntry[];
  sourceUpdatedAt?: string;
  expectedRows?: number;
  warnings: string[];
}

interface ArenaPayloadRow {
  rank?: number | null;
  modelKey?: string;
  modelDisplayName?: string;
  rating?: number | null;
  votes?: number | null;
  modelOrganization?: string | null;
  license?: string | null;
  inputPricePerMillion?: number | null;
  outputPricePerMillion?: number | null;
  contextLength?: number | null;
  isDay1?: boolean | null;
}

interface ArenaPayloadLeaderboard {
  id?: string;
  voteCutoffISOString?: string;
  totalVotes?: number;
  totalModels?: number;
  entries?: ArenaPayloadRow[];
}

interface ArenaBattleCostRow {
  modelKey?: string;
  medianUsd?: number | null;
  totalSampleCount?: number | null;
  pricedSampleCount?: number | null;
}

interface ArenaBattleCostPayload {
  entries?: ArenaBattleCostRow[];
}

/**
 * Matches Arena's own client-side sample-coverage gate: rows with fewer than 50 priced
 * battles or <50% priced sample coverage are shown as N/A and excluded from plots.
 */
function hasSufficientArenaCost(
  row: ArenaBattleCostRow | undefined,
): row is ArenaBattleCostRow & { medianUsd: number } {
  if (!row || !nonNegative(row.medianUsd) || row.medianUsd <= 0) return false;
  if (typeof row.totalSampleCount !== "number" || typeof row.pricedSampleCount !== "number") return false;
  return row.totalSampleCount > 0 && row.pricedSampleCount >= 50 && row.pricedSampleCount / row.totalSampleCount >= 0.5;
}

export function parseArenaPayload(
  html: string,
  options: { url: string; fetchedAt: string },
): ArenaParseResult {
  const payload = extractNextPayload(html);
  const leaderboard = extractJsonProperty<ArenaPayloadLeaderboard>(payload, "leaderboard");
  if (!leaderboard || !Array.isArray(leaderboard.entries)) {
    throw new Error("Arena: leaderboard payload was not found");
  }
  const battleCost = extractJsonProperty<ArenaBattleCostPayload>(payload, "initialBattleCost");
  const hasCostPayload = Array.isArray(battleCost?.entries);
  const costByKey = new Map<string, ArenaBattleCostRow>();
  for (const item of battleCost?.entries ?? []) {
    if (typeof item.modelKey === "string") costByKey.set(item.modelKey, item);
  }

  let day1Count = 0;
  const entries: RawEntry[] = [];
  for (const row of leaderboard.entries) {
    if (row.isDay1 === true) {
      day1Count += 1;
      continue;
    }
    const name = cleanText(row.modelDisplayName ?? "");
    const score = typeof row.rating === "number" && Number.isFinite(row.rating) ? Math.round(row.rating) : null;
    if (!name || score === null) continue;
    const annotations = parseAnnotations(name);
    const costRow = row.modelKey ? costByKey.get(row.modelKey) : undefined;
    const usd = hasSufficientArenaCost(costRow) ? Number(costRow.medianUsd.toFixed(8)) : undefined;
    const cost: TaskCost | undefined = usd !== undefined && usd > 0
      ? {
          usd,
          upperBound: false,
          statistic: "median",
          sourceUrl: options.url,
          fetchedAt: options.fetchedAt,
          scope: "Arena · Cost/Task (P50)",
          currency: "USD",
          unit: "task",
          method: "reported",
          complete: true,
        }
      : undefined;
    const price = nonNegative(row.inputPricePerMillion) && nonNegative(row.outputPricePerMillion)
      ? `$${row.inputPricePerMillion} / $${row.outputPricePerMillion}`
      : undefined;
    entries.push({
      rawName: name,
      score,
      variant: annotations.variant,
      harness: annotations.harness,
      vendor: row.modelOrganization?.trim() || undefined,
      url: options.url,
      runId: `${options.url}:${name}`,
      cost,
      costUnavailableReason: cost
        ? undefined
        : !hasCostPayload
          ? "A verified Cost/Task (P50) column was not found."
          : "The source does not report a numeric median task cost for this run.",
      extra: {
        rank: typeof row.rank === "number" && row.rank > 0 ? row.rank : undefined,
        votes: typeof row.votes === "number" ? row.votes : undefined,
        costPerTask: cost ? `$${cost.usd}` : undefined,
        price,
        context: row.contextLength ?? undefined,
      },
    });
  }

  const expectedRows = typeof leaderboard.totalModels === "number"
    ? Math.max(0, leaderboard.totalModels - day1Count)
    : undefined;
  const sourceUpdatedAt = leaderboard.voteCutoffISOString
    ? findDate(leaderboard.voteCutoffISOString)
    : undefined;

  return {
    entries,
    sourceUpdatedAt,
    expectedRows,
    warnings: hasCostPayload ? [] : ["No verified Cost/Task (P50) header; API prices were not used as task costs."],
  };
}

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
