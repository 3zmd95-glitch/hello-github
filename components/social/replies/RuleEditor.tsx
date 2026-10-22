"use client";

import { Check, Megaphone, MessageCircle, Pin, X } from "lucide-react";
import { useState, type ReactNode, type RefObject } from "react";
import Chip from "@/components/ui/ios/Chip";
import { useDraftGuard, useSheetClose } from "@/components/ui/ios/Sheet";
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
import Fold from "./Fold";
import PhonePreview from "./PhonePreview";
import PostGrid, { type PostTile } from "./PostGrid";
import SwitchRow from "./SwitchRow";

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
const TARGETS: readonly Target[] = ["post", "anyPost", "message"];
const TARGET_ICON: Record<Target, ReactNode> = {
  post: <Pin size={20} strokeWidth={1.75} aria-hidden />,
  anyPost: <Megaphone size={20} strokeWidth={1.75} aria-hidden />,
  message: <MessageCircle size={20} strokeWidth={1.75} aria-hidden />,
};
const NO_POST = { postId: null, permalink: undefined, title: undefined, thumbUrl: undefined };

/**
 * The rule editor (Beacons style, round 34; in an iOS sheet since round 35): trigger choices (a chosen post from a
 * thumbnail grid, any post, or a DM / story reply), keywords as chips with an exact-match switch, up to three public
 * replies (comment rules), the DM with its link buttons and the «تابعني» switch, and a live phone preview (beside the
 * form in the desktop dialog, folded on phones). Saving is refused while a problem is listed; the Worker checks the
 * same rules again. A save the Worker took closes the sheet with its exit.
 */
export default function RuleEditor({
  value,
  posts,
  status,
  origin,
  username,
  busy,
  onSave,
  guardRef,
}: {
  value: AutoReply;
  posts: readonly SocialPostStat[];
  status: SocialStatusMap | null;
  origin?: string;
  username?: string;
  busy: boolean;
  onSave: (a: AutoReply) => Promise<boolean>;
  /** The sheet's `beforeClose` ref: an edit asks before a casual dismiss throws it away. */
  guardRef: RefObject<() => boolean>;
}) {
  const { t } = useT();
  const close = useSheetClose();
  const [draft, setDraft] = useState<AutoReply>(value);
  const [choosingPost, setChoosingPost] = useState(
    value.trigger === "comment" && value.postId !== null,
  );
  const [word, setWord] = useState("");
  const [tried, setTried] = useState(false);
  const patch = (p: Partial<AutoReply>) => setDraft((d) => ({ ...d, ...p }));
  // A draft: anything changed from the rule as it opened, or a keyword typed but not added yet.
  const discard = useDraftGuard(
    guardRef,
    word.trim() !== "" || JSON.stringify(draft) !== JSON.stringify(value),
  );

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
    // The DM choice keeps what was typed for a comment (back on a comment choice it is all there); replyInput and the
    // Worker leave the post and the public replies out of a message rule.
    if (next === "message") patch({ trigger: "message" });
    else if (next === "anyPost") patch({ trigger: "comment", ...NO_POST });
    else patch({ trigger: "comment" });
  };
  const pickPost = (p: PostTile) =>
    patch({ postId: p.postId, permalink: p.permalink, title: p.title, thumbUrl: p.thumbUrl });
  const addWords = (text: string) => {
    patch({ keywords: splitKeywords([...draft.keywords, text].join("\n")) });
    setWord("");
  };
  const submit = async () => {
    setTried(true);
    if (noPost || problems.length) return;
    if (await onSave(draft)) close();
  };

  const preview = <PhonePreview rule={draft} origin={origin} username={username} />;
  const remove = (label: string, onClick: () => void, testId: string) => (
    <button
      type="button"
      className="ar-x"
      aria-label={label}
      onClick={onClick}
      data-testid={testId}
    >
      <X size={16} strokeWidth={2} aria-hidden />
    </button>
  );

  return (
    <form
      className="ar-editor flex flex-col gap-5"
      data-testid="autoreply-form"
      // Our own checks only: the browser's would stop a link without https:// before our message shows.
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_16rem] md:items-start">
        <div className="flex min-w-0 flex-col gap-5">
          {/* Trigger */}
          <section className="flex flex-col gap-2">
            <span className="text-ink-2 text-sm font-bold">{t("replies.form.when")}</span>
            <div className="ios-list" role="radiogroup" aria-label={t("replies.form.when")}>
              {TARGETS.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={target === k}
                  onClick={() => setTarget(k)}
                  className="ios-row"
                  data-testid={`autoreply-target-${k}`}
                >
                  <span className="ios-ic">{TARGET_ICON[k]}</span>
                  <span className="ios-tx">
                    <b>{t(`replies.form.target.${k}`)}</b>
                  </span>
                  <Check
                    size={20}
                    strokeWidth={2}
                    className={target === k ? "text-tint" : "invisible"}
                    aria-hidden
                  />
                </button>
              ))}
            </div>
            {target === "post" && <PostGrid posts={tiles} value={draft.postId} onPick={pickPost} />}
          </section>

          {/* Keywords */}
          <section className="flex flex-col gap-2">
            <span className="text-ink-2 text-sm font-bold">{t("replies.form.keywords")}</span>
            {/* 12px between wrapped rows: each chip's ✕ hit area reaches 6px over and under its chip, never into the
                row next to it (globals.css `.ar-chip-x`). */}
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-3">
              {draft.keywords.map((k) => (
                <Chip key={k} className="pe-0.5" data-testid="autoreply-keyword-chip">
                  <span dir="auto">{k}</span>
                  <button
                    type="button"
                    className="ar-chip-x"
                    aria-label={t("replies.form.removeKeyword", { word: k })}
                    onClick={() => patch({ keywords: draft.keywords.filter((x) => x !== k) })}
                  >
                    <X size={12} strokeWidth={2.25} aria-hidden />
                  </button>
                </Chip>
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
            <SwitchRow
              label={t("replies.form.exact")}
              checked={draft.match === "exact"}
              onChange={(on) => patch({ match: on ? "exact" : "contains" })}
              testId="autoreply-exact"
            />
            <span className="text-muted text-xs">{t("replies.form.keywordsHint")}</span>
          </section>

          {/* Public replies (comment rules) */}
          {draft.trigger === "comment" && (
            <section className="flex flex-col gap-2" data-testid="autoreply-public-section">
              <SwitchRow
                label={t("replies.form.publicReply")}
                checked={draft.publicReplies.length > 0}
                onChange={(on) =>
                  patch({ publicReplies: on ? [t("replies.form.publicSuggested")] : [] })
                }
                testId="autoreply-public-on"
              />
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
                  {remove(
                    t("replies.delete"),
                    () => patch({ publicReplies: draft.publicReplies.filter((_, j) => j !== i) }),
                    `autoreply-public-remove-${i}`,
                  )}
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
          <section className="flex flex-col gap-2">
            <label className="flex flex-col gap-1.5">
              <span className="flex items-center justify-between gap-2">
                <span className="text-ink-2 text-sm font-bold">{t("replies.form.dm")}</span>
                <span
                  className={`num text-xs ${left < 0 ? "text-danger" : "text-muted"}`}
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
            <span className="text-ink-2 mt-1 text-sm font-bold">{t("replies.form.buttons")}</span>
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
                {remove(
                  t("replies.delete"),
                  () => patch({ buttons: draft.buttons.filter((_, j) => j !== i) }),
                  `autoreply-button-remove-${i}`,
                )}
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
            <SwitchRow
              label={t("replies.form.follow")}
              checked={draft.followButton}
              onChange={(on) => patch({ followButton: on })}
              disabled={!draft.followButton && buttonsLeft <= 0}
              testId="autoreply-follow"
            />
            <span className="text-muted text-xs">{t("replies.form.dmHint")}</span>
          </section>

          <SwitchRow
            label={t("replies.form.enabled")}
            checked={draft.enabled}
            onChange={(on) => patch({ enabled: on })}
            testId="autoreply-enabled"
          />

          {/* Phones: the preview behind a disclosure row, before Save. */}
          <Fold
            title={t("replies.preview.open")}
            summaryTestId="autoreply-preview-open"
            className="md:hidden"
          >
            {preview}
          </Fold>
        </div>

        {/* The desktop dialog: the preview beside the form, kept in view while the form scrolls. */}
        <div className="hidden md:sticky md:top-0 md:block">{preview}</div>
      </div>

      {tried && (noPost || problems.length > 0) && (
        <ul
          className="text-danger flex flex-col gap-0.5 text-[13px]"
          data-testid="autoreply-problems"
        >
          {noPost && <li>{t("replies.problem.noPost")}</li>}
          {problems.map((p) => (
            <li key={p.code}>
              {t(PROBLEM_KEY[p.code], p.max !== undefined ? { max: p.max } : undefined)}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className="px-btn px-btn-ghost"
          onClick={close}
          data-testid="editor-back"
        >
          {t("common.cancel")}
        </button>
        <button type="submit" className="px-btn" disabled={busy} data-testid="autoreply-save">
          {t("replies.saveChanges")}
        </button>
      </div>
      {discard}
    </form>
  );
}
