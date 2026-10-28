import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchArtificialAnalysis } from "./artificial-analysis.js";
import { fetchArcAgi3 } from "./arc.js";
import { fetchGso } from "./gso.js";
import { fetchTerminalBench } from "./terminal-bench.js";
import { findDate } from "../util.js";

afterEach(() => vi.unstubAllGlobals());
const feed = (data: unknown) => vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json(data)));

describe("other source refreshes", () => {
  it("recognizes timestamps as well as human-readable dates", () => {
    expect(findDate("2026-10-27T07:02:27.000Z")).toBe("2026-10-27");
    expect(findDate("Updated October 27, 2026")).toBe("2026-10-27");
  });

  it("refreshes new Artificial Analysis scores without applying obsolete task costs", async () => {
    const data = { initialModels: [{ id: "terra", name: "GPT-6.1 Terra (Max)", intelligenceIndex: 50.97, releaseDate: "2026-10-26" }] };
    const html = `<h1>Artificial Analysis Intelligence Index v5.0</h1><script>self.__next_f.push([1,${JSON.stringify(JSON.stringify(data))}])</script>`;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(html)));
    const snapshot = await fetchArtificialAnalysis();
    expect(snapshot.entries[0]).toMatchObject({ rawName: "GPT-6.1 Terra (Max)", score: 50.97 });
    expect(snapshot.entries[0].cost).toBeUndefined();
    expect(snapshot.entries[0].date).toBeUndefined();
    expect(snapshot.entries[0].extra?.modelReleaseDate).toBe("2026-10-26");
    expect(snapshot.warnings.join(" ")).toContain("v5.0 scores refreshed");
  });

  it("uses GSO feed metadata even when no new model was submitted", async () => {
    feed({ metadata: { last_updated: "2026-10-27" }, models: [
      { name: "Model", setting: "Opt@1", score: 50, date: "2026-09-20" },
      { name: "Different setting", setting: "Opt@5", score: 99, date: "2026-10-28" },
    ] });
    const snapshot = await fetchGso();
    expect(snapshot.sourceUpdatedAt).toBe("2026-10-27");
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0].score).toBe(50);
  });

  it("keeps ARC's dataset, percentage conversion and run totals without mislabeling release dates", async () => {
    const row = { datasetId: "v3_Semi_Private", modelId: "model", modelDisplayName: "Model", score: 0.42, cost: 100, modelReleaseDate: "2026-09-20T00:00:00Z" };
    feed({ generatedAt: "2026-10-27T01:00:00Z", evaluations: [row, { ...row, datasetId: "v2" }, { ...row, display: false }, { ...row, modelId: "random_baseline" }] });
    const snapshot = await fetchArcAgi3();
    expect(snapshot.sourceUpdatedAt).toBe("2026-10-27");
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]).toMatchObject({ score: 42, runCostUsd: 100 });
    expect(snapshot.entries[0].cost).toBeUndefined();
    expect(snapshot.entries[0].date).toBeUndefined();
  });

  it("refreshes Terminal-Bench from the official API and considers board-level updates", async () => {
    feed({ leaderboard: { updated_at: "2026-10-27T00:00:00Z" }, rows: [
      { id: "run", metadata: { model_display: { label: "Model" } }, metrics: { accuracy: 64.85, total_cost_usd: 4718.65, n_trials: 330 }, n_trials: 330, updated_at: "2026-10-06T00:00:00Z" },
    ] });
    const snapshot = await fetchTerminalBench();
    expect(snapshot.sourceUpdatedAt).toBe("2026-10-27");
    expect(snapshot.entries[0].score).toBe(64.85);
    expect(snapshot.entries[0].cost?.usd).toBeCloseTo(4718.65 / 330);
    const [, request] = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(request?.body as string)).toEqual({ package: "terminal-bench/terminal-bench", name: "4-0-0" });
  });
});
