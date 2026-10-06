"use client";

import { Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import CelebrationProvider, { useCelebrate } from "@/components/celebrate/CelebrationProvider";
import VideoPlayerProvider from "@/components/player/VideoPlayerProvider";
import SkillSheetProvider from "@/components/skills/SkillSheetProvider";
import { usePublishWatcher } from "@/components/social/usePublish";
import { confirmConnected, pullIfDue, syncSocialNow } from "@/components/social/useSocialSync";
import { useChrome } from "@/components/ui/ios/chrome";
import { useScrollChrome } from "@/components/ui/ios/useScrollChrome";
import { applySocialSeed } from "@/data/social-seed";
import { useDocumentLang, useT } from "@/lib/i18n";
import { scoutConfig } from "@/lib/scoutClient";
import { PLATFORM_META } from "@/lib/social";
import { isSocialPlatform, socialErrorType, socialSyncErrorMessageKey } from "@/lib/socialSync";
import { setMuted } from "@/lib/sound";
import { hydrateStore, useStore } from "@/store";
import { activeHref, NAV_BY_WORLD, type NavItem } from "./nav";
import { rememberSocialPath, useWorld, type World } from "./useWorld";
import WorldSwitch from "./WorldSwitch";

/**
 * App shell shared by both worlds: loads saved progress, then renders the top bar (with the 🎮 / 📱 world
 * switch), the active world's phone tab bar / desktop sidebar, and the providers for the skill popup, the
 * ▶ video player (around the skill popup's, so its saved references can play too) and celebrations. The
 * world comes from the URL (`useWorld`) and is mirrored onto `<html data-world>` so the CSS tokens in
 * globals.css switch between the pixel and the iOS look.
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
        // The Beacons Sep 27, 2026 numbers go in once, so the Social Analytics page is never empty.
        applySocialSeed(useStore.getState());
        setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  useDocumentLang();
  useDocumentWorld();
  const pathname = usePathname();
  const world = useWorld();
  useScrollChrome(world === "social", pathname ?? "/");
  const sound = useStore((s) => s.settings.sound);
  useEffect(() => setMuted(!sound), [sound]);

  if (!ready) return <Splash />;

  return (
    <CelebrationProvider>
      <SocialSyncAgent />
      <VideoPlayerProvider>
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
      </VideoPlayerProvider>
    </CelebrationProvider>
  );
}

/**
 * 🔗 Live accounts: pulls the Worker's numbers (at most hourly) whenever a Social route is opened, and, when
 * the Worker sends the owner back from OAuth (`?connected=<platform>` / `?connect_error=<platform>&reason=`),
 * shows a toast, starts a sync and cleans the address bar. Also keeps running auto-posts' results fresh
 * (usePublishWatcher). Renders nothing.
 */
function SocialSyncAgent() {
  usePublishWatcher();
  const { t, L } = useT();
  const { toast } = useCelebrate();
  const world = useWorld();
  const pathname = usePathname();
  const configured = useStore(
    (s) => scoutConfig(s.settings.apiKeys.scoutUrl, s.settings.apiKeys.scoutToken) !== null,
  );

  useEffect(() => {
    if (world === "social" && configured) pullIfDue();
  }, [world, pathname, configured]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const failed = params.get("connect_error");
    if (!connected && !failed) return;
    const reason = params.get("reason");
    for (const k of ["connected", "connect_error", "reason"]) params.delete(k);
    const q = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${q ? `?${q}` : ""}${window.location.hash}`,
    );
    const name = (p: string) => (isSocialPlatform(p) ? L(PLATFORM_META[p].name) : p);
    if (connected) {
      toast("notice", { icon: "🔗", name: t("social.toast.connected", { name: name(connected) }) });
      void syncSocialNow(isSocialPlatform(connected) ? [connected] : undefined).then((r) => {
        if (r.ok) toast("notice", { icon: "🔄", name: t("social.toast.synced") });
        // The Worker's storage may lag a few seconds behind the connect: re-check until it shows up.
        if (isSocialPlatform(connected)) void confirmConnected(connected);
      });
    } else if (failed) {
      const key = socialSyncErrorMessageKey({ type: socialErrorType(reason) });
      toast("notice", {
        icon: "⚠️",
        sound: null,
        name: t("social.toast.connectError", { name: name(failed), reason: t(key) }),
      });
    }
  }, [t, L, toast]);

  return null;
}

/** Keep `<html data-world>` in sync with the route and remember the last Social route for the switch. */
function useDocumentWorld(): void {
  const world = useWorld();
  const pathname = usePathname();
  useEffect(() => {
    document.documentElement.dataset.world = world;
    if (world === "social" && pathname) rememberSocialPath(pathname);
  }, [world, pathname]);
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
  const world = useWorld();
  const look =
    world === "training"
      ? "border-edge font-pixel rounded-[2px] border-[3px] shadow-[3px_3px_0_var(--edge)]"
      : "rounded-[12px] shadow-[0_6px_18px_color-mix(in_srgb,var(--accent)_30%,transparent)]";
  return (
    <span
      aria-hidden
      className={`bg-accent text-accent-ink grid shrink-0 place-items-center font-bold ${look}`}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      3z
    </span>
  );
}

function TopBar() {
  const world = useWorld();
  return world === "social" ? <SocialTop /> : <TrainingTopBar />;
}

/**
 * Social top area (tools/18 §4): no bar at rest. Start: brand mark + the world switch as a glass capsule.
 * End: the gear in a glass circle. A glass slab with the page title fades in once the page scrolls (`data-compact`).
 * The language toggle lives in More and Settings in Social. The two side groups share the row equally, so the title
 * sits in the middle of the screen when it fits and moves toward the gear (then truncates) when it does not.
 */
function SocialTop() {
  const { t } = useT();
  const title = useChrome((s) => s.title);
  return (
    <header className="ios-top pt-safe" data-testid="social-top">
      <div className="ios-top-bg slab" aria-hidden />
      <div className="relative mx-auto flex h-14 max-w-[1180px] items-center gap-2 px-3 md:px-6">
        <div className="flex flex-1 items-center gap-2">
          <Link href="/social" className="ios-top-brand" aria-label={t("app.name")}>
            <Logo />
          </Link>
          <WorldSwitch />
        </div>
        <div className="ios-top-title" data-testid="compact-title" aria-hidden>
          {title}
        </div>
        <div className="ios-top-end flex flex-1 items-center justify-end gap-2">
          <Link
            href="/settings"
            aria-label={t("top.settings")}
            title={t("top.settings")}
            className="ios-icbtn glass"
          >
            <Settings size={20} strokeWidth={1.75} aria-hidden />
          </Link>
        </div>
      </div>
    </header>
  );
}

/** Training's pixel top bar, moved here unchanged (its Social branches are no longer reached). */
function TrainingTopBar() {
  const { t, lang } = useT();
  const world = useWorld();
  const pixel = world === "training";
  const sound = useStore((s) => s.settings.sound);
  const setSettings = useStore((s) => s.setSettings);
  return (
    <header
      className={`pt-safe border-edge bg-panel sticky top-0 z-30 ${pixel ? "border-b-[3px]" : "border-b"}`}
    >
      <div className="mx-auto flex h-14 max-w-[1180px] items-center gap-2 px-4 md:px-6">
        <Link
          href={pixel ? "/" : "/social"}
          className="text-ink flex min-w-0 items-center gap-2 no-underline"
        >
          <Logo />
          <span className="hidden font-extrabold sm:inline">
            {t("app.name")}{" "}
            <span className="text-muted text-xs font-semibold">· {t("app.tagline")}</span>
          </span>
        </Link>
        <WorldSwitch />
        <div className="ms-auto flex items-center gap-2">
          <div
            role="group"
            aria-label={t("top.lang")}
            className={
              pixel
                ? "border-edge bg-edge flex gap-[2px] rounded-[2px] border-2"
                : "border-edge bg-panel-2 flex gap-1 rounded-full border p-[3px]"
            }
          >
            {(["ar", "en"] as const).map((l) => {
              const on = lang === l;
              const tone = pixel
                ? on
                  ? "bg-gold text-gold-ink"
                  : "bg-panel-2 text-ink-2"
                : on
                  ? "bg-panel-3 text-ink"
                  : "text-ink-2";
              return (
                <button
                  key={l}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setSettings({ lang: l })}
                  className={`num ${pixel ? "" : "rounded-full"} px-2.5 py-1 text-xs font-bold ${tone}`}
                  data-testid={`lang-${l}`}
                >
                  {l.toUpperCase()}
                </button>
              );
            })}
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

function useNav(): { world: World; items: readonly NavItem[]; current?: string } {
  const world = useWorld();
  const items = NAV_BY_WORLD[world];
  return { world, items, current: activeHref(items, usePathname()) };
}

function NavEntry({
  item,
  variant,
  active,
  world,
}: {
  item: NavItem;
  variant: "side" | "tab";
  active: boolean;
  world: World;
}) {
  const { t } = useT();
  const side = variant === "side";
  const pixel = world === "training";
  if (!pixel) {
    const Icon = item.lucide;
    return (
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={side ? "ios-side-item" : "ios-tab"}
        data-active={active ? "true" : undefined}
      >
        {Icon ? (
          <Icon size={side ? 20 : 23} strokeWidth={1.75} aria-hidden />
        ) : (
          <span aria-hidden>{item.icon}</span>
        )}
        <span className="truncate">{t(item.label)}</span>
        {item.soon && (
          <span className={`ios-chip ${side ? "ms-auto" : "hidden"}`}>{t("nav.soon")}</span>
        )}
      </Link>
    );
  }
  const shape = "rounded-[2px] border-2";
  const base = side
    ? `flex items-center gap-3 ${shape} px-3 py-2 text-[0.95rem] font-semibold no-underline`
    : `flex min-w-0 flex-1 flex-col items-center gap-0.5 ${shape} px-1 py-1 text-[0.7rem] font-semibold no-underline`;
  const tone = active
    ? "border-edge bg-panel-2 text-gold shadow-[3px_3px_0_var(--edge)]"
    : "border-transparent text-ink-2 hover:bg-panel-2";
  const soon = item.soon ? "text-muted" : "";
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`${base} ${tone} ${soon}`}
    >
      <span aria-hidden className={side ? "w-6 text-center" : "text-lg leading-none"}>
        {item.icon}
      </span>
      <span className="truncate">{t(item.label)}</span>
      {item.soon && (
        <span className={`px-chip px-1 text-[0.6rem] ${side ? "ms-auto" : ""}`}>
          {t("nav.soon")}
        </span>
      )}
    </Link>
  );
}

function SideNav() {
  const { t } = useT();
  const { world, items, current } = useNav();
  return (
    <nav
      aria-label={t("nav.main")}
      className={
        world === "training"
          ? "sticky top-[calc(56px+3px+24px)] hidden h-fit w-[210px] shrink-0 flex-col gap-1 pt-6 md:flex"
          : "ios-side sticky top-[80px] hidden h-fit w-[210px] shrink-0 flex-col gap-1 pt-6 md:flex"
      }
      data-testid="sidenav"
    >
      {items.map((item) => (
        <NavEntry
          key={item.href}
          item={item}
          variant="side"
          active={item.href === current}
          world={world}
        />
      ))}
    </nav>
  );
}

function TabBar() {
  const { t } = useT();
  const { world, items, current } = useNav();
  const pixel = world === "training";
  const visible = items.filter((i) => !i.desktopOnly);
  const ref = useRef<HTMLElement>(null);
  const activeIndex = visible.findIndex((i) => i.href === current);

  // Social: the glass lens sits under the active tab; measured once per layout, moved on transform only.
  useLayoutEffect(() => {
    if (pixel) return;
    const nav = ref.current;
    const ind = nav?.querySelector<HTMLElement>("[data-indicator]");
    if (!nav || !ind) return;
    const place = () => {
      const a = nav.querySelectorAll<HTMLElement>(".ios-tab")[activeIndex];
      if (!a) return;
      ind.style.width = `${a.offsetWidth}px`;
      ind.style.setProperty("--x", `${a.offsetLeft}px`);
    };
    if (ind.style.width) {
      // Another tab: the lens glides over with a squish.
      place();
      ind.classList.remove("pulse");
      void ind.offsetWidth;
      ind.classList.add("pulse");
    } else {
      // A new lens (launch, a switch from Training, back from a route without a tab) appears in place.
      ind.style.transition = "none";
      place();
      void ind.offsetWidth; // commit the position before the transition comes back
      ind.style.transition = "";
    }
    const ro = new ResizeObserver(place);
    ro.observe(nav);
    // <html dir> flips after this effect (useDocumentLang is a passive effect) and mirrors the row without resizing it.
    const mo = new MutationObserver(place);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["dir"] });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [pixel, activeIndex, visible.length]);

  if (pixel) {
    return (
      <nav
        aria-label={t("nav.main")}
        className="border-edge bg-panel fixed inset-x-0 bottom-0 z-30 flex gap-1 border-t-[3px] px-2 pt-1.5 pb-[calc(6px+env(safe-area-inset-bottom,0px))] md:hidden"
        data-testid="tabbar"
      >
        {visible.map((item) => (
          <NavEntry
            key={item.href}
            item={item}
            variant="tab"
            active={item.href === current}
            world={world}
          />
        ))}
      </nav>
    );
  }
  // Routes without a tab (Website, Business, Replies, Automations come from More) show no lens.
  return (
    <nav
      ref={ref}
      aria-label={t("nav.main")}
      className="ios-tabbar glass md:hidden"
      data-testid="tabbar"
    >
      {activeIndex >= 0 && (
        <i className="ios-ind" data-indicator data-testid="tab-indicator" aria-hidden />
      )}
      {visible.map((item) => (
        <NavEntry
          key={item.href}
          item={item}
          variant="tab"
          active={item.href === current}
          world={world}
        />
      ))}
    </nav>
  );
}
