import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { freshState } from "./helpers";

test("creator previews, protects edits, applies selected fields and exports production files", async ({
  page,
}) => {
  const draft = {
    hook: "Watch the light change.",
    beats: ["Place the cup by a window.", "Move your camera to the side.", "Show the final frame."],
    cta: "Try this on your next shoot.",
    caption: "A simple window-light setup.",
    hashtags: ["#تصوير"],
    shots: [
      { type: "hook", text: "Finished shot" },
      { type: "wide", text: "Window setup" },
      { type: "closeup", text: "Cup detail" },
    ],
  };
  let requests = 0;
  await page.route("https://scout.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (path === "/creator/draft") {
      requests++;
      expect(route.request().headers().authorization).toBe("Bearer fake-owner");
      const body = route.request().postDataJSON();
      expect(body.platform).toBe("tiktok");
      expect(body.brief).toBe("Show coffee with window light");
      return route.fulfill({ json: { draft }, headers });
    }
    return route.fulfill({
      json: path === "/health" ? { ok: true, tavily: true } : { status: {}, jobs: [] },
      headers,
    });
  });
  await freshState(page, "/settings/");
  await page.getByTestId("apikey-scoutUrl-input").fill("https://scout.test");
  await page.getByTestId("apikey-scoutUrl-input").press("Enter");
  await page.getByTestId("apikey-scoutToken-input").fill("fake-owner");
  await page.getByTestId("apikey-scoutToken-test").click();
  await expect(page.getByTestId("apikey-scoutToken-status")).toHaveText("اتأكد ✓");
  await page.goto("/social/calendar/");
  await page.locator('[data-testid="calendar-new"]:visible').click();
  await page.getByTestId("post-platform-tiktok").click();
  await page.getByTestId("post-title").fill("Coffee film");
  await page.getByTestId("post-template").uncheck();
  await page
    .getByTestId("post-day")
    .fill(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date()));
  await page.getByTestId("post-save").click();
  await page.getByTestId("post-card").first().locator("button").first().click();
  await page.getByTestId("post-tab-script").click();
  await page.getByTestId("creator-brief").fill("Show coffee with window light");
  await page.getByTestId("creator-generate").click();
  await expect(page.getByTestId("creator-preview")).toBeVisible();
  await expect(page.getByTestId("script-hook")).toHaveValue("");
  await expect(page.getByTestId("post-sheet")).toHaveAttribute("data-stage", "idea");
  await page.getByTestId("script-hook").fill("Keep my newest hook");
  await expect(page.getByTestId("creator-apply")).toBeDisabled();
  await expect(page.getByTestId("script-hook")).toHaveValue("Keep my newest hook");
  await page.getByTestId("creator-generate").click();
  await expect(page.getByTestId("creator-preview")).toBeVisible();
  await expect(page.getByTestId("creator-apply-script")).not.toBeChecked();
  await page.getByTestId("creator-apply-script").check();
  // New calendar posts carry default hashtags; replacing them requires explicit selection too.
  await expect(page.getByTestId("creator-apply-caption")).not.toBeChecked();
  await page.getByTestId("creator-apply-caption").check();
  await page.getByTestId("creator-apply").click();
  await expect(page.getByTestId("script-hook")).toHaveValue(draft.hook);
  await expect(page.getByTestId("creator-preview")).toBeHidden();
  await expect(page.getByTestId("post-sheet")).toHaveAttribute("data-stage", "script");
  const download = page.waitForEvent("download");
  await page.getByTestId("creator-export-pack").click();
  const productionDownload = await download;
  expect(productionDownload.suggestedFilename()).toMatch(/^post-.+-production\.txt$/);
  const productionText = readFileSync((await productionDownload.path())!, "utf8");
  expect(productionText).toContain(draft.caption);
  expect(productionText).toContain("#تصوير");
  expect(productionText).toContain(draft.shots[2].text);

  // Export after selecting a non-default duration, then inspect the real downloaded bytes.
  // Both formats must preserve all spoken words and span exactly the chosen time.
  await page.getByTestId("creator-duration").fill("47");
  for (const format of ["srt", "vtt"] as const) {
    const ready = page.waitForEvent("download");
    await page.getByRole("button", { name: new RegExp(`\\(\\.${format}\\)`) }).click();
    const subtitles = await ready;
    expect(subtitles.suggestedFilename()).toMatch(new RegExp(`^post-.+-estimated\\.${format}$`));
    const contents = readFileSync((await subtitles.path())!, "utf8");
    const header = format === "vtt" ? "WEBVTT\n\n" : "";
    if (format === "vtt") expect(contents.startsWith(header)).toBe(true);
    else expect(contents.startsWith("1\n")).toBe(true);
    const blocks = contents.slice(header.length).trim().split(/\n\n/);
    expect(blocks.length).toBeGreaterThan(1);
    let previousEnd = 0;
    const spoken: string[] = [];
    const millis = (value: string): number => {
      const [hours, minutes, seconds, milliseconds] = value.split(/[:,.]/).map(Number);
      return hours * 3_600_000 + minutes * 60_000 + seconds * 1000 + milliseconds;
    };
    for (let i = 0; i < blocks.length; i++) {
      const [number, timing, ...text] = blocks[i].split("\n");
      expect(number).toBe(String(i + 1));
      const separator = format === "srt" ? "," : "\\.";
      expect(timing).toMatch(
        new RegExp(
          `^\\d{2}:\\d{2}:\\d{2}${separator}\\d{3} --> \\d{2}:\\d{2}:\\d{2}${separator}\\d{3}$`,
        ),
      );
      const [start, end] = timing.split(" --> ").map(millis);
      expect(start).toBe(previousEnd);
      expect(end).toBeGreaterThan(start);
      previousEnd = end;
      spoken.push(text.join(" "));
    }
    expect(previousEnd).toBe(47_000);
    expect(spoken.join(" ")).toBe([draft.hook, ...draft.beats, draft.cta].join(" "));
  }
  expect(requests).toBe(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
