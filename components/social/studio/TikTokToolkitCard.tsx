"use client";
import Link from "next/link";
import { useT } from "@/lib/i18n";

export default function TikTokToolkitCard() {
  const { t } = useT();
  return (
    <section className="px-card flex flex-col gap-3" data-testid="tiktok-toolkit">
      <h2 className="text-base">{t("tiktok.toolkit.title")}</h2>
      <p className="text-ink-2 text-sm">{t("tiktok.toolkit.body")}</p>
      <div className="flex flex-wrap gap-3">
        <Link href="/social/calendar/" className="px-btn px-btn-sm no-underline">
          {t("tiktok.toolkit.plan")}
        </Link>
        <Link href="/social/automations/" className="px-link text-sm">
          {t("tiktok.toolkit.finish")}
        </Link>
        <Link href="/social/growth/#tiktok-brief" className="px-link text-sm">
          {t("tiktok.toolkit.results")}
        </Link>
      </div>
      <p className="text-muted text-xs">{t("tiktok.toolkit.limits")}</p>
    </section>
  );
}
