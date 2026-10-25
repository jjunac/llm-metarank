import { useEffect } from "react";
import { ExternalLink, X } from "lucide-react";
import type { LeaderboardDataset, ModelRank } from "../../scripts/types";
import {
  CATEGORY_COPY,
  CATEGORY_ORDER,
  formatDate,
  formatScore,
  formatScoreOne,
  scoreChipClass,
  sourceName,
  formatCostIndex,
  formatUsd,
} from "../lib/format";
import { Badge, CategoryBar, CoverageMeter, ModelAvatar } from "./ui";
import TaskCostDetail from "./TaskCostDetail";

export default function ModelDetail({
  model,
  data,
  onClose,
}: {
  model: ModelRank | null;
  data: LeaderboardDataset;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!model) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [model, onClose]);

  if (!model) return null;

  const allSourceIds = data.sources.map((source) => source.id);
  const presentSourceIds = new Set(model.sources.map((source) => source.sourceId));
  const missingSources = data.sources.filter((source) => !presentSourceIds.has(source.id));
  const isRanked = model.status === "ranked";
  const defaultBasketId = data.costAnalysis.defaultBasketId.overall;
  const defaultBasket = data.costAnalysis.baskets.overall.find((basket) => basket.id === defaultBasketId) ?? data.costAnalysis.baskets.overall[0];
  const defaultBasketName = defaultBasket ? defaultBasket.sourceIds.map((sourceId) => sourceName(data, sourceId)).join(" + ") : "";
  const basketMemberships = data.costAnalysis.baskets.overall.map((basket) => {
    const frontier = data.costAnalysis.frontiers.overall[basket.id];
    return {
      basket,
      point: frontier?.points.find((point) => point.modelId === model.id),
      excluded: frontier?.excluded.find((point) => point.modelId === model.id),
    };
  });
  const primaryMembership = basketMemberships.find((item) => item.basket.id === defaultBasketId && item.point) ?? basketMemberships.find((item) => item.point);
  const costPoint = primaryMembership?.point;
  const primaryBasketName = primaryMembership ? primaryMembership.basket.sourceIds.map((sourceId) => sourceName(data, sourceId)).join(" + ") : "";
  const frontierMemberships = basketMemberships.filter((item) => item.point?.frontier);
  const excludedCostPoint = basketMemberships.find((item) => item.basket.id === defaultBasketId)?.excluded;
  const missingCostSources = (excludedCostPoint?.missingSourceIds ?? [])
    .map((sourceId) => data.sources.find((source) => source.id === sourceId)?.shortName)
    .filter((name): name is string => Boolean(name));

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/35 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="scrollbar-thin h-full w-full overflow-y-auto border-l border-line bg-paper shadow-2xl sm:max-w-[660px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-detail-title"
      >
        <div className="sticky top-0 z-10 border-b border-line bg-paper/95 px-5 py-4 backdrop-blur sm:px-7">
          <div className="flex items-center justify-between gap-4">
            <span className="eyebrow">Model breakdown</span>
            <button
              type="button"
              onClick={onClose}
              className="focus-ring rounded-full border border-line p-1.5 text-muted transition-colors hover:border-ink hover:text-ink"
              aria-label="Close model breakdown"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="px-5 pb-12 pt-6 sm:px-7">
          <div className="flex items-start gap-4">
            <ModelAvatar name={model.name} vendor={model.vendor} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="model-detail-title" className="display text-3xl leading-none sm:text-4xl">
                  {model.name}
                </h2>
                {model.openWeights && <Badge tone="green">Open weights</Badge>}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                <span>{model.vendor}</span>
                {model.releaseDate && <span>Released {formatDate(model.releaseDate)}</span>}
                {!isRanked && <Badge>limited coverage · no overall rank</Badge>}
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="surface-card rounded-xl p-3.5">
              <div className="eyebrow mb-1.5">Meta score</div>
              <div className={`score-pill ${isRanked ? scoreChipClass(model.overall) : "border-line text-muted"}`}>
                {formatScore(model.overall)}
              </div>
            </div>
            <div className="surface-card rounded-xl p-3.5">
              <div className="eyebrow mb-1.5">Overall rank</div>
              <div className="num text-2xl">{isRanked ? `#${model.rank}` : "—"}</div>
            </div>
            <div className="surface-card rounded-xl p-3.5">
              <div className="eyebrow mb-1.5">Sources</div>
              <div className="num text-2xl">
                {model.coverage.used}
                <span className="text-sm text-muted">/{model.coverage.total}</span>
              </div>
            </div>
            <div className="surface-card rounded-xl p-3.5">
              <div className="eyebrow mb-1.5">Category ranks</div>
              <div className="num text-2xl">
                {CATEGORY_ORDER.filter((category) => model.categories[category].rank !== null).length}
                <span className="text-sm text-muted">/4</span>
              </div>
            </div>
          </div>

          <div className="mt-6">
            <CoverageMeter model={model} allSourceIds={allSourceIds} />
            <p className="mt-2 text-[11px] leading-5 text-muted/80">
              An overall rank requires at least five sources, including one general and one coding
              benchmark. Missing sources are not imputed.
            </p>
          </div>

          <section className="mt-6 rounded-xl border border-line bg-surface/60 p-4" aria-label="Model task-cost summary">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xs font-semibold">Measured task cost</h3>
              {frontierMemberships.length > 0 && <Badge tone="green">{primaryMembership?.point?.frontier ? `${primaryBasketName} frontier${frontierMemberships.length > 1 ? ` · ${frontierMemberships.length} baskets` : ""}` : `Frontier on ${frontierMemberships.length} baskets`}</Badge>}
            </div>
            {costPoint ? <p className="mt-2 text-xs leading-6 text-muted"><span className="num font-semibold text-ink">{formatCostIndex(costPoint.costIndex)}</span> relative task-cost index · matched-source score {formatScoreOne(costPoint.score)} · {costPoint.contributions.length} paired benchmarks on {primaryBasketName}.{primaryMembership?.basket.id !== defaultBasketId ? ` Not in the default ${defaultBasketName}; this is the largest matched basket with complete paired data.` : ""}</p> : <p className="mt-2 text-[11px] leading-5 text-muted">{missingCostSources.length > 0 ? `Not in ${defaultBasketName || "the default basket"}: missing usable paired task cost for ${missingCostSources.join(", ")}. ` : "Not enough paired task-cost coverage for a matched basket. "}Any available source costs are shown below; missing costs are not treated as free.</p>}
            <p className="mt-1 text-[10px] leading-5 text-muted/70">The index is not dollars per task or token pricing. Each cost below belongs to the exact scored setup.</p>
            <div className="mt-3 overflow-hidden rounded-lg border border-line">
              <table className="w-full text-left text-[10px]" aria-label="Matched basket status">
                <thead className="border-b border-line bg-wash/30 text-[9px] uppercase tracking-[0.08em] text-muted"><tr><th className="px-2.5 py-1.5 font-medium">Matched basket</th><th className="px-2 py-1.5 text-right font-medium">Index</th><th className="px-2 py-1.5 text-right font-medium">Score</th><th className="px-2.5 py-1.5 text-right font-medium">Status</th></tr></thead>
                <tbody>{basketMemberships.map(({ basket, point, excluded }) => {
                  const label = basket.sourceIds.map((sourceId) => sourceName(data, sourceId)).join(" + ");
                  const missing = (excluded?.missingSourceIds ?? []).map((sourceId) => sourceName(data, sourceId)).filter(Boolean);
                  return <tr key={basket.id} className="border-b border-line/60 last:border-0">
                    <td className="px-2.5 py-1.5">{label}{basket.id === defaultBasketId ? <span className="ml-1 text-[8px] uppercase tracking-[0.08em] text-muted">default</span> : null}</td>
                    <td className="num px-2 py-1.5 text-right">{point ? formatCostIndex(point.costIndex) : "—"}</td>
                    <td className="num px-2 py-1.5 text-right">{point ? formatScoreOne(point.score) : "—"}</td>
                    <td className="px-2.5 py-1.5 text-right">{point?.frontier ? <Badge tone="green">Frontier</Badge> : point ? <span className="text-muted">Dominated</span> : <span className="text-muted" title={missing.length ? `Missing ${missing.join(", ")}` : "Not eligible"}>{missing.length ? `Missing ${missing.join(", ")}` : "Not eligible"}</span>}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
            <p className="mt-2 text-[9px] leading-4 text-muted/70">Each basket is a separate fixed comparison. Membership is not a cross-basket ranking.</p>
            <a href="#frontier" onClick={onClose} className="mt-2 inline-block text-[11px] text-accent hover:underline">Explore the cost frontier ↗</a>
          </section>

          <section className="mt-7">
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="text-sm font-semibold">Category scores</h3>
              <span className="text-[10px] text-muted">Percentile average · 2+ sources required</span>
            </div>
            <div className="grid gap-5 rounded-2xl border border-line bg-surface/70 p-4 sm:grid-cols-2">
              {CATEGORY_ORDER.map((category) => (
                <CategoryBar
                  key={category}
                  label={CATEGORY_COPY[category].label}
                  value={model.categories[category].score}
                  rank={model.categories[category].rank}
                  sources={model.categories[category].sources}
                />
              ))}
            </div>
          </section>

          <section className="mt-7">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold">Benchmark scores</h3>
              <span className="text-[10px] text-muted">Tracked-model percentile</span>
            </div>
            <div className="overflow-hidden rounded-2xl border border-line">
              <div className="divide-y divide-line">
                {model.sources.map((entry) => {
                  const source = data.sources.find((item) => item.id === entry.sourceId);
                  if (!source) return null;
                  const rawNameLower = entry.rawName.toLowerCase();
                  const annotation = [entry.harness, entry.variant]
                    .filter((value): value is string => Boolean(value))
                    .filter((value) => !rawNameLower.includes(value.toLowerCase()))
                    .join(" · ");
                  const raw =
                    source.scoreType === "elo" ? Math.round(entry.score).toString() : formatScoreOne(entry.score);
                  return (
                    <div key={entry.sourceId} className="bg-surface/60 px-4 py-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <a
                              href={entry.url || source.url}
                              target="_blank"
                              rel="noreferrer"
                              className="group inline-flex items-center gap-1 text-xs font-medium transition-colors hover:text-accent"
                            >
                              {sourceName(data, entry.sourceId)}
                              <ExternalLink className="h-3 w-3 text-muted/50 transition-colors group-hover:text-accent" />
                            </a>
                            {source.composite && <Badge>composite</Badge>}
                          </div>
                          <div className="mt-0.5 truncate text-[10px] text-muted" title={entry.rawName}>
                            {entry.rawName}
                            {annotation ? ` · ${annotation}` : ""}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="num text-sm font-semibold">{raw}</div>
                          <div className="text-[10px] text-muted">{source.metricLabel}</div>
                        </div>
                      </div>
                      <div className="mt-2.5 flex items-center gap-3">
                        <div className="bar-track flex-1">
                          <div className="bar-fill" style={{ width: `${Math.max(1, entry.percentile)}%` }} />
                        </div>
                        <span className="num w-11 text-right text-[10px] text-muted">
                          P{Math.round(entry.percentile)}
                        </span>
                      </div>
                       <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted/70">
                        <span>
                          #{entry.rankInSource} of {entry.sourceSize} tracked
                        </span>
                        <span>Data {formatDate(source.dataDate)}</span>
                       </div>
                      {entry.cost ? <TaskCostDetail cost={entry.cost} /> : (
                        <div className="mt-3 border-t border-line/70 pt-2 text-[10px] leading-5 text-muted/80">
                          {entry.runCostUsd !== undefined && <p className="num font-medium text-ink">{formatUsd(entry.runCostUsd)} total run cost—not $/task</p>}
                          <p>{entry.costUnavailableReason ?? source.costCoverage.note}</p>
                        </div>
                      )}
                      {source.status === "stale" && entry.cost && <p className="mt-2 text-[10px] text-amber-700 dark:text-amber-300">Stale source; this historical cost is excluded from the frontier.</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {missingSources.length > 0 && (
            <section className="mt-7">
              <h3 className="mb-2 text-sm font-semibold">Not reported by</h3>
              <div className="flex flex-wrap gap-1.5">
                {missingSources.map((source) => (
                  <span
                    key={source.id}
                    className="rounded-full border border-line bg-wash/40 px-2.5 py-1 text-[10px] text-muted"
                  >
                    {source.shortName}
                  </span>
                ))}
              </div>
            </section>
          )}

          <section className="mt-7 rounded-2xl border border-line bg-surface/60 p-4">
            <div className="eyebrow mb-2">How to read this</div>
            <p className="text-xs leading-5 text-muted">
              Each benchmark is converted to a percentile within its own pool, so Elo scores,
              percentages, and composite indexes can be averaged. The meta score is relative to the
              tracked model pool, not an absolute measure. Coding and agentic results can depend on
              the harness shown under each benchmark.
            </p>
          </section>
        </div>
      </aside>
    </div>
  );
}
