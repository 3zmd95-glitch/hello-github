"use client";

import { useState } from "react";
import type { AutoReply, SocialPostStat, SocialStatusMap } from "@/lib/domain";
import { useT, type MessageKey } from "@/lib/i18n";
import {
  aboutLetters,
  BUTTON_TITLE_MAX,
  BUTTONS_MAX,
  dmBytesLeft,
  PUBLIC_REPLIES_MAX,
  REPLY_PLATFORMS,
  replyProblems,
  splitKeywords,
  type ReplyProblemCode,
} from "@/lib/replies";
import PhonePreview from "./PhonePreview";
import PostGrid, { type PostTile } from "./PostGrid";

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

type Target = "post" | "anyPost" | "message";
const NO_POST = { postId: null, permalink: undefined, title: undefined, thumbUrl: undefined };

/**
 * The rule editor, full page and Beacons style (round 34): trigger cards (a chosen post from a thumbnail grid, any
 * post, or a DM / story reply), keywords as chips with an exact-match switch, up to three public replies (comment
 * rules), the DM with its link buttons and the «تابعني» switch, and a live phone preview. Saving is refused while a
 * problem is listed; the Worker checks the same rules again.
 */
export default function RuleEditor({
  value,
  posts,
  status,
  origin,
  username,
  busy,
  onSave,
  onCancel,
}: {
  value: AutoReply;
  posts: readonly SocialPostStat[];
  status: SocialStatusMap | null;
  origin?: string;
  username?: string;
  busy: boolean;
  onSave: (a: AutoReply) => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const [draft, setDraft] = useState<AutoReply>(value);
  const [choosingPost, setChoosingPost] = useState(
    value.trigger === "comment" && value.postId !== null,
  );
  const [word, setWord] = useState("");
  const [tried, setTried] = useState(false);
  const patch = (p: Partial<AutoReply>) => setDraft((d) => ({ ...d, ...p }));

  const igPosts = posts.filter((p) =>
    REPLY_PLATFORMS.includes(p.platform as (typeof REPLY_PLATFORMS)[number]),
  );
  // The rule's own post can be missing from this browser's synced posts (older, or synced elsewhere): offer it first,
  // so the grid shows what the rule answers, and it can be picked again after "any post" or another tile.
  const tiles: readonly PostTile[] =
    value.postId && !igPosts.some((p) => p.postId === value.postId)
      ? [
          {
            postId: value.postId,
            title: value.title,
            thumbUrl: value.thumbUrl,
            permalink: value.permalink,
          },
          ...igPosts,
        ]
      : igPosts;
  const target: Target =
    draft.trigger === "message" ? "message" : choosingPost ? "post" : "anyPost";
  const problems = replyProblems(draft, status, origin);
  // "Specific post" chosen but no post picked yet would save as "any post": refuse it here.
  const noPost = target === "post" && !draft.postId;
  const left = dmBytesLeft(draft, origin);
  const buttonsLeft = BUTTONS_MAX - draft.buttons.length - (draft.followButton ? 1 : 0);

  const setTarget = (next: Target) => {
    setChoosingPost(next === "post");
    if (next === "message") patch({ trigger: "message", publicReplies: [], ...NO_POST });
    else if (next === "anyPost") patch({ trigger: "comment", ...NO_POST });
    else patch({ trigger: "comment" });
  };
  const pickPost = (p: PostTile) =>
    patch({ postId: p.postId, permalink: p.permalink, title: p.title, thumbUrl: p.thumbUrl });
  const addWords = (text: string) => {
    patch({ keywords: splitKeywords([...draft.keywords, text].join("\n")) });
    setWord("");
  };
  const submit = () => {
    setTried(true);
    if (noPost || problems.length) return;
    onSave(draft);
  };

  const preview = <PhonePreview rule={draft} origin={origin} username={username} />;

  return (
    <form
      className="flex flex-col gap-4"
      data-testid="autoreply-form"
      // Our own checks only: the browser's would stop a link without https:// before our message shows.
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm"
          onClick={onCancel}
          data-testid="editor-back"
        >
          {t("replies.back")}
        </button>
        <h1 className="text-xl">
          {t(value.createdAt ? "replies.form.editTitle" : "replies.form.newTitle")}
        </h1>
        <button
          type="submit"
          className="px-btn ms-auto"
          disabled={busy}
          data-testid="autoreply-save"
        >
          {t("replies.saveChanges")}
        </button>
      </div>

      {tried && (noPost || problems.length > 0) && (
        <ul className="text-danger flex flex-col gap-0.5 text-xs" data-testid="autoreply-problems">
          {noPost && <li>{t("replies.problem.noPost")}</li>}
          {problems.map((p) => (
            <li key={p.code}>
              {t(PROBLEM_KEY[p.code], p.max !== undefined ? { max: p.max } : undefined)}
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          {/* Trigger */}
          <section className="px-card flex flex-col gap-2">
            <span className="text-ink-2 text-sm font-bold">{t("replies.form.when")}</span>
            <div
              className="flex flex-col gap-1.5"
              role="radiogroup"
              aria-label={t("replies.form.when")}
            >
              {(["post", "anyPost", "message"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={target === k}
                  onClick={() => setTarget(k)}
                  className="px-inset flex items-center gap-2 text-start text-sm"
                  style={target === k ? { outline: "2px solid var(--accent)" } : undefined}
                  data-testid={`autoreply-target-${k}`}
                >
                  <span aria-hidden>{k === "message" ? "💬" : k === "post" ? "📌" : "📣"}</span>
                  {t(`replies.form.target.${k}`)}
                </button>
              ))}
            </div>
            {target === "post" && <PostGrid posts={tiles} value={draft.postId} onPick={pickPost} />}
          </section>

          {/* Keywords */}
          <section className="px-card flex flex-col gap-2">
            <span className="text-ink-2 text-sm font-bold">{t("replies.form.keywords")}</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {draft.keywords.map((k) => (
                <span
                  key={k}
                  className="px-chip flex items-center gap-1 text-xs"
                  data-testid="autoreply-keyword-chip"
                >
                  {k}
                  <button
                    type="button"
                    aria-label={t("replies.form.removeKeyword", { word: k })}
                    onClick={() => patch({ keywords: draft.keywords.filter((x) => x !== k) })}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                type="text"
                className="px-input min-w-32 flex-1"
                autoComplete="off"
                placeholder="لت, lut"
                aria-label={t("replies.form.keywords")}
                value={word}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/[,،\n]/.test(v)) addWords(v);
                  else setWord(v);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (word.trim()) addWords(word);
                  }
                }}
                onBlur={() => {
                  if (word.trim()) addWords(word);
                }}
                data-testid="autoreply-keyword-input"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                role="switch"
                checked={draft.match === "exact"}
                onChange={(e) => patch({ match: e.target.checked ? "exact" : "contains" })}
                data-testid="autoreply-exact"
              />
              {t("replies.form.exact")}
            </label>
            <span className="text-muted text-xs">{t("replies.form.keywordsHint")}</span>
          </section>

          {/* Public replies (comment rules) */}
          {draft.trigger === "comment" && (
            <section className="px-card flex flex-col gap-2" data-testid="autoreply-public-section">
              <label className="flex items-center gap-2 text-sm font-bold">
                <span className="text-ink-2">{t("replies.form.publicReply")}</span>
                <input
                  type="checkbox"
                  role="switch"
                  className="ms-auto"
                  checked={draft.publicReplies.length > 0}
                  onChange={(e) =>
                    patch({
                      publicReplies: e.target.checked ? [t("replies.form.publicSuggested")] : [],
                    })
                  }
                  data-testid="autoreply-public-on"
                />
              </label>
              {draft.publicReplies.map((r, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input
                    type="text"
                    className="px-input min-w-0 flex-1"
                    dir="auto"
                    aria-label={t("replies.form.publicReply")}
                    value={r}
                    onChange={(e) =>
                      patch({
                        publicReplies: draft.publicReplies.map((x, j) =>
                          j === i ? e.target.value : x,
                        ),
                      })
                    }
                    data-testid={`autoreply-public-${i}`}
                  />
                  <button
                    type="button"
                    className="px-btn px-btn-ghost px-btn-sm"
                    aria-label={t("replies.delete")}
                    onClick={() =>
                      patch({ publicReplies: draft.publicReplies.filter((_, j) => j !== i) })
                    }
                    data-testid={`autoreply-public-remove-${i}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {draft.publicReplies.length > 0 &&
                draft.publicReplies.length < PUBLIC_REPLIES_MAX && (
                  <button
                    type="button"
                    className="px-btn px-btn-ghost px-btn-sm self-start"
                    onClick={() => patch({ publicReplies: [...draft.publicReplies, ""] })}
                    data-testid="autoreply-public-add"
                  >
                    {t("replies.form.addPublic")}
                  </button>
                )}
              <span className="text-muted text-xs">
                {t("replies.form.publicHint", { username: "{username}" })}
              </span>
            </section>
          )}

          {/* The DM */}
          <section className="px-card flex flex-col gap-2">
            <label className="flex flex-col gap-1">
              <span className="flex items-center gap-2 text-sm font-bold">
                <span className="text-ink-2">{t("replies.form.dm")}</span>
                <span
                  className={`num ms-auto text-xs font-normal ${left < 0 ? "text-danger" : "text-muted"}`}
                  data-testid="autoreply-dm-left"
                >
                  {t(left < 0 ? "replies.lettersOver" : "replies.lettersLeft", {
                    n: aboutLetters(left),
                  })}
                </span>
              </span>
              <textarea
                className="px-input min-h-24"
                dir="auto"
                value={draft.dmText}
                onChange={(e) => patch({ dmText: e.target.value })}
                data-testid="autoreply-dm"
              />
            </label>
            <span className="text-ink-2 text-sm font-bold">{t("replies.form.buttons")}</span>
            {draft.buttons.map((b, i) => (
              <div
                key={i}
                className="flex flex-wrap items-center gap-1.5"
                data-testid="autoreply-button"
              >
                <input
                  type="text"
                  className="px-input min-w-28 flex-1"
                  maxLength={BUTTON_TITLE_MAX}
                  placeholder={t("replies.form.buttonTitle")}
                  aria-label={t("replies.form.buttonTitle")}
                  value={b.title}
                  onChange={(e) =>
                    patch({
                      buttons: draft.buttons.map((x, j) =>
                        j === i ? { ...x, title: e.target.value } : x,
                      ),
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
                      buttons: draft.buttons.map((x, j) =>
                        j === i ? { ...x, url: e.target.value } : x,
                      ),
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
            {buttonsLeft > 0 && (
              <button
                type="button"
                className="px-btn px-btn-ghost px-btn-sm self-start"
                onClick={() => patch({ buttons: [...draft.buttons, { title: "", url: "" }] })}
                data-testid="autoreply-add-button"
              >
                {t("replies.form.addButton")}
              </button>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                role="switch"
                checked={draft.followButton}
                disabled={!draft.followButton && buttonsLeft <= 0}
                onChange={(e) => patch({ followButton: e.target.checked })}
                data-testid="autoreply-follow"
              />
              {t("replies.form.follow")}
            </label>
            <span className="text-muted text-xs">{t("replies.form.dmHint")}</span>
          </section>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              role="switch"
              checked={draft.enabled}
              onChange={(e) => patch({ enabled: e.target.checked })}
              data-testid="autoreply-enabled"
            />
            {t("replies.form.enabled")}
          </label>
        </div>

        {/* The preview: beside the form on wide screens (sticky under the top bar), behind a button on phones */}
        <div className="hidden self-start lg:sticky lg:top-[calc(56px+3px+24px)] lg:block">
          {preview}
        </div>
        <details className="px-card lg:hidden">
          <summary
            className="cursor-pointer text-sm font-bold"
            data-testid="autoreply-preview-open"
          >
            {t("replies.preview.open")}
          </summary>
          <div className="mt-2">{preview}</div>
        </details>
      </div>
    </form>
  );
}
