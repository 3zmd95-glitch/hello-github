"use client";

import { Clock, Gamepad2, Hand } from "lucide-react";
import { useRef, useState, type FormEvent, type RefObject } from "react";
import { useSocialSync } from "@/components/social/useSocialSync";
import { useDraftGuard, useSheetClose } from "@/components/ui/ios/Sheet";
import { PLATFORMS, type Platform, type Post, type Skill } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { PlatformGlyph } from "@/lib/platformIcons";
import { autoPostOf, isManual } from "@/lib/publish";
import { bestTime, PLATFORM_META } from "@/lib/social";
import { isSocialPlatform } from "@/lib/socialSync";
import { useStore } from "@/store";
import SheetFrame from "./SheetFrame";
import SkillPicker from "./SkillPicker";

/**
 * "New post" sheet: platform (required), the "🚀 Post to" networks (round 30: every connected network that
 * can post by itself is pre-ticked, X and Snapchat are off; hidden while no network can publish), title, day,
 * time (defaults to the platform's best time for that day until the owner edits it), the shot-template switch
 * and an optional skill link. With a skill the post is created through `createPostFromSkill` (the bridge to
 * the Produce quest) and then patched with what was typed; without one through `addPost`. Extra networks are
 * written as the post's `autoPost` right after creation, so posts without any keep `autoPost` undefined.
 * Cancel and Save close through the sheet, so its exit plays: `onCreated` runs at once (the calendar moves to the
 * post's day behind the leaving sheet), `onClose` once the sheet is gone.
 */
export default function PostForm({
  initialDay,
  onClose,
  onCreated,
}: {
  initialDay: string | null;
  onClose: () => void;
  onCreated: (post: Post) => void;
}) {
  const { t } = useT();
  const guardRef = useRef<() => boolean>(() => true);
  return (
    <SheetFrame
      testId="post-form-sheet"
      titleId="post-form-title"
      title={t("calendar.form.title")}
      onClose={onClose}
      beforeClose={() => guardRef.current()}
    >
      <PostFormBody initialDay={initialDay} onCreated={onCreated} guardRef={guardRef} />
    </SheetFrame>
  );
}

function PostFormBody({
  initialDay,
  onCreated,
  guardRef,
}: {
  initialDay: string | null;
  onCreated: (post: Post) => void;
  guardRef: RefObject<() => boolean>;
}) {
  const { t, L } = useT();
  const close = useSheetClose();
  const { status } = useSocialSync();
  const [platform, setPlatform] = useState<Platform>("tiktok");
  const [title, setTitle] = useState("");
  const [day, setDay] = useState(initialDay ?? "");
  const [time, setTime] = useState(() => bestTime("tiktok", initialDay ?? undefined));
  const [timeTouched, setTimeTouched] = useState(false);
  const [template, setTemplate] = useState(true);
  const [skill, setSkill] = useState<Skill | null>(null);
  /** The owner's own ticks; anything not here follows the default (connected API networks on, manual off). */
  const [picked, setPicked] = useState<Partial<Record<Platform, boolean>>>({});

  const canPublish = (p: Platform) => isSocialPlatform(p) && !!status?.[p]?.canPublish;
  /** Networks offered in the row: the post's own platform, every network that can post, X and Snapchat. */
  const offered = PLATFORMS.filter((p) => p === platform || canPublish(p) || isManual(p));
  const showNetworks = PLATFORMS.some(canPublish);
  const ticked = (p: Platform) => p === platform || (picked[p] ?? canPublish(p));
  const networks = showNetworks ? offered.filter(ticked) : [platform];

  const best = bestTime(platform, day || undefined);
  const pickPlatform = (p: Platform) => {
    setPlatform(p);
    if (!timeTouched) setTime(bestTime(p, day || undefined));
  };
  const pickDay = (d: string) => {
    setDay(d);
    if (!timeTouched) setTime(bestTime(platform, d || undefined));
  };

  const canSave = title.trim() !== "" || skill !== null;
  const discard = useDraftGuard(guardRef, canSave);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    const s = useStore.getState();
    const plannedDay = day || null;
    const plannedTime = time || null;
    // Only a post that goes somewhere beyond its own platform gets auto-post settings at birth.
    const autoPost =
      networks.length > 1
        ? (p: Post) => ({ autoPost: { ...autoPostOf(p), platforms: networks } })
        : null;
    let post: Post | undefined;
    if (skill) {
      const before = new Set(s.posts.map((p) => p.id));
      post = s.createPostFromSkill(skill.id, platform);
      // A duplicate (live post for the same skill + platform) comes back untouched; only a fresh one is patched.
      if (post && !before.has(post.id)) {
        post =
          s.updatePost(post.id, {
            ...(title.trim() ? { title: title.trim() } : {}),
            plannedDay,
            plannedTime,
            ...(template ? {} : { shots: [] }),
            ...(autoPost ? autoPost(post) : {}),
          }) ?? post;
      }
    } else {
      post = s.addPost({
        platform,
        title: title.trim(),
        plannedDay,
        plannedTime,
        withTemplate: template,
      });
      if (autoPost) post = s.updatePost(post.id, autoPost(post)) ?? post;
    }
    if (post) onCreated(post);
    close();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" data-testid="post-form">
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-ink-2 mb-1.5 text-sm font-bold">
          {t("calendar.form.platform")}
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {PLATFORMS.map((p) => (
            <button
              key={p}
              type="button"
              className="px-fchip cal-fchip"
              aria-pressed={platform === p}
              onClick={() => pickPlatform(p)}
              data-testid={`post-platform-${p}`}
              data-platform={p}
            >
              <PlatformGlyph platform={p} size={14} className="shrink-0" />
              {L(PLATFORM_META[p].name)}
            </button>
          ))}
        </div>
      </fieldset>

      {showNetworks && (
        <fieldset className="flex flex-col gap-1.5" data-testid="post-networks">
          <legend className="text-ink-2 mb-1.5 text-sm font-bold">
            {t("calendar.form.networks")}
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {offered.map((p) => {
              const own = p === platform;
              return (
                <button
                  key={p}
                  type="button"
                  className="px-fchip cal-fchip"
                  aria-pressed={ticked(p)}
                  aria-disabled={own}
                  title={isManual(p) ? t("publish.net.manual") : undefined}
                  onClick={() => {
                    if (!own) setPicked({ ...picked, [p]: !ticked(p) });
                  }}
                  data-testid={`post-net-${p}`}
                  data-own={own}
                  data-platform={p}
                >
                  <PlatformGlyph platform={p} size={14} className="shrink-0" />
                  {L(PLATFORM_META[p].name)}
                  {isManual(p) && (
                    <Hand size={13} strokeWidth={1.75} className="shrink-0" aria-hidden />
                  )}
                </button>
              );
            })}
          </div>
          <span className="text-muted text-xs">{t("calendar.form.networksHint")}</span>
        </fieldset>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink-2 font-bold">{t("calendar.form.postTitle")}</span>
        <input
          type="text"
          className="px-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={skill ? L(skill.name) : t("calendar.form.titlePh")}
          autoComplete="off"
          data-testid="post-title"
        />
        {skill && <span className="text-muted text-xs">{t("calendar.form.skillTitleHint")}</span>}
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink-2 font-bold">{t("calendar.form.day")}</span>
          <input
            type="date"
            dir="ltr"
            className="px-input num"
            value={day}
            onChange={(e) => pickDay(e.target.value)}
            data-testid="post-day"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink-2 font-bold">{t("calendar.form.time")}</span>
          <input
            type="time"
            dir="ltr"
            className="px-input num"
            value={time}
            onChange={(e) => {
              setTime(e.target.value);
              setTimeTouched(true);
            }}
            data-testid="post-time"
          />
        </label>
      </div>
      <p className="text-muted -mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1" data-testid="post-best-time">
          <Clock size={13} strokeWidth={1.75} className="shrink-0" aria-hidden />
          {t("calendar.form.bestTime", { platform: L(PLATFORM_META[platform].name), time: best })}
        </span>
        {time !== best && (
          <button
            type="button"
            className="px-link"
            onClick={() => {
              setTime(best);
              setTimeTouched(false);
            }}
          >
            {t("calendar.form.useBest")}
          </button>
        )}
      </p>

      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="h-5 w-5 accent-[var(--accent)]"
          checked={template}
          onChange={(e) => setTemplate(e.target.checked)}
          data-testid="post-template"
        />
        <span>{t("calendar.form.template")}</span>
      </label>

      <section className="flex flex-col gap-2">
        <span className="text-ink-2 text-sm font-bold">{t("calendar.form.skill")}</span>
        {skill ? (
          <div className="px-inset flex items-center gap-2 text-sm" data-testid="post-skill-picked">
            <Gamepad2 size={18} strokeWidth={1.75} className="text-ink-2 shrink-0" aria-hidden />
            <b className="min-w-0 flex-1 truncate">{L(skill.name)}</b>
            <button
              type="button"
              className="px-btn px-btn-ghost px-btn-sm"
              onClick={() => setSkill(null)}
              data-testid="post-skill-unlink"
            >
              {t("calendar.form.unlink")}
            </button>
          </div>
        ) : (
          <SkillPicker testId="post-skill" onPick={setSkill} />
        )}
        <span className="text-muted text-xs">{t("calendar.form.skillHint")}</span>
      </section>

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className="px-btn px-btn-ghost"
          onClick={close}
          data-testid="post-form-cancel"
        >
          {t("common.cancel")}
        </button>
        <button type="submit" className="px-btn" disabled={!canSave} data-testid="post-save">
          {t("calendar.form.save")}
        </button>
      </div>
      {discard}
    </form>
  );
}
