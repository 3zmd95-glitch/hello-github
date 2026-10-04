"use client";

import { useEffect, useId, useState } from "react";
import { useT } from "@/lib/i18n";
import {
  highestEffort,
  localAiConnection,
  localAiStatus,
  type AiChoice,
  type LocalAiStatus,
  type SubscriptionProvider,
} from "@/lib/localAi";

export default function AiConnectionControls({
  value,
  onChange,
}: {
  value: AiChoice;
  onChange: (choice: AiChoice) => void;
}) {
  const { t } = useT();
  const id = useId();
  const [status, setStatus] = useState<LocalAiStatus | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [welcome, setWelcome] = useState(false);
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const next = await localAiStatus();
      if (alive) setStatus(next);
    };
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const connecting = status?.providers.chatgpt.connecting || status?.providers.claude.connecting;
  useEffect(() => {
    if (!connecting) return;
    let alive = true;
    const timer = setInterval(() => {
      void localAiStatus().then((next) => {
        if (alive) setStatus(next);
      });
    }, 2_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [connecting]);

  const chatgpt = status?.providers.chatgpt;
  useEffect(() => {
    if (!chatgpt?.connected || !chatgpt.sharing) return;
    const key = `3z-chatgpt-welcome:${chatgpt.accountId ?? "connected"}`;
    try {
      if (localStorage.getItem(key)) return;
      // Schedule outside rendering; persist dismissal, not merely seeing the connection.
      const timer = setTimeout(() => setWelcome(true), 0);
      return () => clearTimeout(timer);
    } catch {
      /* blocked storage: connection remains usable */
    }
  }, [chatgpt]);

  const provider = value.provider === "builtin" ? null : value.provider;
  const current = provider ? status?.providers[provider] : undefined;
  const selected = current?.models.find((model) => model.id === value.model);
  const connected = current?.connected && (provider !== "chatgpt" || current.sharing);

  useEffect(() => {
    if (
      provider &&
      current &&
      value.model &&
      (!connected || current.accountId !== value.accountId || !selected)
    )
      onChange({ provider, model: "" });
  }, [provider, current, value.model, value.accountId, selected, connected, onChange]);

  const connection = async (action: "connect" | "disconnect", which: SubscriptionProvider) => {
    setBusy(true);
    setFailed(false);
    const ok = await localAiConnection(action, which);
    setFailed(!ok);
    const next = await localAiStatus();
    setStatus(next);
    setBusy(false);
    if (action === "disconnect") onChange({ provider: which, model: "" });
  };
  return (
    <div
      className="border-edge bg-panel-2 flex min-w-0 flex-col gap-2 border-2 p-3 text-xs"
      data-testid="ai-connections"
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-col gap-1" htmlFor={`${id}-provider`}>
          <span>{t("search.aiProvider")}</span>
          <select
            id={`${id}-provider`}
            className="px-input max-w-full py-1"
            value={value.provider}
            data-testid="ai-provider"
            onChange={(event) => {
              setFailed(false);
              onChange({ provider: event.target.value as AiChoice["provider"], model: "" });
            }}
          >
            <option value="builtin">{t("search.aiBuiltin")}</option>
            <option value="chatgpt">ChatGPT</option>
            <option value="claude">Claude</option>
          </select>
        </label>
        {provider && status && (
          <>
            <label className="flex max-w-full min-w-0 flex-col gap-1" htmlFor={`${id}-model`}>
              <span>{t("search.aiModel")}</span>
              <select
                id={`${id}-model`}
                className="px-input max-w-full py-1"
                value={value.model}
                disabled={!connected}
                data-testid="ai-model"
                onChange={(event) => {
                  const model = current?.models.find((item) => item.id === event.target.value);
                  onChange({
                    provider,
                    model: event.target.value,
                    effort: highestEffort(model?.efforts),
                    accountId: current?.accountId,
                  });
                }}
              >
                <option value="">{t("search.chooseModel")}</option>
                {current?.models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            </label>
            {!!selected?.efforts?.length && (
              <label className="flex flex-col gap-1" htmlFor={`${id}-effort`}>
                <span>{t("search.aiEffort")}</span>
                <select
                  id={`${id}-effort`}
                  className="px-input py-1"
                  data-testid="ai-effort"
                  value={value.effort ?? ""}
                  onChange={(event) => onChange({ ...value, effort: event.target.value })}
                >
                  {selected.efforts.map((effort) => (
                    <option key={effort} value={effort}>
                      {effort}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              className="px-btn px-btn-sm"
              disabled={busy || current?.connecting}
              data-testid="ai-connect"
              onClick={() => void connection("connect", provider)}
            >
              {current?.connecting
                ? t("search.signingIn")
                : provider === "chatgpt"
                  ? t("search.continueChatgpt")
                  : t("search.useClaude")}
            </button>
            {current?.connected && (
              <button
                type="button"
                className="px-btn px-btn-ghost px-btn-sm"
                disabled={busy}
                data-testid="ai-disconnect"
                onClick={() => void connection("disconnect", provider)}
              >
                {t("search.disconnectAi")}
              </button>
            )}
          </>
        )}
      </div>
      {!provider ? (
        <p className="text-muted">{t("search.builtinModel")}</p>
      ) : (
        <>
          {status === undefined && <p role="status">{t("search.checkingAi")}</p>}
          {status === null && (
            <p role="status">
              {t("search.localAiUnavailable")} <code>pnpm local</code>
            </p>
          )}
          {status && (
            <>
              <p data-testid="ai-account-status" role="status">
                {connected
                  ? t(provider === "chatgpt" ? "search.usingChatgpt" : "search.usingClaude")
                  : t("search.aiNotConnected")}
                {current?.account && ` · ${current.account}`}
              </p>
              <p className="text-muted">
                {t(provider === "chatgpt" ? "search.chatgptPlanHelp" : "search.claudePlanHelp")}
              </p>
              <p className="text-muted">{t("search.modelHelp")}</p>
              <a
                className="px-link w-fit"
                href={
                  provider === "chatgpt"
                    ? "https://chatgpt.com/settings/usage"
                    : "https://claude.ai/settings/usage"
                }
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("search.manageAiUsage")} ↗
              </a>
            </>
          )}
          {(failed || current?.error) && <p role="alert">{t("search.connectionFailed")}</p>}
        </>
      )}
      {welcome && (
        <div
          role="dialog"
          aria-modal="false"
          aria-labelledby={`${id}-welcome`}
          className="px-tile flex flex-col gap-2 p-3"
          data-testid="chatgpt-welcome"
        >
          <p id={`${id}-welcome`} className="font-bold">
            {t("search.chatgptWelcome")}
          </p>
          <p>{t("search.chatgptWelcomeBody")}</p>
          <button
            type="button"
            className="px-btn px-btn-sm w-fit"
            onClick={() => {
              try {
                localStorage.setItem(
                  `3z-chatgpt-welcome:${status?.providers.chatgpt.accountId ?? "connected"}`,
                  "1",
                );
              } catch {
                /* memory only */
              }
              setWelcome(false);
            }}
          >
            {t("search.gotIt")}
          </button>
        </div>
      )}
    </div>
  );
}
