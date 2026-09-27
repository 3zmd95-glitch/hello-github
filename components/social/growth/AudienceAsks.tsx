"use client";

import { useState, type FormEvent } from "react";
import type { Platform } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { PLATFORM_META } from "@/lib/social";
import { useStore } from "@/store";

/** "What people want": recurring audience questions with a mention count; the Ideas bank reads them. */
export default function AudienceAsks({ platform }: { platform?: Platform }) {
  const { t, L } = useT();
  const asks = useStore((s) => s.audienceAsks);
  const addAsk = useStore((s) => s.addAsk);
  const bumpAsk = useStore((s) => s.bumpAsk);
  const removeAsk = useStore((s) => s.removeAsk);
  const [text, setText] = useState("");

  const sorted = [...asks].sort(
    (a, b) => b.count - a.count || b.createdAt.localeCompare(a.createdAt),
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = text.trim();
    if (!clean) return;
    addAsk({ text: clean, ...(platform ? { platform } : {}) });
    setText("");
  };

  return (
    <section className="px-card flex flex-col gap-3" data-testid="asks-section">
      <header className="flex flex-col gap-0.5">
        <h2 className="text-base">{t("growth.asks.title")}</h2>
        <p className="text-muted text-xs">{t("growth.asks.sub")}</p>
      </header>

      <form className="flex gap-2" onSubmit={submit}>
        <input
          type="text"
          className="px-input"
          value={text}
          maxLength={160}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("growth.asks.placeholder")}
          aria-label={t("growth.asks.placeholder")}
          data-testid="ask-input"
        />
        <button
          type="submit"
          className="px-btn shrink-0"
          disabled={!text.trim()}
          data-testid="ask-add"
        >
          {t("growth.asks.add")}
        </button>
      </form>

      {sorted.length === 0 ? (
        <p className="text-ink-2 text-sm">{t("growth.asks.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {sorted.map((a) => (
            <li
              key={a.id}
              className="px-inset flex items-center gap-2"
              data-testid="ask-row"
              data-id={a.id}
            >
              <b
                className="num bg-panel-3 text-ink grid h-7 min-w-7 shrink-0 place-items-center rounded-full px-1.5 text-xs"
                data-testid="ask-count"
                title={t("growth.asks.count", { n: a.count })}
              >
                {a.count}
              </b>
              <span className="min-w-0 flex-1 text-sm break-words">
                {a.text}
                {a.platform && (
                  <span className="text-muted ms-1 text-xs" aria-hidden>
                    {PLATFORM_META[a.platform].icon} {L(PLATFORM_META[a.platform].name)}
                  </span>
                )}
              </span>
              <button
                type="button"
                className="px-btn px-btn-ghost px-btn-sm num"
                onClick={() => bumpAsk(a.id)}
                aria-label={t("growth.asks.bump")}
                title={t("growth.asks.bump")}
                data-testid="ask-bump"
              >
                +1
              </button>
              <button
                type="button"
                className="px-btn px-btn-ghost px-btn-sm"
                onClick={() => removeAsk(a.id)}
                aria-label={t("growth.asks.remove")}
                title={t("growth.asks.remove")}
                data-testid="ask-remove"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-muted text-xs">💡 {t("growth.asks.hint")}</p>
    </section>
  );
}
