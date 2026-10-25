const HARNESS_PATTERN =
  /(claude code|codex|mini[- ]swe[- ]agent|swe[- ]agent|openhands|provider adapter|muse code|grok build|agent)/i;
const EFFORT_PATTERN =
  /(xhigh|extra high|high|medium|low|max|thinking|non[- ]thinking|reasoning|default|fallback|32k)/i;

export function parseAnnotations(rawName: string): { harness?: string; variant?: string } {
  const groups = [...rawName.matchAll(/\(([^)]+)\)/g)]
    .map((match) => match[1].trim())
    .filter(Boolean);

  let harness: string | undefined;
  const variantParts: string[] = [];

  for (const group of groups) {
    if (HARNESS_PATTERN.test(group)) {
      harness = group;
    } else if (EFFORT_PATTERN.test(group)) {
      variantParts.push(group);
    }
  }

  if (/provider adapter/i.test(rawName)) {
    harness = "Provider Adapter";
  }

  const trailing = rawName.match(/\)\s*(xhigh|extra high|high|medium|low|max)\b/i)?.[1];
  if (trailing) variantParts.push(trailing);

  const variant = [...new Set(variantParts)].join(", ") || undefined;
  return { harness, variant };
}
