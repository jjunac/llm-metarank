import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTauBanking } from "./tau-banking.js";
import { parseTauBanking, type TauSubmission } from "../parse/tau-banking.js";

function standard(): TauSubmission {
  return {
    model_name: "Qwen 3.8 Max", model_organization: "Qwen", submitting_organization: "Sierra",
    submission_type: "standard", modality: "text", reasoning_effort: "xhigh",
    submission_date: "2026-08-04", model_release: { release_date: "2026-07-19" },
    methodology: {
      evaluation_date: "2026-08-03", tau2_bench_version: "1.0.1", user_simulator: "gpt-5.2",
      verification: { modified_prompts: false, omitted_questions: false },
    },
    results: { banking_knowledge: { pass_1: 55.154639175257735, pass_2: 45.189, pass_3: 39.69, pass_4: 35.05, retrieval_config: "alltools", cost: null } },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("τ³-Banking", () => {
  it("uses percentage pass^1 only, retaining other pass statistics and actual evaluation/publication dates", () => {
    const { entries, sourceUpdatedAt } = parseTauBanking([{ id: "run", data: standard() }]);
    expect(entries[0]).toMatchObject({
      rawName: "Qwen 3.8 Max", score: 55.154639175257735, variant: "xhigh", date: "2026-08-03",
      harness: "τ-bench 1.0.1 · AllTools · GPT-5.2 user",
      metrics: { pass_2: 45.189, pass_4: 35.05 },
      extra: { modelReleaseDate: "2026-07-19", submissionDate: "2026-08-04" },
    });
    expect(sourceUpdatedAt).toBe("2026-08-04");
  });

  it("excludes custom agents, voice, other retrievals/simulators, grading versions and modified/incomplete tests", () => {
    const excluded = Array.from({ length: 8 }, standard);
    excluded[0].submission_type = "custom";
    excluded[1].modality = "voice";
    excluded[2].results!.banking_knowledge!.retrieval_config = "terminal";
    excluded[3].methodology!.user_simulator = "gpt-5.5";
    excluded[4].methodology!.tau2_bench_version = "1.0.0";
    excluded[5].methodology!.verification!.modified_prompts = true;
    excluded[6].methodology!.verification!.omitted_questions = true;
    excluded[7].methodology!.verification = undefined;
    excluded.forEach((data) => { data.submission_date = "2026-10-28"; });
    const result = parseTauBanking([{ id: "good", data: standard() }, ...excluded.map((data, index) => ({ id: String(index), data }))]);
    expect(result.entries).toHaveLength(1);
    expect(result.sourceUpdatedAt).toBe("2026-08-04");
    expect(result.warnings[0]).toContain("Excluded 8");
    expect(() => parseTauBanking([{ id: "wrong", data: excluded[4] }])).toThrow("no standard");
  });

  it("retains zero scores but never promotes an unverified numeric cost into the frontier", () => {
    const data = standard();
    data.results!.banking_knowledge!.pass_1 = 0;
    data.results!.banking_knowledge!.cost = 1.8423;
    const { entries } = parseTauBanking([{ id: "zero", data }]);
    expect(entries[0].score).toBe(0);
    expect(entries[0].extra?.reportedCost).toBe(1.8423);
    expect(entries[0].cost).toBeUndefined();
    expect(entries[0].costUnavailableReason).toContain("no audited");
    data.results!.banking_knowledge!.pass_1 = 101;
    expect(() => parseTauBanking([{ id: "invalid", data }])).toThrow("invalid model/pass^1");
  });

  it("accepts older text-manifest records that predate the explicit modality field", () => {
    const data = standard();
    delete data.modality;
    expect(parseTauBanking([{ id: "older-text", data }]).entries).toHaveLength(1);
  });

  it("fetches only manifest-listed text submissions and fails rather than publishing partial downloads", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.endsWith("manifest.json")) return Response.json({ submissions: ["one", "two"], voice_submissions: ["voice"] });
      return Response.json(standard());
    });
    vi.stubGlobal("fetch", fetchMock);
    expect((await fetchTauBanking()).entries).toHaveLength(2);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/voice/"))).toBe(false);
    fetchMock.mockImplementation(async (url) => String(url).endsWith("/two/submission.json") ? new Response("invalid JSON") :
      String(url).endsWith("manifest.json") ? Response.json({ submissions: ["one", "two"] }) : Response.json(standard()));
    await expect(fetchTauBanking()).rejects.toThrow();
  });

  it("rejects missing or duplicate manifest entries", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({ submissions: [] })));
    await expect(fetchTauBanking()).rejects.toThrow("manifest");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({ submissions: ["same", "same"] })));
    await expect(fetchTauBanking()).rejects.toThrow("manifest");
  });
});
