"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useGameActions } from "@/components/celebrate/useGameActions";
import { useSkillSheet } from "@/components/skills/SkillSheetProvider";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import type { Post, Skill } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { bestTime, hookIdeas, PLATFORM_META, suggestHashtags } from "@/lib/social";
import { useStore } from "@/store";
import { formatDayLong, formatInstant } from "./dates";
import SkillPicker from "./SkillPicker";

/**
 * Overview tab of the post popup: hook (+ ideas), caption with its limit, hashtags, the planned day/time with
 * the best-time hint and the reminder note, the linked skill, "Mark as posted" (+ link → the Produce quest
 * bridge with its celebration), copy and delete.
 */
export default function OverviewTab({
  post,
  skill,
  urlFocus,
  onDeleted,
}: {
  post: Post;
  skill: Skill | undefined;
  /** Bumped by the stage stepper's "posted" step: focus the link input. */
  urlFocus: number;
  onDeleted: () => void;
}) {
  const { t, L, lang } = useT();
  const updatePost = useStore((s) => s.updatePost);
  const removePost = useStore((s) => s.removePost);
  const unmarkPosted = useStore((s) => s.unmarkPosted);
  const produceDone = useStore(
    (s) =>
      !!post.skillId &&
      s.completions.some((c) => c.skillId === post.skillId && c.quest === "produce"),
  );
  const { markPosted } = useGameActions();
  const sheet = useSkillSheet();

  const meta = PLATFORM_META[post.platform];
  const [ideasOpen, setIdeasOpen] = useState(false);
  const [tag, setTag] = useState("");
  const [url, setUrl] = useState("");
  const [linking, setLinking] = useState(false);
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (urlFocus > 0) urlRef.current?.focus();
  }, [urlFocus]);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(id);
  }, [copied]);

  const addTag = (e?: FormEvent) => {
    e?.preventDefault();
    const value = tag.trim().replace(/\s+/g, "_");
    if (!value) return;
    const withHash = value.startsWith("#") ? value : `#${value}`;
    if (!post.hashtags.some((h) => h.toLowerCase() === withHash.toLowerCase()))
      updatePost(post.id, { hashtags: [...post.hashtags, withHash] });
    setTag("");
  };
  const suggest = () => {
    const seen = new Set(post.hashtags.map((h) => h.toLowerCase()));
    const extra = suggestHashtags(post.platform, skill).filter((h) => !seen.has(h.toLowerCase()));
    updatePost(post.id, { hashtags: [...post.hashtags, ...extra] });
  };

  const best = bestTime(post.platform, post.plannedDay ?? undefined);
  const captionLen = post.caption.length;
  const over = captionLen > meta.captionLimit;

  const copy = async () => {
    const text = [post.caption.trim(), post.hashtags.join(" ")].filter(Boolean).join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
  };

  const linkSkill = (s: Skill) => {
    updatePost(post.id, { skillId: s.id, ...(post.hook ? {} : { hook: L(s.quests.produce) }) });
    setLinking(false);
  };

  return (
    <div className="flex flex-col gap-4" data-testid="post-overview">
      {/* Hook */}
      <section className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="post-hook" className="text-ink-2 text-sm font-bold">
            {t("calendar.sheet.hook")}
          </label>
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm ms-auto"
            aria-pressed={ideasOpen}
            onClick={() => setIdeasOpen((o) => !o)}
            data-testid="post-hook-ideas"
          >
            {t("calendar.sheet.hookIdeas")}
          </button>
        </div>
        <textarea
          id="post-hook"
          rows={2}
          className="px-input cal-textarea"
          placeholder={t("calendar.sheet.hookPh")}
          value={post.hook ?? ""}
          onChange={(e) => updatePost(post.id, { hook: e.target.value })}
          data-testid="post-hook"
        />
        {ideasOpen && (
          <ul className="flex flex-col gap-1.5">
            {hookIdeas(skill).map((idea, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="px-inset hover:border-accent w-full text-start text-sm"
                  onClick={() => {
                    updatePost(post.id, { hook: L(idea) });
                    setIdeasOpen(false);
                  }}
                  aria-label={t("calendar.sheet.hookUse", { hook: L(idea) })}
                  data-testid="hook-idea"
                >
                  «{L(idea)}»
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Caption */}
      <section className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-2">
          <label htmlFor="post-caption" className="text-ink-2 text-sm font-bold">
            {t("calendar.sheet.caption")}
          </label>
          <span
            className={`num ms-auto text-xs ${over ? "text-danger font-bold" : "text-muted"}`}
            data-testid="post-caption-count"
          >
            {captionLen}/{meta.captionLimit}
          </span>
        </div>
        <textarea
          id="post-caption"
          rows={3}
          className="px-input cal-textarea"
          placeholder={t("calendar.sheet.captionPh")}
          value={post.caption}
          onChange={(e) => updatePost(post.id, { caption: e.target.value })}
          data-testid="post-caption"
        />
        {over && (
          <p className="text-danger text-xs">
            {t("calendar.sheet.captionOver", { platform: L(meta.name), limit: meta.captionLimit })}
          </p>
        )}
      </section>

      {/* Hashtags */}
      <section className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink-2 text-sm font-bold">{t("calendar.sheet.hashtags")}</span>
          <span className="num text-muted text-xs">
            {post.hashtags.length}/{meta.hashtagMax}
          </span>
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm ms-auto"
            onClick={suggest}
            data-testid="post-hashtag-suggest"
          >
            ✨ {t("calendar.sheet.suggestHashtags")}
          </button>
        </div>
        {post.hashtags.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" dir="ltr">
            {post.hashtags.map((h) => (
              <li key={h} className="px-chip" data-testid="post-hashtag">
                <span>{h}</span>
                <button
                  type="button"
                  className="text-muted hover:text-danger leading-none"
                  onClick={() =>
                    updatePost(post.id, { hashtags: post.hashtags.filter((x) => x !== h) })
                  }
                  aria-label={t("calendar.sheet.removeHashtag", { tag: h })}
                  data-testid="post-hashtag-remove"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={addTag} className="flex items-center gap-2">
          <input
            type="text"
            dir="ltr"
            className="px-input flex-1"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder={t("calendar.sheet.hashtagPh")}
            aria-label={t("calendar.sheet.hashtags")}
            autoComplete="off"
            data-testid="post-hashtag-input"
          />
          <button
            type="submit"
            className="px-btn px-btn-ghost px-btn-sm"
            disabled={!tag.trim()}
            data-testid="post-hashtag-add"
          >
            {t("calendar.sheet.addHashtag")}
          </button>
        </form>
        <p className="text-muted text-xs">{L(meta.hashtagAdvice)}</p>
      </section>

      {/* Schedule + reminder */}
      <section className="flex flex-col gap-1.5">
        <span className="text-ink-2 text-sm font-bold">{t("calendar.sheet.plan")}</span>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="date"
            dir="ltr"
            className="px-input num"
            value={post.plannedDay ?? ""}
            onChange={(e) => updatePost(post.id, { plannedDay: e.target.value || null })}
            aria-label={t("calendar.form.day")}
            data-testid="post-plan-day"
          />
          <input
            type="time"
            dir="ltr"
            className="px-input num"
            value={post.plannedTime ?? ""}
            onChange={(e) => updatePost(post.id, { plannedTime: e.target.value || null })}
            aria-label={t("calendar.form.time")}
            data-testid="post-plan-time"
          />
        </div>
        <p className="text-muted flex flex-wrap items-center gap-2 text-xs">
          <span>⏰ {t("calendar.form.bestTime", { platform: L(meta.name), time: best })}</span>
          {post.plannedTime !== best && (
            <button
              type="button"
              className="px-link"
              onClick={() => updatePost(post.id, { plannedTime: best })}
              data-testid="post-plan-best"
            >
              {t("calendar.form.useBest")}
            </button>
          )}
        </p>
        <p className="px-inset text-xs" data-testid="post-remind">
          {post.plannedDay && post.plannedTime ? (
            <span>
              {t("calendar.sheet.remind", {
                day: formatDayLong(post.plannedDay, lang),
                time: post.plannedTime,
              })}
            </span>
          ) : (
            <span className="text-ink-2">{t("calendar.sheet.remindNone")}</span>
          )}
          <span className="text-muted block">{t("calendar.sheet.remindSoon")}</span>
        </p>
      </section>

      {/* Linked skill */}
      <section className="flex flex-col gap-1.5">
        <span className="text-ink-2 text-sm font-bold">{t("calendar.sheet.skill")}</span>
        {skill ? (
          <div
            className="px-inset flex flex-wrap items-center gap-2 text-sm"
            data-testid="post-skill-linked"
          >
            <span aria-hidden>🎮</span>
            <b className="min-w-0 flex-1 truncate">{L(skill.name)}</b>
            <button
              type="button"
              className="px-btn px-btn-ghost px-btn-sm"
              onClick={() => sheet.open(skill.id)}
              data-testid="post-open-skill"
            >
              {t("calendar.sheet.openSkill")}
            </button>
            {post.stage !== "posted" && (
              <button
                type="button"
                className="px-btn px-btn-ghost px-btn-sm"
                onClick={() => updatePost(post.id, { skillId: undefined })}
                data-testid="post-unlink-skill"
              >
                {t("calendar.form.unlink")}
              </button>
            )}
          </div>
        ) : linking ? (
          <SkillPicker testId="post-skill-search" onPick={linkSkill} autoFocus />
        ) : (
          <div className="px-inset flex flex-wrap items-center gap-2 text-sm">
            <span className="text-ink-2 min-w-0 flex-1">{t("calendar.sheet.noSkill")}</span>
            <button
              type="button"
              className="px-btn px-btn-ghost px-btn-sm"
              onClick={() => setLinking(true)}
              data-testid="post-link-skill"
            >
              {t("calendar.sheet.linkSkill")}
            </button>
          </div>
        )}
      </section>

      {/* Mark as posted */}
      <section className="cal-posted flex flex-col gap-2" data-testid="post-posted-section">
        {post.stage === "posted" ? (
          <>
            <h3 className="text-base">✓ {t("calendar.stage.posted")}</h3>
            {post.postedAt && (
              <p className="text-ink-2 text-sm">
                {t("calendar.sheet.postedAt", { date: formatInstant(post.postedAt, lang) })}
              </p>
            )}
            {post.postedUrl && (
              <a
                href={post.postedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-link text-sm"
                dir="ltr"
                data-testid="post-posted-link"
              >
                {t("calendar.sheet.postedLink")}
              </a>
            )}
            {produceDone && (
              <p className="text-accent text-sm font-bold" data-testid="post-quest-done">
                {t("calendar.sheet.questDone")}
              </p>
            )}
            <button
              type="button"
              className="px-btn px-btn-ghost px-btn-sm self-start"
              onClick={() => unmarkPosted(post.id)}
              data-testid="post-unmark"
            >
              ↩ {t("calendar.sheet.undo")}
            </button>
          </>
        ) : (
          <>
            <h3 className="text-base">{t("calendar.sheet.postedTitle")}</h3>
            <p className="text-muted text-xs">{t("calendar.sheet.postedHint")}</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                markPosted(post.id, url);
              }}
              className="flex flex-wrap items-center gap-2"
            >
              <input
                ref={urlRef}
                type="url"
                inputMode="url"
                dir="ltr"
                autoComplete="off"
                className="px-input min-w-[160px] flex-1"
                placeholder={t("calendar.sheet.urlPh")}
                aria-label={t("calendar.sheet.postedTitle")}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                data-testid="post-url"
              />
              <button type="submit" className="px-btn" data-testid="post-mark-posted">
                {t("calendar.sheet.markPosted")}
              </button>
            </form>
          </>
        )}
      </section>

      {/* Copy + delete */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm"
          onClick={copy}
          data-testid="post-copy"
        >
          {t("calendar.sheet.copy")}
        </button>
        {copied && (
          <span
            className={`text-xs ${copied === "ok" ? "text-accent" : "text-danger"}`}
            role="status"
            data-testid="post-copied"
          >
            {copied === "ok" ? t("calendar.sheet.copied") : t("calendar.sheet.copyFailed")}
          </span>
        )}
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm text-danger ms-auto"
          onClick={() => setConfirm(true)}
          data-testid="post-delete"
        >
          🗑 {t("calendar.sheet.delete")}
        </button>
      </div>

      {confirm && (
        <ConfirmDialog
          title={t("calendar.sheet.deleteTitle")}
          body={t("calendar.sheet.deleteBody")}
          confirmLabel={t("calendar.sheet.delete")}
          danger
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            removePost(post.id);
            onDeleted();
          }}
        />
      )}
    </div>
  );
}
