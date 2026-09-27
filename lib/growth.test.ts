import { describe, expect, it } from "vitest";
import type { AudienceAsk, SocialSnapshot } from "./domain";
import {
  bestPlatform,
  latestSnapshot,
  parseStatsCsv,
  series,
  snapshotDelta,
  topAsks,
  totals,
  upsertSnapshots,
} from "./growth";

const snap = (
  platform: SocialSnapshot["platform"],
  day: string,
  followers: number,
  views30d: number,
  engagementPct?: number,
): SocialSnapshot => ({
  platform,
  day,
  followers,
  views30d,
  ...(engagementPct !== undefined ? { engagementPct } : {}),
});

const data: SocialSnapshot[] = [
  snap("tiktok", "2026-08-01", 1000, 50_000, 4),
  snap("tiktok", "2026-08-20", 1200, 60_000),
  snap("tiktok", "2026-09-27", 1500, 90_000, 5),
  snap("instagram", "2026-09-27", 800, 20_000, 3),
  snap("youtube", "2026-06-01", 100, 1_000),
  snap("youtube", "2026-09-20", 90, 500),
];

describe("snapshots", () => {
  it("upsertSnapshots replaces the same platform + day and appends the rest", () => {
    const out = upsertSnapshots(data, [
      snap("tiktok", "2026-09-27", 1600, 91_000),
      snap("x", "2026-09-27", 10, 20),
    ]);
    expect(out).toHaveLength(data.length + 1);
    expect(latestSnapshot(out, "tiktok")?.followers).toBe(1600);
    expect(latestSnapshot(out, "x")?.followers).toBe(10);
    expect(data).toHaveLength(6); // input untouched
  });

  it("latestSnapshot picks the newest day", () => {
    expect(latestSnapshot(data, "tiktok")?.day).toBe("2026-09-27");
    expect(latestSnapshot(data, "snapchat")).toBeUndefined();
  });

  it("snapshotDelta compares with the newest snapshot at least N days back", () => {
    const d = snapshotDelta(data, "tiktok", 30);
    expect(d.latest?.day).toBe("2026-09-27");
    expect(d.baseline?.day).toBe("2026-08-20"); // 38 days back; 08-01 is older
    expect(d.followers).toBe(300);
    expect(d.followersPct).toBe(25);
    expect(d.views).toBe(30_000);
    expect(d.viewsPct).toBe(50);
    expect(snapshotDelta(data, "tiktok", 7).baseline?.day).toBe("2026-08-20"); // still the newest ≤ cutoff
    expect(snapshotDelta(data, "tiktok", 100).baseline).toBeNull(); // nothing that far back
    expect(snapshotDelta(data, "instagram").followers).toBeNull();
    expect(snapshotDelta(data, "snapchat").latest).toBeNull();
    const yt = snapshotDelta(data, "youtube", 30);
    expect(yt.followers).toBe(-10);
    expect(yt.followersPct).toBe(-10);
  });

  it("totals sums the latest per platform and averages engagement", () => {
    const t = totals(data);
    expect(t.followers).toBe(1500 + 800 + 90);
    expect(t.views30d).toBe(90_000 + 20_000 + 500);
    expect(t.engagementPct).toBe(4); // (5 + 3) / 2
    expect(t.platforms).toEqual(["tiktok", "instagram", "youtube"]);
    expect(totals([])).toEqual({ followers: 0, views30d: 0, engagementPct: null, platforms: [] });
  });

  it("series returns the window sorted oldest first", () => {
    const s = series(data, "tiktok", 90, "2026-09-27");
    expect(s.map((p) => p.day)).toEqual(["2026-08-01", "2026-08-20", "2026-09-27"]);
    expect(s[0]).toEqual({ day: "2026-08-01", followers: 1000, views30d: 50_000 });
    expect(series(data, "tiktok", 30, "2026-09-27").map((p) => p.day)).toEqual(["2026-09-27"]);
    expect(series(data, "snapchat")).toEqual([]);
  });

  it("bestPlatform is the biggest 30-day follower gain among platforms with a baseline", () => {
    expect(bestPlatform(data)).toEqual({ platform: "tiktok", followers: 300, followersPct: 25 });
    expect(bestPlatform([snap("x", "2026-09-27", 5, 5)])).toBeNull();
    const shrinkOnly = data.filter((s) => s.platform === "youtube");
    expect(bestPlatform(shrinkOnly)?.platform).toBe("youtube");
  });
});

describe("parseStatsCsv", () => {
  it("parses a header, aliases, K/M numbers, day formats and percentages", () => {
    const { snapshots, errors } = parseStatsCsv(
      [
        "platform,day,followers,views30d,engagementPct",
        "tiktok,2026-09-27,1.5k,90000,5",
        "IG;27/09/2026;800;20,5%",
        "",
        "# comment",
        'yt,"2026-09-20",90,500',
      ].join("\n"),
    );
    expect(errors).toEqual([]);
    expect(snapshots).toEqual([
      snap("tiktok", "2026-09-27", 1500, 90_000, 5),
      snap("instagram", "2026-09-27", 800, 20, 5),
      snap("youtube", "2026-09-20", 90, 500),
    ]);
  });

  it("reports bad lines with their line numbers and keeps the good ones", () => {
    const { snapshots, errors } = parseStatsCsv(
      [
        "tiktok,2026-09-27,100,200",
        "facebook,2026-09-27,1,2",
        "tiktok,yesterday,1,2",
        "tiktok,2026-09-28,lots,2",
        "tiktok,2026-09-28",
        "tiktok,2026-09-29,10,20,140",
        "tiktok,2026-09-27,300,400",
      ].join("\n"),
    );
    expect(snapshots).toEqual([snap("tiktok", "2026-09-27", 300, 400)]); // later line wins
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4, 5, 6]);
    expect(errors[0].message).toContain("facebook");
    expect(errors[1].message).toContain("YYYY-MM-DD");
  });

  it("handles an empty input", () => {
    expect(parseStatsCsv("")).toEqual({ snapshots: [], errors: [] });
  });
});

describe("topAsks", () => {
  const ask = (id: string, count: number, createdAt: string): AudienceAsk => ({
    id,
    text: id,
    count,
    createdAt,
  });
  it("sorts by count then newest and caps at n", () => {
    const asks = [
      ask("a", 3, "2026-09-01T00:00:00.000Z"),
      ask("b", 10, "2026-09-01T00:00:00.000Z"),
      ask("c", 3, "2026-09-05T00:00:00.000Z"),
      ask("d", 1, "2026-09-05T00:00:00.000Z"),
    ];
    expect(topAsks(asks).map((a) => a.id)).toEqual(["b", "c", "a"]);
    expect(topAsks(asks, 1).map((a) => a.id)).toEqual(["b"]);
    expect(topAsks(asks, 0)).toEqual([]);
    expect(asks[0].id).toBe("a"); // input order untouched
  });
});
