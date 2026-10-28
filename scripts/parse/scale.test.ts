import { describe, expect, it } from "vitest";
import { parseScaleLeaderboard } from "./scale.js";

const url = "https://labs.scale.com/leaderboard/test";
const streamed = (data: unknown) => {
  const payload = `1:["$","div",null,${JSON.stringify(data)}]`;
  const split = Math.floor(payload.length / 2);
  return `<p>Last Updated: September 22, 2026</p>${[payload.slice(0, split), payload.slice(split)].map((part) => `<script>self.__next_f.push([1,${JSON.stringify(part)}])</script>`).join("")}`;
};

describe("Scale leaderboard results", () => {
  it("uses the newest result timestamp, not outdated prose or unrelated page metadata", () => {
    const parsed = parseScaleLeaderboard(streamed({
      otherMetadata: { createdAt: "2099-12-31T00:00:00Z" },
      entries: [
        { model: "GPT-6.1 Terra (Codex) xhigh", score: 92.3, rank: 1, createdAt: "2026-10-27T01:00:00Z" },
        { model: "Old model", score: 70, createdAt: "2026-09-20T00:00:00Z" },
        { model: "Deprecated model", score: 99, createdAt: "2026-10-28T00:00:00Z", deprecated: true },
      ],
    }), url);
    expect(parsed.sourceUpdatedAt).toBe("2026-10-27");
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries[0]).toMatchObject({ score: 92.3, date: "2026-10-27", harness: "Codex", variant: "xhigh" });
  });

  it("keeps the active full/hard benchmark variant separate", () => {
    const parsed = parseScaleLeaderboard(streamed({
      variants: [
        { key: "full", entries: [{ model: "Model", score: 99.4, createdAt: "2026-10-28T00:00:00Z" }] },
        { key: "hard", entries: [{ model: "Model", score: 80, createdAt: "2026-10-14T00:00:00Z" }] },
      ], activeTab: "hard",
    }), url);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].score).toBe(80);
    expect(parsed.entries[0].extra?.leaderboardVariant).toBe("hard");
    expect(parsed.sourceUpdatedAt).toBe("2026-10-14");
  });

  it("does not silently select another variant or accept malformed scores", () => {
    expect(() => parseScaleLeaderboard(streamed({ variants: [{ key: "full", entries: [] }], activeTab: "missing" }), url)).toThrow("active leaderboard variant");
    expect(() => parseScaleLeaderboard(streamed({ entries: [{ model: "Model", score: null }] }), url)).toThrow("invalid model/score");
  });

  it("still reads older HTML-only tables", () => {
    const parsed = parseScaleLeaderboard(`<p>Last Updated: September 22, 2026</p><div class="flex items-center gap-3"><p data-model-name="true">Model (high)</p><span class="text-ink">88.1</span></div>`, url);
    expect(parsed.entries[0].score).toBe(88.1);
    expect(parsed.sourceUpdatedAt).toBe("2026-09-22");
  });
});
