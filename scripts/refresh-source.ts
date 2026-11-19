import { resolve } from "node:path";
import type { RawEntry, SourceSnapshot, TaskCost } from "./types.js";
import { SNAPSHOT_DIR, nowISO, readJson, todayISO, writeJson } from "./util.js";

export type RefreshResult =
  | { ok: true; snapshot: SourceSnapshot }
  | { ok: false; snapshot: SourceSnapshot | null; error: string };

/** Never replace usable history with an empty, mismatched or malformed feed. */
function validateSnapshot(snapshot: SourceSnapshot, sourceId: string): void {
  if (snapshot.sourceId !== sourceId) throw new Error(`Snapshot source mismatch: expected ${sourceId}, got ${snapshot.sourceId}`);
  if (!Array.isArray(snapshot.entries) || !snapshot.entries.length) throw new Error("Source returned no model rows");
  if (snapshot.entries.some((entry) => !entry || typeof entry.rawName !== "string" || !entry.rawName.trim() || !Number.isFinite(entry.score))) {
    throw new Error("Source returned invalid model names or scores");
  }
  if (!Number.isFinite(Date.parse(snapshot.fetchedAt)) || !/^https?:\/\//.test(snapshot.url) ||
    !Array.isArray(snapshot.warnings) || snapshot.warnings.some((warning) => typeof warning !== "string") ||
    [snapshot.sourceUpdatedAt, snapshot.benchmarkRelease].some((date) => date !== undefined && !Number.isFinite(Date.parse(date)))) {
    throw new Error("Source returned invalid snapshot metadata");
  }
}

function sameEntryIdentity(a: RawEntry, b: RawEntry): boolean {
  return (
    a.rawName === b.rawName &&
    a.score === b.score &&
    a.runId === b.runId &&
    a.variant === b.variant &&
    a.harness === b.harness
  );
}

function sameCostObservation(a: TaskCost | undefined, b: TaskCost | undefined): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify({ ...a, fetchedAt: "" }) === JSON.stringify({ ...b, fetchedAt: "" });
}

function preserveUnchangedTimestamps(snapshot: SourceSnapshot, previous: SourceSnapshot): void {
  for (const entry of snapshot.entries) {
    const prev = previous.entries.find((candidate) => sameEntryIdentity(candidate, entry));
    if (!prev) continue;
    if (entry.cost && sameCostObservation(entry.cost, prev.cost)) {
      entry.cost.fetchedAt = prev.cost!.fetchedAt;
    }
    if (entry.metricCosts && prev.metricCosts) {
      for (const [metric, cost] of Object.entries(entry.metricCosts)) {
        const prevCost = prev.metricCosts[metric];
        if (sameCostObservation(cost, prevCost)) {
          cost.fetchedAt = prevCost!.fetchedAt;
        }
      }
    }
  }
  if (JSON.stringify({ ...snapshot, fetchedAt: previous.fetchedAt }) === JSON.stringify(previous)) {
    snapshot.fetchedAt = previous.fetchedAt;
  }
}

export async function refreshSource(
  sourceId: string,
  fetcher: () => Promise<SourceSnapshot>,
  snapshotDir = SNAPSHOT_DIR,
): Promise<RefreshResult> {
  const latestPath = resolve(snapshotDir, sourceId, "latest.json");
  let previous: SourceSnapshot | null = null;
  try {
    const candidate = await readJson<SourceSnapshot>(latestPath);
    validateSnapshot(candidate, sourceId);
    previous = candidate;
  } catch {
    previous = null;
  }

  try {
    const snapshot = await fetcher();
    snapshot.fetchedAt ||= nowISO();
    validateSnapshot(snapshot, sourceId);
    if (previous) preserveUnchangedTimestamps(snapshot, previous);
    await writeJson(resolve(snapshotDir, sourceId, `${todayISO()}.json`), snapshot);
    await writeJson(latestPath, snapshot);
    return { ok: true, snapshot };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!previous) {
      return { ok: false, snapshot: null, error: message };
    }
    previous.warnings = [
      ...previous.warnings.filter((warning) => !warning.startsWith("Refresh failed ")),
      `Refresh failed ${nowISO()}: ${message}`,
    ];
    await writeJson(latestPath, previous);
    return { ok: false, snapshot: previous, error: message };
  }
}
