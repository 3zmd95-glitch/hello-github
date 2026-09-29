"use client";

import { useRef, useState } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import type { ApiKeyName, Gear } from "@/lib/domain";
import { useT, type MessageKey } from "@/lib/i18n";
import { youtubeErrorMessageKey, youtubeSearch } from "@/lib/research";
import { isValidScoutUrl, scoutConfig, scoutErrorMessageKey, scoutHealth } from "@/lib/scoutClient";
import { dayKey } from "@/lib/streak";
import { getApiKey, useStore } from "@/store";
import pkg from "@/package.json";
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

export default function SettingsScreen() {
  const { t } = useT();
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);

  const toggleGear = (g: Gear) => {
    const has = settings.gear.includes(g);
    setSettings({ gear: has ? settings.gear.filter((x) => x !== g) : [...settings.gear, g] });
  };

  const exportProgress = () => {
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

  const confirm = () => {
    if (!pending) return;
    if (pending.kind === "reset") {
      useStore.getState().reset();
      setNotice({ text: t("settings.resetOk") });
    } else {
      try {
        useStore.getState().importState(pending.json);
        setNotice({ text: t("settings.importOk") });
      } catch {
        setNotice({ text: t("settings.importErr"), error: true });
      }
    }
    setPending(null);
  };

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl">{t("settings.title")}</h1>
        <p className="text-ink-2 text-sm">{t("settings.sub")}</p>
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

      <Card title={t("settings.data")} note={t("settings.dataNote")}>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="px-btn" onClick={exportProgress} data-testid="export">
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
            onClick={() => setPending({ kind: "reset" })}
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
          body={pending.kind === "reset" ? t("settings.resetConfirm") : t("settings.importConfirm")}
          danger={pending.kind === "reset"}
          onConfirm={confirm}
          onCancel={() => setPending(null)}
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
