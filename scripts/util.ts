import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parse as parseCsvSync } from "csv-parse/sync";

export const ROOT = resolve(import.meta.dirname, "..");
export const DATA_DIR = resolve(ROOT, "data");
export const SNAPSHOT_DIR = resolve(DATA_DIR, "snapshots");

export function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function nowISO(): string {
  return new Date().toISOString();
}

export function parseNumber(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (!value) return null;
  const match = String(value).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

const MONTHS: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
};

/** Finds dates like "September 22, 2026", "2026-09-22", or "Sep 22, 2026". */
export function findDate(text: string): string | undefined {
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];

  const long = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(20\d{2})\b/i,
  );
  if (long) {
    const month = MONTHS[long[1].toLowerCase()];
    return `${long[3]}-${month}-${long[2].padStart(2, "0")}`;
  }

  const short = text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{1,2}),\s*(20\d{2})\b/i);
  if (short) {
    const key = short[1].toLowerCase().replace("sept", "sep");
    const monthNames: Record<string, string> = {
      jan: "january",
      feb: "february",
      mar: "march",
      apr: "april",
      may: "may",
      jun: "june",
      jul: "july",
      aug: "august",
      sep: "september",
      oct: "october",
      nov: "november",
      dec: "december",
    };
    const month = MONTHS[monthNames[key]];
    return `${short[3]}-${month}-${short[2].padStart(2, "0")}`;
  }

  return undefined;
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function fetchText(
  url: string,
  init: RequestInit = {},
  { retries = 3, timeoutMs = 45_000 }: { retries?: number; timeoutMs?: number } = {},
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
          accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`${url} returned HTTP ${response.status}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(500 * 2 ** attempt);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  return JSON.parse(await fetchText(url, init)) as T;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

export function parseCsv(text: string): Record<string, string>[] {
  return parseCsvSync(text, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as Record<string, string>[];
}

export function extractFirstNumber(text: string): number | null {
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

export function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function formatDate(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}
