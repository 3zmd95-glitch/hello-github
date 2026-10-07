# Category trends and lessons (Discover categories)

**Status:** design approved in chat on 2026-10-06; written here for the owner's review before planning.

## The owner's request and choices

> "I want you in the same way you worked on having the trendy edit to have the categories to be advanced searches meaning
> that every category should show me the best and the most trendy and like the most awesome trends in restaurants and
> car edits and like all categories like I wanna learn from each category how it will benefit me in terms of photography
> and videography and editing so I don't want the generic search so make it in the purpose that I will learn from each
> category and the same things that I want to learn"

Choices, one question at a time:

| Question | Choice |
| --- | --- |
| What a category shows first | **Trends + lessons**: what is trending in that category now, then lessons in Photography / Videography / Editing |
| How often | **Every 3 days** per category (4 a day); lessons weekly (built: lessons every 6 days, every second scan) |
| How a lesson teaches | **Videos + a short how-to**: the best example and tutorial videos, plus 2–3 lines written by the AI from those tutorials, marked AI |
| Skills | **Linked**: each technique shows the skill from the owner's map it practices |
| Layout | **B · Shelves**: trends on top, then three stacked shelves of technique cards |
| Approach | **A · Category scans**, like Trending effects |
| Language | **English first**, "because it's a global thing"; Arabic tutorials second. The app's labels keep both languages |

## Search before building (2026-10-06)

- [social-trend-agent](https://github.com/Moenodesuyo/social-trend-agent): niche Reels/TikTok insight (hooks, formats) in
  Python + Streamlit, fed by Apify scraping. **Rejected**: it scrapes, and the project allows official APIs only
  ([[no-ban-risk]]). It is also a different stack.
- [trendscope](https://github.com/valtterimelkko/trendscope): near-real-time TikTok trend alerts, scraping-based,
  archived. **Rejected** for the same reason.
- TikTok Creative Center: scraping is forbidden. It stays a link (the 🔥 row already has it).
- **Adopted: our own pipeline, reused rather than rebuilt.**
  - Trending effects (`workers/scout/src/effects/`): per-platform Tavily searches, extraction rules, tolerant AI cleanup in
    parallel batches, the 7-day creators memory, trends first, Scan again, `diagnostics`.
  - `planning/data/genres.json`: the 12 categories with their English and Arabic search words.
  - `planning/data/edit-terms.json`: the editing dictionary.
  - The skills: the DaVinci packs in `planning/data/davinci-*.json` and the craft skills in `data/skills/craft-draft.ts`.
  - Discover's search and the app's player.

## Design

### 1. What the owner sees

- **Opening a page.** Tapping a category in Discover (🚗 Cars) with no typed text opens its page. It replaces the
  automatic category search. With typed text, the category still narrows that search, as today.
- **Header.** "🚗 Cars · updated 1 day ago" and 🔄 Scan again.
- **🔥 Trending in Cars this week.** A row of chips: the Cars edit styles being posted now, with creator counts and NEW,
  trends first, at most 12. A tap searches that style within Cars in Keywords mode, for example
  "rolling shot car edit". A page over 7 days old says "🔥 Trending in Cars", without "this week".
- **Three shelves:** 📷 Photography, 🎥 Videography and ✂️ Editing. Each is a sideways row of about 3 technique cards
  for the category. A card shows:
  - the technique's name;
  - a ✦ AI how-to of 2–3 lines (how to shoot it, settings or gear, how to edit it), in English and Arabic;
  - 🎯 the skill it practices, which opens that skill. It shows only when there is a real match;
  - 2 example videos and 1 tutorial (plus an Arabic tutorial when one matched). They play in the app's player.
- **"Search all Cars videos →"** runs today's category-only search, which stays one tap away.
- **States** (the same patterns as the 🔥 row), from the page's `status`, `notes` and `updatedAt`:
  - never scanned: "Scan Cars now";
  - scanning: disabled, with "Scanning Cars… can take a minute";
  - failed with nothing yet: the button again, with a failure line;
  - stale: an update that failed (`status: "failed"`) over trends or lessons keeps the old page. Until a scan from the
    page, a line under the header says why: "Couldn't update today" when the page was made on an earlier day, and
    "Couldn't run the scan — try again in a bit" when it was made earlier the same day (the browser's date of
    `updatedAt`), since that day had its update;
  - paused on the budget (`tavily_budget`, §4): "Scans paused — this month's lookups are nearly used up", in place of
    those lines. The scan buttons stay on: a paused scan spends nothing and counts no try, so one can go through once
    pay-as-you-go is on. Before the first page, the first-scan button shows with that line;
  - over the day's tries: "Today's 3 scans are used up — you can scan again tomorrow", and the scan buttons rest. It
    promises no retry: the category's next turn can be 3 days away.
- **Saved only.** With it on, a category tap leaves the saved posts in view, as it does for a search, and searches
  nothing; the page opens once Saved only is off.
- **Copy.** New keys in `messages/search.{ar,en}.json`, in key parity. Arabic copy in friendly Hijazi.

### 2. Category scans (trends)

**Turns.** Four category slots a day on the cron grid, `CATEGORY_SLOTS` "05:40", "05:45", "05:50", "05:55" (UTC). The
grid already holds the syncs at 03:00–03:30, effects at 05:35, the trend feed at 06:05 and the weekly scan at 21:15. A
test guards the grid. The 12 categories in `genres.json` order make 3 groups of 4:

| UTC day number % 3 | Categories |
| --- | --- |
| 0 | cars, food, anime, travel |
| 1 | football, coffee, perfume, camping |
| 2 | fashion, gaming, weddings, gym |

Each category is searched every 3 days. 🔄 Scan again (`force`) scans one category now. "Scan Cars now" is a category's
first scan.

**Searches.** 2 English queries a category, from `genres.json` `queries.en`: the first with " trend" added ("car edit
trend"), and the second as it is ("cinematic car edit"). Each query is asked 3 times, as for effects: Instagram over a
week, Instagram over a month and TikTok over a month. That is **6 Tavily credits a scan**. Posts are deduped by URL.

**Extraction.** Trending effects' rules, with two additions for categories:
- Camera words join the suffixes: "shot(s)", "angle", "lighting", "look", so "rolling shot" and "low angle" are named.
- The category's own words, from its names and its main query ("car", "cars", "edit"; a plural name word's singular
  too, as Food & restaurants' "restaurant"), are generic for that category, so "car edit" is never a style. The second
  query's words stay free: it is there to find the category's signature styles (Fashion's "outfit transition").

**AI cleanup.** Effects' tolerant cleanup in parallel batches of 9 (keep, drop, merge, English and Arabic names, a one-line
`what`), told the category ("for car videos").

**Scoring.** Distinct creators over 7 days (at least 3), growth, NEW, trends first (names outside the dictionary and
dictionary trend entries), then techniques, top 12. The memory is per category: 14 days, at most 200 keys.

**Storage.** One KV document per category, `category:<id>`:
`{ ranOn, updatedAt, status, notes?, items, lessons?, meta, history, diagnostics }`.

**Routes** (Bearer, like the others):
- `GET /categories/:id`: `{ status, updatedAt, notes?, items, lessons }`, or `never`.
- `POST /categories/:id/run` with `{ force? }`.

**Limits.** Once per UTC day per category unless forced, or unless that day's run failed. At most 3 spending runs per
category a day (`category:attempts:<id>:<day>`).

### 3. Lessons (every 6 days)

- **When.** On a category's scan when its lessons are 6 or more days old, or missing. Scans come every 3 days, so that is
  every second scan.
- **Picking techniques.** One AI call picks 3 techniques for each area (`photo`, `video`, `edit`). It chooses from the
  category's top trending styles, the editing dictionary, and standard techniques for the subject (for Cars
  photography: panning at a slow shutter, light painting, low-angle hero shots). For each technique it returns
  `{ name: { en, ar }, query }`, where the query is the English search words. The answer is checked with zod, tolerantly.
- **Videos.**
  - One English Tavily search per technique ("`query` tutorial") over youtube.com, instagram.com and tiktok.com. It keeps
    1 tutorial (YouTube preferred; titles with "how to" or "tutorial") and 2 examples (Instagram or TikTok preferred).
    Examples can also come from the category's trend samples.
  - One Arabic search per category ("شرح تصوير ومونتاج <Arabic name>", YouTube). Each Arabic tutorial goes to at most one
    technique: an area that keeps last cycle's techniques keeps its own; among the new techniques, the first that the AI
    names it for, photo → video → edit.
  - That is **10 credits a refresh** at most, every 6 days per category: a technique picked twice (its name or its
    search words again) is searched once.
  - A technique with no video found is not shown.
- **How-to.** One AI call per area, the 3 at once, writes a how-to per technique in English and Arabic: 2–3 lines, at most
  220 characters each. It is written from the found tutorials' titles and snippets: shoot, settings or gear, edit. The
  page marks it ✦ AI.
- **Skill link.** Each call also picks at most one skill id per technique from the real skill list, or none. The list
  holds id plus English and Arabic names, from the DaVinci packs and the craft skills. A test keeps the Worker's copy in
  sync with the app's. An id outside the list is dropped; a bad skill id or Arabic tutorial number costs only itself,
  never the how-to.
- **Storage.** `lessons: { updatedAt, photo: Technique[], video: Technique[], edit: Technique[] }`, where:

  ```
  Technique = { name: { en, ar }, howTo: { en, ar }, skillId?, videos: { url, title, platform, kind: "example" | "tutorial", lang }[] }
  ```

- **On failure.**
  - A refresh with nothing new keeps last week's lessons whole, with the note `lessons`.
  - An area with nothing new keeps last week's techniques for that area: its how-to call failed, or none of its
    techniques kept a video and a how-to. The other areas still get their new techniques.
  - No refresh is tried when the trends' save failed: lessons that can't be stored stay due for the next scan.
- **Saving.** The trends are saved first. The lessons are saved a second time, at least 1.1 s later, because KV takes
  one write a key a second and refuses a quicker one.

### 4. Cost, safety and testing

**Tavily credits a month (estimate):**

| Use | Credits |
| --- | --- |
| Category trends (4 × 6 a day) | ~720 |
| Category lessons (12 × 10 every 6 days) | ~600 |
| Trending effects | ~540 |
| Normal Discover use | ~150 |
| **Total** | **~2,000** |

That is about 1,000 over the free plan, roughly $8 a month at $0.008 a credit with pay-as-you-go. The owner turns
pay-as-you-go on in his Tavily account; Claude never handles payments.

**Budget guard.** At 90% of the month's credits (Discover's cached figure; when none is kept, Tavily's own `GET /usage`,
asked once and kept 10 minutes), category scans and lessons pause and keep their last results. The month is the plan
plus a positive pay-as-you-go limit; an unknown figure is not tight. They add the note `tavily_budget`. Trending
effects cuts back as it already does, on the same figure and the same month (one rule, `monthTight`).

**YouTube.** Lessons find YouTube videos through Tavily, so the shared `search.list` 100 a day is untouched.

**Workers AI.** The estimate is about 6,000 of the free 10,000 neurons a day for categories:
- 4 scans × 3 batches;
- about 2 lesson refreshes × 4 calls (1 pick, then 3 how-to calls, one per area);
- plus Trending effects and Discover.

On a day the AI is unavailable, new names wait (`ai_fallback`) and lessons keep last week's. If that happens often,
Workers Paid ($5 a month) lifts the limit; the live check measures it first.

**Each invocation.** One category per invocation, either a cron slot or a POST. CPU is about 70–90 ms, as for effects;
Cloudflare has reported no CPU-limit errors so far. Subrequests per run are at most about 31, under the 50 a free
invocation allows:
- 16 Tavily searches and 1 Tavily `/usage`;
- 7 AI calls: 3 cleanup batches, 1 pick and 3 how-to calls;
- 7 KV operations.

**KV writes.** About 6 a day plus the attempt counters, well under 1,000.

**Testing:**
- Worker unit tests:
  - the turns and slots on the grid;
  - the category queries;
  - extraction with the camera words and category generics;
  - scoring;
  - the lessons schema (tolerant), video picking, skill-id validation and a failed-refresh fallback;
  - routes, limits and the budget guard.
- Dashboard tests: the page's states, chips, shelves, technique cards, the skill link, Scan again and "Search all".
- e2e: a stubbed category page on phone and desktop, AR and EN.
- **Live check:** Cars, Food and Travel on the real server. Read the chips and shelves against what is actually trending,
  measure credits, AI neurons and CPU, and watch the shelves' video quality.

### 5. Open items

- Real AI neuron use and CPU per category scan (live check).
- Whether lessons' combined-domain search finds enough Instagram and TikTok examples, or examples should come mostly from
  the trend samples.
- Later, not now: owner-added categories, and the connector's `get_trends` exposing category trends.

## Built (planning/plans/2026-10-06-category-trends.md)

- **Worker:** `workers/scout/src/categories/` (defs, types, run, lessons, skills, routes), built on Trending effects'
  parts with optional arguments (extraction extras, the AI's context line, the memory's key cap, any KV key, the
  searches' numbering and budget decision, `rememberPosts`) and shared helpers (`monthUsage`, `countAttempt`,
  `askAi`). Trending effects' existing tests kept their assertions except in two places, both from Task 2:
  - the slot test's plain grid tick moved from 05:40 to 06:00, because 05:40 is a category slot now;
  - the budget guard's case in `sources.test.ts` was rewritten for the shared `monthUsage` (Discover's figure, else
    Tavily's own `/usage`), and `sources.test.ts` and `routes.test.ts` now keep a Tavily figure in KV, so their fetch
    counts stay the searches alone.

  Each new argument has its own new test beside them. Discover's existing tests passed unchanged; new ones cover
  `tavilyCall`'s several platforms, and the refused answers that it and Tavily's `/usage` let go of.
- **Dashboard:** `lib/categories.ts`, `components/research/CategoryPage.tsx`; ResearchPanel shows the page when a
  built-in category is tapped with nothing typed. Leaving the page into a search (Search all, a style) moves focus to
  the category's chip, the page's opener (the search box only if the chip is missing): focusing a text box can pop a
  phone's keyboard over the results. While an AI search can't run (no model chosen) Search all rests, as the category
  chips do.
- **Decisions where this spec was silent, or two of its rules met:**
  - Every spending run counts against a category's 3 a day, forced ones included. Effects lets `force` skip its cap;
    this spec gives no such exception, and the page's limit line needs it.
  - "The month's credits" is the plan plus a positive pay-as-you-go limit: the cost table counts on pay-as-you-go.
    Trending effects counts it the same way, on the same figure (one rule, `monthTight` in `effects/sources.ts`). A
    paused run writes the page as `failed` with `ranOn` today and `tavily_budget`, keeping its `updatedAt` (the page's
    age reads `updatedAt`), and counts no attempt.
  - Lessons refresh every 6 days, every second scan: "weekly" with 3-day scans would have been every 9 days. The
    how-to is one AI call an area, the 3 at once, because one call for all 9 risked the time limit that effects' single
    AI call hit live.
  - Lessons need the AI binding: without it, no refresh is tried. A refresh runs after the trends are saved and saves
    again at least 1.1 s later (KV takes one write a key a second), so a slow refresh never costs the trends; none
    runs when the trends' save failed.
  - A technique without a usable how-to is dropped (`howTo` is required). An invalid optional `skillId` or Arabic
    tutorial number drops only that field, counted `bad_skill` / `bad_ar`. A technique picked twice is searched once
    (`duplicate_pick`).
  - An area with nothing new keeps last cycle's techniques, with their Arabic tutorials, which no new technique gets;
    the lessons' log names those areas (`kept`; all three when a refresh stops early). A refresh that keeps nothing
    keeps the last lessons, noted `lessons`.
  - A trending style's tap sends `{ q: "<style>", genreQuery: <the category> }`: Discover's own "style within the
    category".
  - No page from the Worker gives today's category search: an older Worker's 404, a refused token, a KV error (502)
    or no network. Owner-added categories and the `?genre=` deep link keep the search; a deep link closes its
    category's page.
  - No lock across tabs, or between the cron and a tap in the same minute (accepted): two runs can both spend, and KV's
    one write a key a second can drop one run's lessons save.
  - `tavilyCall` takes several platforms: one credit covers YouTube, Instagram and TikTok together.
  - The skills index is `workers/scout/src/categories/skills.json`, generated from the app's skills.
    `data/skills/skills-index.test.ts` keeps it in step and holds the command that regenerates it. It compares parsed
    JSON, because Windows checkouts turn the file's line endings into CRLF.
- **Tests:** `pnpm test` 2,195 in 108 files (the Worker's 906 in 34 included); e2e 340 passed (phone 170, desktop 170)
  and 6 skipped by design (tests that run on one project only) of 346. Lint, typecheck (app and Worker) and build
  clean.
- **Budgets:**
  - 6 Tavily credits a scan, 4 scans a day (about 720 a month);
  - lessons at most 10 credits a category every 6 days (about 600 a month);
  - no YouTube Data API;
  - ≤ 31 subrequests a run (≤ 7 AI calls);
  - about 10 KV writes a day.
