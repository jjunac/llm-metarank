import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { vendorIcon } from "../lib/vendor-icons";
import { ModelAvatar } from "./ui";

describe("vendor marks", () => {
  it("maps known vendors to vendored SVG marks", () => {
    expect(vendorIcon("OpenAI")).toBe("/vendors/openai.svg");
    expect(vendorIcon("Google")).toBe("/vendors/gemini.svg");
    expect(vendorIcon("Anthropic")).toBe("/vendors/anthropic.svg");
    expect(vendorIcon("Unknown lab")).toBeNull();
  });

  it("renders a tinted mark and falls back to initials", () => {
    const openai = renderToStaticMarkup(<ModelAvatar name="GPT-6 Astra" vendor="OpenAI" />);
    expect(openai).toContain("/vendors/openai.svg");
    expect(openai).toContain("mask-image");

    const unknown = renderToStaticMarkup(<ModelAvatar name="Beam 1.0" vendor="Reflection" />);
    expect(unknown).not.toContain("/vendors/");
    expect(unknown).toContain("B1");
  });
});
