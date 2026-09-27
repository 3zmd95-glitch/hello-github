"use client";

import { useGameActions } from "@/components/celebrate/useGameActions";
import PxBar from "@/components/ui/PxBar";
import { FOCUS_MINUTES } from "@/lib/domain";
import { focusActive } from "@/lib/focus";
import { useT } from "@/lib/i18n";
import { chestProgress, useStore } from "@/store";
import { useNow } from "./useNow";

/** "mm:ss" left, counting whole seconds up. */
export function formatCountdown(remainingMs: number): string {
  const s = Math.max(0, Math.ceil(remainingMs / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** One compact row card: the focus potion (25 / 60 min, +25 % XP) and the film-canister chest (n/5). */
export default function FocusChestCard() {
  return (
    <section className="px-card grid gap-3 sm:grid-cols-2" data-testid="focus-chest">
      <FocusCard />
      <ChestBox />
    </section>
  );
}

function FocusCard() {
  const { t } = useT();
  const focus = useStore((s) => s.focus);
  const { startFocus, stopFocus } = useGameActions();
  const now = useNow(!!focus);
  const active = focus && now ? focusActive(focus, new Date(now)) : null;
  // A session that ran out stays in state until the store settles it (the next XP action or Stop).
  const ranOut = !!focus && !!now && !active;
  const state = active ? "running" : ranOut ? "done" : "idle";

  return (
    <div className="px-inset flex items-center gap-3" data-testid="focus-card" data-state={state}>
      <span aria-hidden className="text-3xl leading-none">
        🧪
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {active ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <b className="today-timer text-gold" data-testid="focus-timer">
                {formatCountdown(active.remainingMs)}
              </b>
              <span className="px-chip px-chip-gold" data-testid="focus-chip">
                <span className="num">{t("today.focus.chip")}</span>
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted text-xs">
                {t("today.focus.title")} · <span className="num">{active.minutes}</span>{" "}
                {t("today.focus.running")}
              </span>
              <button
                type="button"
                className="px-btn px-btn-ghost px-btn-sm ms-auto"
                onClick={() => stopFocus()}
                data-testid="focus-stop"
              >
                {t("today.focus.stop")}
              </button>
            </div>
          </>
        ) : ranOut ? (
          <>
            <b className="text-sm">{t("today.focus.doneTitle")}</b>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted text-xs">{t("today.focus.doneSub")}</span>
              <button
                type="button"
                className="px-btn px-btn-sm ms-auto"
                onClick={() => stopFocus()}
                data-testid="focus-collect"
              >
                {t("today.focus.collect")}
              </button>
            </div>
          </>
        ) : (
          <>
            <b className="text-sm">{t("today.focus.title")}</b>
            <span className="text-muted text-xs">{t("today.focus.sub")}</span>
            <div className="flex flex-wrap gap-2">
              {FOCUS_MINUTES.map((m, i) => (
                <button
                  key={m}
                  type="button"
                  className={`px-btn px-btn-sm ${i === 0 ? "" : "px-btn-ghost"}`}
                  onClick={() => startFocus(m)}
                  data-testid={`focus-start-${m}`}
                >
                  {t("today.focus.start", { n: m })}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ChestBox() {
  const { t } = useT();
  const completions = useStore((s) => s.completions);
  const chestsOpened = useStore((s) => s.chestsOpened);
  const { openChest } = useGameActions();
  const cp = chestProgress({ completions, chestsOpened });

  return (
    <div
      className={`px-inset flex items-center gap-3 ${cp.ready ? "border-gold" : ""}`}
      data-testid="chest-box"
      data-ready={cp.ready}
    >
      <span aria-hidden className={`text-3xl leading-none ${cp.ready ? "today-bob" : ""}`}>
        📦
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <b className="text-sm">{t("today.chest.title")}</b>
          <b className="num text-gold ms-auto text-sm" data-testid="chest-progress">
            {cp.done}/{cp.needed}
          </b>
        </div>
        {cp.ready ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-gold text-xs font-bold">
              {t("today.chest.ready")}
              {cp.pending > 1 && (
                <>
                  {" "}
                  ×<span className="num">{cp.pending}</span>
                </>
              )}
            </span>
            <button
              type="button"
              className="px-btn px-btn-gold px-btn-sm ms-auto"
              onClick={() => openChest()}
              data-testid="chest-open"
            >
              {t("today.chest.open")}
            </button>
          </div>
        ) : (
          <>
            <PxBar
              value={cp.done / cp.needed}
              color="var(--gold)"
              small
              label={t("today.chest.title")}
            />
            <span className="text-muted text-xs">{t("today.chest.sub")}</span>
          </>
        )}
      </div>
    </div>
  );
}
