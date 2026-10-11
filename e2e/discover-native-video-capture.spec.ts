import { expect, test as base, type Page } from "@playwright/test";
import type { CapturedVideoReviewRequest } from "../lib/discoverVisual";
import {
  capturedReviewResponseFixture,
  nativeCaptureFixture,
} from "../lib/nativeVideoCapture.fixture";
import type { NativeVideoCapture } from "../lib/nativeVideoCapture";
import type { DiscoverCandidate } from "../lib/discoverFeed";
import { openBrowseCategories, seedState, switchLang } from "./helpers";

type ReviewResponse = Awaited<ReturnType<typeof capturedReviewResponseFixture>>;
type CaptureApi = {
  requests: CapturedVideoReviewRequest[];
  sourceReads: string[];
  responses: ReviewResponse[];
  mode: "success" | "failure" | "hold";
  release?: () => void;
  settled?: Promise<void>;
};

// This fixture never reaches a subscription, search service or native platform.
const test = base.extend<{ captureApi: CaptureApi }>({
  captureApi: async ({ page, baseURL }, runTests) => {
    const unexpected: string[] = [];
    const api: CaptureApi = { requests: [], sourceReads: [], responses: [], mode: "success" };
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin === new URL(baseURL!).origin) return route.fallback();
      // Existing app fonts are unrelated to this flow; keep their stylesheet local too.
      if (
        url.hostname === "fonts.googleapis.com" &&
        route.request().resourceType() === "stylesheet"
      )
        return route.fulfill({ contentType: "text/css", body: "" });
      unexpected.push(route.request().url());
      return route.abort("blockedbyclient");
    });
    await page.route("**/api/local-ai/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/local-ai/status" && request.method() === "GET")
        return route.fulfill({
          json: {
            available: true,
            providers: {
              chatgpt: {
                connected: true,
                sharing: true,
                accountId: "capture-fixture-account",
                models: [
                  { id: "other-model", name: "Other model", efforts: ["high"] },
                  { id: "gpt-6-astra", name: "GPT-6 Astra", efforts: ["medium", "max"] },
                ],
              },
              claude: { connected: false, models: [] },
            },
          },
        });
      if (path === "/api/local-ai/tiktok-source" && request.method() === "GET") {
        const url = new URL(request.url()).searchParams.get("url") ?? "";
        api.sourceReads.push(url);
        // A newly saved card may look up its thumbnail; reuse exactly its reviewed source.
        const source = api.responses.find((response) => response.source.url === url)?.source;
        if (source) return route.fulfill({ json: source });
      }
      if (path !== "/api/local-ai/review-captured-video" || request.method() !== "POST") {
        unexpected.push(`${request.method()} ${path}`);
        return route.fulfill({ status: 404, json: {} });
      }
      const body = request.postDataJSON() as CapturedVideoReviewRequest;
      api.requests.push(body);
      if (api.mode === "failure")
        return route.fulfill({ status: 502, json: { error: "assessment_failed" } });
      const response = await capturedReviewResponseFixture(body);
      // Enough source engagement for Inspiration, below Popular's independent threshold.
      response.source.likes = 750;
      response.source.views = 15_000;
      api.responses.push(response);
      let finish: (() => void) | undefined;
      if (api.mode === "hold") {
        api.settled = new Promise<void>((resolve) => {
          finish = resolve;
        });
        await new Promise<void>((resolve) => {
          api.release = resolve;
        });
      }
      try {
        await route.fulfill({ json: response });
      } catch (error) {
        // A cancelled fetch may already be gone when the intentionally late receipt arrives.
        if (!request.failure() && !page.isClosed()) throw error;
      } finally {
        finish?.();
      }
    });
    await runTests(api);
    api.release?.();
    await api.settled;
    expect(unexpected).toEqual([]);
  },
});

async function readSaved(page: Page) {
  return page.evaluate(async () => {
    const state = JSON.parse(localStorage.getItem("3z-prod-v1")!).state;
    const candidates = await new Promise<DiscoverCandidate[]>((resolve, reject) => {
      const open = indexedDB.open("3z-prod-discover");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const database = open.result;
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
      candidates,
      unrelated: {
        inspirations: state.inspirations ?? [],
        feedback: state.discoverFeedback ?? [],
        savedRefs: state.savedRefs ?? {},
      },
      localStorage: JSON.stringify(localStorage),
    };
  });
}

async function openCapture(page: Page) {
  await seedState(page, "/discover/#video-capture", { settings: { lang: "en" } });
  const review = page.getByTestId("native-video-review");
  await expect(review).toHaveAttribute("open", "");
  await expect(review.getByTestId("native-video-model")).toHaveText("ChatGPT · gpt-6-astra · max");
  return review;
}

async function importCapture(page: Page): Promise<NativeVideoCapture> {
  const capture = nativeCaptureFixture();
  // Real, decodable synthetic JPEGs prove the browser previews pixels, not just a file label.
  const images = await page.evaluate(() =>
    ["#704123", "#c79157"].map((color) => {
      const canvas = document.createElement("canvas");
      canvas.width = 48;
      canvas.height = 64;
      const context = canvas.getContext("2d")!;
      context.fillStyle = color;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#ffffff";
      context.fillRect(12, 20, 24, 28);
      return canvas.toDataURL("image/jpeg", 0.8);
    }),
  );
  capture.frames.forEach((frame, index) => {
    frame.dataUrl = images[index];
  });
  await page.getByTestId("native-video-file").setInputFiles({
    name: "synthetic-tiktok-capture.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(capture)),
  });
  await expect(page.getByTestId("native-video-preview").locator("img")).toHaveCount(2);
  await expect
    .poll(() =>
      page
        .getByTestId("native-video-preview")
        .locator("img")
        .evaluateAll((images) =>
          images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
        ),
    )
    .toBe(true);
  return capture;
}

test("import previews local screenshots in both languages without reviewing or saving a candidate", async ({
  page,
  captureApi,
}) => {
  const review = await openCapture(page);
  const before = await readSaved(page);
  const capture = await importCapture(page);
  await expect(review.getByRole("link", { name: capture.url, exact: true })).toHaveAttribute(
    "href",
    capture.url,
  );
  await expect(review.getByTestId("native-video-check")).toBeDisabled();
  await review.getByTestId("native-video-category").selectOption("coffee");
  await expect(review.getByTestId("native-video-check")).toBeEnabled();
  for (const lang of ["ar", "en"] as const) {
    await switchLang(page, lang);
    await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
    await expect(review.getByTestId("native-video-preview").locator("img")).toHaveCount(2);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
  }
  expect(captureApi.requests).toEqual([]);
  expect(captureApi.sourceReads).toEqual([]);
  const previewed = await readSaved(page);
  expect(previewed.candidates).toEqual(before.candidates);
  expect(previewed.unrelated).toEqual(before.unrelated);
  expect(previewed.localStorage).not.toContain("data:image");
  await review.getByTestId("native-video-clear").click();
  await expect(review.getByTestId("native-video-preview")).toHaveCount(0);
  await importCapture(page);
  await page.reload();
  await expect(page.locator("#main")).toBeVisible();
  await expect(page.getByTestId("native-video-preview")).toHaveCount(0);
  expect((await readSaved(page)).candidates).toEqual(before.candidates);
  expect(captureApi.requests).toEqual([]);
  expect(captureApi.sourceReads).toEqual([]);
});

test("one explicit Astra max review keeps exact source and screenshot receipt without persisting pixels", async ({
  page,
  captureApi,
}) => {
  const review = await openCapture(page);
  const before = await readSaved(page);
  const capture = await importCapture(page);
  await review.getByTestId("native-video-category").selectOption("coffee");
  await review.getByTestId("ai-model").selectOption("gpt-6-astra");
  await review.getByTestId("ai-effort").selectOption("max");
  expect(captureApi.requests).toEqual([]);
  await review.getByRole("button", { name: "Check with ChatGPT", exact: true }).click();
  await expect(review.getByTestId("native-video-status")).toContainText("Assessment saved");
  expect(captureApi.requests).toEqual([
    {
      provider: "chatgpt",
      model: "gpt-6-astra",
      effort: "max",
      accountId: "capture-fixture-account",
      genreId: "coffee",
      lang: "en",
      allowModel: true,
      capture,
    },
  ]);
  await expect(review.getByTestId("native-video-preview")).toHaveCount(0);
  await expect.poll(async () => (await readSaved(page)).candidates.length).toBe(1);
  const saved = await readSaved(page);
  const response = captureApi.responses[0];
  expect(saved.candidates[0]).toMatchObject({
    genreId: "coffee",
    origin: "manual",
    item: {
      url: capture.url,
      platform: "tt",
      evidence: {
        source: "tiktok-public-page",
        caption: response.source.caption,
        author: response.source.author,
        observedAt: response.source.observedAt,
        likes: response.source.likes,
        views: response.source.views,
      },
    },
    visual: response.visual,
  });
  expect(JSON.stringify(saved)).not.toContain("data:image");
  expect(JSON.stringify(saved)).not.toContain("videoSha256");
  expect(saved.unrelated).toEqual(before.unrelated);
  const card = page.getByTestId("category-feed").getByTestId("feed-card");
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId("feed-source-note")).toContainText(
    "Selected browser screenshots reviewed",
  );
  await card.getByTestId("feed-why").locator("summary").click();
  const evidence = card.getByTestId("feed-visual-evidence");
  await expect(evidence).toContainText("gpt-6-astra · max");
  await expect(evidence).toContainText("0.0s");
  await expect(evidence).toContainText("6.0s");
  await expect(evidence).toContainText("does not review the full video, motion, audio");
  await page.getByTestId("feed-mode-popular").click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await openBrowseCategories(page);
  await page.getByTestId("genre-coffee").click();
  await expect(page.getByTestId("category-feed").getByTestId("feed-card")).toHaveCount(1);
  expect((await readSaved(page)).candidates).toEqual(saved.candidates);
  expect(captureApi.requests).toHaveLength(1);
  expect(captureApi.sourceReads.every((url) => url === capture.url)).toBe(true);
});

test("failed and cancelled replacement reviews preserve the prior saved evidence", async ({
  page,
  captureApi,
}) => {
  const review = await openCapture(page);
  await importCapture(page);
  await review.getByTestId("native-video-category").selectOption("coffee");
  await review.getByTestId("native-video-check").click();
  await expect(review.getByTestId("native-video-status")).toContainText("Assessment saved");
  await expect.poll(async () => (await readSaved(page)).candidates.length).toBe(1);
  const prior = await readSaved(page);

  captureApi.mode = "failure";
  await importCapture(page);
  await review.getByTestId("native-video-check").click();
  await expect(review.getByRole("alert")).toContainText("previous assessment is unchanged");
  await expect(review.getByTestId("native-video-preview")).toBeVisible();
  expect((await readSaved(page)).candidates).toEqual(prior.candidates);
  expect(captureApi.requests).toHaveLength(2);

  captureApi.mode = "hold";
  await review.getByTestId("native-video-check").click();
  await expect.poll(() => captureApi.release).toBeDefined();
  await expect(review.getByTestId("native-video-check")).toBeDisabled();
  const aborted = page.waitForEvent("requestfailed", {
    predicate: (request) => request.url().endsWith("/api/local-ai/review-captured-video"),
  });
  await review.getByTestId("native-video-clear").click();
  await aborted;
  captureApi.release!();
  await captureApi.settled;
  await expect(review.getByTestId("native-video-preview")).toHaveCount(0);
  expect((await readSaved(page)).candidates).toEqual(prior.candidates);
  await page.reload();
  await expect(page.locator("#main")).toBeVisible();
  const after = await readSaved(page);
  expect(after.candidates).toEqual(prior.candidates);
  expect(after.unrelated).toEqual(prior.unrelated);
  expect(JSON.stringify(after)).not.toContain("data:image");
  expect(captureApi.requests).toHaveLength(3);
});
