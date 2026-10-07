"use client";

import { FlaskConical, History, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useCelebrate } from "@/components/celebrate/CelebrationProvider";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Chip from "@/components/ui/ios/Chip";
import { ListGroup, ListRow } from "@/components/ui/ios/List";
import PageHeader from "@/components/ui/ios/PageHeader";
import PlatformBadge from "@/components/ui/ios/PlatformBadge";
import Segmented from "@/components/ui/ios/Segmented";
import Sheet from "@/components/ui/ios/Sheet";
import Switch from "@/components/ui/ios/Switch";
import type { AutoReply, AutoReplyLog, ReplyTrigger } from "@/lib/domain";
import { useT, type MessageKey } from "@/lib/i18n";
import { firstMatch, newAutoReply } from "@/lib/replies";
import { timeAgo } from "@/lib/socialSync";
import { postStatsFor, useStore } from "@/store";
import { formatInstant } from "./calendar/dates";
import DefaultReplyEditor from "./replies/DefaultReplyEditor";
import Fold from "./replies/Fold";
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
type State = "paused" | "stop" | "slow" | "live";

/** The account row's status line: green while it answers, warn while the free-storage guard slows or stops it. */
const STATE_TONE: Record<State, string> = {
  live: "text-tint",
  paused: "text-ink-2",
  slow: "text-warn",
  stop: "text-warn",
};

/**
 * Auto replies, Beacons style (round 34, planning/tools/14-auto-replies-v2.md) in the iOS look (round 35): the
 * account with its permission, status and pause switch; the rules as a grouped list (comment rules, DM and story
 * rules, the default reply) with sends and clicks; a tester and the log folded underneath; the editors in a sheet.
 * Everything is read from and written to the Scout Worker (`useReplies`), which answers every minute.
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
  const { toast } = useCelebrate();

  const ig = status?.instagram;
  const automations = doc?.automations ?? [];
  const username = doc?.ownerUsername ?? ig?.handle;
  // The Worker sizes links with its own origin; the document only records it after a save.
  const origin = doc?.origin ?? originOf(scoutUrl);
  const state: State = doc?.paused
    ? "paused"
    : doc?.guard === "stop"
      ? "stop"
      : doc?.guard === "slow"
        ? "slow"
        : "live";
  // Not read yet: say so while the Worker answers; say nothing when there is no Worker or the read failed.
  const loading = configured && busy && !error;

  const saved = () => setNotice(t("replies.notice.saved"));
  /**
   * The editors close themselves (with the sheet's exit) once this says the Worker took it. The page behind the sheet
   * never moves, so a toast confirms the save wherever the owner is.
   */
  const savedToast = (ok: boolean) => {
    if (ok) toast("notice", { name: t("replies.toast.saved") });
    return ok;
  };
  const saveRule = async (a: AutoReply) => {
    setNotice(null);
    return savedToast(await saveReply(a));
  };
  const saveDefault = async (d: { enabled: boolean; text: string }) => {
    setNotice(null);
    return savedToast(await saveSettings({ defaultReply: d }));
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

  const settingsLink = (
    <Link href="/settings#accounts" className="px-link">
      {t("replies.needWorkerLink")}
    </Link>
  );

  return (
    <div className="flex flex-col gap-4" data-testid="autoreplies-screen">
      <PageHeader title={t("replies.hub.title")} sub={t("replies.hub.sub")} />

      <section className="flex flex-col gap-1.5" data-testid="autoreplies-account">
        <div className="ios-list">
          {!configured ? (
            <div className="ios-row">
              <PlatformBadge platform="instagram" />
              <p className="min-w-0 flex-1 text-[15px]" data-testid="autoreplies-need-worker">
                {t("replies.needWorker")} {settingsLink}
              </p>
            </div>
          ) : !ig?.connected ? (
            <div className="ios-row">
              <PlatformBadge platform="instagram" />
              <p className="min-w-0 flex-1 text-[15px]" data-testid="autoreplies-need-ig">
                {t("replies.needIg")} {settingsLink}
              </p>
            </div>
          ) : !ig.canReply ? (
            <div className="ios-row flex-wrap">
              <PlatformBadge platform="instagram" />
              <p
                className="min-w-[10rem] flex-1 text-[15px]"
                data-testid="autoreplies-need-permission"
              >
                {t("replies.needPermission")}
              </p>
              <button
                type="button"
                className="px-btn px-btn-sm ms-auto"
                disabled={accountBusy}
                onClick={() => void connect("instagram", true, true)}
                data-testid="autoreplies-allow"
              >
                {t("replies.allow")}
              </button>
            </div>
          ) : (
            <>
              <ListRow
                iconRaw={<PlatformBadge platform="instagram" />}
                title={<bdi dir="ltr">@{username ?? "instagram"}</bdi>}
                sub={
                  <>
                    <span
                      className={STATE_TONE[state]}
                      data-testid="autoreplies-can-reply"
                      data-status={state}
                    >
                      {t(`replies.status.${state}`)}
                    </span>
                    {doc?.lastPollAt &&
                      ` · ${t("replies.lastCheck", { ago: timeAgo(doc.lastPollAt, lang) })}`}
                  </>
                }
                trailing={
                  <button
                    type="button"
                    className="px-btn px-btn-ghost px-btn-sm shrink-0"
                    disabled={busy}
                    aria-busy={busy}
                    onClick={() => void check()}
                    data-testid="autoreplies-check"
                  >
                    {t("replies.checkNow")}
                  </button>
                }
              />
              <ListRow
                title={t("replies.pauseAll")}
                trailing={
                  <Switch
                    checked={!!doc?.paused}
                    onChange={() => void togglePause()}
                    label={t("replies.pauseAll")}
                    disabled={busy || !doc}
                    testId="autoreplies-pause"
                  />
                }
              />
            </>
          )}
        </div>
        {doc?.lastError && (
          <p className="text-danger px-4 text-[13px]" data-testid="autoreplies-last-error">
            {errorText(t, doc.lastError)}
          </p>
        )}
        {doc?.lastError && doc.lastErrorDetail && (
          <p
            className="text-muted px-4 text-[13px] break-words"
            dir="auto"
            data-testid="autoreplies-last-error-detail"
          >
            {doc.lastErrorDetail}
          </p>
        )}
        {/* While an editor is open, its sheet shows the error instead. */}
        {error && !editing && (
          <p role="alert" className="text-danger px-4 text-[13px]" data-testid="autoreplies-error">
            {t(error)}
          </p>
        )}
        {notice && (
          <p className="text-ink-2 px-4 text-[13px]" data-testid="autoreplies-notice">
            {notice}
          </p>
        )}
      </section>

      {(doc || loading) && (
        <ListGroup
          header={t("replies.rules.title")}
          trailing={
            configured && (
              <button
                type="button"
                className="px-btn px-btn-sm"
                disabled={busy}
                onClick={() => setEditing({ kind: "rule", rule: newAutoReply() })}
                data-testid="autoreplies-new"
              >
                {t("replies.new")}
              </button>
            )
          }
          testId="autoreplies-list"
          listAs="ul"
          className="ar-rules"
        >
          {doc ? (
            <>
              {automations.length === 0 && (
                <li className="ios-row">
                  <span className="ios-ic fill">
                    <MessageCircle size={20} strokeWidth={1.75} aria-hidden />
                  </span>
                  <p
                    className="text-ink-2 min-w-0 flex-1 text-[15px]"
                    data-testid="autoreplies-empty"
                  >
                    {t("replies.empty")}
                  </p>
                </li>
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
          ) : (
            <li className="ios-row" data-sep="16">
              <p className="text-muted text-[15px]" aria-busy data-testid="autoreplies-loading">
                {t("replies.loading")}
              </p>
            </li>
          )}
        </ListGroup>
      )}

      {automations.length > 0 && <Tester automations={automations} />}

      {doc && doc.log.length > 0 && (
        <Fold
          icon={<History size={20} strokeWidth={1.75} aria-hidden />}
          title={t("replies.log.title")}
          testId="autoreplies-log"
        >
          <ul className="flex flex-col gap-1.5">
            {doc.log.map((e) => (
              <LogRow key={`${e.messageId ?? e.commentId}-${e.at}`} e={e} />
            ))}
          </ul>
        </Fold>
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

      {editing && (
        <Sheet
          onClose={() => setEditing(null)}
          title={t(
            editing.kind === "default"
              ? "replies.default.title"
              : editing.rule.createdAt
                ? "replies.form.editTitle"
                : "replies.form.newTitle",
          )}
          titleId="autoreply-sheet-title"
          testId="autoreply-sheet"
          detents={[0.92]}
          wide={editing.kind === "rule"}
        >
          {editing.kind === "default" ? (
            <DefaultReplyEditor value={doc?.defaultReply} busy={busy} onSave={saveDefault} />
          ) : (
            <RuleEditor
              key={editing.rule.id}
              value={editing.rule}
              posts={posts}
              status={status}
              origin={origin}
              username={username}
              busy={busy}
              onSave={saveRule}
            />
          )}
          {/* Under Save: why the Worker refused it. */}
          {error && (
            <p role="alert" className="text-danger text-[13px]" data-testid="autoreplies-error">
              {t(error)}
            </p>
          )}
        </Sheet>
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
    <Fold
      icon={<FlaskConical size={20} strokeWidth={1.75} aria-hidden />}
      title={t("replies.tester.title")}
      testId="autoreplies-tester"
      summaryTestId="autoreplies-tester-open"
    >
      <Segmented
        role="radiogroup"
        label={t("replies.tester.title")}
        value={trigger}
        onChange={setTrigger}
        options={(["comment", "message"] as const).map((k) => ({
          value: k,
          label: t(`replies.tester.${k}`),
          testId: `autoreplies-tester-${k}`,
        }))}
      />
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
          className={`text-[13px] ${match ? "text-tint font-semibold" : "text-muted"}`}
          data-testid="autoreplies-tester-result"
          data-match={!!match}
        >
          {match
            ? t("replies.tester.match", { name: match.title ?? match.keywords.join(", ") })
            : t("replies.tester.noMatch")}
        </p>
      )}
    </Fold>
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
      className="px-inset flex flex-col gap-1 text-xs"
      data-testid="autoreplies-log-row"
      data-dm={e.dm}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Chip data-testid="autoreplies-log-kind">{t(`replies.log.kind.${e.kind}`)}</Chip>
        <b dir="ltr">{e.username ? `@${e.username}` : "—"}</b>
        <span className="text-ink-2 min-w-0 flex-1 truncate" dir="auto">
          {e.text}
        </span>
        <span className="text-muted tabular-nums">{formatInstant(e.at, lang)}</span>
      </div>
      <div className={`flex flex-wrap gap-2 ${e.dm === "failed" ? "text-danger" : "text-muted"}`}>
        <span>{dm}</span>
        {pub && <span>{pub}</span>}
        {e.error && (
          <span>
            {errorText(t, e.error)}
            {e.detail ? ` («${e.detail}»)` : ""}
          </span>
        )}
      </div>
    </li>
  );
}
