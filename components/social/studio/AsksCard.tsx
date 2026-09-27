"use client";

import Link from "next/link";
import { useMemo } from "react";
import { topAsks } from "@/lib/growth";
import { useT } from "@/lib/i18n";
import { useStore } from "@/store";
import { PlatformChip } from "./platform";

const norm = (s: string) => s.trim().toLowerCase();

/** Top 3 "what people want" asks with their counts; each can become an idea in the bank. */
export default function AsksCard() {
  const { t } = useT();
  const asks = useStore((s) => s.audienceAsks);
  const ideas = useStore((s) => s.ideas);
  const addIdea = useStore((s) => s.addIdea);
  const top = useMemo(() => topAsks(asks, 3), [asks]);
  const inIdeas = useMemo(
    () => new Set(ideas.filter((i) => i.source === "audience").map((i) => norm(i.text))),
    [ideas],
  );

  return (
    <section
      className="px-card flex flex-col gap-3"
      data-testid="studio-asks"
      data-empty={top.length === 0}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base">{t("social.studio.asks")}</h2>
        <Link
          href="/social/growth/"
          className="px-link text-xs no-underline"
          data-testid="studio-asks-open"
        >
          {t("social.studio.asksOpen")}
        </Link>
      </header>
      {top.length === 0 ? (
        <p className="text-ink-2 text-sm" data-testid="studio-asks-empty">
          {t("social.studio.asksEmpty")}
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {top.map((ask, i) => {
            const saved = inIdeas.has(norm(ask.text));
            return (
              <li
                key={ask.id}
                className="px-inset flex flex-col gap-2"
                data-testid="ask-row"
                data-ask={ask.id}
              >
                <div className="flex items-start gap-2">
                  <span className="num text-muted text-xs">{i + 1}</span>
                  <span className="min-w-0 flex-1 text-sm">{ask.text}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-chip" data-testid="ask-count">
                    {t("social.studio.asksMentions", { n: ask.count })}
                  </span>
                  {ask.platform && <PlatformChip platform={ask.platform} />}
                  {saved ? (
                    <Link
                      href="/social/ideas/"
                      className="px-chip px-chip-green no-underline"
                      data-testid="ask-in-ideas"
                    >
                      {t("social.studio.asksInIdeas")}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="px-btn px-btn-ghost px-btn-sm ms-auto"
                      onClick={() =>
                        addIdea({
                          text: ask.text,
                          source: "audience",
                          ...(ask.platform ? { platform: ask.platform } : {}),
                        })
                      }
                      data-testid="ask-to-idea"
                    >
                      {t("social.studio.asksToIdea")}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
