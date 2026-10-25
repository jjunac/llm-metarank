import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CostScope, LeaderboardDataset, SourceSnapshot, TaskCost } from "./types.js";
import { DATA_DIR } from "./util.js";
import { buildCostAnalysis, canonicalBasketId, isUsableTaskCost } from "./costs.js";

function validateCost(cost: TaskCost, context: string, errors: string[]): void {
  const invalid = (message: string) => errors.push(`${context}: ${message}`);
  if (!Number.isFinite(cost.usd) || cost.usd < 0) invalid("invalid task cost.");
  if (cost.currency !== "USD" || !["task", "environment"].includes(cost.unit)) invalid("cost is not USD per task/environment.");
  if (!["mean", "weighted-mean", "median"].includes(cost.statistic)) invalid("unknown cost statistic.");
  if (!["reported", "total-over-attempts", "usage-estimate"].includes(cost.method)) invalid("unknown cost calculation.");
  if (!cost.scope || !/^https?:\/\//.test(cost.sourceUrl) || !Number.isFinite(Date.parse(cost.fetchedAt))) invalid("cost has no valid scope, provenance URL or retrieval timestamp.");
  if (typeof cost.complete !== "boolean") invalid("cost completeness is unknown.");
  if (cost.totalUsd !== undefined || cost.attempts !== undefined) {
    if (!Number.isFinite(cost.totalUsd) || cost.totalUsd! < 0 || !Number.isSafeInteger(cost.attempts) || cost.attempts! <= 0) invalid("invalid total spend or attempt denominator.");
    else if (Math.abs(cost.usd - cost.totalUsd! / cost.attempts!) > Math.max(1e-9, cost.usd * 1e-9)) invalid("$/task does not equal total spend / attempts.");
  }
  for (const item of cost.breakdown ?? []) {
    if (!Number.isFinite(item.usdPerTask) || item.usdPerTask < 0) invalid("invalid evaluation cost breakdown.");
    if (item.tasks !== undefined && (!Number.isSafeInteger(item.tasks) || item.tasks <= 0)) invalid("invalid breakdown task count.");
    if (item.weight !== undefined && (!Number.isFinite(item.weight) || item.weight < 0 || item.weight > 1)) invalid("invalid breakdown weight.");
  }
  if (cost.statistic === "weighted-mean") {
    const breakdown = cost.breakdown ?? [];
    const weight = breakdown.reduce((sum, item) => sum + (item.weight ?? 0), 0);
    const weightedCost = breakdown.reduce((sum, item) => sum + item.usdPerTask * (item.weight ?? 0), 0);
    if (Math.abs(weight - 1) > 1e-9 || Math.abs(weightedCost - cost.usd) > Math.max(1e-9, cost.usd * 1e-9)) invalid("weighted task-cost breakdown does not reproduce its total.");
  }
}

function main(): void {
  const dataset = readJsonSync<LeaderboardDataset>(resolve(DATA_DIR, "leaderboard.json"));
  const errors: string[] = [];
  const warnings: string[] = [];

  if (dataset.sources.length !== 10) {
    errors.push(`Expected 10 sources, found ${dataset.sources.length}.`);
  }

  const sourceIds = new Set(dataset.sources.map((source) => source.id));
  const modelIds = new Set<string>();
  const snapshots = new Map(dataset.sources.map((source) => [source.id, readJsonSync<SourceSnapshot>(resolve(DATA_DIR, "snapshots", source.id, "latest.json"))]));

  for (const model of dataset.models) {
    if (modelIds.has(model.id)) errors.push(`Duplicate model id: ${model.id}`);
    modelIds.add(model.id);

    if (model.overall !== null && (model.overall < 0 || model.overall > 100)) {
      errors.push(`${model.name}: overall score ${model.overall} is outside 0-100.`);
    }

    if (model.status === "ranked") {
      if (model.rank === null) errors.push(`${model.name}: ranked model has no rank.`);
      if (model.coverage.used < 5) errors.push(`${model.name}: ranked with only ${model.coverage.used} sources.`);
      if (model.coverage.general < 1) errors.push(`${model.name}: ranked without a general source.`);
      if (model.coverage.coding < 1) errors.push(`${model.name}: ranked without a coding source.`);
    }

    const seenSources = new Set<string>();
    for (const entry of model.sources) {
      if (!sourceIds.has(entry.sourceId)) errors.push(`${model.name}: unknown source ${entry.sourceId}.`);
      if (seenSources.has(entry.sourceId)) errors.push(`${model.name}: duplicate source ${entry.sourceId}.`);
      seenSources.add(entry.sourceId);
      if (!Number.isFinite(entry.score)) errors.push(`${model.name}: non-finite raw score from ${entry.sourceId}.`);
      if (!Number.isFinite(entry.percentile) || entry.percentile < 0 || entry.percentile > 100) {
        errors.push(`${model.name}: invalid percentile from ${entry.sourceId}.`);
      }
    }

    if (model.sources.length === 0) errors.push(`${model.name}: no source entries.`);
    for (const entry of [...model.sources, ...model.costedRuns]) {
      if (entry.modelId !== model.id) errors.push(`${model.name}: a costed run belongs to another model.`);
      if (entry.runCostUsd !== undefined && (!Number.isFinite(entry.runCostUsd) || entry.runCostUsd < 0)) errors.push(`${model.name}: invalid run-total cost.`);
      if (entry.cost) validateCost(entry.cost, `${model.name}/${entry.sourceId}`, errors);
      for (const [metric, cost] of Object.entries(entry.metricCosts ?? {})) {
        validateCost(cost, `${model.name}/${entry.sourceId}/${metric}`, errors);
        if (!Number.isFinite(entry.metrics[metric])) errors.push(`${model.name}/${entry.sourceId}: cost for an unscored metric ${metric}.`);
      }
      if (entry.cost || Object.keys(entry.metricCosts ?? {}).length) {
        const raw = snapshots.get(entry.sourceId)?.entries.find((raw) => raw.rawName === entry.rawName && raw.score === entry.score && raw.runId === entry.runId && raw.variant === entry.variant && raw.harness === entry.harness);
        if (!raw || JSON.stringify(raw.cost) !== JSON.stringify(entry.cost) || JSON.stringify(raw.metricCosts) !== JSON.stringify(entry.metricCosts)) {
          errors.push(`${model.name}/${entry.sourceId}: cost is not paired with the exact raw scored run.`);
        }
      }
    }
  }

  for (const source of dataset.sources) {
    if (source.status === "stale") warnings.push(`${source.shortName}: last refresh failed; using an older snapshot.`);
    if (source.entryCount === 0) errors.push(`${source.shortName}: snapshot has no rows.`);
    if (source.mappedCount < 3) warnings.push(`${source.shortName}: only ${source.mappedCount} tracked models mapped.`);
    for (const warning of source.warnings) warnings.push(`${source.shortName}: ${warning}`);
    const selected = dataset.models.flatMap((model) => model.sources.filter((entry) => entry.sourceId === source.id));
    const usable = source.status === "stale" ? 0 : selected.filter((entry) => isUsableTaskCost(entry.cost)).length;
    if (usable !== source.costCoverage.usableModels) errors.push(`${source.shortName}: task-cost coverage count is inconsistent.`);
    if (source.costCoverage.status === "unavailable" || source.costCoverage.status === "stale") warnings.push(`${source.shortName}: task costs ${source.costCoverage.status}; not used in a frontier.`);
  }

  const recomputedCosts = buildCostAnalysis(dataset.models, dataset.sources);
  if (JSON.stringify(recomputedCosts) !== JSON.stringify(dataset.costAnalysis)) errors.push("Cost references / matched baskets / Pareto frontiers do not match the source observations.");

  const costScopes = Object.keys(dataset.costAnalysis.frontiers) as CostScope[];
  for (const scope of costScopes) {
    const applicable = new Set(dataset.costAnalysis.applicableSourceIds[scope] ?? []);
    const baskets = dataset.costAnalysis.baskets[scope] ?? [];
    const views = dataset.costAnalysis.frontiers[scope] ?? {};
    const defaultId = dataset.costAnalysis.defaultBasketId[scope];

    if (new Set(baskets.map((basket) => basket.id)).size !== baskets.length) errors.push(`${scope}: duplicate cost basket ids.`);
    if (baskets.length > 0 && !defaultId) errors.push(`${scope}: cost basket has no default.`);
    if (defaultId && !views[defaultId]) errors.push(`${scope}: default cost basket ${defaultId} has no frontier.`);

    for (const basket of baskets) {
      if (basket.id !== canonicalBasketId(basket.sourceIds)) errors.push(`${scope}/${basket.id}: basket id is not canonical.`);
      if (basket.sourceIds.length < 2) errors.push(`${scope}/${basket.id}: basket has fewer than two sources.`);
      for (const sourceId of basket.sourceIds) {
        if (!applicable.has(sourceId)) errors.push(`${scope}/${basket.id}: source ${sourceId} is not applicable.`);
      }
      const view = views[basket.id];
      if (!view) {
        errors.push(`${scope}/${basket.id}: missing frontier.`);
        continue;
      }
      if (view.points.length < 2) errors.push(`${scope}/${basket.id}: fewer than two eligible models.`);
      if (view.sourceIds.length !== basket.sourceIds.length || view.sourceIds.some((sourceId, index) => sourceId !== basket.sourceIds[index])) {
        errors.push(`${scope}/${basket.id}: frontier sources do not match the basket.`);
      }
      for (const point of view.points) {
        const contributions = point.contributions.map((item) => item.sourceId);
        if (contributions.length !== basket.sourceIds.length || contributions.some((sourceId) => !basket.sourceIds.includes(sourceId))) {
          errors.push(`${scope}/${basket.id}: point ${point.modelId} does not cover the basket exactly.`);
        }
      }
      for (const item of view.excluded) {
        if (!item.missingSourceIds.some((sourceId) => basket.sourceIds.includes(sourceId))) {
          errors.push(`${scope}/${basket.id}: excluded model ${item.modelId} is not missing a basket source.`);
        }
      }
    }

    for (const viewId of Object.keys(views)) {
      if (!baskets.some((basket) => basket.id === viewId)) errors.push(`${scope}/${viewId}: frontier has no basket entry.`);
    }

    const singleIds = dataset.costAnalysis.singleSourceIds[scope] ?? [];
    const singleViews = dataset.costAnalysis.singleSourceFrontiers[scope] ?? {};
    for (const sourceId of singleIds) {
      const view = singleViews[sourceId];
      if (!view) {
        errors.push(`${scope}/${sourceId}: missing single-benchmark frontier.`);
        continue;
      }
      if (view.sourceIds.length !== 1 || view.sourceIds[0] !== sourceId) {
        errors.push(`${scope}/${sourceId}: single-benchmark frontier sources do not match the benchmark.`);
      }
      if (view.points.length < 2) errors.push(`${scope}/${sourceId}: fewer than two eligible models.`);
      for (const point of view.points) {
        if (point.contributions.length !== 1 || point.contributions[0].sourceId !== sourceId) {
          errors.push(`${scope}/${sourceId}: point ${point.modelId} does not cover exactly one benchmark.`);
        }
        if (point.costIndex <= 0 || point.score < 0 || point.score > 100) {
          errors.push(`${scope}/${sourceId}: point ${point.modelId} has an invalid score or cost index.`);
        }
        if (point.frontier !== (point.dominatedBy.length === 0)) {
          errors.push(`${scope}/${sourceId}: point ${point.modelId} has inconsistent frontier status.`);
        }
      }
    }
    for (const viewId of Object.keys(singleViews)) {
      if (!singleIds.includes(viewId)) errors.push(`${scope}/${viewId}: single-benchmark frontier has no source entry.`);
    }

    const sorted = [...baskets].sort((a, b) =>
      (views[b.id]?.points.length ?? 0) - (views[a.id]?.points.length ?? 0) ||
      b.sourceIds.length - a.sourceIds.length ||
      a.id.localeCompare(b.id));
    if (sorted[0] && defaultId !== sorted[0].id) errors.push(`${scope}: default basket is not the largest eligible basket.`);
    if (!sorted[0] && singleIds.length > 0 && (!defaultId || !singleIds.includes(defaultId))) {
      errors.push(`${scope}: default selection is not a single-benchmark view.`);
    }
  }

  const ranked = dataset.models.filter((model) => model.status === "ranked");
  const top = ranked.slice(0, 10);
  if (top.length === 0) errors.push("No ranked models.");

  console.log("\nSOURCE COVERAGE");
  console.log("Source                     Rows   Mapped  Data        Status");
  for (const source of dataset.sources) {
    console.log(
      `${source.shortName.padEnd(26)} ${String(source.entryCount).padStart(4)}   ${String(source.mappedCount).padStart(5)}   ${source.dataDate.padEnd(10)}  ${source.status}`,
    );
  }

  console.log("\nTASK COST COVERAGE");
  console.log("Source                     Rows  Usable models  Statistic          Status");
  for (const source of dataset.sources) {
    console.log(`${source.shortName.padEnd(26)} ${String(source.costCoverage.reportedEntries).padStart(4)}  ${String(source.costCoverage.usableModels).padStart(13)}  ${(source.costCoverage.statistics.join(", ") || "—").padEnd(18)} ${source.costCoverage.status}`);
  }
  console.log("\nMATCHED COST BASKETS");
  for (const scope of costScopes) {
    console.log(`  ${scope}`);
    for (const basket of dataset.costAnalysis.baskets[scope]) {
      const view = dataset.costAnalysis.frontiers[scope][basket.id];
      const names = basket.sourceIds
        .map((sourceId) => dataset.sources.find((source) => source.id === sourceId)?.shortName ?? sourceId)
        .join(" + ");
      const isDefault = dataset.costAnalysis.defaultBasketId[scope] === basket.id;
      console.log(`    ${names.padEnd(40)} ${String(view.points.length).padStart(2)} models  ${String(view.points.filter((point) => point.frontier).length).padStart(2)} non-dominated${isDefault ? "  default" : ""}`);
    }
  }

  console.log("\nSINGLE-BENCHMARK VIEWS");
  for (const scope of costScopes) {
    const sourceIds = dataset.costAnalysis.singleSourceIds[scope] ?? [];
    if (!sourceIds.length) continue;
    console.log(`  ${scope}`);
    for (const sourceId of sourceIds) {
      const view = dataset.costAnalysis.singleSourceFrontiers[scope][sourceId];
      const name = dataset.sources.find((source) => source.id === sourceId)?.shortName ?? sourceId;
      const statistic = view.points[0]?.contributions[0]?.statistic ?? "—";
      console.log(`    ${name.padEnd(40)} ${String(view.points.length).padStart(2)} models  ${String(view.points.filter((point) => point.frontier).length).padStart(2)} non-dominated  ${statistic}`);
    }
  }

  console.log("\nTOP 10");
  for (const model of top) {
    console.log(
      `${String(model.rank).padStart(2)}. ${model.name.padEnd(26)} ${(model.overall ?? 0).toFixed(1)}  (${model.coverage.used}/${model.coverage.total} sources)`,
    );
  }

  console.log(
    `\n${dataset.rankedModelCount} ranked / ${dataset.trackedModelCount} tracked models · generated ${dataset.generatedAt}`,
  );

  if (warnings.length > 0) {
    console.log("\nWARNINGS");
    for (const warning of [...new Set(warnings)]) console.log(`  ! ${warning}`);
  }

  if (errors.length > 0) {
    console.log("\nERRORS");
    for (const error of [...new Set(errors)]) console.log(`  x ${error}`);
    process.exitCode = 1;
  } else {
    console.log("\nDataset validation passed.");
  }
}

function readJsonSync<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

main();
