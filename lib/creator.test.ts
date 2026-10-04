import { describe, expect, it, vi } from "vitest";
import { PostSchema, type Post } from "./domain";
import {
  creatorPatch,
  creatorSnapshot,
  estimatedSubtitleCues,
  productionPack,
  requestCreatorDraft,
  scriptText,
  subtitleFile,
  type CreatorDraft,
  type CreatorRequest,
} from "./creator";

function post(over: Partial<Post> = {}): Post {
  return PostSchema.parse({
    id: "p1",
    platform: "tiktok",
    title: "My film",
    createdAt: "2026-10-04T00:00:00Z",
    updatedAt: "2026-10-04T00:00:00Z",
    ...over,
  });
}
const draft: CreatorDraft = {
  hook: "Watch the light.",
  beats: ["Place the cup.", "Move the camera.", "Compare the result."],
  cta: "Try it.",
  caption: "A simple setup",
  hashtags: ["#تصوير"],
  shots: [
    { type: "hook", text: "Show result" },
    { type: "wide", text: "Setup" },
    { type: "closeup", text: "Details" },
  ],
};
const input: CreatorRequest = {
  brief: "Coffee",
  title: "My film",
  platform: "tiktok",
  language: "en",
  tone: "friendly",
  durationSeconds: 30,
  script: post().script,
};

describe("creator preview application", () => {
  it("applies only selected fields and does not publish or schedule", () => {
    const p = post({
      caption: "Keep my caption",
      shots: [{ id: "old", type: "wide", text: "My shot", done: true }],
    });
    const patch = creatorPatch(p, creatorSnapshot(p), draft, {
      script: true,
      caption: false,
      shots: false,
    });
    expect(patch).toEqual({
      hook: draft.hook,
      script: { hook: draft.hook, beats: draft.beats, cta: draft.cta },
      stage: "script",
    });
    expect(p.caption).toBe("Keep my caption");
    expect(p.shots[0].done).toBe(true);
  });
  it.each([
    { hook: "New overview hook" },
    { script: { hook: "My new hook", beats: ["", "", ""] as [string, string, string], cta: "" } },
    { caption: "Typed after generation" },
    { hashtags: ["#mynewtag"] },
    { title: "Changed title" },
    { shots: [{ id: "new", type: "wide" as const, text: "New shot", done: true }] },
  ])("rejects a stale preview after an editable field changes %#", (change) => {
    const p = post();
    expect(
      creatorPatch({ ...p, ...change }, creatorSnapshot(p), draft, {
        script: true,
        caption: true,
        shots: true,
      }),
    ).toBeNull();
  });
  it("rejects deleted posts and does not move a filmed post backwards", () => {
    const p = post({ stage: "filmed" });
    const selected = { script: true, caption: false, shots: false };
    expect(creatorPatch(undefined, creatorSnapshot(p), draft, selected)).toBeNull();
    expect(creatorPatch(p, creatorSnapshot(p), draft, selected)?.stage).toBeUndefined();
  });
  it("synchronizes overview and script hooks only when the owner selects script replacement", () => {
    const p = post({
      hook: "Overview hook",
      script: { hook: "Script hook", beats: ["", "", ""], cta: "" },
    });
    const replace = creatorPatch(p, creatorSnapshot(p), draft, {
      script: true,
      caption: false,
      shots: false,
    });
    expect(replace?.hook).toBe(draft.hook);
    expect(replace?.script?.hook).toBe(draft.hook);
    const keep = creatorPatch(p, creatorSnapshot(p), draft, {
      script: false,
      caption: true,
      shots: false,
    });
    expect(keep?.hook).toBeUndefined();
    expect(keep?.script).toBeUndefined();
  });
  it("explicit shot replacement creates new unchecked identities", () => {
    const p = post();
    let i = 0;
    const patch = creatorPatch(
      p,
      creatorSnapshot(p),
      draft,
      { script: false, caption: false, shots: true },
      () => `new-${++i}`,
    );
    expect(patch?.shots?.map((shot) => [shot.id, shot.done])).toEqual([
      ["new-1", false],
      ["new-2", false],
      ["new-3", false],
    ]);
  });
});

describe("production exports", () => {
  it("keeps the full saved script, caption and shot text in the downloadable pack", () => {
    const p = post({
      script: { hook: draft.hook, beats: draft.beats, cta: draft.cta },
      caption: draft.caption,
      hashtags: draft.hashtags,
      shots: draft.shots.map((shot, i) => ({ ...shot, id: String(i), done: false })),
    });
    const pack = productionPack(p, "ar");
    expect(pack).toContain(scriptText(p.script));
    expect(pack).toContain("#تصوير");
    expect(pack).toContain("3. [closeup] Details");
  });
  it("creates positive, contiguous estimated cue timings ending exactly at duration", () => {
    const cues = estimatedSubtitleCues("هذا مثال عربي. هذه لقطة ثانية للتجربة، وهذه النهاية!", 31);
    expect(cues.length).toBeGreaterThan(1);
    expect(cues[0].startMs).toBe(0);
    expect(cues.at(-1)?.endMs).toBe(31_000);
    for (let i = 0; i < cues.length; i++) {
      expect(cues[i].endMs).toBeGreaterThan(cues[i].startMs);
      if (i) expect(cues[i].startMs).toBe(cues[i - 1].endMs);
    }
    expect(cues.map((cue) => cue.text).join(" ")).toBe(
      "هذا مثال عربي. هذه لقطة ثانية للتجربة، وهذه النهاية!",
    );
  });
  it("exports valid SRT and VTT headers, timestamps and escaped caption text", () => {
    expect(subtitleFile("Hello <world> & friends", 10, "srt")).toBe(
      "1\n00:00:00,000 --> 00:00:10,000\nHello &lt;world&gt; &amp; friends\n",
    );
    expect(subtitleFile("مرحبا", 10, "vtt")).toBe(
      "WEBVTT\n\n1\n00:00:00.000 --> 00:00:10.000\nمرحبا\n",
    );
  });
  it.each([NaN, Infinity, 0, -1, 3601])("rejects invalid timing %s", (duration) => {
    expect(() => estimatedSubtitleCues("Hello", duration)).toThrow("invalid_subtitle_input");
  });
  it("does not manufacture subtitles for an empty script", () => {
    expect(estimatedSubtitleCues("  ", 30)).toEqual([]);
  });
});

describe("creator client", () => {
  it("never sends invalid input or requests without configuration", async () => {
    const fetch = vi.fn();
    expect(await requestCreatorDraft(null, input, undefined, fetch)).toEqual({
      ok: false,
      error: "unconfigured",
    });
    expect(
      await requestCreatorDraft(
        { url: "https://worker.test", token: "owner" },
        { ...input, brief: "" },
        undefined,
        fetch,
      ),
    ).toEqual({ ok: false, error: "bad_request" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("validates success bodies and blocks redirects carrying credentials", async () => {
    const fetch = vi.fn(async () => Response.json({ draft }));
    expect(
      await requestCreatorDraft(
        { url: "https://worker.test", token: "owner" },
        input,
        undefined,
        fetch,
      ),
    ).toEqual({ ok: true, draft });
    expect(fetch).toHaveBeenCalledWith(
      "https://worker.test/creator/draft",
      expect.objectContaining({ redirect: "error", cache: "no-store" }),
    );
    const malformed = vi.fn(async () => Response.json({ draft: { ...draft, shots: [] } }));
    expect(
      await requestCreatorDraft(
        { url: "https://worker.test", token: "owner" },
        input,
        undefined,
        malformed,
      ),
    ).toEqual({ ok: false, error: "ai_unavailable" });
  });
});
