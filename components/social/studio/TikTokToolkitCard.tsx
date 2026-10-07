"use client";

import { CalendarPlus } from "lucide-react";
import Link from "next/link";
import Card from "@/components/ui/ios/Card";
import PlatformBadge from "@/components/ui/ios/PlatformBadge";
import { useT } from "@/lib/i18n";

/** TikTok's personal-account workflow (plan, send to TikTok's inbox, finish in the app) and what it cannot do. */
export default function TikTokToolkitCard() {
  const { t } = useT();
  return (
    <Card testId="tiktok-toolkit">
      <div className="flex items-center gap-3">
        <PlatformBadge platform="tiktok" size={34} />
        <h2 className="text-[15px] font-semibold">{t("tiktok.toolkit.title")}</h2>
      </div>
      <p className="text-ink-2 mt-2.5 text-sm">{t("tiktok.toolkit.body")}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link href="/social/calendar/" className="px-btn px-btn-sm no-underline">
          <CalendarPlus size={16} strokeWidth={1.75} aria-hidden />
          {t("tiktok.toolkit.plan")}
        </Link>
        <Link href="/social/automations/" className="px-link text-sm">
          {t("tiktok.toolkit.finish")}
        </Link>
        <Link href="/social/growth/#tiktok-brief" className="px-link text-sm">
          {t("tiktok.toolkit.results")}
        </Link>
      </div>
      <p className="text-muted mt-3 text-xs">{t("tiktok.toolkit.limits")}</p>
    </Card>
  );
}
