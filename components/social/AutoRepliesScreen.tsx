"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import type { AutoReply, AutoReplyLog } from "@/lib/domain";
import { useT, type MessageKey } from "@/lib/i18n";
import { ctr, firstMatch, newAutoReply } from "@/lib/replies";
import { timeAgo } from "@/lib/socialSync";
import { postStatsFor, useStore } from "@/store";
import { formatInstant } from "./calendar/dates";
import AutoReplyForm from "./replies/AutoReplyForm";
import { checkReplies, deleteReply, saveReply, useReplies } from "./useReplies";
import { useSocialSync } from "./useSocialSync";

/** Worker error codes → copy (the log's `error`, the document's `lastError`). */
const ERROR_KEY: Record<string, MessageKey> = {
  not_connected: "replies.err.notConnected",
  no_permission: "replies.err.noPermission",
  token_expired: "replies.err.tokenExpired",
  rate_limited: "replies.err.rateLimited",
  rejected: "replies.err.rejected",
  upstream: "replies.err.upstream",
  not_eligible: "replies.err.notEligible",
};

const errorText = (t: (k: MessageKey) => string, code: string | undefined) =>
  code ? t(ERROR_KEY[code] ?? "replies.err.upstream") : "";

/**
 * 💬 Auto replies (a copy of Beacons' Smart Reply): the Instagram account's permission, the automations with
 * their sends / clicks, the builder, a tester for a comment, and the log of what was answered. Everything is
 * read from and written to the Scout Worker (`useReplies`); the Worker does the answering every five minutes.
 */
export default function AutoRepliesScreen() {
  const { t, lang } = useT();
  const { configured, status, busy: accountBusy, connect } = useSocialSync({ auto: true });
  const { doc, busy, error } = useReplies();
  const postStats = useStore((s) => s.socialPostStats);
  const posts = useMemo(() => postStatsFor({ socialPostStats: postStats }, "instagram"), [postStats]);
  const [editing, setEditing] = useState<AutoReply | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AutoReply | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sample, setSample] = useState("");

  const ig = status?.instagram;
  const automations = doc?.automations ?? [];
  const match = sample.trim() ? firstMatch(sample, automations) : undefined;

  /** The builder's Save: closes the editor on success. */
  const save = async (a: AutoReply) => {
    setNotice(null);
    if (await saveReply(a)) {
      setEditing(null);
      setNotice(t("replies.notice.saved"));
    }
  };

  /** A row's On/Off: never touches an open editor (its draft stays). */
  const toggle = async (a: AutoReply) => {
    setNotice(null);
    if (await saveReply({ ...a, enabled: !a.enabled })) setNotice(t("replies.notice.saved"));
  };

  const remove = async () => {
    const a = pendingDelete;
    setPendingDelete(null);
    if (!a) return;
    if (await deleteReply(a.id)) setNotice(t("replies.notice.deleted"));
  };

  const check = async () => {
    setNotice(null);
    const r = await checkReplies();
    if (!r) return;
    setNotice(
      r.skipped === "locked"
        ? t("replies.notice.busy")
        : t("replies.notice.checked", { n: r.checked, sent: r.sent }),
    );
  };

  return (
    <div className="flex flex-col gap-4" data-testid="autoreplies-screen">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl">{t("replies.hub.title")}</h1>
        <p className="text-ink-2 text-sm">{t("replies.hub.sub")}</p>
      </header>

      {/* The account and its permission */}
      <section className="px-card flex flex-col gap-2" data-testid="autoreplies-account">
        {!configured ? (
          <p className="text-ink-2 text-sm" data-testid="autoreplies-need-worker">
            {t("replies.needWorker")}{" "}
            <Link href="/settings#accounts" className="px-link">
              {t("replies.needWorkerLink")}
            </Link>
          </p>
        ) : !ig?.connected ? (
          <p className="text-ink-2 text-sm" data-testid="autoreplies-need-ig">
            {t("replies.needIg")}{" "}
            <Link href="/settings#accounts" className="px-link">
              {t("replies.needWorkerLink")}
            </Link>
          </p>
        ) : !ig.canReply ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-ink-2 min-w-0 flex-1 text-sm" data-testid="autoreplies-need-permission">
              {t("replies.needPermission")}
            </p>
            <button
              type="button"
              className="px-btn px-btn-sm"
              disabled={accountBusy}
              onClick={() => void connect("instagram", true, true)}
              data-testid="autoreplies-allow"
            >
              {t("replies.allow")}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-chip px-chip-green text-xs" data-testid="autoreplies-can-reply">
              {t("replies.canReply")}
            </span>
            <span className="text-muted min-w-0 flex-1 text-xs">
              {t("replies.autoNote")}
              {doc?.lastPollAt ? ` · ${t("replies.lastCheck", { ago: timeAgo(doc.lastPollAt, lang) })}` : ""}
            </span>
            <button
              type="button"
              className="px-btn px-btn-ghost px-btn-sm"
              disabled={busy}
              aria-busy={busy}
              onClick={() => void check()}
              data-testid="autoreplies-check"
            >
              {t("replies.checkNow")}
            </button>
          </div>
        )}
        {doc?.lastError && (
          <p className="text-danger text-xs" data-testid="autoreplies-last-error">
            {errorText(t, doc.lastError)}
          </p>
        )}
        {error && (
          <p role="alert" className="text-danger text-xs" data-testid="autoreplies-error">
            {t(error)}
          </p>
        )}
        {notice && (
          <p className="text-ink-2 text-xs" data-testid="autoreplies-notice">
            {notice}
          </p>
        )}
      </section>

      {/* Automations */}
      <section className="px-card flex flex-col gap-3" data-testid="autoreplies-list">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base">{t("replies.form.title")}</h2>
          {configured && !editing && (
            <button
              type="button"
              className="px-btn px-btn-sm ms-auto"
              disabled={busy}
              onClick={() => setEditing(newAutoReply())}
              data-testid="autoreplies-new"
            >
              {t("replies.new")}
            </button>
          )}
        </div>
        {editing && (
          <AutoReplyForm
            key={editing.id}
            value={editing}
            posts={posts}
            status={status}
            origin={doc?.origin}
            busy={busy}
            onSave={(a) => void save(a)}
            onCancel={() => setEditing(null)}
          />
        )}
        {doc === null ? (
          // Not read yet: say so while the Worker answers; say nothing when there is no Worker or the read failed.
          configured &&
          busy &&
          !error && (
            <p className="text-muted text-sm" aria-busy data-testid="autoreplies-loading">
              {t("replies.loading")}
            </p>
          )
        ) : automations.length === 0 ? (
          !editing && (
            <p className="text-ink-2 text-sm" data-testid="autoreplies-empty">
              {t("replies.empty")}
            </p>
          )
        ) : (
          <ul className="flex flex-col gap-2">
            {automations.map((a) => (
              <ReplyRow
                key={a.id}
                a={a}
                busy={busy}
                onToggle={() => void toggle(a)}
                onEdit={() => setEditing(a)}
                onDelete={() => setPendingDelete(a)}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Tester */}
      {automations.length > 0 && (
        <section className="px-card flex flex-col gap-2" data-testid="autoreplies-tester">
          <h2 className="text-base">{t("replies.tester.title")}</h2>
          <input
            type="text"
            className="px-input"
            autoComplete="off"
            placeholder={t("replies.tester.placeholder")}
            value={sample}
            onChange={(e) => setSample(e.target.value)}
            data-testid="autoreplies-tester-input"
          />
          {sample.trim() && (
            <p
              className={`text-xs ${match ? "text-ink-2" : "text-muted"}`}
              data-testid="autoreplies-tester-result"
              data-match={!!match}
            >
              {match
                ? t("replies.tester.match", { name: match.title ?? match.keywords.join(", ") })
                : t("replies.tester.noMatch")}
            </p>
          )}
        </section>
      )}

      {/* Log */}
      {doc && doc.log.length > 0 && (
        <section className="px-card flex flex-col gap-2" data-testid="autoreplies-log">
          <h2 className="text-base">{t("replies.log.title")}</h2>
          <ul className="flex flex-col gap-1.5">
            {doc.log.map((e) => (
              <LogRow key={`${e.commentId}-${e.at}`} e={e} />
            ))}
          </ul>
        </section>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={t("replies.deleteTitle")}
          body={t("replies.deleteBody")}
          confirmLabel={t("replies.delete")}
          danger
          onConfirm={() => void remove()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

function ReplyRow({
  a,
  busy,
  onToggle,
  onEdit,
  onDelete,
}: {
  a: AutoReply;
  busy: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useT();
  const rate = ctr(a.stats.sends, a.stats.clicks);
  return (
    <li
      className="px-inset flex flex-col gap-1.5"
      data-testid="autoreply-row"
      data-id={a.id}
      data-enabled={a.enabled}
    >
      <div className="flex flex-wrap items-center gap-2">
        {a.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Instagram CDN thumbnail, expires; no loader
          <img src={a.thumbUrl} alt="" className="h-9 w-9 rounded object-cover" />
        ) : (
          <span aria-hidden className="text-lg">
            {a.postId ? "📌" : "📣"}
          </span>
        )}
        <b className="min-w-0 flex-1 truncate text-sm">
          {a.postId ? (
            a.permalink ? (
              <a href={a.permalink} target="_blank" rel="noopener noreferrer" className="px-link">
                {a.title ?? t("replies.table.post")}
              </a>
            ) : (
              (a.title ?? a.postId)
            )
          ) : (
            t("replies.form.anyPost")
          )}
        </b>
        {!a.enabled && <span className="px-chip text-xs">{t("replies.table.off")}</span>}
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={a.enabled}
            disabled={busy}
            onChange={onToggle}
            data-testid="autoreply-toggle"
          />
          {t("replies.form.enabled")}
        </label>
      </div>
      <div className="flex flex-wrap gap-1">
        {a.keywords.map((k) => (
          <span key={k} className="px-chip text-xs" data-testid="autoreply-keyword">
            {k}
          </span>
        ))}
      </div>
      <div className="text-muted num flex flex-wrap items-center gap-3 text-xs">
        <span>
          {t("replies.table.sends")} <b data-testid="autoreply-sends">{a.stats.sends}</b>
        </span>
        <span>
          {t("replies.table.clicks")} <b data-testid="autoreply-clicks">{a.stats.clicks}</b>
        </span>
        <span>
          {t("replies.table.ctr")} <b data-testid="autoreply-ctr">{rate === null ? "–" : `${rate}%`}</b>
        </span>
        {a.stats.lastError && (
          <span className="text-danger" data-testid="autoreply-last-error">
            {errorText(t, a.stats.lastError)}
          </span>
        )}
        <span className="ms-auto flex gap-1">
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            disabled={busy}
            onClick={onEdit}
            data-testid="autoreply-edit"
          >
            {t("replies.edit")}
          </button>
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            disabled={busy}
            onClick={onDelete}
            data-testid="autoreply-delete"
          >
            {t("replies.delete")}
          </button>
        </span>
      </div>
    </li>
  );
}

function LogRow({ e }: { e: AutoReplyLog }) {
  const { t, lang } = useT();
  const dm = e.dm === "sent" ? t("replies.log.dmSent") : t("replies.log.dmFailed");
  const pub =
    e.publicReply === "sent"
      ? t("replies.log.publicSent")
      : e.publicReply === "failed"
        ? t("replies.log.publicFailed")
        : null;
  return (
    <li className="px-inset flex flex-col gap-0.5 text-xs" data-testid="autoreplies-log-row" data-dm={e.dm}>
      <div className="flex flex-wrap items-center gap-2">
        <b>{e.username ? `@${e.username}` : "—"}</b>
        <span className="text-ink-2 min-w-0 flex-1 truncate" dir="auto">
          {e.text}
        </span>
        <span className="text-muted num">{formatInstant(e.at, lang)}</span>
      </div>
      <div className={`flex flex-wrap gap-2 ${e.dm === "failed" ? "text-danger" : "text-muted"}`}>
        <span>{dm}</span>
        {pub && <span>{pub}</span>}
        {e.error && (
          <span>
            {errorText(t, e.error)}
            {e.detail && e.error === "rejected" ? ` («${e.detail}»)` : ""}
          </span>
        )}
      </div>
    </li>
  );
}
