"use client";

import { Lightbulb, MessageCircle, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ListGroup, ListRow } from "@/components/ui/ios/List";
import type { Platform } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { PLATFORM_META } from "@/lib/social";
import { useStore } from "@/store";

const norm = (s: string) => s.trim().toLowerCase();

/**
 * "What people want": recurring audience questions with a mention count, as a grouped list whose first row adds
 * one. Each row bumps (+1), turns the question into an idea (the Studio button: it morphs into the "in the ideas
 * bank" chip, which takes the focus) or goes. The Ideas bank reads them too.
 */
export default function AudienceAsks({ platform }: { platform?: Platform }) {
  const { t, L } = useT();
  const asks = useStore((s) => s.audienceAsks);
  const ideas = useStore((s) => s.ideas);
  const addAsk = useStore((s) => s.addAsk);
  const bumpAsk = useStore((s) => s.bumpAsk);
  const removeAsk = useStore((s) => s.removeAsk);
  const addIdea = useStore((s) => s.addIdea);
  const [text, setText] = useState("");
  const [converted, setConverted] = useState<string | null>(null);
  const chipRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (converted) chipRef.current?.focus();
  }, [converted]);
  const inIdeas = useMemo(
    () => new Set(ideas.filter((i) => i.source === "audience").map((i) => norm(i.text))),
    [ideas],
  );

  const sorted = [...asks].sort(
    (a, b) => b.count - a.count || b.createdAt.localeCompare(a.createdAt),
  );
  // "{n} times": the number keeps its own element (the count the tests read).
  const [countPre, countPost = ""] = t("growth.asks.count").split("{n}");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = text.trim();
    if (!clean) return;
    addAsk({ text: clean, ...(platform ? { platform } : {}) });
    setText("");
  };

  return (
    <div className="flex flex-col gap-1.5">
      <ListGroup header={t("growth.asks.title")} listAs="ul" testId="asks-section">
        <li className="ios-row" data-sep="16">
          <form className="flex w-full gap-2" onSubmit={submit}>
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
        </li>
        {sorted.length === 0 && (
          <li className="ios-row text-ink-2 text-sm" data-sep="16">
            {t("growth.asks.empty")}
          </li>
        )}
        {sorted.map((a) => {
          const just = converted === a.id;
          return (
            <ListRow
              key={a.id}
              as="li"
              className="gr-ask"
              icon={<MessageCircle size={22} strokeWidth={1.75} aria-hidden />}
              title={
                <span
                  dir="auto"
                  // The audience words wrap; aligned by the row (Chromium only knows the prefixed value).
                  className="block [text-align:-webkit-match-parent] [text-align:match-parent] whitespace-normal"
                >
                  {a.text}
                </span>
              }
              sub={
                <>
                  {countPre}
                  <span className="num" data-testid="ask-count">
                    {a.count}
                  </span>
                  {countPost}
                  {a.platform && ` · ${L(PLATFORM_META[a.platform].name)}`}
                </>
              }
              trailing={
                <div className="ms-auto flex shrink-0 items-center gap-2">
                  {inIdeas.has(norm(a.text)) ? (
                    <Link
                      ref={just ? chipRef : undefined}
                      href="/social/ideas/"
                      // A 44px tall hit area around the 24px chip, inside the row.
                      className={`ios-chip tint relative no-underline after:absolute after:inset-x-0 after:-inset-y-2.5 ${just ? "ios-pop" : ""}`}
                      data-testid="ask-in-ideas"
                    >
                      {t("social.studio.asksInIdeas")}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="px-btn px-btn-ghost px-btn-sm"
                      onClick={() => {
                        addIdea({
                          text: a.text,
                          source: "audience",
                          ...(a.platform ? { platform: a.platform } : {}),
                        });
                        setConverted(a.id);
                      }}
                      data-testid="ask-to-idea"
                    >
                      <Sparkles size={14} strokeWidth={1.75} aria-hidden />
                      {t("social.studio.asksToIdea")}
                    </button>
                  )}
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
                    <X size={16} strokeWidth={1.75} aria-hidden />
                  </button>
                </div>
              }
              testId="ask-row"
              data-id={a.id}
            />
          );
        })}
      </ListGroup>
      <p className="text-muted px-4 text-xs">{t("growth.asks.sub")}</p>
      <p className="text-muted flex items-center gap-1.5 px-4 text-xs">
        <Lightbulb size={14} strokeWidth={1.75} className="shrink-0" aria-hidden />
        {t("growth.asks.hint")}
      </p>
    </div>
  );
}
