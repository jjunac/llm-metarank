# LLM MetaRank

A Metacritic-style meta ranking for large language models, built from ten independent benchmark
leaderboards. Each source is converted to a percentile within its own model pool, then combined into
one relative score. The site is pre-rendered with Astro and has no backend.

## What is here

- **Overall ranking** across ten sources, plus **General**, **Coding**, **Agentic**, and **Reasoning**
  views.
- **Coverage-gated ranks**: a model needs at least 5 of 10 sources, including one general and one
  coding source, to receive an official overall rank. Category ranks require at least 2 sources.
  The leaderboard defaults to ranking all tracked models by available-source score; those ranks are
  not official and coverage varies. Switching to 5+ sources shows only official overall ranks.
- **Audit trail**: every model row opens a breakdown with raw score, percentile, rank, harness /
  variant, data date, and source link.
- **Source status**: data date, row counts, and stale-source warnings are visible on the page.
- **Task-cost Pareto frontier**: benchmark-run cost per task, single-benchmark views, a
  matched-benchmark meta cost index, and category views.
- **Static site**: `astro build` produces `dist/` with pre-rendered HTML. The leaderboard is hydrated
  as a React island for tabs, filtering, sorting, and the detail drawer.

## Sources

| Source | Category | Data |
|---|---|---|
| Artificial Analysis Intelligence Index | General, Reasoning | Composite index |
| LiveBench 2.0 | General, Coding, Agentic, Reasoning | Composite with category sub-scores |
| LMArena Text Arena | General | Human preference Elo |
| SWE-bench Pro V2 | Coding | Resolve score |
| Terminal-Bench 4.0 | Coding, Agentic | Resolution rate |
| Humanity's Last Exam | General, Reasoning | Accuracy |
| GSO | Coding | Software optimization score |
| ARC-AGI-3 | Agentic, Reasoning | Interactive environment score |
| Code Arena — WebDev | Coding | Human preference Elo |
| MCP Atlas | Agentic | Tool-use / MCP score |

See `/methodology` for category mappings, coverage rules, and caveats.

## Commands

```bash
npm install
npx playwright install chromium   # full Chromium needed for the LMArena / Code Arena fetchers

npm run data:refresh              # fetch all sources, write snapshots, rebuild data/leaderboard.json
npm run data:build                # rebuild data/leaderboard.json from existing snapshots
npm run data:refresh -- --only=livebench
npm run data:refresh -- --fetch-only

npm run data:check                # validate the dataset, coverage, ranks, and snapshots
npm run data:review               # show unmapped model names per source
npm run dev                       # local Astro dev server
npm run build                     # static build in dist/
npm run preview                   # preview the static build
npm run check                     # typecheck + tests + data validation + build
```

## How the score works

Each source is reduced to one score per tracked model (best reported variant for that source). The
model's score is converted to a percentile using the midrank formula:

```text
percentile(s, m) = 100 × (# scores below m + 0.5 × # ties) / N_s
```

The overall meta score is an equal-weight average of the available source percentiles:

```text
meta(m) = Σ w_s × percentile(s, m) / Σ w_s
```

- Each of the 10 sources has weight `1.0`.
- Missing sources are not imputed.
- A model needs 5+ sources, with at least one general and one coding source, for an overall rank.
- Category scores use only sources tagged for that category and require 2+ sources.
- Artificial Analysis and LiveBench are composites; each is counted once in the overall score.
- Coding and agentic results often use a model + harness. The best reported harness is used and
  shown in the breakdown.

The meta score is relative to the tracked model pool. It is not an absolute capability measure, a
product recommendation, or a cost/value score.

## Task costs and the meta Pareto frontier

Costs stay separate from capability ranks. The matched-basket view computes a separate frontier for
every supported combination of mean-cost sources. The default overall basket is currently
**LiveBench + Terminal-Bench**, the largest eligible set at build time. Artificial Analysis v5.0
scores are collected, but its costs are excluded until the new methodology is audited; v4.3.2 costs
are not reused with newer scores. A model needs usable paired score/cost observations for every
source in the selected basket. The overall view also supports a single benchmark, including
P50-only Arena sources; median costs are never pooled into a multi-source basket. Category views
use their available sources, falling back to a single benchmark when a matched basket is unavailable.
The Y-axis is a percentile average over the same selected sources, not the ten-source overall score.

```text
reference(s) = median usable task cost of the tracked best-score runs for source s
               (matching the source's reported statistic)
cost_index(m, b) = exp(Σ_{s∈b} w_s × log(cost_per_task(s,m) / reference(s)) / Σ_{s∈b} w_s)
```

The X-axis is a dimensionless relative cost on a log scale: **1× does not mean $1/task**.
References are fixed at build time. Switching the selection changes the reference set and both
axes; points from different selections are never plotted or ranked against each other. Actual
$/task, statistic, calculation, retrieval date, source link, and evaluated setup are in the model
breakdown. Single-benchmark views show actual $/task in the side panel and comparison table; they
use each model's best-score configuration, and alternate configurations remain in the source data
for audit but are not plotted.

| Overall basket | Eligible models | Non-dominated |
|---|---:|---:|
| LiveBench + Terminal-Bench (default) | 12 | 5 |

The counts above reflect the current dataset; `npm run data:check` prints the same table. In addition,
the overall view can show any single cost-bearing benchmark on its own; these single-benchmark
frontiers are not eligible for the multi-source basket table above.

| Source | Collected task-cost evidence |
|---|---|
| Artificial Analysis | Source's weighted task-cost calculation: recorded usage, cache rates/prices, reasoning/answer usage, fallback usage, task counts and evaluation weights. Audited for Index v4.3.2; unknown versions fail closed. |
| LiveBench | Same-release `cost.csv`, joined by exact model identifier. Total spend ÷ task count; category costs use their own tasks. Missing/ambiguous rows and partial overall suite scoring are not imputed. |
| Terminal-Bench | `total_cost_usd / n_trials`, including repeated and failed attempts, not just unique or successful tasks. |
| Arena Text / WebDev | Playwright-read `Cost/Task (P50)`. Medians stay in single-benchmark views and are never pooled with mean-cost baskets. Cloudflare/browser failures retain the last good score snapshot without inventing costs. |
| ARC-AGI-3 | Run totals retained separately. No $/task conversion without verified per-run denominators/completeness; currently excluded. |
| SWE-bench Pro, Scale HLE, MCP Atlas, GSO | No matching monetary task costs in the inspected public payloads; unknown, never inferred from token pricing, budgets, time or turns. |

The separate **benchmark frontier ensemble** overlays each benchmark's own frontier in
within-benchmark score and cost percentiles. It is descriptive: the axes are relative to each
benchmark's own pool, so a point on one curve is not a cross-benchmark dominance claim, and the
band is a range across benchmarks rather than a confidence interval. It is a separate tab, not a
decomposition of the matched frontier: a model can be non-dominated in a basket without being on
any single benchmark's frontier, and a model can be on several benchmark frontiers without complete
paired coverage for a chosen basket. Median-cost benchmarks are excluded from this ensemble and are
available as single-benchmark views instead.

The matched frontier uses each source's existing best-score setup and its **same-run** cost. It never
pairs the highest score with the cheapest effort. Missing, stale, incomplete, zero/log-ineligible,
and upper-bound observations cannot establish membership. A point is on the Pareto frontier when
no other eligible point in the same selection is at least as good and no more expensive, with one
strict improvement. These point-estimate comparisons do not imply statistically significant
dominance. Published spend may omit sandbox, tool, helper, infrastructure or judging costs;
source-specific caveats are retained.

## Project layout

```text
data/
  sources.json              # source metadata and category mapping
  models.json               # canonical model registry + aliases
  snapshots/<source>/       # dated raw snapshots + latest.json
  leaderboard.json          # generated site dataset
public/
  vendors/                  # vendored vendor marks + attribution
scripts/
  fetch/                    # one fetcher per source
  parse/                    # source-specific parsers
  normalize/                # model-name normalization and registry matching
  build-dataset.ts          # percentiles, coverage, category scores, ranks
  costs.ts                  # matched-basket + single-benchmark frontiers, fixed references, strict Pareto dominance
  refresh.ts                # fetch all sources and rebuild
  check-data.ts             # dataset validation
  review-models.ts          # unmapped-name report
src/
  pages/index.astro         # pre-rendered landing page
  pages/methodology.astro   # methodology
  components/Leaderboard.tsx
  components/ModelDetail.tsx
  components/CostFrontier.tsx
  components/EnsembleFrontier.tsx
  components/TaskCostDetail.tsx
  components/ui.tsx
  lib/                      # dataset loader, cost-view resolver, vendor marks, formatting
  styles/global.css         # Tailwind v4 theme
```

## Refresh behavior

`npm run data:refresh` fetches each source, writes a dated snapshot and `latest.json`, then rebuilds
`data/leaderboard.json`. Results are downloaded on every run, even when the benchmark release has not
changed. Dated snapshot filenames are retrieval dates, not benchmark releases.

LiveBench's benchmark release is stored separately from its results update date (the score file's
HTTP `Last-Modified`). Scale uses the latest published result timestamp or page update date for the
selected leaderboard variant, not unrelated metadata or another benchmark tab. Model release dates
are not treated as result dates. When an update date is unknown, the site labels the date as fetched.

If a fetch fails or returns empty, invalid, or incomplete results, the previous good `latest.json` is
kept and the source is marked stale. The dataset is still rebuilt so an outage does not take the site
down, but the refresh command reports failed sources and exits nonzero. Unregistered model names are
printed during refresh; use `npm run data:review` and update `data/models.json` to track new models.

LMArena Text and Code Arena are protected by Cloudflare. Their fetchers use full Chromium's modern
headless mode (`channel: "chromium"`), not the legacy headless shell, with a public-DNS fallback when
the sandbox resolver fails. Blocked navigations and partially loaded tables are failures; if the
environment blocks access, the last good snapshot is retained. The other sources use public HTML,
JSON, or API endpoints.

## Notes on data

- Scores, model names, dates, task/run costs, calculation breakdowns and provenance links are stored.
  Raw HTML and API pricing catalogs are not committed. Usage-derived costs are labeled estimates,
  not invoices.
- Vendor marks are vendored from the MIT-licensed LobeHub Icons set and are trademarks of their
  owners; they are used only for identification. See `public/vendors/ATTRIBUTION.md`.
- The refreshed dataset is baked into the next build. Run `npm run build` after refreshing.
- Data belongs to the respective benchmark providers. This project is not affiliated with any of them.
- The meta score is intentionally conservative about coverage; a high score on a single benchmark is
  not enough to rank a model overall.
