"use client";

import { Languages, Volume2 } from "lucide-react";
import Link from "next/link";
import { ListGroup, ListRow } from "@/components/ui/ios/List";
import Segmented from "@/components/ui/ios/Segmented";
import Switch from "@/components/ui/ios/Switch";
import { useT, type MessageKey } from "@/lib/i18n";
import { useStore } from "@/store";
import type { World } from "./useWorld";

interface MoreLink {
  href: string;
  label: MessageKey;
  testId: string;
  soon?: boolean;
}

const TRAINING_LINKS: readonly MoreLink[] = [
  { href: "/map", label: "morePage.map", testId: "more-map" },
  { href: "/notes", label: "morePage.notes", testId: "more-notes" },
  { href: "/planner", label: "morePage.planner", testId: "more-planner" },
  { href: "/review", label: "morePage.review", testId: "more-review" },
  { href: "/rewards", label: "morePage.rewards", testId: "more-rewards" },
  { href: "/discover", label: "morePage.discover", testId: "more-discover" },
  { href: "/settings", label: "morePage.settings", testId: "more-settings" },
];

/**
 * Social "More": the sections that are not in the phone tab bar, the 🔎 Discover shortcut (edit genres and
 * search live there; a Training route, so it opens in the Training shell), Settings, and the way back to
 * Training.
 */
const SOCIAL_LINKS: readonly MoreLink[] = [
  { href: "/social/website", label: "social.more.website", testId: "more-website", soon: true },
  { href: "/social/business", label: "social.more.business", testId: "more-business", soon: true },
  { href: "/social/automations", label: "social.more.automations", testId: "more-automations" },
  { href: "/social/replies", label: "social.more.replies", testId: "more-replies" },
  { href: "/discover", label: "morePage.discover", testId: "more-discover" },
  { href: "/settings", label: "morePage.settings", testId: "more-settings" },
  { href: "/", label: "social.more.training", testId: "more-training" },
];

const COPY: Record<World, { title: MessageKey; sub: MessageKey; links: readonly MoreLink[] }> = {
  training: { title: "morePage.title", sub: "morePage.sub", links: TRAINING_LINKS },
  social: { title: "social.more.title", sub: "social.more.sub", links: SOCIAL_LINKS },
};

export default function MoreScreen({ world = "training" }: { world?: World }) {
  const { t } = useT();
  const { title, sub, links } = COPY[world];
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl">{t(title)}</h1>
        <p className="text-ink-2 text-sm">{t(sub)}</p>
      </header>
      <ul className="flex flex-col gap-2">
        {links.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className="px-card text-ink hover:border-gold flex items-center gap-3 font-bold no-underline"
              data-testid={l.testId}
            >
              {t(l.label)}
              {l.soon && <span className="px-chip">{t("nav.soon")}</span>}
              <span aria-hidden className="text-muted ms-auto rtl:rotate-180">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {world === "social" && <QuickSettings />}
    </>
  );
}

/** Social keeps language and sound here, not in its top bar (iOS look, round 35); Training keeps its top bar. */
function QuickSettings() {
  const { t, lang } = useT();
  const sound = useStore((s) => s.settings.sound);
  const setSettings = useStore((s) => s.setSettings);
  return (
    <ListGroup header={t("more.quick")}>
      <ListRow
        icon={<Languages size={22} strokeWidth={1.75} aria-hidden />}
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
        icon={<Volume2 size={22} strokeWidth={1.75} aria-hidden />}
        iconTone="fill"
        title={t("settings.sound")}
        trailing={
          <Switch
            checked={sound}
            onChange={(v) => setSettings({ sound: v })}
            label={t(sound ? "top.soundOn" : "top.soundOff")}
            testId="sound-toggle"
          />
        }
      />
    </ListGroup>
  );
}
