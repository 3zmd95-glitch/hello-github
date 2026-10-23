"use client";

import ApiKeysCard from "@/components/settings/ApiKeysCard";
import ConnectedAccountsCard from "@/components/settings/ConnectedAccountsCard";
import DataCard from "@/components/settings/DataCard";
import { QuickSettingRows } from "@/components/shell/MoreScreen";
import { ListGroup } from "@/components/ui/ios/List";
import PageHeader from "@/components/ui/ios/PageHeader";
import { useT } from "@/lib/i18n";

/**
 * Social settings (tools/20): the Social cards only, in the iOS look. Worker URL + token (the accounts card's "set the
 * Worker first" link lands on `#api-keys`), Connected accounts (`#accounts`, where Growth and the auto tools link and
 * where OAuth comes back), More's quick settings, and the backup. Language, sound and the Worker are the same values
 * Training uses: one store until the two worlds become separate sites.
 */
export default function SocialSettingsScreen() {
  const { t } = useT();
  return (
    <>
      <PageHeader title={t("settings.title")} sub={t("settings.sub")} testId="social-settings" />
      <ApiKeysCard rows={["scoutUrl", "scoutToken"]} />
      <ConnectedAccountsCard />
      <ListGroup header={t("more.quick")}>
        <QuickSettingRows />
      </ListGroup>
      <DataCard />
    </>
  );
}
