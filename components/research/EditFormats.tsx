"use client";

import { useEffect, useId, useState } from "react";
import {
  editFormatQuery,
  formatFreshness,
  formatIdentity,
  mergeEditFormats,
  type EditFormat,
} from "@/lib/editFormats";
import type { TrendingEffects } from "@/lib/effects";
import { REVIEWED_FORMAT_SEEDS } from "@/lib/formatSeeds";
import { useT } from "@/lib/i18n";
import { useStore } from "@/store";
import type { ResearchItem } from "@/lib/research";
import { ResultPreview } from "./ResultCard";
import SaveInspirationButton from "./SaveInspirationButton";

/** A specific visual recipe with its audio, kept separate from the generic technique vocabulary. */
export default function EditFormats({
  data,
  onPick,
  onScan,
  scanning,
  scanStatus,
}: {
  data: TrendingEffects | null;
  onPick: (query: string, intent: "examples" | "tutorials", format: EditFormat) => void;
  onScan?: () => void;
  scanning?: boolean;
  scanStatus?: string;
}) {
  const { t, lang } = useT();
  const headingId = useId();
  const followed = useStore((s) => s.followedFormats);
  const follow = useStore((s) => s.followFormat);
  const unfollow = useStore((s) => s.unfollowFormat);
  const refreshFollowed = useStore((s) => s.refreshFollowedFormats);
  const [onlyFollowing, setOnlyFollowing] = useState(false);
  const [now] = useState(() => Date.now());
  // A completed manual scan can be newer than this mounted panel; judge freshness at that scan's time.
  const evidenceNow = Math.max(now, Date.parse(data?.updatedAt ?? "") || now);
  const formats = mergeEditFormats(data?.formats ?? [], REVIEWED_FORMAT_SEEDS, followed);
  const saved = new Set(followed.map((entry) => formatIdentity(entry.format)));
  const shown = onlyFollowing
    ? formats.filter((format) => saved.has(formatIdentity(format)))
    : formats;
  const localText = (text: { en: string; ar?: string }) =>
    lang === "ar" ? (text.ar ?? text.en) : text.en;
  const day = (date: string) =>
    new Intl.DateTimeFormat(lang === "ar" ? "ar-SA" : "en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      calendar: "gregory",
    }).format(new Date(date));
  useEffect(() => {
    if (data?.formats) refreshFollowed(data.formats);
  }, [data?.formats, refreshFollowed]);

  return (
    <section
      aria-labelledby={headingId}
      className="@container flex min-w-0 flex-col gap-3"
      data-testid="edit-formats"
      dir={lang === "ar" ? "rtl" : "ltr"}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={headingId} className="text-base font-bold">
            {t("formats.browseTitle")}
          </h2>
          <p className="text-muted mt-1 text-xs">{t("formats.browseHelp")}</p>
        </div>
        {onScan && (
          <button
            type="button"
            className="px-link text-xs disabled:opacity-50"
            disabled={scanning}
            onClick={onScan}
            data-testid="formats-scan"
          >
            {t(scanning ? "formats.scanning" : "formats.scan")}
          </button>
        )}
      </div>
      <p
        role="status"
        className={scanStatus ? "text-muted text-xs" : "sr-only"}
        data-testid="formats-scan-status"
      >
        {scanStatus ?? ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`px-chip ${!onlyFollowing ? "bg-accent text-bg" : ""}`}
          aria-pressed={!onlyFollowing}
          onClick={() => setOnlyFollowing(false)}
        >
          {t("formats.all")}
        </button>
        <button
          type="button"
          className={`px-chip ${onlyFollowing ? "bg-accent text-bg" : ""}`}
          aria-pressed={onlyFollowing}
          onClick={() => setOnlyFollowing(true)}
          data-testid="formats-following"
        >
          {t("formats.followingCount", { n: followed.length })}
        </button>
      </div>
      {!shown.length && (
        <p className="text-muted text-sm">
          {t(onlyFollowing ? "formats.emptyFollowing" : "formats.empty")}
        </p>
      )}
      <div className="grid min-w-0 gap-3">
        {shown.map((format) => {
          const identity = formatIdentity(format);
          const isFollowed = saved.has(identity);
          const reviewed = format.source === "reviewed-reference";
          const freshness = formatFreshness(format, evidenceNow);
          const repeated =
            !reviewed && format.evidence.state === "repeated" && freshness === "recent";
          const sample = format.samples[0];
          const preview: ResearchItem = {
            url: sample.url,
            title: sample.title,
            platform: sample.platform,
            handle: sample.handle ?? "",
            snippet: "",
            ...(sample.published ? { published: sample.published } : {}),
          };
          return (
            <article
              key={identity}
              className="border-edge bg-panel grid min-w-0 gap-3 border-2 p-3 @min-[36rem]:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]"
              data-testid="edit-format"
              data-key={format.key}
            >
              <div className="min-w-0">
                <ResultPreview item={preview} testId="format-preview" />
                {sample.handle && (
                  <p className="text-muted mt-1 truncate text-xs" dir="ltr">
                    {sample.handle}
                  </p>
                )}
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="min-w-0 text-base leading-snug font-bold break-words" dir="auto">
                    {localText(format.name)}
                  </h3>
                  <span
                    className="bg-panel-3 text-ink-2 px-2 py-1 text-[11px] font-bold"
                    data-testid="format-evidence-state"
                  >
                    {t(
                      reviewed
                        ? "formats.reviewed"
                        : repeated
                          ? "formats.observed"
                          : "formats.candidate",
                    )}
                  </span>
                </div>
                <p className="text-ink-2 text-xs break-words" dir="auto">
                  {localText(format.visualPattern)}
                </p>
                {format.audio && (
                  <p className="text-xs break-words" dir="auto">
                    <span className="font-bold">{t("formats.audio")}</span> {format.audio.title}
                    {format.audio.artist ? ` · ${format.audio.artist}` : ""}
                  </p>
                )}
                <p className="text-muted text-xs" data-testid="format-evidence-caveat">
                  {t(reviewed ? "formats.cardReviewed" : "formats.cardUnverified")}
                </p>
                {freshness !== "recent" && (
                  <p className="text-muted text-xs" data-testid="format-freshness">
                    {t(freshness === "unknown" ? "formats.cardDateUnknown" : "formats.cardOlder")}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    className="px-btn px-btn-sm"
                    onClick={() => onPick(editFormatQuery(format, "examples"), "examples", format)}
                    data-testid="format-find-examples"
                  >
                    {t("formats.primaryExamples")}
                  </button>
                  <button
                    type="button"
                    className="px-btn px-btn-ghost px-btn-sm"
                    onClick={() =>
                      onPick(editFormatQuery(format, "tutorials"), "tutorials", format)
                    }
                    data-testid="format-find-tutorials"
                  >
                    {t("formats.findTutorials")}
                  </button>
                  <button
                    type="button"
                    className={`px-chip min-h-8 ${isFollowed ? "bg-gold text-bg" : ""}`}
                    aria-pressed={isFollowed}
                    aria-label={t(isFollowed ? "formats.followed" : "formats.follow")}
                    onClick={() => (isFollowed ? unfollow(identity) : follow(format))}
                    data-testid="format-follow"
                  >
                    {t(isFollowed ? "formats.cardFollowing" : "formats.follow")}
                  </button>
                </div>
                <details className="text-xs" data-testid="format-sources">
                  <summary className="px-link cursor-pointer">
                    {t("formats.cardSources", { n: format.samples.length })}
                  </summary>
                  <p className="text-muted mt-2">
                    {reviewed
                      ? t("formats.reviewedNote")
                      : t("formats.evidence", {
                          creators: format.evidence.creators7d,
                          posts: format.evidence.posts7d,
                        })}{" "}
                    {t("formats.checked", { date: day(format.lastChecked) })}
                  </p>
                  {format.reviewNote && (
                    <p className="text-muted mt-2 text-xs" dir="auto">
                      {localText(format.reviewNote)}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <SaveInspirationButton item={preview} />
                    {format.audio?.url && (
                      <a
                        href={format.audio.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-link"
                      >
                        {t("formats.openAudio")}
                      </a>
                    )}
                  </div>
                  <ul className="mt-2 flex flex-col gap-2">
                    {format.samples.map((sample, index) => (
                      <li key={`${sample.url}-${index}`} className="border-edge border-s-2 ps-2">
                        <a
                          href={sample.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-link break-words"
                          dir="auto"
                          data-testid={index === 0 ? "format-example" : undefined}
                        >
                          {sample.handle ?? (sample.title || sample.platform)}
                        </a>
                        <p className="text-muted">
                          {sample.published
                            ? t("formats.posted", { date: day(sample.published) })
                            : t("formats.postDateUnknown")}
                          {" · "}
                          {t("formats.checked", { date: day(sample.observedAt) })}
                        </p>
                        <p className="text-muted">
                          {t(
                            sample.basis === "partial-playback"
                              ? "formats.partialPlayback"
                              : sample.basis === "user-description"
                                ? "formats.userDescription"
                                : sample.captionSource === "instagram-public-embed"
                                  ? "formats.publicCaption"
                                  : "formats.captionOnly",
                          )}
                        </p>
                        {sample.patternQuote && (
                          <blockquote className="text-ink-2 mt-1" dir="auto">
                            “{sample.patternQuote}”
                          </blockquote>
                        )}
                        {sample.audioQuote && (
                          <p className="text-muted" dir="auto">
                            {sample.audioQuote}
                          </p>
                        )}
                        {sample.formatQuote && (
                          <p className="text-muted" dir="auto">
                            {sample.formatQuote}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            </article>
          );
        })}
      </div>
      <details className="text-muted text-xs">
        <summary className="px-link w-fit cursor-pointer">{t("formats.aboutResults")}</summary>
        <p className="mt-2">{t("formats.local")}</p>
        {!data?.formatVersion && (
          <p className="mt-2" data-testid="formats-awaiting-scan">
            {t("formats.awaitingScan")}
          </p>
        )}
      </details>
    </section>
  );
}
