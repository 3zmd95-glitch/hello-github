"use client";

import { useState, type RefObject } from "react";
import { useDraftGuard, useSheetClose } from "@/components/ui/ios/Sheet";
import type { DefaultReply } from "@/lib/domain";
import { useT, type MessageKey } from "@/lib/i18n";
import {
  aboutLetters,
  defaultReplyProblems,
  DM_TEXT_BYTES,
  utf8Bytes,
  type ReplyProblemCode,
} from "@/lib/replies";
import SwitchRow from "./SwitchRow";

const PROBLEM_KEY: Partial<Record<ReplyProblemCode, MessageKey>> = {
  noDm: "replies.problem.noDm",
  dmTooLong: "replies.problem.dmTooLong",
};

/**
 * The default reply, in an iOS sheet: on/off and its text (DMs that match no rule; once a day per person). A save the
 * Worker took closes the sheet with its exit.
 */
export default function DefaultReplyEditor({
  value,
  busy,
  onSave,
  guardRef,
}: {
  value: DefaultReply | undefined;
  busy: boolean;
  onSave: (d: { enabled: boolean; text: string }) => Promise<boolean>;
  /** The sheet's `beforeClose` ref: an edit asks before a casual dismiss throws it away. */
  guardRef: RefObject<() => boolean>;
}) {
  const { t } = useT();
  const close = useSheetClose();
  // What the sheet opened with (the suggested text when there is none yet): anything else is a draft.
  const [initial] = useState(() => ({
    enabled: value?.enabled ?? true,
    text: value?.text || t("replies.default.suggested"),
  }));
  const [enabled, setEnabled] = useState(initial.enabled);
  const [text, setText] = useState(initial.text);
  const discard = useDraftGuard(guardRef, enabled !== initial.enabled || text !== initial.text);
  const [tried, setTried] = useState(false);
  const problems = defaultReplyProblems({ enabled, text });
  const left = DM_TEXT_BYTES - utf8Bytes(text.trim());
  const letters = aboutLetters(left);

  const submit = async () => {
    setTried(true);
    if (problems.length) return;
    if (await onSave({ enabled, text: text.trim() })) close();
  };

  return (
    <form
      className="ar-editor flex flex-col gap-4"
      data-testid="default-reply-editor"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="text-ink-2 text-[15px]">{t("replies.default.hint")}</p>
      <SwitchRow
        label={t("replies.form.enabled")}
        checked={enabled}
        onChange={setEnabled}
        testId="default-reply-enabled"
      />
      <label className="flex flex-col gap-1.5">
        <span className="flex items-center justify-between gap-2">
          <span className="text-ink-2 text-sm font-bold">{t("replies.form.dm")}</span>
          <span
            className={`num text-xs ${left < 0 ? "text-danger" : "text-muted"}`}
            data-testid="default-reply-left"
          >
            {t(left < 0 ? "replies.lettersOver" : "replies.lettersLeft", { n: letters })}
          </span>
        </span>
        <textarea
          className="px-input min-h-24"
          dir="auto"
          value={text}
          onChange={(e) => setText(e.target.value)}
          data-testid="default-reply-text"
        />
      </label>
      {tried && problems.length > 0 && (
        <ul
          className="text-danger flex flex-col gap-0.5 text-[13px]"
          data-testid="default-reply-problems"
        >
          {problems.map((p) => (
            <li key={p.code}>{t(PROBLEM_KEY[p.code] ?? "replies.problem.noDm")}</li>
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
        <button type="submit" className="px-btn" disabled={busy} data-testid="default-reply-save">
          {t("replies.saveChanges")}
        </button>
      </div>
      {discard}
    </form>
  );
}
