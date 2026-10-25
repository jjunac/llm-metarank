import { resolve } from "node:path";
import type { SourceConfig, SourceSnapshot } from "./types.js";
import { DATA_DIR, SNAPSHOT_DIR, nowISO, readJson, todayISO, writeJson } from "./util.js";
import { fetchArtificialAnalysis } from "./fetch/artificial-analysis.js";
import { fetchLiveBench } from "./fetch/livebench.js";
import { fetchLmArenaText, fetchCodeArenaWebdev } from "./fetch/arena.js";
import { fetchSweBenchPro, fetchHle, fetchMcpAtlas } from "./fetch/scale.js";
import { fetchTerminalBench } from "./fetch/terminal-bench.js";
import { fetchGso } from "./fetch/gso.js";
import { fetchArcAgi3 } from "./fetch/arc.js";

const FETCHERS: Record<string, () => Promise<SourceSnapshot>> = {
  "artificial-analysis": fetchArtificialAnalysis,
  livebench: fetchLiveBench,
  "lmarena-text": fetchLmArenaText,
  "swebench-pro-v2": fetchSweBenchPro,
  "terminal-bench-4": fetchTerminalBench,
  hle: fetchHle,
  gso: fetchGso,
  "arc-agi-3": fetchArcAgi3,
  "code-arena-webdev": fetchCodeArenaWebdev,
  "mcp-atlas": fetchMcpAtlas,
};

async function loadPrevious(sourceId: string): Promise<SourceSnapshot | null> {
  try {
    return await readJson<SourceSnapshot>(resolve(SNAPSHOT_DIR, sourceId, "latest.json"));
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const fetchOnly = args.has("--fetch-only");
  const onlyArg = [...args].find((arg) => arg.startsWith("--only="));
  const only = onlyArg?.split("=")[1];

  const sources = await readJson<SourceConfig[]>(resolve(DATA_DIR, "sources.json"));
  const selected = only ? sources.filter((source) => source.id === only) : sources;
  if (only && selected.length === 0) {
    throw new Error(`Unknown source "${only}"`);
  }

  const snapshots: SourceSnapshot[] = [];
  const date = todayISO();

  for (const source of selected) {
    const fetcher = FETCHERS[source.id];
    if (!fetcher) throw new Error(`No fetcher registered for ${source.id}`);

    process.stdout.write(`\n→ ${source.shortName}... `);
    try {
      const snapshot = await fetcher();
      snapshot.fetchedAt = snapshot.fetchedAt || nowISO();
      await writeJson(resolve(SNAPSHOT_DIR, source.id, "latest.json"), snapshot);
      await writeJson(resolve(SNAPSHOT_DIR, source.id, `${date}.json`), snapshot);
      snapshots.push(snapshot);
      console.log(`${snapshot.entries.length} rows${snapshot.sourceUpdatedAt ? ` · data ${snapshot.sourceUpdatedAt}` : ""}`);
      for (const warning of snapshot.warnings) console.log(`  ! ${warning}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`FAILED: ${message}`);
      const previous = await loadPrevious(source.id);
      if (previous) {
        previous.warnings = [...new Set([...previous.warnings, `Refresh failed ${nowISO()}: ${message}`])];
        await writeJson(resolve(SNAPSHOT_DIR, source.id, "latest.json"), previous);
        snapshots.push(previous);
        console.log(`  using last good snapshot from ${previous.fetchedAt}`);
      } else {
        console.log("  no previous snapshot available");
      }
    }
  }

  if (!fetchOnly) {
    const { buildDataset } = await import("./build-dataset.js");
    await buildDataset();
  }

  console.log("\nRefresh complete.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
