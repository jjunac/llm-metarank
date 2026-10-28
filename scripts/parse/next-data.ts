/** Read streamed server data without executing any website JavaScript. */
export function extractNextPayload(html: string): string {
  const parts = [...html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/gs)];
  if (!parts.length) throw new Error("No Next.js payload found");
  return parts.map((match) => JSON.parse(`"${match[1]}"`) as string).join("");
}

/** Extract an embedded JSON object/array, including nested and escaped values. */
export function extractJsonProperty<T>(payload: string, key: string): T | undefined {
  const marker = `"${key}":`;
  const markerIndex = payload.indexOf(marker);
  if (markerIndex < 0) return undefined;
  let start = markerIndex + marker.length;
  while (/\s/.test(payload[start] ?? "") && start < payload.length) start += 1;
  if (payload[start] !== "[" && payload[start] !== "{") return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < payload.length; index += 1) {
    const char = payload[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "[" || char === "{") depth += 1;
    else if (char === "]" || char === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(payload.slice(start, index + 1)) as T;
    }
  }
  throw new Error(`Could not parse ${key}`);
}
