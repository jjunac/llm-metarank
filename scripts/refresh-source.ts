import { resolve } from "node:path";
import type { SourceSnapshot } from "./types.js";
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

export async function refreshSource(
  sourceId: string,
  fetcher: () => Promise<SourceSnapshot>,
  snapshotDir = SNAPSHOT_DIR,
): Promise<RefreshResult> {
  const latestPath = resolve(snapshotDir, sourceId, "latest.json");
  try {
    const snapshot = await fetcher();
    snapshot.fetchedAt ||= nowISO();
    validateSnapshot(snapshot, sourceId);
    await writeJson(resolve(snapshotDir, sourceId, `${todayISO()}.json`), snapshot);
    await writeJson(latestPath, snapshot);
    return { ok: true, snapshot };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    let previous: SourceSnapshot;
    try {
      previous = await readJson<SourceSnapshot>(latestPath);
      validateSnapshot(previous, sourceId);
    } catch {
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
