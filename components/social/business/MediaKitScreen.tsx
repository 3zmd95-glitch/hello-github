"use client";

import { Printer } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ListGroup, ListRow } from "@/components/ui/ios/List";
import PageHeader from "@/components/ui/ios/PageHeader";
import Segmented from "@/components/ui/ios/Segmented";
import Switch from "@/components/ui/ios/Switch";
import { emptyKit, kitMetrics } from "@/lib/businessKit";
import { KIT_BLOCKS, type KitBlock, type Lang } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { kitAudience, kitRecentPosts, kitTotalFollowers } from "@/lib/mediaKit";
import { dayKey } from "@/lib/streak";
import { analyticsState, useStore } from "@/store";
import MediaKitPaper, { blockHasData, type MediaKitData } from "./MediaKitPaper";

/**
 * 📄 The media-kit page (planning/tools/09 D2, `/social/business/media-kit`): the kit's saved text and the numbers
 * Growth already stores, laid out as a light A4 sheet brands can read, in Arabic or English, with the owner's block
 * switches. "Export PDF" is the browser's print (Save as PDF): no PDF library, so Arabic is shaped by the browser.
 * Nothing is public; the rate card and the calculator are never on the page (it says "rates on request").
 */
export default function MediaKitScreen() {
  const { t, lang } = useT();
  const stored = useStore((s) => s.businessKit);
  const prefs = useStore((s) => s.businessPrefs);
  const analytics = useStore(useShallow(analyticsState));
  const demographics = useStore((s) => s.demographics);
  const [picked, setPicked] = useState<Lang | null>(null);
  const [now] = useState(() => new Date());
  const kitLang = picked ?? lang;

  const kit = useMemo(() => stored ?? emptyKit(), [stored]);
  const data: MediaKitData = useMemo(() => {
    const metrics = kitMetrics(
      analytics,
      now,
      kit.featuredPlatforms.length ? kit.featuredPlatforms : undefined,
    );
    const platforms = metrics.map((m) => m.platform);
    const handle = metrics.find((m) => m.handle)?.handle;
    return {
      name: prefs.name.trim() || (handle ? `@${handle}` : ""),
      kit,
      metrics,
      total: kitTotalFollowers(metrics),
      audience: kitAudience(demographics, platforms, now),
      posts: kitRecentPosts(analytics.postStats, platforms, now),
      blocks: prefs.blocks,
      day: dayKey(now),
    };
  }, [analytics, demographics, kit, now, prefs.blocks, prefs.name]);

  const save = (next: typeof prefs) => useStore.getState().setBusinessPrefs(next);
  const setBlock = (b: KitBlock, on: boolean) =>
    save({ ...prefs, blocks: { ...prefs.blocks, [b]: on } });
  const noContact = !kit.contact.email.trim();

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="kitpage-screen">
      <PageHeader
        title={t("business.page.title")}
        sub={t("business.page.sub")}
        trailing={
          <button
            type="button"
            className="px-btn shrink-0"
            onClick={() => window.print()}
            data-testid="kitpage-export"
          >
            <Printer size={16} strokeWidth={1.75} aria-hidden />
            {t("business.page.export")}
          </button>
        }
      />
      <Link
        href="/social/business"
        className="px-link self-start text-[14px]"
        data-testid="kitpage-back"
      >
        {t("business.page.back")}
      </Link>
      <p className="text-ink-2 text-[13px]">{t("business.page.exportHint")}</p>

      <section className="ios-card flex min-w-0 flex-col gap-3 p-4">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-ink-2 text-[13px] font-semibold">{t("business.page.name")}</span>
          <input
            className="px-input"
            maxLength={60}
            dir="auto"
            value={prefs.name}
            placeholder={t("business.page.namePlaceholder")}
            onChange={(e) => save({ ...prefs, name: e.target.value })}
            data-testid="kitpage-name"
          />
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-ink-2 text-[13px] font-semibold">{t("business.page.lang")}</span>
          <Segmented
            role="radiogroup"
            label={t("business.page.lang")}
            value={kitLang}
            onChange={setPicked}
            options={[
              { value: "ar", label: "العربية", testId: "kitpage-lang-ar" },
              { value: "en", label: "English", testId: "kitpage-lang-en" },
            ]}
          />
        </div>
      </section>

      <ListGroup header={t("business.page.blocks")} listAs="ul">
        {KIT_BLOCKS.map((b) => (
          <ListRow
            key={b}
            as="li"
            title={t(`business.page.block.${b}`)}
            sub={
              blockHasData(b, data) ? undefined : (
                <span data-testid={`kitpage-block-hint-${b}`}>{t("business.page.blockEmpty")}</span>
              )
            }
            trailing={
              <Switch
                checked={prefs.blocks[b]}
                onChange={(on) => setBlock(b, on)}
                label={t(`business.page.block.${b}`)}
                testId={`kitpage-block-${b}`}
              />
            }
          />
        ))}
      </ListGroup>

      {noContact && (
        <p className="bg-warn-bg rounded-xl p-3 text-[13px]" data-testid="kitpage-no-email">
          {t("business.page.noEmail")}{" "}
          <Link href="/social/business" className="px-link">
            {t("business.page.edit")}
          </Link>
        </p>
      )}

      <MediaKitPaper data={data} lang={kitLang} />
    </div>
  );
}
