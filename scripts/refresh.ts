import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import type { SourceConfig, SourceSnapshot } from "./types.js";
import { DATA_DIR, ROOT, readJson } from "./util.js";
import { refreshSource } from "./refresh-source.js";
import { loadModelRegistry, matchModel } from "./normalize/models.js";
import { fetchArtificialAnalysis } from "./fetch/artificial-analysis.js";
import { fetchLiveBench } from "./fetch/livebench.js";
import { fetchLmArenaText, fetchCodeArenaWebdev } from "./fetch/arena.js";
import { fetchSweBenchPro, fetchHle, fetchMcpAtlas } from "./fetch/scale.js";
import { fetchTerminalBench } from "./fetch/terminal-bench.js";
import { fetchGso } from "./fetch/gso.js";
import { fetchArcAgi3 } from "./fetch/arc.js";
import { fetchCursorBench } from "./fetch/cursorbench.js";
import { fetchTauBanking } from "./fetch/tau-banking.js";
import { fetchFrontierMath } from "./fetch/frontiermath.js";

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
  cursorbench: fetchCursorBench,
  "tau3-banking": fetchTauBanking,
  frontiermath: fetchFrontierMath,
};

function git(args: string[]): void {
  execFileSync("git", args, { cwd: ROOT, stdio: "inherit" });
}

function gitOutput(args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trimEnd();
}

function assertCleanWorkingTree(): void {
  const status = gitOutput(["status", "--porcelain"]);
  if (!status) return;

  console.error("Working tree is not clean. Commit or stash your changes before refreshing data.\n");
  console.error(status);
  process.exit(1);
}

function commitAndPushData(): void {
  git(["add", "--", "data"]);
  const staged = gitOutput(["diff", "--cached", "--name-only", "--", "data"]);
  if (!staged) {
    console.log("\nNo data changes to commit.");
    return;
  }

  console.log("\nCommitting data changes...");
  git(["commit", "-m", "chore: update data"]);

  console.log("Pushing...");
  git(["push"]);
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const fetchOnly = args.has("--fetch-only");
  const onlyArg = [...args].find((arg) => arg.startsWith("--only="));
  const only = onlyArg?.split("=")[1];

  if (!fetchOnly) assertCleanWorkingTree();

  const sources = await readJson<SourceConfig[]>(resolve(DATA_DIR, "sources.json"));
  const selected = only ? sources.filter((source) => source.id === only) : sources;
  if (only && selected.length === 0) {
    throw new Error(`Unknown source "${only}"`);
  }

  const registry = await loadModelRegistry();
  const failed: string[] = [];

  for (const source of selected) {
    const fetcher = FETCHERS[source.id];
    if (!fetcher) throw new Error(`No fetcher registered for ${source.id}`);

    process.stdout.write(`\n→ ${source.shortName}... `);
    const result = await refreshSource(source.id, fetcher);
    if (result.ok) {
      const { snapshot } = result;
      const mapped = new Set(snapshot.entries.map((entry) => matchModel(registry, entry.rawName)).filter(Boolean));
      const unmapped = [...new Set(snapshot.entries.filter((entry) => !matchModel(registry, entry.rawName)).map((entry) => entry.rawName))];
      console.log(`${snapshot.entries.length} rows · ${mapped.size} tracked models${snapshot.sourceUpdatedAt ? ` · data ${snapshot.sourceUpdatedAt}` : ""}${snapshot.benchmarkRelease ? ` · benchmark release ${snapshot.benchmarkRelease}` : ""}`);
      for (const warning of snapshot.warnings) console.log(`  ! ${warning}`);
      if (unmapped.length) console.log(`  ? ${unmapped.length} unregistered names: ${unmapped.slice(0, 5).join("; ")}${unmapped.length > 5 ? "; … (npm run data:review)" : ""}`);
    } else {
      failed.push(source.id);
      console.log(`FAILED: ${result.error}`);
      if (result.snapshot) {
        console.log(`  using last good snapshot from ${result.snapshot.fetchedAt}`);
      } else {
        console.log("  no previous snapshot available");
      }
    }
  }

  if (!fetchOnly) {
    const { buildDataset } = await import("./build-dataset.js");
    await buildDataset();
    commitAndPushData();
  } else {
    console.log("\nSkipping commit and push because --fetch-only was used.");
  }

  console.log(`\nRefresh complete: ${selected.length - failed.length}/${selected.length} sources refreshed.${failed.length ? ` Failed: ${failed.join(", ")}.` : ""}`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
