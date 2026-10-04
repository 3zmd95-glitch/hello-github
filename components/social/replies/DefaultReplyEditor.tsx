"use client";

import { useState } from "react";
import type { DefaultReply } from "@/lib/domain";
import { useT, type MessageKey } from "@/lib/i18n";
import {
  aboutLetters,
  defaultReplyProblems,
  DM_TEXT_BYTES,
  utf8Bytes,
  type ReplyProblemCode,
} from "@/lib/replies";

const PROBLEM_KEY: Partial<Record<ReplyProblemCode, MessageKey>> = {
  noDm: "replies.problem.noDm",
  dmTooLong: "replies.problem.dmTooLong",
};

/** The default reply, full page: on/off and its text (DMs that match no rule; once a day per person). */
export default function DefaultReplyEditor({
  value,
  busy,
  onSave,
  onCancel,
}: {
  value: DefaultReply | undefined;
  busy: boolean;
  onSave: (d: { enabled: boolean; text: string }) => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const [enabled, setEnabled] = useState(value?.enabled ?? true);
  const [text, setText] = useState(value?.text || t("replies.default.suggested"));
  const [tried, setTried] = useState(false);
  const problems = defaultReplyProblems({ enabled, text });
  const left = DM_TEXT_BYTES - utf8Bytes(text.trim());
  const letters = aboutLetters(left);

  const submit = () => {
    setTried(true);
    if (!problems.length) onSave({ enabled, text: text.trim() });
  };

  return (
    <form
      className="flex flex-col gap-4"
      data-testid="default-reply-editor"
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
        <h1 className="text-xl">{t("replies.default.title")}</h1>
        <button
          type="submit"
          className="px-btn ms-auto"
          disabled={busy}
          data-testid="default-reply-save"
        >
          {t("replies.saveChanges")}
        </button>
      </div>
      <section className="px-card flex flex-col gap-3">
        <p className="text-ink-2 text-sm">{t("replies.default.hint")}</p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            role="switch"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            data-testid="default-reply-enabled"
          />
          {t("replies.form.enabled")}
        </label>
        <label className="flex flex-col gap-1">
          <span className="flex items-center gap-2 text-sm font-bold">
            <span className="text-ink-2">{t("replies.form.dm")}</span>
            <span
              className={`num ms-auto text-xs font-normal ${left < 0 ? "text-danger" : "text-muted"}`}
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
            className="text-danger flex flex-col gap-0.5 text-xs"
            data-testid="default-reply-problems"
          >
            {problems.map((p) => (
              <li key={p.code}>{t(PROBLEM_KEY[p.code] ?? "replies.problem.noDm")}</li>
            ))}
          </ul>
        )}
      </section>
    </form>
  );
}
