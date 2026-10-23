"use client";

import { useState } from "react";
import PageHeader from "@/components/ui/ios/PageHeader";
import Segmented from "@/components/ui/ios/Segmented";
import { useT } from "@/lib/i18n";
import DealsBoard from "./DealsBoard";
import KitEditor from "./KitEditor";

type Tab = "kit" | "deals";

/**
 * 💼 Business (packet DT-5, planning/tools/35-business-kit.md): the creator media kit (owner text, real Growth numbers
 * with their source, rate card, preview / print / JSON export) and the brand-deal board. Everything stays on this
 * device; public hosting is packet DT-8.
 */
export default function BusinessScreen() {
  const { t } = useT();
  const [tab, setTab] = useState<Tab>("kit");
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="business-screen">
      <PageHeader title={t("social.business.title")} sub={t("business.sub")} />
      <p className="text-ink-2 text-[13px]" data-testid="business-local-only">
        {t("business.localOnly")}
      </p>
      <Segmented
        label={t("social.business.title")}
        value={tab}
        onChange={setTab}
        idPrefix="business"
        options={[
          { value: "kit", label: t("business.tab.kit"), testId: "business-tab-kit" },
          { value: "deals", label: t("business.tab.deals"), testId: "business-tab-deals" },
        ]}
      />
      <div
        role="tabpanel"
        id={`business-panel-${tab}`}
        aria-labelledby={`business-tab-${tab}`}
        className="min-w-0"
      >
        {tab === "kit" ? <KitEditor /> : <DealsBoard />}
      </div>
    </div>
  );
}
