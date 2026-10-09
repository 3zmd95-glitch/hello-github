import { expect, test, type Page } from "@playwright/test";
import { openBrowseCategories, seedState, switchLang } from "./helpers";
import en from "../messages/feed.en.json";
import ar from "../messages/feed.ar.json";

const worker = "https://tiktok-access-fixture.example.workers.dev";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function setup(page: Page) {
  const state = {
    grant: { connected: false, advertisers: 0 },
    status: "accepted" as "accepted" | "permission" | "old-worker",
    hashtagCount: 3,
    statusHold: undefined as Promise<void> | undefined,
    probeHold: undefined as Promise<void> | undefined,
    reads: 0,
    probes: [] as string[],
    forbidden: [] as string[],
    aborted: [] as string[],
  };
  page.on("request", (request) => {
    if (
      /\/(search|discover|plan|assess-category|scan|connect|channels|playlistItems)$/.test(
        new URL(request.url()).pathname,
      )
    )
      state.forbidden.push(request.url());
  });
  page.on("requestfailed", (request) => state.aborted.push(new URL(request.url()).pathname));
  await page.route(`${worker}/**`, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const path = new URL(request.url()).pathname;
    if (path === "/tiktokads/status") {
      expect(request.method()).toBe("GET");
      expect(request.headers().authorization).toBe("Bearer fixture");
      state.reads++;
      const hold = state.statusHold;
      const grant = { ...state.grant };
      if (hold) await hold;
      // A cancelled browser request may already be closed when its delayed fixture is released.
      const reply = route.fulfill({ headers: cors, json: grant });
      return hold ? reply.catch(() => undefined) : reply;
    }
    const probe = path.match(/^\/categories\/(anime|coffee)\/native\/tt\/probe$/);
    if (probe) {
      expect(request.method()).toBe("POST");
      expect(request.postDataJSON()).toEqual({});
      expect(request.headers().authorization).toBe("Bearer fixture");
      state.probes.push(probe[1]);
      const hold = state.probeHold;
      const status = state.status;
      if (hold) await hold;
      const reply = route.fulfill({
        headers: cors,
        status: status === "old-worker" ? 404 : 200,
        json:
          status === "old-worker"
            ? { error: "not_found" }
            : {
                version: 1,
                categoryId: probe[1],
                country: "US",
                dateRange: "7DAY",
                discoveryType: "HASHTAG",
                stage: "trending_list",
                status,
                checkedAt: new Date().toISOString(),
                requests: 1,
                ...(status === "accepted"
                  ? { hashtagCount: state.hashtagCount, httpStatus: 200 }
                  : { httpStatus: 403, providerCode: 40001 }),
              },
      });
      return hold ? reply.catch(() => undefined) : reply;
    }
    return route.fulfill({
      headers: cors,
      json:
        path === "/health"
          ? { ok: true, auth: true, discover: true, tavily: true }
          : path === "/discover/usage"
            ? {
                tavily: { used: 0, limit: 1000 },
                youtube: { usedToday: 0, cap: 70 },
                connector: { usedToday: 0, cap: 60 },
              }
            : {},
    });
  });
  await page.route("https://i.ytimg.com/**", (route) => route.fulfill({ status: 404, body: "" }));
  const at = new Date().toISOString();
  await seedState(page, "/discover/", {
    settings: { lang: "en", apiKeys: { scoutUrl: worker, scoutToken: "fixture" } },
    discoverCandidates: ["anime", "coffee"].map((genreId, index) => ({
      genreId,
      obtainedAt: at,
      item: {
        platform: "yt",
        url: `https://www.youtube.com/watch?v=NativeTT00${index + 1}`,
        title: `${genreId} match cut film`,
        snippet: "",
        handle: "Fixture filmmaker",
        lang: "en",
        section: "example",
        evidence: {
          source: "youtube-api",
          caption: `${genreId} match cut film`,
          author: "Fixture filmmaker",
          observedAt: at,
          published: at,
          views: 60_000,
        },
      },
    })),
  });
  await expect(page.getByTestId("for-you-feed")).toBeVisible();
  await openBrowseCategories(page);
  await page.getByTestId("genre-anime").click();
  await expect(page.getByTestId("tiktok-native-access")).toBeVisible();
  return state;
}
async function openAccess(page: Page) {
  const access = page.getByTestId("tiktok-native-access");
  if ((await access.getAttribute("open")) === null) await access.locator("summary").click();
}

test("TikTok access is explicit and separates stored grants, native permission and backend support", async ({
  page,
}) => {
  const state = await setup(page);
  const result = page.getByTestId("tiktok-access-result");
  await expect(page.getByTestId("tiktok-native-access")).not.toHaveAttribute("open");
  expect(state.reads).toBe(0);
  expect(state.probes).toEqual([]);
  await openAccess(page);
  await page.getByTestId("browse-tab-tt").click();
  await openAccess(page);
  expect(state.reads).toBe(0);
  for (const connected of [false, true]) {
    state.grant = { connected, advertisers: 0 };
    await page.getByTestId("tiktok-access-check").click();
    await expect(result).toContainText(
      en[connected ? "feed.tiktokAccessNoAdvertiser" : "feed.tiktokAccessAbsent"],
    );
    expect(state.probes).toEqual([]);
  }
  state.grant = { connected: true, advertisers: 1 };
  await page.getByTestId("tiktok-access-check").click();
  await expect(result).toContainText(en["feed.tiktokAccessAccepted"].replace("{n}", "3"));
  await expect(result).toContainText(en["feed.tiktokAccessStored"]);
  expect(state.probes).toEqual(["anime"]);
  await expect(page.getByTestId("category-feed").getByTestId("feed-card")).toHaveCount(0);
  state.hashtagCount = 0;
  await page.getByTestId("tiktok-access-check").click();
  await expect(result).toContainText(en["feed.tiktokAccessEmpty"]);
  state.status = "permission";
  await page.getByTestId("tiktok-access-check").click();
  await expect(result).toContainText(en["feed.tiktokAccessPermission"]);
  state.status = "old-worker";
  await page.getByTestId("tiktok-access-check").click();
  await expect(result).toContainText(en["feed.tiktokAccessUpgrade"]);
  await expect(result).not.toContainText(en["feed.tiktokAccessPermission"]);
  await expect(result).not.toContainText(en["feed.tiktokAccessAbsent"]);
  expect(state.reads).toBe(6);
  expect(state.probes).toEqual(["anime", "anime", "anime", "anime"]);
  await switchLang(page, "ar");
  await expect(result).toContainText(ar["feed.tiktokAccessUpgrade"]);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
  await page.reload();
  await expect(page.getByTestId("for-you-feed")).toBeVisible();
  expect(state.reads).toBe(6);
  expect(state.probes).toHaveLength(4);
  expect(state.forbidden).toEqual([]);
});

test("TikTok access cancels category-stale status reads and ignores a cancelled late probe", async ({
  page,
}) => {
  const state = await setup(page);
  state.grant = { connected: true, advertisers: 1 };
  const status = gate();
  state.statusHold = status.promise;
  await openAccess(page);
  await page.getByTestId("tiktok-access-check").click();
  await expect.poll(() => state.reads).toBe(1);
  await expect(page.getByTestId("tiktok-access-cancel")).toBeVisible();
  await page.getByTestId("browse-category-switch").selectOption("coffee");
  state.statusHold = undefined;
  status.release();
  await expect.poll(() => state.aborted).toContain("/tiktokads/status");
  await openAccess(page);
  await expect(page.getByTestId("tiktok-access-result")).toHaveCount(0);
  expect(state.probes).toEqual([]);
  const probe = gate();
  state.probeHold = probe.promise;
  await page.getByTestId("tiktok-access-check").click();
  await expect.poll(() => state.probes).toEqual(["coffee"]);
  await page.getByTestId("tiktok-access-cancel").click();
  await expect(page.getByTestId("tiktok-access-result")).toContainText(
    en["feed.tiktokAccessCancelled"],
  );
  probe.release();
  await expect.poll(() => state.aborted).toContain("/categories/coffee/native/tt/probe");
  await page.getByTestId("browse-tab-yt").click();
  await expect(page.getByTestId("tiktok-native-access")).toHaveCount(0);
  await page.getByTestId("browse-tab-all").click();
  await openAccess(page);
  await expect(page.getByTestId("tiktok-access-result")).not.toContainText("TikTok accepted");
  expect(state.reads).toBe(2);
  expect(state.probes).toEqual(["coffee"]);
  expect(state.forbidden).toEqual([]);
});
