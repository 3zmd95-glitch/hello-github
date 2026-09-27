"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import { getSkill } from "@/data";
import { POST_STAGES, type Post, type PostStage } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { stageIndex, suggestStage } from "@/lib/social";
import { useStore } from "@/store";
import OverviewTab from "./OverviewTab";
import { PlatformChip, STAGE_KEY, StageChip } from "./PlatformChip";
import ScriptTab from "./ScriptTab";
import SheetFrame from "./SheetFrame";
import ShotsTab from "./ShotsTab";

type Tab = "overview" | "script" | "shots";
const TABS: readonly Tab[] = ["overview", "script", "shots"];

/**
 * Post popup (round 17): header with platform + inline-editable title, the 6-step stage stepper with the
 * "suggested" hint, and the Overview · Script · Shots tabs. Edits go straight to the store, so the popup
 * updates in place (no remount, scroll kept). Closes itself when the post is deleted.
 */
export default function PostSheet({ postId, onClose }: { postId: string; onClose: () => void }) {
  const post = useStore((s) => s.posts.find((p) => p.id === postId));
  useEffect(() => {
    if (!post) onClose();
  }, [post, onClose]);
  if (!post) return null;
  const titleId = `post-sheet-title-${post.id}`;
  return (
    <SheetFrame
      testId="post-sheet"
      titleId={titleId}
      onClose={onClose}
      wide
      attrs={{ "data-post": post.id, "data-stage": post.stage, "data-platform": post.platform }}
    >
      <SheetBody post={post} titleId={titleId} onClose={onClose} />
    </SheetFrame>
  );
}

function SheetBody({
  post,
  titleId,
  onClose,
}: {
  post: Post;
  titleId: string;
  onClose: () => void;
}) {
  const { t, L } = useT();
  const updatePost = useStore((s) => s.updatePost);
  const setPostStage = useStore((s) => s.setPostStage);
  const unmarkPosted = useStore((s) => s.unmarkPosted);
  const [tab, setTab] = useState<Tab>("overview");
  const [urlFocus, setUrlFocus] = useState(0);
  const skill = post.skillId ? getSkill(post.skillId) : undefined;
  const suggested = suggestStage(post);
  const current = stageIndex(post.stage);

  /** The stepper: "posted" is only reached through Mark as posted, so that step jumps to the link input. */
  const pick = (stage: PostStage) => {
    if (stage === "posted") {
      setTab("overview");
      setUrlFocus((n) => n + 1);
      return;
    }
    if (stage === post.stage) return;
    if (post.stage === "posted") unmarkPosted(post.id);
    setPostStage(post.id, stage);
  };

  return (
    <>
      <header className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <PlatformChip platform={post.platform} />
            <StageChip stage={post.stage} />
            {skill && (
              <span className="px-chip" title={t("calendar.linked")}>
                📎🎮 <span className="max-w-[10rem] truncate">{L(skill.name)}</span>
              </span>
            )}
          </div>
          <h2 id={titleId} className="sr-only">
            {post.title}
          </h2>
          <TitleInput
            value={post.title}
            label={t("calendar.form.postTitle")}
            onSave={(title) => updatePost(post.id, { title })}
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="px-btn px-btn-ghost px-btn-sm shrink-0"
          data-testid="post-close"
        >
          ✕
        </button>
      </header>

      <section className="flex flex-col gap-1.5">
        <span className="text-muted text-xs">{t("calendar.sheet.stage")}</span>
        <div className="cal-stepper" role="group" aria-label={t("calendar.sheet.stage")}>
          {POST_STAGES.map((stage, i) => (
            <button
              key={stage}
              type="button"
              className="cal-step"
              aria-pressed={stage === post.stage}
              data-done={i < current}
              onClick={() => pick(stage)}
              data-testid={`post-stage-${stage}`}
            >
              <span className="num">{i + 1}</span> {t(STAGE_KEY[stage])}
            </button>
          ))}
        </div>
        {suggested !== post.stage && (
          <div
            className="px-inset flex flex-wrap items-center gap-2 text-xs"
            data-testid="post-stage-hint"
          >
            <span>💡 {t("calendar.sheet.suggested", { stage: t(STAGE_KEY[suggested]) })}</span>
            <button
              type="button"
              className="px-btn px-btn-sm ms-auto"
              onClick={() => setPostStage(post.id, suggested)}
              data-testid="post-stage-apply"
            >
              {t("calendar.sheet.apply")}
            </button>
          </div>
        )}
      </section>

      <div className="cal-tabs self-start" role="tablist">
        {TABS.map((tb) => (
          <button
            key={tb}
            type="button"
            role="tab"
            className="cal-tab"
            aria-selected={tab === tb}
            onClick={() => setTab(tb)}
            data-testid={`post-tab-${tb}`}
          >
            {t(`calendar.sheet.tab.${tb}`)}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === "overview" && (
          <OverviewTab post={post} skill={skill} urlFocus={urlFocus} onDeleted={onClose} />
        )}
        {tab === "script" && <ScriptTab post={post} />}
        {tab === "shots" && <ShotsTab post={post} />}
      </div>
    </>
  );
}

/** Inline-editable title: commits a non-empty change on blur or Enter, Esc restores. */
function TitleInput({
  value,
  label,
  onSave,
}: {
  value: string;
  label: string;
  onSave: (title: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  // Follow a title change from elsewhere (adjusting state during render, no effect).
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }
  const commit = () => {
    const next = draft.trim();
    if (!next) {
      setDraft(value);
      return;
    }
    if (next !== value) onSave(next);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
      e.currentTarget.blur();
    }
    // Esc closes the sheet (SheetFrame); stop it here so an edit in progress is just reverted.
    if (e.key === "Escape") {
      e.stopPropagation();
      setDraft(value);
      e.currentTarget.blur();
    }
  };
  return (
    <input
      type="text"
      className="cal-title-input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKey}
      aria-label={label}
      autoComplete="off"
      data-testid="post-title-edit"
    />
  );
}
