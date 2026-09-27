import type { Demographic, SocialAccount, SocialSnapshotInput } from "@/lib/domain";
import type { PersistedState, StoreActions } from "@/store";

/**
 * The owner's real Beacons.ai numbers on Sep 27, 2026 (the handover's "Account snapshot"): the acceptance
 * figures the rebuilt Social Analytics page must reproduce. `applySocialSeed` inserts them once into an empty
 * store; the UI/shell calls it after hydration (see below). Metrics keep the handover's names; "-" values in
 * Beacons are simply left unset.
 */

/** Bump when the seed rows change so a store that applied an older seed is not touched again anyway. */
export const SOCIAL_SEED_VERSION = "2026-09-27";
export const SOCIAL_SEED_DAY = "2026-09-27";

/** Platforms the seed covers: the four accounts connected in Beacons. */
export const SOCIAL_SEED_PLATFORMS = ["tiktok", "instagram", "youtube", "threads"] as const;

export const SEED_SNAPSHOTS: readonly SocialSnapshotInput[] = [
  {
    platform: "tiktok",
    day: SOCIAL_SEED_DAY,
    followers: 1200,
    engagementRate: 7.8,
    avgLikes: 2300,
    avgViews: 30200,
    avgShares: 134,
    avgComments: 66,
    note: "Beacons.ai Social Analytics, Sep 27 2026",
  },
  {
    platform: "instagram",
    day: SOCIAL_SEED_DAY,
    followers: 272,
    // Engagement, story views and story clicks showed "-" (Instagram disconnected in Beacons).
    avgLikes: 0,
    avgViews: 0,
    avgReelsViews: 0,
    totalPosts: 14,
    note: "Beacons.ai Social Analytics, Sep 27 2026 (Instagram disconnected: engagement unknown)",
  },
  {
    platform: "youtube",
    day: SOCIAL_SEED_DAY,
    followers: 6,
    avgLikes: 0,
    avgViews: 0,
    avgComments: 0,
    avgVideoViews: 0,
    avgShortsViews: 2,
    note: "Beacons.ai Social Analytics, Sep 27 2026 (6 subscribers)",
  },
  {
    platform: "threads",
    day: SOCIAL_SEED_DAY,
    followers: 0,
    engagementRate: 6.5,
    avgLikes: 8,
    avgViews: 1100,
    avgShares: 1,
    avgComments: 3,
    note: "Beacons.ai Social Analytics, Sep 27 2026",
  },
];

const demo = (
  platform: Demographic["platform"],
  dimension: Demographic["dimension"],
  entries: Record<string, number>,
): Demographic[] =>
  Object.entries(entries).map(([key, pct]) => ({
    platform,
    day: SOCIAL_SEED_DAY,
    dimension,
    key,
    pct,
  }));

/** Beacons' two demographics tables (country keys are ISO-3166 codes; "other" = Beacons' "others"). */
export const SEED_DEMOGRAPHICS: readonly Demographic[] = [
  ...demo("tiktok", "gender", { male: 56, female: 44 }),
  ...demo("tiktok", "age", { "18-24": 25, "25-34": 53, "35-44": 16.7, "45-54": 3, "55-64": 2.3 }),
  ...demo("tiktok", "country", { SA: 73.1, other: 16, EG: 3.1, IQ: 1.4, LY: 1.4, AE: 1 }),
  ...demo("instagram", "gender", { male: 90.8, female: 9.2 }),
  ...demo("instagram", "age", {
    "13-17": 1.8,
    "18-24": 37.7,
    "25-34": 50.4,
    "35-44": 6.9,
    "45-54": 1.8,
  }),
  ...demo("instagram", "country", { SA: 31.5, IQ: 17, EG: 10.1, MA: 5.8, YE: 5.1, OM: 4.3 }),
];

export const YOUTUBE_CHANNEL_URL = "https://www.youtube.com/channel/UC6YG-KIzgklFou8I3pS1elA";

export const SEED_ACCOUNTS: readonly SocialAccount[] = [
  { platform: "tiktok", handle: "3z.prod", url: "https://www.tiktok.com/@3z.prod" },
  { platform: "instagram", handle: "3z.prod", url: "https://www.instagram.com/3z.prod/" },
  { platform: "threads", handle: "3z.prod", url: "https://www.threads.net/@3z.prod" },
  { platform: "youtube", handle: "3zprod", url: YOUTUBE_CHANNEL_URL },
];

/** What applySocialSeed needs from the store: `useStore.getState()` satisfies it. */
export type SocialSeedStore = Pick<
  PersistedState,
  "socialSnapshots" | "socialAccounts" | "demographics" | "socialSeedApplied"
> &
  Pick<
    StoreActions,
    "importSnapshots" | "importDemographics" | "setAccount" | "setSocialSeedApplied"
  >;

export type SocialSeedOutcome =
  /** Rows inserted and the version flagged. */
  | "applied"
  /** This version was flagged before (nothing touched). */
  | "already-applied"
  /** The owner already has snapshots for these platforms or accounts; flagged so it never asks again. */
  | "skipped";

/**
 * Insert the seed once. Runs only when the store has no snapshot for any seed platform, no demographics for
 * them and no accounts at all; otherwise it flags the version and leaves the owner's data alone. Because the
 * version is stored (`socialSeedApplied`), deleting the seeded rows later never brings them back.
 *
 * Not called by the store itself (it stays pure): the shell calls
 * `hydrateStore(); applySocialSeed(useStore.getState())` once on the client after hydration.
 */
export function applySocialSeed(store: SocialSeedStore): SocialSeedOutcome {
  if (store.socialSeedApplied === SOCIAL_SEED_VERSION) return "already-applied";
  const seeded = new Set<string>(SOCIAL_SEED_PLATFORMS);
  const hasData =
    store.socialAccounts.length > 0 ||
    store.socialSnapshots.some((s) => seeded.has(s.platform)) ||
    store.demographics.some((d) => seeded.has(d.platform));
  if (hasData) {
    store.setSocialSeedApplied(SOCIAL_SEED_VERSION);
    return "skipped";
  }
  store.importSnapshots(SEED_SNAPSHOTS);
  store.importDemographics(SEED_DEMOGRAPHICS);
  for (const a of SEED_ACCOUNTS) store.setAccount(a.platform, a.handle, a.url);
  store.setSocialSeedApplied(SOCIAL_SEED_VERSION);
  return "applied";
}
