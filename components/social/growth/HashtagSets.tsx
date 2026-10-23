"use client";

import { Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { ListGroup, ListRow } from "@/components/ui/ios/List";
import type { HashtagSet, Post, SocialPostStat } from "@/lib/domain";
import { HASHTAG_MIN_SAMPLE, hashtagSetStats, parseTags } from "@/lib/hashtags";
import { useT } from "@/lib/i18n";
import { useStore } from "@/store";
import { fmtCount } from "./format";

/** "×2.5": the views against the platform's usual, one decimal. */
export const fmtTimes = (x: number): string => `×${x.toFixed(1)}`;

/**
 * A8 · Hashtag sets: the sets the owner saved, each with how its posts did against the usual views of their platform
 * (only once it has five posts with numbers), plus a small form to save a new one. Sets are also saved from a post's
 * Overview tab, where they are applied.
 */
export default function HashtagSets({
  sets,
  posts,
  stats,
  now,
}: {
  sets: readonly HashtagSet[];
  posts: readonly Post[];
  stats: readonly SocialPostStat[];
  /** Riyadh end of today, in ms. */
  now: number;
}) {
  const { t } = useT();
  const addSet = useStore((s) => s.addHashtagSet);
  const removeSet = useStore((s) => s.removeHashtagSet);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const tags = parseTags(text);
  const byId = useMemo(
    () => new Map(hashtagSetStats(sets, posts, stats, now).map((r) => [r.setId, r])),
    [sets, posts, stats, now],
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!addSet(name, tags)) return;
    setName("");
    setText("");
  };

  return (
    <div className="flex flex-col gap-3" data-testid="hashtag-sets">
      <ListGroup header={t("growth.hs.title")} listAs="ul" testId="hashtag-sets-list">
        {sets.length === 0 && (
          <li className="text-ink-2 px-4 py-3 text-sm" data-testid="hashtag-sets-empty">
            {t("growth.hs.empty")}
          </li>
        )}
        {sets.map((set) => {
          const r = byId.get(set.id);
          return (
            <ListRow
              key={set.id}
              as="li"
              testId="hashtag-set"
              data-set={set.id}
              data-n={r?.n ?? 0}
              data-enough={r?.enough ?? false}
              title={set.name}
              sub={
                <>
                  <span dir="ltr" className="block truncate">
                    {set.tags.join(" ")}
                  </span>
                  <span className="block" data-testid="hashtag-set-stats">
                    {!r || r.n === 0
                      ? t("growth.hs.noPosts")
                      : r.enough && r.vsMedian !== null
                        ? t("growth.hs.stats", {
                            n: r.n,
                            views: fmtCount(r.avgViews ?? 0),
                            // An LTR isolate keeps "×2.5" in one piece inside an Arabic sentence.
                            times: `\u2066${fmtTimes(r.vsMedian)}\u2069`,
                          })
                        : t("growth.hs.needs", { min: HASHTAG_MIN_SAMPLE, n: r.n })}
                  </span>
                </>
              }
              trailing={
                <button
                  type="button"
                  className="ios-icbtn text-muted hover:text-danger shrink-0"
                  aria-label={t("growth.hs.remove", { name: set.name })}
                  onClick={() => removeSet(set.id)}
                  data-testid="hashtag-set-remove"
                >
                  <Trash2 size={18} strokeWidth={1.75} aria-hidden />
                </button>
              }
            />
          );
        })}
      </ListGroup>
      <p className="text-muted px-4 text-xs">{t("growth.hs.note", { min: HASHTAG_MIN_SAMPLE })}</p>

      <form
        onSubmit={submit}
        className="px-card flex flex-col gap-2"
        data-testid="hashtag-set-form"
      >
        <h2 className="text-ink-2 text-[13px] font-semibold">{t("growth.hs.new")}</h2>
        <input
          type="text"
          className="px-input"
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("growth.hs.namePh")}
          aria-label={t("growth.hs.name")}
          autoComplete="off"
          data-testid="hashtag-set-name"
        />
        <textarea
          rows={2}
          dir="ltr"
          className="px-input cal-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="#matchcut #editing #capcut"
          aria-label={t("growth.hs.tags")}
          data-testid="hashtag-set-tags"
        />
        <div className="flex items-center gap-2">
          <span className="text-muted text-xs" data-testid="hashtag-set-count">
            {t("growth.hs.count", { n: tags.length })}
          </span>
          <button
            type="submit"
            className="px-btn px-btn-sm ms-auto"
            disabled={!name.trim() || tags.length === 0}
            data-testid="hashtag-set-save"
          >
            {t("growth.hs.save")}
          </button>
        </div>
      </form>
    </div>
  );
}
