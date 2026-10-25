import { useId, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { benchmarkModelPoints, currentCostSource, type BenchmarkModelPoint } from "../../scripts/costs";
import type { DatasetSource, LeaderboardDataset } from "../../scripts/types";
import {
  costStatisticLabel,
  formatCostIndex,
  formatPercentile,
  formatScoreOne,
  formatTaskCost,
} from "../lib/format";
import {
  HEIGHT,
  MARGIN,
  WIDTH,
  percentileScale,
  pointLabels,
  type PlotPoint,
} from "../lib/frontier-chart";
import { Badge } from "./ui";

interface EnsembleCurve {
  source: DatasetSource;
  points: BenchmarkModelPoint[];
}

interface MembershipRow {
  modelId: string;
  frontierSources: Set<string>;
  measuredSources: Set<string>;
}

function stepFrontier(points: BenchmarkModelPoint[], costPercentile: number): number {
  if (!points.length) return 0;
  if (costPercentile < points[0].costPercentile) return points[0].scorePercentile;
  let value = points[0].scorePercentile;
  for (const point of points) {
    if (point.costPercentile > costPercentile) break;
    value = point.scorePercentile;
  }
  return value;
}

function buildBandPath(curves: EnsembleCurve[], x: (value: number) => number, y: (value: number) => number): string {
  const frontierCurves = curves
    .map((curve) => curve.points.filter((point) => point.frontier).sort((a, b) => a.costPercentile - b.costPercentile))
    .filter((points) => points.length > 0);
  if (frontierCurves.length < 2) return "";
  const samples = [...new Set([0, 100, ...frontierCurves.flatMap((points) => points.map((point) => point.costPercentile))])]
    .sort((a, b) => a - b);
  const rows = samples.map((costPercentile) => {
    const values = frontierCurves.map((points) => stepFrontier(points, costPercentile));
    return { costPercentile, min: Math.min(...values), max: Math.max(...values) };
  });
  const top = rows.map((row, index) => `${index === 0 ? `M ${x(row.costPercentile)} ${y(row.max)}` : `H ${x(row.costPercentile)} V ${y(row.max)}`}`).join(" ");
  const bottom = [...rows].reverse().map((row, index) => `${index === 0 ? `L ${x(row.costPercentile)} ${y(row.min)}` : `H ${x(row.costPercentile)} V ${y(row.min)}`}`).join(" ");
  return `${top} ${bottom} Z`;
}

function curvePath(points: BenchmarkModelPoint[], x: (value: number) => number, y: (value: number) => number): string {
  const frontier = points.filter((point) => point.frontier).sort((a, b) => a.costPercentile - b.costPercentile);
  return frontier.map((point, index) => `${index === 0 ? "M" : "H"} ${x(point.costPercentile)}${index === 0 ? " " : " V "}${y(point.scorePercentile)}`).join(" ");
}

function pointTitle(point: BenchmarkModelPoint): string {
  const multiple = point.costMultiple !== undefined
    ? `${formatCostIndex(point.costMultiple)} benchmark median`
    : "relative cost unavailable";
  return `${formatPercentile(point.scorePercentile)} score percentile · ${formatPercentile(point.costPercentile)} cost percentile · ${multiple} · ${formatTaskCost(point.cost)}`;
}

export default function EnsembleFrontier({ data, onSelectModel }: { data: LeaderboardDataset; onSelectModel: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [sharedOnly, setSharedOnly] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const chartId = useId();
  const modelById = useMemo(() => new Map(data.models.map((model) => [model.id, model])), [data.models]);

  const curves = useMemo<EnsembleCurve[]>(() => {
    return data.sources
      .filter((source) =>
        currentCostSource(source) &&
        source.costMethodology?.statistic &&
        source.costMethodology.statistic !== "median" &&
        source.costCoverage.usableModels > 0,
      )
      .map((source) => {
        const reference = data.costAnalysis.baselines.find((baseline) =>
          baseline.sourceId === source.id && baseline.metric === "overall" &&
          baseline.statistic === source.costMethodology?.statistic)?.usd
          ?? data.costAnalysis.baselines.find((baseline) =>
            baseline.sourceId === source.id && baseline.metric === "overall" && baseline.statistic !== "median")?.usd;
        return { source, points: benchmarkModelPoints(data.models, source, reference) };
      })
      .filter((curve) => curve.points.length > 0);
  }, [data]);

  const sources = useMemo(() => curves.map((curve) => curve.source), [curves]);
  const sourceById = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources]);

  const membership = useMemo(() => {
    const rows = new Map<string, MembershipRow>();
    for (const curve of curves) {
      for (const point of curve.points) {
        const row = rows.get(point.modelId) ?? {
          modelId: point.modelId,
          frontierSources: new Set<string>(),
          measuredSources: new Set<string>(),
        };
        row.measuredSources.add(curve.source.id);
        if (point.frontier) row.frontierSources.add(curve.source.id);
        rows.set(point.modelId, row);
      }
    }
    return rows;
  }, [curves]);

  const membershipRows = useMemo(() => {
    return [...membership.values()]
      .filter((row) => row.frontierSources.size > 0)
      .sort((a, b) => {
        if (a.frontierSources.size !== b.frontierSources.size) return b.frontierSources.size - a.frontierSources.size;
        if (a.measuredSources.size !== b.measuredSources.size) return b.measuredSources.size - a.measuredSources.size;
        const aModel = modelById.get(a.modelId);
        const bModel = modelById.get(b.modelId);
        const aRank = aModel?.rank ?? Number.POSITIVE_INFINITY;
        const bRank = bModel?.rank ?? Number.POSITIVE_INFINITY;
        if (aRank !== bRank) return aRank - bRank;
        return (aModel?.name ?? a.modelId).localeCompare(bModel?.name ?? b.modelId);
      });
  }, [membership, modelById]);

  const pointBySourceModel = useMemo(() => {
    const index = new Map<string, BenchmarkModelPoint>();
    for (const curve of curves) {
      for (const point of curve.points) index.set(`${curve.source.id}:${point.modelId}`, point);
    }
    return index;
  }, [curves]);

  const frontierPoints = useMemo(
    () => curves.flatMap((curve) => curve.points.filter((point) => point.frontier)),
    [curves],
  );

  const visiblePoints = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return frontierPoints.filter((point) => {
      const model = modelById.get(point.modelId);
      if (!model) return false;
      if (needle && !`${model.name} ${model.vendor}`.toLowerCase().includes(needle)) return false;
      if (sharedOnly && (membership.get(point.modelId)?.frontierSources.size ?? 0) < 2) return false;
      return true;
    });
  }, [frontierPoints, membership, modelById, query, sharedOnly]);

  const visiblePlotPoints = useMemo<PlotPoint[]>(() => visiblePoints.flatMap((point) => {
    const model = modelById.get(point.modelId);
    return model ? [{ id: point.id, model, x: point.costPercentile, y: point.scorePercentile, frontier: true, ensemble: point }] : [];
  }), [modelById, visiblePoints]);

  const selected = visiblePlotPoints.find((point) => point.id === hoveredId) ?? [...visiblePlotPoints].sort((a, b) => {
    const aCount = membership.get(a.model.id)?.frontierSources.size ?? 0;
    const bCount = membership.get(b.model.id)?.frontierSources.size ?? 0;
    return bCount - aCount || b.y - a.y;
  })[0];
  const selectedModelId = selected?.model.id;
  const labelPoints = useMemo(() => {
    const byModel = new Map<string, PlotPoint>();
    for (const point of visiblePlotPoints) {
      const frontierCount = membership.get(point.model.id)?.frontierSources.size ?? 0;
      if (frontierCount < 2 && point.model.id !== selectedModelId) continue;
      const current = byModel.get(point.model.id);
      if (!current || point.y > current.y) byModel.set(point.model.id, point);
    }
    return [...byModel.values()];
  }, [membership, selectedModelId, visiblePlotPoints]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return membershipRows.filter((row) => {
      const model = modelById.get(row.modelId);
      if (!model) return false;
      if (needle && !`${model.name} ${model.vendor}`.toLowerCase().includes(needle)) return false;
      if (sharedOnly && row.frontierSources.size < 2) return false;
      return true;
    });
  }, [membershipRows, modelById, query, sharedOnly]);

  const scale = percentileScale();
  const labels = pointLabels(labelPoints, scale.x, scale.y);
  const bandPath = buildBandPath(curves, scale.x, scale.y);
  const sharedCount = membershipRows.filter((row) => row.frontierSources.size === sources.length).length;
  const selectedMembership = selected ? membership.get(selected.model.id) : undefined;
  const selectedEnsemble = selected?.ensemble;
  const selectedSource = selectedEnsemble ? sourceById.get(selectedEnsemble.sourceId) : undefined;
  const selectedRunDetail = selectedEnsemble
    ? [selectedEnsemble.entry.harness, selectedEnsemble.entry.variant]
      .filter((value): value is string => typeof value === "string" && Boolean(value) && !selectedEnsemble.entry.rawName.includes(value))
      .join(" · ")
    : "";
  const otherFrontierSources = selectedMembership && selectedEnsemble
    ? sources.filter((source) => source.id !== selectedEnsemble.sourceId && selectedMembership.frontierSources.has(source.id))
    : [];

  if (!curves.length) {
    return (
      <div className="border-t border-line px-5 py-14 text-center">
        <h3 className="display text-2xl">No benchmark frontiers available.</h3>
        <p className="mx-auto mt-2 max-w-xl text-xs leading-6 text-muted">No benchmark currently has usable paired mean task costs. Median-cost benchmarks remain available as single-benchmark views in the meta frontier.</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="num text-[10px] text-muted">{sources.length} benchmarks · {membershipRows.length} frontier members · {sharedCount} shared</span>
          <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted">
            {sources.map((source) => (
              <span key={source.id} className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: source.accent }} />
                {source.shortName}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-4 rounded-sm bg-ink/10" />
              Range across benchmarks
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted" />
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Filter ensemble models" placeholder="Find a model" className="focus-ring w-40 rounded-full border border-line bg-paper/70 py-1.5 pl-7 pr-3 text-[11px] outline-none placeholder:text-muted/60" />
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted">
            <input type="checkbox" checked={sharedOnly} onChange={(event) => setSharedOnly(event.target.checked)} className="accent-accent" />
            2+ frontiers
          </label>
        </div>
      </div>

      <p className="px-4 pt-3 text-[10px] leading-5 text-muted/80 sm:px-5">
        Each line is one benchmark's own frontier. Both axes are percentiles within that benchmark, so the curves are comparable in shape, not in absolute score or dollars. The band is the range across benchmarks—not a confidence interval. A point on one curve is not a cross-benchmark dominance claim.
      </p>

      <div className="grid border-t border-line lg:grid-cols-[minmax(0,1fr)_270px]">
        <div className="min-w-0 overflow-x-auto px-2 pt-3 scrollbar-thin sm:px-4">
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width={WIDTH} height={HEIGHT} className="h-auto w-full min-w-[560px]" role="group" aria-labelledby={`${chartId}-title ${chartId}-description`}>
            <title id={`${chartId}-title`}>Benchmark frontier ensemble</title>
            <desc id={`${chartId}-description`}>Each line is the non-dominated frontier within one benchmark. Both axes are percentiles within that benchmark. A point on one curve is not directly comparable to a point on another. Focus a point to inspect it; press Enter to open the model breakdown.</desc>
            {scale.yTicks.map((value) => <g key={value}><line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={scale.y(value)} y2={scale.y(value)} stroke="var(--line)" strokeDasharray="3 5" /><text x={MARGIN.left - 12} y={scale.y(value) + 4} textAnchor="end" fill="var(--muted)" fontSize="11" className="num">{value}</text></g>)}
            {scale.xTicks.map((value) => <g key={value}><line x1={scale.x(value)} x2={scale.x(value)} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} stroke="var(--line)" strokeDasharray="3 5" /><text x={scale.x(value)} y={HEIGHT - MARGIN.bottom + 22} textAnchor="middle" fill="var(--muted)" fontSize="10" className="num">{value}</text></g>)}
            <text x={MARGIN.left + 8} y={20} fill="var(--accent)" fontSize="10" letterSpacing="1.3">BETTER VALUE ↖</text>
            {bandPath && <path d={bandPath} fill="var(--muted)" opacity="0.08" aria-hidden="true" />}
            {curves.map((curve) => (
              <path key={curve.source.id} d={curvePath(curve.points, scale.x, scale.y)} fill="none" stroke={curve.source.accent} strokeWidth="1.6" opacity="0.85" aria-hidden="true" />
            ))}
            {visiblePlotPoints.map((point) => {
              const ensemble = point.ensemble;
              const source = ensemble ? sourceById.get(ensemble.sourceId) : undefined;
              if (!ensemble || !source) return null;
              const isSelectedModel = selected?.model.id === point.model.id;
              return (
                <g key={point.id} role="button" tabIndex={0} aria-label={`${point.model.name} on ${source.shortName}: ${formatPercentile(ensemble.scorePercentile)} score percentile, ${formatPercentile(ensemble.costPercentile)} cost percentile, Pareto frontier. Open model details.`}
                  onMouseEnter={() => setHoveredId(point.id)} onFocus={() => setHoveredId(point.id)} onClick={() => onSelectModel(point.model.id)}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectModel(point.model.id); } }} className="cursor-pointer outline-none frontier-point">
                  <title>{`${point.model.name} · ${source.shortName} · ${pointTitle(ensemble)}`}</title>
                  <circle cx={scale.x(point.x)} cy={scale.y(point.y)} r={20} fill="transparent" />
                  {isSelectedModel && <circle cx={scale.x(point.x)} cy={scale.y(point.y)} r={10} fill="transparent" stroke={source.accent} strokeWidth={1} opacity={0.7} />}
                  <circle cx={scale.x(point.x)} cy={scale.y(point.y)} r={12} fill="transparent" stroke={selected?.id === point.id ? "var(--ink)" : "transparent"} strokeWidth="1" className="frontier-focus" />
                  <circle cx={scale.x(point.x)} cy={scale.y(point.y)} r={isSelectedModel ? 6.5 : 5} fill={source.accent} stroke="var(--surface)" strokeWidth="2" />
                </g>
              );
            })}
            {labels.map((label) => <text key={label.id} x={label.x} y={label.y} textAnchor={label.anchor as "start" | "end"} fill="var(--ink)" fontSize="10" className="pointer-events-none">{label.text}</text>)}
            <text x={(WIDTH + MARGIN.left - MARGIN.right) / 2} y={HEIGHT - 14} textAnchor="middle" fill="var(--muted)" fontSize="11">Cost percentile within benchmark · cheaper ←</text>
            <text transform={`translate(17 ${(HEIGHT + MARGIN.top - MARGIN.bottom) / 2}) rotate(-90)`} textAnchor="middle" fill="var(--muted)" fontSize="11">Score percentile within benchmark</text>
          </svg>
          {!visiblePlotPoints.length && <p className="pb-4 text-center text-xs text-muted">No frontier members match those filters. <button type="button" className="focus-ring text-accent hover:underline" onClick={() => { setQuery(""); setSharedOnly(false); }}>Clear filters</button></p>}
        </div>
        <aside className="border-t border-line bg-paper/50 p-5 lg:border-l lg:border-t-0" aria-label="Inspected ensemble point">
          {selected && selectedEnsemble && selectedSource ? (
            <>
              <div className="eyebrow mb-3">On the {selectedSource.shortName} frontier</div>
              <button type="button" className="focus-ring display block rounded-sm text-left text-2xl leading-tight hover:text-accent" onClick={() => onSelectModel(selected.model.id)}>{selected.model.name} <span className="text-sm text-muted">↗</span></button>
              <p className="mt-1 text-[10px] text-muted">{selected.model.vendor}</p>
              <div className="mt-4 grid grid-cols-2 gap-3 border-y border-line py-3">
                <div><div className="text-[10px] text-muted">Score percentile</div><div className="num mt-1 text-xl">{formatScoreOne(selectedEnsemble.scorePercentile)}</div></div>
                <div><div className="text-[10px] text-muted">Cost percentile</div><div className="num mt-1 text-xl">{formatScoreOne(selectedEnsemble.costPercentile)}</div></div>
              </div>
              <div className="mt-3 space-y-1.5 text-[10px] leading-5 text-muted">
                <p className="flex justify-between gap-2"><span>{selectedSource.metricLabel}</span><span className="num text-ink">{formatScoreOne(selectedEnsemble.entry.score)}</span></p>
                <p className="flex justify-between gap-2"><span>Task cost</span><span className="num text-ink">{formatTaskCost(selectedEnsemble.cost)}</span></p>
                <p className="flex justify-between gap-2"><span>Relative to median</span><span className="num text-ink">{selectedEnsemble.costMultiple !== undefined ? formatCostIndex(selectedEnsemble.costMultiple) : "—"}</span></p>
                <p className="flex justify-between gap-2"><span>Frontier</span><span className="num text-ink">{selectedMembership?.frontierSources.size ?? 0}/{selectedMembership?.measuredSources.size ?? 0} measured</span></p>
              </div>
              <p className="mt-3 border-t border-line pt-3 text-[10px] leading-5 text-muted">
                {otherFrontierSources.length
                  ? `Also on the frontier: ${otherFrontierSources.map((source) => source.shortName).join(", ")}.`
                  : "Only on this benchmark's frontier."}
              </p>
              <p className="mt-2 text-[10px] leading-5 text-muted/70">{selectedEnsemble.entry.rawName}</p>
              {selectedRunDetail && <p className="mt-1 text-[10px] leading-5 text-muted/70">{selectedRunDetail}</p>}
              <p className="mt-1 text-[10px] leading-5 text-muted/70">{costStatisticLabel(selectedEnsemble.cost.statistic)} · <a href={selectedEnsemble.cost.sourceUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">Original cost data ↗</a></p>
              <button type="button" onClick={() => onSelectModel(selected.model.id)} className="focus-ring mt-4 inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-[10px] text-accent hover:border-accent">Full cost audit trail ↗</button>
            </>
          ) : (
            <p className="text-xs leading-6 text-muted">Hover a frontier point to inspect its benchmark position.</p>
          )}
        </aside>
      </div>

      <div className="border-t border-line px-4 py-3 text-[10px] leading-5 text-muted sm:px-5">
        <p>Best-score configuration per model. Alternate harness/effort runs remain in the source data for audit but are not plotted. Median-cost benchmarks are available as single-benchmark views and are not mixed into this ensemble.</p>
        <p>Within-benchmark dominance only. Search and the 2+ filter narrow the points and table rows, not the curves; percentile references are fixed at build time.</p>
      </div>

      <details className="border-t border-line">
        <summary className="focus-ring cursor-pointer px-4 py-3 text-[11px] font-medium hover:text-accent sm:px-5">
          Frontier membership ({filteredRows.length}{filteredRows.length !== membershipRows.length ? ` of ${membershipRows.length}` : ""} models)
        </summary>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="border-y border-line bg-wash/30 text-[10px] text-muted">
              <tr>
                <th className="px-5 py-2 font-medium">Model</th>
                {sources.map((source) => (
                  <th key={source.id} className="px-3 py-2 text-center font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: source.accent }} />
                      {source.shortName}
                    </span>
                  </th>
                ))}
                <th className="px-5 py-2 text-right font-medium" title="Benchmarks where the model is on the frontier / benchmarks it measured">Frontier</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const model = modelById.get(row.modelId);
                return (
                  <tr key={row.modelId} className="border-b border-line/60 last:border-0 hover:bg-wash/30">
                    <td className="px-5 py-2.5">
                      <button type="button" onClick={() => onSelectModel(row.modelId)} className="focus-ring rounded-sm text-left hover:text-accent">{model?.name ?? row.modelId}</button>
                      {model && <span className="mt-0.5 block text-[10px] text-muted">{model.vendor}</span>}
                    </td>
                    {sources.map((source) => {
                      const point = pointBySourceModel.get(`${source.id}:${row.modelId}`);
                      if (!point) return <td key={source.id} className="px-3 py-2.5 text-center text-muted/30" title="Not measured" aria-label="Not measured">—</td>;
                      if (row.frontierSources.has(source.id)) {
                        return (
                          <td key={source.id} className="px-3 py-2.5 text-center" title={pointTitle(point)}>
                            <span role="img" className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold" style={{ backgroundColor: `${source.accent}18`, color: source.accent }} aria-label={`On ${source.shortName} frontier`}>✓</span>
                          </td>
                        );
                      }
                      return <td key={source.id} className="px-3 py-2.5 text-center text-muted/70" title={`Eligible, dominated · ${formatPercentile(point.scorePercentile)} score percentile`} aria-label="Eligible but dominated">·</td>;
                    })}
                    <td className="px-5 py-2.5 text-right">
                      <Badge tone={row.frontierSources.size === sources.length ? "green" : row.frontierSources.size >= 2 ? "accent" : "neutral"}>{row.frontierSources.size}/{row.measuredSources.size}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!filteredRows.length && <p className="px-5 py-6 text-center text-xs text-muted">No frontier members match those filters.</p>}
        </div>
        <p className="border-t border-line px-4 py-3 text-[10px] leading-5 text-muted sm:px-5">✓ on frontier · · eligible but dominated · — not measured. Counts are frontier / measured benchmarks. Only models on at least one frontier are shown.</p>
      </details>
    </>
  );
}
