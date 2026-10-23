"use client";

import { Check } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { fmtTimes } from "@/components/social/growth/HashtagSets";
import { useToday } from "@/components/today/useToday";
import type { Post } from "@/lib/domain";
import {
  fitTags,
  hashtagCuts,
  hashtagLevel,
  hashtagLimit,
  hashtagSetStats,
  matchesSet,
} from "@/lib/hashtags";
import { useT } from "@/lib/i18n";
import { CAPTION_MAX } from "@/lib/publish";
import { PLATFORM_META } from "@/lib/social";
import { useStore } from "@/store";

/**
 * A8 · Saved hashtag sets inside a post's Overview: tap a set to add its tags to the post, and save the post's own
 * tags as a new set (or update the set of that name). A set that already did well on at least five of the owner's
 * posts wears its "x2.5" (views against the platform's usual); the full list is in Growth.
 *
 * Also where the limits of the networks speak, so no hashtag disappears without a word: Instagram takes 30 at most
 * (a note from 25, and a set that would pass 30 is not added at all), and a network whose caption limit cuts the
 * hashtags off the end says how many it cuts.
 */
export default function HashtagSetPicker({ post }: { post: Post }) {
  const { t, L } = useT();
  const sets = useStore((s) => s.hashtagSets);
  const posts = useStore((s) => s.posts);
  const stats = useStore((s) => s.socialPostStats);
  const addSet = useStore((s) => s.addHashtagSet);
  const updatePost = useStore((s) => s.updatePost);
  const today = useToday();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [blocked, setBlocked] = useState<{ n: number; room: number } | null>(null);

  const limit = hashtagLimit(post);
  const level = hashtagLevel(post);
  const cuts = hashtagCuts(post);

  const results = useMemo(
    () =>
      new Map(
        hashtagSetStats(sets, posts, stats, Date.parse(`${today}T23:59:59+03:00`)).map((r) => [
          r.setId,
          r,
        ]),
      ),
    [sets, posts, stats, today],
  );

  /** A set goes in whole or not at all (a half set would also muddle its numbers). */
  const apply = (tags: readonly string[]) => {
    const { add, refused } = fitTags(post, tags);
    if (refused > 0) {
      setBlocked({ n: add.length + refused, room: add.length });
      return;
    }
    setBlocked(null);
    if (add.length) updatePost(post.id, { hashtags: [...post.hashtags, ...add] });
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!addSet(name, post.hashtags)) return;
    setName("");
    setNaming(false);
  };

  return (
    <div className="mt-1 flex flex-col gap-1.5" data-testid="hashtag-set-picker">
      {sets.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-x-1.5 gap-y-3"
          role="group"
          aria-label={t("calendar.hs.sets")}
        >
          {sets.map((set) => {
            const r = results.get(set.id);
            const applied = matchesSet(set, post);
            return (
              <button
                key={set.id}
                type="button"
                className="px-fchip"
                onClick={() => apply(set.tags)}
                title={set.tags.join(" ")}
                data-testid="hashtag-set-apply"
                data-applied={applied}
              >
                {applied && (
                  <Check size={14} strokeWidth={2} className="me-1 shrink-0" aria-hidden />
                )}
                {set.name}
                {r?.enough && r.vsMedian !== null && (
                  <span className="num text-tint ms-1.5 text-xs font-semibold" dir="ltr">
                    {fmtTimes(r.vsMedian)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {blocked && limit !== null && (
        <p role="alert" className="text-danger text-xs" data-testid="hashtag-set-blocked">
          {t("calendar.hs.igBlock", { n: blocked.n, room: blocked.room, max: limit })}
        </p>
      )}
      {level !== "ok" && limit !== null && (
        <p
          className="text-warn text-xs"
          role={level === "full" ? "status" : undefined}
          data-testid="hashtag-limit-note"
          data-level={level}
        >
          {level === "full"
            ? t("calendar.hs.igFull", { max: limit })
            : t("calendar.hs.igNear", { n: post.hashtags.length, max: limit })}
        </p>
      )}
      {cuts.map(({ platform, cut }) => (
        <p
          key={platform}
          className="text-warn text-xs"
          data-testid="hashtag-cut-note"
          data-platform={platform}
          data-cut={cut}
        >
          {t("calendar.hs.cut", {
            platform: L(PLATFORM_META[platform].name),
            n: cut,
            limit: CAPTION_MAX[platform],
          })}
        </p>
      ))}
      {naming ? (
        <form onSubmit={save} className="flex items-center gap-2">
          <input
            type="text"
            className="px-input flex-1"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("calendar.hs.namePh")}
            aria-label={t("calendar.hs.name")}
            autoComplete="off"
            autoFocus
            data-testid="hashtag-set-picker-name"
          />
          <button
            type="submit"
            className="px-btn px-btn-ghost px-btn-sm"
            disabled={!name.trim()}
            data-testid="hashtag-set-picker-save"
          >
            {t("calendar.hs.save")}
          </button>
        </form>
      ) : (
        post.hashtags.length > 0 && (
          <button
            type="button"
            className="px-link ios-hit self-start text-xs"
            onClick={() => setNaming(true)}
            data-testid="hashtag-set-picker-new"
          >
            {t("calendar.hs.saveAs")}
          </button>
        )
      )}
    </div>
  );
}
