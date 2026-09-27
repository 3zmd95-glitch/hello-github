import type { Platform, Post, PostStage } from "@/lib/domain";
import { addDays } from "@/lib/streak";

/**
 * The platform tab's content-mix tip. Three rules, first match wins:
 * 1. nothing posted on the platform in the last 7 days → post something;
 * 2. two or more live posts all stuck in one stage → move one forward;
 * 3. otherwise → keep the platform's ideal length and mix tutorials with behind-the-scenes.
 */
export type ContentTip =
  | { rule: "noRecent"; daysSince: number | null }
  | { rule: "oneStage"; stage: PostStage; count: number }
  | { rule: "mix" };

export function contentTip(posts: readonly Post[], platform: Platform, today: string): ContentTip {
  const mine = posts.filter((p) => p.platform === platform);
  let lastPosted: string | null = null;
  for (const p of mine) {
    if (p.stage === "posted" && p.postedAt && (!lastPosted || p.postedAt > lastPosted))
      lastPosted = p.postedAt;
  }
  const weekAgo = addDays(today, -7);
  if (!lastPosted || lastPosted.slice(0, 10) < weekAgo) {
    const daysSince = lastPosted
      ? Math.max(
          0,
          Math.round((Date.parse(`${today}T12:00:00+03:00`) - Date.parse(lastPosted)) / 86_400_000),
        )
      : null;
    return { rule: "noRecent", daysSince };
  }
  const live = mine.filter((p) => p.stage !== "posted");
  if (live.length >= 2 && live.every((p) => p.stage === live[0].stage)) {
    return { rule: "oneStage", stage: live[0].stage, count: live.length };
  }
  return { rule: "mix" };
}
