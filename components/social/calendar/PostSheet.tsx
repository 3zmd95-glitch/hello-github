"use client";

import { Gamepad2 } from "lucide-react";
import { useEffect, useState } from "react";
import { usePublishAutoResync } from "@/components/social/usePublish";
import Chip from "@/components/ui/ios/Chip";
import Segmented from "@/components/ui/ios/Segmented";
import { useSheetClose } from "@/components/ui/ios/Sheet";
import { getSkill } from "@/data";
import { POST_STAGES, type Post, type PostStage } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { stageIndex, suggestStage } from "@/lib/social";
import { useStore } from "@/store";
import AutoPostTab from "./AutoPostTab";
import OverviewTab from "./OverviewTab";
import { PlatformChip, STAGE_KEY, StageChip } from "./PlatformChip";
import ScriptTab from "./ScriptTab";
import SheetFrame from "./SheetFrame";
import ShotsTab from "./ShotsTab";

type Tab = "overview" | "script" | "shots" | "autopost";
const TABS: readonly Tab[] = ["overview", "script", "shots", "autopost"];

/**
 * Post popup (round 17; an iOS sheet since round 35): the post title heads the sheet (the Overview tab edits it), then
 * the platform / stage / linked-skill chips, the 6-step stage stepper with the "suggested" hint, and the Overview ·
 * Script · Shots · Auto-post tabs. Edits go straight to the store, so the popup updates in place (no remount, scroll
 * kept). Closes itself when the post is deleted. Since round 30 the body also keeps a sent auto-post job fresh
 * (`usePublishAutoResync`), whichever tab edits the post. The calendar owns the popup's `#post=` history entry, so Back
 * is not the sheet's own; `leaving` (Back already took that entry) plays the sheet's exit.
 */
export default function PostSheet({
  postId,
  leaving,
  onClose,
}: {
  postId: string;
  leaving: boolean;
  onClose: () => void;
}) {
  const post = useStore((s) => s.posts.find((p) => p.id === postId));
  useEffect(() => {
    if (!post) onClose();
  }, [post, onClose]);
  if (!post) return null;
  return (
    <SheetFrame
      testId="post-sheet"
      titleId={`post-sheet-title-${post.id}`}
      title={post.title}
      onClose={onClose}
      wide
      backCloses={false}
      closeTestId="post-close"
      attrs={{ "data-post": post.id, "data-stage": post.stage, "data-platform": post.platform }}
    >
      {leaving && <CloseNow />}
      <SheetBody post={post} onClose={onClose} />
    </SheetFrame>
  );
}

/** Plays the surrounding sheet's exit as soon as it mounts. */
function CloseNow() {
  const close = useSheetClose();
  useEffect(() => close(), [close]);
  return null;
}

function SheetBody({ post, onClose }: { post: Post; onClose: () => void }) {
  const { t, L } = useT();
  const setPostStage = useStore((s) => s.setPostStage);
  const unmarkPosted = useStore((s) => s.unmarkPosted);
  usePublishAutoResync(post);
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
      <div className="flex flex-wrap items-center gap-1.5">
        <PlatformChip platform={post.platform} />
        <StageChip stage={post.stage} />
        {skill && (
          <Chip icon={<Gamepad2 size={12} aria-hidden />} title={t("calendar.linked")}>
            <span className="max-w-[10rem] truncate">{L(skill.name)}</span>
          </Chip>
        )}
      </div>

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

      <Segmented
        options={TABS.map((tb) => ({
          value: tb,
          label: t(`calendar.sheet.tab.${tb}`),
          testId: `post-tab-${tb}`,
        }))}
        value={tab}
        onChange={setTab}
        label={post.title}
        idPrefix="post-sheet"
      />

      {/* Focusable (APG tabs): Script and Shots open on plain text, not on a control. */}
      <div
        role="tabpanel"
        id={`post-sheet-panel-${tab}`}
        aria-labelledby={`post-sheet-tab-${tab}`}
        tabIndex={0}
      >
        {tab === "overview" && (
          <OverviewTab post={post} skill={skill} urlFocus={urlFocus} onDeleted={onClose} />
        )}
        {tab === "script" && <ScriptTab post={post} />}
        {tab === "shots" && <ShotsTab post={post} />}
        {tab === "autopost" && <AutoPostTab post={post} />}
      </div>
    </>
  );
}
