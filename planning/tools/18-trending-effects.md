# 18 · Trending effects in Discover

**Status:** design approved in chat on 2026-10-06; the spec is waiting for the owner's review. Nothing is built yet.

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

## Design

### 1. Daily job (Worker, `src/effects/`)

**When it runs.**
- A new UTC slot, `"05:35"` (08:35 Riyadh), sits beside `TREND_SLOTS` on the five-minute grid. It is clear of the sync minutes (03:00–03:30) and the trend minutes (:05), and a test guards it.
- It runs **at most once per UTC day**. The saved document's `ranOn` is checked first, so this guard costs no extra KV write.

**Steps.**

1. **Find mentions (Tavily, 6 credits).** Six searches, global (no country) and in English:
   - Settings: `time_range: "week"`, `max_results: 20`, `search_depth: "basic"`.
   - 3 searches with `include_domains: ["tiktok.com"]` and 3 with `include_domains: ["instagram.com"]`.
   - Fixed wording aimed at editing trends, for example "viral video editing effect trend", "trending capcut edit effect tutorial", "new transition effect reel".
   - At most 120 posts in total.
2. **Pull out candidates (rules, free).**
   - Every dictionary entry matched in a post's title or snippet (`matchTerms`, the same matching form as search).
   - English phrases of 1–3 words before "effect", "transition", "trick", "edit trend" or "filter".
   - Hashtags ending in those words. `#cloneeffect` becomes "clone effect": the known suffix is split off and the rest is kept as one word.
   - A block list drops known junk: "sound effect(s)", "butterfly effect", "special effects", "video effect", "the effect", "visual effect".
   - For each candidate, record:
     - distinct posts
     - distinct creators (by handle, per platform)
     - platforms
     - up to 2 sample posts (url, title)
3. **AI cleanup (built-in AI, 1 call).**
   - **Input:** the top 25 candidates by creators, each with up to 2 sample titles. Titles are clipped and passed as data, never as instructions.
   - **Output:** JSON, checked against a strict schema. For each kept candidate:
     - `key` and `isEditingEffect`
     - `sameAs`, which merges spellings (for example "cloning" and "clone yourself" into "clone effect")
     - `name: { en, ar }`
     - `what: { en, ar }`: one line, at most 90 characters
   - **On failure or invalid output:** fall back to the rule list.
     - Dictionary effects keep their own `label`.
     - New candidates keep their English text and are marked `checked: false`.
   - This call is separate from Discover's 20 AI plans a day.
4. **YouTube check (6 `search.list` + 1 `videos.list`).**
   - For each of the top 6 cleaned effects: `search.list q="<en name> edit" publishedAfter=now-7d order=viewCount maxResults=25`.
   - Then one `videos.list` gets the views for all returned ids.
   - Per effect this gives `newVideos` (count) and `views7d` (sum).
   - If YouTube's daily cap is reached, the step is skipped, with no penalty.
5. **Score and save (1 KV write)** to `effects:trending`; see below.

**Per-run budget.**
- About 16 subrequests (the limit is 50).
- 6 Tavily credits, about 180 a month.
- 6 of YouTube's 100 daily searches. With the radar's 18 and Discover's 70, the total is 94.
- 1 AI call and 1 KV write.

### 2. What counts as trending

- **Main signal:** distinct **creators** on TikTok and Instagram mentioning the effect this week. Creators are counted, not posts, so one account can't fake a trend.
- **Minimum to show:** 3 distinct creators.
- **Growth:** today's creators compared with the same effect 3 days earlier in the 14-day history.
  - `then` is the effect's most recent history entry that is at least 3 days old.
  - `growth = today / max(1, then)`.
  - An effect with no such entry counts as growth 3. That covers effects never seen before and effects first seen 1–2 days ago.
- **NEW:** the effect is not in the dictionary and was first seen in the last 7 days.
- **YouTube bonus:** `views7d` growth of at least 1.5×, against the effect's last recorded `views7d`. It adds a small boost and the "▶ ↑N×" note. No data means no penalty.
- **Score:** `creators × min(growth, 4) × (youtubeBonus ? 1.25 : 1)`.
- **Shown:** the top 8 by score. Ties go to whichever was first seen more recently.
- **Honest labels.** TikTok and Instagram figures say "mentioned by N creators this week". They are web-index mentions, never views. Only YouTube shows real view numbers.

### 3. Storage and routes

KV `effects:trending` holds one document, written at most once a day:

```ts
{
  ranOn: "2026-10-06",            // UTC day of the last run
  updatedAt: "2026-10-06T05:35:12Z",
  status: "ok" | "partial" | "failed",  // partial: AI or YouTube step skipped; failed: Tavily unusable
  notes?: string[],               // e.g. ["ai_fallback", "youtube_cap"]
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
  history: Record<string, { day: string; creators: number; views7d?: number }[]>; // ≤ 14 days per key, ≤ 60 keys
}
```

History trimming: entries older than 14 days are dropped. If more than 60 keys remain, the keys with the fewest creators
on their latest day are dropped first. An effect's first-seen day is its earliest kept entry.

- **`GET /effects/trending`** (Bearer `SCOUT_TOKEN`, with the same CORS as `/discover`) returns `{ updatedAt, ranOn, status, items }`, without the history.
- **`POST /effects/run`** (Bearer) runs the job now, for the live check. It respects the once-a-day guard unless `{ force: true }` is sent.
- **Connector:** the `get_trends` tool also returns `effects` (name, what, creators, isNew, youtube). The owner can then ask Claude "what editing effects are trending?"

### 4. Discover row (dashboard)

**Placement and header.**
- The row sits under the search box, above the category buttons.
- Title: "🔥 ترند المؤثرات هالأسبوع" / "🔥 Trending effects this week", followed by "updated N h ago" and a small "TikTok Creative Center ↗" link.

**Chips.** One horizontal row of chips. In Arabic it swipes right-to-left. Each chip shows:
- the name in the UI language, falling back to English;
- a **جديد / NEW** badge when `isNew`;
- a reason line, for example "9 صنّاع · ▶ ↑3×" / "9 creators · ▶ ↑3×";
- the `what` line in a tooltip on hold or hover.

**Tap.** Runs a Discover search for the effect. The query is the dictionary label when `termId` is set, otherwise the English name. Any selected category is cleared. It is a normal search: about 6 credits the first time, and free from the cache within 6 hours.

**States.**

| Situation | What shows |
| --- | --- |
| No document yet, or a Worker without the route (404) | Nothing; the row hides |
| `updatedAt` older than 3 days | Nothing; the row hides |
| `status: "failed"` with a list at most 3 days old | The old list, plus a faint "ما قدرت أحدّثها اليوم" / "Couldn't update today" |

**Copy and fetching.**
- The copy lives in `messages/search.{ar,en}.json`, with key parity and Hijazi Arabic first.
- The list is fetched through `scoutCall` once per Discover visit (no credits), with a 1 h session cache.

### 5. Failures and safety

- **Tavily quota or auth failure:** status `failed`. The previous items are kept; only the date and notes are written, still one write.
- **AI failure:** the rule list is used (see step 3), with status `partial`.
- **YouTube cap reached:** the check is skipped, with status `partial`.
- **Untrusted text:** web titles and snippets are treated as data. The AI prompt says so, its output is validated, and names and lines are clipped.
- **No side effects:** nothing posts or touches the owner's social accounts. Sample URLs are canonical post links (`isVideoUrl`).

### 6. Testing

- **Worker (plain Node):**
  - candidate extraction from titles and hashtags (`#cloneeffect` → "clone effect")
  - the block list, and creators counted per platform
  - growth from history, NEW logic, the score and the top 8
  - AI schema validation and the fallback
  - the per-run budgets, and once-a-day vs force
  - routes: auth, and 404 before the first run
  - the cron slot sits on the grid
- **Dashboard (jsdom):**
  - row states: hidden, list, failed but recent, old
  - chip text in both languages
  - a tap runs one search with the right query and clears the category
  - an old Worker's 404 hides the row
- **E2E:** a stubbed `/effects/trending` → chips show → a tap sends `POST /discover` with the effect.
- **Live check after deploy:**
  1. Run `POST /effects/run` once.
  2. Record the list in this file.
  3. Compare it by hand with TikTok Creative Center and the owner's own feed.
  4. Report plainly what it caught and what it missed.

## Out of scope (later, if wanted)

- A separate Saudi / Arabic list (the owner chose global first).
- Adding a NEW effect to the dictionary from its chip.
- Notifications when a new effect appears.
- Using the editor panel's ~70 creators as a signal (project 2).

## Open items

- **Arabic clone-effect words.** The dictionary's bare "استنساخ" also matches biology cloning. On 2026-10-06 the owner was offered the small fix (editing phrases like "استنساخ نفسك بالفيديو") and has not picked it yet. A trending chip for the clone effect would run that same search.
