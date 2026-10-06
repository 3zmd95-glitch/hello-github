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
- It makes **at most 3 spending runs a UTC day** without `force`, the 05:35 run included.
  - Why: a run lost before it saves (the CPU limit, or a first scan dropped after `waitUntil`'s 30 s) leaves the day open, so each retry would spend 6 Tavily credits again.
  - How: a KV counter, `effects:attempts:<day>` (2-day TTL), is read and raised before the first search. A run that only answers the stored list (the guard above) is not counted, and `force` skips the cap.
  - Past 3, the run answers the stored list, or a failed answer with no list when there is none, with the note `attempts`. It spends nothing and writes nothing.
  - If the counter can't be read or written, the run goes ahead, with the note `attempts_kv`. The note alone keeps the status `ok`: no step of the run was skipped.

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
   - **The first scan** (no memory yet: no stored document, or one whose history is empty) searches families 1–6 instead. They hold both of the owner's reels: "clone yourself video trend" and "gif sticker overlay reel trend". After that, the rotation goes by UTC day number.
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
   - A name that is a dictionary phrase plus its suffix word is filed under that entry, with no new name beside it: "speed ramp trend", "Clone Yourself Edit", "gif sticker effect", and `#gifstickertrend` (the phrase written as one hashtag word). The check is the exact phrase in matching form, as above, so a name with more words ("Flash Clone Edit", "Shadow Clone Trend") stays its own.
   - A new name (not in the dictionary) is keyed by its words in matching form (`normalizeTerm`, as the dictionary lookups use). So plural and singular spellings are one effect: "ghost frames trend" and "ghost frame trend" share `ghost-frame-trend`. The name itself stays as written.
   - For each candidate, record:
     - distinct posts
     - distinct creators (by handle, per platform)
     - platforms
     - up to 2 sample posts (url, title)
3. **AI cleanup (built-in AI, 1 call).**
   - **Input:** the 25 candidates with the most distinct creators over the last 7 days (history plus today), so a name that builds slowly across the rotation still gets judged. On a tie, names the AI has never approved go first. Each comes with up to 2 sample titles. Titles are clipped and passed as data, never as instructions.
     - A dictionary effect takes a slot only until it has its `what` line (usually its first day). After that, the 25 slots go to new names.
   - **Output:** JSON. Each verdict is checked on its own against a strict schema, and an invalid one is skipped without costing the rest. For each kept candidate:
     - `key` and `keep`
     - `sameAs`, which merges spellings (for example "cloning" and "clone yourself" into "clone effect")
     - `name: { en, ar }`; the prompt asks for Hijazi Arabic (the Saudi western-region dialect)
     - `what: { en, ar }`: one line, at most 90 characters
   - **Dictionary effects** always keep the dictionary's own labels, English and the curated Arabic. Only their `what` line comes from the AI.
   - **On failure or invalid output:** fall back to the rule list. New candidates keep their English text and are marked `checked: false`.
   - **Chips** are dictionary effects and names the AI has approved, that day or an earlier one. On a day with no answer (`ai_fallback`) or no usable verdict (`ai_empty`), those still show. New names the AI has never judged stay in memory until a day it does, so junk never shows unjudged.
   - **Time limits:** the AI call has its own 60 s. Each Tavily call and YouTube search has 12 s; the views call (`videos.list`) keeps its own 2.5 s (`STATS_TIMEOUT_MS`).
   - This call is separate from Discover's 20 AI plans a day.
4. **YouTube check (6 `search.list` + 1 `videos.list`).**
   - For each of the top 6 effects **mentioned today**: `search.list q="<query> edit" publishedAfter=now-7d` (20 results).
     - An effect seen only on earlier days is not checked: its views are kept on today's history entry, which it doesn't have.
     - The query is the name as the rules read it in today's posts: the dictionary label for a dictionary effect, else the new name as written. It is never the stemmed key or the AI's renaming, so `views7d` compares like with like.
   - Then one `videos.list` gets the views. It takes at most 50 ids, so each effect counts its first 8 videos (6 × 8 = 48).
   - Per effect this gives `newVideos` (all results) and `views7d` (the sum over those 8).
   - If YouTube's daily cap is reached, the step is skipped, with no penalty.
5. **Score and save (1 KV write)** to `effects:trending`; see below.

**Per-run budget.**
- About 18 subrequests (the limit is 50), the attempt counter's read and write included.
- 6 Tavily credits, about 180 a month.
- 6 of YouTube's 100 daily searches. With the radar's 18 and Discover's 70, the total is 94.
- 1 AI call, 1 KV write and the attempt counter's write.

### 2. What counts as trending

- **Main signal:** distinct **creators** on TikTok and Instagram mentioning the effect over the **last 7 days of scans**. Creators are counted, not posts, so one account can't fake a trend.
  - Each day's creators are kept per effect in the history as short hashes. The 7-day count is the union, so a trend builds up across the rotation.
- **Minimum to show:** 3 distinct creators over the 7 days, and at least one in the last 3 days (see growth).
- **Named trends:** besides "___ effect / transition / trick / filter" phrases and hashtags, the rules also keep names before "trend"
  (any case) and Title-Case names before "Edit". Tavily titles these posts like "How to Edit the New CapCut Reverse Trend" and "Clone
  Yourself with One Hair (Swagger Trend)". Generic words (viral, new, latest, capcut, tiktok, video, edit, trend, dance, challenge) are
  never part of a name, and neither is a year: "2027 trend" names nothing.
- **Growth:** compares the creators of the last 3 days with the 3 days before them.
  - Each family is searched once in every 3-day window, so the two windows are like for like.
  - `growth = |creators, days 0–2| / |creators, days 3–5|`, rounded to 0.01, when days 3–5 have creators. Otherwise it is 3 or 0, as below.
  - An effect with creators in days 0–2 but none in days 3–5 counts as growth 3. That covers effects never seen before.
  - An effect with no creators in days 0–2 has growth 0: it is fading. Its score is 0, so it is left out.
- **NEW:** the effect is not in the dictionary and was first seen in the last 7 days.
- **YouTube bonus:** `views7d` growth of at least 1.5×, against the effect's last recorded `views7d`. It adds a small boost and the "▶ ↑N×" note. No data means no penalty.
- **Score:** `creators × min(growth, 4) × (youtubeBonus ? 1.25 : 1)`.
- **Shown:** the top 8 by score. Ties go to whichever was first seen more recently.
- **Honest labels.** TikTok and Instagram figures say "mentioned by N creators this week". They are web-index mentions, never views. Only YouTube shows real view numbers.

### 3. Storage and routes

KV `effects:trending` holds one document (`EffectsDoc` in `src/effects/types.ts`), written at most once a day (a forced run, or a retry after a failed run, adds one). A second key, `effects:attempts:<day>` (2-day TTL), counts the day's spending runs (§1).

```ts
{
  ranOn: "2026-10-06",            // UTC day of the last run
  updatedAt: "2026-10-06T05:35:12Z", // the last run that scanned; a failed day keeps the previous one
  status: "ok" | "partial" | "failed",  // partial: AI or YouTube step skipped; failed: Tavily unusable
  notes?: string[],               // e.g. ["ai_fallback", "youtube_cap"]; also ai_empty, youtube_stats, kv, error,
                                  // attempts, attempts_kv
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

  The 400 keys are sized for about 120 new candidates a day: a 1-creator name then survives until its family's next scan, 3 days later. That assumes about 12 AI approvals a day and few dictionary names in memory: both are protected, so each takes a key from the 1-creator names. It also counts on the AI's drops: the AI judges 25 new names a day, and the ones it does not approve (~13) leave the memory at once (`applyVerdicts` in `run.ts`). Dictionary names don't take those slots after their first day (they are sent to the AI only until they have their line). A day without a usable AI answer (`ai_fallback`, `ai_empty`) drops nothing, so such a day holds fewer new candidates than the row says.

  | Dictionary names in memory | AI approvals/day | Holds up to |
  | --- | --- | --- |
  | 0 | 12 | 130/day |
  | 20 | 12 | 123/day |
  | 36 | 12 | 118/day |
  | 0 | 25 | 99/day |

  These were found with the real `runEffects` and fake Tavily, YouTube, AI and KV, like `run.test.ts`'s daily-runs test (a throwaway script, not committed). Each day brings N new 1-creator names and the dictionary names (seen daily, never judged by the AI: the run's behaviour once each has its line); the AI approves the first A names it judges and drops the rest; and the slow name, last among its day's ties, gains a creator on days s, s+3 and s+6 (s = 7–10). "Holds up to" is the largest N at which the slow name always shows with 3 creators. Re-run on the final review's fixes (2026-10-06), it gave the same four numbers.

  The run's log line reports `keys`, `protected` and `trimmed`, and what the AI did, `ai: { judged, dictionary, approved, dropped, merged }`: the usable verdicts it gave, how many of them were on dictionary effects, and the new names it approved, dropped or merged into another. All counts, no names. `judged` counts usable verdicts only, so an `ai_empty` day logs 0 even though the AI answered (as does an `ai_fallback` day, when it did not). The live check reads them against this table:
  - `protected` (dictionary names plus about a week of approvals, ~84 at 12 a day) picks the row.
  - At the cap (`keys` 400), `trimmed` + `ai.dropped` + `ai.merged` is the day's new candidates: 107 + 13 + 0 = 120 at 120 a day with 12 approvals. Compare that sum with the table, not `trimmed` alone.
  - `ai.dictionary` should be 0 on most days: a dictionary effect takes an AI slot only until it has its line.
  - Above the row's limit, a slow name is cut before its family's next scan: raise `HISTORY_KEYS` (the document stays far under KV's 25 MiB) or tighten extraction.
- An effect's first-seen day is its earliest kept entry.

Handles are hashed (SHA-256, first 8 hex) so the stored document holds no account names. Only the 2 sample posts keep a visible handle.

- **`GET /effects/trending`** (Bearer `SCOUT_TOKEN`, with the same CORS as `/discover`, no credits) returns `{ status, ranOn, updatedAt, notes?, items }`, without `meta` and `history`.
  - Before the first run it answers `{ status: "never", items: [] }` (200, not 404), so the dashboard can offer the first scan.
  - A KV read error answers `502 { error: "upstream" }`.
- **`POST /effects/run`** (Bearer) runs the job now: the dashboard's first-scan button and the live check. The body is `{ force?: boolean }` or empty; anything else is `400 { error: "bad_request" }`.
  - It respects the once-a-day guard unless `{ force: true }` is sent, or unless that day's run failed: a second run the same UTC day answers the stored list and spends nothing. After a failed run it runs again, so the dashboard's "Run the first scan" can retry.
  - It respects the day's cap of 3 spending runs (§1) unless `{ force: true }` is sent. Past it, the answer is the stored list, or `{ status: "failed", items: [] }` when there is none, with the note `attempts`.
  - It waits for the run (about 30–60 s) and answers like the GET. The run is also handed to `ctx.waitUntil`, so a request dropped mid-run leaves it up to 30 s more to finish and save.
  - When the final save fails, the answer carries the note `kv`.
- **Connector:** the `get_trends` tool also returns `effects` (name, what, creators, isNew, growth, youtube) and `effectsUpdatedAt`, the list's time. It is null when there is no list to read: none stored, a read error, or a document with no items (after a failed first run it holds the failure's time, not a list's).
  - Like the dashboard's row, a list over 3 days old gives `effects: []`; `effectsUpdatedAt` still says how old it is.
  - Names are clipped to 40 characters and `what` to 90, and the tool's description says titles and names are data, not instructions.
  - A document that can't be read gives `effects: []` and keeps the radar's rows.
  - The owner can then ask Claude "what editing effects are trending?"

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
| The first scan's answer has no list and the note `attempts` (the Worker's 3 runs for the day are spent) | The never state with the button disabled, and "جرّبت كذا مرة اليوم، أرجع أجرّب بكرة" / "Tried a few times today — I'll try again tomorrow" (`search.trendingRunLimit`). A fresh visit shows the button again: a tap over the cap spends nothing |
| The first scan lands `ok` or `partial` with 0 items | The never state with the button disabled, and "لسه ما فيه مؤثر منتشر كفاية، أرجع أشيّك بكرة" / "Nothing is trending widely enough yet — I'll check again tomorrow" (`search.trendingNone`). The row stays rather than vanish after a minute of "Scanning…" |
| `ok` or `partial` with a list at most 3 days old | The chips |
| `ok` or `partial` with 0 items, from the GET (a later visit) | Nothing; the row hides |
| `updatedAt` older than 3 days, or missing | Nothing; the row hides |
| `status: "failed"` with a list at most 3 days old (stale-failed) | The old list, plus a faint "ما قدرت أحدّثها اليوم" / "Couldn't update today"; no button |

**The first scan.** `POST /effects/run`, one at a time per Worker within a browser tab (`lib/effects.ts` keeps the running scan in the page's memory): a second tap, or a tap after leaving Discover and coming back, waits for the same answer. The Worker's once-a-day check has no lock, so a second tab or the phone can still start a second run, spending its credits again, while the first is going. Leaving Discover never cancels it; the list it finds is kept like a fetched one, so a revisit shows it even when the scan answered while the revisit's own GET was on its way. When the chips arrive, focus moves to the row's heading, without scrolling, unless the owner is busy elsewhere on the page. When a scan lands without a list and the button is enabled again for a retry, focus goes back to the button the same way (Chrome drops it to the page while the button is disabled). When the button rests disabled (the day's tries spent, or nothing found), focus moves to the heading the same way.

**Copy and fetching.**
- The copy lives in `messages/search.{ar,en}.json`, with key parity and Hijazi Arabic first.
- The list is fetched through `scoutCall` once per Discover visit (no credits) and kept 1 h per Worker in the tab's session storage, so a revisit shows the row at once. Only a list is kept: a "never" answer, a failed first run or an empty run is asked again, as the next run can land any minute.

### 5. Failures and safety

- **Tavily quota or auth failure:** status `failed`. The previous items are kept; only the date and notes are written. Like any spending run, it writes twice: the attempt counter, then the list.
- **AI failure or no usable verdict:** the rule list is used: dictionary effects and names the AI approved before show, new names wait (see step 3). Status `partial`, note `ai_fallback` or `ai_empty`.
- **YouTube cap reached:** the check is skipped, with status `partial`.
- **Lost runs:** a run cut off before it saves (the CPU limit, a first scan dropped after `waitUntil`'s 30 s) leaves the day open. The cap of 3 spending runs a UTC day (§1) stops paying for retries; the 4th answers with the note `attempts`.
- **KV write failure:** the stored list stays as it was, and the run's answer carries the note `kv`.
- **Untrusted text:** web titles and snippets are treated as data. The AI prompt says so, its output is validated, and names and lines are clipped.
- **No side effects:** nothing posts or touches the owner's social accounts. Sample URLs are canonical post links (`isVideoUrl`).

### 6. Testing

- **Worker (plain Node):**
  - candidate extraction from titles and hashtags (`#cloneeffect` → "clone effect")
  - both reels: "The Clone Trend 👥 #clonetrend" is the clone effect; four sticker captions are GIF stickers; a dictionary phrase plus a suffix word ("Clone Yourself Edit", `#gifstickertrend`) makes no second name
  - plural and singular spellings of a new name share one key; a year names nothing
  - the block list, and creators counted per platform
  - growth from history, NEW logic, the score and the top 8; a fading effect is left out
  - AI schema validation and the fallback; on a day without the AI, names it approved before still show
  - a dictionary effect goes to the AI only until it has its line, and keeps its own labels
  - the per-run budgets, and once-a-day vs force (a day whose run failed runs again)
  - the first scan searches families 1–6; later scans the day's rotation
  - the cap of 3 spending runs a UTC day: the 4th spends nothing and says so, force skips it, a good day never touches the counter, a counter that can't be read or written never stops a run
  - YouTube checks only names mentioned today, asking for the name as written
  - routes: auth, and `status: "never"` before the first run
  - the connector: no effects past 3 days, with `effectsUpdatedAt` (null when no list was ever made)
  - the cron slot sits on the grid
- **Dashboard (jsdom):**
  - row states: hidden, never (the first-scan button, waiting, failed, and the Worker's own failed first run), list, failed but recent, old, a run with 0 items
  - a first scan over the day's cap, and one that finds nothing: the button off with its line
  - focus back on the button after a scan lands without a list, or on the heading when the button rests
  - chip text in both languages
  - a tap runs one search with the right query, in Keywords mode, and clears the category
  - an old Worker's 404 hides the row
- **E2E:** a stubbed `/effects/trending` → chips show → a tap sends `POST /discover` with the effect.
- **Live check after deploy:**
  1. Run `POST /effects/run` once (the dashboard's "Run the first scan").
  2. Record the list in this file.
  3. Compare it by hand with TikTok Creative Center and the owner's own feed.
  4. Read the run's log line (`keys`, `protected`, `trimmed` and `ai`) against the table in §3, and its CPU time in Workers Observability.
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
- **Dictionary additions for the owner's two reels — done (2026-10-06, the final review's fix round).** Both are in `planning/data/edit-terms.json`, which Discover's search reads too:
  - `clone-effect` also matches "clone trend", so "The Clone Trend" and `#clonetrend` count as the clone effect instead of splitting off. Not "clone edit": it would swallow "Flash Clone Edit", which stays its own named trend.
  - A new entry, `gif-stickers` ("GIF stickers" / "ستيكرات متحركة", an effect, `specific`). It matches "gif sticker", "animated sticker", "sticker overlay", "gif overlay" and "moving sticker", and the Arabic "ستيكرات متحركة" and "ملصقات متحركة". The sticker captions rarely end in "effect" or "trend", so without it the second reel had no reliable way to a chip.

## Known limits

- Creator counts swing on a 3-day cycle (the 7-day window holds 2 or 3 scans of a family), so a name near the 3-creator bar can flicker.
- Instagram posts without a handle count as separate creators (each post URL is its own id).
- `GET /effects/trending` and `get_trends` parse the whole memory document; watch their CPU time at the live check.
- `sources.ts` repeats part of `tavilyCall` for its two-domain search (tech debt).
- A new name's chip searches the AI's English name, which can differ from the words in the posts.
- The AI can merge a spelling into a dictionary effect only on a day that effect is sent to it (until it has its line). After that, the rules file a spelling under the effect only when it is a dictionary phrase, in a post or as a name that is a phrase plus its suffix word ("Clone Yourself Edit", `#gifstickertrend`); any other spelling ("Shadow Clone Trend") stays a new name beside the dictionary's chip.
- A new name's YouTube query is its spelling in that day's posts, so a plural and a singular can take turns between days.

## Built (2026-10-06)

Plan: `planning/plans/2026-10-06-trending-effects.md` (5 tasks), on branch `claude/trending-effects-spec`.

- **Files.**
  - Worker, `workers/scout/src/effects/`: `types.ts`, `families.ts` (18 family queries, 6 a day), `extract.ts` (the rules), `ai.ts` (one built-in AI call, each verdict checked with zod), `sources.ts` (Tavily, YouTube), `score.ts` (the 7-day memory, growth, score), `kv.ts`, `run.ts` (the daily run) and `routes.ts`, with 8 test files beside them.
  - Worker wiring: `scout.ts` (the routes), `social/cron.ts` (`EFFECTS_SLOT` 05:35 UTC), `discover/tools.ts` and `mcp.ts` (the connector's `effects`), the README.
  - Dashboard: `lib/effects.ts`, `components/research/TrendingEffects.tsx` (placed by `ResearchPanel.tsx`), 11 copy keys in `messages/search.{ar,en}.json`.
  - Dictionary: the `clone-effect` words and the `gif-stickers` entry in `planning/data/edit-terms.json` (Open items).
- **Tests.**
  - Worker: 92 in `src/effects/`. They cover extraction (both reels, plural keys, years), scoring, the 400-key memory, the sources, the AI's schema and fallback, the run's budgets and attempt cap, the first scan's families, a 14-day steady-state run, the routes and the 05:35 slot. The connector's `effects` and their 3-day rule are tested in `discover/tools.test.ts`, and the slot joins the cron grid test.
  - Dashboard: 35 in `lib/effects.test.ts` and `TrendingEffects.test.ts`, 2 in `ResearchPanel.test.ts`, and 1 e2e test in `e2e/discover.spec.ts`.
  - Totals on the final full run (the final review's fix round and its follow-up): `pnpm test` 2,019 tests in 90 files (the Worker's 819 included); e2e 292 passed and 4 skipped by design (tests that run on one screen size only) of 296, on phone (145 passed) and desktop (147 passed). Lint, typecheck and build clean.
- **Budgets per run.**
  - 6 Tavily credits (about 180 a month), ≤ 6 YouTube `search.list` + 1 `videos.list`, 1 AI call (`max_tokens` 3000, 60 s), 1 KV write plus the attempt counter's, about 18 subrequests.
  - A second run the same UTC day spends nothing, unless that day's run failed (the retry runs again). At most 3 spending runs a UTC day without `force`: at most 18 Tavily credits on a bad day.
  - The document is ~104 KB at 400 keys after 14 daily runs in the test (≤ 250 KB asserted). A realistic worst case is ~0.4–0.7 MB, against KV's 25 MiB per value.
- **Reviews.** Every task was reviewed against this spec and every fix round re-reviewed. Task 1 (extraction, scoring) took one fix round, its faster lookup re-checked on 22,976 texts with 0 mismatches. Task 2 (sources, AI, run) took three, ending with the 400-key memory and the 7-day protection. Task 3 (routes, slot, connector) passed first time. Task 4 (the row) took two: its re-review came back clean, and round 2 added the retry after a failed first run (the button and the failure line, and the Worker's guard running a failed day again), the scroll fix and the cache re-read. The final whole-branch review traced both of the owner's reels end to end; its fix round added the dictionary entries, the plural keys, the first scan's families, the attempt cap, the connector's age rule and the smaller fixes above. Its re-review found no Critical or Important problems; a follow-up fixed its six minors (a dictionary phrase before any suffix word, focus when the button rests, `effectsUpdatedAt` with no list, and three doc lines).
- **Not verified until the live check:**
  - **CPU on the Free plan** (10 ms per request or cron run). Extraction alone measured ~7.5–10 ms warm and ~17 ms cold in Node. Read the run's CPU time in Workers Observability. If it is over, split the job across two slots: search and extract, then AI, YouTube and score.
  - **The AI call's time and size.** 25 bilingual verdicts were estimated at 2,000–2,500 tokens; that has not been measured on the real model.
  - **Real candidate volume.** The memory's table (§3) assumes about 12 approvals a day. The log's `keys`, `protected`, `trimmed` and `ai` show which row applies.
  - **How well the sticker trend is separated.** The "gif sticker overlay" family mixes crowns, hearts and caption stickers. Every post that says "gif sticker", "animated sticker", "sticker overlay" or the like now counts towards the dictionary's GIF stickers chip, whatever its stickers; nobody knows yet whether a separate name for the owner's hiking-reel style shows up beside it.
  - **The first scan's wall time.** It should be about 30–60 s, under the edge's ~100 s limit; if not, the owner waits for the 05:35 run.
