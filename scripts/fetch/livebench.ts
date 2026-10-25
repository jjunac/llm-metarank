import type { RawEntry, SourceSnapshot } from "../types.js";
import { fetchJson, fetchText, nowISO, parseCsv, parseNumber, sleep } from "../util.js";
import { indexLiveBenchCosts, liveBenchTaskCost } from "../parse/livebench.js";

interface LiveBenchCategoryConfig {
  [key: string]: string[] | Record<string, number>;
}

function formatRelease(id: string): string {
  return `${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}`;
}

async function discoverRelease(): Promise<{ releaseId: string; tableCsv: string; categoriesJson: LiveBenchCategoryConfig }> {
  const siteHtml = await fetchText("https://livebench.ai/new/");
  const scriptMatch = siteHtml.match(/src="\.?\/?([^"]*main\.[^"]+\.js)"/);
  if (!scriptMatch) throw new Error("LiveBench: could not find main JS bundle");

  const bundle = await fetchText(`https://livebench.ai/${scriptMatch[1]}`);
  const dates = [...new Set([...bundle.matchAll(/"(\d{8})"/g)].map((match) => match[1]))]
    .filter((date) => /^20\d{6}$/.test(date) && date >= "20250101")
    .sort()
    .reverse()
    .slice(0, 15);

  // The current release is sometimes added conditionally for /new, so include
  // the newest dates found in the bundle even if they are not in the main list.
  for (const releaseId of dates) {
    try {
      const tableCsv = await fetchText(`https://livebench.ai/data/${releaseId}/table.csv`);
      if (!tableCsv.startsWith("model,")) continue;
      const categoriesJson = await fetchJson<LiveBenchCategoryConfig>(
        `https://livebench.ai/data/${releaseId}/categories.json`,
      );
      return { releaseId, tableCsv, categoriesJson };
    } catch {
      await sleep(150);
    }
  }

  throw new Error("LiveBench: no working release found");
}

export async function fetchLiveBench(): Promise<SourceSnapshot> {
  const { releaseId, tableCsv, categoriesJson } = await discoverRelease();
  const rows = parseCsv(tableCsv);
  const fetchedAt = nowISO();
  const costUrl = `https://livebench.ai/data/${releaseId}/cost.csv`;
  let costRows = new Map<string, Record<string, string>>();
  let costError: string | undefined;
  try {
    costRows = indexLiveBenchCosts(parseCsv(await fetchText(costUrl, {}, { retries: 1 })));
  } catch (error) {
    costError = error instanceof Error ? error.message : String(error);
  }

  const overallWeights = (categoriesJson._overall_weights ?? {}) as Record<string, number>;
  const categoryColumns = Object.entries(categoriesJson)
    .filter(([label, columns]) => label !== "_overall_weights" && Array.isArray(columns) && columns.length > 0)
    .map(([label, columns]) => ({
      label,
      column: (columns as string[])[0],
      weight: overallWeights[label] ?? 1,
    }));

  const entries: RawEntry[] = [];
  for (const row of rows) {
    const model = row.model?.trim();
    if (!model) continue;

    const metrics: Record<string, number> = {};
    const metricCosts: NonNullable<RawEntry["metricCosts"]> = {};
    const scoredColumns: string[] = [];
    let weightedSum = 0;
    let weightSum = 0;

    for (const { label, column, weight } of categoryColumns) {
      const value = parseNumber(row[column]);
      if (value === null) continue;
      metrics[column] = value;
      metrics[label] = value;
      scoredColumns.push(column);
      const cost = liveBenchTaskCost(costRows.get(model), [column], {
        fetchedAt, sourceUrl: costUrl, scope: `LiveBench ${releaseId} · ${label}`,
      });
      if (cost) {
        metricCosts[column] = cost;
        metricCosts[label] = cost;
      }
      weightedSum += value * weight;
      weightSum += weight;
    }

    if (!weightSum) continue;
    const overall = weightedSum / weightSum;
    metrics.overall = overall;
    const cost = scoredColumns.length === categoryColumns.length ? liveBenchTaskCost(costRows.get(model), scoredColumns, {
      fetchedAt, sourceUrl: costUrl, scope: `LiveBench ${releaseId} · scored suites`,
    }) : undefined;

    entries.push({
      rawName: model,
      score: overall,
      metrics,
      date: formatRelease(releaseId),
      url: `https://livebench.ai/#/release/${formatRelease(releaseId)}`,
      extra: { releaseId },
      runId: `${releaseId}:${model}`,
      cost,
      metricCosts,
      costUnavailableReason: cost ? undefined : scoredColumns.length !== categoryColumns.length
        ? "Partial suite scoring does not have a comparable overall score/cost task mix."
        : "No complete, unambiguous cost row for the same release and exact model identifier.",
    });
  }

  return {
    sourceId: "livebench",
    fetchedAt,
    sourceUpdatedAt: formatRelease(releaseId),
    url: `https://livebench.ai/#/release/${formatRelease(releaseId)}`,
    entries,
    warnings: [
      ...(entries.length < 10 ? [`Only ${entries.length} LiveBench rows found.`] : []),
      ...(costError ? [`Task-cost feed unavailable; scores were refreshed without borrowing older costs: ${costError}`] : []),
    ],
    costStatus: {
      status: entries.some((entry) => entry.cost) ? "available" : "unavailable",
      url: costUrl,
      note: "Release-matched total model-under-test spend divided by task count (including failures). Category costs use their own tasks, not the overall task mix.",
    },
  };
}
