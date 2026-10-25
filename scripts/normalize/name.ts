const VENDOR_PREFIX =
  /^(?:anthropic|openai|google|meta|xai|spacexai|moonshot ai|moonshotai|moonshot|alibaba|xiaomi|nvidia|reflection|thinking machines|stepfun|tencent|z\.ai|z ai|zai|zhipu ai)\s+/;

const EFFORT_PATTERN =
  /\b(?:xhigh|extra high|high|medium|low|minimal|none|thinking|non[- ]?thinking|reasoning|default fallback|fallback|preview|instruct|chat|prompt|fc)\b/g;

const HARNESS_PATTERN =
  /\b(?:claude code|codex|mini[- ]?swe[- ]?agent|swe[- ]?agent|openhands|provider adapter|muse code|grok build)\b/g;

/**
 * Produces a stable matching key for model names across leaderboards.
 *
 * Examples:
 *   "Claude Opus 5.5 (Max, Default Fallback)" -> "claude opus 5 5"
 *   "Opus 5 (Claude Code) xhigh"               -> "opus 5"
 *   "gpt-5.6 (sol)"                            -> "gpt 5 6 sol"
 *   "DeepSeek-V4.1-Flash-20261017"             -> "deepseek v4 1 flash"
 *   "GLM 5.3"                                  -> "glm 5 3"
 */
export function normalizeModelName(name: string): string {
  let value = name.toLowerCase().trim();

  // Dates embedded in names are snapshots, not model versions.
  value = value.replace(/\b20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, " ");
  value = value.replace(/\b20\d{6}\b/g, " ");

  // Some sources wrap a model suffix in parentheses, e.g. "gpt-5.6 (sol)".
  // Keep those suffixes; they identify the model rather than a sampling mode.
  value = value.replace(/\((sol|terra|luna)\)/gi, " $1 ");

  // Drop sampling/effort suffixes that appear after a parenthetical, e.g.
  // "Opus 5 (Claude Code) xhigh" or "GLM-5.3 (mini-swe-agent) max".
  value = value.replace(/(\))\s*(?:xhigh|extra high|high|medium|low|max)\b/g, "$1");

  // Most variant information is in parentheses.
  value = value.replace(/\([^)]*\)/g, " ");
  value = value.replace(/\[[^\]]*\]/g, " ");

  // Handle non-parenthesized variants such as claude-opus-4-6-thinking-max.
  value = value.replace(/[-_ ]thinking[-_ ]max\b/g, " ");
  value = value.replace(/[-_ ]thinking\b/g, " ");

  value = value.replace(EFFORT_PATTERN, " ");
  value = value.replace(HARNESS_PATTERN, " ");

  // Vendor prefixes are metadata, not part of the model identity.
  value = value.replace(VENDOR_PREFIX, "");

  // Normalize separators and punctuation.
  value = value.replace(/[-_/]+/g, " ");
  value = value.replace(/\./g, " ");
  value = value.replace(/[^a-z0-9 ]+/g, " ");
  value = value.replace(/\s+/g, " ").trim();

  // Strip trailing snapshot dates such as "1017" or a release year.
  value = value.replace(/\s+(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/, "");
  value = value.replace(/\s+20\d{2}$/, "");

  return value.replace(/\s+/g, " ").trim();
}
