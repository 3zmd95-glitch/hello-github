"use client";

import { useState } from "react";
import type { AutoReply, ReplyMatch, SocialPostStat, SocialStatusMap } from "@/lib/domain";
import { useT, type MessageKey } from "@/lib/i18n";
import {
  BUTTON_TITLE_MAX,
  BUTTONS_MAX,
  dmBytesLeft,
  dmPreview,
  REPLY_PLATFORMS,
  replyProblems,
  splitKeywords,
  type ReplyProblemCode,
} from "@/lib/replies";

const PROBLEM_KEY: Record<ReplyProblemCode, MessageKey> = {
  noKeywords: "replies.problem.noKeywords",
  tooManyKeywords: "replies.problem.tooManyKeywords",
  keywordTooLong: "replies.problem.keywordTooLong",
  noDm: "replies.problem.noDm",
  dmTooLong: "replies.problem.dmTooLong",
  templateTooLong: "replies.problem.templateTooLong",
  publicTooLong: "replies.problem.publicTooLong",
  tooManyPublic: "replies.problem.tooManyPublic",
  badUrl: "replies.problem.badUrl",
  noTitle: "replies.problem.noTitle",
  tooManyButtons: "replies.problem.tooManyButtons",
  notConnected: "replies.problem.notConnected",
  noPermission: "replies.problem.noPermission",
};

const MATCHES: readonly ReplyMatch[] = ["contains", "exact"];

/**
 * The builder (Beacons' Smart Reply, one screen): which post (or any), the words to watch for, the public
 * reply, the private message and its links, on/off. Saving is refused while a problem is listed; the Worker
 * checks the same rules again.
 */
export default function AutoReplyForm({
  value,
  posts,
  status,
  origin,
  busy,
  onSave,
  onCancel,
}: {
  value: AutoReply;
  /** The synced Instagram posts for the post picker (newest first). */
  posts: readonly SocialPostStat[];
  status: SocialStatusMap | null;
  /** The Worker's origin (the /go links in the preview). */
  origin?: string;
  busy: boolean;
  onSave: (a: AutoReply) => void;
  onCancel: () => void;
}) {
  const { t, lang } = useT();
  const [draft, setDraft] = useState<AutoReply>(value);
  const [keywordsText, setKeywordsText] = useState(value.keywords.join(", "));
  const [tried, setTried] = useState(false);

  const current: AutoReply = { ...draft, keywords: splitKeywords(keywordsText) };
  const problems = replyProblems(current, status, origin);
  const patch = (p: Partial<AutoReply>) => setDraft((d) => ({ ...d, ...p }));

  const pickPost = (id: string) => {
    if (id === "") return patch({ postId: null, permalink: undefined, title: undefined, thumbUrl: undefined });
    const p = posts.find((x) => x.postId === id);
    patch({ postId: id, permalink: p?.permalink, title: p?.title, thumbUrl: p?.thumbUrl });
  };

  const label = (p: SocialPostStat) =>
    p.title?.trim() || `${p.publishedAt.slice(0, 10)} · ${p.permalink ?? p.postId}`;

  const submit = () => {
    setTried(true);
    if (problems.length) return;
    onSave(current);
  };

  return (
    <form
      className="px-inset flex flex-col gap-3"
      data-testid="autoreply-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <h3 className="text-base">{t("replies.form.title")}</h3>

      {/* Post */}
      <label className="flex flex-col gap-1">
        <span className="text-ink-2 text-sm font-bold">{t("replies.form.post")}</span>
        <select
          className="px-input"
          value={draft.postId ?? ""}
          onChange={(e) => pickPost(e.target.value)}
          data-testid="autoreply-post"
        >
          <option value="">{t("replies.form.anyPost")}</option>
          {posts
            .filter((p) => REPLY_PLATFORMS.includes(p.platform as (typeof REPLY_PLATFORMS)[number]))
            .map((p) => (
              <option key={p.postId} value={p.postId}>
                {label(p)}
              </option>
            ))}
          {draft.postId && !posts.some((p) => p.postId === draft.postId) && (
            <option value={draft.postId}>{draft.title ?? draft.permalink ?? draft.postId}</option>
          )}
        </select>
      </label>

      {/* Keywords */}
      <label className="flex flex-col gap-1">
        <span className="text-ink-2 text-sm font-bold">{t("replies.form.keywords")}</span>
        <input
          type="text"
          className="px-input"
          autoComplete="off"
          placeholder="لت, lut"
          value={keywordsText}
          onChange={(e) => setKeywordsText(e.target.value)}
          data-testid="autoreply-keywords"
        />
        <span className="text-muted text-xs">{t("replies.form.keywordsHint")}</span>
      </label>
      <div className="flex flex-col gap-1">
        <span className="text-ink-2 text-sm font-bold">{t("replies.form.match")}</span>
        <div className="cal-tabs self-start" role="radiogroup" aria-label={t("replies.form.match")}>
          {MATCHES.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              className="cal-tab"
              aria-checked={draft.match === m}
              onClick={() => patch({ match: m })}
              data-testid={`autoreply-match-${m}`}
            >
              {t(`replies.form.match.${m}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Public reply */}
      <label className="flex flex-col gap-1">
        <span className="text-ink-2 text-sm font-bold">{t("replies.form.publicReply")}</span>
        <textarea
          className="px-input min-h-16"
          value={draft.publicReplies[0] ?? ""}
          onChange={(e) => patch({ publicReplies: e.target.value ? [e.target.value] : [] })}
          data-testid="autoreply-public"
        />
        <span className="text-muted text-xs">{t("replies.form.publicHint", { username: "{username}" })}</span>
      </label>

      {/* DM */}
      <label className="flex flex-col gap-1">
        <span className="flex items-center gap-2 text-sm font-bold">
          <span className="text-ink-2">{t("replies.form.dm")}</span>
          <span className="text-muted num ms-auto text-xs">{dmBytesLeft(current, origin)}</span>
        </span>
        <textarea
          className="px-input min-h-24"
          value={draft.dmText}
          onChange={(e) => patch({ dmText: e.target.value })}
          data-testid="autoreply-dm"
        />
        <span className="text-muted text-xs">{t("replies.form.dmHint")}</span>
      </label>

      {/* Links */}
      <div className="flex flex-col gap-1.5">
        <span className="text-ink-2 text-sm font-bold">{t("replies.form.buttons")}</span>
        {draft.buttons.map((b, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1.5" data-testid="autoreply-button">
            <input
              type="text"
              className="px-input min-w-28 flex-1"
              maxLength={BUTTON_TITLE_MAX}
              placeholder={t("replies.form.buttonTitle")}
              aria-label={t("replies.form.buttonTitle")}
              value={b.title}
              onChange={(e) =>
                patch({
                  buttons: draft.buttons.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)),
                })
              }
              data-testid={`autoreply-button-title-${i}`}
            />
            <input
              type="url"
              inputMode="url"
              dir="ltr"
              className="px-input min-w-40 flex-[2]"
              placeholder="https://…"
              aria-label={t("replies.form.buttonUrl")}
              value={b.url}
              onChange={(e) =>
                patch({
                  buttons: draft.buttons.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)),
                })
              }
              data-testid={`autoreply-button-url-${i}`}
            />
            <button
              type="button"
              className="px-btn px-btn-ghost px-btn-sm"
              aria-label={t("replies.delete")}
              onClick={() => patch({ buttons: draft.buttons.filter((_, j) => j !== i) })}
              data-testid={`autoreply-button-remove-${i}`}
            >
              ✕
            </button>
          </div>
        ))}
        {draft.buttons.length < BUTTONS_MAX && (
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm self-start"
            onClick={() => patch({ buttons: [...draft.buttons, { title: "", url: "" }] })}
            data-testid="autoreply-add-button"
          >
            {t("replies.form.addButton")}
          </button>
        )}
      </div>

      {/* Preview */}
      {current.dmText.trim() && (
        <div className="flex flex-col gap-1">
          <span className="text-ink-2 text-sm font-bold">{t("replies.form.preview")}</span>
          <pre
            className="px-inset text-ink-2 whitespace-pre-wrap break-words font-sans text-xs"
            dir="auto"
            data-testid="autoreply-preview"
          >
            {dmPreview(current, origin)}
          </pre>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => patch({ enabled: e.target.checked })}
          data-testid="autoreply-enabled"
        />
        {t("replies.form.enabled")}
      </label>

      {tried && problems.length > 0 && (
        <ul className="text-danger flex flex-col gap-0.5 text-xs" data-testid="autoreply-problems">
          {problems.map((p) => (
            <li key={p.code}>{t(PROBLEM_KEY[p.code], p.max !== undefined ? { max: p.max } : undefined)}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2" dir={lang === "ar" ? "rtl" : "ltr"}>
        <button type="submit" className="px-btn px-btn-primary" disabled={busy} data-testid="autoreply-save">
          {t("replies.save")}
        </button>
        <button
          type="button"
          className="px-btn px-btn-ghost"
          onClick={onCancel}
          data-testid="autoreply-cancel"
        >
          {t("replies.cancel")}
        </button>
      </div>
    </form>
  );
}
