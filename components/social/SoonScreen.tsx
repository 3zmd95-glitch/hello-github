"use client";

import { Briefcase, Globe } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import Card from "@/components/ui/ios/Card";
import Chip from "@/components/ui/ios/Chip";
import PageHeader from "@/components/ui/ios/PageHeader";
import { useT, type MessageKey } from "@/lib/i18n";

export type SoonKind = "website" | "business";

const COPY: Record<
  SoonKind,
  { icon: ReactNode; title: MessageKey; sub: MessageKey; soon: MessageKey }
> = {
  website: {
    icon: <Globe size={28} strokeWidth={1.75} aria-hidden />,
    title: "social.website.title",
    sub: "social.website.sub",
    soon: "social.website.soon",
  },
  business: {
    icon: <Briefcase size={28} strokeWidth={1.75} aria-hidden />,
    title: "social.business.title",
    sub: "social.business.sub",
    soon: "social.business.soon",
  },
};

/** Website / Business: not built yet. One card with the icon and a "soon" chip says what will live here (round 16). */
export default function SoonScreen({ kind }: { kind: SoonKind }) {
  const { t } = useT();
  const c = COPY[kind];
  return (
    <div className="flex flex-col gap-4" data-testid={`${kind}-screen`}>
      <PageHeader title={t(c.title)} sub={t(c.sub)} />
      <Card className="flex flex-col items-center gap-3 px-6 py-8 text-center">
        <span className="ios-ic fill h-14 w-14 rounded-[18px]">{c.icon}</span>
        <Chip>{t("nav.soon")}</Chip>
        <p className="text-ink-2 max-w-[36ch] text-[15px]">{t(c.soon)}</p>
        <Link href="/social" className="px-btn px-btn-ghost px-btn-sm mt-1 no-underline">
          {t("social.soon.back")}
        </Link>
      </Card>
    </div>
  );
}
