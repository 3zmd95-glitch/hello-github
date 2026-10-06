"use client";

import Link from "next/link";
import PageHeader from "@/components/ui/ios/PageHeader";
import { useT, type MessageKey } from "@/lib/i18n";

export type SoonKind = "website" | "business";

const COPY: Record<
  SoonKind,
  { icon: string; title: MessageKey; sub: MessageKey; soon: MessageKey }
> = {
  website: {
    icon: "🌐",
    title: "social.website.title",
    sub: "social.website.sub",
    soon: "social.website.soon",
  },
  business: {
    icon: "💼",
    title: "social.business.title",
    sub: "social.business.sub",
    soon: "social.business.soon",
  },
};

/** Website / Business: not built yet; one Hijazi line says what will live here (round 16). */
export default function SoonScreen({ kind }: { kind: SoonKind }) {
  const { t } = useT();
  const c = COPY[kind];
  return (
    <div className="flex flex-col gap-4" data-testid={`${kind}-screen`}>
      <PageHeader
        title={t(c.title)}
        sub={t(c.sub)}
        trailing={<span className="px-chip">{t("nav.soon")}</span>}
      />
      <section className="px-card flex flex-col items-start gap-3">
        <span aria-hidden className="text-3xl leading-none">
          {c.icon}
        </span>
        <p className="text-ink-2 text-sm">{t(c.soon)}</p>
        <Link href="/social" className="px-btn px-btn-ghost px-btn-sm no-underline">
          {t("social.soon.back")}
        </Link>
      </section>
    </div>
  );
}
