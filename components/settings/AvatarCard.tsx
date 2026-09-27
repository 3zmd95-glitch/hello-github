"use client";

import { useEffect, useMemo, useRef } from "react";
import PixelScene from "@/components/game/PixelScene";
import {
  AVATAR_COLORS,
  HEAD_SIZE,
  avatarPalette,
  composeHead,
  drawSprite,
  type Shade,
} from "@/components/game/sprites";
import {
  BEARD_STYLES,
  DEFAULT_AVATAR,
  GLASSES_STYLES,
  HAIR_COLORS,
  HAIR_STYLES,
  HEADWEAR_COLORS,
  HEADWEAR_STYLES,
  PANTS_COLORS,
  SHIRT_COLORS,
  SKIN_TONES,
  TEE_COLORS,
  type Avatar,
  type AvatarPart,
} from "@/lib/domain";
import { useT, type MessageKey } from "@/lib/i18n";
import { rankFromXp } from "@/lib/rank";
import { dayKey } from "@/lib/streak";
import { streak as streakOf, totalXp, useStore } from "@/store";
import Card from "./Card";

/** Rows in display order; which message namespace names the values, and whether they are colors. */
interface Row<P extends AvatarPart> {
  part: P;
  values: readonly Avatar[P][];
  labels: string;
  /** Present for color rows: the swatch table. */
  colors?: Record<string, Shade>;
  /** Only shown when this returns true (e.g. the cap / beanie color). */
  when?: (avatar: Avatar) => boolean;
}

const ROWS: readonly Row<AvatarPart>[] = [
  { part: "skin", values: SKIN_TONES, labels: "avatar.skin", colors: AVATAR_COLORS.skin },
  { part: "hair", values: HAIR_STYLES, labels: "avatar.hair" },
  {
    part: "hairColor",
    values: HAIR_COLORS,
    labels: "avatar.hairColor",
    colors: AVATAR_COLORS.hair,
  },
  { part: "beard", values: BEARD_STYLES, labels: "avatar.beard" },
  { part: "glasses", values: GLASSES_STYLES, labels: "avatar.glasses" },
  { part: "headwear", values: HEADWEAR_STYLES, labels: "avatar.headwear" },
  {
    part: "headwearColor",
    values: HEADWEAR_COLORS,
    labels: "avatar.color",
    colors: AVATAR_COLORS.headwear,
    when: (a) => a.headwear === "cap" || a.headwear === "beanie",
  },
  { part: "tee", values: TEE_COLORS, labels: "avatar.color", colors: AVATAR_COLORS.tee },
  { part: "shirt", values: SHIRT_COLORS, labels: "avatar.color", colors: AVATAR_COLORS.shirt },
  { part: "pants", values: PANTS_COLORS, labels: "avatar.color", colors: AVATAR_COLORS.pants },
];

/** Row titles: the part name key; every part has its own title even when values share a namespace. */
const TITLE_KEY: Record<AvatarPart, MessageKey> = {
  skin: "avatar.skin",
  hair: "avatar.hair",
  hairColor: "avatar.hairColor",
  beard: "avatar.beard",
  glasses: "avatar.glasses",
  headwear: "avatar.headwear",
  headwearColor: "avatar.headwearColor",
  tee: "avatar.tee",
  shirt: "avatar.shirt",
  pants: "avatar.pants",
};

function pickRandom<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

export function randomAvatar(): Avatar {
  return {
    skin: pickRandom(SKIN_TONES),
    hair: pickRandom(HAIR_STYLES),
    hairColor: pickRandom(HAIR_COLORS),
    beard: pickRandom(BEARD_STYLES),
    glasses: pickRandom(GLASSES_STYLES),
    headwear: pickRandom(HEADWEAR_STYLES),
    headwearColor: pickRandom(HEADWEAR_COLORS),
    tee: pickRandom(TEE_COLORS),
    shirt: pickRandom(SHIRT_COLORS),
    pants: pickRandom(PANTS_COLORS),
  };
}

/**
 * Settings → "Your look" (master plan round 9: the "mini you" with a headwear picker). A live scene
 * preview at the owner's current rank, then one row of options per part: color swatches for colors,
 * small pixel head icons for styles. Every button is `avatar-<part>-<value>` with aria-pressed.
 */
export default function AvatarCard() {
  const { t } = useT();
  const avatar = useStore((s) => s.settings.avatar);
  const setSettings = useStore((s) => s.setSettings);
  const xpEvents = useStore((s) => s.xpEvents);
  const completions = useStore((s) => s.completions);
  const microActions = useStore((s) => s.microActions);
  const freezesUsedOn = useStore((s) => s.freezesUsedOn);
  const bonusFreezes = useStore((s) => s.bonusFreezes);

  const rank = useMemo(() => rankFromXp(totalXp({ xpEvents })), [xpEvents]);
  const flame = useMemo(
    () => streakOf({ completions, microActions, freezesUsedOn, bonusFreezes }, dayKey()).current,
    [completions, microActions, freezesUsedOn, bonusFreezes],
  );

  const set = <P extends AvatarPart>(part: P, value: Avatar[P]) =>
    setSettings({ avatar: { ...avatar, [part]: value } });

  return (
    <Card id="avatar" title={t("avatar.title")} note={t("avatar.note")}>
      <div
        className="border-edge bg-edge mx-auto w-full max-w-[420px] overflow-hidden border-[3px]"
        aria-label={t("avatar.preview")}
      >
        <PixelScene
          rankIndex={rank.index}
          tier={rank.tier}
          streak={flame}
          mood="idle"
          avatar={avatar}
          className="w-full"
          testId="avatar-preview"
        />
      </div>

      <div className="flex flex-col gap-3" data-testid="avatar-rows">
        {ROWS.map((row) =>
          row.when && !row.when(avatar) ? null : (
            <div
              key={row.part}
              className="flex flex-col gap-1.5"
              data-testid={`avatar-row-${row.part}`}
            >
              <b className="text-sm">{t(TITLE_KEY[row.part])}</b>
              <div
                role="group"
                aria-label={t(TITLE_KEY[row.part])}
                className="flex flex-wrap gap-2"
              >
                {row.values.map((value) => {
                  const label = t(`${row.labels}.${value}` as MessageKey);
                  const pressed = avatar[row.part] === value;
                  const testId = `avatar-${row.part}-${value}`;
                  return row.colors ? (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={pressed}
                      aria-label={label}
                      title={label}
                      onClick={() => set(row.part, value)}
                      className={`border-edge size-9 shrink-0 rounded-[2px] border-[3px] ${pressed ? "outline-gold outline-[3px] outline-offset-2" : ""}`}
                      style={{ background: row.colors[value].main }}
                      data-testid={testId}
                    />
                  ) : (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={pressed}
                      onClick={() => set(row.part, value)}
                      className={`border-edge flex items-center gap-1.5 rounded-[2px] border-[3px] py-1 ps-1 pe-2.5 text-xs font-bold ${pressed ? "bg-gold text-gold-ink" : "bg-panel-2 text-ink-2"}`}
                      data-testid={testId}
                    >
                      <HeadIcon avatar={{ ...avatar, [row.part]: value }} />
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          ),
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm"
          onClick={() => setSettings({ avatar: randomAvatar() })}
          data-testid="avatar-random"
        >
          {t("avatar.random")}
        </button>
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm"
          onClick={() => setSettings({ avatar: DEFAULT_AVATAR })}
          data-testid="avatar-reset"
        >
          {t("avatar.reset")}
        </button>
      </div>
    </Card>
  );
}

const ICON_SCALE = 3;

/** A tiny pixel head preview of one option applied to the current avatar (HEAD_SIZE × HEAD_SIZE at 3×). */
function HeadIcon({ avatar }: { avatar: Avatar }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, HEAD_SIZE * ICON_SCALE, HEAD_SIZE * ICON_SCALE);
    drawSprite(ctx, composeHead(avatar), 0, 0, avatarPalette(avatar), ICON_SCALE);
  }, [avatar]);
  return (
    <canvas
      ref={ref}
      width={HEAD_SIZE * ICON_SCALE}
      height={HEAD_SIZE * ICON_SCALE}
      aria-hidden
      className="size-7 shrink-0"
      style={{ imageRendering: "pixelated" }}
    />
  );
}
