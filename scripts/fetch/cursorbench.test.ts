import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCursorBench } from "./cursorbench.js";
import { parseCursorBench } from "../parse/cursorbench.js";

const fetchedAt = "2026-10-28T00:00:00Z";
const table = `<table><thead><tr><th></th><th>Model</th><th>Score</th><th>CostCost / task</th><th>TokensTokens / task</th><th>StepsSteps / task</th></tr></thead><tbody>
<tr><td>1</td><td>Opus 5.5 Max</td><td>57.8%</td><td>$13.43</td><td>218,363</td><td>185</td></tr>
<tr><td>2</td><td>Opus 5.5 High</td><td>56.0%</td><td>$3.97</td><td>53,078</td><td>68</td></tr>
<tr><td>3</td><td>Composer 2.5</td><td>0%</td><td>N/A</td><td>0</td><td>0</td></tr>
</tbody></table>`;
const methodology = "<p>Avg cost / task is computed by applying each model's published per-million-token pricing to the tokens it used on each task.</p>";
const html = `<h1>CursorBench 4.0</h1>${table}${table}<h2>Changelog</h2><h3>Oct 7, 2026</h3>${methodology}`;

afterEach(() => vi.unstubAllGlobals());

describe("CursorBench", () => {
  it("deduplicates responsive tables and pairs each rounded score with its own cost and effort", () => {
    const { entries } = parseCursorBench(html, fetchedAt);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      rawName: "Opus 5.5 Max", score: 57.8, variant: "Max", harness: "Cursor · CursorBench 4.0",
      extra: { tokensPerTask: 218363, stepsPerTask: 185 },
      cost: { usd: 13.43, statistic: "mean", method: "usage-estimate", fetchedAt, complete: true },
    });
    expect(entries[1].cost?.usd).toBe(3.97);
    expect(entries[0].runId).not.toBe(entries[1].runId);
    expect(entries[2].score).toBe(0);
    expect(entries[2].cost).toBeUndefined();
  });

  it("does not mistake token pricing or unverified cost statistics for average task costs", () => {
    expect(parseCursorBench(html.replaceAll("CostCost / task", "API Price $/M"), fetchedAt).entries.every((entry) => !entry.cost)).toBe(true);
    expect(parseCursorBench(html.replaceAll("CostCost / task", "Cost / task (P50)"), fetchedAt).entries.every((entry) => !entry.cost)).toBe(true);
    const unverified = parseCursorBench(html.replace(methodology, ""), fetchedAt);
    expect(unverified.entries.every((entry) => !entry.cost)).toBe(true);
    expect(unverified.warnings).not.toHaveLength(0);
  });

  it("rejects new versions, incomplete tables and conflicting responsive copies", () => {
    expect(() => parseCursorBench(html.replace("CursorBench 4.0", "CursorBench 5.0"), fetchedAt)).toThrow("expected version");
    expect(() => parseCursorBench(html.replaceAll("57.8%", "—"), fetchedAt)).toThrow("incomplete");
    expect(() => parseCursorBench(html.replace("$13.43", "$0.01"), fetchedAt)).toThrow("conflicting duplicate");
    expect(() => parseCursorBench("<h1>CursorBench 4.0</h1>", fetchedAt)).toThrow("no model score table");
  });

  it("keeps release and retrieval dates separate from pricing changelog dates", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(html)));
    const snapshot = await fetchCursorBench();
    expect(snapshot.benchmarkRelease).toBe("2026-09-10");
    expect(snapshot.sourceUpdatedAt).toBeUndefined();
    expect(snapshot.entries[0].date).toBeUndefined();
    expect(snapshot.costStatus?.status).toBe("available");
    expect(vi.mocked(fetch).mock.calls[0][1]?.cache).toBe("no-cache");
  });
});
