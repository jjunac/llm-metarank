import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { CanonicalModel, RawEntry, SourceSnapshot } from "../types.js";
import { DATA_DIR, SNAPSHOT_DIR, findDate, readJson, writeJson } from "../util.js";
import { buildModelRegistry, matchModel } from "./models.js";
import { canonicalModelKey, normalizeModelName } from "./name.js";

/**
 * Benchmarks whose published tables track only the active modern model cohort
 * (as opposed to all-time historical leaderboards like LMArena or Epoch CSVs).
 */
export const CURRENT_COHORT_SOURCES = new Set([
  "artificial-analysis",
  "livebench",
  "terminal-bench-4",
  "cursorbench",
  "swebench-pro-v2",
  "arc-agi-3",
]);

/** Release/result date floor for auto-registering models from historical sources. */
export const AUTO_REGISTER_MIN_DATE = "2026-10-20";

/** Models with an explicit release date older than this cutoff are legacy and never auto-registered. */
export const LEGACY_RELEASE_CUTOFF = "2026-06-01";

const LEGACY_KEY_PATTERN =
  /^(?:gpt (?:3|4|4o|4 1|4 5|5|5 1)|o[134]\b|claude (?:[123]|(?:opus|sonnet|haiku) (?:[123]|4(?:\s+[01])?$))|gemini (?:1|2|2 5)|llama [123]|qwen[12]|deepseek (?:r1|v[123]))\b/;

const VENDOR_ALIASES: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  "google deepmind": "Google",
  deepmind: "Google",
  meta: "Meta",
  xai: "SpaceXAI",
  spacexai: "SpaceXAI",
  "z.ai": "Z.ai",
  "z ai": "Z.ai",
  zai: "Z.ai",
  "zhipu ai": "Z.ai",
  zhipu: "Z.ai",
  "z.ai (zhipu ai)": "Z.ai",
  alibaba: "Alibaba",
  qwen: "Alibaba",
  moonshot: "Moonshot",
  "moonshot ai": "Moonshot",
  moonshotai: "Moonshot",
  kimi: "Moonshot",
  deepseek: "DeepSeek",
  xiaomi: "Xiaomi",
  mimo: "Xiaomi",
  minimax: "MiniMax",
  mistral: "Mistral",
  "mistral ai": "Mistral",
  stepfun: "StepFun",
  nvidia: "NVIDIA",
  tencent: "Tencent",
  "thinking machines": "Thinking Machines",
  thinky: "Thinking Machines",
  reflection: "Reflection",
  "reflection ai": "Reflection",
  cursor: "Cursor",
  inclusionai: "InclusionAI",
  "inclusion ai": "InclusionAI",
  "institute of foundation models": "Institute of Foundation Models",
};

const FAMILY_VENDORS: Array<[RegExp, string]> = [
  [/^(?:claude|opus|sonnet|haiku|fable)\b/, "Anthropic"],
  [/^(?:gpt|o[134])\b/, "OpenAI"],
  [/^(?:gemini|gemma)\b/, "Google"],
  [/^(?:muse|llama)\b/, "Meta"],
  [/^grok\b/, "SpaceXAI"],
  [/^glm\b/, "Z.ai"],
  [/^qwen/, "Alibaba"],
  [/^kimi\b/, "Moonshot"],
  [/^deepseek\b/, "DeepSeek"],
  [/^mimo\b/, "Xiaomi"],
  [/^minimax\b/, "MiniMax"],
  [/^(?:mistral|ministral|codestral)\b/, "Mistral"],
  [/^step\b/, "StepFun"],
  [/^nemotron\b/, "NVIDIA"],
  [/^hy\d/, "Tencent"],
  [/^inkling\b/, "Thinking Machines"],
  [/^beam\b/, "Reflection"],
  [/^composer\b/, "Cursor"],
  [/^ling\b/, "InclusionAI"],
];

const PREFERRED_NAME_SOURCES = new Set([
  "artificial-analysis",
  "arc-agi-3",
  "code-arena-webdev",
  "lmarena-text",
  "swebench-pro-v2",
  "mcp-atlas",
  "frontiermath",
  "tau3-banking",
]);

const UPPERCASE_TOKENS: Record<string, string> = {
  gpt: "GPT",
  glm: "GLM",
  vl: "VL",
  mimo: "MiMo",
  minimax: "MiniMax",
  deepseek: "DeepSeek",
  qwen: "Qwen",
  qwen3: "Qwen3",
  xai: "xAI",
  nvfp4: "NVFP4",
};

interface CandidateObservation {
  sourceId: string;
  entry: RawEntry;
  normalized: string;
}

export function normalizeVendor(rawVendor: string | undefined, canonicalKey: string): string {
  if (rawVendor?.trim()) {
    const cleaned = rawVendor.trim();
    const mapped = VENDOR_ALIASES[cleaned.toLowerCase()];
    if (mapped) return mapped;
  }
  for (const [pattern, vendor] of FAMILY_VENDORS) {
    if (pattern.test(canonicalKey)) return vendor;
  }
  if (rawVendor?.trim()) return rawVendor.trim();
  return "Unknown";
}

function formatFallbackName(canonicalKey: string): string {
  const collapsed = canonicalKey.replace(/\b(\d+)\s+(\d+)\b/g, "$1.$2");
  const titled = collapsed
    .split(/\s+/)
    .map((token) => {
      if (UPPERCASE_TOKENS[token]) return UPPERCASE_TOKENS[token];
      if (/^[vkm]\d+(?:\.\d+)?$/i.test(token)) return token.toUpperCase();
      if (/^\d+[bt]$/i.test(token) || /^a\d+b$/i.test(token)) return token.toUpperCase();
      return token.charAt(0).toUpperCase() + token.slice(1);
    })
    .join(" ");
  return titled.replace(/^(GPT|GLM)\s+(\d)/, "$1-$2").replace(/^Qwen\s+(\d+\.\d+)/, "Qwen$1");
}

export function cleanDisplayName(rawName: string, canonicalKey: string): string {
  let value = rawName.trim();

  // Unwrap model identity suffixes like "gpt-5.6 (sol)".
  value = value.replace(/\((sol|terra|luna)\)/gi, (_, suffix: string) => ` ${suffix.charAt(0).toUpperCase()}${suffix.slice(1).toLowerCase()} `);

  // Strip parenthetical and bracketed variant metadata.
  value = value.replace(/\([^)]*\)/g, " ");
  value = value.replace(/\[[^\]]*\]/g, " ");

  // Strip harness/adapter annotations and embedded dates.
  value = value.replace(/\s*-\s*Provider Adapter\b/gi, " ");
  value = value.replace(/\b20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, " ");
  value = value.replace(/[-_ ]?20\d{6}\b/g, " ");
  value = value.replace(/[-_ ]thinking[-_ ]max\b/gi, " ");
  value = value.replace(/[-_ ]thinking\b/gi, " ");

  // Normalize "p" decimal separator in display names (e.g., "M3p1" -> "M3.1").
  value = value.replace(/(\d)p(\d)/gi, "$1.$2");

  // Strip effort/variant tokens.
  value = value.replace(
    /\b(?:xhigh|extra high|high|medium|low|minimal|none|thinking|non[- ]?thinking|reasoning|default fallback|fallback|preview|instruct|chat|prompt|fc)\b/gi,
    " ",
  );
  if (!/\bqwen/i.test(value)) {
    value = value.replace(/\bmax\b/gi, " ");
  }
  value = value.replace(
    /\b(?:claude code|codex|mini[- ]?swe[- ]?agent|swe[- ]?agent|openhands|provider adapter|muse code|grok build)\b/gi,
    " ",
  );

  // Strip leading vendor prefix when it is not part of the canonical key.
  value = value.replace(
    /^(?:anthropic|openai|google|meta|xai|spacexai|moonshot ai|moonshotai|moonshot|alibaba|xiaomi|nvidia|reflection|thinking machines|stepfun|tencent|z\.ai|z ai|zai|zhipu ai|inclusionai|inclusion ai)[-_/\s]+/i,
    "",
  );

  // Strip trailing MMDD snapshot dates and release years.
  value = value.replace(/\s+/g, " ").trim();
  value = value.replace(/[-_ ](?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/, "");
  value = value.replace(/[-_ ]20\d{2}$/, "");
  value = value.replace(/\s+/g, " ").trim();

  if (/^(?:opus|sonnet|haiku|fable)\b/i.test(value)) {
    value = `Claude ${value.charAt(0).toUpperCase()}${value.slice(1)}`;
  }

  // If the source name was a lowercase slug (e.g. "claude-fable-5.2"), format it cleanly.
  if (value === value.toLowerCase()) {
    return formatFallbackName(canonicalKey);
  }

  // Replace internal hyphens before words (e.g. "Qwen3.8-Max" -> "Qwen3.8 Max"),
  // keeping "GPT-..." / "GLM-..." and MoE parameter tags like "35B-A3B".
  value = value.replace(/(?<!^(?:GPT|GLM))-(?=[A-Za-z])(?!A\d+B\b)/gi, " ");
  return value.replace(/\s+/g, " ").trim();
}

function inferDisplayName(observations: CandidateObservation[], canonicalKey: string): string {
  const candidates: Array<{ name: string; score: number }> = [];

  for (const { sourceId, entry } of observations) {
    const cleaned = cleanDisplayName(entry.rawName, canonicalKey);
    if (canonicalModelKey(cleaned) !== canonicalKey) continue;
    let score = 0;
    if (PREFERRED_NAME_SOURCES.has(sourceId)) score += 4;
    if (sourceId === "artificial-analysis") score += 3;
    if (/[A-Z]/.test(cleaned)) score += 2;
    if (/\d+\.\d+/.test(cleaned)) score += 1;
    if (!/[a-z]-[a-z]/i.test(cleaned)) score += 1;
    candidates.push({ name: cleaned, score });
  }

  candidates.sort((a, b) => b.score - a.score || a.name.length - b.name.length || a.name.localeCompare(b.name));
  return candidates[0]?.name ?? formatFallbackName(canonicalKey);
}

function extractReleaseDate(entry: RawEntry): string | undefined {
  const raw = entry.extra?.modelReleaseDate;
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  return findDate(raw);
}

export interface DiscoverModelsOptions {
  /**
   * Canonical keys per source that existed in the earliest baseline snapshot and
   * were left untracked. Prevents retro-registering baseline-excluded rows.
   */
  baselineKeysBySource?: Map<string, Set<string>>;
  minDate?: string;
}

export function discoverNewModels(
  existingModels: CanonicalModel[],
  snapshots: SourceSnapshot[],
  options: DiscoverModelsOptions = {},
): CanonicalModel[] {
  const minDate = options.minDate ?? AUTO_REGISTER_MIN_DATE;
  const registry = buildModelRegistry(existingModels);
  const existingIds = new Set(existingModels.map((model) => model.id));
  const groups = new Map<string, CandidateObservation[]>();

  for (const snapshot of snapshots) {
    for (const entry of snapshot.entries) {
      if (matchModel(registry, entry.rawName)) continue;
      const normalized = normalizeModelName(entry.rawName);
      const canonical = canonicalModelKey(normalized);
      if (!canonical) continue;

      const list = groups.get(canonical) ?? [];
      list.push({ sourceId: snapshot.sourceId, entry, normalized });
      groups.set(canonical, list);
    }
  }

  const discovered: CanonicalModel[] = [];

  for (const [canonicalKey, observations] of groups) {
    if (LEGACY_KEY_PATTERN.test(canonicalKey)) continue;

    const releaseDates = observations
      .map((obs) => extractReleaseDate(obs.entry))
      .filter((date): date is string => Boolean(date))
      .sort();

    if (releaseDates.some((date) => date < LEGACY_RELEASE_CUTOFF)) continue;

    const resultDates = observations
      .map((obs) => obs.entry.date)
      .filter((date): date is string => Boolean(date))
      .sort();

    const hasRecentDate =
      releaseDates.some((date) => date >= minDate) ||
      resultDates.some((date) => date >= minDate);

    // Filter out observations that were already present and untracked in that source's baseline snapshot,
    // unless the model has an explicit recent release date.
    const novelObservations = observations.filter((obs) => {
      const baseline = options.baselineKeysBySource?.get(obs.sourceId);
      if (!baseline) return true;
      return !baseline.has(canonicalKey) && !baseline.has(obs.normalized);
    });

    if (novelObservations.length === 0 && !hasRecentDate) continue;

    const inCurrentCohort = novelObservations.some((obs) => CURRENT_COHORT_SOURCES.has(obs.sourceId));
    const baselineTrackedNovelSources = new Set(
      novelObservations
        .filter((obs) => options.baselineKeysBySource?.has(obs.sourceId))
        .map((obs) => obs.sourceId),
    );
    const novelAcrossMultipleSources = baselineTrackedNovelSources.size >= 2;
    if (!inCurrentCohort && !hasRecentDate && !novelAcrossMultipleSources) continue;

    const id = canonicalKey.replace(/\s+/g, "-");
    if (existingIds.has(id)) continue;

    const name = inferDisplayName(observations, canonicalKey);
    const aaObs = observations.find((obs) => obs.sourceId === "artificial-analysis");
    const rawVendor =
      aaObs?.entry.vendor ??
      observations.map((obs) => obs.entry.vendor).find((vendor): vendor is string => Boolean(vendor?.trim()));
    const vendor = normalizeVendor(rawVendor, canonicalKey);

    const releaseDate =
      (aaObs ? extractReleaseDate(aaObs.entry) : undefined) ??
      releaseDates[0];

    const openWeightsValues = observations
      .map((obs) => obs.entry.extra?.isOpenWeights)
      .filter((val): val is boolean => typeof val === "boolean");
    const openWeights =
      openWeightsValues.length > 0
        ? openWeightsValues[0]
        : /\bopen\b/.test(canonicalKey)
          ? true
          : undefined;

    const aliasSet = new Set<string>([canonicalKey]);
    for (const obs of observations) {
      if (obs.normalized) aliasSet.add(obs.normalized);
    }
    const shortAnthropic = canonicalKey.replace(/^claude\s+(?=(?:opus|sonnet|haiku|fable)\b)/, "");
    if (shortAnthropic !== canonicalKey) {
      aliasSet.add(shortAnthropic);
    }

    const model: CanonicalModel = {
      id,
      name,
      vendor,
      ...(releaseDate ? { releaseDate } : {}),
      ...(openWeights !== undefined ? { openWeights } : {}),
      aliases: [...aliasSet],
    };

    discovered.push(model);
    existingIds.add(id);
  }

  return discovered.sort((a, b) => a.id.localeCompare(b.id));
}

async function loadSnapshotsAndBaselines(snapshotDir: string): Promise<{
  snapshots: SourceSnapshot[];
  baselineKeysBySource: Map<string, Set<string>>;
}> {
  const dirs = await readdir(snapshotDir, { withFileTypes: true });
  const sourceDirs = dirs.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const snapshots: SourceSnapshot[] = [];
  const baselineKeysBySource = new Map<string, Set<string>>();

  for (const sourceId of sourceDirs) {
    const dirPath = resolve(snapshotDir, sourceId);
    try {
      const latest = await readJson<SourceSnapshot>(resolve(dirPath, "latest.json"));
      snapshots.push(latest);
    } catch {
      continue;
    }

    try {
      const files = (await readdir(dirPath))
        .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
        .sort();
      if (files.length > 0) {
        const earliest = await readJson<SourceSnapshot>(resolve(dirPath, files[0]));
        const keys = new Set<string>();
        for (const entry of earliest.entries) {
          const normalized = normalizeModelName(entry.rawName);
          if (normalized) {
            keys.add(normalized);
            keys.add(canonicalModelKey(normalized));
          }
        }
        baselineKeysBySource.set(sourceId, keys);
      }
    } catch {
      // Ignore missing or unreadable baseline files.
    }
  }

  return { snapshots, baselineKeysBySource };
}

export async function registerNewModels(options?: {
  modelsPath?: string;
  snapshotDir?: string;
  dryRun?: boolean;
}): Promise<CanonicalModel[]> {
  const modelsPath = options?.modelsPath ?? resolve(DATA_DIR, "models.json");
  const snapshotDir = options?.snapshotDir ?? SNAPSHOT_DIR;
  const existingModels = await readJson<CanonicalModel[]>(modelsPath);
  const { snapshots, baselineKeysBySource } = await loadSnapshotsAndBaselines(snapshotDir);
  const newModels = discoverNewModels(existingModels, snapshots, { baselineKeysBySource });

  if (newModels.length > 0 && !options?.dryRun) {
    await writeJson(modelsPath, [...existingModels, ...newModels]);
  }

  return newModels;
}
