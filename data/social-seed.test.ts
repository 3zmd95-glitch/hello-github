import { z } from "zod";
import { beforeEach, describe, expect, it } from "vitest";
import { allOverview, demographicsFor, platformOverview } from "@/lib/analytics";
import { DemographicSchema, SocialAccountSchema, SocialSnapshotSchema } from "@/lib/domain";
import { useStore } from "@/store";
import {
  SEED_ACCOUNTS,
  SEED_DEMOGRAPHICS,
  SEED_SNAPSHOTS,
  SOCIAL_SEED_DAY,
  SOCIAL_SEED_VERSION,
  YOUTUBE_CHANNEL_URL,
  applySocialSeed,
} from "./social-seed";

const S = () => useStore.getState();
const NOW = `${SOCIAL_SEED_DAY}T12:00:00.000Z`;

describe("social seed data", () => {
  it("parses with the Zod schemas", () => {
    expect(() => z.array(SocialSnapshotSchema).parse(SEED_SNAPSHOTS)).not.toThrow();
    expect(() => z.array(DemographicSchema).parse(SEED_DEMOGRAPHICS)).not.toThrow();
    expect(() => z.array(SocialAccountSchema).parse(SEED_ACCOUNTS)).not.toThrow();
    expect(SEED_SNAPSHOTS.map((s) => s.platform)).toEqual([
      "tiktok",
      "instagram",
      "youtube",
      "threads",
    ]);
    expect(SEED_ACCOUNTS.find((a) => a.platform === "youtube")?.url).toBe(YOUTUBE_CHANNEL_URL);
    expect(SEED_ACCOUNTS.every((a) => a.platform === "youtube" || a.handle === "3z.prod")).toBe(
      true,
    );
  });

  it("reproduces the Beacons 'All' acceptance numbers", () => {
    const snapshots = z.array(SocialSnapshotSchema).parse(SEED_SNAPSHOTS);
    const all = allOverview({ snapshots, postStats: [], accounts: [...SEED_ACCOUNTS] }, NOW);
    expect(all.totalFollowers).toBe(1478); // "1.5k" = 1200 + 272 + 6 + 0
    expect(all.avgEngagement).toBe(7.15); // mean of 7.8 (TikTok) and 6.5 (Threads); the others show "-"
    expect(all.avgLikes).toBe(577); // mean of 2300, 0, 0, 8
    expect(all.avgViews).toBe(7825); // "7.8k"
    expect(all.platforms.map((p) => p.platform)).toEqual([
      "tiktok",
      "instagram",
      "youtube",
      "threads",
    ]);
    const tt = platformOverview(
      { snapshots, postStats: [], accounts: [...SEED_ACCOUNTS] },
      "tiktok",
      NOW,
    );
    expect(tt.followers).toBe(1200);
    expect(tt.rows.map((r) => [r.metric, r.value])).toEqual([
      ["engagement", 7.8],
      ["avgViews", 30_200],
      ["avgLikes", 2300],
      ["avgShares", 134],
      ["avgComments", 66],
    ]);
    const yt = all.platforms[2];
    expect(yt.cardRows[0]).toMatchObject({ metric: "totalSubscribers", value: 6 });
    expect(yt.metrics.avgShortsViews).toBe(2);
    expect(yt.metrics.engagement).toBeNull();
    const ig = all.platforms[1];
    expect(ig.metrics.engagement).toBeNull();
    expect(ig.metrics.totalPosts).toBe(14);
    expect(ig.metrics.avgStoryViews).toBeNull();
  });

  it("orders demographics as Beacons does: Saudi Arabia first, 25-34 the largest bucket", () => {
    for (const platform of ["tiktok", "instagram"] as const) {
      expect(demographicsFor(SEED_DEMOGRAPHICS, platform, "country")[0].key).toBe("SA");
      expect(demographicsFor(SEED_DEMOGRAPHICS, platform, "age")[0].key).toBe("25-34");
      expect(demographicsFor(SEED_DEMOGRAPHICS, platform, "gender")[0].key).toBe("male");
      const sum = (dim: "gender" | "age" | "country") =>
        demographicsFor(SEED_DEMOGRAPHICS, platform, dim).reduce((a, r) => a + r.pct, 0);
      expect(sum("gender")).toBeCloseTo(100, 5);
      expect(sum("age")).toBeGreaterThan(95);
      expect(sum("country")).toBeLessThanOrEqual(100);
    }
    expect(demographicsFor(SEED_DEMOGRAPHICS, "tiktok", "gender")[0].pct).toBe(56);
    expect(demographicsFor(SEED_DEMOGRAPHICS, "instagram", "gender")[0].pct).toBe(90.8);
    expect(demographicsFor(SEED_DEMOGRAPHICS, "youtube", "gender")).toEqual([]);
  });
});

describe("applySocialSeed", () => {
  beforeEach(() => S().reset());

  it("seeds an empty store once and flags the version", () => {
    expect(applySocialSeed(S())).toBe("applied");
    expect(S().socialSeedApplied).toBe(SOCIAL_SEED_VERSION);
    expect(S().socialSnapshots).toHaveLength(4);
    expect(S().socialSnapshots[0]).toMatchObject({
      platform: "tiktok",
      followers: 1200,
      engagementPct: 7.8,
      engagementRate: 7.8,
      views30d: 0,
    });
    expect(S().demographics).toHaveLength(SEED_DEMOGRAPHICS.length);
    expect(S().socialAccounts.map((a) => `${a.platform}:${a.handle}`)).toEqual([
      "tiktok:3z.prod",
      "instagram:3z.prod",
      "threads:3z.prod",
      "youtube:3zprod",
    ]);
    expect(applySocialSeed(S())).toBe("already-applied");
    expect(S().socialSnapshots).toHaveLength(4);
  });

  it("never re-inserts rows the owner deleted", () => {
    applySocialSeed(S());
    S().removeSnapshot("tiktok", SOCIAL_SEED_DAY);
    S().clearDemographics("instagram");
    expect(applySocialSeed(S())).toBe("already-applied");
    expect(S().socialSnapshots).toHaveLength(3);
    expect(S().demographics.some((d) => d.platform === "instagram")).toBe(false);
  });

  it("leaves a store that already holds the owner's data alone (and flags it)", () => {
    S().setAccount("x", "3zprod");
    expect(applySocialSeed(S())).toBe("skipped");
    expect(S().socialSnapshots).toEqual([]);
    expect(S().socialAccounts).toHaveLength(1);
    expect(S().socialSeedApplied).toBe(SOCIAL_SEED_VERSION);
    S().reset();
    S().addSnapshot({ platform: "threads", day: "2026-09-01", followers: 3 });
    expect(applySocialSeed(S())).toBe("skipped");
    expect(S().socialSnapshots).toHaveLength(1);
    S().reset();
    // A snapshot on a platform the seed does not cover is not "the owner's social data" yet.
    S().addSnapshot({ platform: "snapchat", day: "2026-09-01", followers: 3 });
    expect(applySocialSeed(S())).toBe("applied");
    expect(S().socialSnapshots).toHaveLength(5);
  });
});
