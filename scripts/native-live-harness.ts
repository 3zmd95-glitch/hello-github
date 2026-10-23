/**
 * Local live harness for the Discover native search helper (packet 24).
 *
 *   pnpm build
 *   pnpm exec tsx scripts/native-live-harness.ts --skills "clone effect,speed ramp" --mode quiet|deep|both --out run.json
 *
 * Serves `out/` on 127.0.0.1:3100 (never 3000), launches a HEADED browser with a fresh temporary profile and a
 * temporary copy of extensions/discover-import, opens Discover on http://localhost:3100/discover/ and runs each
 * skill through the Search tab's CapCut and DaVinci Resolve sections against the real public
 * Instagram/TikTok/YouTube search pages. Never logs in, never uses the owner's profile or cookies.
 *
 * The copy differs from the real helper in two harness-only lines (recorded in the JSON as `harnessPatches`):
 * the helper trusts only http://localhost:3000/discover/, so the copy trusts :3100 instead; and the optional
 * host permissions need a click on Chrome's own permission prompt (not grantable by automation), so the copy
 * declares them as host_permissions, which an unpacked install grants at load.
 *
 * Unless --os-focus is passed, the run also emulates "the owner keeps Chrome in front" (packet 25): the owner
 * works in other apps on this desktop during runs, which takes OS focus from the harness window. The copy's
 * background.js reports the Discover window as focused and ignores focus moving to a non-Chrome app, and Chrome
 * runs with native window occlusion off so its selected tab renders while another app covers it. Tab
 * activation, tab URLs, owned-tab checks and restoration stay real; inactive tabs stay hidden and throttled.
 *
 * --sounds (packet 26) serves `out/` through the app's own local server (its AI providers stubbed offline) so the
 * public Instagram embed / TikTok page reads that enrich cards run, waits after each search until those reads
 * drain, counts how many reads named a sound, and finally reads Discover Browse's "Trending sounds in edits".
 *
 * --refresh-sounds (packet 27, implies --sounds; --skills becomes optional) then presses Browse's "Refresh
 * trending sounds" (quiet TikTok + Instagram searches for the fixed edit queries, one after another) and waits
 * for it to finish before reading the block.
 */
import { createServer, type Server } from "node:http";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import handler from "serve-handler";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { createLocalAiServer } from "./local-ai/server";
import { LocalAiProviderError, type LocalAiProvider } from "./local-ai/types";
import { trendingSounds, type SoundObservation } from "../lib/trendingSounds";
import { postedAt } from "../workers/scout/src/postDate";

const ROOT = resolve(__dirname, "..");
const PLATFORMS = ["ig", "tt", "yt"] as const;
const SETTLE_MS = 5 * 60 * 1000;

function args() {
  const get = (name: string, fallback?: string) => {
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 ? process.argv[index + 1] : fallback;
  };
  const skills = (get("skills") ?? "")
    .split(",")
    .map((skill) => skill.trim())
    .filter(Boolean);
  const mode = get("mode", "quiet")!;
  const out = get("out");
  const port = Number(get("port", "3100"));
  const browser = get("browser", "auto")!;
  const profile = get("profile");
  const osFocus = process.argv.includes("--os-focus");
  const refreshSounds = process.argv.includes("--refresh-sounds");
  const sounds = refreshSounds || process.argv.includes("--sounds");
  if ((!skills.length && !refreshSounds) || !out || !["quiet", "deep", "both"].includes(mode))
    throw new Error(
      'Usage: --skills "a,b" --mode quiet|deep|both --out <file> [--port 3100] [--sounds] [--refresh-sounds]',
    );
  if (port === 3000) throw new Error("Port 3000 is the owner's live app; use another port.");
  return {
    skills,
    modes: mode === "both" ? ["quiet", "deep"] : [mode],
    out,
    port,
    browser,
    profile,
    osFocus,
    sounds,
    refreshSounds,
  };
}

/** The local server's AI planners are never used by the harness. */
const OFFLINE: LocalAiProvider = {
  status: async () => ({ connected: false, models: [] }),
  connect: async () => {
    throw new LocalAiProviderError("not_connected");
  },
  disconnect: async () => {},
  plan: async () => {
    throw new LocalAiProviderError("not_connected");
  },
};

function serve(port: number, localAi = false): Promise<Server> {
  const out = join(ROOT, "out");
  if (!existsSync(join(out, "discover", "index.html")))
    throw new Error("out/discover/index.html is missing: run `pnpm build` first.");
  const server = localAi
    ? createLocalAiServer({ rootDir: out, providers: { chatgpt: OFFLINE, claude: OFFLINE } })
    : createServer((req, res) =>
        handler(req, res, {
          public: out,
          cleanUrls: true,
          trailingSlash: true,
          directoryListing: false,
        }),
      );
  return new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () => done(server));
  });
}

/** A temporary helper copy with the two harness-only patches described above. */
function helperCopy(port: number, emulateFocus: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "native-harness-ext-"));
  cpSync(join(ROOT, "extensions", "discover-import"), dir, { recursive: true });
  const manifestPath = join(dir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.host_permissions = manifest.optional_host_permissions;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const protocolPath = join(dir, "native-protocol.js");
  const protocol = readFileSync(protocolPath, "utf8");
  if (!protocol.includes('"http://localhost:3000"')) throw new Error("Helper origin check moved.");
  writeFileSync(
    protocolPath,
    protocol.replace('"http://localhost:3000"', `"http://localhost:${port}"`),
  );
  const patches = [
    `native-protocol.js trusted origin http://localhost:3000 -> http://localhost:${port}`,
    "manifest.json host_permissions = optional_host_permissions (Chrome's permission prompt cannot be clicked by automation)",
  ];
  if (emulateFocus) {
    const backgroundPath = join(dir, "background.js");
    const background = readFileSync(backgroundPath, "utf8");
    const create = "createNativeSearchService(chrome)";
    const focusEvent = "(windowId) => service.onWindowFocusChanged(windowId)";
    if (!background.includes(create) || !background.includes(focusEvent))
      throw new Error("Helper background wiring moved.");
    const api =
      "{ tabs: chrome.tabs, scripting: chrome.scripting, storage: chrome.storage, alarms: chrome.alarms, " +
      "permissions: chrome.permissions, windows: { getLastFocused: async (...a) => " +
      "({ ...(await chrome.windows.getLastFocused(...a)), focused: true }) } }";
    writeFileSync(
      backgroundPath,
      background
        .replace(create, `createNativeSearchService(${api})`)
        .replace(
          focusEvent,
          "(windowId) => windowId !== chrome.windows.WINDOW_ID_NONE && service.onWindowFocusChanged(windowId)",
        ),
    );
    patches.push(
      "background.js emulates the owner keeping Chrome in front: windows.getLastFocused reports focused, focus moving to a non-Chrome app (WINDOW_ID_NONE) is ignored; Chrome runs with CalculateNativeWinOcclusion off",
    );
  }
  return { dir, version: manifest.version as string, patches };
}

// Real Chrome throttles background tabs; keep that, unlike Playwright's defaults.
const KEEP_REAL_BACKGROUND = [
  "--disable-extensions",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
];

async function launch(
  extension: string,
  choice: string,
  kept: string | undefined,
  emulateFocus: boolean,
) {
  const profile = kept ? resolve(kept) : mkdtempSync(join(tmpdir(), "native-harness-profile-"));
  const common = {
    headless: false,
    viewport: null,
    ignoreDefaultArgs: KEEP_REAL_BACKGROUND,
  };
  if (choice !== "chrome") {
    try {
      const context = await chromium.launchPersistentContext(profile, {
        ...common,
        args: [
          `--disable-extensions-except=${extension}`,
          `--load-extension=${extension}`,
          "--window-size=1400,950",
        ],
      });
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
      return { context, profile, id: new URL(worker.url()).host, browser: "playwright-chromium" };
    } catch (error) {
      if (choice === "chromium") throw error;
      console.warn(
        `Bundled Chromium failed (${String(error).split("\n")[0]}); using installed Chrome.`,
      );
    }
  }
  // Chrome 137+ ignores --load-extension; its DevTools protocol can still load an unpacked extension.
  const context = await chromium.launchPersistentContext(profile, {
    ...common,
    channel: "chrome",
    args: [
      "--enable-unsafe-extension-debugging",
      "--window-size=1400,950",
      ...(emulateFocus ? ["--disable-features=CalculateNativeWinOcclusion"] : []),
    ],
  });
  const session = await context.browser()!.newBrowserCDPSession();
  const { id } = (await session.send(
    "Extensions.loadUnpacked" as never,
    {
      path: extension,
    } as never,
  )) as { id: string };
  return { context, profile, id, browser: `chrome ${context.browser()!.version()}` };
}

async function windowOf(context: BrowserContext, page: Page): Promise<number | null> {
  try {
    const session = await context.newCDPSession(page);
    const { windowId } = (await session.send("Browser.getWindowForTarget")) as { windowId: number };
    await session.detach().catch(() => {});
    return windowId;
  } catch {
    return null;
  }
}

/** Records every message the app sends to the helper and the helper's answer (the app's own polls).
 * Plain JS text: tsx's name helpers would break a serialized function inside the page. */
const RECORD_HELPER_MESSAGES = `(() => {
  window.__helperLog = [];
  const wrap = () => {
    const runtime = window.chrome && window.chrome.runtime;
    if (!runtime || !runtime.sendMessage || runtime.__wrapped) return;
    const original = runtime.sendMessage.bind(runtime);
    const wrapped = (id, message, callback) =>
      original(id, message, (response) => {
        window.__helperLog.push({ at: Date.now(), message, response });
        if (callback) callback(response);
      });
    try { runtime.sendMessage = wrapped; } catch { Object.defineProperty(runtime, "sendMessage", { value: wrapped }); }
    runtime.__wrapped = true;
  };
  wrap();
  const timer = setInterval(wrap, 50);
  setTimeout(() => clearInterval(timer), 20000);
})();`;

type HelperEntry = {
  at: number;
  message: { type?: string; jobId?: string; deep?: boolean; queries?: Record<string, string> };
  response: {
    ok?: boolean;
    jobId?: string;
    status?: string;
    error?: string;
    diagnostics?: Record<string, unknown>;
    platforms?: Record<
      string,
      {
        status: string;
        error?: string;
        noResults?: boolean;
        results: unknown[];
        diagnostics?: Record<string, unknown>;
      }
    >;
  };
};

async function cacheCounts(page: Page) {
  return page.evaluate(
    () =>
      new Promise<Record<string, Record<string, number>>>((done) => {
        const request = indexedDB.open("3z-prod-native-search");
        request.onerror = () => done({});
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("categories")) return done({});
          const get = db
            .transaction("categories", "readonly")
            .objectStore("categories")
            .get("recent");
          get.onerror = () => done({});
          get.onsuccess = () => {
            const counts: Record<string, Record<string, number>> = {};
            for (const entry of (get.result ?? []) as {
              genreId: string;
              platforms: Record<string, { results: unknown[] }>;
            }[])
              counts[entry.genreId] = Object.fromEntries(
                Object.entries(entry.platforms ?? {}).map(([p, s]) => [p, s.results?.length ?? 0]),
              );
            db.close();
            done(counts);
          };
        };
      }),
  );
}

async function runOne(
  context: BrowserContext,
  page: Page,
  discoverWindow: number | null,
  skill: string,
  mode: string,
) {
  const opened: { url: string; windowId: number | null; finalUrl?: string; page: Page }[] = [];
  const onPage = async (tab: Page) => {
    const entry = { url: tab.url(), windowId: null as number | null, page: tab };
    opened.push(entry);
    entry.windowId = await windowOf(context, tab);
  };
  context.on("page", onPage);
  const before = await page.evaluate(
    () => (window as unknown as { __helperLog: unknown[] }).__helperLog.length,
  );
  await page.bringToFront();
  await page.getByTestId("discover-topic").fill(skill);
  const started = Date.now();
  await page.getByTestId(mode === "deep" ? "discover-deep-search" : "research-search").click();
  await page.locator('[data-testid="native-keyword-results"]').first().waitFor({ timeout: 30000 });
  // Sections can render one after another: count them on every check, not once.
  let sections = await page.locator('[data-testid="native-keyword-results"]').count();
  let log: HelperEntry[] = [];
  let settled = false;
  while (Date.now() - started < SETTLE_MS) {
    await page.waitForTimeout(1500);
    log = (await page.evaluate(
      () => (window as unknown as { __helperLog: unknown[] }).__helperLog,
    )) as HelperEntry[];
    log = log.slice(before);
    sections = await page.locator('[data-testid="native-keyword-results"]').count();
    const searches = log.filter((entry) => entry.message.type === "search");
    const failedStart = searches.some((entry) => entry.response?.ok === false);
    const jobs = searches.map((entry) => entry.response?.jobId).filter(Boolean);
    const done = jobs.every((jobId) =>
      log.some(
        (entry) =>
          entry.message.type === "poll" &&
          entry.message.jobId === jobId &&
          entry.response?.status &&
          entry.response.status !== "running",
      ),
    );
    if (failedStart || (searches.length >= sections && done)) {
      settled = true;
      break;
    }
  }
  await page.waitForTimeout(1500);
  context.off("page", onPage);
  // Whether the Discover tab is the selected (rendered) tab again after the run.
  const discoverVisibleAtEnd = await page.evaluate(() => document.visibilityState);
  const elapsedMs = Date.now() - started;
  const cache = await cacheCounts(page);
  const sectionResults = [];
  for (let index = 0; index < sections; index++) {
    const section = page.locator('[data-testid="native-keyword-results"]').nth(index);
    const scope = (await section.getAttribute("data-scope")) ?? `section-${index}`;
    const statusLine = (
      (await section.locator('[data-testid="native-keyword-status"]').textContent()) ?? ""
    )
      .replace(/\s+/g, " ")
      .trim();
    const deepSkippedHint =
      (await section.locator('[data-testid="native-keyword-deep-skipped"]').count()) > 0;
    const search = log.filter((entry) => entry.message.type === "search")[index];
    const jobId = search?.response?.jobId;
    const polls = log.filter(
      (entry) => entry.message.type === "poll" && entry.message.jobId === jobId,
    );
    const final = polls.at(-1);
    const platforms = Object.fromEntries(
      PLATFORMS.map((platform) => {
        const state = final?.response?.platforms?.[platform];
        return [
          platform,
          {
            query: search?.message.queries?.[platform],
            status: state?.status,
            error: state?.error,
            noResults: state?.noResults,
            received: state?.results?.length ?? 0,
            cached: cache[scope]?.[platform] ?? null,
            diagnostics: state?.diagnostics,
          },
        ];
      }),
    );
    sectionResults.push({
      scope,
      jobId,
      searchAccepted: search?.response?.ok === true,
      searchError: search?.response?.error,
      deepRequested: search?.message.deep === true,
      jobStatus: final?.response?.status,
      jobDiagnostics: final?.response?.diagnostics,
      elapsedMs: search && final ? final.at - search.at : null,
      statusLine,
      deepSkippedHint,
      platforms,
    });
  }
  for (const entry of opened)
    entry.finalUrl = entry.page.isClosed() ? "(closed)" : entry.page.url();
  const igStates = sectionResults.map((section) => section.platforms.ig);
  const igOpened = opened.filter((entry) =>
    /instagram\.com/.test(`${entry.url} ${entry.finalUrl}`),
  );
  const instagram = igStates.some((state) => state.error === "login-or-challenge")
    ? "login-or-challenge"
    : igOpened.some((entry) => /accounts\/login|challenge/.test(entry.finalUrl ?? ""))
      ? "login-redirect"
      : igStates.some((state) => state.received > 0)
        ? "no-wall (cards read)"
        : "unknown";
  const igLoggedIn = (await context.cookies("https://www.instagram.com")).some(
    (cookie) => cookie.name === "sessionid" && cookie.value.length > 0,
  );
  return {
    skill,
    mode,
    igLoggedIn,
    settled,
    elapsedMs,
    discoverVisibleAtEnd,
    sections: sectionResults,
    windows: {
      discoverWindowId: discoverWindow,
      tabsOpened: opened.length,
      tabWindowIds: [...new Set(opened.map((entry) => entry.windowId))],
      openedInOtherWindow: opened.filter((entry) => entry.windowId !== discoverWindow).length,
      browserPages: context.pages().length,
    },
    instagram,
  };
}

/** The app's public source reads (one per enriched Instagram/TikTok card) and how many named a sound. */
function trackSourceReads(page: Page) {
  const reads = {
    inFlight: 0,
    lastAt: Date.now(),
    /** A sample of what the reads named (title · artist · whether a sound link came with it). */
    labels: [] as string[],
    ig: {
      reads: 0,
      available: 0,
      withSound: 0,
      soundPostAge: { within14d: 0, within30d: 0, older: 0 },
    },
    tt: {
      reads: 0,
      available: 0,
      withSound: 0,
      soundPostAge: { within14d: 0, within30d: 0, older: 0 },
    },
  };
  const platformOf = (url: string) =>
    url.includes("/api/local-ai/instagram-source")
      ? "ig"
      : url.includes("/api/local-ai/tiktok-source")
        ? "tt"
        : null;
  page.on("request", (request) => {
    if (!platformOf(request.url())) return;
    reads.inFlight++;
    reads.lastAt = Date.now();
  });
  const finished = (request: { url(): string }) => {
    if (!platformOf(request.url())) return;
    reads.inFlight = Math.max(0, reads.inFlight - 1);
    reads.lastAt = Date.now();
  };
  page.on("requestfinished", finished);
  page.on("requestfailed", finished);
  page.on("response", async (response) => {
    const platform = platformOf(response.url());
    if (!platform) return;
    reads[platform].reads++;
    try {
      const body = (await response.json()) as { status?: string; audio?: unknown; music?: unknown };
      if (body.status === "available") reads[platform].available++;
      if (!body.audio && !body.music) return;
      reads[platform].withSound++;
      const sound = (body.audio ?? body.music) as { title?: string; artist?: string; url?: string };
      if (reads.labels.length < 80)
        reads.labels.push(
          `${platform}: ${sound.title} · ${sound.artist ?? "-"}${sound.url ? " (link)" : ""}`,
        );
      // How old the posts that named a sound are: only the last 14 days count toward a trend.
      const posted = postedAt(new URL(response.url()).searchParams.get("url") ?? "");
      const age = posted ? Date.now() - Date.parse(posted) : Infinity;
      const ages = reads[platform].soundPostAge;
      if (age <= 14 * 86_400_000) ages.within14d++;
      else if (age <= 30 * 86_400_000) ages.within30d++;
      else ages.older++;
    } catch {
      /* A busy or failed read names no sound. */
    }
  });
  return reads;
}

/** Waits until no source read has run for 10 s (at most 4 minutes). */
async function sourceReadsDrained(page: Page, reads: { inFlight: number; lastAt: number }) {
  const started = Date.now();
  while (Date.now() - started < 4 * 60_000) {
    if (reads.inFlight === 0 && Date.now() - reads.lastAt > 10_000) return true;
    await page.waitForTimeout(1000);
  }
  return false;
}

async function soundRows(page: Page): Promise<SoundObservation[]> {
  return page.evaluate(
    () =>
      new Promise<SoundObservation[]>((done) => {
        const request = indexedDB.open("3z-prod-trending-sounds");
        request.onerror = () => done([]);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("observations")) return done([]);
          const get = db
            .transaction("observations", "readonly")
            .objectStore("observations")
            .get("recent");
          get.onerror = () => done([]);
          get.onsuccess = () => {
            db.close();
            done((get.result ?? []) as SoundObservation[]);
          };
        };
      }),
  );
}

async function main() {
  const options = args();
  const server = await serve(options.port, options.sounds);
  const helper = helperCopy(options.port, !options.osFocus);
  const { context, profile, id, browser } = await launch(
    helper.dir,
    options.browser,
    options.profile,
    !options.osFocus,
  );
  const report: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    browser,
    helperVersion: helper.version,
    helperId: id,
    harnessPatches: helper.patches,
    app: `http://localhost:${options.port}/discover/ (out/ served on 127.0.0.1:${options.port})`,
    profile: options.profile
      ? `kept profile ${profile} (logins made there by the owner stay; the harness never logs in)`
      : "fresh temporary profile, deleted afterwards; the harness never logs in",
    runs: [] as unknown[],
  };
  try {
    await context.addInitScript(RECORD_HELPER_MESSAGES);
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`http://localhost:${options.port}/discover/#discover-helper=${id}`);
    await page.locator("#main").waitFor({ timeout: 60000 });
    const search = page.getByTestId("inspiration-search");
    if ((await search.count()) && (await search.getAttribute("aria-pressed")) !== "true")
      await search.click();
    await page.getByTestId("discover-deep-search").waitFor({ timeout: 30000 });
    const reads = options.sounds ? trackSourceReads(page) : null;
    const discoverWindow = await windowOf(context, page);
    report.windowsAtStart = (
      await Promise.all(context.pages().map((p) => windowOf(context, p)))
    ).filter((value, index, all) => all.indexOf(value) === index);
    for (const skill of options.skills)
      for (const mode of options.modes) {
        console.log(`Running "${skill}" (${mode})…`);
        const run: Record<string, unknown> & Awaited<ReturnType<typeof runOne>> = await runOne(
          context,
          page,
          discoverWindow,
          skill,
          mode,
        );
        if (reads) {
          run.sourceReadsDrained = await sourceReadsDrained(page, reads);
          run.sourceReadsSoFar = JSON.parse(JSON.stringify({ ig: reads.ig, tt: reads.tt }));
          run.soundRowsSoFar = (await soundRows(page)).length;
          console.log(
            `  source reads so far: IG ${reads.ig.withSound}/${reads.ig.available} named a sound, ` +
              `TT ${reads.tt.withSound}/${reads.tt.available}; stored sound rows ${String(run.soundRowsSoFar)}`,
          );
        }
        (report.runs as unknown[]).push(run);
        writeFileSync(options.out, JSON.stringify(report, null, 2));
        console.log(
          `  ${run.settled ? "settled" : "NOT settled"} in ${Math.round(run.elapsedMs / 1000)} s; ` +
            run.sections
              .map(
                (s) =>
                  `${s.scope}: ` +
                  PLATFORMS.map(
                    (p) => `${p} ${s.platforms[p].received} (${s.platforms[p].status})`,
                  ).join(", "),
              )
              .join(" | "),
        );
      }
    if (reads && options.refreshSounds) {
      await page.getByTestId("inspiration-explore").click();
      const button = page.getByTestId("trending-sounds-refresh");
      await button.waitFor({ timeout: 30000 });
      const started = Date.now();
      await button.click();
      const status = page.getByTestId("trending-sounds-refresh-status");
      const steps: { text: string; atMs: number }[] = [];
      let text = "";
      // The block disables the button while the refresh runs.
      while (Date.now() - started < 30 * 60_000) {
        text = ((await status.textContent().catch(() => "")) ?? "").trim();
        if (text && steps.at(-1)?.text !== text) {
          steps.push({ text, atMs: Date.now() - started });
          console.log(`  refresh: ${text}`);
        }
        if (text && !(await button.isDisabled())) break;
        await page.waitForTimeout(2000);
      }
      report.refresh = {
        steps,
        finished: !(await button.isDisabled()),
        elapsedMs: Date.now() - started,
        sourceReadsDrained: await sourceReadsDrained(page, reads),
        sourceReads: JSON.parse(JSON.stringify({ ig: reads.ig, tt: reads.tt })),
      };
      writeFileSync(options.out, JSON.stringify(report, null, 2));
    }
    if (reads) {
      const rows = await soundRows(page);
      const top = trendingSounds(rows, undefined, 10, { seen: true });
      // Every stored sound with its spread, so a sound one short of a label is visible too.
      const seen = [...Map.groupBy(rows, (row) => row.key).values()]
        .map((group) => ({
          title: group[0].title,
          artist: group[0].artist,
          posts: group.length,
          creators: new Set(group.map((row) => row.creator)).size,
          categories: new Set(group.map((row) => row.category)).size,
          platforms: Object.fromEntries(
            ["ig", "tt", "yt"].map((p) => [p, group.filter((row) => row.platform === p).length]),
          ),
        }))
        .sort((a, b) => b.posts - a.posts)
        .slice(0, 80);
      await page.getByTestId("inspiration-explore").click();
      const block = page.getByTestId("trending-sounds");
      await page.waitForTimeout(1500);
      await block.waitFor({ timeout: 30000 });
      report.sounds = {
        sourceReads: { ig: reads.ig, tt: reads.tt, labels: reads.labels },
        storedRows: rows.length,
        trending: top.map(({ examples, ...sound }) => ({
          ...sound,
          examples: examples.map((example) => example.url),
        })),
        mostSeen: seen,
        browseBlock: {
          empty: (await page.getByTestId("trending-sounds-empty").count()) > 0,
          sounds: await page
            .getByTestId("trending-sound")
            .evaluateAll((nodes) =>
              nodes.map((node) =>
                (node.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 300),
              ),
            ),
          exampleCards: await page.getByTestId("trending-sound-example").count(),
        },
      };
      console.log(
        `Sounds: ${rows.length} stored rows; ${top.length} trending/emerging/seen; Browse block ${
          (report.sounds as { browseBlock: { empty: boolean } }).browseBlock.empty
            ? "empty"
            : "filled"
        }`,
      );
    }
  } finally {
    report.finishedAt = new Date().toISOString();
    writeFileSync(options.out, JSON.stringify(report, null, 2));
    await context.close().catch(() => {});
    server.close();
    for (const dir of options.profile ? [helper.dir] : [helper.dir, profile])
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
      } catch {
        console.warn(`Could not remove ${dir}`);
      }
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
