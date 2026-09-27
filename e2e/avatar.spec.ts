import fs from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { AVATAR_COLORS } from "../components/game/sprites";
import { freshState } from "./helpers";

/**
 * Scene geometry (components/game/PixelScene.tsx): a 72×32 logical scene drawn at ×4, the avatar's
 * feet on FLOOR_Y = 24 and its 8×8 head at (AVATAR_X = 30, FLOOR_Y − 18 = 6). Row 4 / col 2 of the head is
 * a cheek that stays skin for every hair, beard and headwear; the torso's second row shows the tee at rank 0.
 */
const SCALE = 4;
const AVATAR_X = 30;
const HEAD_Y = 24 - 18;
const CHEEK = { x: AVATAR_X + 2, y: HEAD_Y + 4 };
const TORSO = { x: AVATAR_X + 4, y: HEAD_Y + 8 + 1 };

async function pixel(page: Page, selector: string, at: { x: number; y: number }): Promise<string> {
  await page.locator(selector).waitFor();
  return page.evaluate(
    ([sel, x, y, scale]) => {
      const canvas = document.querySelector(sel) as HTMLCanvasElement | null;
      if (!canvas) throw new Error(`no canvas for ${sel}`);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      // Sample the middle of the scaled pixel.
      const d = ctx.getImageData(x * scale + 1, y * scale + 1, 1, 1).data;
      return `#${[d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    },
    [selector, at.x, at.y, SCALE] as const,
  );
}

const PREVIEW = '[data-testid="avatar-preview"]';
const TODAY_SCENE = '[data-testid="scene"] canvas';

test("the look card starts with the owner's defaults pressed", async ({ page }) => {
  await freshState(page, "/settings/");
  await expect(page.getByTestId("avatar-preview")).toBeVisible();
  for (const id of [
    "avatar-skin-tan",
    "avatar-hair-short",
    "avatar-hairColor-black",
    "avatar-beard-full",
    "avatar-glasses-square",
    "avatar-headwear-none",
    "avatar-tee-black",
    "avatar-shirt-olive",
    "avatar-pants-navy",
  ]) {
    await expect(page.getByTestId(id), id).toHaveAttribute("aria-pressed", "true");
  }
  await expect(page.getByTestId("avatar-skin-dark")).toHaveAttribute("aria-pressed", "false");
  // The cap / beanie color row only appears once one of them is worn.
  await expect(page.getByTestId("avatar-row-headwearColor")).toHaveCount(0);
  expect(await pixel(page, PREVIEW, CHEEK)).toBe(AVATAR_COLORS.skin.tan.main);
  expect(await pixel(page, PREVIEW, TORSO)).toBe(AVATAR_COLORS.tee.black.main);
});

test("picking options repaints the preview, persists, shows on Today, and resets", async ({
  page,
}) => {
  await freshState(page, "/settings/");
  const skinBefore = await pixel(page, PREVIEW, CHEEK);
  const torsoBefore = await pixel(page, PREVIEW, TORSO);

  await page.getByTestId("avatar-skin-dark").click();
  await page.getByTestId("avatar-headwear-shemagh").click();
  await page.getByTestId("avatar-tee-white").click();
  await expect(page.getByTestId("avatar-skin-dark")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("avatar-headwear-shemagh")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("avatar-tee-white")).toHaveAttribute("aria-pressed", "true");

  await expect.poll(() => pixel(page, PREVIEW, CHEEK)).toBe(AVATAR_COLORS.skin.dark.main);
  expect(await pixel(page, PREVIEW, CHEEK)).not.toBe(skinBefore);
  await expect.poll(() => pixel(page, PREVIEW, TORSO)).toBe(AVATAR_COLORS.tee.white.main);
  expect(await pixel(page, PREVIEW, TORSO)).not.toBe(torsoBefore);

  // Survives a reload.
  await page.reload();
  await expect(page.getByTestId("avatar-skin-dark")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("avatar-headwear-shemagh")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("avatar-tee-white")).toHaveAttribute("aria-pressed", "true");

  // Today's scene shows the same look.
  await page.goto("/");
  await expect.poll(() => pixel(page, TODAY_SCENE, CHEEK)).toBe(AVATAR_COLORS.skin.dark.main);
  expect(await pixel(page, TODAY_SCENE, TORSO)).toBe(AVATAR_COLORS.tee.white.main);

  // Default restores everything.
  await page.goto("/settings/");
  await page.getByTestId("avatar-reset").click();
  await expect(page.getByTestId("avatar-skin-tan")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("avatar-headwear-none")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("avatar-tee-black")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => pixel(page, PREVIEW, CHEEK)).toBe(AVATAR_COLORS.skin.tan.main);
});

test("a cap shows its color row and random picks a valid look", async ({ page }) => {
  await freshState(page, "/settings/");
  await page.getByTestId("avatar-headwear-cap").click();
  await expect(page.getByTestId("avatar-row-headwearColor")).toBeVisible();
  await expect(page.getByTestId("avatar-headwearColor-green")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByTestId("avatar-headwearColor-red").click();
  await expect(page.getByTestId("avatar-headwearColor-red")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByTestId("avatar-random").click();
  // Exactly one option is pressed in every visible row.
  for (const row of await page.locator('[data-testid^="avatar-row-"]').all()) {
    await expect(row.locator('button[aria-pressed="true"]')).toHaveCount(1);
  }
  await expect(page.getByTestId("avatar-preview")).toBeVisible();
});

test("the export file carries the avatar", async ({ page }) => {
  await freshState(page, "/settings/");
  await page.getByTestId("avatar-skin-brown").click();
  await page.getByTestId("avatar-headwear-ghutra").click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export").click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  const text = await fs.readFile(path!, "utf-8");
  expect(text).toContain('"avatar"');
  const json = JSON.parse(text);
  expect(json.state.settings.avatar).toMatchObject({ skin: "brown", headwear: "ghutra" });
});
