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
- **English first** (live fix 1, the owner on 2026-10-07: "I want everything to be english first"). Trend and
  technique names and how-tos show in English first in both UI languages. Arabic is only a secondary line, and only
  when it is real Arabic script: the page drops an Arabic text without Arabic letters, as the Worker does. The app's own
  labels (menus, buttons, shelf titles) keep both languages.
- **🔥 Trending in Cars this week.** A row of chips: the Cars edit styles being posted now, with creator counts and NEW,
  trends first, at most 12. Each chip shows its English name; its tooltip holds the English line of what it is and,
  under it, the Arabic name (the 🔥 Trending effects row does the same). A tap searches that style within Cars in
  Keywords mode, for example "rolling shot car edit". A page over 7 days old says "🔥 Trending in Cars", without "this
  week".
- **🏆 Top in Cars** (§6, 2026-10-07): YouTube · TikTok · Instagram tabs, each up to 50 videos: the stored lists best
  first, then Brave's group as Brave gave it.
- **Three shelves:** 📷 Photography, 🎥 Videography and ✂️ Editing. Each is a sideways row of about 3 technique cards
  for the category. A card shows:
  - the technique's English name; in the Arabic UI the Arabic name follows as a muted line, right to left;
  - a ✦ AI how-to in three English lines (live fix 2), one under another: "Shoot:" where to stand or move and how to
    frame it for the subject, "Settings:" the real values, and "Edit:" the app and its tool. It reads left to right;
    in the Arabic UI the Arabic how-to follows as a muted paragraph, right to left;
  - 🎯 the skill it practices, which opens that skill. It shows only when there is a real match;
  - up to 3 videos of the technique for the subject: the best examples, and a tutorial only when one teaches (the
    owner: "Plus it doesn't have to be tutorial"), plus an Arabic tutorial when one matched. They play in the app's
    player.
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

**Searches** (live fix 1). 6 English queries a category, each asked once, on Instagram over a month. They are built
from `genres.json` `queries.en`: q1 is the first ("car edit"), q2 the second, and the subject is q1 without its
" edit" ("car"). The queries are "q1 trend", q2, "viral q1", "q1 transition", "q1 capcut template" and "subject video
trend". For Cars: "car edit trend", "cinematic car edit", "viral car edit", "car edit transition", "car edit capcut
template" and "car video trend". That is still **6 Tavily credits a scan**. Posts are deduped by URL.

Why: in the first live Cars scan, Instagram over a week and TikTok found about 1 post a call, and Instagram over a month
up to 20 (the live check below). Trending effects' history agrees. More queries over Instagram's month find more
creators for the same credits. Trending effects keeps its own 3 searches a family (Instagram over a week and a month,
TikTok over a month); `searchFamilies` takes the category's plan as an option.

**YouTube's videos too** (2026-10-07). The scan's YouTube top list (§6: the main query's 50 most viewed videos of the
month) joins the posts the extraction reads, as `yt` posts: the title and description (clipped to 220 characters, as
Discover's YouTube cards) are the text, the channel is the creator. It costs nothing more: the same 2 calls as the top
list. A forced scan later the same UTC day keeps the day's list without asking YouTube again, so it adds no YouTube
posts; the day's creators from them stay, because a day's runs add together.

Live note (the coordinator's rescan of Cars after live fix 1, 2026-10-07): the 6 Instagram-month searches returned 35
posts, and 4 of the 6 queries returned none. The AI judged 13 names and approved 7, and only 1 style reached 3
creators. Hence the YouTube posts above, and 2 creators a style (Scoring, below).

**Extraction.** Trending effects' rules, with two additions for categories:
- Camera words join the suffixes: "shot(s)", "angle", "lighting", "look", so "rolling shot" and "low angle" are named.
- The category's own words, from its names and its main query ("car", "cars", "edit"; a plural name word's singular
  too, as Food & restaurants' "restaurant"), are generic for that category, so "car edit" is never a style. The second
  query's words stay free: it is there to find the category's signature styles (Fashion's "outfit transition").

**AI cleanup.** Effects' tolerant cleanup in parallel batches of 9 (keep, drop, merge, English and Arabic names, a one-line
`what`), told the category ("for car videos") and, since live fix 1, "Return one entry for every candidate key, keep
true or false." An answer with an empty list is counted in the diagnostics as the reject `empty_list` (Trending
effects' too: a count only).

**Scoring.** Distinct creators over 7 days, at least 2 since 2026-10-07 (Trending effects keeps 3: `scoreEffects` takes
the minimum, `CATEGORY_MIN_CREATORS`). A name outside the dictionary still shows only once the AI has approved it. Then
growth, NEW, trends first (names outside the dictionary and dictionary trend entries), then techniques, top 12. The
memory is per category: 14 days, at most 200 keys.

**Storage.** One KV document per category, `category:<id>`:
`{ ranOn, updatedAt, status, notes?, items, lessons?, top?, meta, history, diagnostics }` (`top`: §6).

**Routes** (Bearer, like the others):
- `GET /categories/:id`: `{ status, updatedAt, notes?, items, lessons, top }`, or `never`.
- `POST /categories/:id/run` with `{ force? }`.
- `GET /categories/:id/top/:platform`: §6.

**Limits.** Once per UTC day per category unless forced, or unless that day's run failed. At most 3 spending runs per
category a day (`category:attempts:<id>:<day>`).

### 3. Lessons (every 6 days)

- **When.** On a category's scan when its lessons are 6 or more days old, missing, or of an older version (`v`, below).
  Scans come every 3 days, so that is every second scan.
- **Picking techniques.** One AI call picks 3 techniques for each area (`photo`, `video`, `edit`). It chooses from the
  category's top trending styles, the editing dictionary, and standard techniques for the subject. Since live fix 3
  the prompt has no example from one subject (Anime's photo picks were its car examples: "Panning At Shutter",
  "Low-Angle Hero Shot", "Light Painting"). It says to choose techniques a creator of this subject uses; for a subject
  led by editing (anime, gaming), photo means the photography its creators do (figure or cosplay photography for
  anime, setup photography for gaming). For each technique it returns `{ name: { en, ar? }, query }`. The Arabic name
  must be in Arabic script (English loanwords in Arabic letters are fine, e.g. هايبرلابس); an Arabic name without
  Arabic letters is dropped, the technique kept (counted `latin_ar`). The query is "2 to 6 English words that find
  videos showing it for this subject". The answer is checked with zod, tolerantly.
- **Model** (live fix 3). The pick and the 3 how-to calls ask `@cf/openai/gpt-oss-120b` (`max_tokens` 3,000: it
  reasons before it answers). A call it leaves without a usable answer is asked once more of llama-3.3-70b. `askAi`
  reads every shape an answer comes in (`response` as text or an object, `choices[0].message.content`, the
  Responses API's `output[]` messages and their `content[].text`) and strips a code fence. The lessons' diagnostics
  name the model that answered each call: `models: { pick, photo, video, edit }` ("none" when neither did). The trend
  cleanup stays on llama, as Trending effects does.
- **Videos** (live fix 1: the best examples of the technique for the subject; a tutorial is optional).
  - One English Tavily search per technique over youtube.com, instagram.com and tiktok.com. The search is the
    technique's query, with the subject in front when none of the category's own words is in it ("hyperlapse" → "car
    hyperlapse"), and no " tutorial" added.
  - **Relevance.** A technique's core words are those of its English name and query, lowercased, 3 letters or more,
    without filler (the, and, for, with, how, video, videos, tutorial) and without the category's generic words. A card
    is about the technique when its title and snippet hold at least half of them (rounded up, at least 1). The others
    are left out and counted `offTopic`.
  - **About the subject** (live fix 3: Food's Backlight example was "MindShift BackLight 36L Review", a backpack). An
    example's title and snippet must hold one of the category's own words (`categoryWords`: its English name's words
    and their singulars, and its main query's but "edit"), singular or plural. The others are left out and counted
    `offSubject`. A tutorial may teach the technique in general, and the trend's samples come from the category's own
    searches: neither is checked.
  - Up to 3 English videos: examples first (Instagram or TikTok, then the trend's samples, then YouTube), then a
    tutorial only when a card's title teaches (how to, tutorial, step by step, guide, tips, explained; YouTube first).
    Without one, the third video is another example.
  - One Arabic search per category ("شرح تصوير ومونتاج <Arabic name>", YouTube). Each Arabic tutorial goes to at most one
    technique: an area that keeps last cycle's techniques keeps its own; among the new techniques, the first that the AI
    names it for, photo → video → edit.
  - That is **10 credits a refresh** at most, every 6 days per category: a technique picked twice (its name or its
    search words again) is searched once.
  - A technique with no video found is not shown.
- **Areas** (live fix 2: Cars' second scan picked Hyperlapse under editing). The pick's prompt defines them: `photo`,
  still photography techniques; `video`, filming and camera techniques (movement, speed, timelapse/hyperlapse
  capture); `edit`, techniques done in the editing app (speed ramps, masking transitions, color grading, text
  tracking).
- **How-to** (structured since live fix 2). One AI call per area, the 3 at once (`max_tokens` 3,000 since live fix 3's
  model), returns per technique `{ i, shoot, settings, edit, ar?, skillId?, arTutorial? }`:
  - `shoot`: where to stand or move and how to frame it, for this subject;
  - `settings`: real values, with numbers: shutter speed, fps, ISO, focal length, ND filter, stabilizer or gimbal
    mode, phone camera mode;
  - `edit`: the app by name and its tool (CapCut speed curve or keyframes, DaVinci Resolve Retime or Magic Mask,
    Premiere Time Remapping, Lightroom masking, Snapseed); for a photography technique, the photo editor;
  - each English line is one sentence of 15–140 characters; `ar` is the same three lines in natural Hijazi Arabic in
    Arabic script, at most 400 characters.

  The prompt forbids generic advice ("use a high-quality camera", "use editing software", "edit the video") and
  carries one worked example from another subject (a coffee top-down pour). Since live fix 3 it says plainly that the
  example only shows the format, its words never to be reused. It bases the lines on the videos' titles and snippets
  (tutorials first) when they help, else on standard practice. The lines are stored as `howTo.en` =
  `Shoot: …\nSettings: …\nEdit: …` (445 characters at most), English first. Checks:
  - a line missing or under 15 characters drops the technique (counted by zod's codes, e.g. `shoot:too_small`);
  - **a copied example** (live fix 3: Food's and Anime's Speed Ramp was the coffee pour word for word) drops it: a line
    holding one of its phrases "tripod arm", "into the cup", "half-speed slow-down", "steam overlay", "top-down pour",
    in any case and with any hyphen (`copied_example`);
  - **a generic line** (live fix 3: Flash Transition's and Color Grading's "Shoot with a high-quality camera and good
    lighting") drops it: "high-quality camera", "good lighting", "editing software", "edit the video", "video editing
    app" (`generic_line`);
  - **generic lines** drop it too: `settings` with no digit (`generic_settings`), or an `edit` naming no app from
    the list capcut, davinci, resolve, premiere, final cut, lightroom, snapseed, vn, inshot, after effects, photoshop,
    canva, blackmagic, as a whole word in any case (`generic_edit`); each reason is counted;
  - an Arabic how-to without Arabic letters is dropped (counted `latin_ar`), and so is one too short to teach
    (`short_ar`); the English lines stand either way.

  The page shows the lines one under another (`whitespace-pre-line`), marked ✦ AI.
- **Skill link.** Each call also picks at most one skill id per technique from the real skill list, or none. The list
  holds id plus English and Arabic names, from the DaVinci packs and the craft skills. A test keeps the Worker's copy in
  sync with the app's. An id outside the list is dropped; a bad skill id or Arabic tutorial number costs only itself,
  never the how-to.
- **Storage.** `lessons: { v, updatedAt, photo: Technique[], video: Technique[], edit: Technique[] }`, where:

  ```
  Technique = { name: { en, ar? }, howTo: { en, ar? }, skillId?, videos: { url, title, platform, kind: "example" | "tutorial", lang }[] }
  ```

  `v` is `LESSONS_VERSION`: 2 since live fix 1, 3 since live fix 2's structured how-tos, 4 since live fix 3's checks
  and model. Lessons with no `v`, or an older one, are due at the next scan (Scan again included), like missing
  lessons, and an area never keeps their techniques. The GET still answers them as stored until then (an older how-to shows as one paragraph). A refresh
  that leaves a shelf empty saves no `v`, so the lessons stay due and the next scan, 3 days on, fills it instead of
  the page hiding that shelf for 6 days. An Arabic line in Arabic script but too short to teach is left out
  (`short_ar`), never the English how-to with it.

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

**Other APIs (§6, 2026-10-07):**

| API | Use | Budget |
| --- | --- | --- |
| YouTube Data API `search.list` | The top list, 1 a cron scan and 1 a category's first top scan (plus 1 `videos.list`); Scan again asks none | 4 a day of the shared 100: radar 18 + effects 6 + Discover 66 (was 70) + the 4 cron scans = 94 |
| Brave Search API | The TikTok and Instagram tabs, when the owner chooses one | ≤ 40 requests a day (`BRAVE_DAILY`); about 1,000 a month are free with Brave's $5 monthly credit, which asks for Brave to be credited (the page does, under Brave's group), then $5 per 1,000. **Brave's results are never stored** |

**Budget guard.** At 90% of the month's credits (Discover's cached figure; when none is kept, Tavily's own `GET /usage`,
asked once and kept 10 minutes), category scans and lessons pause and keep their last results. The month is the plan
plus a positive pay-as-you-go limit; an unknown figure is not tight. They add the note `tavily_budget`. Trending
effects cuts back as it already does, on the same figure and the same month (one rule, `monthTight`).

**YouTube.** Lessons find YouTube videos through Tavily. Since §6 the top list spends 1 `search.list` outside
Discover's counter on each cron scan (4 a day) and on a category's first top scan. Scan again never asks YouTube: it
keeps the stored list and its date. Discover's `DISCOVER_YT_CAP` went from 70 to 66 to make room: the day stays at 94
of the 100.

**Workers AI.** The estimate is about 6,000 of the free 10,000 neurons a day for categories:
- 4 scans × 3 batches;
- about 2 lesson refreshes × 4 calls (1 pick, then 3 how-to calls, one per area), on gpt-oss-120b since live fix 3,
  and up to 4 more on llama when it answers nothing usable;
- plus Trending effects and Discover.

On a day the AI is unavailable, new names wait (`ai_fallback`) and lessons keep last week's. If that happens often,
Workers Paid ($5 a month) lifts the limit; the live check measures it first.

**Each invocation.** One category per invocation, either a cron slot or a POST. CPU is about 70–90 ms, as for effects;
Cloudflare has reported no CPU-limit errors so far. Subrequests per run are at most about 37, under the 50 a free
invocation allows:
- 16 Tavily searches and 1 Tavily `/usage`;
- 2 YouTube calls (§6: `search.list` and `videos.list`);
- 11 AI calls: 3 cleanup batches, 1 pick and 3 how-to calls, and up to 4 of those asked again on llama (live fix 3);
- 7 KV operations.

The lessons' calls can take longer since live fix 3: each has 60 s, and one llama retry another 60 s.

A chosen Brave tab (§6) is an invocation of its own: 2 KV reads (the page, the day's counter), 1–3 Brave requests and
1–2 KV writes (the counter, reserved before the first request and corrected after when fewer or more were made).

**KV writes.** About 6 a day plus the attempt counters and the Brave counter (1–2 a Brave tab chosen), well under
1,000.

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

### 6. Top videos per platform (2026-10-07)

The owner: "Every category should show at least 50 results in every platform with top tier results". There is no
official TikTok search we may use, and Tavily finds 1–2 TikTok posts a search. Asked how to cover TikTok, he chose
**"Add Brave Search for TikTok"**. He adds the key himself, as the Worker secret `BRAVE_API_KEY`.

**Brave's terms (binding).** Customers "shall not store, cache, or create a database of Search Results, in whole or in
part, other than transient storage required for operation", and may not modify results or make derivative works of
them.
- Brave's results are never written to KV, and the Worker sends them with `Cache-Control: no-store`.
- They live only in the page's memory for that visit, never in sessionStorage.
- They are shown as Brave gave them: in their own group, in Brave's order, titles as written (fix round, the
  reviewer's C2).
- Brave's $5 monthly credit asks for Brave to be credited: the page does, under Brave's group.
- YouTube's and Tavily's results are stored with the page, like the trend samples.

**What the owner sees** (English first):
- **The row.** After the 🔥 row: "🏆 Top in Cars", with tabs ▶ YouTube · ♪ TikTok · 📷 Instagram, each with its count
  (TikTok's once its list came).
  - It is a `tablist`. The arrow keys move focus between the tabs, mirrored in Arabic. YouTube's list is already
    there, so it follows focus; TikTok and Instagram ask Brave, so they wait for Enter, Space or a tap, and arrowing
    past them asks nothing (fix round, C7).
  - The platforms keep their own names in both languages. The copy is Hijazi Arabic and English, keys in parity.
- **A tab.** Up to 50 videos, 12 at a time; "Show more" adds 12.
  - Each video is Discover's result card (`ResultCard`): its thumbnail (Instagram's preview through the Worker), its
    title as given, the creator, the views when known, and the app's player.
  - The stored lists come best first (YouTube by views; Instagram and TikTok the posts more of the scan's searches
    found).
- **YouTube and Instagram** come with the page.
- **TikTok** loads when first chosen, once a visit: "Loading…", then the stored posts (usually none), then **"More from
  Brave Search"**: Brave's posts in Brave's order, without the ones already shown. 12 at a time across both groups.
  - Under Brave's group, outside the status line, a muted link "Powered by Brave Search" (Arabic: "النتائج من Brave
    Search") to https://brave.com/search/api/, in a new tab.
  - Without the Brave key, or with `BRAVE_DAILY` "0": the scan's posts, and "More TikTok results once Brave search is
    connected".
  - Brave failing (401, 429 or other): the scan's posts, and "Couldn't reach Brave search right now".
  - Past the day's Brave requests: the scan's posts, and "Today's Brave searches are used up — more tomorrow".
  - An answer whose stored list came back empty (the Worker could not read its copy) keeps the page's own.
- **Instagram**, while its stored list has fewer than 50, tops up from Brave when first chosen, the same way. Without
  the key it says nothing: its stored reels stand on their own.
- **A page from before §6** says "Top videos come with the next scan".
- **At 375 px** the tabs fit in their strip, and the page never scrolls sideways.

**Worker** (`workers/scout/src/categories/top.ts`):
- **YouTube (stored).**
  - `search.list` for the main query ("car edit"): `type=video`, `order=viewCount`, `publishedAfter` = the scan's
    time − 30 days, `maxResults=50`, `relevanceLanguage=en`, `safeSearch=moderate`.
  - Then one `videos.list` (`part=statistics,snippet`) for the views, channel, title and description.
  - ≤ 50 by views: `{ url, title, creator, views, publishedAt, thumbnail }`, with `YOUTUBE_API_KEY`, outside
    `DISCOVER_YT_CAP`.
  - No key, or a failed call: the note `youtube`, the last list kept with its date, the page still saved.
  - Only the cron's scans and a category's first top scan (no stored list yet) ask YouTube. A forced run (Scan again)
    keeps the stored list, whatever its length or the page's status, and its date, so a kept list never looks fresh
    (fix round, C1).
  - Its videos also feed the trends (§2), each channel counted by its id (C4: two channels may share a name).
- **Instagram (stored).** Every Instagram post of the scan's 6 searches, once each: the ones more of them found first,
  then as first seen. ≤ 50, `{ url, title, creator? }`; the creator comes from the URL or the page text; no views.
- **TikTok (stored).** The TikTok posts the scan saw. Since live fix 1 the scan searches Instagram alone, so this is
  usually empty: the field is there for the tab's stored group.
- **Storage.** `top: { updatedAt, yt, ig, tt }` in `category:<id>`. `GET /categories/:id` answers it. `readCategory`
  reads it entry by entry: a malformed entry is dropped, and an older page has none.
- **On demand:** `GET /categories/:id/top/tt` (or `/ig`), Bearer like the others.
  - Brave's video search (`/res/v1/videos/search`, the key in `X-Subscription-Token`): `q` = the main query +
    ` site:tiktok.com` (or ` site:instagram.com`), `count=50`, `freshness=pm`, `search_lang=en`, `safesearch=moderate`.
  - Only https single posts of that platform: `{ url, title, creator, views, thumbnail, age }` as Brave sent them,
    the title only clipped to 160 characters. The link is made canonical only to leave out the posts the stored list
    holds and so the app's player can play it.
  - A second page (`offset=1`) only when the first was full (as many results as asked for), Brave says it has more
    (`query.more_results_available`) and fewer than needed matched (C6).
  - The video endpoint answering 403, 404 or 422 (not in the plan): Brave's web search (`/res/v1/web/search`),
    `count=20`, the same pages; its `web.results` in order, then its `videos.results` in order, never interleaved. A
    401 (a bad key) is `brave_failed`, with no web search (C9).
  - The answer: `{ platform, scan, brave, source: "brave" | "scan", note?: "no_key" | "brave_failed" | "daily_cap",
    endpoint?: "videos" | "web" }`. `scan` is the stored list; `brave` is Brave's matches in Brave's order, never
    sorted or interleaved, without the stored list's posts, 50 in all (C2).
  - At most `BRAVE_DAILY` (default 40) requests a UTC day, counted in KV `brave:count:<day>` (2-day TTL): reserved
    before the first request (2, or what is left) and corrected after when fewer or more were made; over-counting is
    the safe side (C5). These are the only KV writes. `BRAVE_DAILY` "0" turns Brave off: `no_key` (C8).

**Search before building.**
- npm's `brave-search` (a typed wrapper for web, news, image and local search) and `@microfox/brave`: **rejected**. The
  rule is no new dependencies, and two GET calls with one header need none.
- `tools/05-found-on-github.md` and `tools/13` rejected Brave in 2026 for its card-only sign-up; the owner chose it now.

**Built** (branch `claude/category-top-videos`, 2026-10-07):
- **Worker:** `categories/top.ts` (YouTube's list, the scan's lists, the stored lists' check, Brave) and the route.
  - `DISCOVER_YT_CAP` is 66 (`wrangler.jsonc`, the code's default, the docs).
  - `ytCount` (youtubeStats.ts) and a shared `capVar` (discover/fetchers.ts) are reused.
  - `EffectPlatform` takes `yt` for the category's YouTube posts. `scoreEffects` takes the minimum of creators;
    Trending effects' default is unchanged.
- **Dashboard:** `lib/categories.ts` parses `top` and asks for a tab (`fetchCategoryTop`, never kept).
  `CategoryPage.tsx` has the 🏆 row, with Discover's `ResultCard` for each video (its props fit).
- **Decisions where the brief met itself or the code:**
  - A failed YouTube call keeps the last stored list (noted `youtube`), as a failed scan keeps its page. The brief
    said "no YouTube list".
  - Brave requests an open: 1–2, or 3 when the video endpoint is refused and the web search's two pages follow. The
    brief's "at most 2" met its "offsets 0 and 1" there. Every request counts against the day, the refused one too. A
    second page that fails keeps the first.
  - Links are kept only when they are one post (a profile, tag or sound page cannot play here). The URL's own host is
    checked: `meta_url.hostname` is the same host.
  - The Instagram tab says nothing when Brave isn't connected (the brief's line names TikTok).
- **Fix round** (2026-10-07, the reviewer's findings and the controller's rulings):
  - Brave's results in their own group as Brave gave them (C2, superseding the first build's sort by views and title
    rewrites), credited under it (C3), on tabs chosen by Enter, Space or a tap (C7).
  - YouTube on the cron's scans and a category's first top scan only; Scan again keeps the stored list and its date
    (C1, superseding "once a UTC day"). A forced run on a page from before §6, which has no list yet, is its first top
    scan and asks.
  - Channels counted by id in the trends (C4); the Brave counter reserved before the first request (C5); paging only
    after a full page with more to come (C6); `BRAVE_DAILY` "0" is `no_key` (C8); a 401 is `brave_failed` (C9); an
    empty stored list in an answer keeps the page's own (C10).
  - With live fix 3 (§3) in the same round: `pnpm test` 2,283 in 113 files (the Worker's 956 in 35 included); e2e 347
    passed (phone 174, desktop 173) and 7 skipped by design. Lint, typecheck (app and Worker) and build clean.
- **Tests:** `pnpm test` 2,247 in 109 files (the Worker's 944 in 35 included); e2e 342 passed (phone 171, desktop 171)
  and 6 skipped by design, of 348. Lint, typecheck (app and Worker) and build clean.
- **Owner's steps:** Cloudflare → Workers & Pages → 3z-scout → Settings → Variables and Secrets → Add → Secret,
  `BRAVE_API_KEY`. Brave's $5 monthly credit asks for Brave to be attributed: the page credits it in words under its
  results. Brave's logo is not added: downloading it needs the owner's OK (a follow-up).

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
  - no YouTube Data API (since §6: 1 `search.list` and 1 `videos.list` a scan);
  - ≤ 31 subrequests a run (≤ 7 AI calls; 33 since §6's 2 YouTube calls);
  - about 10 KV writes a day.

## Live check (2026-10-07)

**First Cars scan** (KV `category:cars`, its `diagnostics`):

- **Trends: empty.** Only 24 posts came back.
  - "car edit trend": Instagram month 20, Instagram week 1, TikTok 2.
  - "cinematic car edit": Instagram month 0, Instagram week 1, TikTok 0.
  - That gave 6 candidate keys, none with 3 creators (2 at most). The AI answered `{"effects": []}`: `ai_empty`, judged
    0, rejects `{}`, so the diagnostics could not say why.
- **Lessons ran** (picked 9, all with videos, all written, 10 credits), but their quality was poor:
  - Arabic names in Latin letters, and mistranslated: "taswir mash' al" for Hyperlapse.
  - Generic one-line how-tos ("Use color grading software like Davinci Resolve"); Speed Ramp's was wrong ("Use
    high-quality camera and adjust lighting").
  - The tutorial fallback took any YouTube video: "Santana - Smooth (Official Video)" for Smooth Slow Motion.
  - Videos not about the subject (a plant timelapse; portrait tips for Low Angle Shot): the search was
    "`query` tutorial", with no "car" in it.
- **The owner:** "I want everything to be english first" and "Plus it doesn't have to be tutorial".

**Live fix 1** (branch `claude/category-trends-live-1`) changes:

- **Searches:** 6 queries over Instagram's month (§2), still 6 credits.
- **AI cleanup:** asked to answer every key; an empty list is counted `empty_list`.
- **Lessons:** searches for examples of each technique for the subject; only videos about the technique; a tutorial
  only when one teaches; Arabic only in Arabic script (`latin_ar`); concrete how-tos for the subject, English first;
  `LESSONS_VERSION` 2, so Cars' first lessons refresh at its next scan, Scan again included (§3).
- **The page and the 🔥 Trending effects row:** English first in both UI languages (§1).

**Decisions where the brief met the code:**

- **The subject check.** A lesson's search gets the subject when none of the category's own words (its name's and its
  subject's: `categoryWords`) is in it. "edit" is left out of that check: it is in every category's generic words, and
  counting it would have left editing searches ("speed ramp edit") without "car". Relevance still drops "edit" from a
  technique's core words.
- **Older lessons are refreshed whole.** An area whose how-to call fails starts empty rather than keep last cycle's
  techniques. A refresh that keeps nothing still keeps them, noted `lessons`, and they stay due.
- **What the model is asked for.** It is still asked for both languages: the JSON schema it is sent requires `ar`, and
  the check alone treats it as optional.
- **The dashboard reads Arabic only in Arabic script.** `textOf` in `lib/effects.ts` reads the trend names and the
  lessons' texts, so the first Cars lessons' Latin names hide before their refresh.
- **The ✦ AI note** now reads "Written by AI from the videos and common practice" ("كتبها الذكاء الاصطناعي من الفيديوهات
  وخبرة المصورين"), since the how-to no longer comes from tutorials alone.

**Second scan** (Cars, after live fix 1). The videos are now right: "Car light painting", "Panning Shot Tips for Car
Photography", "Insta360 X4: How to film a car hyperlapse". The how-tos were still generic one-liners, several wrong:

| Technique | How-to as written |
| --- | --- |
| Light Painting | "Use a wide-angle camera to capture car photos from different angles." |
| Hyperlapse | "Use a high zoom camera to shoot cars" |
| Dolly Zoom | "Use Davinci Resolve to edit video clips." |
| Speed Ramp | "Use Premiere Pro to edit the video" |
| Text Animation | "Use CapCut to edit the video" |
| Whip Pan | "Use a fluid head and 50mm lens to shoot cars with a wide angle." |

Hyperlapse was also picked under `edit`. The model (llama-3.3-70b, a JSON schema, temperature 0) gives a free-text
how-to field one short sentence.

**Live fix 2** (branch `claude/category-trends-live-2`) makes the how-to structured (§3):
- three English lines a technique, `shoot`, `settings` and `edit`, each taught by a rule in the prompt, with a worked
  example from another subject, then the same in Arabic; stored as `Shoot: …\nSettings: …\nEdit: …`;
- generic lines are dropped and counted: settings with no number (`generic_settings`), an edit naming no app
  (`generic_edit`). If live runs show this empties shelves, it is loosened;
- the pick's prompt defines the three areas;
- the how-to call's `max_tokens` is 1,800 (from 1,000), and `LESSONS_VERSION` is 3, so Cars' lessons refresh at its
  next scan, Scan again included;
- the page shows the three lines one under another.

**Food and Anime** (after live fix 2, the coordinator's live checks):

- **Food:**
  - Speed Ramp's how-to copied the prompt's coffee example: "Mount the phone overhead on a tripod arm … into the
    cup", "4K at 60 fps for a smooth half-speed slow-down".
  - Flash Transition: "Shoot with a high-quality camera and good lighting".
  - Backlight's example video was "MindShift BackLight 36L Review", a backpack.
  - High Angle's examples weren't about food.
- **Anime:**
  - Speed Ramp copied the example again; Color Grading said "Shoot with a high-quality camera and good lighting".
  - The photo picks were the pick prompt's car examples ("Panning At Shutter", "Low-Angle Hero Shot", "Light
    Painting") for an anime category.
  - On the page, "Lessons come with the next scan" stayed until a reload: a GET between the scan's two saves (its
    trends, then its lessons) was kept in the tab's copy for an hour.

**Live fix 3** (in the top-videos branch's fix round) changes the lessons (§3):

- a how-to with the coffee example's phrases is dropped (`copied_example`), and the prompt calls the example the
  format only;
- a generic line is dropped (`generic_line`);
- the pick prompt has no car example, and says what photo means for a subject led by editing (anime, gaming);
- an example must name the category (`offSubject`); tutorials and the trend's samples are exempt;
- gpt-oss-120b writes the pick and the how-tos (3,000 tokens), with llama answering a call it leaves unusable, and the
  diagnostics name the model of each call (`models`);
- `LESSONS_VERSION` is 4, so the lessons written so far refresh at each category's next scan;
- the dashboard keeps a page in the tab's copy only with its lessons.

**Third scan:** (filled after deploy)
