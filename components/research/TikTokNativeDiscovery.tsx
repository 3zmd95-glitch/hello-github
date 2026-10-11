"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useT, type MessageKey } from "@/lib/i18n";
import type { ScoutConfig } from "@/lib/scoutClient";
import type { DiscoverItem } from "@/lib/discover";
import { acquireTikTokEdits } from "@/lib/tiktokAccess";

export default function TikTokNativeDiscovery({
  config,
  categoryId,
  active,
  onCandidates,
}: {
  config: ScoutConfig | null;
  categoryId: string;
  active: boolean;
  onCandidates: (items: DiscoverItem[]) => void;
}) {
  const { t } = useT();
  const scope = JSON.stringify([active, categoryId, config?.url, config?.token]);
  const current = useRef(scope);
  const pending = useRef<AbortController | null>(null);
  const [state, setState] = useState<{
    scope: string;
    busy?: boolean;
    done?: boolean;
    message: MessageKey;
    n?: number;
  }>();
  useLayoutEffect(() => {
    current.current = scope;
    pending.current?.abort();
    pending.current = null;
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [scope]);
  const visible = state?.scope === scope ? state : undefined;
  const acquire = async () => {
    if (!active || !config || pending.current || visible?.done) return;
    const controller = new AbortController();
    pending.current = controller;
    const valid = () =>
      current.current === scope && pending.current === controller && !controller.signal.aborted;
    setState({ scope, busy: true, message: "feed.tiktokFindWorking" });
    try {
      const result = await acquireTikTokEdits(config, categoryId, { signal: controller.signal });
      if (!valid()) return;
      if (result.ok && result.value.status === "accepted") {
        onCandidates(result.value.items);
        setState({
          scope,
          done: true,
          message: result.value.items.length ? "feed.tiktokFindResult" : "feed.tiktokFindEmpty",
          n: result.value.items.length,
        });
      } else {
        const code = result.ok ? result.value.status : result.error;
        const message: MessageKey =
          code === "not_connected"
            ? "feed.tiktokAccessAbsent"
            : code === "timeout"
              ? "feed.tiktokAccessTimeout"
              : code === "worker_auth"
                ? "feed.tiktokAccessWorkerAuth"
                : code === "worker_unavailable"
                  ? "feed.tiktokAccessUpgrade"
                  : code === "unconfigured"
                    ? "feed.tiktokAccessConfig"
                    : code === "cancelled"
                      ? "feed.tiktokAccessCancelled"
                      : code === "network"
                        ? "feed.tiktokAccessNetwork"
                        : code === "malformed"
                          ? "feed.tiktokAccessMalformed"
                          : "feed.tiktokAccessUpstream";
        setState({ scope, message });
      }
    } catch {
      if (valid()) setState({ scope, message: "feed.tiktokAccessUpstream" });
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  };
  if (!active) return null;
  return (
    <div
      className="border-edge flex flex-col items-start gap-2 border-t pt-3 text-xs"
      data-testid="tiktok-native-discovery"
    >
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="px-btn px-btn-sm"
          disabled={!config || visible?.busy || visible?.done}
          onClick={() => void acquire()}
          data-testid="tiktok-find-edits"
        >
          {t("feed.tiktokFind")}
        </button>
        {visible?.busy && (
          <button
            type="button"
            className="px-link"
            onClick={() => {
              pending.current?.abort();
              pending.current = null;
              setState({ scope, message: "feed.tiktokAccessCancelled" });
            }}
          >
            {t("feed.tiktokAccessCancel")}
          </button>
        )}
      </div>
      <p className="text-muted">{t("feed.tiktokFindHelp")}</p>
      {visible && (
        <p role="status" data-testid="tiktok-find-result">
          {t(visible.message, { n: visible.n ?? 0 })}
        </p>
      )}
    </div>
  );
}
