# 18 · Trending effects in Discover

**Status:** design approved in chat on 2026-10-06. The owner said "build it and focus about its functionality" the same day. The design was revised after the live probe below (effect families + a 7-day memory). Built the same day on branch `claude/trending-effects-spec` (see [Built](#built-2026-10-06)); the PR waits for the owner's OK, and the live check follows the deploy.

This is project 3 of round 33 ("Beacons-style trends on top of 1 and 2"), narrowed to the editing effects the owner edits with.
The owner shared an Instagram reel of the **clone effect** and asked: "does it show in Discover as trendy, or does our Discover
page need working?"

On 2026-10-06 the answer was no. Nothing in the app tracks which editing effects are trending:
- The Trend Radar (Social → Ideas) follows general viral videos and searches. It had 108 rows that day and none mentioned the clone effect.
- Discover's "Popular now" only ranks the posts of the current search.

Searching "clone effect" by hand did work: 66 posts, with strong English tutorials. The Arabic side mixed in biology
"الاستنساخ" (high-school cloning lessons); see Open items.

## Owner's choices (2026-10-06)

| Question | Choice |
| --- | --- |
| Goal | **Catch new trends early**, including effects that are not in our dictionary yet |
| Region | **Global first**: one list from global (mostly English) posts |
| Platforms | **Instagram and TikTok first**; YouTube only confirms, with real numbers |
| Where | **Top of Discover**, above the category buttons |
| Look | **A · Compact chips**: one swipeable row with the name, a NEW badge and a tiny reason (mockup picked in the visual companion) |
| How often | **Every day** |
| New-effect names | **Cleaned by the free built-in AI** (Workers AI, Llama 3.3 70B) |
| Approach | **A**: daily mention scan → AI cleanup → YouTube check → chips |

## Search before building

- **TikTok Creative Center** has exactly the data we want: trending hashtags with day-by-day curves. But:
  - Since April 2026 TikTok prohibits scraping it, and bulk access goes through its approved API program.
  - Third-party scrapers (for example Apify "TikTok Creative Center Trends" actors) break those rules, so they are **rejected**: no ban risk, official routes only.
  - We only **link** to Creative Center so the owner can check it by hand, which the rules allow.
- **Instagram** has no public trends API. The **Google Trends** API is alpha and by application only (`08-trends.md`).
- **Burst and emerging-term detection** libraries are mostly Python and R research tools (burst_detection, pybursts, bursts). The one Node option, Ramekin, is old.
- **Firecrawl's "trend-finder"** guide (TypeScript) uses our pattern: web search, then an LLM summary.
- **Decision: no new dependency.** Our data is a few dozen candidates a day, so a small growth score in our own Worker is enough.
- **Reused as-is:**
  - Tavily search (`trends/tavily.ts`, `discover/fetchers.ts`)
  - YouTube `search.list` / `videos.list` helpers (`trends/youtubeSearch.ts`, `youtubeStats.ts`)
  - the editing dictionary and its matcher (`discover/terms.ts`)
  - the built-in AI binding (`discover/ai.ts`, `AI_MODEL`)
  - the cron slot pattern (`social/cron.ts` `TREND_SLOTS`)
  - Discover's chip and row styles

## Live probe (2026-10-06, before building)

These were run through Discover's own Worker (Posted: Week). They cost about 35 credits.

- **Generic wording ("viral edit trend", "capcut trend edit", "new reels editing trend")**
  - 337 posts came back: 115 TikTok, 60 Instagram, 162 YouTube.
  - The rules found 265 candidates, but the top ones were generic: "video edit", "viral trend", "dance trend", "the trend".
  - The real named trends ("CapCut Reverse Trend", "Mention Trend", "First Month Edit Trend") each came from only 1–2 creators.
  - **0 posts mentioned the clone effect**, and 0 mentioned the owner's second reel (animated GIF stickers over cinematic hiking footage).
- **Family wording**
  - **"clone yourself video trend"**: 34 TikTok/Instagram posts, **8 distinct creators** posting clone edits. It also surfaced sub-trends:
    "Flash Clone Edit" and "Swagger Trend" (clone yourself with one hair). The clone effect would pass the 3-creator bar.
  - **"gif sticker overlay reel trend"**: 12 TikTok/Instagram posts, and 7 creators mention stickers or GIF overlays. These are mixed (crowns,
    hearts, caption stickers) rather than the exact hiking-reel style. The AI naming step has to separate them, and the live check will
    report how well it does.
- **Decision:** rotate effect families, keep a 7-day memory of creators, and name trends from Title-Case "… Trend / Edit" phrases.

## Design

### 1. Daily job (Worker, `src/effects/`)

**When it runs.**
- A new UTC slot, `"05:35"` (08:35 Riyadh), sits beside `TREND_SLOTS` on the five-minute grid. It is clear of the sync minutes (03:00–03:30) and the trend minutes (:05), and a test guards it.
- It runs **at most once per UTC day**, unless that day's run failed. The saved document's `ranOn` and `status` are checked first, so this guard costs no extra KV write.

**Steps.**

1. **Find mentions (Tavily, 6 credits).** Six searches a day, global (no country) and in English, each on
   `include_domains: ["tiktok.com", "instagram.com"]`:
   - Settings: `time_range: "week"`, `max_results: 20`, `search_depth: "basic"`.
   - The six are taken in turn from a pool of **18 effect-family queries**, rotated by UTC day, so every family is searched every
     3 days. Examples:
     - "clone yourself video trend"
     - "gif sticker overlay reel trend"
     - "new transition trend reels"
     - "text effect trend capcut"
     - "speed ramp trend edit"
     - "ai effect video trend"
   - At most 120 posts a day; about 840 over the rolling week.
   - Why families and not generic wording: see the live probe below.
2. **Pull out candidates (rules, free).**
   - Every dictionary entry matched in a post's title or snippet (`matchTerms`, the same matching form as search). Three refinements:
     - An entry that is not `specific` needs one of its longer phrases: "flash" alone is not a flash transition.
     - A multi-word phrase also counts written as one hashtag (`#cloneyourself`, `#greenscreen`).
     - The catch-all "transitions" entry never counts, and a name equal to one of its phrases ("seamless transition") is dropped.
   - English phrases of 1–3 words before "effect", "transition", "trick", "filter" or "trend" (any case), and Title-Case names before "Edit".
     - "edit trend" names "… edit".
     - The name is the run of words right before the suffix, back to the first generic word: "glitch and zoom transition" → "zoom transition", "First Month Edit Trend" → "first month edit".
   - Hashtags ending in those words. `#cloneeffect` becomes "clone effect": the known suffix is split off and the rest is kept as one word.
   - A block list drops known junk: "sound effect(s)", "butterfly effect", "special effects", "video effect", "the effect", "visual effect", "After Effects".
   - For each candidate, record:
     - distinct posts
     - distinct creators (by handle, per platform)
     - platforms
     - up to 2 sample posts (url, title)
3. **AI cleanup (built-in AI, 1 call).**
   - **Input:** the 25 candidates with the most distinct creators over the last 7 days (history plus today), so a name that builds slowly across the rotation still gets judged. On a tie, names the AI has never approved go first. Each comes with up to 2 sample titles. Titles are clipped and passed as data, never as instructions.
   - **Output:** JSON. Each verdict is checked on its own against a strict schema, and an invalid one is skipped without costing the rest. For each kept candidate:
     - `key` and `keep`
     - `sameAs`, which merges spellings (for example "cloning" and "clone yourself" into "clone effect")
     - `name: { en, ar }`
     - `what: { en, ar }`: one line, at most 90 characters
   - **On failure or invalid output:** fall back to the rule list.
     - Dictionary effects keep their own `label`.
     - New candidates keep their English text and are marked `checked: false`.
   - **Chips** are dictionary effects and names the AI has approved. On a day with no answer (`ai_fallback`) or no usable verdict (`ai_empty`), only dictionary effects show. New names stay in memory until a day the AI judges them.
   - **Time limits:** the AI call has its own 60 s. Each Tavily call and YouTube search has 12 s; the views call (`videos.list`) keeps its own 2.5 s (`STATS_TIMEOUT_MS`).
   - This call is separate from Discover's 20 AI plans a day.
4. **YouTube check (6 `search.list` + 1 `videos.list`).**
   - For each of the top 6 cleaned effects: `search.list q="<query> edit" publishedAfter=now-7d` (20 results).
     - The query never changes for an effect, so `views7d` compares like with like: the dictionary label for a dictionary effect, else the key's words. It is never the AI's renaming.
   - Then one `videos.list` gets the views. It takes at most 50 ids, so each effect counts its first 8 videos (6 × 8 = 48).
   - Per effect this gives `newVideos` (all results) and `views7d` (the sum over those 8).
   - If YouTube's daily cap is reached, the step is skipped, with no penalty.
5. **Score and save (1 KV write)** to `effects:trending`; see below.

**Per-run budget.**
- About 16 subrequests (the limit is 50).
- 6 Tavily credits, about 180 a month.
- 6 of YouTube's 100 daily searches. With the radar's 18 and Discover's 70, the total is 94.
- 1 AI call and 1 KV write.

### 2. What counts as trending

- **Main signal:** distinct **creators** on TikTok and Instagram mentioning the effect over the **last 7 days of scans**. Creators are counted, not posts, so one account can't fake a trend.
  - Each day's creators are kept per effect in the history as short hashes. The 7-day count is the union, so a trend builds up across the rotation.
- **Minimum to show:** 3 distinct creators over the 7 days.
- **Named trends:** besides "___ effect / transition / trick / filter" phrases and hashtags, the rules also keep names before "trend"
  (any case) and Title-Case names before "Edit". Tavily titles these posts like "How to Edit the New CapCut Reverse Trend" and "Clone
  Yourself with One Hair (Swagger Trend)". Generic words (viral, new, latest, capcut, tiktok, video, edit, trend, dance, challenge) are
  never part of a name.
- **Growth:** compares the creators of the last 3 days with the 3 days before them.
  - Each family is searched once in every 3-day window, so the two windows are like for like.
  - `growth = |creators, days 0–2| / |creators, days 3–5|`, rounded to 0.01, when days 3–5 have creators. Otherwise it is 3 or 0, as below.
  - An effect with creators in days 0–2 but none in days 3–5 counts as growth 3. That covers effects never seen before.
  - An effect with no creators in days 0–5, seen only 6 days ago, has growth 0: it is fading.
- **NEW:** the effect is not in the dictionary and was first seen in the last 7 days.
- **YouTube bonus:** `views7d` growth of at least 1.5×, against the effect's last recorded `views7d`. It adds a small boost and the "▶ ↑N×" note. No data means no penalty.
- **Score:** `creators × min(growth, 4) × (youtubeBonus ? 1.25 : 1)`.
- **Shown:** the top 8 by score. Ties go to whichever was first seen more recently.
- **Honest labels.** TikTok and Instagram figures say "mentioned by N creators this week". They are web-index mentions, never views. Only YouTube shows real view numbers.

### 3. Storage and routes

KV `effects:trending` holds one document (`EffectsDoc` in `src/effects/types.ts`), written at most once a day (a forced run, or a retry after a failed run, adds one):

```ts
{
  ranOn: "2026-10-06",            // UTC day of the last run
  updatedAt: "2026-10-06T05:35:12Z", // the last run that scanned; a failed day keeps the previous one
  status: "ok" | "partial" | "failed",  // partial: AI or YouTube step skipped; failed: Tavily unusable
  notes?: string[],               // e.g. ["ai_fallback", "youtube_cap"]; also ai_empty, youtube_stats, kv, error
  items: {
    key: string;                  // stable id: dictionary id, or a slug of the English name
    name: { en: string; ar?: string };
    what?: { en: string; ar?: string };
    termId?: string;              // when it is a dictionary effect
    isNew: boolean;
    checked: boolean;             // AI-cleaned
    creators: number;
    posts: number;
    platforms: ("tt" | "ig")[];
    growth: number;
    youtube?: { newVideos: number; views7d: number; growth?: number };
    samples: { url: string; title: string }[]; // ≤ 2, canonical post URLs
  }[];                            // ≤ 8
  meta: Record<string, {          // one per history key: an effect missing from today's scan keeps its name,
    name: { en: string; ar?: string };  // line and samples while it is still in the 7-day memory
    what?: { en: string; ar?: string };
    termId?: string;
    checked: boolean;             // the AI kept it the last day it judged it; false if never judged
    platforms: ("tt" | "ig")[];
    posts: number;
    samples: { url: string; title: string }[];
  }>;
  history: Record<string, { day: string; ids: string[]; views7d?: number }[]>;
  // ids: short hashes of "platform:handle" seen that day, ≤ 30. ≤ 14 days per key, ≤ 400 keys.
}
```

The routes answer the document without `meta` and `history` (the job's memory).

History trimming:
- Entries older than 14 days are dropped.
- If more than 400 keys remain, the cut keeps keys in this order:
  1. dictionary effects, and AI-approved names seen in the last 7 days (an older approved name has no creators in the 7-day window, so it cannot show and competes like any other);
  2. then the most creators over the last 7 days;
  3. then the most recently seen.

  The 400 keys are sized for about 120 new candidates a day: a 1-creator name then survives until its family's next scan, 3 days later. That assumes about 12 AI approvals a day and few dictionary names in memory: both are protected, so each takes a key from the 1-creator names. It also counts on the AI's drops: the AI judges 25 names a day, and the ones it does not approve (~13) leave the memory at once (`applyVerdicts` in `run.ts`). A day without a usable AI answer (`ai_fallback`, `ai_empty`) drops nothing, so such a day holds fewer new candidates than the row says.

  | Dictionary names in memory | AI approvals/day | Holds up to |
  | --- | --- | --- |
  | 0 | 12 | 130/day |
  | 20 | 12 | 123/day |
  | 36 | 12 | 118/day |
  | 0 | 25 | 99/day |

  These were found with the real `runEffects` and fake Tavily, YouTube, AI and KV, like `run.test.ts`'s daily-runs test (a throwaway script, not committed). Each day brings N new 1-creator names and the dictionary names (seen daily); the AI approves the first A names it judges and drops the rest; and the slow name, last among its day's ties, gains a creator on days s, s+3 and s+6 (s = 7–10). "Holds up to" is the largest N at which the slow name always shows with 3 creators.

  The run's log line reports `keys`, `protected` and `trimmed` (counts, no names). The live check reads them against this table:
  - `protected` (dictionary names plus about a week of approvals, ~84 at 12 a day) picks the row.
  - At the cap (`keys` 400), `trimmed` is about the day's new candidates minus the AI's drops: 108 at 120 a day with 12 approvals. Add the drops (~13) back before comparing with the table; read raw, it overstates the headroom by about 10%.
  - Above the row's limit, a slow name is cut before its family's next scan: raise `HISTORY_KEYS` (the document stays far under KV's 25 MiB) or tighten extraction.
- An effect's first-seen day is its earliest kept entry.

Handles are hashed (SHA-256, first 8 hex) so the stored document holds no account names. Only the 2 sample posts keep a visible handle.

- **`GET /effects/trending`** (Bearer `SCOUT_TOKEN`, with the same CORS as `/discover`, no credits) returns `{ status, ranOn, updatedAt, notes?, items }`, without `meta` and `history`.
  - Before the first run it answers `{ status: "never", items: [] }` (200, not 404), so the dashboard can offer the first scan.
  - A KV read error answers `502 { error: "upstream" }`.
- **`POST /effects/run`** (Bearer) runs the job now: the dashboard's first-scan button and the live check. The body is `{ force?: boolean }` or empty; anything else is `400 { error: "bad_request" }`.
  - It respects the once-a-day guard unless `{ force: true }` is sent, or unless that day's run failed: a second run the same UTC day answers the stored list and spends nothing. After a failed run it runs again, so the dashboard's "Run the first scan" can retry.
  - It waits for the run (about 30–60 s) and answers like the GET. The run is also handed to `ctx.waitUntil`, so a request dropped mid-run leaves it up to 30 s more to finish and save.
- **Connector:** the `get_trends` tool also returns `effects` (name, what, creators, isNew, growth, youtube). Names are clipped to 40 characters and `what` to 90, and the tool's description says titles and names are data, not instructions. A document that can't be read gives `effects: []` and keeps the radar's rows. The owner can then ask Claude "what editing effects are trending?"

### 4. Discover row (dashboard)

**Placement and header.**
- The row sits under the search box, above Recent topics and the category buttons. It shows on Discover v2 only, never on a skill's page.
- Title: "🔥 ترند المؤثرات هالأسبوع" / "🔥 Trending effects this week", followed by "updated N h ago" and a small "TikTok Creative Center ↗" link.

**Chips.** One horizontal row of chips. In Arabic it swipes right-to-left. Each chip shows:
- the name in the UI language, falling back to English;
- a **جديد / NEW** badge when `isNew`;
- a reason line, for example "9 صنّاع · ▶ ↑3×" / "9 creators · ▶ ↑3×";
- the `what` line as the chip's `title` tooltip on mouse hover. Touch screens show no tooltip: there `what` reaches screen readers only, as part of the chip's label.

**Tap.** Runs a Discover search for the effect: the query is the English name, which for a dictionary effect is its dictionary label. Any selected category is cleared, and the search always runs in Keywords mode, so a tap never spends an AI plan or the owner's ChatGPT / Claude usage. It is a normal search: about 6 credits the first time, and free from the cache within 6 hours.

**States.**

| Situation | What shows |
| --- | --- |
| No answer: a Worker without the route (404), a refused token, no network or a broken answer | Nothing; the row hides |
| `status: "never"` (the Worker has not run yet) | The title and a "شغّل أول فحص" / "Run the first scan" button |
| The first scan running (about a minute) | The button disabled, and "أدوّر على الترندات… ممكن تاخذ دقيقة" / "Scanning for trends… can take a minute" |
| The first scan failed or was cut off, or `status: "failed"` with no list yet (every run so far failed: Tavily's quota or key, a code error, KV), from the GET or the scan | The never state: the button again, enabled for a retry, and "ما قدرت أشغّل الفحص، جرّب بعد شوي" / "Couldn't run the scan — try again in a bit" (`search.trendingRunFailed`) |
| `ok` or `partial` with a list at most 3 days old | The chips |
| `ok` or `partial` with 0 items | Nothing; the row hides |
| `updatedAt` older than 3 days, or missing | Nothing; the row hides |
| `status: "failed"` with a list at most 3 days old (stale-failed) | The old list, plus a faint "ما قدرت أحدّثها اليوم" / "Couldn't update today"; no button |

**The first scan.** `POST /effects/run`, one at a time per Worker within a browser tab (`lib/effects.ts` keeps the running scan in the page's memory): a second tap, or a tap after leaving Discover and coming back, waits for the same answer. The Worker's once-a-day check has no lock, so a second tab or the phone can still start a second run, spending its credits again, while the first is going. Leaving Discover never cancels it; the list it finds is kept like a fetched one, so a revisit shows it even when the scan answered while the revisit's own GET was on its way. When the chips arrive, focus moves to the row's heading, without scrolling, unless the owner is busy elsewhere on the page.

**Copy and fetching.**
- The copy lives in `messages/search.{ar,en}.json`, with key parity and Hijazi Arabic first.
- The list is fetched through `scoutCall` once per Discover visit (no credits) and kept 1 h per Worker in the tab's session storage, so a revisit shows the row at once. Only a list is kept: a "never" answer, a failed first run or an empty run is asked again, as the next run can land any minute.

### 5. Failures and safety

- **Tavily quota or auth failure:** status `failed`. The previous items are kept; only the date and notes are written, still one write.
- **AI failure or no usable verdict:** the rule list is used, with dictionary-only chips that day (see step 3). Status `partial`, note `ai_fallback` or `ai_empty`.
- **YouTube cap reached:** the check is skipped, with status `partial`.
- **Untrusted text:** web titles and snippets are treated as data. The AI prompt says so, its output is validated, and names and lines are clipped.
- **No side effects:** nothing posts or touches the owner's social accounts. Sample URLs are canonical post links (`isVideoUrl`).

### 6. Testing

- **Worker (plain Node):**
  - candidate extraction from titles and hashtags (`#cloneeffect` → "clone effect")
  - the block list, and creators counted per platform
  - growth from history, NEW logic, the score and the top 8
  - AI schema validation and the fallback
  - the per-run budgets, and once-a-day vs force (a day whose run failed runs again)
  - routes: auth, and `status: "never"` before the first run
  - the cron slot sits on the grid
- **Dashboard (jsdom):**
  - row states: hidden, never (the first-scan button, waiting, failed, and the Worker's own failed first run), list, failed but recent, old, a run with 0 items
  - chip text in both languages
  - a tap runs one search with the right query, in Keywords mode, and clears the category
  - an old Worker's 404 hides the row
- **E2E:** a stubbed `/effects/trending` → chips show → a tap sends `POST /discover` with the effect.
- **Live check after deploy:**
  1. Run `POST /effects/run` once (the dashboard's "Run the first scan").
  2. Record the list in this file.
  3. Compare it by hand with TikTok Creative Center and the owner's own feed.
  4. Read the run's log line (`keys`, `protected`, `trimmed`) against the table in §3, and its CPU time in Workers Observability.
  5. Report plainly what it caught and what it missed.

## Out of scope (later, if wanted)

- A separate Saudi / Arabic list (the owner chose global first).
- Adding a NEW effect to the dictionary from its chip.
- Notifications when a new effect appears.
- Using the editor panel's ~70 creators as a signal (project 2).

## Open items

- **Arabic clone-effect words — done (2026-10-06, Task 1 of the build).** The dictionary's bare "استنساخ" also matched biology cloning. In `planning/data/edit-terms.json`, `clone-effect` now:
  - matches the Arabic "استنساخ نفسك" in place of the bare word, and keeps "تأثير الاستنساخ";
  - also matches the English "clone yourself", the wording of the "clone yourself video trend" posts.

  A trending chip for the clone effect runs this same, cleaner search. Typing the bare word "استنساخ" in Discover no longer selects the clone effect.

## Built (2026-10-06)

Plan: `planning/plans/2026-10-06-trending-effects.md` (5 tasks), on branch `claude/trending-effects-spec`.

- **Files.**
  - Worker, `workers/scout/src/effects/`: `types.ts`, `families.ts` (18 family queries, 6 a day), `extract.ts` (the rules), `ai.ts` (one built-in AI call, each verdict checked with zod), `sources.ts` (Tavily, YouTube), `score.ts` (the 7-day memory, growth, score), `kv.ts`, `run.ts` (the daily run) and `routes.ts`, with 8 test files beside them.
  - Worker wiring: `scout.ts` (the routes), `social/cron.ts` (`EFFECTS_SLOT` 05:35 UTC), `discover/tools.ts` and `mcp.ts` (the connector's `effects`), the README.
  - Dashboard: `lib/effects.ts`, `components/research/TrendingEffects.tsx` (placed by `ResearchPanel.tsx`), 9 copy keys in `messages/search.{ar,en}.json`.
  - Dictionary: the `clone-effect` words in `planning/data/edit-terms.json` (Open items).
- **Tests.**
  - Worker: 79 in `src/effects/`. They cover extraction, scoring, the 400-key memory, the sources, the AI's schema and fallback, the run's budgets, a 14-day steady-state run, the routes and the 05:35 slot. The connector's `effects` are tested in `discover/tools.test.ts`, and the slot joins the cron grid test.
  - Dashboard: 29 in `lib/effects.test.ts` and `TrendingEffects.test.ts`, 2 in `ResearchPanel.test.ts`, and 1 e2e test in `e2e/discover.spec.ts`.
  - Totals on the final full run (Task 5's fix round, on top of Task 4's round 2): `pnpm test` 2,000 tests in 90 files (the Worker's 806 included); e2e 292 passed and 4 skipped by design (tests that run on one screen size only) of 296, on phone (145 passed) and desktop (147 passed). Lint, typecheck and build clean.
- **Budgets per run.**
  - 6 Tavily credits (about 180 a month), ≤ 6 YouTube `search.list` + 1 `videos.list`, 1 AI call (`max_tokens` 3000, 60 s), 1 KV write, about 16 subrequests.
  - A second run the same UTC day spends nothing, unless that day's run failed (the retry runs again).
  - The document is ~104 KB at 400 keys after 14 daily runs in the test (≤ 250 KB asserted). A realistic worst case is ~0.4–0.7 MB, against KV's 25 MiB per value.
- **Reviews.** Every task was reviewed against this spec and every fix round re-reviewed. Task 1 (extraction, scoring) took one fix round, its faster lookup re-checked on 22,976 texts with 0 mismatches. Task 2 (sources, AI, run) took three, ending with the 400-key memory and the 7-day protection. Task 3 (routes, slot, connector) passed first time. Task 4 (the row) took two: its re-review came back clean, and round 2 added the retry after a failed first run (the button and the failure line, and the Worker's guard running a failed day again), the scroll fix and the cache re-read.
- **Not verified until the live check:**
  - **CPU on the Free plan** (10 ms per request or cron run). Extraction alone measured ~7.5–10 ms warm and ~17 ms cold in Node. Read the run's CPU time in Workers Observability. If it is over, split the job across two slots: search and extract, then AI, YouTube and score.
  - **The AI call's time and size.** 25 bilingual verdicts were estimated at 2,000–2,500 tokens; that has not been measured on the real model.
  - **Real candidate volume.** The memory's table (§3) assumes about 12 approvals a day. The log's `keys`, `protected` and `trimmed` show which row applies.
  - **How well the sticker trend is separated.** The "gif sticker overlay" family mixes crowns, hearts and caption stickers. Nobody knows yet whether the AI names the owner's hiking-reel style apart.
  - **The first scan's wall time.** It should be about 30–60 s, under the edge's ~100 s limit; if not, the owner waits for the 05:35 run.
