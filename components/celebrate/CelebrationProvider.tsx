"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import PixelScene from "@/components/game/PixelScene";
import { useAvatar } from "@/components/game/useAvatar";
import type { Badge } from "@/lib/badges";
import type { Loot } from "@/lib/chests";
import type { LText } from "@/lib/domain";
import { GEM_RULES } from "@/lib/gems";
import { useT, type I18n } from "@/lib/i18n";
import { rankFromXp, tierLabel, type RankTier } from "@/lib/rank";
import { playSound, type SoundName } from "@/lib/sound";
import { streak, totalXp, useStore } from "@/store";

/**
 * One queue for every toast and celebration, shown one at a time in the top layer (above skill sheets),
 * so a quest that levels up, masters a skill and completes the day plays its moments one after another.
 *
 * Small kinds render as a toast at the top (`data-testid="toast"`), big kinds as a full-screen celebration
 * (`data-testid="celebration"`); both carry `data-kind` so tests can drain the queue by kind.
 */

export type CelebrationKind =
  | "xp"
  | "micro"
  | "levelUp"
  | "tierUp"
  | "mastery"
  | "dayDone"
  | "gems"
  | "chestReady"
  | "chestLoot"
  | "badge"
  | "bossHit"
  | "bossDown"
  | "seasonDone"
  | "drill"
  | "focusStart"
  | "focusEnd"
  /** 📱 A post was marked as posted (payload.name = its title). */
  | "posted"
  /** 🔗 A plain informational toast: payload.name is the (already translated) text, payload.icon its icon. */
  | "notice";

export interface CelebrationPayload {
  xp?: number;
  /** Gems moved by the action (negative for a purchase). */
  gems?: number;
  level?: number;
  rank?: LText;
  tier?: RankTier;
  skill?: LText;
  streak?: number;
  /** chestLoot: what the chest held. */
  loot?: Loot;
  /** badge: the earned badge. */
  badge?: Badge;
  /** bossHit / bossDown: the boss and the damage dealt. */
  boss?: LText;
  damage?: number;
  /** seasonDone: the finished season. */
  season?: LText;
  /** focusStart: minutes; focusEnd: whether it was stopped early. */
  minutes?: number;
  early?: boolean;
  /** gems (purchase): the reward's name. notice: the toast text. */
  name?: string;
  /** notice: the icon to show (defaults to ℹ️). */
  icon?: string;
  /** Override the kind's default sound; null = silent. */
  sound?: SoundName | null;
}

interface Item {
  id: number;
  kind: CelebrationKind;
  payload: CelebrationPayload;
}

/** How long each kind stays up (ms). */
export const DURATIONS: Record<CelebrationKind, number> = {
  xp: 1500,
  micro: 1500,
  levelUp: 2500,
  tierUp: 2500,
  mastery: 3000,
  dayDone: 3000,
  gems: 1500,
  chestReady: 2000,
  chestLoot: 3000,
  badge: 3000,
  bossHit: 1500,
  bossDown: 3000,
  seasonDone: 3000,
  drill: 1500,
  focusStart: 1500,
  focusEnd: 2000,
  posted: 1500,
  notice: 2500,
};

const SOUNDS: Record<CelebrationKind, SoundName> = {
  xp: "quest",
  micro: "micro",
  levelUp: "levelUp",
  tierUp: "tierUp",
  mastery: "mastery",
  dayDone: "dayDone",
  gems: "gems",
  chestReady: "chest",
  chestLoot: "chest",
  badge: "badge",
  bossHit: "bossHit",
  bossDown: "bossDown",
  seasonDone: "mastery",
  drill: "drill",
  focusStart: "micro",
  focusEnd: "dayDone",
  posted: "quest",
  notice: "micro",
};

/** Kinds that take the whole screen. */
export const BIG: ReadonlySet<CelebrationKind> = new Set([
  "levelUp",
  "tierUp",
  "mastery",
  "dayDone",
  "chestLoot",
  "badge",
  "bossDown",
  "seasonDone",
]);

export type SceneMood = "idle" | "happy" | "celebrate";

interface CelebrateApi {
  toast(kind: CelebrationKind, payload?: CelebrationPayload): void;
  /** Make the pixel scene celebrate for ~2 s. */
  pulse(): void;
}

const CelebrateContext = createContext<CelebrateApi>({ toast: () => {}, pulse: () => {} });
const MoodContext = createContext<SceneMood>("idle");

export function useCelebrate(): CelebrateApi {
  return useContext(CelebrateContext);
}

export function useSceneMood(): SceneMood {
  return useContext(MoodContext);
}

export default function CelebrationProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Item[]>([]);
  const [mood, setMood] = useState<SceneMood>("idle");
  const nextId = useRef(1);
  const moodTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const toast = useCallback((kind: CelebrationKind, payload: CelebrationPayload = {}) => {
    const id = nextId.current++;
    setQueue((q) => [...q, { id, kind, payload }]);
  }, []);

  const pulse = useCallback(() => {
    setMood("celebrate");
    clearTimeout(moodTimer.current);
    moodTimer.current = setTimeout(() => setMood("idle"), 2000);
  }, []);

  useEffect(() => () => clearTimeout(moodTimer.current), []);

  const current = queue[0];
  const dismiss = useCallback((id: number) => {
    setQueue((q) => (q[0]?.id === id ? q.slice(1) : q));
  }, []);

  // Show the head of the queue: play its sound once, then advance after its duration.
  const played = useRef(0);
  useEffect(() => {
    if (!current) return;
    if (played.current !== current.id) {
      played.current = current.id;
      const sound =
        current.payload.sound === undefined ? SOUNDS[current.kind] : current.payload.sound;
      if (sound) playSound(sound);
    }
    const timer = setTimeout(() => dismiss(current.id), DURATIONS[current.kind]);
    return () => clearTimeout(timer);
  }, [current, dismiss]);

  const api = useMemo(() => ({ toast, pulse }), [toast, pulse]);

  return (
    <CelebrateContext.Provider value={api}>
      <MoodContext.Provider value={mood}>
        {children}
        <div aria-live="polite" role="status" className="pointer-events-none fixed inset-0 z-[80]">
          {current &&
            (BIG.has(current.kind) ? (
              <BigCelebration key={current.id} item={current} onDone={() => dismiss(current.id)} />
            ) : (
              <SmallToast key={current.id} item={current} />
            ))}
        </div>
      </MoodContext.Provider>
    </CelebrateContext.Provider>
  );
}

/** Icon and text of a small toast. */
function smallToast(item: Item, { t, L }: I18n): { icon: string; text: string } {
  const p = item.payload;
  const xp = p.xp ?? 0;
  const g = p.gems ?? 0;
  switch (item.kind) {
    case "micro":
      return {
        icon: "✨",
        text: g > 0 ? t("xp.toast.microGems", { n: xp, g }) : t("toast.micro", { n: xp }),
      };
    case "gems":
      return g < 0
        ? { icon: "💎", text: t("xp.toast.gemsSpent", { n: -g, name: p.name ?? "" }) }
        : { icon: "💎", text: t("xp.toast.gems", { n: g }) };
    case "chestReady":
      return { icon: "📦", text: t("xp.toast.chestReady") };
    case "bossHit":
      return {
        icon: "⚔️",
        text: t("xp.toast.bossHit", { n: p.damage ?? xp, boss: p.boss ? L(p.boss) : "" }),
      };
    case "drill":
      return { icon: "🔁", text: t("xp.toast.drill", { n: xp }) };
    case "focusStart":
      return { icon: "🧪", text: t("xp.toast.focusStart", { n: p.minutes ?? 25 }) };
    case "focusEnd":
      return { icon: "🧪", text: t(p.early ? "xp.toast.focusEarly" : "xp.toast.focusEnd") };
    case "posted":
      return { icon: "📱", text: t("social.toast.posted", { name: p.name ?? "" }).trim() };
    case "notice":
      return { icon: p.icon ?? "ℹ️", text: p.name ?? "" };
    default:
      return {
        icon: "✨",
        text: g > 0 ? t("xp.toast.xpGems", { n: xp, g }) : t("toast.xp", { n: xp }),
      };
  }
}

function SmallToast({ item }: { item: Item }) {
  const i18n = useT();
  const { icon, text } = smallToast(item, i18n);
  return (
    <div className="absolute inset-x-0 top-[calc(env(safe-area-inset-top,0px)+12px)] flex justify-center px-4">
      <div
        data-testid="toast"
        data-kind={item.kind}
        className="anim-toast border-edge bg-ink shadow-px flex items-center gap-2 rounded-[2px] border-[3px] px-4 py-2 font-extrabold text-[#16202c]"
      >
        <span className="anim-pop inline-block">{icon}</span>
        <span className="num text-lg">{text}</span>
      </div>
    </div>
  );
}

const PARTICLE_COLORS = ["var(--accent)", "var(--gold)", "var(--sky)", "#ff8fb3", "var(--orange)"];
const PARTICLES = Array.from({ length: 28 }, (_, i) => {
  const angle = (i / 28) * Math.PI * 2 + (i % 2 ? 0.12 : 0);
  const dist = 110 + ((i * 37) % 90);
  return {
    dx: `${Math.round(Math.cos(angle) * dist)}px`,
    dy: `${Math.round(Math.sin(angle) * dist)}px`,
    c: PARTICLE_COLORS[i % PARTICLE_COLORS.length],
    delay: `${(i % 4) * 0.06}s`,
  };
});

/** Text for a chest's loot. */
function lootText(loot: Loot | undefined, { t, L }: I18n): string {
  if (!loot) return "";
  if (loot.kind === "gems") return t("xp.loot.gems", { n: loot.amount });
  if (loot.kind === "freeze") return t("xp.loot.freeze");
  return t("xp.loot.prompt", { text: L(loot.prompt) });
}

function BigCelebration({ item, onDone }: { item: Item; onDone: () => void }) {
  const i18n = useT();
  const { t, L } = i18n;
  const xpEvents = useStore((s) => s.xpEvents);
  const completions = useStore((s) => s.completions);
  const microActions = useStore((s) => s.microActions);
  const freezesUsedOn = useStore((s) => s.freezesUsedOn);
  const bonusFreezes = useStore((s) => s.bonusFreezes);
  const avatar = useAvatar();
  const rank = useMemo(() => rankFromXp(totalXp({ xpEvents })), [xpEvents]);
  const flame = useMemo(
    () => streak({ completions, microActions, freezesUsedOn, bonusFreezes }).current,
    [completions, microActions, freezesUsedOn, bonusFreezes],
  );
  const p = item.payload;

  let big: string;
  let small: string;
  let emblem: string | null = null;
  switch (item.kind) {
    case "levelUp":
      big = t("toast.levelUpBig");
      small = t("toast.levelUpSmall", { n: p.level ?? 1 });
      if (p.rank && p.tier) small += ` · ${L(p.rank)} ${tierLabel(p.tier)}`;
      break;
    case "tierUp":
      big = t("toast.tierUpBig");
      small = t("toast.tierUpSmall", {
        rank: p.rank ? L(p.rank) : "",
        tier: p.tier ? tierLabel(p.tier) : "",
      });
      break;
    case "mastery":
      big = t("toast.masteryBig");
      small = t("toast.masterySmall", { skill: p.skill ? L(p.skill) : "", n: p.xp ?? 0 });
      break;
    case "chestLoot":
      big = t("xp.toast.chestBig");
      small = lootText(p.loot, i18n);
      emblem = p.loot?.kind === "freeze" ? "🧊" : p.loot?.kind === "prompt" ? "💡" : "💎";
      break;
    case "badge":
      big = t("xp.toast.badgeBig");
      small = t("xp.toast.badgeSmall", {
        icon: p.badge?.icon ?? "🏅",
        name: p.badge ? L(p.badge.name) : "",
        n: p.gems ?? GEM_RULES.badge,
      });
      emblem = p.badge?.icon ?? "🏅";
      break;
    case "bossDown":
      big = t("xp.toast.bossBig");
      small = t("xp.toast.bossSmall", {
        boss: p.boss ? L(p.boss) : "",
        n: p.gems ?? GEM_RULES.boss,
      });
      emblem = "💥";
      break;
    case "seasonDone":
      big = t("xp.toast.seasonBig");
      small = t("xp.toast.seasonSmall", {
        season: p.season ? L(p.season) : "",
        n: p.gems ?? GEM_RULES.season,
      });
      emblem = "🏁";
      break;
    default:
      big = t("toast.dayBig");
      small = t("toast.daySmall", { n: p.streak ?? flame });
  }

  return (
    <div
      className="anim-fade pointer-events-auto absolute inset-0 grid place-items-center bg-[rgba(5,8,12,.72)] p-4"
      onClick={onDone}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {PARTICLES.map((pt, i) => (
          <span
            key={i}
            className="px-particle"
            style={
              { "--dx": pt.dx, "--dy": pt.dy, "--c": pt.c, "--delay": pt.delay } as CSSProperties
            }
          />
        ))}
      </div>
      <div
        data-testid="celebration"
        data-kind={item.kind}
        className="px-card anim-popin relative flex w-full max-w-[380px] flex-col items-center gap-3 text-center"
      >
        <div className="border-edge bg-edge w-full overflow-hidden border-[3px]">
          <PixelScene
            rankIndex={rank.index}
            tier={rank.tier}
            streak={flame}
            mood="celebrate"
            avatar={avatar}
            className="w-full"
          />
        </div>
        {emblem && (
          <div aria-hidden className="anim-pop -mt-9 text-5xl drop-shadow-[3px_3px_0_var(--edge)]">
            {emblem}
          </div>
        )}
        <div className="font-pixel text-gold text-3xl font-bold [text-shadow:3px_3px_0_var(--edge)]">
          {big}
        </div>
        <div className="text-lg font-extrabold">{small}</div>
        <div className="text-muted text-xs">{t("toast.tap")}</div>
      </div>
    </div>
  );
}
