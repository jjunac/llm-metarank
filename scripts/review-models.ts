import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { SourceSnapshot } from "./types.js";
import { SNAPSHOT_DIR, readJson } from "./util.js";
import { loadModelRegistry, matchModel } from "./normalize/models.js";
import { normalizeModelName } from "./normalize/name.js";

async function main(): Promise<void> {
  const registry = await loadModelRegistry();
  const dirs = await readdir(SNAPSHOT_DIR, { withFileTypes: true });
  const sourceDirs = dirs.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

  for (const sourceId of sourceDirs) {
    let snapshot: SourceSnapshot;
    try {
      snapshot = await readJson<SourceSnapshot>(resolve(SNAPSHOT_DIR, sourceId, "latest.json"));
    } catch {
      continue;
    }

    const unmapped: string[] = [];
    let mapped = 0;
    for (const entry of snapshot.entries) {
      if (matchModel(registry, entry.rawName)) mapped += 1;
      else unmapped.push(entry.rawName);
    }

    console.log(`\n${sourceId}: ${mapped}/${snapshot.entries.length} mapped`);
    const topUnmapped = [...new Set(unmapped)].slice(0, 25);
    for (const name of topUnmapped) {
      console.log(`  ? ${name}  ->  ${normalizeModelName(name)}`);
    }
    if (unmapped.length > topUnmapped.length) {
      console.log(`  ... ${unmapped.length - topUnmapped.length} more unmapped rows`);
    }
  }

  console.log(`\nRegistry: ${registry.models.length} models, ${registry.aliases.size} aliases`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
