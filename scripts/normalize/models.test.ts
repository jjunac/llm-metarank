import { describe, expect, it } from "vitest";
import { loadModelRegistry, matchModel } from "./models.js";

const registry = await loadModelRegistry();

describe("canonical model registry", () => {
  it("maps the same model across source naming conventions", () => {
    const examples: Array<[string, string]> = [
      ["Claude Opus 5.5 (Max, Default Fallback)", "claude-opus-5-5"],
      ["Opus 5.5", "claude-opus-5-5"],
      ["Claude Opus 5 (Max)", "claude-opus-5"],
      ["Opus 5 (Claude Code) xhigh", "claude-opus-5"],
      ["claude-opus-4-6-thinking-max", "claude-opus-4-6"],
      ["Fable 5.1 (Claude Code) high", "claude-fable-5-1"],
      ["Claude Fable 5.1 (Max, Default Fallback)", "claude-fable-5-1"],
      ["GPT-6 Astra (Codex) high", "gpt-6-astra"],
      ["OpenAI GPT-6 Astra", "gpt-6-astra"],
      ["gpt-6.1-terra", "gpt-6-1-terra"],
      ["GPT-6.1 Terra (Max)", "gpt-6-1-terra"],
      ["GPT-6.1 Terra (Codex) xhigh", "gpt-6-1-terra"],
      ["gpt-5.6 (sol)", "gpt-5-6-sol"],
      ["Gemini Argon 4", "gemini-4-argon"],
      ["Gemini 4 Argon (High)", "gemini-4-argon"],
      ["Muse Wonder 1.0 (mini-swe-agent) xhigh", "muse-wonder-full"],
      ["Qwen3.8-Max (0902)", "qwen3-8-max"],
      ["GLM-5.3 (mini-swe-agent) max", "glm-5-3"],
      ["glm-5p2", "glm-5-2"],
      ["DeepSeek-V4.1-Flash-20261017 (Max)", "deepseek-v4-1-flash"],
      ["DeepSeek V4.1 Flash 1017 (Max)", "deepseek-v4-1-flash"],
      ["Grok 4.20 (Beta Reasoning)", "grok-4-20-beta"],
      ["Grok 4.20 Beta 1", "grok-4-20-beta"],
    ];

    for (const [raw, expected] of examples) {
      expect(matchModel(registry, raw), raw).toBe(expected);
    }
  });

  it("does not merge distinct model versions", () => {
    expect(matchModel(registry, "Claude Opus 5")).toBe("claude-opus-5");
    expect(matchModel(registry, "Claude Opus 5.5")).toBe("claude-opus-5-5");
    expect(matchModel(registry, "Claude Fable 5")).toBe("claude-fable-5");
    expect(matchModel(registry, "Claude Fable 5.1")).toBe("claude-fable-5-1");
    expect(matchModel(registry, "GPT-6 Sol")).toBe("gpt-6-sol");
    expect(matchModel(registry, "GPT-6.1 Sol")).toBe("gpt-6-1-sol");
    expect(matchModel(registry, "GPT-6.1 Terra")).toBe("gpt-6-1-terra");
    expect(matchModel(registry, "GPT-5.6 Terra")).toBe("gpt-5-6-terra");
  });

  it("ignores unknown legacy models", () => {
    expect(matchModel(registry, "GPT-4o")).toBeNull();
    expect(matchModel(registry, "Claude 3.5 Sonnet")).toBeNull();
    expect(matchModel(registry, "o3 (high) (April 2025)")).toBeNull();
  });
});
