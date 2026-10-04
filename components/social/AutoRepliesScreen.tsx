"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import type { AutoReply, AutoReplyLog, ReplyTrigger } from "@/lib/domain";
import { useT, type MessageKey } from "@/lib/i18n";
import { firstMatch, newAutoReply } from "@/lib/replies";
import { timeAgo } from "@/lib/socialSync";
import { postStatsFor, useStore } from "@/store";
import { formatInstant } from "./calendar/dates";
import DefaultReplyEditor from "./replies/DefaultReplyEditor";
import RuleEditor from "./replies/RuleEditor";
import RulesTable from "./replies/RulesTable";
import { checkReplies, deleteReply, saveReply, saveSettings, useReplies } from "./useReplies";
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

/** The configured Worker URL's origin; undefined when unset or not a URL. */
function originOf(url: string | undefined): string | undefined {
  try {
    return new URL(url ?? "").origin;
  } catch {
    return undefined;
  }
}

type Editing = { kind: "rule"; rule: AutoReply } | { kind: "default" } | null;

/**
 * 💬 Auto replies, Beacons style (round 34, planning/tools/14-auto-replies-v2.md): the account with its permission,
 * status and pause switch; the rules table (comment rules, DM and story rules, the default reply) with sends and
 * clicks; a tester and the log folded underneath; a full-page editor. Everything is read from and written to the
 * Scout Worker (`useReplies`), which answers every minute.
 */
export default function AutoRepliesScreen() {
  const { t, lang } = useT();
  const { configured, status, busy: accountBusy, connect } = useSocialSync({ auto: true });
  const { doc, busy, error } = useReplies();
  const postStats = useStore((s) => s.socialPostStats);
  const scoutUrl = useStore((s) => s.settings.apiKeys.scoutUrl);
  const posts = useMemo(
    () => postStatsFor({ socialPostStats: postStats }, "instagram"),
    [postStats],
  );
  const [editing, setEditing] = useState<Editing>(null);
  const [pendingDelete, setPendingDelete] = useState<AutoReply | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The editors are full pages: open them at their top, even when Edit was tapped far down a phone page.
  useEffect(() => {
    if (editing) window.scrollTo(0, 0);
  }, [editing]);

  const ig = status?.instagram;
  const automations = doc?.automations ?? [];
  const username = doc?.ownerUsername ?? ig?.handle;
  // The Worker sizes links with its own origin; the document only records it after a save.
  const origin = doc?.origin ?? originOf(scoutUrl);
  const state: "paused" | "stop" | "slow" | "live" = doc?.paused
    ? "paused"
    : doc?.guard === "stop"
      ? "stop"
      : doc?.guard === "slow"
        ? "slow"
        : "live";

  const saved = () => setNotice(t("replies.notice.saved"));
  const saveRule = async (a: AutoReply) => {
    setNotice(null);
    if (await saveReply(a)) {
      setEditing(null);
      saved();
    }
  };
  const saveDefault = async (d: { enabled: boolean; text: string }) => {
    setNotice(null);
    if (await saveSettings({ defaultReply: d })) {
      setEditing(null);
      saved();
    }
  };
  /** A row's On/Off: never touches an open editor. */
  const toggle = async (a: AutoReply) => {
    setNotice(null);
    if (await saveReply({ ...a, enabled: !a.enabled })) saved();
  };
  /** The default reply's On/Off; without a text yet it opens the editor instead. */
  const toggleDefault = async () => {
    const d = doc?.defaultReply;
    if (!d?.text) return setEditing({ kind: "default" });
    setNotice(null);
    if (await saveSettings({ defaultReply: { enabled: !d.enabled, text: d.text } })) saved();
  };
  const togglePause = async () => {
    setNotice(null);
    await saveSettings({ paused: !doc?.paused });
  };
  const remove = async () => {
    const a = pendingDelete;
    setPendingDelete(null);
    if (!a) return;
    if (await deleteReply(a.id)) setNotice(t("replies.notice.deleted"));
  };
  /** "Check now" asks the Worker for a full read on its next tick; paused or stopped, nothing goes out yet. */
  const check = async () => {
    setNotice(null);
    const fresh = await checkReplies();
    if (!fresh) return;
    setNotice(
      t(
        fresh.paused
          ? "replies.notice.paused"
          : fresh.guard === "stop"
            ? "replies.notice.guard"
            : "replies.notice.scanRequested",
      ),
    );
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-4" data-testid="autoreplies-screen">
        {/* Above the editor: the rule editor is long, and Save is at its top. */}
        {error && (
          <p role="alert" className="text-danger text-xs" data-testid="autoreplies-error">
            {t(error)}
          </p>
        )}
        {editing.kind === "default" ? (
          <DefaultReplyEditor
            value={doc?.defaultReply}
            busy={busy}
            onSave={(d) => void saveDefault(d)}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <RuleEditor
            key={editing.rule.id}
            value={editing.rule}
            posts={posts}
            status={status}
            origin={origin}
            username={username}
            busy={busy}
            onSave={(a) => void saveRule(a)}
            onCancel={() => setEditing(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="autoreplies-screen">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl">{t("replies.hub.title")}</h1>
        <p className="text-ink-2 text-sm">{t("replies.hub.sub")}</p>
      </header>

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
            <p
              className="text-ink-2 min-w-0 flex-1 text-sm"
              data-testid="autoreplies-need-permission"
            >
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
            <span
              aria-hidden
              className="grid h-9 w-9 flex-none place-items-center rounded-full border text-sm font-bold"
            >
              {(username ?? "?").slice(0, 1).toUpperCase()}
            </span>
            <b className="text-sm" dir="ltr">
              @{username ?? "instagram"}
            </b>
            <span
              className={`px-chip text-xs ${state === "live" ? "px-chip-green" : ""}`}
              data-testid="autoreplies-can-reply"
              data-status={state}
            >
              {t(`replies.status.${state}`)}
            </span>
            {doc?.lastPollAt && (
              <span className="text-muted text-xs">
                {t("replies.lastCheck", { ago: timeAgo(doc.lastPollAt, lang) })}
              </span>
            )}
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
            <label className="ms-auto flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                role="switch"
                checked={!!doc?.paused}
                disabled={busy || !doc}
                onChange={() => void togglePause()}
                data-testid="autoreplies-pause"
              />
              {t("replies.pauseAll")}
            </label>
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

      <section className="px-card flex flex-col gap-3" data-testid="autoreplies-list">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base">{t("replies.rules.title")}</h2>
          {configured && (
            <button
              type="button"
              className="px-btn px-btn-sm ms-auto"
              disabled={busy}
              onClick={() => setEditing({ kind: "rule", rule: newAutoReply() })}
              data-testid="autoreplies-new"
            >
              {t("replies.new")}
            </button>
          )}
        </div>
        {doc === null ? (
          // Not read yet: say so while the Worker answers; say nothing when there is no Worker or the read failed.
          configured &&
          busy &&
          !error && (
            <p className="text-muted text-sm" aria-busy data-testid="autoreplies-loading">
              {t("replies.loading")}
            </p>
          )
        ) : (
          <>
            {automations.length === 0 && (
              <p className="text-ink-2 text-sm" data-testid="autoreplies-empty">
                {t("replies.empty")}
              </p>
            )}
            <RulesTable
              automations={automations}
              defaultReply={doc.defaultReply}
              busy={busy}
              errorText={(code) => errorText(t, code)}
              onToggle={(a) => void toggle(a)}
              onEdit={(a) => setEditing({ kind: "rule", rule: a })}
              onDelete={setPendingDelete}
              onToggleDefault={() => void toggleDefault()}
              onEditDefault={() => setEditing({ kind: "default" })}
            />
          </>
        )}
      </section>

      {automations.length > 0 && <Tester automations={automations} />}

      {doc && doc.log.length > 0 && (
        <details className="px-card" data-testid="autoreplies-log">
          <summary className="cursor-pointer text-base">{t("replies.log.title")}</summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {doc.log.map((e) => (
              <LogRow key={`${e.messageId ?? e.commentId}-${e.at}`} e={e} />
            ))}
          </ul>
        </details>
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

/** "Would this comment or message get an answer?", with the Worker's matcher and order. */
function Tester({ automations }: { automations: readonly AutoReply[] }) {
  const { t } = useT();
  const [sample, setSample] = useState("");
  const [trigger, setTrigger] = useState<ReplyTrigger>("comment");
  const match = sample.trim() ? firstMatch(sample, automations, trigger) : undefined;
  return (
    <details className="px-card" data-testid="autoreplies-tester">
      <summary className="cursor-pointer text-base" data-testid="autoreplies-tester-open">
        {t("replies.tester.title")}
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <div
          className="cal-tabs self-start"
          role="radiogroup"
          aria-label={t("replies.tester.title")}
        >
          {(["comment", "message"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              className="cal-tab"
              aria-checked={trigger === k}
              onClick={() => setTrigger(k)}
              data-testid={`autoreplies-tester-${k}`}
            >
              {t(`replies.tester.${k}`)}
            </button>
          ))}
        </div>
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
      </div>
    </details>
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
    <li
      className="px-inset flex flex-col gap-0.5 text-xs"
      data-testid="autoreplies-log-row"
      data-dm={e.dm}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="px-chip text-[0.65rem]" data-testid="autoreplies-log-kind">
          {t(`replies.log.kind.${e.kind}`)}
        </span>
        <b dir="ltr">{e.username ? `@${e.username}` : "—"}</b>
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
