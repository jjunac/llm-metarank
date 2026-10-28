import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceSnapshot } from "./types.js";
import { readJson, todayISO, writeJson } from "./util.js";
import { refreshSource } from "./refresh-source.js";

let dir: string;
const previous: SourceSnapshot = {
  sourceId: "test", fetchedAt: "2026-10-25T00:00:00Z", sourceUpdatedAt: "2026-10-24",
  url: "https://example.com", entries: [{ rawName: "Previous model", score: 80 }], warnings: ["Source caveat"],
};

beforeEach(async () => {
  dir = await mkdtemp(resolve(tmpdir(), "metarank-refresh-"));
  await writeJson(resolve(dir, "test/latest.json"), previous);
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("safe source refresh", () => {
  it("replaces scores even when a source's update/release date is unchanged", async () => {
    const next = { ...previous, fetchedAt: "2026-10-28T00:00:00Z", entries: [{ rawName: "GPT-6.1 Terra", score: 90 }] };
    expect((await refreshSource("test", vi.fn().mockResolvedValue(next), dir)).ok).toBe(true);
    expect(await readJson(resolve(dir, "test/latest.json"))).toEqual(next);
    expect(await readJson(resolve(dir, `test/${todayISO()}.json`))).toEqual(next);
  });

  it.each([
    { ...previous, entries: [] },
    { ...previous, entries: [{ rawName: "Model", score: NaN }] },
    { ...previous, entries: [{ rawName: "", score: 90 }] },
    { ...previous, sourceId: "wrong-source" },
    { ...previous, sourceUpdatedAt: "not a date" },
  ])("retains the last good scores on empty or malformed data", async (invalid) => {
    await writeJson(resolve(dir, `test/${todayISO()}.json`), previous);
    const result = await refreshSource("test", vi.fn().mockResolvedValue(invalid), dir);
    expect(result.ok).toBe(false);
    const retained = await readJson<SourceSnapshot>(resolve(dir, "test/latest.json"));
    expect(retained.entries).toEqual(previous.entries);
    expect(retained.fetchedAt).toBe(previous.fetchedAt);
    expect(retained.warnings).toContain("Source caveat");
    expect(retained.warnings.some((warning) => warning.startsWith("Refresh failed "))).toBe(true);
    expect(await readJson(resolve(dir, `test/${todayISO()}.json`))).toEqual(previous);
  });

  it("keeps a single actionable failure warning and clears it after recovery", async () => {
    const failed = vi.fn().mockRejectedValue(new Error("HTTP 403"));
    await refreshSource("test", failed, dir);
    const retry = await refreshSource("test", failed, dir);
    expect(retry.snapshot?.warnings.filter((warning) => warning.startsWith("Refresh failed "))).toHaveLength(1);
    const recovered = await refreshSource("test", vi.fn().mockResolvedValue(structuredClone(previous)), dir);
    expect(recovered.ok).toBe(true);
    expect(recovered.snapshot?.warnings).toEqual(["Source caveat"]);
  });

  it("reports a failed first fetch without creating fake data", async () => {
    const result = await refreshSource("new-source", vi.fn().mockRejectedValue(new Error("offline")), dir);
    expect(result).toEqual({ ok: false, snapshot: null, error: "offline" });
    await expect(readJson(resolve(dir, "new-source/latest.json"))).rejects.toThrow();
  });
});
