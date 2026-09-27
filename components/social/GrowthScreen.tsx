"use client";

import { useState } from "react";
import { useToday } from "@/components/today/useToday";
import type { Platform } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { useStore } from "@/store";
import AllTab from "./growth/AllTab";
import AudienceAsks from "./growth/AudienceAsks";
import CsvImport from "./growth/CsvImport";
import PlatformTab from "./growth/PlatformTab";
import PlatformTabs, { type GrowthTab } from "./growth/PlatformTabs";
import SnapshotForm from "./growth/SnapshotForm";

/**
 * 📈 Growth (rounds 16–17): followers, 30-day views, engagement and audience asks across TikTok, Instagram,
 * YouTube, X and Snapchat. Numbers are typed in or imported from a CSV until the platform APIs are approved
 * (planning/tools/03-social-media.md); everything derives from the store's snapshots through lib/growth.
 */
export default function GrowthScreen() {
  const { t } = useT();
  const today = useToday();
  const snapshots = useStore((s) => s.socialSnapshots);
  const asks = useStore((s) => s.audienceAsks);
  const [tab, setTab] = useState<GrowthTab>("all");
  const [dialog, setDialog] = useState<"add" | "import" | null>(null);
  const platform: Platform | undefined = tab === "all" ? undefined : tab;

  return (
    <div className="flex flex-col gap-4" data-testid="growth-screen" data-tab={tab}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl">{t("social.growth.title")}</h1>
          <p className="text-ink-2 text-sm">{t("social.growth.sub")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="px-btn px-btn-sm"
            onClick={() => setDialog("add")}
            data-testid="growth-add"
          >
            ➕ {t("growth.add")}
          </button>
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            onClick={() => setDialog("import")}
            data-testid="growth-import"
          >
            📄 {t("growth.import")}
          </button>
        </div>
      </header>

      <PlatformTabs value={tab} onChange={setTab} />

      {platform ? (
        <PlatformTab key={platform} platform={platform} today={today} />
      ) : (
        <AllTab
          snapshots={snapshots}
          asks={asks}
          today={today}
          onOpenPlatform={setTab}
          onAdd={() => setDialog("add")}
          onImport={() => setDialog("import")}
        />
      )}

      <AudienceAsks platform={platform} />

      {dialog === "add" && (
        <SnapshotForm platform={platform} today={today} onClose={() => setDialog(null)} />
      )}
      {dialog === "import" && <CsvImport onClose={() => setDialog(null)} />}
    </div>
  );
}
