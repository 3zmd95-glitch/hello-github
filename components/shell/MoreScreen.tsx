"use client";

import {
  Briefcase,
  Gamepad2,
  Globe,
  Languages,
  MessageCircle,
  Rocket,
  Search,
  Settings,
  Volume2,
} from "lucide-react";
import Link from "next/link";
import Chip from "@/components/ui/ios/Chip";
import { ListGroup, ListRow } from "@/components/ui/ios/List";
import PageHeader from "@/components/ui/ios/PageHeader";
import Segmented from "@/components/ui/ios/Segmented";
import Switch from "@/components/ui/ios/Switch";
import { useT, type MessageKey } from "@/lib/i18n";
import { useStore } from "@/store";
import type { World } from "./useWorld";

const TRAINING_LINKS: readonly { href: string; label: MessageKey; testId: string }[] = [
  { href: "/map", label: "morePage.map", testId: "more-map" },
  { href: "/notes", label: "morePage.notes", testId: "more-notes" },
  { href: "/planner", label: "morePage.planner", testId: "more-planner" },
  { href: "/review", label: "morePage.review", testId: "more-review" },
  { href: "/rewards", label: "morePage.rewards", testId: "more-rewards" },
  { href: "/discover", label: "morePage.discover", testId: "more-discover" },
  { href: "/settings", label: "morePage.settings", testId: "more-settings" },
];

export default function MoreScreen({ world = "training" }: { world?: World }) {
  const { t } = useT();
  if (world === "social") return <SocialMore />;
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl">{t("morePage.title")}</h1>
        <p className="text-ink-2 text-sm">{t("morePage.sub")}</p>
      </header>
      <ul className="flex flex-col gap-2">
        {TRAINING_LINKS.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className="px-card text-ink hover:border-gold flex items-center gap-3 font-bold no-underline"
              data-testid={l.testId}
            >
              {t(l.label)}
              <span aria-hidden className="text-muted ms-auto rtl:rotate-180">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

const icon = { size: 22, strokeWidth: 1.75, "aria-hidden": true } as const;

/**
 * Social "More" (tools/18 §6, mockup More), as grouped lists: the two "soon" sections; the sections that are not in
 * the phone tab bar with the Discover shortcut (edit genres and search live there; a Training route, so it opens in
 * the Training shell); quick settings (Social keeps language and sound here, not in its top bar, round 35) with all
 * settings; the way back to Training. Row titles are the tab bar's and the sidebar's own words (`nav.*`).
 */
function SocialMore() {
  const { t, lang } = useT();
  const sound = useStore((s) => s.settings.sound);
  const setSettings = useStore((s) => s.setSettings);
  const soon = <Chip>{t("nav.soon")}</Chip>;
  return (
    <>
      <PageHeader title={t("social.more.title")} sub={t("social.more.sub")} />
      <div className="flex flex-col gap-3">
        <ListGroup>
          <ListRow
            href="/social/website"
            icon={<Globe {...icon} />}
            iconTone="fill"
            title={t("nav.website")}
            trailing={soon}
            testId="more-website"
          />
          <ListRow
            href="/social/business"
            icon={<Briefcase {...icon} />}
            iconTone="fill"
            title={t("nav.business")}
            trailing={soon}
            testId="more-business"
          />
        </ListGroup>
        <ListGroup>
          <ListRow
            href="/social/automations"
            icon={<Rocket {...icon} />}
            title={t("nav.automations")}
            chevron
            testId="more-automations"
          />
          <ListRow
            href="/social/replies"
            icon={<MessageCircle {...icon} />}
            title={t("nav.replies")}
            chevron
            testId="more-replies"
          />
          <ListRow
            href="/discover"
            icon={<Search {...icon} />}
            title={t("nav.discover")}
            chevron
            testId="more-discover"
          />
        </ListGroup>
        <ListGroup header={t("more.quick")}>
          <ListRow
            icon={<Languages {...icon} />}
            iconTone="fill"
            title={t("settings.lang")}
            trailing={
              <Segmented
                role="radiogroup"
                label={t("top.lang")}
                value={lang}
                onChange={(l) => setSettings({ lang: l })}
                className="w-[118px]"
                options={[
                  { value: "ar", label: "عربي", testId: "lang-ar" },
                  { value: "en", label: "EN", testId: "lang-en" },
                ]}
              />
            }
          />
          <ListRow
            icon={<Volume2 {...icon} />}
            iconTone="fill"
            title={t("settings.sound")}
            trailing={
              <Switch
                checked={sound}
                onChange={(v) => setSettings({ sound: v })}
                label={t("settings.sound")}
                testId="sound-toggle"
              />
            }
          />
          <ListRow
            href="/settings"
            icon={<Settings {...icon} />}
            iconTone="fill"
            title={t("nav.settings")}
            chevron
            testId="more-settings"
          />
        </ListGroup>
        <ListGroup>
          <ListRow
            href="/"
            icon={<Gamepad2 {...icon} />}
            title={t("social.more.training")}
            sub={t("world.backToTrainingHint")}
            chevron
            testId="more-training"
          />
        </ListGroup>
      </div>
    </>
  );
}
