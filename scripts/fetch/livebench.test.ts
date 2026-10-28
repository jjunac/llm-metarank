import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLiveBench } from "./livebench.js";

const release = "20261025";
const bundle = 'const releases=["20261014","20261025"],modelDate="20991231",cache="?v=1793084497";';
const categories = { "Long Agentic": ["long_agentic"], Coding: ["coding"], _overall_weights: { "Long Agentic": 2, Coding: 1.5 } };
const costCsv = "model,long_agentic,nq_long_agentic,coding,nq_coding\ngpt-6.1-sol,180,18,29,29\ngpt-6.1-terra,90,18,58,29\n";

function mockSite(options: { table?: () => string; modified?: string | null; categoryData?: unknown } = {}) {
  const mock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url === "https://livebench.ai/") return new Response('<script src="./static/js/main.test.js"></script>');
    if (url.endsWith("main.test.js")) return new Response(bundle);
    if (url.includes(`/data/${release}/table.csv?v=`)) {
      return new Response(options.table?.() ?? "model,long_agentic,coding\ngpt-6.1-terra,48.6,94.3\n", {
        headers: options.modified === null ? {} : { "last-modified": options.modified ?? "Tue, 27 Oct 2026 07:02:27 GMT" },
      });
    }
    if (url.includes(`/data/${release}/categories.json?v=`)) return Response.json(options.categoryData ?? categories);
    if (url.includes(`/data/${release}/cost.csv?v=`)) return new Response(costCsv);
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => vi.unstubAllGlobals());

describe("LiveBench refresh", () => {
  it("keeps the benchmark release separate from results updates and joins same-release costs", async () => {
    const requests = mockSite();
    const snapshot = await fetchLiveBench();
    expect(snapshot.benchmarkRelease).toBe("2026-10-25");
    expect(snapshot.sourceUpdatedAt).toBe("2026-10-27");
    expect(snapshot.entries[0].date).toBeUndefined();
    expect(snapshot.entries[0].extra?.releaseId).toBe(release);
    expect(snapshot.entries[0].score).toBeCloseTo((48.6 * 2 + 94.3 * 1.5) / 3.5);
    expect(snapshot.entries[0].cost?.usd).toBeCloseTo(148 / 47);
    expect(snapshot.entries[0].metricCosts?.coding.usd).toBe(2);
    expect(requests.mock.calls.some(([url]) => String(url).includes("20991231"))).toBe(false);
    expect(requests.mock.calls.filter(([url]) => String(url).includes("/data/")).every(([url]) => String(url).endsWith("?v=1793084497"))).toBe(true);
  });

  it("downloads changed scores and newly added models even when the release is unchanged", async () => {
    let table = "model,long_agentic,coding\ngpt-6.1-sol,68.7,96.0\n";
    mockSite({ table: () => table });
    expect((await fetchLiveBench()).entries).toHaveLength(1);
    table = "model,long_agentic,coding\ngpt-6.1-sol,70.0,97.0\ngpt-6.1-terra,48.6,94.3\n";
    const updated = await fetchLiveBench();
    expect(updated.entries.map((entry) => entry.rawName)).toContain("gpt-6.1-terra");
    expect(updated.entries[0].metrics?.coding).toBe(97);
    expect(updated.benchmarkRelease).toBe("2026-10-25");
  });

  it("does not invent an update date from the release when HTTP metadata is absent", async () => {
    mockSite({ modified: null });
    expect((await fetchLiveBench()).sourceUpdatedAt).toBeUndefined();
  });

  it("fails instead of silently falling back to an older release", async () => {
    const requests = mockSite({ table: () => "<!doctype html><h1>Not found</h1>" });
    await expect(fetchLiveBench()).rejects.toThrow("invalid table.csv for current release");
    expect(requests.mock.calls.some(([url]) => String(url).includes("/data/20261014/"))).toBe(false);
  });

  it("rejects a missing category schema instead of publishing an empty snapshot", async () => {
    mockSite({ categoryData: {} });
    await expect(fetchLiveBench()).rejects.toThrow("missing categories");
  });
});
