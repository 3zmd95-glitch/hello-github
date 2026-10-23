import {
  averageSample,
  platformOverview,
  type AnalyticsState,
  type MetricKey,
  type Now,
} from "./analytics";
import { isHttpsUrl } from "./articles";
import {
  BusinessKitSchema,
  DEFAULT_RATE_SETTINGS,
  PLATFORMS,
  type BrandDeal,
  type BusinessKit,
  type Platform,
  type RateDeliverable,
  type RateSettings,
  type SocialAccount,
  type SocialPostStat,
  type SocialSnapshot,
} from "./domain";
import { isStartingRates, rateQuote } from "./rates";
import { dayKey, daysBetween } from "./streak";

/**
 * 💼 Business Kit (packet DT-5, planning/tools/35-business-kit.md): the media kit's numbers, checks, the deal reply's
 * price (rate card, else the rate calculator in lib/rates) and the shareable projection. Pure. Every metric is per
 * platform and keeps its own provenance: a saved Growth snapshot with the day it was observed, or the imported posts
 * it was averaged over (count and date range), or missing. Nothing is pooled here (the media-kit page's followers
 * total is lib/mediaKit) and a snapshot's `views30d` (0 when unknown) is never shown. The projection never carries
 * prices: the rate card is private. `snapshotSource()` (lib/socialSync) is not used: it infers "live" and is no
 * evidence for a public claim.
 */

/** A snapshot older than this many days is shown as stale. */
export const KIT_STALE_DAYS = 30;

export type KitValue =
  | { source: "snapshot"; value: number; observedDay: string }
  | { source: "posts"; value: number; sample: number; range: { from: string; to: string } }
  | { source: "none" };

export interface KitMetric {
  platform: Platform;
  handle: string | null;
  followers: { source: "snapshot"; value: number; observedDay: string } | { source: "none" };
  engagement: KitValue;
  avgViews: KitValue;
  avgLikes: KitValue;
  /** The saved snapshot was observed more than KIT_STALE_DAYS days before today. */
  stale: boolean;
}

const NONE = { source: "none" } as const;

/**
 * The kit's numbers for `platforms` (default: every platform with a snapshot, imported posts or a saved handle, in
 * PLATFORMS order). Snapshots dated after today (Riyadh) and posts published after `now` are dropped before
 * platformOverview runs; stories are left out by its own averaging sample (30 days with at least 5 posts, else the
 * latest 20). The engagement sample and range count only posts with views, as the Growth average does.
 */
export function kitMetrics(
  state: AnalyticsState,
  now: Now = new Date(),
  platforms?: readonly Platform[],
): KitMetric[] {
  const end = typeof now === "number" ? now : new Date(now).getTime();
  const today = dayKey(end);
  const st: AnalyticsState = {
    ...state,
    snapshots: state.snapshots.filter((s) => s.day <= today),
    postStats: state.postStats.filter((p) => Date.parse(p.publishedAt) <= end),
  };
  const list = platforms ?? PLATFORMS.filter((p) => platformOverview(st, p, now).connected);
  return list.map((platform) => {
    const o = platformOverview(st, platform, now);
    const { posts } = averageSample(st.postStats, platform, now);
    // engagementOfPost skips posts without views, so its denominator does too.
    const withViews = posts.filter((p) => p.views > 0);
    // R6: extrema of the real instants (ISO text with different offsets does not sort chronologically).
    const span = (list: readonly SocialPostStat[]) => {
      const times = list.map((p) => Date.parse(p.publishedAt));
      return { from: dayKey(Math.min(...times)), to: dayKey(Math.max(...times)) };
    };
    const value = (key: MetricKey): KitValue => {
      const v = o.metrics[key];
      if (v === null || o.sources[key] === "none") return NONE;
      if (o.sources[key] === "snapshot" && o.snapshot)
        return { source: "snapshot", value: v, observedDay: o.snapshot.day };
      const sample = key === "engagement" ? withViews : posts;
      if (o.sources[key] === "posts" && sample.length)
        return { source: "posts", value: v, sample: sample.length, range: span(sample) };
      return NONE;
    };
    return {
      platform,
      handle: o.account?.handle ?? null,
      followers:
        o.followers !== null && o.snapshot
          ? { source: "snapshot", value: o.followers, observedDay: o.snapshot.day }
          : NONE,
      engagement: value("engagement"),
      avgViews: value("avgViews"),
      avgLikes: value("avgLikes"),
      stale: o.snapshot ? daysBetween(o.snapshot.day, today) > KIT_STALE_DAYS : false,
    };
  });
}

/* ---------- Checks ---------- */

export type KitIssueCode =
  | "tagline-empty-both"
  | "bio-empty-both"
  | "email-format"
  | "website-not-https"
  | "service-name-empty"
  | "rate-deliverable-empty"
  | "pastwork-url-not-https";

export interface KitIssue {
  code: KitIssueCode;
  /** The row of a list section the issue is about. */
  index?: number;
}

const blank = (t: { ar: string; en: string }) => !t.ar.trim() && !t.en.trim();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What the owner should fix before sharing the kit, in display order. Advisory: saving is never blocked. */
export function kitIssues(kit: BusinessKit): KitIssue[] {
  const out: KitIssue[] = [];
  if (blank(kit.tagline)) out.push({ code: "tagline-empty-both" });
  if (blank(kit.bio)) out.push({ code: "bio-empty-both" });
  const email = kit.contact.email.trim();
  if (email && !EMAIL_RE.test(email)) out.push({ code: "email-format" });
  if (kit.contact.website.trim() && !isHttpsUrl(kit.contact.website))
    out.push({ code: "website-not-https" });
  kit.services.forEach((s, index) => {
    if (blank(s.name)) out.push({ code: "service-name-empty", index });
  });
  kit.rateCard.forEach((r, index) => {
    if (blank(r.deliverable)) out.push({ code: "rate-deliverable-empty", index });
  });
  kit.pastWork.forEach((w, index) => {
    if (w.url.trim() && !isHttpsUrl(w.url)) out.push({ code: "pastwork-url-not-https", index });
  });
  return out;
}

/* ---------- Public projection ---------- */

/** What the projection reads; anything else a caller passes (deals, settings, keys…) is ignored. */
export interface KitSource {
  businessKit: BusinessKit | null;
  socialSnapshots: readonly SocialSnapshot[];
  socialPostStats: readonly SocialPostStat[];
  socialAccounts: readonly SocialAccount[];
}

type Bi = { ar: string; en: string };
const bi = (t: Bi): Bi => ({ ar: t.ar, en: t.en });

export interface KitProjection {
  app: "3z-prod-media-kit";
  version: 1;
  generatedAt: string;
  lang: ["ar", "en"];
  tagline: Bi;
  bio: Bi;
  contact: { email: string; website: string; location: Bi };
  services: { name: Bi; desc: Bi }[];
  pastWork: { title: Bi; url: string; platform?: Platform; day?: string }[];
  metrics: KitMetric[];
}

/** An empty kit for screens and the projection before the first save (no id, no commit). */
export function emptyKit(): BusinessKit {
  return BusinessKitSchema.parse({ commitId: "-", updatedAt: "1970-01-01T00:00:00.000Z" });
}

/**
 * The shareable kit, built field by field (an allowlist): the owner's public text, past work and the per-platform
 * metrics with provenance. Never prices (the rate card is private), deals, the estimator, settings, keys, raw
 * snapshots or ids.
 */
export function kitProjection(state: KitSource, now: Now = new Date()): KitProjection {
  const kit = state.businessKit ?? emptyKit();
  const at = new Date(typeof now === "string" ? Date.parse(now) : now);
  return {
    app: "3z-prod-media-kit",
    version: 1,
    generatedAt: at.toISOString(),
    lang: ["ar", "en"],
    tagline: bi(kit.tagline),
    bio: bi(kit.bio),
    contact: {
      email: kit.contact.email,
      website: kit.contact.website,
      location: bi(kit.contact.location),
    },
    services: kit.services.map((s) => ({ name: bi(s.name), desc: bi(s.desc) })),
    pastWork: kit.pastWork.map((w) => ({
      title: bi(w.title),
      url: w.url,
      ...(w.platform ? { platform: w.platform } : {}),
      ...(w.day ? { day: w.day } : {}),
    })),
    metrics: kitMetrics(
      {
        snapshots: state.socialSnapshots,
        postStats: state.socialPostStats,
        accounts: state.socialAccounts,
      },
      now,
      kit.featuredPlatforms.length ? kit.featuredPlatforms : undefined,
    ),
  };
}

/** The export's file name; `unsaved` marks a draft that is not saved yet. */
export function kitFileName(now: Date = new Date(), unsaved = false): string {
  return `3z-prod-media-kit-${dayKey(now)}${unsaved ? "-unsaved" : ""}.json`;
}

/* ---------- Brand-deal reply draft (DT-5-R1: local, editable, never sent) ---------- */

/** A price the draft may quote: the owner's rate-card row for the deliverable, or the rate calculator's guess. */
export type DealRate = { kind: "card" | "estimate"; sar: number };

/** The calculator's deliverable kinds as a brand writes them (first match wins: a "reel and story bundle" is one). */
const KIND_WORDS: readonly [RateDeliverable, RegExp][] = [
  ["bundle", /bundle|package|باقة|باقه/i],
  ["reel", /reel|ريل/i],
  ["story", /stor(?:y|ies)|ستوري|قصة|قصص/i],
  ["post", /post|منشور|بوست/i],
];

/**
 * The price for a deal's deliverable: a priced rate-card row whose name (either language) the deliverable mentions;
 * else, when the deliverable names a kind and a saved follower count exists, the rate calculator with the owner's
 * assumptions (`rates`, lib/rates). Null otherwise (no number is made up).
 */
export function dealRate(
  deal: Pick<BrandDeal, "deliverable">,
  kit: BusinessKit,
  metrics: readonly KitMetric[],
  rates: RateSettings = DEFAULT_RATE_SETTINGS,
): DealRate | null {
  const wanted = deal.deliverable.trim().toLowerCase();
  if (!wanted) return null;
  const row = kit.rateCard.find(
    (r) =>
      r.priceSar !== null &&
      [r.deliverable.en, r.deliverable.ar].some((n) => {
        const name = n.trim().toLowerCase();
        return !!name && wanted.includes(name);
      }),
  );
  if (row?.priceSar != null) return { kind: "card", sar: row.priceSar };
  // Placeholder numbers are not the owner's price: no estimate until one assumption has been edited.
  if (isStartingRates(rates)) return null;
  const kind = KIND_WORDS.find(([, re]) => re.test(wanted))?.[0];
  const m = metrics.find((x) => x.followers.source === "snapshot");
  if (!kind || !m || m.followers.source !== "snapshot") return null;
  const quote = rateQuote(
    rates,
    m.followers.value,
    m.avgViews.source === "none" ? null : m.avgViews.value,
    kind,
  );
  return quote === null ? null : { kind: "estimate", sar: quote.sar };
}

/** The reply draft's limit (BrandDealSchema.replyDraft). */
export const REPLY_DRAFT_MAX = 2000;

const sar = (n: number) => n.toLocaleString("en-US");

/**
 * A bilingual reply to a brand, Arabic first then English, from the deal (brand, deliverable, value) and the kit
 * (services, the rate for the deliverable). A starting point the owner edits and copies; nothing is sent.
 */
export function dealReplyDraft(
  deal: Pick<BrandDeal, "brand" | "deliverable" | "valueSar">,
  kit: BusinessKit,
  rate: DealRate | null,
): string {
  const brand = deal.brand.trim();
  const what = deal.deliverable.trim();
  // Each service in the block's language, the other language when that one is empty.
  const list = (lang: "ar" | "en") =>
    kit.services
      .map((s) => s.name[lang].trim() || s.name[lang === "ar" ? "en" : "ar"].trim())
      .filter(Boolean);
  const ar = [
    `مرحبا فريق ${brand}،`,
    what
      ? `شكرًا على تواصلكم! يسعدني أشتغل معكم على: ${what}.`
      : "شكرًا على تواصلكم! يسعدني نتعاون.",
    list("ar").length ? `اللي أقدّمه: ${list("ar").join("، ")}.` : "",
    rate
      ? rate.kind === "card"
        ? `سعري لهذا: ${sar(rate.sar)} ريال (من قائمة أسعاري).`
        : `تقديري المبدئي: ${sar(rate.sar)} ريال (نأكده بعد ما أشوف التفاصيل).`
      : "",
    deal.valueSar !== null ? `الميزانية اللي تكلمنا عنها: ${sar(deal.valueSar)} ريال.` : "",
    "أرسلوا لي التفاصيل والمواعيد ونتفق.",
    "تحياتي",
  ];
  const en = [
    `Hi ${brand} team,`,
    what
      ? `Thanks for reaching out! I'd love to work with you on: ${what}.`
      : "Thanks for reaching out! I'd love to work together.",
    list("en").length ? `What I offer: ${list("en").join(", ")}.` : "",
    rate
      ? rate.kind === "card"
        ? `My rate for this: ${sar(rate.sar)} SAR (from my rate card).`
        : `My starting estimate: ${sar(rate.sar)} SAR (to confirm once I see the brief).`
      : "",
    deal.valueSar !== null ? `Budget we discussed: ${sar(deal.valueSar)} SAR.` : "",
    "Send me the brief and dates and we'll take it from there.",
    "Best,",
  ];
  const block = (lines: string[]) => lines.filter(Boolean).join("\n");
  return `${block(ar)}\n\n---\n\n${block(en)}`.slice(0, REPLY_DRAFT_MAX);
}
