"use client";

import Link from "next/link";
import { useState } from "react";
import { useT, type MessageKey } from "@/lib/i18n";
import { timeAgo } from "@/lib/socialSync";
import {
  TOOL_GROUPS,
  searchTools,
  toolContext,
  type ToolContext,
  type ToolDef,
  type ToolReadiness,
} from "@/lib/tools";
import { useStore } from "@/store";

/** Label of the small action link per state; states without one need nothing from the owner. */
const ACTION: Partial<Record<ToolReadiness, MessageKey>> = {
  setup: "tools.setup",
  attention: "tools.check",
  unknown: "tools.check",
  lastKnown: "tools.verify",
};

const DANGER = { background: "var(--danger)", color: "#2a0a06" };
const ACCOUNTS = "/social/settings#accounts";

/**
 * 🧰 Tools & integrations hub (packet DT-1, Amendment A): every dashboard tool, grouped, searchable in Arabic and
 * English, with an honest state. Read-only: state comes from the store and two local checks (lib/tools), never
 * a fetch, a sync or a provider call. A stored account status is only "last known", never a green "connected".
 */
export default function ToolsScreen() {
  const { t } = useT();
  const settings = useStore((s) => s.settings);
  const socialSync = useStore((s) => s.socialSync);
  const [query, setQuery] = useState("");
  const ctx = toolContext({ settings, socialSync });
  const found = searchTools(query);

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl">{t("tools.title")}</h1>
        <p className="text-ink-2 text-sm">{t("tools.sub")}</p>
      </header>

      <input
        type="search"
        className="px-input w-full"
        placeholder={t("tools.searchPh")}
        aria-label={t("tools.search")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setQuery("");
        }}
        data-testid="tools-search"
      />

      {found.length === 0 && (
        <div className="px-card flex flex-col items-start gap-2" data-testid="tools-empty">
          <p className="text-ink-2 text-sm">{t("tools.empty")}</p>
          <button
            type="button"
            className="px-btn px-btn-sm"
            onClick={() => setQuery("")}
            data-testid="tools-clear"
          >
            {t("tools.clear")}
          </button>
        </div>
      )}

      {TOOL_GROUPS.map((group) => {
        const list = found.filter((tool) => tool.group === group);
        if (!list.length) return null;
        return (
          <section
            key={group}
            className="px-card flex flex-col gap-3"
            aria-labelledby={`tools-h-${group}`}
            data-testid={`tools-group-${group}`}
          >
            <h2 id={`tools-h-${group}`} className="text-base">
              {t(`tools.group.${group}` as MessageKey)}
            </h2>
            <ul className="flex flex-col gap-2">
              {list.map((tool) => (
                <ToolRow key={tool.id} tool={tool} ctx={ctx} statusAt={socialSync.statusAt} />
              ))}
            </ul>
          </section>
        );
      })}

      <p className="text-muted text-xs">{t("tools.note")}</p>
    </>
  );
}

function ToolRow({
  tool,
  ctx,
  statusAt,
}: {
  tool: ToolDef;
  ctx: ToolContext;
  statusAt: string | null;
}) {
  const { t, lang } = useT();
  const state = tool.state(ctx);
  const Icon = tool.icon;
  const chip =
    state === "lastKnown"
      ? t("tools.state.lastKnown", { ago: statusAt ? timeAgo(statusAt, lang) : "" })
      : t(`tools.state.${state}` as MessageKey);
  // A configured row without its own page (Chrome helper, MCP) still needs a way to its controls.
  const actionKey =
    state === "permission"
      ? tool.permission
      : state === "configured" && !tool.href
        ? "tools.manage"
        : ACTION[state];
  // Connection states go to the account controls; setup and permission to the tool's own setup route.
  const actionHref =
    state === "lastKnown" || state === "attention" ? ACCOUNTS : (tool.setupHref ?? tool.href);

  const body = (
    <>
      <Icon size={20} strokeWidth={1.75} aria-hidden className="text-ink-2 shrink-0" />
      <span className="flex min-w-0 flex-col">
        <b className="text-sm">{t(tool.name)}</b>
        <span className="text-ink-2 text-xs">{t(tool.desc)}</span>
        {state === "planned" && (
          <span className="text-muted text-xs">{t("tools.state.plannedNote")}</span>
        )}
      </span>
    </>
  );
  const mainClass = "text-ink flex min-w-0 flex-1 basis-56 items-center gap-3 no-underline";

  return (
    <li
      className="px-inset flex flex-wrap items-center gap-x-3 gap-y-2"
      data-tool={tool.id}
      data-testid={`tools-row-${tool.id}`}
    >
      {tool.href ? (
        <Link href={tool.href} className={mainClass} data-testid={`tools-link-${tool.id}`}>
          {body}
        </Link>
      ) : (
        <div className={mainClass} data-testid={`tools-link-${tool.id}`}>
          {body}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`px-chip whitespace-normal ${state === "permission" ? "px-chip-t2" : ""}`}
          style={state === "attention" ? DANGER : undefined}
          data-state={state}
          data-testid={`tools-state-${tool.id}`}
        >
          {chip}
        </span>
        {actionKey && actionHref && (
          <Link
            href={actionHref}
            className="px-link text-xs"
            data-testid={`tools-action-${tool.id}`}
          >
            {t(actionKey)}
          </Link>
        )}
      </div>
    </li>
  );
}
