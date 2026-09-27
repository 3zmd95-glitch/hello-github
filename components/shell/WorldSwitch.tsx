"use client";

import { useRouter } from "next/navigation";
import { useT, type MessageKey } from "@/lib/i18n";
import { lastSocialPath, useWorld, type World } from "./useWorld";

const WORLDS: readonly { id: World; icon: string; name: MessageKey; full: MessageKey }[] = [
  { id: "training", icon: "🎮", name: "world.trainingName", full: "world.training" },
  { id: "social", icon: "📱", name: "world.socialName", full: "world.social" },
];

/**
 * The big switch between 🎮 Training and 📱 Social. Training goes home to "/";
 * Social returns to the last Social route of this session (or the Studio home).
 * Phones show the emoji only (the top bar is 390px wide); the full name is the accessible label.
 */
export default function WorldSwitch() {
  const { t } = useT();
  const world = useWorld();
  const router = useRouter();
  const pixel = world === "training";

  const go = (next: World) => {
    if (next === world) return;
    router.push(next === "social" ? lastSocialPath() : "/");
  };

  return (
    <div
      role="group"
      aria-label={t("world.switch")}
      data-testid="world-switch"
      className={
        pixel
          ? "border-edge bg-edge flex gap-[2px] rounded-[2px] border-2"
          : "border-edge bg-panel-2 flex gap-1 rounded-full border p-[3px]"
      }
    >
      {WORLDS.map((w) => {
        const on = w.id === world;
        const tone = pixel
          ? on
            ? "bg-gold text-gold-ink"
            : "bg-panel-2 text-ink-2 hover:text-ink"
          : on
            ? "bg-accent text-accent-ink"
            : "text-ink-2 hover:text-ink";
        return (
          <button
            key={w.id}
            type="button"
            aria-pressed={on}
            aria-label={t(w.full)}
            title={t(w.full)}
            onClick={() => go(w.id)}
            data-testid={`world-${w.id}`}
            className={`${pixel ? "rounded-[2px]" : "rounded-full"} flex items-center gap-1 px-2.5 py-1 text-xs font-bold whitespace-nowrap ${tone}`}
          >
            <span aria-hidden>{w.icon}</span>
            <span className="hidden sm:inline">{t(w.name)}</span>
          </button>
        );
      })}
    </div>
  );
}
