"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useT, type MessageKey } from "@/lib/i18n";
import type { ScoutConfig } from "@/lib/scoutClient";
import {
  probeTikTokAccess,
  readTikTokStoredStatus,
  type TikTokAccessError,
  type TikTokAccessProbe,
} from "@/lib/tiktokAccess";

type Outcome = {
  scope: string;
  phase: "checking" | "probing" | "done";
  stored?: "absent" | "no-advertisers" | "present";
  probe?: TikTokAccessProbe;
  error?: TikTokAccessError;
};
const errorKey: Record<TikTokAccessError, MessageKey> = {
  unconfigured: "feed.tiktokAccessConfig",
  worker_auth: "feed.tiktokAccessWorkerAuth",
  worker_unavailable: "feed.tiktokAccessUpgrade",
  network: "feed.tiktokAccessNetwork",
  timeout: "feed.tiktokAccessTimeout",
  cancelled: "feed.tiktokAccessCancelled",
  malformed: "feed.tiktokAccessMalformed",
  upstream: "feed.tiktokAccessUpstream",
};
const probeKey: Record<TikTokAccessProbe["status"], MessageKey> = {
  accepted: "feed.tiktokAccessAccepted",
  not_connected: "feed.tiktokAccessAbsent",
  auth: "feed.tiktokAccessAuth",
  permission: "feed.tiktokAccessPermission",
  quota: "feed.tiktokAccessQuota",
  upstream: "feed.tiktokAccessUpstream",
  malformed: "feed.tiktokAccessMalformed",
  network: "feed.tiktokAccessNetwork",
  timeout: "feed.tiktokAccessTimeout",
  cancelled: "feed.tiktokAccessCancelled",
};

export default function TikTokNativeAccess({
  config,
  categoryId,
  active,
}: {
  config: ScoutConfig | null;
  categoryId: string;
  active: boolean;
}) {
  const { t, lang } = useT();
  const scope = JSON.stringify([active, categoryId, config?.url, config?.token]);
  const current = useRef(scope);
  const pending = useRef<AbortController | null>(null);
  const [outcome, setOutcome] = useState<Outcome>();
  useLayoutEffect(() => {
    current.current = scope;
    pending.current?.abort();
    pending.current = null;
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [scope]);
  const visible = active && outcome?.scope === scope ? outcome : undefined;
  const busy = visible?.phase === "checking" || visible?.phase === "probing";
  const check = async () => {
    if (!active || !config || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    const isCurrent = () =>
      current.current === scope && pending.current === controller && !controller.signal.aborted;
    setOutcome({ scope, phase: "checking" });
    try {
      const stored = await readTikTokStoredStatus(config, { signal: controller.signal });
      if (!isCurrent()) return;
      if (!stored.ok) {
        setOutcome({ scope, phase: "done", error: stored.error });
        return;
      }
      if (!stored.value.connected || !stored.value.advertisers) {
        setOutcome({
          scope,
          phase: "done",
          stored: stored.value.connected ? "no-advertisers" : "absent",
        });
        return;
      }
      setOutcome({ scope, phase: "probing", stored: "present" });
      const probe = await probeTikTokAccess(config, categoryId, { signal: controller.signal });
      if (!isCurrent()) return;
      setOutcome({
        scope,
        phase: "done",
        stored: "present",
        ...(probe.ok ? { probe: probe.value } : { error: probe.error }),
      });
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  };
  if (!active) return null;
  return (
    <details className="border-edge border-t pt-2 text-xs" data-testid="tiktok-native-access">
      <summary className="px-link w-fit cursor-pointer font-bold">
        {t("feed.tiktokAccessTitle")}
      </summary>
      <div className="mt-2 flex min-w-0 flex-col gap-2">
        <p className="text-muted">{t("feed.tiktokAccessHelp")}</p>
        {!config && <p>{t("feed.tiktokAccessConfig")}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="px-btn px-btn-sm"
            type="button"
            disabled={!config || busy}
            onClick={() => void check()}
            data-testid="tiktok-access-check"
          >
            {t("feed.tiktokAccessCheck")}
          </button>
          {busy && (
            <button
              className="px-link"
              type="button"
              data-testid="tiktok-access-cancel"
              onClick={() => {
                pending.current?.abort();
                pending.current = null;
                setOutcome({ scope, phase: "done", stored: visible?.stored, error: "cancelled" });
              }}
            >
              {t("feed.tiktokAccessCancel")}
            </button>
          )}
        </div>
        {visible && (
          <div role="status" className="flex flex-col gap-1" data-testid="tiktok-access-result">
            {visible.phase === "checking" && <p>{t("feed.tiktokAccessChecking")}</p>}
            {visible.stored && (
              <p>
                {t(
                  visible.stored === "present"
                    ? "feed.tiktokAccessStored"
                    : visible.stored === "no-advertisers"
                      ? "feed.tiktokAccessNoAdvertiser"
                      : "feed.tiktokAccessAbsent",
                )}
              </p>
            )}
            {visible.phase === "probing" && <p>{t("feed.tiktokAccessProbing")}</p>}
            {visible.error && <p>{t(errorKey[visible.error])}</p>}
            {visible.probe && (
              <>
                <p>
                  {t(
                    visible.probe.status === "accepted" && visible.probe.hashtagCount === 0
                      ? "feed.tiktokAccessEmpty"
                      : probeKey[visible.probe.status],
                    { n: visible.probe.hashtagCount ?? 0 },
                  )}
                </p>
                <p className="text-muted">
                  {t("feed.tiktokAccessChecked", {
                    date: new Date(visible.probe.checkedAt).toLocaleString(
                      lang === "ar" ? "ar-SA" : "en-US",
                    ),
                  })}
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
