import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search, SlidersHorizontal } from "lucide-react";
import type { Category, LeaderboardDataset, ModelRank } from "../../scripts/types";
import {
  CATEGORY_COPY,
  CATEGORY_ORDER,
  formatScore,
  rankAllModels,
  scoreTone,
} from "../lib/format";
import { Badge, CoverageMeter, ModelAvatar, ScorePill } from "./ui";
import ModelDetail from "./ModelDetail";
import CostFrontier from "./CostFrontier";

type Tab = "overall" | Category;
type SortMode = "rank" | "score" | "sources" | "name";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "overall", label: "Overall" },
  ...CATEGORY_ORDER.map((category) => ({ id: category, label: CATEGORY_COPY[category].label })),
];

function categoryTextClass(value: number | null): string {
  switch (scoreTone(value)) {
    case "high":
      return "text-emerald-700 dark:text-emerald-300";
    case "mid":
      return "text-amber-700 dark:text-amber-300";
    case "low":
      return "text-rose-700 dark:text-rose-300";
    default:
      return "text-muted/60";
  }
}

function activeScore(model: ModelRank, tab: Tab): number | null {
  return tab === "overall" ? model.overall : model.categories[tab].score;
}

function activeRank(model: ModelRank, tab: Tab): number | null {
  return tab === "overall" ? model.rank : model.categories[tab].rank;
}

function CategoryMini({ value, active }: { value: number | null; active?: boolean }) {
  return (
    <span
      className={`num text-[11px] ${active ? "font-semibold" : "font-medium"} ${categoryTextClass(value)}`}
    >
      {formatScore(value)}
    </span>
  );
}

export default function Leaderboard({ data }: { data: LeaderboardDataset }) {
  const [tab, setTab] = useState<Tab>("overall");
  const [query, setQuery] = useState("");
  const [vendor, setVendor] = useState("all");
  const [ignoreCoverageFloor, setIgnoreCoverageFloor] = useState(false);
  const [sort, setSort] = useState<SortMode>("rank");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const vendors = useMemo(
    () => [...new Set(data.models.map((model) => model.vendor))].sort((a, b) => a.localeCompare(b)),
    [data.models],
  );

  const tabCounts = useMemo(() => {
    const counts: Record<Tab, number> = {
      overall: data.models.filter((model) => model.status === "ranked").length,
      general: 0,
      coding: 0,
      agentic: 0,
      reasoning: 0,
    };
    for (const category of CATEGORY_ORDER) {
      counts[category] = data.models.filter((model) => model.categories[category].score !== null).length;
    }
    return counts;
  }, [data.models]);

  const allSourceIds = useMemo(() => data.sources.map((source) => source.id), [data.sources]);
  const allModelCount = useMemo(
    () => data.models.filter((model) => model.overall !== null).length,
    [data.models],
  );
  const allModelRanks = useMemo(
    () => (tab === "overall" && ignoreCoverageFloor ? rankAllModels(data.models) : null),
    [data.models, ignoreCoverageFloor, tab],
  );
  const rankFor = (model: ModelRank): number | null =>
    allModelRanks?.get(model.id) ?? activeRank(model, tab);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let rows =
      tab === "overall"
        ? data.models.filter(
            (model) => model.overall !== null && (model.status === "ranked" || ignoreCoverageFloor),
          )
        : data.models.filter((model) => model.categories[tab].score !== null);

    if (vendor !== "all") rows = rows.filter((model) => model.vendor === vendor);
    if (needle) {
      rows = rows.filter(
        (model) =>
          model.name.toLowerCase().includes(needle) ||
          model.vendor.toLowerCase().includes(needle),
      );
    }

    return [...rows].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "sources") {
        const aSources = tab === "overall" ? a.coverage.used : a.categories[tab].sources;
        const bSources = tab === "overall" ? b.coverage.used : b.categories[tab].sources;
        if (bSources !== aSources) return bSources - aSources;
        return (rankFor(a) ?? 999) - (rankFor(b) ?? 999);
      }
      if (sort === "score") {
        const aScore = activeScore(a, tab) ?? -1;
        const bScore = activeScore(b, tab) ?? -1;
        if (bScore !== aScore) return bScore - aScore;
        return (rankFor(a) ?? 999) - (rankFor(b) ?? 999);
      }
      const aRank = rankFor(a);
      const bRank = rankFor(b);
      if (aRank === null && bRank === null) return (b.overall ?? -1) - (a.overall ?? -1);
      if (aRank === null) return 1;
      if (bRank === null) return -1;
      if (aRank !== bRank) return aRank - bRank;
      return (b.overall ?? -1) - (a.overall ?? -1);
    });
  }, [data.models, ignoreCoverageFloor, allModelRanks, query, sort, tab, vendor]);

  const selectedModel = selectedId ? data.models.find((model) => model.id === selectedId) ?? null : null;
  const tabDescription =
    tab === "overall"
      ? ignoreCoverageFloor
        ? "All tracked models ranked by their available-source meta score. The five-source minimum is off; coverage varies."
        : "Equal-weight average of all ten source percentiles. Five sources are required for a rank."
      : CATEGORY_COPY[tab].description;
  const visibleCategories = tab === "overall" ? CATEGORY_ORDER : CATEGORY_ORDER.filter((category) => category !== tab);

  return (
    <>
      <section id="leaderboard" className="container-page pb-6 pt-4 sm:pb-10">
        <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <div className="eyebrow mb-2">The meta ranking</div>
            <h2 className="display text-4xl leading-none sm:text-5xl">Leaderboard</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
              Every benchmark is converted to a percentile within its own field, then averaged. Use
              the tabs to see how the ranking changes by use case.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted">
            <span className="flex h-2 w-2 rounded-full bg-accent"></span>
            <span>
              {tab === "overall" && ignoreCoverageFloor
                ? `${allModelCount} models · coverage floor off`
                : `${tabCounts[tab]} ${tab === "overall" ? "ranked models" : `${CATEGORY_COPY[tab].label.toLowerCase()} scores`}`}
            </span>
            <span className="text-line">·</span>
            <span>{data.sourceCount} sources</span>
          </div>
        </div>

        <div className="flex gap-1 overflow-x-auto border-b border-line pb-0 scrollbar-thin" role="tablist" aria-label="Ranking category">
          {TABS.map((item) => {
            const active = item.id === tab;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setTab(item.id);
                  setSort("rank");
                }}
                className={`focus-ring relative shrink-0 px-3 py-3 text-xs font-medium transition-colors sm:px-4 ${
                  active ? "text-ink" : "text-muted hover:text-ink"
                }`}
              >
                <span className="flex items-center gap-2">
                  {item.label}
                  <span className={`num text-[10px] ${active ? "text-accent" : "text-muted/50"}`}>
                    {item.id === "overall" && ignoreCoverageFloor ? allModelCount : tabCounts[item.id]}
                  </span>
                </span>
                {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="group relative min-w-[180px] flex-1 sm:max-w-[280px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted/60" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search model or vendor"
                className="focus-ring w-full rounded-full border border-line bg-surface/70 py-2 pl-9 pr-3 text-xs outline-none transition-colors placeholder:text-muted/60 hover:border-ink/30 focus:border-accent"
                aria-label="Search models"
              />
            </label>

            <label className="relative">
              <span className="sr-only">Filter by vendor</span>
              <select
                value={vendor}
                onChange={(event) => setVendor(event.target.value)}
                className="focus-ring appearance-none rounded-full border border-line bg-surface/70 py-2 pl-3 pr-8 text-xs text-muted outline-none transition-colors hover:border-ink/30"
              >
                <option value="all">All vendors</option>
                {vendors.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted/60" />
            </label>

            <label className="relative">
              <span className="sr-only">Sort leaderboard</span>
              <SlidersHorizontal className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted/60" />
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as SortMode)}
                className="focus-ring appearance-none rounded-full border border-line bg-surface/70 py-2 pl-8 pr-8 text-xs text-muted outline-none transition-colors hover:border-ink/30"
              >
                <option value="rank">
                  Sort: {tab === "overall" && ignoreCoverageFloor ? "all-model rank" : "rank"}
                </option>
                <option value="score">Sort: score</option>
                <option value="sources">Sort: source coverage</option>
                <option value="name">Sort: name</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted/60" />
            </label>

            <div
              className="flex items-center gap-2 text-[10px] text-muted"
              title="5+ sources requires five of ten benchmarks. All models ranks every tracked model by its available-source score."
            >
              <span>Overall coverage</span>
              <div className="flex rounded-full border border-line bg-paper/70 p-1" role="group" aria-label="Overall coverage floor">
                <button
                  type="button"
                  aria-pressed={!ignoreCoverageFloor}
                  onClick={() => setIgnoreCoverageFloor(false)}
                  className={`focus-ring rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${
                    !ignoreCoverageFloor ? "bg-ink text-paper" : "text-muted hover:text-ink"
                  }`}
                >
                  5+ sources
                </button>
                <button
                  type="button"
                  aria-pressed={ignoreCoverageFloor}
                  onClick={() => setIgnoreCoverageFloor(true)}
                  className={`focus-ring rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${
                    ignoreCoverageFloor ? "bg-ink text-paper" : "text-muted hover:text-ink"
                  }`}
                >
                  All models
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-between gap-1 text-[11px] text-muted sm:flex-row sm:items-center">
            <p>
              {filtered.length} {filtered.length === 1 ? "model" : "models"} · {tabDescription}
            </p>
            <span className="text-[10px] text-muted/60">Click a row for the audit trail</span>
          </div>
        </div>

        {tab !== "overall" && (
          <p className="mt-2 text-[11px] text-muted/70">
            Category rankings include models with at least two sources for that category, even if
            they do not have enough coverage for an overall rank.
          </p>
        )}

        <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-surface/50">
          <table className="hidden w-full table-fixed lg:table">
            <thead>
              <tr className="border-b border-line text-left text-[10px] uppercase tracking-[0.12em] text-muted">
                <th scope="col" className="w-14 px-4 py-3 font-medium">Rank</th>
                <th scope="col" className="px-2 py-3 font-medium">Model</th>
                <th scope="col" className="w-[86px] px-2 py-3 text-right font-medium">
                  {tab === "overall" ? "Meta" : CATEGORY_COPY[tab].label}
                </th>
                {visibleCategories.map((category) => (
                  <th
                    key={category}
                    scope="col"
                    className="w-[72px] px-2 py-3 text-right font-medium"
                  >
                    {CATEGORY_COPY[category].label}
                  </th>
                ))}
                <th scope="col" className="w-[108px] px-4 py-3 text-right font-medium">Coverage</th>
                <th scope="col" className="w-8 px-1 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((model) => {
                const score = activeScore(model, tab);
                const rank = rankFor(model);
                const isLimited = model.status !== "ranked";
                return (
                  <tr
                    key={model.id}
                    onClick={() => setSelectedId(model.id)}
                    className="group cursor-pointer border-b border-line/70 last:border-b-0 hover:bg-wash/35"
                  >
                    <td className="px-4 py-3 align-middle">
                      <span className={`num text-sm ${rank ? "text-ink" : "text-muted/50"}`}>
                        {rank ? rank : "—"}
                      </span>
                    </td>
                    <td className="px-2 py-3 align-middle">
                      <div className="flex min-w-0 items-center gap-3">
                        <ModelAvatar name={model.name} vendor={model.vendor} />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate text-sm font-medium">{model.name}</span>
                            {model.openWeights && <Badge tone="green">open</Badge>}
                            {isLimited && (
                              <span title={ignoreCoverageFloor ? "Fewer than 5 of 10 sources — ranked by available-source score" : "Fewer than 5 of 10 sources — no official overall rank"}>
                                <Badge>limited coverage</Badge>
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 truncate text-[10px] text-muted">
                            {model.vendor}
                            {model.releaseDate ? ` · ${model.releaseDate.slice(0, 7)}` : ""}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-3 text-right align-middle">
                      <div className="flex flex-col items-end gap-0.5">
                        <ScorePill value={score} muted={!rank} />
                        {tab !== "overall" && (
                          <span className="text-[9px] text-muted/60">{model.categories[tab].sources} src</span>
                        )}
                      </div>
                    </td>
                    {visibleCategories.map((category) => (
                      <td key={category} className="px-2 py-3 text-right align-middle">
                        <CategoryMini value={model.categories[category].score} />
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right align-middle">
                      <CoverageMeter model={model} allSourceIds={allSourceIds} compact />
                    </td>
                    <td className="px-1 py-3 text-right align-middle text-muted/40">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedId(model.id);
                        }}
                        className="focus-ring rounded-full p-1 transition-colors hover:text-accent"
                        aria-label={`Open details for ${model.name}`}
                      >
                        <ChevronRight className="ml-auto h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="divide-y divide-line lg:hidden">
            {filtered.map((model) => {
              const score = activeScore(model, tab);
              const rank = rankFor(model);
              const isLimited = model.status !== "ranked";
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => setSelectedId(model.id)}
                  className="block w-full px-4 py-4 text-left transition-colors hover:bg-wash/35 focus-ring"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="num w-6 shrink-0 text-sm text-muted">{rank ?? "—"}</span>
                      <ModelAvatar name={model.name} vendor={model.vendor} size="sm" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{model.name}</div>
                        <div className="mt-0.5 text-[10px] text-muted">
                          {model.vendor}
                          {isLimited ? " · limited coverage" : ""}
                        </div>
                      </div>
                    </div>
                    <ScorePill value={score} muted={!rank} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 pl-8">
                    {CATEGORY_ORDER.map((category) => (
                      <span key={category} className="inline-flex items-baseline gap-1 text-[10px] text-muted">
                        <span className="text-muted/60">{CATEGORY_COPY[category].label.slice(0, 3)}</span>
                        <CategoryMini value={model.categories[category].score} active={category === tab} />
                      </span>
                    ))}
                    <span className="ml-auto">
                      <CoverageMeter model={model} allSourceIds={allSourceIds} compact />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {filtered.length === 0 && (
            <div className="px-6 py-16 text-center">
              <div className="display text-2xl">No models match those filters.</div>
              <p className="mt-2 text-xs text-muted">Try clearing the search or switching to another category.</p>
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setVendor("all");
                }}
                className="focus-ring mt-4 rounded-full border border-line px-4 py-2 text-xs text-muted transition-colors hover:border-ink hover:text-ink"
              >
                Reset filters
              </button>
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-col justify-between gap-2 text-[10px] text-muted/70 sm:flex-row sm:items-center">
          <p>
            Click any row for the benchmark audit trail. Raw scores are kept separate; the meta score
            is a relative percentile average.
          </p>
          <a href="/methodology" className="inline-flex items-center gap-1 text-accent hover:underline">
            Read the methodology
            <ChevronRight className="h-3 w-3" />
          </a>
        </div>
      </section>

      <CostFrontier data={data} onSelectModel={setSelectedId} />
      <ModelDetail model={selectedModel} data={data} onClose={() => setSelectedId(null)} />
    </>
  );
}
