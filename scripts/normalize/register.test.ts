import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { CanonicalModel, SourceSnapshot } from "../types.js";
import { readJson, writeJson } from "../util.js";
import { cleanDisplayName, discoverNewModels, normalizeVendor, registerNewModels } from "./register.js";

function makeSnapshot(sourceId: string, entries: SourceSnapshot["entries"]): SourceSnapshot {
  return {
    sourceId,
    fetchedAt: "2026-11-10T00:00:00.000Z",
    url: `https://example.com/${sourceId}`,
    entries,
    warnings: [],
  };
}

describe("automatic model registration", () => {
  it("cleans display names and normalizes vendors across naming styles", () => {
    expect(cleanDisplayName("Claude Fable 5.2 (Max, Default Fallback)", "claude fable 5 2")).toBe("Claude Fable 5.2");
    expect(cleanDisplayName("Fable 5.2 Extra High", "claude fable 5 2")).toBe("Claude Fable 5.2");
    expect(cleanDisplayName("claude-fable-5.2", "claude fable 5 2")).toBe("Claude Fable 5.2");
    expect(cleanDisplayName("Ling 3.1 Flash 1019", "ling 3 1 flash")).toBe("Ling 3.1 Flash");
    expect(cleanDisplayName("Qwen3.8-Max (0902)", "qwen3 8 max")).toBe("Qwen3.8 Max");

    expect(normalizeVendor("xAI", "grok 4 8")).toBe("SpaceXAI");
    expect(normalizeVendor("Z AI", "glm 5 4")).toBe("Z.ai");
    expect(normalizeVendor("Thinky", "inkling 2 small")).toBe("Thinking Machines");
    expect(normalizeVendor(undefined, "claude fable 5 2")).toBe("Anthropic");
    expect(normalizeVendor(undefined, "gemini 4 carbon")).toBe("Google");
  });

  it("discovers and merges new models across current-cohort and historical sources", () => {
    const existing: CanonicalModel[] = [
      {
        id: "claude-opus-5-5",
        name: "Claude Opus 5.5",
        vendor: "Anthropic",
        aliases: ["claude opus 5 5", "opus 5 5"],
      },
    ];

    const snapshots: SourceSnapshot[] = [
      makeSnapshot("artificial-analysis", [
        {
          rawName: "Claude Opus 5.5 (Max, Default Fallback)",
          score: 59.1,
          vendor: "Anthropic",
        },
        {
          rawName: "Claude Fable 5.2 (Max, Default Fallback)",
          score: 64.5,
          vendor: "Anthropic",
          extra: {
            slug: "claude-fable-5-2",
            modelReleaseDate: "2026-11-09",
            isOpenWeights: false,
          },
        },
      ]),
      makeSnapshot("cursorbench", [
        { rawName: "Fable 5.2 Max", score: 60 },
        { rawName: "Fable 5.2 High", score: 57 },
      ]),
      makeSnapshot("livebench", [
        { rawName: "claude-fable-5.2", score: 85.2 },
      ]),
      makeSnapshot("frontiermath", [
        {
          rawName: "GPT-6.2 Pro (xhigh)",
          score: 52.0,
          vendor: "OpenAI",
          date: "2026-11-08",
          extra: { modelReleaseDate: "2026-11-07" },
        },
      ]),
    ];

    const discovered = discoverNewModels(existing, snapshots);
    expect(discovered).toEqual([
      {
        id: "claude-fable-5-2",
        name: "Claude Fable 5.2",
        vendor: "Anthropic",
        releaseDate: "2026-11-09",
        openWeights: false,
        aliases: ["claude fable 5 2", "fable 5 2"],
      },
      {
        id: "gpt-6-2-pro",
        name: "GPT-6.2 Pro",
        vendor: "OpenAI",
        releaseDate: "2026-11-07",
        aliases: ["gpt 6 2 pro"],
      },
    ]);
  });

  it("excludes legacy models and baseline-excluded entries", () => {
    const snapshots: SourceSnapshot[] = [
      makeSnapshot("lmarena-text", [
        { rawName: "GPT-4o (2024-08-06)", score: 1285, vendor: "OpenAI" },
        { rawName: "Claude 3.5 Sonnet (20241022)", score: 1300, vendor: "Anthropic" },
        { rawName: "U2 Flash", score: 1320, vendor: "Unisound" },
      ]),
      makeSnapshot("frontiermath", [
        {
          rawName: "o3 (high)",
          score: 30,
          vendor: "OpenAI",
          date: "2026-08-27",
          extra: { modelReleaseDate: "2025-04-16" },
        },
        {
          rawName: "Qwen3.5 Flash (thinking)",
          score: 25,
          vendor: "Alibaba",
          date: "2026-08-28",
          extra: { modelReleaseDate: "2026-02-25" },
        },
      ]),
      makeSnapshot("livebench", [
        { rawName: "smaug-nemotron-3.5-nvfp4", score: 42 },
      ]),
    ];

    const baselineKeysBySource = new Map<string, Set<string>>([
      ["livebench", new Set(["smaug nemotron 3 5 nvfp4"])],
      ["lmarena-text", new Set(["gpt 4o", "claude 3 5 sonnet"])],
    ]);

    const discovered = discoverNewModels([], snapshots, { baselineKeysBySource });
    expect(discovered).toEqual([]);
  });

  it("writes newly discovered models to models.json and is idempotent on repeat runs", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "metarank-register-"));
    try {
      const modelsPath = resolve(dir, "models.json");
      const snapshotDir = resolve(dir, "snapshots");
      await mkdir(resolve(snapshotDir, "artificial-analysis"), { recursive: true });

      const initialModels: CanonicalModel[] = [
        {
          id: "claude-opus-5-5",
          name: "Claude Opus 5.5",
          vendor: "Anthropic",
          aliases: ["claude opus 5 5"],
        },
      ];
      await writeJson(modelsPath, initialModels);
      await writeJson(
        resolve(snapshotDir, "artificial-analysis", "latest.json"),
        makeSnapshot("artificial-analysis", [
          {
            rawName: "Gemini 4 Carbon (High)",
            score: 60.0,
            vendor: "Google",
            extra: { modelReleaseDate: "2026-10-28", isOpenWeights: false },
          },
        ]),
      );

      const firstRun = await registerNewModels({ modelsPath, snapshotDir });
      expect(firstRun).toHaveLength(1);
      expect(firstRun[0]?.id).toBe("gemini-4-carbon");

      const secondRun = await registerNewModels({ modelsPath, snapshotDir });
      expect(secondRun).toHaveLength(0);

      const saved = await readJson<CanonicalModel[]>(modelsPath);
      expect(saved).toHaveLength(2);
      expect(saved.map((model) => model.id)).toEqual(["claude-opus-5-5", "gemini-4-carbon"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
