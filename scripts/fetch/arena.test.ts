import { beforeEach, describe, expect, it, vi } from "vitest";
import { chromium, type Browser } from "playwright";
import { fetchCodeArenaWebdev, fetchLmArenaText } from "./arena.js";

vi.mock("playwright", () => ({ chromium: { launch: vi.fn() } }));
vi.mock("node:dns/promises", () => ({ lookup: vi.fn().mockResolvedValue({ address: "127.0.0.1", family: 4 }), Resolver: vi.fn() }));

const headers = ["Model", "Score", "Cost/Task (P50)"];
const rows = Array.from({ length: 50 }, (_, index) => [index ? `Model ${index}\nVendor` : "GPT-6.1 Terra (Max)\nOpenAI", "1671\n±16", "$0.05"]);
const page = {
  goto: vi.fn(), title: vi.fn(), waitForSelector: vi.fn(), waitForFunction: vi.fn(), waitForTimeout: vi.fn(),
  evaluate: vi.fn(), locator: vi.fn(), content: vi.fn(), frames: vi.fn(),
  mouse: { move: vi.fn(), click: vi.fn() },
};
const browser = { newContext: vi.fn(), close: vi.fn(), version: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(chromium.launch).mockResolvedValue(browser as unknown as Browser);
  browser.newContext.mockResolvedValue({ newPage: vi.fn().mockResolvedValue(page) });
  browser.close.mockResolvedValue(undefined);
  browser.version.mockReturnValue("156.0.8078.4");
  page.waitForSelector.mockResolvedValue(undefined);
  page.waitForFunction.mockResolvedValue(undefined);
  page.waitForTimeout.mockResolvedValue(undefined);
  page.goto.mockResolvedValue({ ok: () => true, status: () => 200 });
  page.title.mockResolvedValue("WebDev Arena");
  page.content.mockResolvedValue("<html><body><table></table></body></html>");
  page.frames.mockReturnValue([]);
  page.evaluate.mockResolvedValue({ headers, rows });
  page.locator.mockImplementation((selector: string) => selector === "body"
    ? { innerText: vi.fn().mockResolvedValue("Oct 27, 2026\n100,000 votes\n50 models") }
    : { first: () => ({ locator: () => ({ allInnerTexts: vi.fn().mockResolvedValue(headers) }) }) });
});

describe("Arena browser refresh", () => {
  it.each([fetchLmArenaText, fetchCodeArenaWebdev])("uses real Chromium headless mode and collects the full score/cost table", async (fetcher) => {
    const snapshot = await fetcher();
    expect(chromium.launch).toHaveBeenCalledWith(expect.objectContaining({ channel: "chromium", headless: true }));
    expect(vi.mocked(chromium.launch).mock.calls[0][0]?.args).not.toContain("--single-process");
    expect(snapshot.entries).toHaveLength(50);
    expect(snapshot.entries[0].rawName).toBe("GPT-6.1 Terra (Max)");
    expect(snapshot.entries[0].cost?.usd).toBe(0.05);
    expect(snapshot.sourceUpdatedAt).toBe("2026-10-27");
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("reports a blocked navigation immediately and still closes the browser", async () => {
    page.goto.mockResolvedValue({ ok: () => false, status: () => 403 });
    page.title.mockResolvedValue("Just a moment...");
    await expect(fetchLmArenaText()).rejects.toThrow("HTTP 403 (Just a moment...)");
    expect(page.waitForSelector).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("rejects a partially loaded table rather than replacing a good snapshot", async () => {
    page.evaluate.mockResolvedValue({ headers, rows: rows.slice(0, 2) });
    await expect(fetchCodeArenaWebdev()).rejects.toThrow("incomplete leaderboard");
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("checks the site's reported total, not just a fixed minimum", async () => {
    page.locator.mockImplementation((selector: string) => selector === "body"
      ? { innerText: vi.fn().mockResolvedValue("Oct 27, 2026\n100,000 votes\n60 models") }
      : { first: () => ({ locator: () => ({ allInnerTexts: vi.fn().mockResolvedValue(headers) }) }) });
    await expect(fetchCodeArenaWebdev()).rejects.toThrow("expected at least 60 rows, found 50");
  });

  it("solves the Cloudflare Turnstile challenge and parses the Next.js leaderboard payload", async () => {
    page.goto.mockResolvedValue({ ok: () => false, status: () => 403 });
    page.title
      .mockResolvedValueOnce("Just a moment...")
      .mockResolvedValueOnce("Just a moment...")
      .mockResolvedValue("Text Arena: LLM Rankings & AI Model Benchmarks");
    page.frames.mockReturnValue([{
      url: () => "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/f/av0/rch/test",
      frameElement: () => Promise.resolve({ boundingBox: () => Promise.resolve({ x: 200, y: 300, width: 300, height: 65 }) }),
    }]);
    const payload = JSON.stringify({
      leaderboard: {
        voteCutoffISOString: "2026-11-20T00:00:00.000Z",
        totalModels: 51,
        entries: [
          ...Array.from({ length: 50 }, (_, index) => ({
            rank: index + 1,
            modelKey: `model-${index}`,
            modelDisplayName: index === 0 ? "Gemini 4 Carbon (High)" : `Model ${index}`,
            rating: 1526.97 - index,
            votes: 4262,
            modelOrganization: "Google",
          })),
          {
            rank: 0,
            modelKey: "day1-preview",
            modelDisplayName: "Ernie 5.5 Flash Preview",
            rating: 1667.98,
            votes: 284,
            modelOrganization: "Baidu",
            isDay1: true,
          },
        ],
      },
      initialBattleCost: {
        entries: [{
          modelKey: "model-0",
          medianUsd: 0.048602,
          totalSampleCount: 3417,
          pricedSampleCount: 3417,
        }],
      },
    });
    page.content.mockResolvedValue(`<script>self.__next_f.push([1,${JSON.stringify(payload)}])</script>`);

    const snapshot = await fetchLmArenaText();
    expect(page.mouse.click).toHaveBeenCalledWith(228, 332.5);
    expect(snapshot.entries).toHaveLength(50);
    expect(snapshot.entries[0].rawName).toBe("Gemini 4 Carbon (High)");
    expect(snapshot.entries[0].score).toBe(1527);
    expect(snapshot.entries[0].cost?.usd).toBe(0.048602);
    expect(snapshot.sourceUpdatedAt).toBe("2026-11-20");
  });
});
