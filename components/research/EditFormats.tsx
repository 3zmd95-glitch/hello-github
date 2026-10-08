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
import ResultCard from "./ResultCard";
import SaveInspirationButton from "./SaveInspirationButton";
import FormatSourceInspector from "./FormatSourceInspector";

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
      className="border-edge bg-panel/60 flex min-w-0 flex-col gap-3 border-2 p-3"
      data-testid="edit-formats"
      dir={lang === "ar" ? "rtl" : "ltr"}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={headingId} className="text-sm font-bold">
            {t("formats.title")}
          </h2>
          <p className="text-muted mt-1 max-w-3xl text-xs">{t("formats.help")}</p>
        </div>
        {onScan && (
          <button
            type="button"
            className="px-btn px-btn-sm"
            disabled={scanning}
            onClick={onScan}
            data-testid="formats-scan"
          >
            {t(scanning ? "formats.scanning" : "formats.scan")}
          </button>
        )}
      </div>
      <p role="status" className="text-muted text-xs" data-testid="formats-scan-status">
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
      {!data?.formatVersion && (
        <p className="text-muted text-xs" data-testid="formats-awaiting-scan">
          {t("formats.awaitingScan")}
        </p>
      )}
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
              className="border-edge bg-panel grid min-w-0 gap-3 border-2 p-3 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]"
              data-testid="edit-format"
              data-key={format.key}
            >
              <ul className="w-full max-w-sm min-w-0">
                <ResultCard
                  item={preview}
                  testId="format-preview"
                  action={<SaveInspirationButton item={preview} />}
                />
              </ul>
              <div className="flex min-w-0 flex-col gap-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="min-w-0 text-sm font-bold break-words" dir="auto">
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
                <p className="text-ink-2 text-xs" dir="auto">
                  {localText(format.visualPattern)}
                </p>
                {format.audio && (
                  <p className="text-xs" dir="auto">
                    <span className="font-bold">{t("formats.audio")}</span> {format.audio.title}
                    {format.audio.artist ? ` · ${format.audio.artist}` : ""}
                  </p>
                )}
                <p className="text-muted text-xs">
                  {reviewed
                    ? t("formats.reviewedNote")
                    : t("formats.evidence", {
                        creators: format.evidence.creators7d,
                        posts: format.evidence.posts7d,
                      })}{" "}
                  {t("formats.checked", { date: day(format.lastChecked) })}
                </p>
                {freshness !== "recent" && (
                  <p className="text-muted text-xs" data-testid="format-freshness">
                    {t(freshness === "unknown" ? "formats.dateUnknown" : "formats.stale")}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={format.samples[0].url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-btn px-btn-sm"
                    data-testid="format-example"
                  >
                    {t("formats.watch")}
                  </a>
                  {format.audio?.url && (
                    <a
                      href={format.audio.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-link text-xs"
                    >
                      {t("formats.openAudio")}
                    </a>
                  )}
                  <button
                    type="button"
                    className={`px-btn px-btn-sm ${isFollowed ? "px-btn-gold" : ""}`}
                    aria-pressed={isFollowed}
                    onClick={() => (isFollowed ? unfollow(identity) : follow(format))}
                    data-testid="format-follow"
                  >
                    {t(isFollowed ? "formats.followed" : "formats.follow")}
                  </button>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    className="px-link text-xs"
                    onClick={() => onPick(editFormatQuery(format, "examples"), "examples", format)}
                    data-testid="format-find-examples"
                  >
                    {t("formats.findExamples")}
                  </button>
                  <button
                    type="button"
                    className="px-link text-xs"
                    onClick={() =>
                      onPick(editFormatQuery(format, "tutorials"), "tutorials", format)
                    }
                    data-testid="format-find-tutorials"
                  >
                    {t("formats.findTutorials")}
                  </button>
                </div>
                <details className="text-xs" data-testid="format-sources">
                  <summary className="px-link cursor-pointer">
                    {t("formats.sources", { n: format.samples.length })}
                  </summary>
                  {format.reviewNote && (
                    <p className="text-muted mt-2 text-xs" dir="auto">
                      {localText(format.reviewNote)}
                    </p>
                  )}
                  <ul className="mt-2 flex flex-col gap-2">
                    {format.samples.map((sample, index) => (
                      <li key={`${sample.url}-${index}`} className="border-edge border-s-2 ps-2">
                        <a
                          href={sample.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-link break-words"
                          dir="auto"
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
      <FormatSourceInspector formats={formats} />
      <p className="text-muted text-xs">{t("formats.local")}</p>
    </section>
  );
}
