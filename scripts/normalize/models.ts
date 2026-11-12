import { resolve } from "node:path";
import type { CanonicalModel } from "../types.js";
import { DATA_DIR, readJson } from "../util.js";
import { canonicalModelKey, normalizeModelName } from "./name.js";

export interface ModelRegistry {
  models: CanonicalModel[];
  aliases: Map<string, string>;
}

function expandModelAliases(rawCandidates: Iterable<string>): Set<string> {
  const candidates = new Set<string>();
  for (const raw of rawCandidates) {
    const normalized = normalizeModelName(raw);
    if (!normalized) continue;
    candidates.add(normalized);
    const canonical = canonicalModelKey(normalized);
    candidates.add(canonical);
    const shortAnthropic = canonical.replace(/^claude\s+(?=(?:opus|sonnet|haiku|fable)\b)/, "");
    if (shortAnthropic) candidates.add(shortAnthropic);
  }
  return candidates;
}

export function buildModelRegistry(models: CanonicalModel[]): ModelRegistry {
  const aliases = new Map<string, string>();

  for (const model of models) {
    const candidates = expandModelAliases([model.name, ...(model.aliases ?? [])]);
    for (const alias of candidates) {
      const existing = aliases.get(alias);
      if (existing && existing !== model.id) {
        throw new Error(`Model alias collision: "${alias}" maps to both "${existing}" and "${model.id}"`);
      }
      aliases.set(alias, model.id);
    }
  }

  // Second pass: allow "<family> <N> 0" to match "<family> <N>" when unclaimed.
  for (const model of models) {
    const candidates = expandModelAliases([model.name, ...(model.aliases ?? [])]);
    for (const alias of candidates) {
      if (/(?:^|\s)\d+$/.test(alias) && !/\s\d+\s+\d+$/.test(alias)) {
        const zeroVariant = `${alias} 0`;
        if (!aliases.has(zeroVariant)) {
          aliases.set(zeroVariant, model.id);
        }
      }
    }
  }

  return { models, aliases };
}

export async function loadModelRegistry(): Promise<ModelRegistry> {
  const models = await readJson<CanonicalModel[]>(resolve(DATA_DIR, "models.json"));
  return buildModelRegistry(models);
}

export function matchModel(registry: ModelRegistry, rawName: string): string | null {
  const key = normalizeModelName(rawName);
  return registry.aliases.get(key) ?? registry.aliases.get(canonicalModelKey(key)) ?? null;
}
