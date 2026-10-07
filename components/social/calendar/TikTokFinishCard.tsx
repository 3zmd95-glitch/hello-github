"use client";

import { ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { useGameActions } from "@/components/celebrate/useGameActions";
import type { Post } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { canAutoMarkPosted, isTikTokPostUrl, needsTikTokFinish } from "@/lib/publish";
import { useStore } from "@/store";

/** Upload success is not publishing success. Only the owner can confirm completion in the native app. */
export default function TikTokFinishCard({ post }: { post: Post }) {
  const { t } = useT();
  const { markPosted } = useGameActions();
  const [url, setUrl] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  if (!needsTikTokFinish(post.autoPost)) return null;
  const finish = () => {
    const latest = useStore.getState().posts.find((p) => p.id === post.id);
    if (
      !latest?.autoPost ||
      !needsTikTokFinish(latest.autoPost) ||
      !confirmed ||
      !isTikTokPostUrl(url)
    )
      return;
    const autoPost = {
      ...latest.autoPost,
      tiktokCompletedAt: new Date().toISOString(),
      tiktokPermalink: url.trim(),
    };
    useStore.getState().updatePost(post.id, { autoPost });
    if (canAutoMarkPosted(autoPost)) void markPosted(post.id, url.trim());
  };
  return (
    <section
      className="px-inset bg-warn-bg border-warn flex flex-col gap-2 border"
      data-testid="tiktok-finish-card"
    >
      <h3 className="text-sm font-bold">{t("publish.tt.finishTitle")}</h3>
      <p className="text-sm">{t("publish.tt.finishSteps")}</p>
      <a
        className="px-link self-start text-sm"
        href="https://www.tiktok.com/"
        target="_blank"
        rel="noopener noreferrer"
      >
        {t("publish.openApp", { platform: "TikTok" })}
        <ArrowUpRight
          size={14}
          strokeWidth={1.75}
          className="ms-0.5 inline align-[-2px]"
          aria-hidden
        />
      </a>
      <label className="flex flex-col gap-1 text-xs">
        {t("publish.tt.postLink")}
        <input
          className="px-input"
          type="url"
          dir="ltr"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.tiktok.com/@3z.prod/video/…"
          data-testid="tiktok-finish-url"
        />
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          data-testid="tiktok-finish-confirm"
        />
        {t("publish.tt.finishedConfirm")}
      </label>
      <button
        type="button"
        className="px-btn self-start"
        disabled={!confirmed || !isTikTokPostUrl(url)}
        onClick={finish}
        data-testid="tiktok-finish-save"
      >
        {t("publish.tt.finishedSave")}
      </button>
      {url && !isTikTokPostUrl(url) && (
        <p className="text-danger text-xs">{t("publish.tt.fullLink")}</p>
      )}
    </section>
  );
}
