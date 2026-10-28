import type { RawEntry, SourceSnapshot } from "../types.js";
import { fetchText, fetchTextWithMetadata, nowISO, parseCsv, parseNumber } from "../util.js";
import { indexLiveBenchCosts, liveBenchTaskCost } from "../parse/livebench.js";

interface LiveBenchCategoryConfig {
  [key: string]: string[] | Record<string, number>;
}

function formatRelease(id: string): string {
  return `${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}`;
}

async function discoverRelease(): Promise<{ releaseId: string; dataQuery: string; tableCsv: string; categoriesJson: LiveBenchCategoryConfig; sourceUpdatedAt?: string }> {
  const siteUrl = "https://livebench.ai/";
  const siteHtml = await fetchText(siteUrl, { cache: "no-cache" });
  const scriptMatch = siteHtml.match(/src="\.?\/?([^"]*main\.[^"]+\.js)"/);
  if (!scriptMatch) throw new Error("LiveBench: could not find main JS bundle");

  const bundle = await fetchText(new URL(scriptMatch[1], siteUrl).href, { cache: "no-cache" });
  // Use the site's v2 release lists, not arbitrary dates in model identifiers.
  const releaseLists = [...bundle.matchAll(/\[\s*"20\d{6}"(?:\s*,\s*"20\d{6}")*\s*\]/g)];
  const dates = releaseLists.flatMap((match) => [...match[0].matchAll(/"(20\d{6})"/g)].map((date) => date[1]))
    .sort()
    .reverse();
  const releaseId = dates[0];
  if (!releaseId) throw new Error("LiveBench: could not find the current v2 release");

  // Match the site's cache-buster: results can change within the same release.
  const dataQuery = bundle.match(/["'](\?v=\d+)["']/)?.[1] ?? `?v=${Date.now()}`;
  const baseUrl = `${siteUrl}data/${releaseId}/`;
  const [table, categories] = await Promise.all([
    fetchTextWithMetadata(`${baseUrl}table.csv${dataQuery}`, { cache: "no-cache" }),
    fetchText(`${baseUrl}categories.json${dataQuery}`, { cache: "no-cache" }),
  ]);
  if (!/^\uFEFF?model,/.test(table.text)) {
    throw new Error(`LiveBench: invalid table.csv for current release ${releaseId}`);
  }
  // A broken current feed must fail, not silently downgrade to an older release.
  return { releaseId, dataQuery, tableCsv: table.text, categoriesJson: JSON.parse(categories) as LiveBenchCategoryConfig, sourceUpdatedAt: table.lastModified?.slice(0, 10) };
}

export async function fetchLiveBench(): Promise<SourceSnapshot> {
  const { releaseId, dataQuery, tableCsv, categoriesJson, sourceUpdatedAt } = await discoverRelease();
  const rows = parseCsv(tableCsv.replace(/^\uFEFF/, ""));
  const fetchedAt = nowISO();
  const costUrl = `https://livebench.ai/data/${releaseId}/cost.csv`;
  let costRows = new Map<string, Record<string, string>>();
  let costError: string | undefined;
  try {
    costRows = indexLiveBenchCosts(parseCsv(await fetchText(`${costUrl}${dataQuery}`, { cache: "no-cache" }, { retries: 1 })));
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
  if (!categoryColumns.length || categoryColumns.some(({ weight }) => !Number.isFinite(weight) || weight <= 0)) {
    throw new Error("LiveBench: missing categories or invalid overall weights");
  }

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
    sourceUpdatedAt,
    benchmarkRelease: formatRelease(releaseId),
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
