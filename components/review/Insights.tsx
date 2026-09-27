"use client";

import Link from "next/link";
import { useT, type MessageKey } from "@/lib/i18n";
import type { Insight, InsightGo } from "@/lib/weekStats";

const GO_LABEL: Record<InsightGo, MessageKey> = {
  "/planner": "review.go.planner",
  "/map": "review.go.map",
  "/skills": "review.go.skills",
  "/rewards": "review.go.rewards",
};

/** Up to four rules-based observations, each with one "go" button. */
export default function Insights({ list }: { list: readonly Insight[] }) {
  const { t, L } = useT();
  return (
    <section className="px-card flex flex-col gap-3" data-testid="insights">
      <h2 className="text-base">{t("review.insights.title")}</h2>
      {list.length === 0 ? (
        <p className="text-muted text-sm">{t("review.insights.empty")}</p>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {list.map((i) => (
            <article
              key={i.id}
              className="px-inset flex flex-col gap-1.5"
              data-testid="insight"
              data-insight={i.id}
              data-go={i.go}
            >
              <b className="text-sm leading-snug">
                <span aria-hidden>{i.icon}</span> {L(i.text)}
              </b>
              <span className="text-ink-2 border-accent border-s-2 ps-2 text-xs">{L(i.tip)}</span>
              <div>
                <Link
                  href={`${i.go}/`}
                  className="px-btn px-btn-ghost px-btn-sm no-underline"
                  data-testid="insight-go"
                >
                  {t(GO_LABEL[i.go])}
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
