"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import CelebrationProvider from "@/components/celebrate/CelebrationProvider";
import SkillSheetProvider from "@/components/skills/SkillSheetProvider";
import { useDocumentLang, useT } from "@/lib/i18n";
import { setMuted } from "@/lib/sound";
import { hydrateStore, useStore } from "@/store";
import { NAV_ITEMS, normalizePath, type NavItem } from "./nav";

/**
 * App shell for the 🎮 Training world: loads saved progress, then renders the top bar,
 * phone tab bar / desktop sidebar, and the providers for the skill popup and celebrations.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.resolve(hydrateStore())
      .catch(() => undefined)
      .then(() => {
        if (!alive) return;
        useStore.getState().applyStreakFreezes();
        setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  useDocumentLang();
  const sound = useStore((s) => s.settings.sound);
  useEffect(() => setMuted(!sound), [sound]);

  if (!ready) return <Splash />;

  return (
    <CelebrationProvider>
      <SkillSheetProvider>
        <div className="flex min-h-dvh flex-col">
          <TopBar />
          <div className="mx-auto flex w-full max-w-[1180px] flex-1 md:gap-6 md:px-6">
            <SideNav />
            <main
              id="main"
              className="pb-safe-tabbar flex min-w-0 flex-1 flex-col gap-4 px-4 pt-4 md:px-0 md:pt-6 md:pb-12"
            >
              {children}
            </main>
          </div>
          <TabBar />
        </div>
      </SkillSheetProvider>
    </CelebrationProvider>
  );
}

function Splash() {
  const { t } = useT();
  return (
    <div className="grid min-h-dvh place-items-center p-6" data-testid="splash">
      <div className="flex flex-col items-center gap-3">
        <Logo size={56} />
        <p className="text-muted text-sm">{t("splash.loading")}</p>
      </div>
    </div>
  );
}

function Logo({ size = 36 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="border-edge bg-accent font-pixel text-accent-ink grid shrink-0 place-items-center rounded-[2px] border-[3px] font-bold shadow-[3px_3px_0_var(--edge)]"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      3z
    </span>
  );
}

function useActivePath(): string {
  return normalizePath(usePathname());
}

function TopBar() {
  const { t, lang } = useT();
  const sound = useStore((s) => s.settings.sound);
  const setSettings = useStore((s) => s.setSettings);
  return (
    <header className="pt-safe border-edge bg-panel sticky top-0 z-30 border-b-[3px]">
      <div className="mx-auto flex h-14 max-w-[1180px] items-center gap-2 px-4 md:px-6">
        <Link href="/" className="text-ink flex min-w-0 items-center gap-2 no-underline">
          <Logo />
          <span className="hidden font-extrabold sm:inline">
            {t("app.name")}{" "}
            <span className="text-muted text-xs font-semibold">· {t("app.tagline")}</span>
          </span>
        </Link>
        <span className="px-chip px-chip-gold">{t("world.training")}</span>
        <div className="ms-auto flex items-center gap-2">
          <div
            role="group"
            aria-label={t("top.lang")}
            className="border-edge bg-edge flex gap-[2px] rounded-[2px] border-2"
          >
            {(["ar", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={lang === l}
                onClick={() => setSettings({ lang: l })}
                className={`num px-2.5 py-1 text-xs font-bold ${lang === l ? "bg-gold text-gold-ink" : "bg-panel-2 text-ink-2"}`}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-pressed={sound}
            aria-label={sound ? t("top.soundOn") : t("top.soundOff")}
            title={sound ? t("top.soundOn") : t("top.soundOff")}
            onClick={() => setSettings({ sound: !sound })}
            className="px-btn px-btn-ghost px-btn-sm w-9 px-0"
            data-testid="sound-toggle"
          >
            {sound ? "🔊" : "🔇"}
          </button>
          <Link
            href="/settings"
            aria-label={t("top.settings")}
            title={t("top.settings")}
            className="px-btn px-btn-ghost px-btn-sm w-9 px-0 no-underline"
          >
            ⚙️
          </Link>
        </div>
      </div>
    </header>
  );
}

function NavEntry({ item, variant }: { item: NavItem; variant: "side" | "tab" }) {
  const { t } = useT();
  const active = useActivePath() === item.href;
  const side = variant === "side";
  const base = side
    ? "flex items-center gap-3 rounded-[2px] border-2 px-3 py-2 text-[0.95rem] font-semibold no-underline"
    : "flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-[2px] border-2 px-1 py-1 text-[0.7rem] font-semibold no-underline";
  const tone = active
    ? "border-edge bg-panel-2 text-gold shadow-[3px_3px_0_var(--edge)]"
    : "border-transparent text-ink-2 hover:bg-panel-2";
  const inner = (
    <>
      <span aria-hidden className={side ? "w-6 text-center" : "text-lg leading-none"}>
        {item.icon}
      </span>
      <span className="truncate">{t(item.label)}</span>
      {item.soon && (
        <span className={`px-chip px-1 text-[0.6rem] ${side ? "ms-auto" : ""}`}>
          {t("nav.soon")}
        </span>
      )}
    </>
  );
  if (item.soon) {
    return (
      <span aria-disabled="true" className={`${base} text-muted border-transparent opacity-60`}>
        {inner}
      </span>
    );
  }
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined} className={`${base} ${tone}`}>
      {inner}
    </Link>
  );
}

function SideNav() {
  const { t } = useT();
  return (
    <nav
      aria-label={t("nav.main")}
      className="sticky top-[calc(56px+3px+24px)] hidden h-fit w-[210px] shrink-0 flex-col gap-1 pt-6 md:flex"
    >
      {NAV_ITEMS.map((item) => (
        <NavEntry key={item.href} item={item} variant="side" />
      ))}
    </nav>
  );
}

function TabBar() {
  const { t } = useT();
  return (
    <nav
      aria-label={t("nav.main")}
      className="border-edge bg-panel fixed inset-x-0 bottom-0 z-30 flex gap-1 border-t-[3px] px-2 pt-1.5 pb-[calc(6px+env(safe-area-inset-bottom,0px))] md:hidden"
      data-testid="tabbar"
    >
      {NAV_ITEMS.filter((i) => !i.desktopOnly).map((item) => (
        <NavEntry key={item.href} item={item} variant="tab" />
      ))}
    </nav>
  );
}
