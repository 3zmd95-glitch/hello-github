"use client";

import { useState } from "react";
import type { ApiKeyName } from "@/lib/domain";
import { useT, type MessageKey } from "@/lib/i18n";
import { youtubeErrorMessageKey, youtubeSearch } from "@/lib/research";
import { isValidScoutUrl, scoutConfig, scoutErrorMessageKey, scoutHealth } from "@/lib/scoutClient";
import { getApiKey, useStore } from "@/store";
import Card from "./Card";

type RowStatus = "unset" | "set" | "ok" | "error";
type TestResult = { ok: true } | { ok: false; msgKey: MessageKey };
type RowTest =
  { status: "idle" | "testing" } | { status: "ok" } | { status: "error"; msgKey: MessageKey };

const SCOUT_README_URL =
  "https://github.com/3zmd95-glitch/hello-github/blob/main/workers/scout/README.md";

const ALL_ROWS: readonly ApiKeyName[] = ["youtube", "scoutUrl", "scoutToken"];

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
 * More providers (e.g. an Anthropic key in Sprint 4) are more rows here, not a new card. `rows` picks the
 * rows a page shows: Training shows all three, Social settings (tools/20) the Worker URL and token only.
 */
export default function ApiKeysCard({ rows = ALL_ROWS }: { rows?: readonly ApiKeyName[] }) {
  const { t } = useT();
  return (
    <Card id="api-keys" title={t("settings.apiKeys")}>
      <div className="flex flex-col gap-4">
        {rows.includes("youtube") && (
          <ApiKeyRow
            name="youtube"
            label={t("settings.apiYoutubeLabel")}
            placeholder={t("settings.apiYoutubePh")}
            help={t("settings.apiYoutubeHelp")}
            helpLinkLabel={t("settings.apiYoutubeHelpLink")}
            helpLinkHref="https://console.cloud.google.com/apis/library/youtube.googleapis.com"
            test={testYoutubeKey}
          />
        )}
        {rows.includes("scoutUrl") && (
          <ApiKeyRow
            name="scoutUrl"
            label={t("settings.apiScoutUrlLabel")}
            placeholder={t("settings.apiScoutUrlPh")}
            help={t("settings.apiScoutUrlHelp")}
            masked={false}
            inputMode="url"
            validate={(v) => (isValidScoutUrl(v) ? null : "settings.apiScoutUrlErr")}
          />
        )}
        {rows.includes("scoutToken") && (
          <ApiKeyRow
            name="scoutToken"
            label={t("settings.apiScoutTokenLabel")}
            placeholder={t("settings.apiScoutTokenPh")}
            help={t("settings.apiScoutTokenHelp")}
            helpLinkLabel={t("settings.apiScoutHelpLink")}
            helpLinkHref={SCOUT_README_URL}
            test={testScoutToken}
          />
        )}
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
