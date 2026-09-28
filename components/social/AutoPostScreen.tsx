"use client";

import Link from "next/link";
import { useState } from "react";
import { useGameActions } from "@/components/celebrate/useGameActions";
import type { Post } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { autoPostActive, autoPostSummary, scheduledAtOf } from "@/lib/publish";
import { accountState, isSocialPlatform, SOCIAL_PLATFORMS } from "@/lib/socialSync";
import { useStore } from "@/store";
import { formatInstant } from "./calendar/dates";
import { PlatformChip, platformStyle } from "./calendar/PlatformChip";
import { calendarPostHref } from "./studio/platform";
import { refreshPublishJobs } from "./usePublish";
import { useSocialSync } from "./useSocialSync";

/** Newest finished auto-posts shown under "Already out". */
const DONE_MAX = 20;

const at = (p: Post) => scheduledAtOf(p) ?? p.autoPost?.sentAt ?? p.updatedAt;

/**
 * 🚀 Auto-posting hub (the ⚡ Automations route): which accounts can post by themselves (with "Allow
 * posting"), the scheduled posts with each network's state, and what already went out. Scheduling itself
 * happens in the post popup's 🚀 tab; every row links back there.
 */
export default function AutoPostScreen() {
  const { t } = useT();
  const { configured, status, busy, connect } = useSocialSync({ auto: true });
  const { markPosted } = useGameActions();
  const posts = useStore((s) => s.posts);
  const [refreshing, setRefreshing] = useState(false);

  const sent = posts.filter((p) => p.autoPost?.sentAt);
  const upcoming = sent
    .filter((p) => autoPostActive(p.autoPost))
    .sort((a, b) => (at(a) < at(b) ? -1 : 1));
  const done = sent
    .filter((p) => !autoPostActive(p.autoPost))
    .sort((a, b) => (at(a) < at(b) ? 1 : -1))
    .slice(0, DONE_MAX);

  const refresh = async () => {
    setRefreshing(true);
    await refreshPublishJobs((id, url) => void markPosted(id, url));
    setRefreshing(false);
  };

  return (
    <div className="flex flex-col gap-4" data-testid="autopost-screen">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl">{t("publish.hub.title")}</h1>
        <p className="text-ink-2 text-sm">{t("publish.hub.sub")}</p>
      </header>

      <section className="px-card flex flex-col gap-3" data-testid="autopost-accounts">
        <h2 className="text-base">{t("publish.hub.accounts")}</h2>
        {!configured || !status ? (
          <p className="text-ink-2 text-sm">
            {t("publish.needWorker")}{" "}
            <Link href="/settings#accounts" className="px-link">
              {t("publish.hub.settings")}
            </Link>
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {SOCIAL_PLATFORMS.map((p) => {
              const st = status[p];
              const state = accountState(st);
              return (
                <li
                  key={p}
                  className="px-inset flex items-center gap-2"
                  style={platformStyle(p)}
                  data-testid="autopost-account"
                  data-platform={p}
                  data-can-post={!!st?.canPublish}
                >
                  <PlatformChip platform={p} />
                  <span className="text-muted min-w-0 flex-1 truncate text-xs">
                    {state === "not_configured"
                      ? t("publish.net.notSetUp")
                      : !st?.connected
                        ? t("publish.net.notConnected")
                        : st.canPublish
                          ? t("publish.hub.canPost")
                          : t("publish.net.noPermission")}
                  </span>
                  {st?.connected && !st.canPublish && (
                    <button
                      type="button"
                      className="px-btn px-btn-sm shrink-0"
                      disabled={busy}
                      onClick={() => void connect(p, true)}
                      data-testid={`autopost-hub-allow-${p}`}
                    >
                      {t("publish.allow")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-muted text-xs">{t("publish.hub.manual")}</p>
      </section>

      <section className="px-card flex flex-col gap-3" data-testid="autopost-upcoming">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base">{t("publish.hub.upcoming")}</h2>
          {configured && sent.length > 0 && (
            <button
              type="button"
              className="px-btn px-btn-ghost px-btn-sm ms-auto"
              disabled={refreshing}
              aria-busy={refreshing}
              onClick={() => void refresh()}
              data-testid="autopost-refresh"
            >
              {t("publish.hub.refresh")}
            </button>
          )}
        </div>
        {upcoming.length === 0 ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-ink-2 text-sm" data-testid="autopost-empty">
              {t("publish.hub.empty")}
            </p>
            <Link href="/social/calendar/" className="px-btn px-btn-ghost px-btn-sm no-underline">
              {t("publish.hub.openCalendar")}
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {upcoming.map((p) => (
              <JobRow key={p.id} post={p} />
            ))}
          </ul>
        )}
      </section>

      {done.length > 0 && (
        <section className="px-card flex flex-col gap-3" data-testid="autopost-done">
          <h2 className="text-base">{t("publish.hub.done")}</h2>
          <ul className="flex flex-col gap-2">
            {done.map((p) => (
              <JobRow key={p.id} post={p} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function JobRow({ post }: { post: Post }) {
  const { t, lang } = useT();
  const auto = post.autoPost!;
  const summary = autoPostSummary(auto);
  const when = at(post);
  return (
    <li
      className="px-inset flex flex-col gap-1.5"
      data-testid="autopost-job"
      data-post={post.id}
      data-summary={summary}
    >
      <div className="flex flex-wrap items-center gap-2">
        <b className="min-w-0 flex-1 truncate text-sm">{post.title}</b>
        <span className="px-chip text-xs">{t(`publish.summary.${summary}`)}</span>
        <Link href={calendarPostHref(post.id)} className="px-link text-xs">
          {t("publish.hub.open")}
        </Link>
      </div>
      <span className="text-muted num text-xs">{formatInstant(when, lang)}</span>
      <ul className="flex flex-wrap gap-1.5">
        {auto.platforms.map((p) => {
          const r = isSocialPlatform(p) ? auto.results[p] : undefined;
          const state = isSocialPlatform(p) ? (r?.state ?? "queued") : null;
          return (
            <li
              key={p}
              className="flex items-center gap-1 text-xs"
              data-platform={p}
              data-state={state ?? "manual"}
            >
              <PlatformChip platform={p} short />
              {state === null ? (
                <span className="text-muted">✋</span>
              ) : r?.permalink ? (
                <a href={r.permalink} target="_blank" rel="noopener noreferrer" className="px-link">
                  {t("publish.state.published")}
                </a>
              ) : (
                <span className={state === "failed" ? "text-danger" : "text-muted"}>
                  {r?.inbox ? t("publish.state.inbox") : t(`publish.state.${state}`)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </li>
  );
}
