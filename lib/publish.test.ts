import { describe, expect, it, vi } from "vitest";
import {
  AutoPostSchema,
  PostSchema,
  type AutoPostInput,
  type Post,
  type SocialStatusMap,
} from "./domain";
import { sha256Hex } from "./digest";
import {
  autoPostActive,
  autoPostOf,
  autoPostSummary,
  jobClaim,
  jobOwnership,
  ownsJob,
  takenJobIds,
  buildJob,
  canPublishTo,
  canAutoMarkPosted,
  CAPTION_MAX,
  captionFor,
  captionWarnings,
  defaultCaption,
  directMediaUrl,
  dueManualPosts,
  ELLIPSIS,
  firstPermalink,
  JOB_LABEL_MAX,
  jobActive,
  manualComposeUrl,
  parseJob,
  parseJobs,
  parseJobsStrict,
  payloadHash,
  pendingManualPlatforms,
  PUBLISH_ID_RE,
  publishCancel,
  publishJobId,
  publishList,
  publishListStrict,
  publishProblems,
  publishRun,
  publishSchedule,
  reconnectInDays,
  reconnectMessageKey,
  remoteJobs,
  scheduledAtOf,
  sendCaption,
  trimCaption,
  workerKey,
  needsTikTokFinish,
  isTikTokPostUrl,
  tiktokCreatorProblems,
  tiktokCreatorInfo,
  type TikTokCreator,
} from "./publish";

const CONFIG = { url: "https://scout.test", token: "tok" };
const AT = "2026-09-27T09:00:00.000Z";

function post(over: Partial<Post> = {}): Post {
  return PostSchema.parse({
    id: "p1",
    platform: "tiktok",
    title: "Match cut in 30 s",
    caption: "How I do a match cut",
    hashtags: ["#capcut", "#editing"],
    plannedDay: "2026-10-01",
    plannedTime: "21:00",
    createdAt: AT,
    updatedAt: AT,
    ...over,
  });
}

const auto = (over: AutoPostInput = {}) =>
  AutoPostSchema.parse({
    platforms: ["tiktok"],
    mediaUrl: "https://cdn.example/clip.mp4",
    ...over,
  });

const ready: SocialStatusMap = {
  tiktok: { configured: true, connected: true, canPublish: true },
  instagram: { configured: true, connected: true, canPublish: true },
  youtube: { configured: true, connected: true, canPublish: true },
  threads: { configured: true, connected: true, canPublish: true },
};

describe("captions and time", () => {
  it("the default caption is the caption plus the hashtags; an override wins per network", () => {
    const p = post();
    expect(defaultCaption(p)).toBe("How I do a match cut\n\n#capcut #editing");
    const a = auto({
      platforms: ["tiktok", "threads"],
      captions: { threads: "short one", tiktok: "  " },
    });
    expect(captionFor(p, a, "threads")).toBe("short one");
    // A blank override falls back to the default.
    expect(captionFor(p, a, "tiktok")).toBe(defaultCaption(p));
  });

  it("fires at the planned Riyadh time, or the platform's best time without one", () => {
    expect(scheduledAtOf(post())).toBe("2026-10-01T18:00:00.000Z");
    // 2026-10-01 is a Thursday: TikTok's weekday best time is 21:00.
    expect(scheduledAtOf(post({ plannedTime: null }))).toBe("2026-10-01T18:00:00.000Z");
    expect(scheduledAtOf(post({ plannedDay: null }))).toBeNull();
  });

  it("new settings preselect the post's own platform", () => {
    expect(autoPostOf(post({ platform: "instagram" })).platforms).toEqual(["instagram"]);
  });
});

describe("trimCaption", () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

  it("leaves a caption within the limit alone", () => {
    expect(trimCaption("threads", "short #one #two")).toEqual({
      text: "short #one #two",
      trimmed: false,
    });
    const exact = "x".repeat(CAPTION_MAX.threads);
    expect(trimCaption("threads", exact)).toEqual({ text: exact, trimmed: false });
  });

  it("drops hashtags from the end one by one until it fits", () => {
    const body = "a".repeat(480);
    const text = `${body}\n\n#capcut #editing #3zprod`;
    // 480 + 2 + 24 = 506 > 500: dropping " #3zprod" lands at 498, the other two tags stay.
    expect(trimCaption("threads", text)).toEqual({
      text: `${body}\n\n#capcut #editing`,
      trimmed: true,
    });
    // With more tags gone than needed, the body itself survives untouched.
    const many = `${body} #a #b #c #d #e #f #g #h #i #j`;
    const r = trimCaption("threads", many);
    expect(r.trimmed).toBe(true);
    expect(r.text.startsWith(body)).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(500);
  });

  it("then cuts at a word boundary with an ellipsis", () => {
    const text = `${words(200)} #tag`;
    const r = trimCaption("x", text);
    expect(r.trimmed).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(280);
    expect(r.text.endsWith(ELLIPSIS)).toBe(true);
    // Ends on a whole word: "…" follows a complete "wNN" token, no space before it.
    expect(r.text).toMatch(/w\d+…$/);
    expect(text.startsWith(r.text.slice(0, -1) + " ")).toBe(true);
  });

  it("hard-cuts one long word rather than throwing away half the room", () => {
    const r = trimCaption("snapchat", "ab " + "z".repeat(300));
    expect(r.text.length).toBe(250);
    expect(r.text.endsWith(ELLIPSIS)).toBe(true);
    // A caption that is nothing but hashtags is cut too, never emptied.
    const tags = trimCaption("x", Array.from({ length: 80 }, (_, i) => `#tag${i}`).join(" "));
    expect(tags.text.length).toBeLessThanOrEqual(280);
    expect(tags.text.length).toBeGreaterThan(0);
  });

  it("never leaves half an emoji before the ellipsis", () => {
    const r = trimCaption("threads", "abc " + "😀".repeat(300));
    expect(r.trimmed).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(500);
    expect(r.text.endsWith(ELLIPSIS)).toBe(true);
    // No high surrogate without its low half (the cut backs off before the pair).
    expect(r.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(r.text).toBe("abc " + "😀".repeat(247) + ELLIPSIS);
  });

  it("is not trimmed when only trailing whitespace is over the limit", () => {
    expect(trimCaption("threads", "x".repeat(500) + "\n")).toEqual({
      text: "x".repeat(500),
      trimmed: false,
    });
  });

  it("sendCaption trims the API networks only", () => {
    const p = post({ caption: "y".repeat(600), hashtags: ["#a"] });
    const a = auto({ platforms: ["threads", "x"] });
    expect(sendCaption(p, a, "threads")).toEqual({
      text: "y".repeat(499) + ELLIPSIS,
      trimmed: true,
    });
    expect(sendCaption(p, a, "x")).toEqual({ text: defaultCaption(p), trimmed: false });
    expect(captionWarnings(p, a)).toEqual([{ code: "tooLong", platform: "x" }]);
    expect(captionWarnings(post(), a)).toEqual([]);
  });
});

describe("directMediaUrl", () => {
  it.each([
    [
      "https://www.dropbox.com/scl/fi/abc/clip.mp4?rlkey=x&dl=0",
      "https://dl.dropboxusercontent.com/scl/fi/abc/clip.mp4?rlkey=x",
    ],
    [
      "https://drive.google.com/file/d/1AbC_d-9/view?usp=sharing",
      "https://drive.usercontent.google.com/download?id=1AbC_d-9&export=download&confirm=t",
    ],
    [
      "https://drive.google.com/open?id=XYZ",
      "https://drive.usercontent.google.com/download?id=XYZ&export=download&confirm=t",
    ],
    ["  https://cdn.example/clip.mp4 ", "https://cdn.example/clip.mp4"],
    ["not a url", "not a url"],
  ])("%s", (raw, direct) => {
    expect(directMediaUrl(raw)).toBe(direct);
  });
});

describe("publishProblems", () => {
  it("a complete job has none", () => {
    expect(publishProblems(post(), auto(), ready)).toEqual([]);
  });

  it("lists what blocks the job", () => {
    const p = post({ plannedDay: null, caption: "x".repeat(600), hashtags: [] });
    const a = auto({
      platforms: ["tiktok", "youtube", "threads", "instagram"],
      mediaKind: "image",
      mediaUrl: "http://a.example/p.jpg",
    });
    const status: SocialStatusMap = {
      ...ready,
      youtube: { configured: true, connected: false },
      instagram: { configured: true, connected: true, canPublish: false },
    };
    // The 600-character Threads caption is trimmed on send, so it is not a problem here.
    expect(publishProblems(p, a, status)).toEqual([
      { code: "noDay" },
      { code: "badUrl" },
      { code: "needsVideo", platform: "tiktok" },
      { code: "needsVideo", platform: "youtube" },
      { code: "notConnected", platform: "youtube" },
      { code: "noPermission", platform: "instagram" },
    ]);
  });

  it("text alone works for Threads only; an overlong X caption never blocks", () => {
    const a = auto({ platforms: ["threads", "instagram", "x"], mediaKind: "none", mediaUrl: "" });
    expect(publishProblems(post({ caption: "y".repeat(290), hashtags: [] }), a, ready)).toEqual([
      { code: "needsMedia", platform: "instagram" },
    ]);
    // A text-only caption made of whitespace is still empty after trimming.
    const blank = auto({ platforms: ["threads"], mediaKind: "none", mediaUrl: "" });
    expect(publishProblems(post({ caption: "   ", hashtags: [] }), blank, ready)).toEqual([
      { code: "empty", platform: "threads" },
    ]);
  });

  it("skips connection checks while the status is unknown, and the day check for 'now'", () => {
    expect(publishProblems(post({ plannedDay: null }), auto(), null, { now: true })).toEqual([]);
    expect(publishProblems(post(), auto({ platforms: [] }), ready)).toEqual([
      { code: "noPlatforms" },
    ]);
    expect(publishProblems(post(), auto({ mediaUrl: "" }), ready)).toEqual([{ code: "noMedia" }]);
    expect(publishProblems(post(), auto({ platforms: ["x", "snapchat"] }), ready)).toEqual([
      { code: "manualOnly" },
    ]);
  });
});

describe("buildJob", () => {
  it("sends the API networks with their options and the direct media link", () => {
    const p = post();
    const a = auto({
      platforms: ["tiktok", "youtube", "instagram", "x", "snapchat"],
      mediaUrl: "https://www.dropbox.com/s/abc/clip.mp4?dl=0",
      youtubePrivacy: "unlisted",
      tiktokMode: "inbox",
      captions: { instagram: "ig words" },
    });
    expect(buildJob(p, a, "2026-10-01T18:00:00.000Z")).toEqual({
      id: "p1",
      scheduledAt: "2026-10-01T18:00:00.000Z",
      media: { url: "https://dl.dropboxusercontent.com/s/abc/clip.mp4", kind: "video" },
      targets: {
        tiktok: { caption: defaultCaption(p), tiktokMode: "inbox" },
        youtube: { caption: defaultCaption(p), title: "Match cut in 30 s", privacy: "unlisted" },
        instagram: { caption: "ig words" },
      },
    });
  });

  it("text-only jobs carry no media", () => {
    const job = buildJob(post(), auto({ platforms: ["threads"], mediaKind: "none" }), AT);
    expect(job.media).toBeUndefined();
  });

  it("does not send stale video duration after switching to an image", () => {
    const a = auto({
      platforms: ["instagram", "threads"],
      mediaKind: "image",
      mediaUrl: "https://cdn.example/photo.jpg",
      durationSeconds: 12.5,
    });
    expect(publishProblems(post(), a, ready)).toEqual([]);
    expect(buildJob(post(), a, AT).media).toEqual({
      url: "https://cdn.example/photo.jpg",
      kind: "image",
    });
    expect(buildJob(post(), { ...a, mediaKind: "video" }, AT).media?.durationSeconds).toBe(12.5);
  });

  it("sends every caption trimmed to its network's limit", () => {
    const p = post({ caption: "a".repeat(2190), hashtags: ["#capcut", "#editing", "#3zprod"] });
    const a = auto({ platforms: ["threads", "instagram", "youtube"] });
    const job = buildJob(p, a, AT);
    expect(job.targets.threads?.caption.length).toBeLessThanOrEqual(CAPTION_MAX.threads);
    expect(job.targets.threads?.caption.endsWith(ELLIPSIS)).toBe(true);
    // Instagram (2200) only loses hashtags from the end; YouTube (5000) gets it all.
    expect(job.targets.instagram?.caption).toBe("a".repeat(2190) + "\n\n#capcut");
    expect(job.targets.youtube?.caption).toBe(defaultCaption(p));
  });
});

describe("A4: the first comment", () => {
  it("buildJob sends it to Instagram, Threads and YouTube only, trimmed to each limit, and nothing when empty", () => {
    const a = auto({
      platforms: ["tiktok", "instagram", "threads", "youtube", "x"],
      firstComment: "  #match #cut  ",
    });
    const job = buildJob(post(), a, AT);
    for (const p of ["instagram", "threads", "youtube"] as const) {
      expect(job.targets[p]?.firstComment).toBe("#match #cut");
    }
    expect("firstComment" in job.targets.tiktok!).toBe(false);
    // Nothing typed: no field at all, so an existing post's job body (and its digest) stays as it was.
    const plain = buildJob(post(), auto({ platforms: ["instagram"] }), AT);
    expect("firstComment" in plain.targets.instagram!).toBe(false);
    const blank = buildJob(post(), auto({ platforms: ["instagram"], firstComment: "  " }), AT);
    expect("firstComment" in blank.targets.instagram!).toBe(false);
    // Threads takes 500 characters, Instagram 2,200.
    const long = "word ".repeat(300).trim();
    const both = buildJob(
      post(),
      auto({ platforms: ["threads", "instagram"], firstComment: long }),
      AT,
    );
    expect(both.targets.threads?.firstComment?.length).toBeLessThanOrEqual(CAPTION_MAX.threads);
    expect(both.targets.threads?.firstComment?.endsWith(ELLIPSIS)).toBe(true);
    expect(both.targets.instagram?.firstComment).toBe(long);
  });

  it("parseJob keeps the comment's state and the text the Worker holds, and nothing else of it", () => {
    const job = parseJob({
      id: "p1",
      scheduledAt: AT,
      targets: {
        instagram: {
          caption: "c",
          firstComment: "hi",
          state: "published",
          attempts: 0,
          comment: {
            caption: "hi",
            state: "failed",
            attempts: 4,
            containerId: "z",
            error: "no_permission",
            detail: "Allow auto-replies",
          },
        },
      },
    });
    expect(job?.results.instagram).toEqual({
      state: "published",
      firstComment: "hi",
      comment: { state: "failed", error: "no_permission", detail: "Allow auto-replies" },
    });
  });

  it("a published post whose comment is still to go is worth checking back; the post stays published", () => {
    const base = auto({
      platforms: ["instagram"],
      sentAt: AT,
      results: { instagram: { state: "published", firstComment: "hi" } },
    });
    expect(autoPostSummary(base)).toBe("published");
    expect(autoPostActive(base)).toBe(true);
    for (const state of ["queued", "processing"] as const) {
      const r = {
        instagram: { state: "published" as const, firstComment: "hi", comment: { state } },
      };
      expect(autoPostActive({ ...base, results: r })).toBe(true);
    }
    for (const state of ["published", "failed"] as const) {
      const r = {
        instagram: { state: "published" as const, firstComment: "hi", comment: { state } },
      };
      expect(autoPostActive({ ...base, results: r })).toBe(false);
      expect(autoPostSummary({ ...base, results: r })).toBe("published");
    }
    // The Worker holds no comment for it (typed after it went out): nothing to wait for.
    expect(
      autoPostActive({
        ...base,
        firstComment: "later",
        results: { instagram: { state: "published" } },
      }),
    ).toBe(false);
    // A TikTok inbox upload never has one.
    expect(
      autoPostActive(
        auto({
          platforms: ["tiktok"],
          sentAt: AT,
          results: { tiktok: { state: "published", inbox: true } },
        }),
      ),
    ).toBe(false);
  });
});

describe("TikTok personal publishing", () => {
  const creator: TikTokCreator = {
    username: "3z.prod",
    nickname: "Creator",
    privacyLevels: ["SELF_ONLY", "PUBLIC_TO_EVERYONE"],
    commentDisabled: false,
    duetDisabled: true,
    stitchDisabled: false,
    maxVideoDurationSeconds: 300,
  };

  it("defaults to inbox without preselecting privacy, interactions, music or consent", () => {
    const a = auto();
    expect(a.tiktokMode).toBe("inbox");
    expect(a.tiktokPrivacy).toBe("");
    expect(
      a.tiktokAllowComment ||
        a.tiktokAllowDuet ||
        a.tiktokAllowStitch ||
        a.tiktokConsent ||
        a.tiktokAutoAddMusic,
    ).toBe(false);
    expect(buildJob(post(), a, AT).targets.tiktok).toEqual({
      caption: defaultCaption(post()),
      tiktokMode: "inbox",
    });
  });

  it("uses granular permissions without breaking older Workers", () => {
    const st = {
      configured: true,
      connected: true,
      canPublish: true,
      canUpload: true,
      canDirectPost: false,
    };
    expect(canPublishTo(st, "tiktok", "inbox")).toBe(true);
    expect(canPublishTo(st, "tiktok", "direct")).toBe(false);
    expect(canPublishTo(ready.tiktok, "tiktok", "inbox")).toBe(true);
    expect(
      publishProblems(
        post(),
        auto({
          tiktokMode: "direct",
          tiktokPrivacy: "SELF_ONLY",
          tiktokConsent: true,
          durationSeconds: 10,
        }),
        { ...ready, tiktok: st },
      ),
    ).toEqual([{ code: "noPermission", platform: "tiktok" }]);
  });

  it("requires creator audience, explicit consent, allowed duration and valid disclosure for direct posting", () => {
    expect(
      publishProblems(post(), auto({ tiktokMode: "direct" }), ready).map((p) => p.code),
    ).toEqual(["tiktokPrivacy", "tiktokConsent", "tiktokDuration"]);
    const a = auto({
      tiktokMode: "direct",
      tiktokPrivacy: "SELF_ONLY",
      durationSeconds: 301,
      tiktokConsent: true,
      tiktokBrandContent: true,
    });
    expect(publishProblems(post(), a, ready)).toContainEqual({
      code: "tiktokBrandedPrivacy",
      platform: "tiktok",
    });
    expect(tiktokCreatorProblems(a, creator)).toEqual([
      { code: "tiktokDuration", platform: "tiktok" },
    ]);
    expect(
      tiktokCreatorProblems(
        { ...a, tiktokPrivacy: "MUTUAL_FOLLOW_FRIENDS", durationSeconds: 10 },
        creator,
      ),
    ).toEqual([{ code: "tiktokPrivacy", platform: "tiktok" }]);
    expect(tiktokCreatorProblems(a, undefined)).toEqual([
      { code: "tiktokCreator", platform: "tiktok" },
    ]);
  });

  it("builds ordered photos with cover and a 4000-character description; blocks mixed-network or invalid photo jobs", () => {
    const a = auto({
      mediaKind: "photo",
      mediaUrl: "",
      photoUrls: ["https://cdn.example/b.jpg", "https://cdn.example/a.jpg"],
      photoTitle: "My photos",
      photoCoverIndex: 1,
    });
    expect(publishProblems(post(), a, ready)).toEqual([]);
    const job = buildJob(post({ caption: "x".repeat(3500), hashtags: [] }), a, AT);
    expect(job.media).toEqual({ url: a.photoUrls[0], kind: "photo", photoUrls: a.photoUrls });
    expect(job.targets.tiktok).toMatchObject({
      photoTitle: "My photos",
      photoCoverIndex: 1,
      autoAddMusic: false,
      caption: "x".repeat(3500),
    });
    expect(publishProblems(post(), { ...a, platforms: ["tiktok", "instagram"] }, ready)).toEqual([
      { code: "photoOnlyTikTok" },
    ]);
    expect(
      publishProblems(post(), { ...a, photoUrls: ["http://cdn.example/a.jpg"] }, ready).map(
        (p) => p.code,
      ),
    ).toEqual(["badUrl", "photoCover"]);
  });

  it("never considers inbox upload published; keeps waiting for mixed jobs and retains manual completion across Worker reads", () => {
    const a = auto({
      sentAt: AT,
      platforms: ["tiktok", "instagram"],
      results: {
        tiktok: { state: "published", inbox: true, uploadedAt: AT },
        instagram: { state: "published", permalink: "https://www.instagram.com/reel/A/" },
      },
    });
    expect(needsTikTokFinish(a)).toBe(true);
    expect(autoPostSummary(a)).toBe("needsFinish");
    expect(autoPostActive(a)).toBe(false);
    expect(pendingManualPlatforms(post({ autoPost: a }))).toEqual(["tiktok"]);
    expect(
      autoPostSummary({ ...a, results: { ...a.results, instagram: { state: "queued" } } }),
    ).toBe("publishing");
    expect(
      autoPostSummary({ ...a, results: { ...a.results, instagram: { state: "failed" } } }),
    ).toBe("needsFinish");
    const confirmed = {
      ...a,
      tiktokCompletedAt: AT,
      tiktokPermalink: "https://www.tiktok.com/@3z.prod/video/123",
    };
    expect(needsTikTokFinish(confirmed)).toBe(false);
    expect(autoPostSummary(confirmed)).toBe("published");
    expect(canAutoMarkPosted(confirmed)).toBe(true);
    expect(canAutoMarkPosted({ ...confirmed, platforms: ["tiktok", "instagram", "x"] })).toBe(
      false,
    );
    expect(canAutoMarkPosted(a)).toBe(false);
    expect(firstPermalink(confirmed)).toBe(confirmed.tiktokPermalink);
  });

  it("accepts only full TikTok video/photo links for manual publication proof", () => {
    expect(isTikTokPostUrl("https://www.tiktok.com/@3z.prod/video/123456")).toBe(true);
    expect(isTikTokPostUrl("https://www.tiktok.com/@3z.prod/photo/123456?lang=en")).toBe(true);
    for (const url of [
      "https://www.tiktok.com/@3z.prod",
      "https://vm.tiktok.com/abc",
      "https://tiktok.com.evil.test/@3z.prod/video/123",
      "http://tiktok.com/@a/video/123",
    ])
      expect(isTikTokPostUrl(url)).toBe(false);
  });

  it("reads creator capabilities and fails closed on malformed or old Worker responses", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ canUpload: true, canDirectPost: true, creator })),
    );
    expect(await tiktokCreatorInfo(CONFIG, { fetchImpl })).toMatchObject({ ok: true, creator });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://scout.test/social/tiktok/creator");
    const bad = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ canPublish: true })));
    expect(await tiktokCreatorInfo(CONFIG, { fetchImpl: bad })).toEqual({
      ok: false,
      error: { type: "upstream" },
    });
  });
});

describe("results", () => {
  const worker = {
    jobs: [
      {
        id: "p1",
        scheduledAt: AT,
        targets: {
          tiktok: { caption: "c", state: "processing", attempts: 0, containerId: "x" },
          instagram: {
            caption: "c",
            state: "published",
            attempts: 0,
            permalink: "https://www.instagram.com/reel/A/",
            postId: "1",
          },
          youtube: { state: "exploded" },
          x: { state: "published" },
        },
      },
      { id: 5 },
    ],
  };

  it("parseJobs keeps known platforms and valid states only", () => {
    expect(parseJobs(worker)).toEqual([
      {
        id: "p1",
        scheduledAt: AT,
        label: "c",
        results: {
          tiktok: { state: "processing" },
          instagram: {
            state: "published",
            permalink: "https://www.instagram.com/reel/A/",
            postId: "1",
          },
        },
      },
    ]);
    expect(parseJobs(null)).toEqual([]);
  });

  it("parseJob labels a job with the YouTube title, else the first caption line, cut to fit", () => {
    const job = (targets: unknown) => parseJob({ id: "j1", scheduledAt: AT, targets });
    expect(
      job({
        instagram: { caption: "IG caption", state: "queued" },
        youtube: { caption: "desc", title: "  My   video  ", state: "queued" },
      })?.label,
    ).toBe("My video");
    expect(
      job({
        threads: { caption: "\n\n  First line  \n\n#tags", state: "queued" },
        instagram: { caption: "second", state: "queued" },
      })?.label,
    ).toBe("First line");
    expect(
      job({ youtube: { title: " ", caption: "From the caption", state: "queued" } })?.label,
    ).toBe("From the caption");
    const long = job({ threads: { caption: "a".repeat(200), state: "queued" } })?.label ?? "";
    expect(long).toHaveLength(JOB_LABEL_MAX);
    expect(long.endsWith(ELLIPSIS)).toBe(true);
    // An emoji at the cut is never split in half.
    const emoji =
      job({ threads: { caption: "a".repeat(78) + "🎬🎬", state: "queued" } })?.label ?? "";
    expect(emoji).toBe("a".repeat(78) + ELLIPSIS);
    // No text, or targets the dashboard does not understand: no label, and the job still parses.
    expect(job({ tiktok: { state: "queued" } })).toEqual({
      id: "j1",
      scheduledAt: AT,
      results: { tiktok: { state: "queued" } },
    });
    expect(job([{ caption: "x" }])).toEqual({ id: "j1", scheduledAt: AT, results: {} });
    expect(job("nope")).toEqual({ id: "j1", scheduledAt: AT, results: {} });
    expect(job({ threads: { caption: 5, state: "queued" } })?.label).toBeUndefined();
  });

  it("jobActive is true while a network is queued or processing", () => {
    const j = (
      results: Record<string, { state: "queued" | "processing" | "published" | "failed" }>,
    ) => ({ id: "j", scheduledAt: AT, results }) as Parameters<typeof jobActive>[0];
    expect(jobActive(j({ tiktok: { state: "queued" } }))).toBe(true);
    expect(
      jobActive(j({ tiktok: { state: "published" }, instagram: { state: "processing" } })),
    ).toBe(true);
    expect(jobActive(j({ tiktok: { state: "published" }, instagram: { state: "failed" } }))).toBe(
      false,
    );
    expect(jobActive(j({}))).toBe(false);
  });

  it("remoteJobs keeps the jobs no local post sent, soonest first", () => {
    const job = (id: string, scheduledAt: string) => ({ id, scheduledAt, results: {} });
    const later = job("phone-2", "2026-10-02T18:00:00.000Z");
    const sooner = job("phone-1", "2026-10-01T18:00:00.000Z");
    const jobs = [job("p1", AT), later, job("old-job", AT), sooner, job("p3", AT)];
    const posts = [
      post({ id: "p1", autoPost: auto({ sentAt: AT }) }),
      // Followed through its jobId.
      post({ id: "p2", autoPost: auto({ sentAt: AT, jobId: "old-job" }) }),
      // Canceled here (no sentAt): the Worker still has it, so it shows as a remote job.
      post({ id: "p3", autoPost: auto() }),
    ];
    expect(remoteJobs(jobs, posts).map((j) => j.id)).toEqual(["p3", "phone-1", "phone-2"]);
    expect(remoteJobs([], posts)).toEqual([]);
    // Jobs just canceled from the hub stay out even when a read that was already out still lists them.
    expect(remoteJobs(jobs, posts, new Set(["phone-1", "p3"])).map((j) => j.id)).toEqual([
      "phone-2",
    ]);
  });

  it("workerKey tells one Worker's job list from another's", () => {
    expect(workerKey(null)).toBeNull();
    expect(workerKey(CONFIG)).toBe(workerKey({ ...CONFIG }));
    expect(workerKey(CONFIG)).not.toBe(workerKey({ ...CONFIG, url: "https://other.test" }));
    expect(workerKey(CONFIG)).not.toBe(workerKey({ ...CONFIG, token: "tok2" }));
    // The url and the token never run into each other.
    expect(workerKey({ url: "https://a.test/x", token: "y" })).not.toBe(
      workerKey({ url: "https://a.test/", token: "xy" }),
    );
  });

  it("summarizes the per-network states", () => {
    const base = auto({ platforms: ["tiktok", "instagram", "x"], sentAt: AT });
    expect(autoPostSummary(auto())).toBe("draft");
    expect(autoPostSummary(base)).toBe("scheduled");
    expect(autoPostSummary({ ...base, results: { tiktok: { state: "processing" } } })).toBe(
      "publishing",
    );
    const both = {
      ...base,
      results: {
        tiktok: { state: "published" as const },
        instagram: { state: "published" as const, permalink: "https://i/1" },
      },
    };
    expect(autoPostSummary(both)).toBe("published");
    expect(firstPermalink(both)).toBe("https://i/1");
    expect(
      autoPostSummary({
        ...base,
        results: { tiktok: { state: "published" }, instagram: { state: "failed" } },
      }),
    ).toBe("partial");
    expect(
      autoPostSummary({
        ...base,
        results: { tiktok: { state: "failed" }, instagram: { state: "failed" } },
      }),
    ).toBe("failed");
    expect(autoPostSummary({ ...base, results: { tiktok: { state: "failed" } } })).toBe(
      "publishing",
    );
    expect(autoPostActive(base)).toBe(true);
    expect(autoPostActive(both)).toBe(false);
  });
});

describe("manual networks", () => {
  it("X opens its composer with the text; Snapchat opens the site", () => {
    expect(manualComposeUrl("x", "hi #3z")).toBe("https://x.com/intent/post?text=hi%20%233z");
    expect(manualComposeUrl("snapchat", "hi")).toBe("https://www.snapchat.com/");
    expect(manualComposeUrl("tiktok", "hi")).toBe("https://www.tiktok.com/");
  });

  it("lists the X / Snapchat steps still to do by hand", () => {
    const a = auto({ platforms: ["tiktok", "x", "snapchat"] });
    expect(pendingManualPlatforms(post({ autoPost: a }))).toEqual(["x", "snapchat"]);
    expect(pendingManualPlatforms(post({ autoPost: a, stage: "posted" }))).toEqual([]);
    expect(pendingManualPlatforms(post())).toEqual([]);
    expect(pendingManualPlatforms(post({ autoPost: auto() }))).toEqual([]);
  });
});

describe("dueManualPosts", () => {
  // 21:00 Riyadh on Oct 1 = 18:00 UTC.
  const DUE = Date.parse("2026-10-01T18:00:00.000Z");
  const withX = (over: Partial<Post> = {}) =>
    post({ autoPost: auto({ platforms: ["tiktok", "x"] }), ...over });

  it("is due at and after the scheduled moment, not before", () => {
    const p = withX();
    expect(dueManualPosts([p], DUE - 60_000)).toEqual([]);
    expect(dueManualPosts([p], DUE)).toEqual([p]);
    expect(dueManualPosts([p], new Date(DUE + 3_600_000))).toEqual([p]);
  });

  it("skips posted posts, posts without a day and posts without a manual network", () => {
    const now = DUE + 86_400_000;
    expect(dueManualPosts([withX({ stage: "posted" })], now)).toEqual([]);
    expect(dueManualPosts([withX({ plannedDay: null })], now)).toEqual([]);
    expect(dueManualPosts([post({ autoPost: auto({ platforms: ["tiktok"] }) })], now)).toEqual([]);
    expect(dueManualPosts([post()], now)).toEqual([]);
  });

  it("uses the best time when no time is set, and lists the earliest first", () => {
    const noTime = withX({ id: "a", plannedTime: null });
    const at = Date.parse(scheduledAtOf(noTime)!);
    expect(dueManualPosts([noTime], at - 1)).toEqual([]);
    expect(dueManualPosts([noTime], at)).toEqual([noTime]);
    const early = withX({
      id: "b",
      plannedDay: "2026-09-30",
      autoPost: auto({ platforms: ["snapchat"] }),
    });
    const late = withX({ id: "c" });
    expect(dueManualPosts([late, early], DUE).map((p) => p.id)).toEqual(["b", "c"]);
  });
});

describe("reconnectInDays", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  const days = (n: number) => new Date(now + n * 86_400_000).toISOString();
  const meta = (tokenExpiresAt: string) => ({
    configured: true,
    connected: true,
    canPublish: true,
    tokenExpiresAt,
  });

  it("warns within a week before a Meta token runs out (0 = today)", () => {
    expect(reconnectInDays(meta(days(30)), "instagram", now)).toBeNull();
    expect(reconnectInDays(meta(days(7.5)), "instagram", now)).toBe(7);
    expect(reconnectInDays(meta(days(2.2)), "threads", now)).toBe(2);
    expect(reconnectInDays(meta(days(0.4)), "threads", now)).toBe(0);
  });

  it("stays quiet for self-renewing platforms, unknown rows, bad dates and expired tokens", () => {
    // Google and TikTok renew their short tokens themselves: an hour left is routine.
    expect(reconnectInDays(meta(days(0.04)), "youtube", now)).toBeNull();
    expect(reconnectInDays(meta(days(0.9)), "tiktok", now)).toBeNull();
    expect(reconnectInDays(undefined, "instagram", now)).toBeNull();
    expect(reconnectInDays({ ...meta(days(3)), connected: false }, "instagram", now)).toBeNull();
    expect(reconnectInDays(meta("soon"), "instagram", now)).toBeNull();
    // Already expired: the row is in the error state and says "reconnect" on its own.
    expect(reconnectInDays(meta(days(-1)), "instagram", now)).toBeNull();
  });

  it("words today, tomorrow and two days on their own, then 'within {n} days'", () => {
    expect(reconnectMessageKey(0)).toBe("publish.tokenToday");
    expect(reconnectMessageKey(1)).toBe("publish.tokenTomorrow");
    expect(reconnectMessageKey(2)).toBe("publish.tokenTwoDays");
    expect(reconnectMessageKey(3)).toBe("publish.tokenSoon");
    expect(reconnectMessageKey(7)).toBe("publish.tokenSoon");
  });
});

describe("Worker calls", () => {
  const reply = (body: unknown, status = 200) =>
    vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
    );

  it("schedule posts the job with the bearer token", async () => {
    const fetchImpl = reply({
      job: { id: "p1", scheduledAt: AT, targets: { tiktok: { state: "queued" } } },
    });
    const job = buildJob(post(), auto(), AT);
    const r = await publishSchedule(CONFIG, job, { fetchImpl });
    expect(r).toEqual({
      ok: true,
      job: { id: "p1", scheduledAt: AT, results: { tiktok: { state: "queued" } } },
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://scout.test/social/publish");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(job);
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("list, run and cancel hit their routes; errors come back typed", async () => {
    const list = reply({ jobs: [] });
    expect(await publishList(CONFIG, { fetchImpl: list })).toEqual({ ok: true, jobs: [] });
    const run = reply({ job: { id: "p 1", scheduledAt: AT, targets: {} } });
    await publishRun(CONFIG, "p 1", { fetchImpl: run });
    expect(run.mock.calls[0][0]).toBe("https://scout.test/social/publish/p%201/run");
    const del = reply({ ok: true });
    expect(await publishCancel(CONFIG, "p1", { fetchImpl: del })).toEqual({ ok: true });
    expect(del.mock.calls[0][1]?.method).toBe("DELETE");
    expect(await publishList(CONFIG, { fetchImpl: reply({ error: "bad_request" }, 400) })).toEqual({
      ok: false,
      error: { type: "bad_request", status: 400 },
    });
    expect(await publishList(null)).toEqual({ ok: false, error: { type: "unconfigured" } });
  });
});

describe("publishJobId (DT-5: workflow posts through AutoPost, Amendment A)", () => {
  const sent = (id: string, jobId?: string) =>
    post({ id, autoPost: auto({ sentAt: AT, ...(jobId !== undefined ? { jobId } : {}) }) });

  it("maps a workflow output id to a stable id the Worker accepts on every route", () => {
    // Copied from the deployed Worker's validator (workers/scout/src/social/publish.ts ID_RE).
    expect(PUBLISH_ID_RE.source).toBe("^[A-Za-z0-9_-]{1,100}$");
    const a1 = publishJobId({ id: "wf:run:a1" });
    expect(a1).toMatch(PUBLISH_ID_RE);
    // j-<sanitized ≤ 40>-<first 24 hex of SHA-256 of the raw id>
    expect(a1).toBe(`j-wf-run-a1-${sha256Hex("wf:run:a1").slice(0, 24)}`);
    expect(publishJobId({ id: "wf:run:a1" })).toBe(a1);
    expect(publishJobId({ id: "wf:run:a2" })).not.toBe(a1);
    // The run / cancel path segment needs no escaping, so the Worker's path check sees the same id.
    expect(encodeURIComponent(a1)).toBe(a1);
  });

  it("gives Codex's FNV-1a collision pair different ids", () => {
    // From %TEMP%/dashboard-publish-id-plan-probe-2026-10-16.json (both mapped to j-wf-run----------04591cb8).
    const first = "wf:run:厨蠆孒萡妟箸嫓胤";
    const second = "wf:run:昜僎觢洼屡溆嶿琕";
    const a = publishJobId({ id: first });
    const b = publishJobId({ id: second });
    expect(a).not.toBe(b);
    expect(a).not.toBe("j-wf-run----------04591cb8");
    expect(a).toMatch(PUBLISH_ID_RE);
    expect(b).toMatch(PUBLISH_ID_RE);
  });

  it("keeps safe ids and reuses a remembered job id only when the Worker would accept it", () => {
    expect(publishJobId({ id: "p1" })).toBe("p1");
    expect(publishJobId({ id: "3f2a-uuid_like" })).toBe("3f2a-uuid_like");
    expect(publishJobId({ id: "wf:run:a1", autoPost: auto({ jobId: "remembered-1" }) })).toBe(
      "remembered-1",
    );
    // Empty, colon or over-long remembered values (an import may carry them) fall through to the mapping.
    const mapped = publishJobId({ id: "wf:run:a1" });
    for (const jobId of ["", "wf:old:remembered", "x".repeat(101)])
      expect(publishJobId({ id: "wf:run:a1", autoPost: auto({ jobId }) }), jobId).toBe(mapped);
    // Long ids fit in 100 characters; the sanitized part keeps at most 40.
    const long = publishJobId({ id: `wf:${"x".repeat(300)}:a1` });
    expect(long).toMatch(PUBLISH_ID_RE);
    expect(long.length).toBe(2 + 40 + 1 + 24);
    expect(publishJobId({ id: "x".repeat(101) })).toMatch(PUBLISH_ID_RE);
  });

  it("suffixes -2, -3… when another local post already holds the candidate id", () => {
    const mapped = publishJobId({ id: "wf:run:a1" });
    expect(publishJobId({ id: "wf:run:a1" }, new Set([mapped]))).toBe(`${mapped}-2`);
    expect(publishJobId({ id: "wf:run:a1" }, new Set([mapped, `${mapped}-2`]))).toBe(`${mapped}-3`);
    expect(publishJobId({ id: "p1" }, new Set(["p1"]))).toBe("p1-2");
    const hundred = "y".repeat(100);
    expect(publishJobId({ id: hundred }, new Set([hundred]))).toBe(`${"y".repeat(98)}-2`);
    // takenJobIds: other posts' valid remembered job ids and safe ids, never the post's own.
    const posts = [
      sent("wf:run:a1", mapped),
      sent("p2", "wf:bad"),
      post({ id: "wf:run:b1" }),
      post({ id: "p1" }),
    ];
    expect([...takenJobIds(posts, "p1")].sort()).toEqual([mapped, "p2"].sort());
  });

  it("buildJob sends the mapped id (the remembered job id first, then the taken-set suffix)", () => {
    const wf = post({ id: "wf:run-1:p1" });
    expect(buildJob(wf, auto(), AT).id).toBe(publishJobId(wf));
    const remembered = post({ id: "wf:run-1:p1", autoPost: auto({ jobId: "kept-1" }) });
    expect(buildJob(remembered, auto(), AT).id).toBe("kept-1");
    expect(buildJob(post(), auto(), AT).id).toBe("p1");
    expect(buildJob(post(), auto(), AT, new Set(["p1"])).id).toBe("p1-2");
  });

  it("a post owns a job by its remembered id, or by its safe id when it remembers none", () => {
    const mapped = publishJobId({ id: "wf:run:a1" });
    const wf = sent("wf:run:a1", mapped);
    // A safe post id equal to the workflow post's generated id, sent under its own suffixed job id.
    const twin = sent(mapped, `${mapped}-2`);
    const legacy = sent("p1");
    expect(ownsJob(wf, mapped)).toBe(true);
    expect(ownsJob(twin, mapped)).toBe(false);
    expect(ownsJob(twin, `${mapped}-2`)).toBe(true);
    expect(ownsJob(legacy, "p1")).toBe(true);
    expect(ownsJob(sent("wf:run:a1"), mapped)).toBe(false);
    const jobs = [
      { id: mapped, scheduledAt: AT, results: {} },
      { id: `${mapped}-2`, scheduledAt: AT, results: {} },
      { id: "phone-1", scheduledAt: AT, results: {} },
    ];
    expect(remoteJobs(jobs, [twin, wf]).map((j) => j.id)).toEqual(["phone-1"]);
    expect(remoteJobs(jobs, [twin]).map((j) => j.id)).toEqual([mapped, "phone-1"]);
  });
});

describe("jobOwnership (Amendment B, DT-5-R1 R1: one ownership decision for every send, run and cancel)", () => {
  it("uses the remembered id, else a legacy safe id; never allocates; blocks a shared claim", () => {
    const withJob = (id: string, jobId?: string) =>
      post({ id, autoPost: auto({ sentAt: AT, ...(jobId ? { jobId } : {}) }) });
    const a = withJob("wf:run:a1", "C-2");
    expect(jobOwnership(a, [a])).toEqual({ ok: true, jobId: "C-2" });
    expect(jobOwnership(withJob("p1"), [])).toEqual({ ok: true, jobId: "p1" });
    expect(jobOwnership(withJob("wf:run:a1"), [])).toEqual({ ok: false, reason: "unallocated" });
    // Another post remembers the same id, or its own id equals it: blocked, never a new suffix.
    expect(jobOwnership(a, [a, withJob("wf:run:b1", "C-2")])).toEqual({
      ok: false,
      reason: "ambiguous",
    });
    expect(jobOwnership(a, [a, post({ id: "C-2" })])).toEqual({ ok: false, reason: "ambiguous" });
  });
});

describe("DT-5-R1: receipts need exactly one owner (R3)", () => {
  const withJob = (id: string, jobId?: string, sent = true) =>
    post({ id, autoPost: auto({ ...(sent ? { sentAt: AT } : {}), ...(jobId ? { jobId } : {}) }) });
  const job = (id: string) => ({ id, scheduledAt: AT, results: {} });

  it("jobClaim: one remembered owner, a conflict for two, a legacy safe id only when nobody remembers it", () => {
    const a = withJob("wf:a", "J");
    const b = withJob("wf:b", "J");
    expect(jobClaim("J", [a])).toEqual({ owner: a });
    // Order does not matter: both claimants, never the first.
    expect(jobClaim("J", [a, b])).toEqual({ conflict: [a, b] });
    expect(jobClaim("J", [b, a])).toEqual({ conflict: [b, a] });
    const legacy = withJob("p1");
    expect(jobClaim("p1", [legacy])).toEqual({ owner: legacy });
    // A remembered owner wins over a safe-id alias (that alias never takes it).
    const owner = withJob("wf:c", "p1");
    expect(jobClaim("p1", [legacy, owner])).toEqual({ owner });
    // A post never sent does not own a job by its id.
    expect(jobClaim("p9", [withJob("p9", undefined, false)])).toBeNull();
    expect(jobClaim("nobody", [a, b])).toBeNull();
  });

  it("remoteJobs keeps an ambiguous job visible instead of hiding it", () => {
    const a = withJob("wf:a", "J");
    const b = withJob("wf:b", "J");
    expect(remoteJobs([job("J")], [a, b]).map((j) => j.id)).toEqual(["J"]);
    expect(remoteJobs([job("J")], [a]).map((j) => j.id)).toEqual([]);
    // An unconfirmed allocation (no sentAt) is followed: the hub lists it as "allocated, not confirmed".
    expect(remoteJobs([job("K")], [withJob("wf:k", "K", false)])).toEqual([]);
  });
});

describe("DT-5-R2 R1-D: a strict job list for destructive decisions", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: "job-1",
    scheduledAt: AT,
    targets: { instagram: { caption: "c", state: "queued", attempts: 0 } },
    ...over,
  });

  it("accepts only a { jobs: Array } envelope whose every row is complete", () => {
    expect(parseJobsStrict({ jobs: [] })).toEqual({ ok: true, jobs: [] });
    expect(parseJobsStrict({ jobs: [row()] })).toEqual({
      ok: true,
      jobs: parseJobs({ jobs: [row()] }),
    });
    for (const body of [
      {},
      null,
      [],
      "jobs",
      { jobs: {} },
      { jobs: [{ id: "job-1" }] },
      { jobs: [row(), { id: "job-2" }] },
      { jobs: [row({ id: "bad id" })] },
      { jobs: [row({ scheduledAt: "not a date" })] },
      { jobs: [row({ targets: [] })] },
      { jobs: [row({ targets: {} })] },
      { jobs: [row({ targets: { instagram: { state: "exploded" } } })] },
      { jobs: [row({ targets: { myspace: { state: "queued" } } })] },
    ])
      expect(parseJobsStrict(body)).toEqual({ ok: false, reason: "malformed" });
    // The tolerant display parser is unchanged: it still drops what it cannot read.
    expect(parseJobs({ jobs: [{ id: "job-1" }] })).toEqual([]);
    expect(parseJobs({})).toEqual([]);
  });

  it("publishListStrict reports a malformed 200 as a failure, never as an empty list", async () => {
    const reply = (body: unknown) =>
      vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      );
    expect(await publishListStrict(CONFIG, { fetchImpl: reply({}) })).toMatchObject({ ok: false });
    expect(
      await publishListStrict(CONFIG, { fetchImpl: reply({ jobs: [{ id: "job-1" }] }) }),
    ).toMatchObject({ ok: false });
    expect(await publishListStrict(CONFIG, { fetchImpl: reply({ jobs: [row()] }) })).toEqual({
      ok: true,
      jobs: parseJobs({ jobs: [row()] }),
    });
    expect(await publishListStrict(null)).toEqual({ ok: false, error: { type: "unconfigured" } });
  });
});

describe("DT-5-R2 R1-B: the digest of the payload actually sent", () => {
  it("covers the whole job; without its time it ignores only scheduledAt", () => {
    const job = buildJob(post(), auto(), AT);
    expect(payloadHash(job, true)).toBe(sha256Hex(JSON.stringify(job)));
    expect(payloadHash(job, true)).not.toBe(
      payloadHash({ ...job, scheduledAt: "2026-01-01T00:00:00.000Z" }, true),
    );
    expect(payloadHash(job, false)).toBe(
      payloadHash({ ...job, scheduledAt: "2026-01-01T00:00:00.000Z" }, false),
    );
    const other = buildJob(post({ caption: "Another caption" }), auto(), AT);
    expect(payloadHash(other, false)).not.toBe(payloadHash(job, false));
  });
});
