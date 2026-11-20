import { lookup, Resolver } from "node:dns/promises";
import { chromium, type Browser, type Page, type Response } from "playwright";
import type { SourceSnapshot } from "../types.js";
import { nowISO } from "../util.js";
import { parseArenaPayload, parseArenaTable, type ArenaParseResult } from "../parse/arena.js";

interface ArenaOptions {
  sourceId: string;
  url: string;
  expectMinRows: number;
}

function isChallengeTitle(title: string): boolean {
  return /just a moment|security verification|attention required/i.test(title);
}

async function passCloudflareChallenge(page: Page, response: Response | null): Promise<void> {
  const initialTitle = await page.title().catch(() => "");
  const initialStatus = response?.status() ?? 200;
  if (response && !response.ok() && !(initialStatus === 403 && isChallengeTitle(initialTitle))) {
    throw new Error(`Arena: HTTP ${initialStatus} (${initialTitle}); leaderboard access was blocked`);
  }
  if ((response && !response.ok()) || isChallengeTitle(initialTitle)) {
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const title = await page.title().catch(() => "");
      if (title && !isChallengeTitle(title)) break;
      const cfFrame = page.frames?.().find((frame) => frame.url().includes("challenges.cloudflare.com"));
      if (cfFrame) {
        const box = await cfFrame.frameElement().then((el) => el.boundingBox()).catch(() => null);
        if (box && page.mouse) {
          await page.mouse.move(box.x + 28, box.y + box.height / 2, { steps: 5 });
          await page.mouse.click(box.x + 28, box.y + box.height / 2);
        }
      }
      await page.waitForTimeout(2_000);
    }
    const finalTitle = await page.title().catch(() => initialTitle);
    if (!finalTitle || isChallengeTitle(finalTitle)) {
      throw new Error(
        `Arena: HTTP ${initialStatus === 200 ? 403 : initialStatus} (${finalTitle || initialTitle}); leaderboard access was blocked`,
      );
    }
  }
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
      // The legacy headless shell gets stuck on Cloudflare's verification page.
      // Use real Chromium's current headless mode, with normal process isolation.
      channel: "chromium",
      headless: true,
      args: [
        "--disable-blink-features=AutomationControlled",
        ...resolverArgs,
      ],
    });
    const browserVersion = browser.version?.() || "156.0.0.0";
    const context = await browser.newContext({
      userAgent:
        `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browserVersion} Safari/537.36`,
      viewport: { width: 1440, height: 1200 },
      locale: "en-US",
    });
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await passCloudflareChallenge(page, response);
    await page.waitForSelector("table tbody tr, [data-share-rank]", { timeout: 45_000 });

    const fetchedAt = nowISO();
    const html = (await page.content?.().catch(() => "")) ?? "";
    let parsed: ArenaParseResult;
    if (html.includes("self.__next_f.push([1,")) {
      await page.waitForFunction(
        () => document.documentElement.innerHTML.includes("initialBattleCost"),
        undefined,
        { timeout: 15_000 },
      ).catch(() => undefined);
      const finalHtml = (await page.content?.().catch(() => html)) || html;
      parsed = parseArenaPayload(finalHtml, { url, fetchedAt });
    } else {
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
      parsed = parseArenaTable(table.headers, table.rows, { url, fetchedAt });
    }

    const { entries, warnings } = parsed;
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const reportedRowsText = bodyText.match(/\b([\d,]+)\s+models\b/i)?.[1];
    const reportedRows = parsed.expectedRows ?? (reportedRowsText ? Number(reportedRowsText.replaceAll(",", "")) : 0);
    const expectedRows = Math.max(expectMinRows, reportedRows);
    if (entries.length < expectedRows) {
      throw new Error(`Arena: incomplete leaderboard; expected at least ${expectedRows} rows, found ${entries.length}`);
    }
    const updatedMatch = bodyText.match(/(?:Last updated|Updated)[:\s]*([A-Z][a-z]+ \d{1,2}, 20\d{2})/)
      ?? bodyText.match(/([A-Z][a-z]{2} \d{1,2}, 20\d{2})\s*[\d,]+\s+votes/);
    const sourceUpdatedAt = parsed.sourceUpdatedAt ?? (updatedMatch
      ? new Date(`${updatedMatch[1]} UTC`).toISOString().slice(0, 10)
      : undefined);

    const costRows = entries.filter((entry) => entry.cost).length;
    return {
      sourceId,
      fetchedAt,
      sourceUpdatedAt,
      url,
      entries,
      warnings,
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
