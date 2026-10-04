"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n";
import { safeTikTokPostUrl, tiktokBrief, tiktokBriefCsv, type TikTokRank } from "@/lib/tiktokBrief";
import { useStore } from "@/store";
import { postHash } from "../calendar/dates";
import { useSocialSync, syncSocialNow } from "../useSocialSync";

export default function TikTokBrief({ now }: { now: number }) {
  const { t, lang } = useT();
  const stats = useStore((s) => s.socialPostStats);
  const posts = useStore((s) => s.posts);
  const addPost = useStore((s) => s.addPost);
  const { status, busy, error } = useSocialSync();
  const [days, setDays] = useState<7 | 30>(30);
  const [rank, setRank] = useState<TikTokRank>("views");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const brief = useMemo(() => tiktokBrief(stats, now, days, rank), [stats, now, days, rank]);
  const fmt = (n: number | null) =>
    n === null ? "—" : new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(n);
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([tiktokBriefCsv(brief.posts)], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `tiktok-posts-${days}d.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section
      className="px-card flex min-w-0 flex-col gap-3"
      id="tiktok-brief"
      data-testid="tiktok-brief"
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg">{t("tiktok.brief.title")}</h2>
          <p className="text-ink-2 text-sm">{t("tiktok.brief.subtitle")}</p>
        </div>
        {status?.tiktok?.connected ? (
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            disabled={busy}
            onClick={() => void syncSocialNow(["tiktok"])}
          >
            {t(busy ? "tiktok.brief.refreshing" : "tiktok.brief.sync")}
          </button>
        ) : (
          <Link href="/settings/#accounts" className="px-link text-sm">
            {t("tiktok.brief.connect")}
          </Link>
        )}
      </header>
      <div className="flex flex-wrap gap-2">
        <select
          className="px-input max-w-full"
          aria-label={t("tiktok.brief.days", { days })}
          value={days}
          onChange={(e) => setDays(Number(e.target.value) as 7 | 30)}
          data-testid="tiktok-brief-days"
        >
          {[7, 30].map((n) => (
            <option value={n} key={n}>
              {t("tiktok.brief.days", { days: n })}
            </option>
          ))}
        </select>
        <select
          className="px-input max-w-full"
          aria-label={t("tiktok.brief.rank")}
          value={rank}
          onChange={(e) => setRank(e.target.value as TikTokRank)}
        >
          {(["views", "shares", "comments"] as const).map((key) => (
            <option value={key} key={key}>
              {t(`tiktok.brief.${key}`)}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p className="text-danger text-sm" role="alert">
          {t(error)}
        </p>
      )}
      {!brief.posts.length ? (
        <p className="px-inset text-sm">{t("tiktok.brief.empty")}</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            {[
              ["count", brief.posts.length],
              ["median", brief.medianViews],
              ["shareRate", brief.sharesPerThousand],
            ].map(([key, value]) => (
              <div className="px-inset min-w-0" key={key as string}>
                <p className="text-muted text-xs">
                  {t(`tiktok.brief.${key as "count" | "median" | "shareRate"}`)}
                </p>
                <b className="num text-lg">{fmt(value as number | null)}</b>
              </div>
            ))}
          </div>
          <p className="text-muted text-xs">{t("tiktok.brief.note")}</p>
          <ol className="flex flex-col gap-2">
            {brief.top.map((p) => {
              const url = safeTikTokPostUrl(p.permalink);
              const draft = drafts[p.postId];
              const exists = draft && posts.some((item) => item.id === draft);
              return (
                <li
                  key={p.postId}
                  className="px-inset flex min-w-0 flex-col gap-2"
                  data-testid="tiktok-brief-post"
                >
                  <b className="text-sm break-words" dir="auto">
                    {p.title || t("tiktok.brief.untitled")}
                  </b>
                  <p className="text-muted text-xs">
                    {t("tiktok.brief.numbers", {
                      views: fmt(p.views),
                      shares: fmt(p.shares),
                      comments: fmt(p.comments),
                    })}
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    {exists ? (
                      <Link
                        className="px-link text-sm"
                        href={`/social/calendar/${postHash(draft)}`}
                        data-testid="tiktok-brief-draft"
                      >
                        {t("tiktok.brief.openDraft")}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className="px-btn px-btn-sm"
                        data-testid="tiktok-brief-followup"
                        onClick={() => {
                          const created = addPost({
                            platform: "tiktok",
                            title: t("tiktok.brief.followupTitle", {
                              title: (p.title || t("tiktok.brief.untitled")).slice(0, 150),
                            }),
                            withTemplate: true,
                          });
                          setDrafts((prev) => ({ ...prev, [p.postId]: created.id }));
                        }}
                      >
                        {t("tiktok.brief.followup")}
                      </button>
                    )}
                    {url && (
                      <a
                        className="px-link text-xs"
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t("tiktok.brief.openPost")}
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm self-start"
            onClick={download}
            data-testid="tiktok-brief-export"
          >
            {t("tiktok.brief.export")}
          </button>
        </>
      )}
    </section>
  );
}
