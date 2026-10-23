import { expect, test, type Page } from "@playwright/test";
import { REVIEWED_FORMAT_SEEDS } from "../lib/formatSeeds";
import { formatVerificationTarget } from "../lib/formatVerification";
import type { FormatObservation } from "../lib/formatObservations";
import type { FormatQueueEntry } from "../lib/formatQueue";
import { openBrowseFormats, seedState, switchLang } from "./helpers";

async function readImportState(page: Page) {
  return page.evaluate(async () => {
    const state = JSON.parse(localStorage.getItem("3z-prod-v1")!).state as {
      formatQueue?: FormatQueueEntry[];
      formatObservations?: FormatObservation[];
      inspirations?: unknown[];
      followedFormats?: unknown[];
      discoverFeedback?: unknown[];
      savedRefs?: Record<string, unknown>;
      discoverCandidates?: unknown[];
    };
    const candidates = await new Promise<unknown[]>((resolve, reject) => {
      const request = indexedDB.open("3z-prod-discover");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const read = database.transaction("candidates").objectStore("candidates").get("corpus");
        read.onerror = () => {
          database.close();
          reject(read.error);
        };
        read.onsuccess = () => {
          database.close();
          resolve(read.result?.candidates ?? []);
        };
      };
    });
    return {
      queue: state.formatQueue ?? [],
      observations: state.formatObservations ?? [],
      unrelated: {
        candidates,
        localCandidates: state.discoverCandidates ?? [],
        saved: state.inspirations ?? [],
        attached: state.savedRefs ?? {},
        preferences: state.discoverFeedback ?? [],
        followed: state.followedFormats ?? [],
      },
    };
  });
}

test("native format import queues selected leads and only checks source metadata on request", async ({
  page,
}, testInfo) => {
  const format = REVIEWED_FORMAT_SEEDS[0];
  const target = formatVerificationTarget(format);
  // Synthetic posts by separate fixture creators; these are not claims about live Instagram posts.
  const posts = ["FormatA0001", "FormatB0002", "FormatC0003"].map((id, index) => ({
    url: `https://www.instagram.com/p/${id}/`,
    author: `synthetic_format_editor_${index + 1}`,
  }));
  const sourceReads: string[] = [];
  const forbiddenPosts: string[] = [];
  await page.route("**/*", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    forbiddenPosts.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 503, json: { error: "unexpected_test_request" } });
  });
  await page.route("**/api/local-ai/**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST") return route.fallback();
    if (url.pathname !== "/api/local-ai/instagram-source")
      return route.fulfill({ status: 404, json: {} });
    const requested = url.searchParams.get("url");
    sourceReads.push(requested ?? "");
    const post = posts.find((entry) => entry.url === requested);
    expect(post).toBeDefined();
    return route.fulfill({
      json: {
        status: "available",
        url: post!.url,
        title: "Synthetic format import fixture",
        description: "Synthetic caption only; no frames or visual edit were inspected.",
        author: post!.author,
        thumbnailUrl: "",
        observedAt: new Date().toISOString(),
        provenance: "instagram-public-embed",
        audio: target.audio,
      },
    });
  });
  await seedState(
    page,
    "/discover/#discover-import=" +
      encodeURIComponent(
        JSON.stringify({ version: 1, platform: "ig", urls: posts.map((post) => post.url) }),
      ),
    { settings: { lang: "en" } },
  );
  const before = await readImportState(page);
  const review = page.getByTestId("native-import-review");
  await expect(review).toBeVisible();
  await expect(review.getByTestId("native-import-destination")).toHaveValue("category");
  await review.getByTestId("native-import-destination").selectOption("format");
  await review.getByTestId("native-import-format").selectOption(format.key);
  await expect(review.getByRole("checkbox")).toHaveCount(3);
  await review.getByRole("checkbox").nth(1).uncheck();
  await expect(review.getByTestId("native-import-confirm")).toHaveText("Add 2 selected videos");
  expect(sourceReads).toEqual([]);
  expect(forbiddenPosts).toEqual([]);
  await review.getByTestId("native-import-confirm").click();

  const inspector = page.getByTestId("format-inspector");
  await expect(page.getByTestId("inspiration-explore")).toHaveAttribute("aria-pressed", "true");
  await expect(inspector).toHaveAttribute("open", "");
  await expect(inspector.locator("select").first()).toHaveValue(JSON.stringify(target));
  const rows = inspector.getByTestId("format-pending-review").getByTestId("format-queued-post");
  await expect(rows).toHaveCount(2);
  expect(new URL(page.url()).hash).toBe("");
  const queued = await readImportState(page);
  expect(queued.queue.map((entry) => entry.url)).toEqual([posts[0].url, posts[2].url]);
  for (const entry of queued.queue) {
    expect(Object.keys(entry).sort()).toEqual(["addedAt", "target", "url"]);
    expect(entry.target).toEqual(target);
    expect(Number.isFinite(Date.parse(entry.addedAt))).toBe(true);
  }
  expect(queued.observations).toEqual([]);
  expect(queued.unrelated).toEqual(before.unrelated);

  await rows.first().getByTestId("format-open-candidate").click();
  await expect(inspector.getByTestId("format-check-url")).toHaveValue(posts[0].url);
  expect(sourceReads).toEqual([]);
  expect(forbiddenPosts).toEqual([]);
  await inspector.getByTestId("format-check-source").click();
  await expect(inspector.getByTestId("format-source-result")).toContainText(
    "The displayed audio matches",
  );
  await expect(inspector.getByTestId("format-visual-result")).toHaveCount(0);
  await expect(rows.first()).toContainText("Caption and audio checked; frames not checked.");
  expect(sourceReads).toEqual([posts[0].url]);
  const checked = await readImportState(page);
  expect(checked.queue).toEqual(queued.queue);
  expect(checked.observations).toHaveLength(1);
  expect(checked.observations[0]).toMatchObject({ target, url: posts[0].url });
  expect(checked.observations[0].source.audio).toEqual(target.audio);
  expect(checked.observations[0].inspection).toBeUndefined();
  expect(checked.unrelated).toEqual(before.unrelated);

  for (const lang of ["ar", "en"] as const) {
    await switchLang(page, lang);
    await expect(rows).toHaveCount(2);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
  }
  await page.reload();
  await openBrowseFormats(page);
  if ((await inspector.getAttribute("open")) === null)
    await inspector.locator(":scope > summary").click();
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Caption and audio checked; frames not checked.");
  expect(sourceReads).toEqual([posts[0].url]);
  expect(forbiddenPosts).toEqual([]);
  await rows.first().getByTestId("format-open-candidate").click();
  await expect(inspector.getByTestId("format-check-url")).toHaveValue(posts[0].url);
  await expect(inspector.getByTestId("format-check-reused")).toContainText("No new check was run");
  await expect(inspector.getByTestId("format-source-result")).toContainText(
    "The displayed audio matches",
  );
  await expect(inspector.getByTestId("format-visual-result")).toHaveCount(0);
  expect(await readImportState(page)).toEqual(checked);
  expect(sourceReads).toEqual([posts[0].url]);
  expect(forbiddenPosts).toEqual([]);
  await inspector.screenshot({ path: testInfo.outputPath("synthetic-format-import.png") });
});
