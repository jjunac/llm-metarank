import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchFrontierMath } from "./frontiermath.js";
import { FRONTIERMATH_TASK, parseFrontierMath } from "../parse/frontiermath.js";

const base = {
  id_runs: "run", task: FRONTIERMATH_TASK, model: "gpt-6.1-terra_max", Model: "GPT-6.1 Terra",
  "Unique display name": "GPT-6.1 Terra (max)", mean_score: "0.9087719298245615",
  Status: "Success", "task version": "2.0.0", started_at: "2026-10-26T20:00:37.000Z",
  "Version release date": "2026-10-25", Organization: "OpenAI", stderr: "0.0170856901",
  billable_input_tokens: "999999", "Training compute cost (2023 USD)": "1000000",
};
function csv(rows: Array<Partial<typeof base>>): string {
  const keys = Object.keys(base) as Array<keyof typeof base>;
  const cell = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return [keys.map(cell).join(","), ...rows.map((row) => keys.map((key) => cell(({ ...base, ...row })[key])).join(","))].join("\n");
}

afterEach(() => vi.unstubAllGlobals());

describe("FrontierMath", () => {
  it("reads the official run CSV, converts fractional accuracy and preserves effort, version and result dates", () => {
    const { entries, sourceUpdatedAt } = parseFrontierMath(csv([{}]));
    expect(entries[0]).toMatchObject({
      rawName: "GPT-6.1 Terra (max)", variant: "max · task v2.0.0", harness: "Epoch AI · Python tool",
      date: "2026-10-26", runId: "run", extra: { task: FRONTIERMATH_TASK, taskVersion: "2.0.0", modelReleaseDate: "2026-10-25" },
    });
    expect(entries[0].score).toBeCloseTo(90.87719298245615);
    expect(sourceUpdatedAt).toBe("2026-10-26");
    expect(entries[0].cost).toBeUndefined();
  });

  it("does not mix tiers, old datasets, public examples, unsuccessful runs or unsupported versions", () => {
    const result = parseFrontierMath(csv([
      {},
      { task: "FrontierMath-Tier-4-v2-Private", started_at: "2026-10-28" },
      { task: "FrontierMath-2025-02-28-Private" },
      { task: "FrontierMath-Tiers-1-3-v2-Public" },
      { Status: "Error", started_at: "2026-10-28" },
      { "task version": "3.0.0" },
    ]));
    expect(result.entries).toHaveLength(1);
    expect(result.sourceUpdatedAt).toBe("2026-10-26");
    expect(result.warnings[0]).toContain("Excluded 2");
  });

  it("keeps zero accuracy and never substitutes a model release date for a missing run date", () => {
    const result = parseFrontierMath(csv([{ mean_score: "0.0", started_at: "" }]));
    expect(result.entries[0].score).toBe(0);
    expect(result.entries[0].date).toBeUndefined();
    expect(result.sourceUpdatedAt).toBeUndefined();
  });

  it("rejects empty/malformed feeds, duplicate runs and invalid accuracy rather than silently dropping rows", () => {
    expect(() => parseFrontierMath("model,score\nModel,99")).toThrow("CSV columns");
    expect(() => parseFrontierMath(csv([{ mean_score: "" }]))).toThrow("fractional accuracy");
    expect(() => parseFrontierMath(csv([{ mean_score: "90.8" }]))).toThrow("fractional accuracy");
    expect(() => parseFrontierMath(csv([{}, {}]))).toThrow("duplicate run");
    expect(() => parseFrontierMath(csv([{ Status: "Error" }]))).toThrow("no successful");
  });

  it("fetches fresh CSV while keeping the benchmark release separate from evaluation dates", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(csv([{}]))));
    const snapshot = await fetchFrontierMath();
    expect(snapshot.benchmarkRelease).toBe("2026-06-12");
    expect(snapshot.sourceUpdatedAt).toBe("2026-10-26");
    expect(snapshot.costStatus?.status).toBe("not-reported");
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe("https://epoch.ai/data/benchmarks.csv");
  });
});
