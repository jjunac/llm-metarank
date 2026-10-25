import { useId, useMemo, useState } from "react";
import { ArrowUpRight, Check, Search } from "lucide-react";
import type { CostScope, LeaderboardDataset } from "../../scripts/types";
import {
  CATEGORY_COPY,
  CATEGORY_ORDER,
  costStatisticLabel,
  formatCostIndex,
  formatScoreOne,
  formatUsd,
  sourceName,
  vendorTone,
} from "../lib/format";
import { defaultSourceIds, isMedianOnlySource, resolveCostView, selectableSourceIds } from "../lib/cost-view";
import { HEIGHT, MARGIN, WIDTH, plotScale, pointLabels, type PlotPoint } from "../lib/frontier-chart";
import EnsembleFrontier from "./EnsembleFrontier";
import { Badge } from "./ui";

export default function CostFrontier({ data, onSelectModel }: { data: LeaderboardDataset; onSelectModel: (id: string) => void }) {
  const [mode, setMode] = useState<"meta" | "ensemble">("meta");
  const [scope, setScope] = useState<CostScope>("overall");
  const [basketSourceIds, setBasketSourceIds] = useState<string[]>(() => defaultSourceIds(data, "overall"));
  const [query, setQuery] = useState("");
  const [frontierOnly, setFrontierOnly] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const chartId = useId();
  const modelById = useMemo(() => new Map(data.models.map((model) => [model.id, model])), [data.models]);
  const defaultId = data.costAnalysis.defaultBasketId[scope];
  const activeSourceIds = scope === "overall" ? basketSourceIds : defaultSourceIds(data, scope);
  const view = resolveCostView(data, scope, activeSourceIds);
  const meta = view.kind === "single" || view.kind === "basket" ? view.frontier : undefined;
  const metaSourceIds = meta?.sourceIds ?? activeSourceIds;
  const singleSelection = metaSourceIds.length === 1;
  const activeSelectionId = view.kind === "single" ? view.sourceId : view.kind === "basket" ? view.basketId : undefined;
  const activeIsDefault = activeSelectionId !== undefined && activeSelectionId === defaultId;
  const scopeSourceIds = selectableSourceIds(data, scope);
  const basketName = (sourceIds: string[]) => sourceIds.map((id) => sourceName(data, id)).join(" + ");
  const activeBasketName = basketName(metaSourceIds);
  const points = useMemo<PlotPoint[]>(() => {
    if (mode === "ensemble" || !meta) return [];
    return meta.points.flatMap((point) => {
      const model = modelById.get(point.modelId);
      return model ? [{ id: model.id, model, x: point.costIndex, y: point.score, frontier: point.frontier, meta: point }] : [];
    });
  }, [mode, meta, modelById]);
  const visible = points.filter((point) => (!frontierOnly || point.frontier) && `${point.model.name} ${point.model.vendor}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = visible.find((point) => point.id === hoveredId) ?? [...visible].sort((a, b) => b.y - a.y)[0];
  const scale = plotScale(points);
  const frontier = points.filter((point) => point.frontier).sort((a, b) => a.x - b.x || a.y - b.y);
  const frontierPath = frontier.map((point, index) => `${index === 0 ? "M" : "H"} ${scale.x(point.x)}${index === 0 ? " " : " V "}${scale.y(point.y)}`).join(" ");
  const labels = pointLabels(visible, scale.x, scale.y);
  const xLabel = `Relative task-cost index · ${activeBasketName} · log scale`;
  const yLabel = "Matched-basket percentile";
  const eligibleModels = new Set(points.map((point) => point.model.id)).size;
  const frontierCount = points.filter((point) => point.frontier).length;
  const noCostSources = data.sources.filter((source) => source.costCoverage.usableModels === 0).length;
  const medianOnlySources = data.sources.filter((source) =>
    source.costCoverage.usableModels > 0 && isMedianOnlySource(data, source.id)).length;
  const selectedIsMedian = singleSelection && view.kind === "single" && view.medianOnly;
  const toggleBasketSource = (id: string) => {
    setBasketSourceIds((current) => {
      const currentIsMedianOnly = current.length === 1 && isMedianOnlySource(data, current[0]);
      if (isMedianOnlySource(data, id)) return [id];
      if (currentIsMedianOnly) return [id];
      if (current.includes(id)) return current.length > 1 ? current.filter((item) => item !== id) : current;
      return [...current, id];
    });
    setHoveredId(null);
  };
  const resetSelection = () => {
    setBasketSourceIds(defaultSourceIds(data, "overall"));
    setHoveredId(null);
  };

  return (
    <section id="frontier" className="container-page scroll-mt-6 pb-14 pt-10 sm:pb-20 sm:pt-14" aria-labelledby="cost-frontier-title">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="eyebrow mb-2">Capability × measured task cost</div>
          <h2 id="cost-frontier-title" className="display text-4xl leading-none sm:text-5xl">{mode === "meta" ? "The meta Pareto frontier." : "The benchmark frontier ensemble."}</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">{mode === "meta" ? "Better results, less spend. Choose one benchmark for its own cost frontier, or compose a matched basket of mean-cost benchmarks—not a price per million tokens." : "Three benchmarks, three frontiers, normalized to their own distributions. Use the shape to see where they agree—not to compare points across benchmarks."}</p>
        </div>
        <a href="/methodology#task-cost" className="inline-flex shrink-0 items-center gap-1 text-[11px] text-accent hover:underline">How task cost is measured <ArrowUpRight className="h-3.5 w-3.5" /></a>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-surface/55">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div className="flex rounded-full border border-line bg-paper/70 p-1" aria-label="Frontier view">
            {(["meta", "ensemble"] as const).map((value) => (
              <button key={value} type="button" aria-pressed={mode === value} onClick={() => { setMode(value); setHoveredId(null); }} className={`focus-ring rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors ${mode === value ? "bg-ink text-paper" : "text-muted hover:text-ink"}`}>
                {value === "meta" ? "Meta frontier" : "Ensemble"}
              </button>
            ))}
          </div>
          {mode === "ensemble" ? (
            <span className="num text-[10px] text-muted">Descriptive · within-benchmark percentiles</span>
          ) : (
            <span className="num text-[10px] text-muted">
              {meta
                ? `${eligibleModels} in ${singleSelection ? "this benchmark" : "this basket"} · ${frontierCount} non-dominated · ${meta.excluded.length} outside this set`
                : activeSourceIds.length === 0
                  ? "Select a benchmark"
                  : "No eligible paired models"}
            </span>
          )}
        </div>

        {mode === "meta" && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 sm:px-5">
              <div className="flex flex-wrap gap-1" aria-label="Frontier category">
                {(["overall", ...CATEGORY_ORDER] as CostScope[]).map((value) => (
                  <button key={value} type="button" aria-pressed={scope === value} onClick={() => { setScope(value); setHoveredId(null); }} className={`focus-ring rounded-full border px-3 py-1.5 text-[11px] transition-colors ${scope === value ? "border-accent/30 bg-accent-soft text-accent-ink" : "border-transparent text-muted hover:border-line hover:text-ink"}`}>
                    {value === "overall" ? "Overall" : CATEGORY_COPY[value].label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted" />
                  <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Filter cost frontier models" placeholder="Find a model" className="focus-ring w-40 rounded-full border border-line bg-paper/70 py-1.5 pl-7 pr-3 text-[11px] outline-none placeholder:text-muted/60" />
                </label>
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted"><input type="checkbox" checked={frontierOnly} onChange={(event) => setFrontierOnly(event.target.checked)} className="accent-accent" />Frontier only</label>
              </div>
            </div>

            <div className="px-4 pb-3 pt-3 sm:px-5">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] uppercase tracking-[0.12em] text-muted">Benchmarks</span>
                  {scope === "overall" ? (
                    <>
                      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Select cost benchmarks">
                        {scopeSourceIds.map((id) => {
                          const isSelected = basketSourceIds.includes(id);
                          const sourceInfo = data.sources.find((item) => item.id === id);
                          const medianOnly = isMedianOnlySource(data, id);
                          return (
                            <button key={id} type="button" aria-pressed={isSelected} onClick={() => toggleBasketSource(id)}
                              title={`${sourceInfo?.shortName ?? id}: ${sourceInfo?.costCoverage.usableModels ?? 0} tracked models with usable task cost${medianOnly ? " · P50 is single-benchmark only" : ""}`}
                              className={`focus-ring inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${isSelected ? "border-accent/40 bg-accent-soft text-accent-ink" : "border-line bg-paper/60 text-muted hover:border-ink/30 hover:text-ink"}`}>
                              <span className={`flex h-3 w-3 items-center justify-center rounded-[3px] border ${isSelected ? "border-accent bg-accent text-paper" : "border-line bg-paper"}`}>
                                {isSelected && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                              </span>
                              {sourceInfo?.shortName ?? id}
                              {medianOnly && <span className="rounded-full border border-line px-1 py-0.5 text-[8px] uppercase tracking-[0.08em] text-muted">P50</span>}
                            </button>
                          );
                        })}
                      </div>
                      <span className="num text-[10px] text-muted">
                        {meta
                          ? `${basketName(meta.sourceIds)} · ${meta.points.length} models · ${frontierCount} non-dominated`
                          : scopeSourceIds.length === 0
                            ? "No usable task-cost benchmarks"
                            : "Select at least one benchmark"}
                      </span>
                      {!activeIsDefault && <button type="button" onClick={resetSelection} className="focus-ring text-[10px] text-accent hover:underline">Reset to {basketName(defaultSourceIds(data, "overall"))}</button>}
                    </>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-1.5">
                        {activeSourceIds.map((id) => <span key={id} className="rounded-full border border-line bg-paper/60 px-2.5 py-1 text-[11px] text-muted">{sourceName(data, id)}</span>)}
                      </div>
                      <span className="num text-[10px] text-muted">{meta ? `${meta.points.length} models · ${frontierCount} non-dominated` : "No eligible paired models"}</span>
                    </>
                  )}
                </div>
                <p className="mt-2 text-[10px] leading-5 text-muted/80">
                  {meta ? (
                    <>
                      <strong className="font-medium text-ink">One selection, one axis.</strong> {meta.points.length} of {data.trackedModelCount} tracked models have complete paired score and cost for {singleSelection ? "this benchmark" : "every selected benchmark"}; {meta.excluded.length} are outside this matched set.{" "}
                      {selectedIsMedian
                        ? `${activeBasketName} reports P50 median costs, so it is available only as a single-benchmark view and is never pooled with means.`
                        : singleSelection
                          ? "This benchmark uses its own reference and statistic; add mean-cost benchmarks to build a matched basket."
                          : scope === "overall"
                            ? `${noCostSources} sources have no usable task cost; ${medianOnlySources} report P50 only and stay out of mean-cost baskets.`
                            : "The category mapping fixes these sources; only mean-cost benchmarks enter this basket."}
                    </>
                  ) : view.kind === "invalid" && view.reason === "mixed-median" ? (
                    <>P50 benchmarks must be selected alone; they are never pooled with mean-cost sources.</>
                  ) : (
                    <>No tracked model has usable paired score and cost for this selection. Missing data is never treated as free. Add a benchmark or pick a larger basket from the coverage table below.</>
                  )}
                </p>
              </div>
            </div>
          </>
        )}

        {mode === "ensemble" ? (
          <EnsembleFrontier data={data} onSelectModel={onSelectModel} />
        ) : points.length ? (
          <div className="grid border-t border-line lg:grid-cols-[minmax(0,1fr)_270px]">
            <div className="min-w-0 overflow-x-auto px-2 pt-3 scrollbar-thin sm:px-4">
              <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width={WIDTH} height={HEIGHT} className="h-auto w-full min-w-[560px]" role="group" aria-labelledby={`${chartId}-title ${chartId}-description`}>
                <title id={`${chartId}-title`}>{`Meta Pareto frontier · ${activeBasketName}`}</title>
                <desc id={`${chartId}-description`}>Higher scores and lower costs are better. Highlighted points are not dominated by a cheaper, equally capable alternative within the selected benchmark or matched basket. Focus a point to inspect it; press Enter to open the model breakdown. The complete data is also available in the comparison table below.</desc>
                {scale.yTicks.map((value) => <g key={value}><line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={scale.y(value)} y2={scale.y(value)} stroke="var(--line)" strokeDasharray="3 5" /><text x={MARGIN.left - 12} y={scale.y(value) + 4} textAnchor="end" fill="var(--muted)" fontSize="11" className="num">{Math.round(value)}</text></g>)}
                {scale.xTicks.map((value) => <g key={value}><line x1={scale.x(value)} x2={scale.x(value)} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} stroke="var(--line)" strokeDasharray="3 5" /><text x={scale.x(value)} y={HEIGHT - MARGIN.bottom + 22} textAnchor="middle" fill="var(--muted)" fontSize="10" className="num">{formatCostIndex(value)}</text></g>)}
                <text x={MARGIN.left + 8} y={20} fill="var(--accent)" fontSize="10" letterSpacing="1.3">BETTER VALUE ↖</text>
                <path d={frontierPath} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="5 4" opacity="0.55" aria-hidden="true" />
                {[...visible].sort((a, b) => Number(a.frontier) - Number(b.frontier)).map((point) => (
                  <g key={point.id} role="button" tabIndex={0} aria-label={`${point.model.name}: ${yLabel} ${formatScoreOne(point.y)}, ${formatCostIndex(point.x)}${point.frontier ? ", Pareto frontier" : ", dominated"}. Open model details.`}
                    onMouseEnter={() => setHoveredId(point.id)} onFocus={() => setHoveredId(point.id)} onClick={() => onSelectModel(point.model.id)}
                    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectModel(point.model.id); } }} className="cursor-pointer outline-none frontier-point">
                    <title>{`${point.model.name} · ${formatCostIndex(point.x)} · ${formatScoreOne(point.y)}`}</title>
                    <circle cx={scale.x(point.x)} cy={scale.y(point.y)} r={20} fill="transparent" />
                    <circle cx={scale.x(point.x)} cy={scale.y(point.y)} r={12} fill="transparent" stroke={selected?.id === point.id ? "var(--accent)" : "transparent"} strokeWidth="1" className="frontier-focus" />
                    <circle cx={scale.x(point.x)} cy={scale.y(point.y)} r={point.frontier ? 6.5 : 4.5} fill={vendorTone(point.model.vendor)} opacity={point.frontier ? 1 : 0.5} stroke="var(--surface)" strokeWidth="2" />
                  </g>
                ))}
                {labels.map((label) => <text key={label.id} x={label.x} y={label.y} textAnchor={label.anchor as "start" | "end"} fill="var(--ink)" fontSize="10" className="pointer-events-none">{label.text}</text>)}
                <text x={(WIDTH + MARGIN.left - MARGIN.right) / 2} y={HEIGHT - 14} textAnchor="middle" fill="var(--muted)" fontSize="11">{xLabel}</text>
                <text transform={`translate(17 ${(HEIGHT + MARGIN.top - MARGIN.bottom) / 2}) rotate(-90)`} textAnchor="middle" fill="var(--muted)" fontSize="11">{yLabel}</text>
              </svg>
              {!visible.length && <p className="pb-4 text-center text-xs text-muted">No models match those filters. <button type="button" className="focus-ring text-accent hover:underline" onClick={() => { setQuery(""); setFrontierOnly(false); }}>Clear filters</button></p>}
            </div>
            <aside className="border-t border-line bg-paper/50 p-5 lg:border-l lg:border-t-0" aria-label="Inspected cost point">
              {selected?.meta && (
                <>
                  <div className="eyebrow mb-3">{selected.frontier ? (singleSelection ? "On this benchmark's frontier" : "On this basket's frontier") : "Paired observation"}</div>
                  <button type="button" className="focus-ring display block rounded-sm text-left text-2xl leading-tight hover:text-accent" onClick={() => onSelectModel(selected.model.id)}>{selected.model.name} <span className="text-sm text-muted">↗</span></button>
                  <p className="mt-1 text-[10px] text-muted">{selected.model.vendor}</p>
                  <div className="mt-4 grid grid-cols-2 gap-3 border-y border-line py-3">
                    <div><div className="text-[10px] text-muted">{yLabel}</div><div className="num mt-1 text-xl">{formatScoreOne(selected.y)}</div></div>
                    <div><div className="text-[10px] text-muted">Task-cost index</div><div className="num mt-1 text-xl">{formatCostIndex(selected.x)}</div></div>
                  </div>
                  <div className="mt-3 space-y-3">
                    {selected.meta.contributions.map((item) => {
                      const entry = selected.model.sources.find((entry) => entry.sourceId === item.sourceId);
                      return <div key={item.sourceId} className="text-[10px]">
                        <div className="flex justify-between gap-2">
                          <span className="text-muted">{data.sources.find((source) => source.id === item.sourceId)?.shortName} · {costStatisticLabel(item.statistic)}</span>
                          <span className="num">{formatUsd(item.costUsd)}/task</span>
                        </div>
                        <div className="mt-0.5 text-[9px] leading-4 text-muted/70">{[entry?.harness, entry?.variant].filter(Boolean).join(" · ") || entry?.rawName}</div>
                      </div>;
                    })}
                    <p className="border-t border-line pt-3 text-[10px] leading-5 text-muted">Matched {singleSelection ? "benchmark" : "basket"}: {basketName(selected.meta.contributions.map((item) => item.sourceId))}. Overall meta: {formatScoreOne(selected.model.overall)} ({selected.model.coverage.used}/{selected.model.coverage.total} sources). The chart uses only this selection, not that overall score.{selectedIsMedian ? " P50 costs are shown alone and are never pooled with means." : ""}</p>
                  </div>
                  <button type="button" onClick={() => onSelectModel(selected.model.id)} className="focus-ring mt-4 inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-[10px] text-accent hover:border-accent">Full cost audit trail <ArrowUpRight className="h-3 w-3" /></button>
                </>
              )}
            </aside>
          </div>
        ) : (
          <div className="border-t border-line px-5 py-14 text-center">
            <h3 className="display text-2xl">No verified paired task costs for this view.</h3>
            <p className="mx-auto mt-2 max-w-xl text-xs leading-6 text-muted">{activeSourceIds.length === 0 ? "Select at least one benchmark to build a cost view." : `No tracked model has complete paired score and cost for ${activeBasketName || "this selection"}. Missing data is never treated as free.`}</p>
            <p className="mt-2 text-[11px] text-muted">API prices, stale observations, incomplete runs and upper-bound costs do not enter this frontier.</p>
          </div>
        )}

        {mode === "meta" && (
          <>
            <div className="border-t border-line px-4 py-3 text-[10px] leading-5 text-muted sm:px-5">
              <p>1× is the median reference of the selected benchmark or basket—not $1/task. References are each benchmark's median measured task cost at its reported statistic, fixed at build time. Switching the selection changes both axes; different selections are never compared.</p>
              <p>Frontier status is calculated across all eligible points in the selected benchmark or basket; search only hides points. Single-benchmark views use the source's own statistic; P50 is never pooled with means.</p>
            </div>

            <details className="border-t border-line">
              <summary className="focus-ring cursor-pointer px-4 py-3 text-[11px] font-medium hover:text-accent sm:px-5">Compare measured models · {activeBasketName} ({visible.length})</summary>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px]">
                  <thead className="border-y border-line bg-wash/30 text-[10px] text-muted"><tr><th className="px-5 py-2 font-medium">Model</th><th className="px-3 py-2 text-right font-medium">{yLabel}</th><th className="px-3 py-2 text-right font-medium">Cost index</th>{singleSelection && <th className="px-3 py-2 text-right font-medium">$/task</th>}<th className="px-5 py-2 text-right font-medium">Pareto status</th></tr></thead>
                  <tbody>{visible.map((point) => <tr key={point.id} className="border-b border-line/60 last:border-0 hover:bg-wash/30" onMouseEnter={() => setHoveredId(point.id)}>
                    <td className="px-5 py-2.5"><button type="button" onClick={() => onSelectModel(point.model.id)} className="focus-ring rounded-sm text-left hover:text-accent">{point.model.name}<span className="mt-0.5 block text-[10px] text-muted">{point.model.vendor}</span></button></td>
                    <td className="num px-3 py-2.5 text-right">{formatScoreOne(point.y)}</td>
                    <td className="num whitespace-nowrap px-3 py-2.5 text-right">{formatCostIndex(point.x)}</td>
                    {singleSelection && <td className="num whitespace-nowrap px-3 py-2.5 text-right">{formatUsd(point.meta?.contributions[0]?.costUsd)}</td>}
                    <td className="px-5 py-2.5 text-right">{point.frontier ? <Badge tone="green">Frontier</Badge> : <span className="text-[10px] text-muted">Dominated</span>}</td>
                  </tr>)}</tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </div>

      <details className="mt-4 rounded-xl border border-line bg-surface/40">
        <summary className="focus-ring cursor-pointer px-4 py-3 text-[11px] font-medium hover:text-accent">Task-cost coverage · what is—and isn't—measured</summary>
        <div className="border-t border-line p-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-[11px] font-semibold">Matched baskets (overall)</h3>
            <span className="text-[10px] text-muted">Coverage, not a cross-basket ranking</span>
          </div>
          <div className="overflow-hidden rounded-lg border border-line">
            <table className="w-full text-left text-[11px]">
              <thead className="border-b border-line bg-wash/30 text-[10px] text-muted"><tr><th className="px-3 py-2 font-medium">Basket</th><th className="px-3 py-2 text-right font-medium">Models</th><th className="px-3 py-2 text-right font-medium">Non-dominated</th><th className="px-3 py-2 text-right font-medium">Status</th></tr></thead>
              <tbody>{data.costAnalysis.baskets.overall.map((basket) => {
                const basketView = data.costAnalysis.frontiers.overall[basket.id];
                const isDefault = basket.id === data.costAnalysis.defaultBasketId.overall;
                const isActive = scope === "overall" && basket.id === activeSelectionId;
                return <tr key={basket.id} className="border-b border-line/60 last:border-0 hover:bg-wash/30">
                  <td className="px-3 py-2"><button type="button" onClick={() => { setMode("meta"); setScope("overall"); setBasketSourceIds(basket.sourceIds); setHoveredId(null); }} className="focus-ring rounded-sm text-left hover:text-accent">{basketName(basket.sourceIds)}</button></td>
                  <td className="num px-3 py-2 text-right">{basketView.points.length}{basketView.points.length < 5 ? <span className="ml-1 text-[9px] text-muted">small</span> : null}</td>
                  <td className="num px-3 py-2 text-right">{basketView.points.filter((point) => point.frontier).length}</td>
                  <td className="px-3 py-2 text-right text-[10px] text-muted">{isActive ? <Badge tone="green">Active</Badge> : null}{isDefault ? <span className={`${isActive ? "ml-1" : ""} text-[9px] uppercase tracking-[0.08em]`}>default</span> : null}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.12em] text-muted">Single benchmark</span>
            {data.costAnalysis.singleSourceIds.overall.map((sourceId) => {
              const singleView = data.costAnalysis.singleSourceFrontiers.overall[sourceId];
              const medianOnly = isMedianOnlySource(data, sourceId);
              const isActive = scope === "overall" && activeSelectionId === sourceId;
              return <button key={sourceId} type="button" onClick={() => { setMode("meta"); setScope("overall"); setBasketSourceIds([sourceId]); setHoveredId(null); }} className={`focus-ring inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] transition-colors ${isActive ? "border-accent/40 bg-accent-soft text-accent-ink" : "border-line bg-paper/60 text-muted hover:border-ink/30 hover:text-ink"}`}>
                {sourceName(data, sourceId)} · {singleView.points.length} models
                {medianOnly && <span className="text-[8px] uppercase tracking-[0.08em]">P50</span>}
              </button>;
            })}
          </div>
          <p className="mt-2 text-[10px] leading-5 text-muted/70">A single benchmark uses its own reference and reported statistic; P50 sources are never pooled into a mean-cost basket. Select one from the benchmark picker above or here.</p>
        </div>
        <div className="grid gap-3 border-t border-line p-4 sm:grid-cols-2">
          {data.sources.map((source) => <div key={source.id} className="rounded-lg border border-line bg-paper/50 p-3">
            <div className="flex items-center justify-between gap-2 text-[11px]"><span className="font-medium">{source.shortName}</span><Badge>{source.costCoverage.status.replace("-", " ")}</Badge></div>
            <p className="mt-1.5 text-[10px] text-muted">{source.costCoverage.reportedEntries}/{source.entryCount} rows with task costs · {source.costCoverage.usableModels} usable tracked models{source.costCoverage.runTotalEntries > 0 ? ` · ${source.costCoverage.runTotalEntries} run totals (not $/task)` : ""}</p>
            <p className="mt-1 text-[10px] leading-5 text-muted/80">{source.costCoverage.note}</p>
          </div>)}
        </div>
      </details>
    </section>
  );
}
