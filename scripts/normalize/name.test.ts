import { describe, expect, it } from "vitest";
import { canonicalModelKey, normalizeModelName } from "./name.js";

describe("normalizeModelName", () => {
  it("strips variants and parentheticals", () => {
    expect(normalizeModelName("Claude Opus 5.5 (Max, Default Fallback)")).toBe("claude opus 5 5");
    expect(normalizeModelName("Opus 5 (Claude Code) xhigh")).toBe("opus 5");
    expect(normalizeModelName("GLM-5.3 (mini-swe-agent) max")).toBe("glm 5 3");
    expect(normalizeModelName("Muse Wonder 1.0 (mini-swe-agent) xhigh")).toBe("muse wonder 1 0");
    expect(normalizeModelName("Fable 5.2 Max")).toBe("fable 5 2");
  });

  it("preserves model suffixes wrapped in parentheses", () => {
    expect(normalizeModelName("gpt-5.6 (sol)")).toBe("gpt 5 6 sol");
    expect(normalizeModelName("gpt-5.6 (terra)")).toBe("gpt 5 6 terra");
  });

  it("removes release dates and snapshot dates", () => {
    expect(normalizeModelName("DeepSeek-V4.1-Flash-20261017")).toBe("deepseek v4 1 flash");
    expect(normalizeModelName("DeepSeek V4.1 Flash 1017 (Max)")).toBe("deepseek v4 1 flash");
    expect(normalizeModelName("DeepSeek V4.1 Flash 1017 Max")).toBe("deepseek v4 1 flash");
    expect(normalizeModelName("gpt-5.4-pro-2026-03-05 (xhigh thinking)")).toBe("gpt 5 4 pro");
    expect(normalizeModelName("Ling 3.1 Flash 1019")).toBe("ling 3 1 flash");
  });

  it("normalizes vendor prefixes, decimal p notation, and separators", () => {
    expect(normalizeModelName("Anthropic Opus 4.6 (Max)")).toBe("opus 4 6");
    expect(normalizeModelName("Google Gemini 4 Argon (High)")).toBe("gemini 4 argon");
    expect(normalizeModelName("NVIDIA-Nemotron-3.5-Super-VL")).toBe("nemotron 3 5 super vl");
    expect(normalizeModelName("Qwen3.8-Max (0902)")).toBe("qwen3 8 max");
    expect(normalizeModelName("Mistral Large 4 Preview")).toBe("mistral large 4");
    expect(normalizeModelName("Minimax M3p1 Flash (mini-swe-agent) xhigh")).toBe("minimax m3 1 flash");
    expect(normalizeModelName("glm-5p2")).toBe("glm 5 2");
  });

  it("keeps model identity tokens that look like variants", () => {
    expect(normalizeModelName("Qwen3.8 Max")).toBe("qwen3 8 max");
    expect(normalizeModelName("MiniMax-M3.1-Flash")).toBe("minimax m3 1 flash");
  });

  it("canonicalizes short Anthropic family keys", () => {
    expect(canonicalModelKey("Fable 5.2 Max")).toBe("claude fable 5 2");
    expect(canonicalModelKey("Opus 5.5")).toBe("claude opus 5 5");
    expect(canonicalModelKey("Gemini 4 Carbon (High)")).toBe("gemini 4 carbon");
  });
});
