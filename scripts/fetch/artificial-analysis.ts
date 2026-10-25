import type { RawEntry, SourceSnapshot } from "../types.js";
import { fetchText, nowISO } from "../util.js";
import { load } from "cheerio";
import { aaTaskCost, extractJsonProperty, extractNextPayload, type AAFallback, type AAModel } from "../parse/artificial-analysis.js";

function variantFromName(name: string): string | undefined {
  const match = name.match(/\(([^)]+)\)/);
  return match?.[1];
}

export async function fetchArtificialAnalysis(): Promise<SourceSnapshot> {
  const url = "https://artificialanalysis.ai/evaluations/artificial-analysis-intelligence-index";
  const html = await fetchText(url);
  const payload = extractNextPayload(html);
  const models = extractJsonProperty<AAModel[]>(payload, "initialModels");
  if (!Array.isArray(models)) throw new Error("Artificial Analysis: initialModels not found");
  const fallbacks = extractJsonProperty<Record<string, AAFallback>>(payload, "priceFallbackByModelId");
  const version = load(html)("h1").first().text().match(/Index\s+v([\d.]+)/)?.[1] ?? "";
  const fetchedAt = nowISO();

  const entries: RawEntry[] = models
    .filter((model) => typeof model.intelligenceIndex === "number" && model.intelligenceIndex !== null)
    .filter((model) => !model.deprecated)
    .map((model) => {
      const { cost, reason } = !fallbacks && /fallback/i.test(model.name)
        ? { cost: undefined, reason: "The page's fallback usage metadata is unavailable; primary-model cost alone is not substituted." }
        : aaTaskCost(model, {
            version, sourceUrl: `${url}#cost`, fetchedAt, fallback: model.id ? fallbacks?.[model.id] : undefined,
          });
      return {
      rawName: model.name,
      score: model.intelligenceIndex as number,
      variant: variantFromName(model.name),
      vendor: model.creator?.name,
      date: model.releaseDate,
      url,
      runId: model.id ?? model.slug,
      cost,
      costUnavailableReason: reason,
      extra: {
        slug: model.slug,
        isOpenWeights: model.isOpenWeights,
      },
      };
    });

  const costCount = entries.filter((entry) => entry.cost).length;
  const warnings = models.length === entries.length ? [] : [`Filtered ${models.length - entries.length} models without an index score.`];
  if (costCount < entries.length) warnings.push(`Task cost available for ${costCount}/${entries.length} rows; missing usage/cache metadata is not imputed.`);

  return {
    sourceId: "artificial-analysis",
    fetchedAt,
    url,
    entries,
    warnings,
    costStatus: {
      status: costCount ? "available" : "unavailable",
      url: `${url}#cost`,
      note: "Weighted cost per Intelligence Index task, reconstructed from the source's measured usage, caching and fallback metadata. Not a token-price proxy or an invoice.",
    },
  };
}
