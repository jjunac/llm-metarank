import { resolve } from "node:path";
import type { CanonicalModel } from "../types.js";
import { DATA_DIR, readJson } from "../util.js";
import { normalizeModelName } from "./name.js";

export interface ModelRegistry {
  models: CanonicalModel[];
  aliases: Map<string, string>;
}

export async function loadModelRegistry(): Promise<ModelRegistry> {
  const models = await readJson<CanonicalModel[]>(resolve(DATA_DIR, "models.json"));
  const aliases = new Map<string, string>();

  for (const model of models) {
    const candidates = new Set([normalizeModelName(model.name), ...(model.aliases ?? []).map(normalizeModelName)]);
    for (const alias of candidates) {
      if (!alias) continue;
      const existing = aliases.get(alias);
      if (existing && existing !== model.id) {
        throw new Error(`Model alias collision: "${alias}" maps to both "${existing}" and "${model.id}"`);
      }
      aliases.set(alias, model.id);
    }
  }

  return { models, aliases };
}

export function matchModel(registry: ModelRegistry, rawName: string): string | null {
  const key = normalizeModelName(rawName);
  return registry.aliases.get(key) ?? null;
}
