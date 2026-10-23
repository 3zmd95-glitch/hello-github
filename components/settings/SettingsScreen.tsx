"use client";

import { useRef, useState } from "react";
import {
  CloudConnect,
  useCloudReads,
  useCloudText,
  useCloudView,
} from "@/components/social/workflows/WorkflowCloud";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { JOURNAL_CAPACITY } from "@/lib/cloudWorkflowJournal";
import { CLOUD_RUNS_MAX, PROOF_CAPACITY, TOMBSTONES_MAX } from "@/lib/cloudWorkflowReconciliation";
import { REGISTRATION_CAPACITY } from "@/lib/cloudWorkflowRegistration";
import type { ApiKeyName, Gear } from "@/lib/domain";
import { useT, type MessageKey } from "@/lib/i18n";
import { youtubeErrorMessageKey, youtubeSearch } from "@/lib/research";
import { isValidScoutUrl, scoutConfig, scoutErrorMessageKey, scoutHealth } from "@/lib/scoutClient";
import { dayKey } from "@/lib/streak";
import {
  cloudJournalRetained,
  getApiKey,
  saveStatus,
  useStore,
  type ImportStateResult,
} from "@/store";
import pkg from "@/package.json";
import { BODY_BYTES_MAX, CONTEXT_BYTES_MAX } from "@/workers/scout/src/social/workflowProtocol";
import AvatarCard from "./AvatarCard";
import Card from "./Card";
import ConnectedAccountsCard from "./ConnectedAccountsCard";
import GenresCard from "./GenresCard";

const GEAR_OPTIONS: readonly Exclude<Gear, "any">[] = [
  "phone",
  "lights",
  "camera",
  "gimbal",
  "mic",
];
const GEAR_ICON: Record<Exclude<Gear, "any">, string> = {
  phone: "📱",
  lights: "💡",
  camera: "📷",
  gimbal: "🎥",
  mic: "🎙️",
};

type Pending = { kind: "import"; json: string } | { kind: "reset" } | null;

/** The honest sentence for a restore that changed nothing (DT-7C-2A adds the cloud journal refusals). */
const IMPORT_FAILED: Record<Exclude<ImportStateResult, { ok: true }>["reason"], MessageKey> = {
  "not-persisted": "settings.importNotSaved",
  "unsupported-save": "settings.importNotSaved",
  "journal-unreadable": "settings.journalUnreadable",
  "journal-invalid": "settings.importErr",
  "journal-conflict": "settings.importJournalRefused",
  "journal-capacity": "settings.importJournalFull",
};

/**
 * The Worker's draft text bound, in UTF-16 units. Not exported by the pinned protocol/snapshot modules (DT-7C-3C
 * record); a Settings test reads the Worker source and fails if this number ever drifts from it.
 */
export const OUTPUT_TEXT_MAX = 4_000;

/** `journal-capacity` names its own limit by scope (registrations 100; reconciliation 600 + 100; no scope: journal). */
function capacityText(
  t: ReturnType<typeof useT>["t"],
  scope: "registrations" | "reconciliation" | undefined,
) {
  if (scope === "registrations")
    return t("settings.importRegistrationsFull", { max: REGISTRATION_CAPACITY });
  if (scope === "reconciliation")
    return t("settings.importReconFull", { proofs: PROOF_CAPACITY, tombstones: TOMBSTONES_MAX });
  return t("settings.importJournalFull", { max: JOURNAL_CAPACITY });
}

export default function SettingsScreen() {
  const { t } = useT();
  const settings = useStore((s) => s.settings);
  const libraryLoading = useStore((s) => s.discoverLibraryStatus === "loading");
  const setSettings = useStore((s) => s.setSettings);
  /** DT-7C-2A-R1: the latest ordinary save was refused (unreadable storage) or not kept; nothing was overwritten. */
  const saveFailed = saveStatus((s) => s.failed);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  /**
   * A restore or reset is on its way (DT-6B-2C-5B-R1, DT-7C-2A): a second Confirm or a Cancel does nothing, and the
   * dialog stays (its button saying so) until the durable result is known.
   */
  const working = useRef(false);
  const [busy, setBusy] = useState(false);
  /** Cloud journal entries a reset keeps (null: unreadable), read when the reset dialog opens. */
  const [retained, setRetained] = useState<number | null>(0);

  const toggleGear = (g: Gear) => {
    const has = settings.gear.includes(g);
    setSettings({ gear: has ? settings.gear.filter((x) => x !== g) : [...settings.gear, g] });
  };

  const exportProgress = () => {
    if (libraryLoading) return;
    const json = useStore.getState().exportState();
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `3z-prod-progress-${dayKey()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice({ text: t("settings.exportOk") });
  };

  const onFile = async (file: File | undefined) => {
    if (!fileRef.current) return;
    fileRef.current.value = "";
    if (!file) return;
    setPending({ kind: "import", json: await file.text() });
  };

  const confirm = async () => {
    if (!pending || working.current) return;
    // Both resolve once their write is read back (or refused); the dialog stays until then.
    working.current = true;
    setBusy(true);
    try {
      if (pending.kind === "reset") {
        const r = await useStore.getState().reset();
        setNotice(
          r.ok
            ? { text: t(r.retained > 0 ? "settings.resetOkRetained" : "settings.resetOk") }
            : {
                text: t(
                  r.reason === "journal-unreadable"
                    ? "settings.journalUnreadable"
                    : "settings.resetNotSaved",
                ),
                error: true,
              },
        );
      } else {
        const r = await useStore.getState().importState(pending.json);
        const retired = r.ok ? (r.retired?.length ?? 0) : 0;
        setNotice(
          r.ok
            ? {
                text: retired
                  ? `${t("settings.importOk")} ${t(retired === 1 ? "settings.importRetired.one" : "settings.importRetired.other", { count: retired })}`
                  : t("settings.importOk"),
              }
            : {
                text:
                  r.reason === "journal-capacity"
                    ? capacityText(t, r.scope)
                    : t(IMPORT_FAILED[r.reason]),
                error: true,
              },
        );
      }
    } catch {
      setNotice({
        text: t(pending.kind === "reset" ? "settings.resetNotSaved" : "settings.importErr"),
        error: true,
      });
    } finally {
      working.current = false;
      setBusy(false);
      setPending(null);
    }
  };

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl">{t("settings.title")}</h1>
        <p className="text-ink-2 text-sm">{t("settings.sub")}</p>
        {saveFailed && (
          <p role="alert" data-testid="save-failed" className="text-danger text-sm font-semibold">
            {t("settings.saveFailed")}
          </p>
        )}
      </header>

      <AvatarCard />

      <Card title={t("settings.lang")}>
        <Segmented
          name="lang"
          value={settings.lang}
          options={[
            { value: "ar", label: "العربي" },
            { value: "en", label: "English" },
          ]}
          onChange={(lang) => setSettings({ lang })}
        />
      </Card>

      <Card title={t("settings.sound")} note={t("settings.soundDesc")}>
        <Segmented
          name="sound"
          value={settings.sound ? "on" : "off"}
          options={[
            { value: "on", label: `🔊 ${t("settings.on")}` },
            { value: "off", label: `🔇 ${t("settings.off")}` },
          ]}
          onChange={(v) => setSettings({ sound: v === "on" })}
        />
      </Card>

      <Card title={t("settings.reminder")} note={t("settings.reminderNote")}>
        <input
          type="time"
          className="px-input num max-w-[160px]"
          value={settings.reminderTime}
          aria-label={t("settings.reminder")}
          onChange={(e) => {
            if (/^([01]\d|2[0-3]):[0-5]\d$/.test(e.target.value))
              setSettings({ reminderTime: e.target.value });
          }}
        />
      </Card>

      <Card title={t("settings.gear")} note={t("settings.gearNote")}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="gear-list">
          {GEAR_OPTIONS.map((g) => {
            const on = settings.gear.includes(g);
            return (
              <label
                key={g}
                className={`px-inset flex items-center gap-2 ${on ? "border-accent" : ""}`}
                data-testid={`gear-${g}`}
              >
                <input
                  type="checkbox"
                  className="size-5 accent-[var(--accent)]"
                  checked={on}
                  onChange={() => toggleGear(g)}
                />
                <span aria-hidden>{GEAR_ICON[g]}</span>
                <span className="font-semibold">{t(`gear.${g}`)}</span>
              </label>
            );
          })}
        </div>
      </Card>

      <GenresCard />

      <ApiKeysCard />

      <CloudWorkflowsCard />

      <ConnectedAccountsCard />

      <Card title={t("settings.davinci")}>
        <Segmented
          name="davinci"
          value={settings.davinciEdition}
          options={[
            { value: "studio", label: t("settings.studio") },
            { value: "free", label: t("settings.free") },
          ]}
          onChange={(davinciEdition) => setSettings({ davinciEdition })}
        />
      </Card>

      <Card id="data" title={t("settings.data")} note={t("settings.dataNote")}>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="px-btn"
            onClick={exportProgress}
            disabled={libraryLoading}
            data-testid="export"
          >
            {t("settings.export")}
          </button>
          <button
            type="button"
            className="px-btn px-btn-ghost"
            onClick={() => fileRef.current?.click()}
          >
            {t("settings.import")}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            data-testid="import-file"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <button
            type="button"
            className="px-btn px-btn-danger"
            onClick={() => {
              setRetained(cloudJournalRetained(useStore.getState()));
              setPending({ kind: "reset" });
            }}
            data-testid="reset"
          >
            {t("settings.reset")}
          </button>
        </div>
        {notice && (
          <p
            role="status"
            className={`text-sm font-semibold ${notice.error ? "text-danger" : "text-accent"}`}
          >
            {notice.text}
          </p>
        )}
      </Card>

      <p className="text-muted text-center text-xs">
        {t("app.name")} · <span className="num">{t("settings.version", { v: pkg.version })}</span>
      </p>

      {pending && (
        <ConfirmDialog
          title={pending.kind === "reset" ? t("settings.resetTitle") : t("settings.importTitle")}
          body={
            pending.kind === "reset"
              ? retained === 0
                ? t("settings.resetConfirm")
                : `${t("settings.resetConfirm")} ${t("settings.resetRetained")}`
              : t("settings.importConfirm")
          }
          confirmLabel={
            busy
              ? t(pending.kind === "reset" ? "settings.resetBusy" : "settings.importBusy")
              : undefined
          }
          danger={pending.kind === "reset"}
          onConfirm={() => void confirm()}
          onCancel={() => {
            if (!working.current) setPending(null);
          }}
        />
      )}
    </>
  );
}

type RowStatus = "unset" | "set" | "ok" | "error";
type TestResult = { ok: true } | { ok: false; msgKey: MessageKey };
type RowTest =
  { status: "idle" | "testing" } | { status: "ok" } | { status: "error"; msgKey: MessageKey };

const SCOUT_README_URL =
  "https://github.com/3zmd95-glitch/hello-github/blob/main/workers/scout/README.md";

async function testYoutubeKey(key: string): Promise<TestResult> {
  const r = await youtubeSearch(key, "match cut");
  return r.ok ? { ok: true } : { ok: false, msgKey: youtubeErrorMessageKey(r.error) };
}

/** Scout "Test": GET /health with the token against the stored Worker URL (read at click time). */
async function testScoutToken(token: string): Promise<TestResult> {
  const config = scoutConfig(useStore.getState().settings.apiKeys.scoutUrl, token);
  if (!config) return { ok: false, msgKey: "settings.scoutErrNoUrl" };
  const r = await scoutHealth(config);
  if (!r.ok) return { ok: false, msgKey: scoutErrorMessageKey(r.error) };
  return r.tavily ? { ok: true } : { ok: false, msgKey: "settings.scoutErrNoTavily" };
}

/**
 * API keys (Scout v0, build plan 1.13; Scout Worker rows 1.14): one card for every provider key the owner
 * may store, each on its own row (input, status chip, optional show/hide and "test" button, a help line).
 * More providers (e.g. an Anthropic key in Sprint 4) are more rows here, not a new card.
 */
function ApiKeysCard() {
  const { t } = useT();
  return (
    <Card id="api-keys" title={t("settings.apiKeys")}>
      <div className="flex flex-col gap-4">
        <ApiKeyRow
          name="youtube"
          label={t("settings.apiYoutubeLabel")}
          placeholder={t("settings.apiYoutubePh")}
          help={t("settings.apiYoutubeHelp")}
          helpLinkLabel={t("settings.apiYoutubeHelpLink")}
          helpLinkHref="https://console.cloud.google.com/apis/library/youtube.googleapis.com"
          test={testYoutubeKey}
        />
        <ApiKeyRow
          name="scoutUrl"
          label={t("settings.apiScoutUrlLabel")}
          placeholder={t("settings.apiScoutUrlPh")}
          help={t("settings.apiScoutUrlHelp")}
          masked={false}
          inputMode="url"
          validate={(v) => (isValidScoutUrl(v) ? null : "settings.apiScoutUrlErr")}
        />
        <ApiKeyRow
          name="scoutToken"
          label={t("settings.apiScoutTokenLabel")}
          placeholder={t("settings.apiScoutTokenPh")}
          help={t("settings.apiScoutTokenHelp")}
          helpLinkLabel={t("settings.apiScoutHelpLink")}
          helpLinkHref={SCOUT_README_URL}
          test={testScoutToken}
        />
      </div>
    </Card>
  );
}

/**
 * Cloud workflows (packet DT-7C-3C): the Worker line (origin, never the token), an explicit Check connection (one
 * handshake per click, nothing on mount), the stored-record counts against their limits, and the size limits. Reads
 * only; nothing here sends anything or switches the cloud on.
 */
function CloudWorkflowsCard() {
  const { t, reason } = useCloudText();
  const view = useCloudView();
  // Inert on the server and during hydration, the stored records right after (see useCloudReads).
  const { counts } = useCloudReads();
  const rows = [
    ["registrations", counts.registrations, REGISTRATION_CAPACITY],
    ["proofs", counts.proofs, PROOF_CAPACITY],
    ["tombstones", counts.tombstones, TOMBSTONES_MAX],
    ["runs", counts.runs, CLOUD_RUNS_MAX],
    ["journal", counts.journal, JOURNAL_CAPACITY],
  ] as const;
  const cfg = view.configured;
  return (
    <Card id="cloud-workflows" title={t("settings.cloud.title")} note={t("settings.cloud.note")}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1" data-testid="settings-cloud-connection">
          {cfg.ok ? (
            <CloudConnect view={view} />
          ) : (
            <p
              className="text-ink-2 text-sm"
              data-testid="settings-cloud-config"
              data-state={cfg.reason}
            >
              {cfg.reason === "none"
                ? t("settings.cloud.none")
                : t("workflows.cloud.connect.bad", { reason: reason(cfg.reason) })}
            </p>
          )}
          {view.authority && view.handshake === "ok" && (
            <p className="text-ink-2 text-xs" data-testid="settings-cloud-owner">
              {t("settings.cloud.owner", { owner: view.authority.ownerKey })}
            </p>
          )}
        </div>
        <dl className="flex flex-col gap-1 text-sm" data-testid="settings-cloud-counts">
          {rows.map(([k, n, max]) => (
            <div
              key={k}
              className="flex flex-wrap justify-between gap-2"
              data-testid={`settings-cloud-count-${k}`}
            >
              <dt>{t(`settings.cloud.count.${k}`)}</dt>
              <dd className="num" dir="ltr" data-value={n ?? "unreadable"}>
                {n === null ? t("settings.cloud.unreadable") : t("settings.cloud.of", { n, max })}
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-muted text-xs" data-testid="settings-cloud-limits">
          {t("settings.cloud.limits", {
            output: OUTPUT_TEXT_MAX,
            context: CONTEXT_BYTES_MAX / 1024,
            body: BODY_BYTES_MAX / 1024,
          })}
        </p>
      </div>
    </Card>
  );
}

function ApiKeyRow({
  name,
  label,
  placeholder,
  help,
  helpLinkLabel,
  helpLinkHref,
  masked = true,
  inputMode,
  validate,
  test,
}: {
  name: ApiKeyName;
  label: string;
  placeholder: string;
  help: string;
  helpLinkLabel?: string;
  helpLinkHref?: string;
  /** Password-style input with a show/hide toggle (default). The Worker URL is a plain input. */
  masked?: boolean;
  inputMode?: "url" | "text";
  /** Returns an error message key for an invalid (non-empty) value; invalid values are never saved. */
  validate?: (value: string) => MessageKey | null;
  test?: (value: string) => Promise<TestResult>;
}) {
  const { t } = useT();
  const stored = useStore((s) => getApiKey(s, name));
  const apiKeys = useStore((s) => s.settings.apiKeys);
  const setSettings = useStore((s) => s.setSettings);
  const [value, setValue] = useState(stored ?? "");
  const [show, setShow] = useState(!masked);
  const [testState, setTestState] = useState<RowTest>({ status: "idle" });

  /** Save the trimmed value (empty clears it). Returns false when validation refused it. */
  const commit = (): boolean => {
    const trimmed = value.trim();
    const invalid = trimmed && validate ? validate(trimmed) : null;
    if (invalid) {
      setTestState({ status: "error", msgKey: invalid });
      return false;
    }
    if (trimmed === (stored ?? "")) return true;
    setSettings({ apiKeys: { ...apiKeys, [name]: trimmed || undefined } });
    return true;
  };

  const runTest = async () => {
    if (!test || !commit()) return;
    const key = value.trim();
    if (!key) return;
    setTestState({ status: "testing" });
    const result = await test(key);
    setTestState(result.ok ? { status: "ok" } : { status: "error", msgKey: result.msgKey });
  };

  const status: RowStatus =
    testState.status === "ok"
      ? "ok"
      : testState.status === "error"
        ? "error"
        : value.trim()
          ? "set"
          : "unset";
  const statusText = {
    ok: t("settings.apiTestedOk"),
    error: t("settings.apiTestedErr"),
    set: t("settings.apiSet"),
    unset: t("settings.apiUnset"),
  }[status];
  const chipStyle =
    status === "ok"
      ? { background: "var(--accent)", color: "var(--accent-ink)" }
      : status === "error"
        ? { background: "var(--danger)", color: "#2a0a06" }
        : undefined;

  return (
    <div className="flex flex-col gap-2" data-testid={`apikey-${name}`}>
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-sm">{label}</b>
        <span className="px-chip" style={chipStyle} data-testid={`apikey-${name}-status`}>
          {statusText}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type={show ? "text" : "password"}
          inputMode={inputMode}
          dir="ltr"
          autoComplete="off"
          spellCheck={false}
          className="px-input min-w-[180px] flex-1"
          placeholder={placeholder}
          aria-label={label}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setTestState({ status: "idle" });
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          data-testid={`apikey-${name}-input`}
        />
        {masked && (
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            onClick={() => setShow((s) => !s)}
            data-testid={`apikey-${name}-show`}
          >
            {show ? t("settings.apiHide") : t("settings.apiShow")}
          </button>
        )}
        {test && (
          <button
            type="button"
            className="px-btn px-btn-sm"
            onClick={runTest}
            disabled={testState.status === "testing" || !value.trim()}
            data-testid={`apikey-${name}-test`}
          >
            {t("settings.apiTest")}
          </button>
        )}
      </div>
      {testState.status === "error" && (
        <p role="alert" className="text-danger text-xs" data-testid={`apikey-${name}-error`}>
          {t(testState.msgKey)}
        </p>
      )}
      <p className="text-muted text-xs">
        {help}
        {helpLinkHref && helpLinkLabel && (
          <>
            {" "}
            <a href={helpLinkHref} target="_blank" rel="noopener noreferrer" className="px-link">
              {helpLinkLabel}
            </a>
          </>
        )}
      </p>
    </div>
  );
}

function Segmented<V extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: V;
  options: { value: V; label: string }[];
  onChange: (v: V) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={name}
      className="border-edge bg-edge flex w-fit max-w-full flex-wrap gap-[2px] rounded-[2px] border-2"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`px-4 py-1.5 text-sm font-bold ${value === o.value ? "bg-gold text-gold-ink" : "bg-panel-2 text-ink-2"}`}
          data-testid={`${name}-${o.value}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
