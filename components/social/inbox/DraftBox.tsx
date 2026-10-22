"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useT, type MessageKey } from "@/lib/i18n";
import { INBOX_DRAFT_MAX, validDraft, type CommentProvider } from "@/lib/inbox";
import { inboxDraftBase, useStore, type InboxDraft, type InboxDraftResult } from "@/store";
import SendReview, { type ReplyTarget } from "./SendReview";
import InstagramDmSendReview, { type DmReplyTarget } from "./InstagramDmSendReview";
import InstagramSendReview, { type InstagramReplyTarget } from "./InstagramSendReview";
import ThreadsSendReview, { type ThreadsReplyTarget } from "./ThreadsSendReview";
import { onInstagramDmDraftCleared } from "./useInstagramDmSend";
import { onInstagramDraftCleared } from "./useInstagramSend";
import { onThreadsDraftCleared } from "./useThreadsSend";

type Status =
  | "saved"
  | "earlierSaved"
  | "copied"
  | "copyFailed"
  | "discarded"
  | "conflict"
  | "notPersisted"
  | "unsupported"
  | "invalid";

const FAILURE: Record<string, Status> = {
  conflict: "conflict",
  "not-persisted": "notPersisted",
  "unsupported-save": "unsupported",
  invalid: "invalid",
};

/**
 * A private reply draft for one conversation or comment (packet DT-6A): Save (one locked store commit, proven by
 * its read-back), Copy (the owner pastes it in Instagram himself) and Discard. Nothing here touches the network.
 * The parent mounts one box per scope (`key={scope}`), so a box's session is its mount: a save or copy only
 * acknowledges in the session it started in, and "saved" / "copied" only while the text is still what was submitted.
 * DT-6B-2A: a YouTube box with a send target also offers "Send as public reply" (SendReview: review, then an explicit
 * Send); Save, Copy and Discard stay exactly as they were and never send.
 * DT-6B-2B-2: a Threads box with a send target (or a stored operation) also shows the Threads review / recovery controls
 * (ThreadsSendReview: disabled with the reason while Threads sending is unverified; Check status always).
 * DT-6B-2B-2-R1 (2B2-4): a Threads "Clear draft" from any opener (this row or the recovery list) reaches this editor through
 * onThreadsDraftCleared, matched by scope and exact revision; Instagram and YouTube scopes never match it.
 * DT-6B-2C-4: an Instagram comment box with a target also shows the public-reply review / recovery controls
 * (InstagramSendReview: disabled with the reason while unverified; Check status always); its "Clear draft" reaches this
 * editor through onInstagramDraftCleared, matched the same way.
 * DT-6B-2C-5A: an Instagram conversation box also shows the DM review / recovery controls for the explicitly selected
 * inbound message (InstagramDmSendReview: disabled with the reason while unverified; Check status always); its "Clear
 * draft" reaches this editor through onInstagramDmDraftCleared, matched by the conversation scope and exact revision.
 */
export default function DraftBox({
  scope,
  provider,
  send,
  threadsSend,
  igSend,
  dmSend,
}: {
  scope: string;
  /** Threads / YouTube (DT-6B-1): "Copied" names where to paste. */
  provider?: CommentProvider;
  /** YouTube (DT-6B-2A): where a reviewed public reply would go. */
  send?: ReplyTarget;
  /** Threads (DT-6B-2B-2): where a reviewed reply would go. */
  threadsSend?: ThreadsReplyTarget;
  /** Instagram comments (DT-6B-2C-4): where a reviewed public reply would go. */
  igSend?: InstagramReplyTarget;
  /** Instagram conversations (DT-6B-2C-5A): the selected inbound message a reviewed DM would answer (null: none yet). */
  dmSend?: { target: DmReplyTarget | null };
}) {
  const { t } = useT();
  const stored = useStore((s) => s.inboxDrafts[scope]);
  const [text, setText] = useState(stored?.text ?? "");
  const [base, setBase] = useState(() => inboxDraftBase(stored));
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const textRef = useRef(text);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const edit = (v: string) => {
    textRef.current = v;
    setText(v);
    setStatus(null);
  };

  const run = async (
    write: () => Promise<InboxDraftResult>,
    done: (r: InboxDraftResult) => void,
  ) => {
    if (busy) return;
    setBusy(true);
    const r = await write();
    if (!alive.current) return;
    setBusy(false);
    if (r.ok) done(r);
    else setStatus(FAILURE[r.reason] ?? "notPersisted");
  };

  const save = () => {
    const submitted = text;
    return run(
      () => useStore.getState().saveInboxDraft(scope, submitted, base),
      (r) => {
        if (!r.ok) return;
        setBase(inboxDraftBase(r.draft));
        setStatus(textRef.current === submitted ? "saved" : "earlierSaved");
      },
    );
  };

  // DT-6A-R1 (6A-1): the editor clears only if it still holds the text Discard was pressed on; newer input stays and,
  // with the base now "no draft", remains saveable.
  const discard = () => {
    const submitted = text;
    return run(
      () => useStore.getState().discardInboxDraft(scope, base),
      () => {
        setBase(inboxDraftBase(null));
        if (textRef.current === submitted) edit("");
        setStatus("discarded");
      },
    );
  };

  // DT-6B-2A-R1 (2A-9): after Send, "Clear draft" discarded the sent revision. This editor stops building on it (a new
  // Save goes against "no draft"), and clears only if it still shows that text; newer typing stays.
  const cleared = (d: InboxDraft) => {
    if (!alive.current) return;
    setBase((b) => (b.commitId === d.commitId ? inboxDraftBase(null) : b));
    if (textRef.current === d.text) edit("");
    setStatus("discarded");
  };
  const hear = useEffectEvent((s: string, d: InboxDraft) => {
    if (s === scope) cleared(d);
  });
  useEffect(() => onThreadsDraftCleared((s, d) => hear(s, d)), []);
  useEffect(() => onInstagramDraftCleared((s, d) => hear(s, d)), []);
  useEffect(() => onInstagramDmDraftCleared((s, d) => hear(s, d)), []);

  const copy = async () => {
    const submitted = text;
    let next: Status = "copied";
    try {
      await navigator.clipboard.writeText(submitted);
    } catch {
      next = "copyFailed";
    }
    if (alive.current && (next !== "copied" || textRef.current === submitted)) setStatus(next);
  };

  const tooLong = !validDraft(text);
  return (
    <section className="ios-list flex flex-col gap-2 p-3" data-testid="ibx-draft">
      <label className="flex min-w-0 flex-col gap-1">
        <span className="text-ink-2 text-[13px] font-semibold">{t("inbox.draft.label")}</span>
        <textarea
          className="px-input min-h-28"
          dir="auto"
          value={text}
          onChange={(e) => edit(e.target.value)}
          data-testid="ibx-draft-text"
        />
      </label>
      <p className={`text-[13px] ${tooLong ? "text-danger" : "text-muted"}`} aria-live="polite">
        {t("inbox.draft.count", { n: text.length, max: INBOX_DRAFT_MAX })}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="px-btn px-btn-sm"
          disabled={busy || tooLong || !text.trim()}
          onClick={() => void save()}
          data-testid="ibx-draft-save"
        >
          {t("inbox.draft.save")}
        </button>
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm"
          disabled={!text}
          onClick={() => void copy()}
          data-testid="ibx-draft-copy"
        >
          {t("inbox.draft.copy")}
        </button>
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm"
          disabled={busy || base.commitId === null}
          onClick={() => void discard()}
          data-testid="ibx-draft-discard"
        >
          {t("inbox.draft.discard")}
        </button>
      </div>
      {provider === "youtube" && send && (
        <SendReview
          scope={scope}
          target={send}
          draft={{ text, saved: stored }}
          onCleared={cleared}
        />
      )}
      {provider === "threads" && threadsSend && (
        <ThreadsSendReview scope={scope} target={threadsSend} draft={{ text, saved: stored }} />
      )}
      {!provider && igSend && (
        <InstagramSendReview scope={scope} target={igSend} draft={{ text, saved: stored }} />
      )}
      {!provider && dmSend && (
        <InstagramDmSendReview target={dmSend.target} draft={{ text, saved: stored }} />
      )}
      <p
        className={`text-[13px] ${status && !["saved", "copied", "discarded"].includes(status) ? "text-danger" : "text-ink-2"}`}
        role="status"
        data-testid="ibx-draft-status"
        data-state={status ?? "idle"}
      >
        {status
          ? t(
              (provider && status === "copied"
                ? `inbox.draft.copied.${provider}`
                : `inbox.draft.${status}`) as MessageKey,
            )
          : ""}
      </p>
    </section>
  );
}
