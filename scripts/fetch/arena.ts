import { lookup, Resolver } from "node:dns/promises";
import { chromium, type Browser } from "playwright";
import type { SourceSnapshot } from "../types.js";
import { nowISO } from "../util.js";
import { parseArenaTable } from "../parse/arena.js";

interface ArenaOptions {
  sourceId: string;
  url: string;
  expectMinRows: number;
}

/**
 * Chromium's bundled resolver can fail in restricted environments even when the
 * operating system resolves the host. Fall back to public DNS only in that case;
 * normal machines keep their system resolver.
 */
async function hostResolverArgs(hosts: string[]): Promise<string[]> {
  try {
    await lookup(hosts[0]);
    return [];
  } catch {
    try {
      const resolver = new Resolver();
      resolver.setServers(["1.1.1.1", "8.8.8.8"]);
      const [address] = await resolver.resolve4(hosts[0]);
      if (!address) return [];
      return [`--host-resolver-rules=${hosts.map((host) => `MAP ${host} ${address}`).join(", ")}`];
    } catch {
      return [];
    }
  }
}

async function scrapeArena({ sourceId, url, expectMinRows }: ArenaOptions): Promise<SourceSnapshot> {
  let browser: Browser | undefined;
  try {
    const resolverArgs = await hostResolverArgs(["arena.ai", "www.arena.ai"]);
    browser = await chromium.launch({
      headless: true,
      args: [
        "--disable-crashpad",
        "--no-zygote",
        "--single-process",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-blink-features=AutomationControlled",
        ...resolverArgs,
      ],
    });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
      viewport: { width: 1440, height: 1200 },
      locale: "en-US",
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector("table tbody tr", { timeout: 45_000 });

    const headers = await page.locator("table").first().locator("thead th").allInnerTexts().catch(() => [] as string[]);
    const costIndex = headers.findIndex((header) => /cost\s*\/\s*task/i.test(header) && /p50|median/i.test(header));
    if (costIndex >= 0) {
      // Cost cells can stream in after the score rows, especially on Code Arena.
      await page.waitForFunction((index) => {
        const rows = [...document.querySelectorAll("table tbody tr")];
        return rows.some((row) => {
          const cell = row.children[index] as HTMLElement | undefined;
          const text = cell ? `${cell.innerText} ${cell.textContent}` : "";
          return /\$|N\/A/.test(text);
        });
      }, costIndex, { timeout: 15_000 }).catch(() => undefined);
    }
    await page.waitForTimeout(1_500);

    const table = await page.evaluate(() => {
      const table = document.querySelector("table");
      if (!table) return { headers: [], rows: [] };
      return {
        headers: [...table.querySelectorAll("thead th")].map((cell) => (cell as HTMLElement).innerText.trim()),
        rows: [...table.querySelectorAll("tbody tr")].map((row) =>
          [...row.querySelectorAll("td")].map((cell) =>
            ((cell as HTMLElement).innerText || (cell as HTMLElement).textContent ||
              (cell as HTMLElement).getAttribute("title") || (cell as HTMLElement).getAttribute("aria-label") || "").trim(),
          ),
        ),
      };
    });
    const fetchedAt = nowISO();
    const { entries, warnings } = parseArenaTable(table.headers, table.rows, { url, fetchedAt });

    const bodyText = await page.locator("body").innerText().catch(() => "");
    const updatedMatch = bodyText.match(/(?:Last updated|Updated)[:\s]*([A-Z][a-z]+ \d{1,2}, 20\d{2})/)
      ?? bodyText.match(/([A-Z][a-z]{2} \d{1,2}, 20\d{2})\s*[\d,]+\s+votes/);
    const sourceUpdatedAt = updatedMatch
      ? new Date(`${updatedMatch[1]} UTC`).toISOString().slice(0, 10)
      : undefined;

    const costRows = entries.filter((entry) => entry.cost).length;
    return {
      sourceId,
      fetchedAt,
      sourceUpdatedAt,
      url,
      entries,
      warnings: [...warnings, ...(entries.length < expectMinRows ? [`Expected at least ${expectMinRows} rows, found ${entries.length}.`] : [])],
      costStatus: {
        status: costRows > 0 ? "available" : "unavailable",
        url,
        note: costRows > 0
          ? `Reported median (P50) cost per task from the Cost/Task (P50) column (${costRows}/${entries.length} rows). P50 is available only in single-benchmark views and is never pooled with means; API Price $/M is never substituted.`
          : "The Cost/Task (P50) column was not present or contained no numeric values. API Price $/M is never substituted.",
      },
    };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

export function fetchLmArenaText(): Promise<SourceSnapshot> {
  return scrapeArena({
    sourceId: "lmarena-text",
    url: "https://arena.ai/leaderboard/chat/text",
    expectMinRows: 50,
  });
}

export function fetchCodeArenaWebdev(): Promise<SourceSnapshot> {
  return scrapeArena({
    sourceId: "code-arena-webdev",
    url: "https://arena.ai/leaderboard/code/webdev",
    expectMinRows: 50,
  });
}
