"use client";

import { ArrowUpRight, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useSocialSync } from "@/components/social/useSocialSync";
import { usePublish, type PublishActionResult } from "@/components/social/usePublish";
import {
  PLATFORMS,
  YOUTUBE_PRIVACY,
  type AutoPost,
  type AutoPostResult,
  type MediaKind,
  type Platform,
  type Post,
} from "@/lib/domain";
import { useT, type MessageKey } from "@/lib/i18n";
import {
  autoPostOf,
  autoPostSummary,
  CAPTION_MAX,
  captionFor,
  captionLimit,
  captionWarnings,
  canPublishTo,
  defaultCaption,
  directMediaUrl,
  isManual,
  manualComposeUrl,
  publishProblems,
  scheduledAtOf,
  sendCaption,
  YT_TITLE_MAX,
  type Problem,
} from "@/lib/publish";
import { PLATFORM_META } from "@/lib/social";
import { PlatformGlyph } from "@/lib/platformIcons";
import { isSocialPlatform } from "@/lib/socialSync";
import { useStore } from "@/store";
import { formatInstant } from "./dates";
import { PlatformChip, platformStyle } from "./PlatformChip";
import TikTokOptions from "./TikTokOptions";
import TikTokPhotoEditor from "./TikTokPhotoEditor";
import TikTokFinishCard from "./TikTokFinishCard";

const KINDS: readonly MediaKind[] = ["video", "image", "photo", "none"];

export const PROBLEM_KEY: Record<Problem["code"], MessageKey> = {
  noPlatforms: "publish.problem.noPlatforms",
  manualOnly: "publish.problem.manualOnly",
  noDay: "publish.problem.noDay",
  noMedia: "publish.problem.noMedia",
  badUrl: "publish.problem.badUrl",
  needsVideo: "publish.problem.needsVideo",
  needsMedia: "publish.problem.needsMedia",
  empty: "publish.problem.empty",
  notConnected: "publish.problem.notConnected",
  noPermission: "publish.problem.noPermission",
  photoCount: "publish.problem.photoCount",
  photoOnlyTikTok: "publish.problem.photoOnlyTikTok",
  photoCover: "publish.problem.photoCover",
  tiktokPrivacy: "publish.problem.tiktokPrivacy",
  tiktokConsent: "publish.problem.tiktokConsent",
  tiktokDuration: "publish.problem.tiktokDuration",
  tiktokBrandedPrivacy: "publish.problem.tiktokBrandedPrivacy",
  tiktokCreator: "publish.problem.tiktokCreator",
};

const ERROR_KEY: Record<string, MessageKey> = {
  not_connected: "publish.err.notConnected",
  no_permission: "publish.err.noPermission",
  token_expired: "publish.err.tokenExpired",
  media_unreachable: "publish.err.mediaUnreachable",
  media_too_large: "publish.err.mediaTooLarge",
  private_account: "publish.err.privateAccount",
  rejected: "publish.err.rejected",
  rate_limited: "publish.err.rateLimited",
  upstream: "publish.err.upstream",
  timeout: "publish.err.timeout",
};

/**
 * 🚀 Auto-post tab of the post popup (Metricool-style "post everywhere"): pick the networks, one media link,
 * a caption per network (the Overview caption by default), the YouTube / TikTok options, then schedule it for
 * the planned time or post now. The Worker publishes and this tab shows each network's state and link.
 * X and Snapchat stay a manual step: copy the caption and open the app.
 *
 * Round 30 (A2): an API caption over its limit is trimmed on send and wears a "✂️ trimmed" badge with the
 * sent length; an overlong X / Snapchat caption is only a warning line. Edits after scheduling reach the
 * Worker by themselves (`usePublishAutoResync` in the popup); "Update schedule" stays for an explicit resend.
 */
export default function AutoPostTab({ post }: { post: Post }) {
  const { t, L, lang } = useT();
  const updatePost = useStore((s) => s.updatePost);
  const { configured, status, busy, error, schedule, runNow, cancel } = usePublish();
  const { connect } = useSocialSync();
  const auto = autoPostOf(post);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [notice, setNotice] = useState<MessageKey | null>(null);
  const [open, setOpen] = useState<Platform | null>(null);
  const [copied, setCopied] = useState<Platform | null>(null);

  const save = (patch: Partial<AutoPost>) => {
    setProblems([]);
    setNotice(null);
    updatePost(post.id, { autoPost: { ...auto, tiktokConsent: false, ...patch } });
  };
  const toggle = (p: Platform) =>
    save({
      platforms: auto.platforms.includes(p)
        ? auto.platforms.filter((x) => x !== p)
        : PLATFORMS.filter((x) => x === p || auto.platforms.includes(x)),
    });

  const summary = autoPostSummary(auto);
  const sent = !!auto.sentAt;
  const at = scheduledAtOf(post);
  const live = publishProblems(post, auto, status);
  const warnings = captionWarnings(post, auto);
  const media = auto.mediaUrl.trim() ? directMediaUrl(auto.mediaUrl) : "";

  const after = (r: PublishActionResult, ok: MessageKey) => {
    if (r.ok) setNotice(ok);
    else if ("problems" in r) setProblems(r.problems);
  };

  const copy = async (p: Platform) => {
    try {
      await navigator.clipboard.writeText(captionFor(post, auto, p));
      setCopied(p);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="post-autopost" data-summary={summary}>
      <p className="text-ink-2 text-sm">{t("publish.intro")}</p>

      {!configured && (
        <p className="px-inset text-sm" data-testid="autopost-need-worker">
          {t("publish.needWorker")}{" "}
          <Link href="/settings#accounts" className="px-link">
            {t("publish.needWorkerLink")}
          </Link>
        </p>
      )}

      {/* Networks */}
      <section className="flex flex-col gap-1.5">
        <span className="text-ink-2 text-sm font-bold">{t("publish.networks")}</span>
        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2" data-testid="autopost-networks">
          {PLATFORMS.map((p) => {
            const on = auto.platforms.includes(p);
            const st = isSocialPlatform(p) ? status?.[p] : undefined;
            let note: MessageKey;
            if (isManual(p)) note = "publish.net.manual";
            else if (!status) note = "publish.net.unknown";
            else if (!st?.configured) note = "publish.net.notSetUp";
            else if (!st.connected) note = "publish.net.notConnected";
            else if (!canPublishTo(st, p, auto.tiktokMode)) note = "publish.net.noPermission";
            else note = "publish.net.ready";
            return (
              <li
                key={p}
                className="px-inset flex items-center gap-2"
                style={platformStyle(p)}
                data-platform={p}
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(p)}
                    data-testid={`autopost-net-${p}`}
                  />
                  <PlatformChip platform={p} />
                  <span className="text-muted truncate text-xs" data-testid="autopost-net-note">
                    {t(note)}
                  </span>
                </label>
                {isSocialPlatform(p) && st?.connected && !canPublishTo(st, p, auto.tiktokMode) && (
                  <button
                    type="button"
                    className="px-btn px-btn-sm shrink-0"
                    onClick={() => void connect(p, true)}
                    data-testid={`autopost-allow-${p}`}
                  >
                    {t("publish.allow")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* Media */}
      <section className="flex flex-col gap-1.5">
        <span className="text-ink-2 text-sm font-bold">{t("publish.media")}</span>
        <div className="cal-tabs self-start" role="radiogroup" aria-label={t("publish.media")}>
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              className="cal-tab"
              aria-checked={auto.mediaKind === k}
              onClick={() => save({ mediaKind: k })}
              data-testid={`autopost-kind-${k}`}
            >
              {t(`publish.kind.${k}`)}
            </button>
          ))}
        </div>
        {auto.mediaKind === "photo" && <TikTokPhotoEditor auto={auto} save={save} />}
        {auto.mediaKind !== "none" && auto.mediaKind !== "photo" && (
          <>
            <input
              type="url"
              inputMode="url"
              dir="ltr"
              autoComplete="off"
              className="px-input"
              placeholder="https://www.dropbox.com/…/clip.mp4"
              aria-label={t("publish.mediaUrl")}
              value={auto.mediaUrl}
              onChange={(e) => save({ mediaUrl: e.target.value, durationSeconds: undefined })}
              data-testid="autopost-media-url"
            />
            {media && media !== auto.mediaUrl.trim() && (
              <p className="text-muted text-xs" data-testid="autopost-media-direct">
                {t("publish.mediaDirect")}{" "}
                <span dir="ltr" className="break-all">
                  {media}
                </span>
              </p>
            )}
            <p className="text-muted text-xs">{t("publish.mediaHint")}</p>
            {auto.platforms.includes("tiktok") && (
              <p className="text-muted text-xs">{t("publish.tt.verifiedUrl")}</p>
            )}
            {auto.mediaKind === "video" && media.startsWith("https://") && (
              <video
                controls
                preload="metadata"
                src={media}
                className="max-h-72 w-full rounded"
                aria-label={t("publish.tt.videoPreview")}
                onLoadedMetadata={(e) => {
                  const seconds = e.currentTarget.duration;
                  if (Number.isFinite(seconds) && seconds > 0 && auto.durationSeconds !== seconds)
                    save({ durationSeconds: seconds });
                }}
              />
            )}
          </>
        )}
      </section>

      {/* Captions */}
      {auto.platforms.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <span className="text-ink-2 text-sm font-bold">{t("publish.captions")}</span>
          <p className="text-muted text-xs">
            {defaultCaption(post) ? t("publish.captionsHint") : t("publish.captionsEmpty")}
          </p>
          <ul className="flex flex-col gap-1.5">
            {auto.platforms.map((p) => {
              const text = captionFor(post, auto, p);
              const own = auto.captions[p] !== undefined && auto.captions[p]!.trim() !== "";
              // API networks get the trimmed text; manual ones are posted by hand, so "over" only warns.
              const sent = sendCaption(post, auto, p);
              const limit = captionLimit(auto, p);
              const over = sent.text.length > limit;
              const tooLong = warnings.some((w) => w.code === "tooLong" && w.platform === p);
              return (
                <li key={p} className="px-inset flex flex-col gap-1.5" data-platform={p}>
                  <div className="flex flex-wrap items-center gap-2">
                    <PlatformChip platform={p} short />
                    <span className="text-muted text-xs">
                      {own ? t("publish.captionOwn") : t("publish.captionDefault")}
                    </span>
                    {sent.trimmed && (
                      <span
                        className="px-chip px-chip-gold text-xs"
                        title={t("publish.trimmedHint", { platform: L(PLATFORM_META[p].name) })}
                        data-testid={`autopost-trimmed-${p}`}
                      >
                        {t("publish.trimmed")}
                      </span>
                    )}
                    <span
                      className={`num ms-auto text-xs ${over ? "text-danger font-bold" : "text-muted"}`}
                      data-testid={`autopost-count-${p}`}
                    >
                      {sent.text.length}/{limit}
                    </span>
                    <button
                      type="button"
                      className="px-btn px-btn-ghost px-btn-sm"
                      aria-expanded={open === p}
                      onClick={() => setOpen(open === p ? null : p)}
                      data-testid={`autopost-caption-edit-${p}`}
                    >
                      {t("publish.captionEdit")}
                    </button>
                  </div>
                  {open === p && (
                    <>
                      <textarea
                        rows={3}
                        className="px-input cal-textarea"
                        value={auto.captions[p] ?? defaultCaption(post)}
                        onChange={(e) =>
                          save({ captions: { ...auto.captions, [p]: e.target.value } })
                        }
                        aria-label={t("publish.captionFor", { platform: L(PLATFORM_META[p].name) })}
                        data-testid={`autopost-caption-${p}`}
                      />
                      {own && (
                        <button
                          type="button"
                          className="px-link self-start text-xs"
                          onClick={() => {
                            const { [p]: _dropped, ...rest } = auto.captions;
                            void _dropped;
                            save({ captions: rest });
                          }}
                        >
                          {t("publish.captionReset")}
                        </button>
                      )}
                    </>
                  )}
                  {sent.trimmed && (
                    <p className="text-muted text-xs" data-testid={`autopost-trimmed-note-${p}`}>
                      {t("publish.trimmedHint", { platform: L(PLATFORM_META[p].name) })}
                    </p>
                  )}
                  {tooLong && (
                    <p className="text-danger text-xs" data-testid={`autopost-warn-${p}`}>
                      <TriangleAlert
                        size={13}
                        strokeWidth={1.75}
                        className="me-1 inline align-[-2px]"
                        aria-hidden
                      />
                      {t("publish.warn.tooLong", {
                        platform: L(PLATFORM_META[p].name),
                        limit: CAPTION_MAX[p],
                      })}
                    </p>
                  )}
                  {isManual(p) && (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="px-btn px-btn-ghost px-btn-sm"
                        onClick={() => void copy(p)}
                        data-testid={`autopost-copy-${p}`}
                      >
                        {copied === p ? t("calendar.sheet.copied") : t("publish.copy")}
                      </button>
                      <a
                        href={manualComposeUrl(p, text) ?? "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-btn px-btn-ghost px-btn-sm no-underline"
                        data-testid={`autopost-open-${p}`}
                      >
                        {t("publish.openApp", { platform: L(PLATFORM_META[p].name) })}
                        <ArrowUpRight size={15} strokeWidth={1.75} aria-hidden />
                      </a>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* YouTube + TikTok options */}
      {auto.platforms.includes("youtube") && (
        <section className="flex flex-col gap-1.5" data-testid="autopost-youtube">
          <span className="text-ink-2 flex items-center gap-1.5 text-sm font-bold">
            <PlatformGlyph platform="youtube" size={14} className="shrink-0" />
            {t("publish.yt.title")}
          </span>
          <input
            type="text"
            className="px-input"
            maxLength={YT_TITLE_MAX}
            placeholder={post.title}
            aria-label={t("publish.yt.videoTitle")}
            value={auto.youtubeTitle}
            onChange={(e) => save({ youtubeTitle: e.target.value })}
            data-testid="autopost-yt-title"
          />
          <select
            className="px-input"
            aria-label={t("publish.privacy")}
            value={auto.youtubePrivacy}
            onChange={(e) => save({ youtubePrivacy: e.target.value as AutoPost["youtubePrivacy"] })}
            data-testid="autopost-yt-privacy"
          >
            {YOUTUBE_PRIVACY.map((v) => (
              <option key={v} value={v}>
                {t(`publish.yt.privacy.${v}`)}
              </option>
            ))}
          </select>
          <p className="text-muted text-xs">{t("publish.yt.note")}</p>
        </section>
      )}
      {auto.platforms.includes("tiktok") && <TikTokOptions auto={auto} save={save} />}
      <TikTokFinishCard post={post} />

      {/* When */}
      <section className="flex flex-col gap-1.5">
        <span className="text-ink-2 text-sm font-bold">{t("publish.when")}</span>
        <p className="px-inset text-sm" data-testid="autopost-when">
          {at ? t("publish.whenAt", { date: formatInstant(at, lang) }) : t("publish.whenNone")}
        </p>
      </section>

      {/* Status per network */}
      {sent && (
        <section className="flex flex-col gap-1.5" data-testid="autopost-status">
          <span className="text-ink-2 text-sm font-bold">
            {t("publish.status")} · {t(`publish.summary.${summary}`)}
          </span>
          <ul className="flex flex-col gap-1.5">
            {auto.platforms.filter(isSocialPlatform).map((p) => (
              <ResultRow
                key={p}
                platform={p}
                result={
                  p === "tiktok" && auto.tiktokCompletedAt
                    ? { ...auto.results[p]!, inbox: false, permalink: auto.tiktokPermalink }
                    : auto.results[p]
                }
              />
            ))}
          </ul>
          {auto.checkedAt && (
            <p className="text-muted text-xs">
              {t("publish.checkedAt", { date: formatInstant(auto.checkedAt, lang) })}
            </p>
          )}
        </section>
      )}

      {problems.length > 0 && (
        <ul
          role="alert"
          className="text-danger flex flex-col gap-0.5 text-xs"
          data-testid="autopost-problems"
        >
          {problems.map((pr, i) => (
            <li key={i}>
              <TriangleAlert
                size={13}
                strokeWidth={1.75}
                className="me-1 inline align-[-2px]"
                aria-hidden
              />
              {t(PROBLEM_KEY[pr.code], {
                platform: pr.platform ? L(PLATFORM_META[pr.platform].name) : "",
              })}
            </li>
          ))}
        </ul>
      )}
      {!problems.length && live.length > 0 && configured && (
        <p className="text-muted text-xs" data-testid="autopost-todo">
          {t("publish.todo", { n: live.length })}
        </p>
      )}
      {error && (
        <p role="alert" className="text-danger text-xs" data-testid="autopost-error">
          {t(error)}
        </p>
      )}
      {notice && (
        <p role="status" className="text-tint text-xs font-semibold" data-testid="autopost-notice">
          {t(notice)}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="px-btn"
          disabled={busy || !configured}
          onClick={async () => after(await schedule(post), "publish.scheduled")}
          data-testid="autopost-schedule"
        >
          {sent ? t("publish.update") : t("publish.schedule")}
        </button>
        <button
          type="button"
          className="px-btn px-btn-ghost"
          disabled={busy || !configured}
          onClick={async () => after(await runNow(post), "publish.sentNow")}
          data-testid="autopost-now"
        >
          {t("publish.now")}
        </button>
        {sent && (
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm text-danger ms-auto"
            disabled={busy}
            onClick={async () => after(await cancel(post), "publish.canceled")}
            data-testid="autopost-cancel"
          >
            {t("publish.cancel")}
          </button>
        )}
      </div>
      {sent && <p className="text-muted text-xs">{t("publish.updateHint")}</p>}
    </div>
  );
}

function ResultRow({
  platform,
  result,
}: {
  platform: Platform;
  result: AutoPostResult | undefined;
}) {
  const { t } = useT();
  const state = result?.state ?? "queued";
  const tone =
    state === "published" ? "px-chip-green" : state === "failed" ? "text-danger" : "px-chip-gold";
  return (
    <li
      className="px-inset flex flex-wrap items-center gap-2 text-sm"
      data-testid="autopost-result"
      data-platform={platform}
      data-state={state}
    >
      <PlatformChip platform={platform} />
      <span className={`px-chip ${tone}`}>
        {result?.inbox ? t("publish.state.inbox") : t(`publish.state.${state}`)}
      </span>
      {result?.permalink && (
        <a
          href={result.permalink}
          target="_blank"
          rel="noopener noreferrer"
          className="px-link text-xs"
          data-testid="autopost-result-link"
        >
          {t("publish.openPost")}
          <ArrowUpRight
            size={12}
            strokeWidth={1.75}
            className="ms-0.5 inline align-[-1px]"
            aria-hidden
          />
        </a>
      )}
      {result?.error && (
        <span className="text-ink-2 w-full text-xs">
          {state === "failed" ? "" : `${t("publish.retrying")} · `}
          {t(ERROR_KEY[result.error] ?? "publish.err.upstream")}
          {result.detail && result.error === "rejected" ? ` («${result.detail}»)` : ""}
        </span>
      )}
    </li>
  );
}
