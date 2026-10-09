# 3z Creator Platform — Master Plan

## Current implementation work — 10 October 2026

Discover is being reworked into a personalized editor feed after the owner rejected weak Anime/Instagram recommendations. Source checks, explicit preferences, a retained candidate library and separate inspiration, recent-popularity and learning modes are implemented. Bounded ChatGPT frame assessment recovered a real caption-poor Instagram edit in Chrome. Explicit native YouTube creator expansion acquired new Anime references; its Coffee pilot added no qualifying edits. Live checks exposed and prompted repairs for ambient-music false positives, channel/legal boilerplate being mistaken for lessons, and soundtrack suggestions being mistaken for applied editing. Automatic Instagram source coverage and broader visual quality remain open. See [the current handover](handovers/discover-editor-feed-2026-10-09.md), [source-access and feed design](tools/24-editor-feed.md), [native-source coverage](tools/25-native-source-coverage.md), and [creator discovery](tools/26-creator-discovery.md). The live preview stays on localhost:3000; PR #70 remains unmerged and the shared Worker has not been deployed. The older brainstorming sections below are historical planning, not the current implementation status.

## Context
The owner (3z) is a Saudi content creator (videography first, then design and business). They are paying for Framer + Base44 to build a
personal site, and those subscriptions are too expensive. Goal: one **self-owned** platform in `3zmd95-glitch/hello-github` with:
1. A **public bilingual site** (Arabic RTL + English): bio, CV, course, articles, shop (LUTs/plugins/apps), affiliate / link-in-bio page.
2. A **private gamified dashboard** (owner only) that turns learning into quests and levels, plans the next steps, and shows
   site/subscriber/social stats plus trends (Beacons-style).

Decisions made in chat:
- Arabic + English. Admin panel (own CMS) inside the dashboard. Payments via Moyasar/Tap once the CR/freelance document arrives (in progress).
- Skill tree = **Program → Section → Skill** (e.g. DaVinci Resolve → Color → "Day-for-night"; Photoshop → Cutouts → "Remove background";
  Workflow → Obsidian → "Vault setup"). Skills are co-created later with AI discovery (web/YouTube/trends).
- Leveling = **XP + 4 quests per skill**: Research, Train, Produce (video), Publish article, in that order (research first so the practice is informed). Plus streaks and badges.
- Subscribers = email newsletter (everyone) + member accounts (needed to buy / take the course).
- Course video on **Bunny Stream**. AI coach **on, with a monthly cap**. Design **evolves the Framer look**.
- **Dashboard first**. Phone + desktop (installable PWA). Articles start fresh (no Framer migration). No domain yet.
- Seed programs: DaVinci Resolve (main), CapCut, Photoshop, Lightroom, Illustrator, Canva, Higgsfield, Claude, Obsidian,
  Snapseed, Dazz Cam, Cosmos, Workflow (general).

Brainstorm round 4:
- Audiences: beginner Arabic creators, brands/clients, pro editors, and followers of the learning-in-public journey. The homepage needs
  clear paths: "Learn" (articles/course) · "Hire me" (CV/portfolio) · "Tools" (LUTs/plugins) · "Follow" (newsletter/socials).
- 12-month #1 goal: **audience + authority** (the go-to Arabic DaVinci/videography voice). North-star metrics: subscribers, visits, followers.
- Gamification stays **private**. No public levels.
- Motivation stack: streaks + daily check-in notification, owner-defined real-world rewards unlocked by XP,
  growth charts next to XP, 30-day themed seasons with finish badges.

Brainstorm round 5:
- First course: **DaVinci Resolve from zero**, self-paced video lessons + project files.
- Articles: 2–4 per month (≈ one per mastered skill).
- Services for "Hire me": video production + consulting/coaching (needs a booking/inquiry form).

Brainstorm round 6:
- Reminders: **PWA phone push** only (web push; iOS needs the app installed to the home screen).
- Obsidian: vault synced to a GitHub repo (Obsidian Git plugin). The dashboard reads notes; a note tagged with a skill completes
  its Research quest, and research notes can become article drafts.
  **Superseded 2026-09-28:** notes live inside the dashboard (📝 Notes, `/notes/`): one Markdown note per skill, grouped like the
  skill tree (pillar → program → section), `[[skill name]]` links with backlinks, search, autosave on the device, a "Research done"
  tick from the note, and a `.md` download for Obsidian. The skill popup's Research row and Today's Research quest open the note.
  Quest order is now Research → Train → Produce → Article (research first so the practice is informed).
  The vault tree is built from the same data as the Skills screen and the map (`vaultTree` in `lib/notes.ts`), so every new skill
  gets its note slot automatically; map nodes with a note show 📝 and each note links back to its island (tests keep them in sync).
  Round 2: typing `[[` suggests skills to link; ⚡ Live mode shows the formatted note while typing; images can be pasted, dropped
  or picked (kept on the device in IndexedDB, not in the JSON export yet); 🕸️ Graph view shows notes around their islands with
  gold lines for links ("All skills" shows every skill).
- First product: **LUT packs** (.cube). Plugins/presets later.
- Client leads: inquiry form → dashboard "Leads" pipeline (new → talking → booked → done).

Brainstorm round 7:
- Brand: **3z Prod = عز ينتج**. Domain candidates to check later: 3zprod.com, 3zprod.sa, 3z.studio.
- Community: member comments on articles, moderated in the dashboard. Comment themes feed the "what people want" insights.
- Every article embeds its skill's "Produce" video (YouTube/IG/TikTok) at the top.
- Dashboard lives at `/dashboard` on the same site.

Brainstorm round 8:
- XP difficulty tiers: Basic ×1, Intermediate ×1.5, Advanced ×2.
- AI coach and all Arabic UI copy speak **friendly Hijazi dialect** (owner's choice, not Najdi): دحين، إيش، يبغى، ليه، حاجة، لسه، دا/دي، اعمل، لحد.
- Time budget **< 5 h/week**, so the planner suggests ~2–3 quests/week, seasons are sized to fit, and streaks are **weekly** (not daily) so one
  missed day doesn't break them. Keep the system low-maintenance.
  → **Owner chose a DAILY streak.** To fit < 5 h/week, "micro-actions" (5–10 min: watch a tutorial, save a reference, write 3 lines
  of research) count toward the daily streak and give small XP (2–5). Big quests still drive leveling. One "streak freeze" is earned per week.
- Owner tech level: some experience. Needs step-by-step setup guides for each external account.

Brainstorm round 9 (inspired by Boot.dev + Codédex, all accepted):
- Private dashboard:
  - **Ranks** unlocked by level: متدرّب → مصوّر → مونتير → ملوّن → مخرج → سينماتوغرافر (names to confirm).
  - **Camera companion**: a pixel pet that evolves with the daily streak (phone → mirrorless → cinema camera).
  - **Focus sessions** ("potions"): 25 or 60 minute timer, +25% XP while it runs.
  - **Chests**: film-canister loot after N quests. Contains gems, a streak freeze, or a random creative prompt.
  - **Gems** currency: spent on streak freezes, or saved toward real-world rewards.
  - **Monthly boss**: one big production (short film, showreel) with a health bar that quests damage.
  - **Drills**: 10-minute spaced-repetition redo prompts for mastered skills.
- Public side:
  - Each mastered skill produces a **cheat sheet**, offered as a free download in exchange for a newsletter email.
  - **Monthly challenges** for followers ("Grade this clip"), with LUTs and shout-outs as prizes.
  - **Gamified course** for students: their own XP, badges, streak and chapter map.
  - **Free chapter 1**, paid rest.
- Visual style: **cute pixel world** (Codédex-like). Pixel art for companion, badges, chests, map and UI chrome; chunky borders and hard shadows.
  Arabic text uses a rounded playful font (Baloo Bhaijaan 2), since pixel fonts have no Arabic glyphs. Latin numbers/labels may use a pixel font (Pixelify Sans / Silkscreen).
- Skill tree gets a **Map view** (DaVinci's 7 real pages: Media · Cut · Edit · Fusion · Color · Fairlight · Deliver as regions, skills as nodes)
  plus the list view for quick editing.
- Ranks (fun Saudi slang, 17 named, owner wants many): LV1 مبتدئ متحمّس · 2 صيّاد اللقطات · 3 شايل الكاميرا · 5 ملك الزوايا · 6 فنان القص ·
  8 مروّض الإضاءة · 10 ساحر الألوان · 12 سلطان الصوت · 15 ذيب المونتاج · 18 معلّم الفيوجن · 21 وحش الإنتاج · 24 شيخ القصة ·
  28 هامور المحتوى · 32 صقر السينما · 36 الأسطورة · 42 أبو الإبداع · 50 عزّ الأساطير (final).
  **Plus tiers:** each rank has I → II → III, split by XP progress between that rank's start and the next rank's start
  (final rank tiers run to the Level 60 XP threshold). 17 × 3 = 51 steps. A tier-up gets its own celebration toast.
- Companion = **"mini you" pixel avatar** modeled on the owner: medium/tan skin, short dark hair, full beard + mustache, glasses,
  overshirt (olive over black tee assumed; colors to confirm). Headwear picker (cap / shemagh / ghutra).
  - Shipped (build plan 2.10): Settings → "Your look" customizes skin (5 tones), hair (short / buzz / fade / curly / long / bald, 5 colors),
    beard (none / mustache / goatee / full), glasses (none / square / round / sunglasses), headwear (none / cap / beanie / shemagh / ghutra,
    cap + beanie in 5 colors), tee, overshirt and pants colors (5 each); stored as `settings.avatar` with the round-9 look as default,
    shown on Today, in celebrations and the rank gallery. Rank unlocks are unchanged; with headwear on, the studio headphones rest on the neck.
- **Avatar evolves with every rank** (cumulative unlocks): tee + phone → overshirt → camera strap → green sneakers → neck headphones →
  softbox light → mirrorless + color sparkles → studio headphones → bomber jacket → Fusion particles → cinema camera + clapperboard (film-set stage) →
  gold-trimmed bisht → gold watch/chain + gold floor → falcon on the forearm → golden aura → cosmic backdrop → crown.
  Today has an evolution preview slider; the Rewards rank cards show each stage's look and what it unlocks.
- **Scene = your growing film set** (72×32 pixel scene behind the avatar). Each rank's name is shown by an item/emblem
  (e.g. "!" hype, viewfinder crosshair, dutch-angle tripod, scissors, LED wand, color wand, music note, wolf, VFX cube, claw marks,
  script + bisht, golden هامور, falcon, trophy, idea bulbs, crown). Backdrop evolves: bedroom → foam-panel studio → green screen →
  film set with truss lights (gold floor at Tycoon) → red carpet with spotlight → cosmic → gold legend stage.
  Crew joins: editor at desk (Cut Artist) → gaffer + big light (Light Tamer) → boom operator (Sultan of Sound) → camera operator,
  tripod + clapperboard (Production Beast) → "3Z" director's chair (Story Sheikh) → drone (Cinema Falcon) → trophy (Legend) →
  cheering students (Father of Creativity) → fireworks (Glory of Legends). Camera gear upgrades by rank: phone → mirrorless (LV10) → cinema (LV21).
- Mockup v2 (pixel style) published at the same artifact link. Adds a Rewards screen (gem shop, ranks, badges) and a Map view.
- Data model additions: `ranks`, `companion` (stage, mood), `gems_ledger`, `chests`, `focus_sessions`, `bosses` (hp, month, linked quests),
  `drills` (skill_id, next_due, interval), `cheat_sheets` (skill_id, file, downloads), `challenges` + `submissions`, student `progress`/`badges`.

Brainstorm round 10: **a skill map for every program** (currently only DaVinci has one; the rest are a thin list).
Draft regions per program (each region = a real area of the app; skills are filled later with Discover):
- DaVinci Resolve (home island, biggest): Media · Cut · Edit · Fusion · Color · Fairlight · Deliver
- CapCut: Editing basics · Text & captions · Effects & filters · Audio & beat sync · Keyframes & speed · Templates · Export
- Photoshop: Selections & masks · Layers & blending · Retouching · Color & adjustments · Compositing · Typography · Generative Fill · Export
- Lightroom: Organize · Light & tone · Color mixer (HSL) · Masking · Presets · Export
- Illustrator: Pen & shapes · Type · Color & swatches · Patterns · Effects · Export
- Canva: Templates · Brand kit · Magic Studio (AI) · Video · Social posts · Presentations
- Higgsfield: Prompting · Camera motion · Character consistency · Effects · Upscale & export
- Claude: Prompting · Projects & knowledge · Artifacts · Research · Automation
- Obsidian: Notes & links · Vault structure · Templates · Plugins · Canvas · Git sync
- Snapseed: Tune & details · Healing · Selective edits · Curves · Looks & filters · Double exposure
- Dazz Cam: Camera presets · Film looks · Flash & date stamp · Photo dumps
- Cosmos: Collecting references · Clusters · Moodboards
- Workflow: File organization · Audio download · Backup · Project templates
Decisions: **pixel world map of islands** (one island per program, DaVinci = biggest home island, island size/glow grows with that
program's level); tap an island to open its region map; **each island themed per app** (DaVinci film studio · CapCut neon ·
Photoshop blue lab · Lightroom sunny darkroom · Illustrator orange workshop · Canva purple craft room · Higgsfield sci-fi ·
Claude warm clay library · Obsidian purple library · Snapseed green garden · Dazz Cam retro film · Cosmos starry · Workflow toolshed).
Sections: use the draft above for now; refine per program later.

## Next mockup update (planning artifact only, nothing in the repo)
- Map screen opens on the **world map**: 13 pixel islands on a sea, each showing name, level and progress; locked-looking fog on
  empty islands ("explore with Discover").
- Tap an island → that program's themed region map (same region/node/quest-pip UI as DaVinci), with 1–3 sample skills per region
  where it makes sense; back button to the world map. List view stays as the quick-edit view.

Brainstorm round 11: **Skill Scout (on-demand, not bulk)**. The owner says "look at this new skill" (name or link) → the coach
researches the web, YouTube and social → returns one skill card: AR/EN name, program → region, tier, related skills, what it is
(types), step-by-step how-to in the app, the 4 quests pre-written with XP, a trend signal, and ranked references
(tutorials, theory, social, free assets). ✓ adds it to the map (quest texts stay on the skill), ✗ skips. Duplicates are caught.
Until the real app exists, the owner does this in chat with Claude. First example: Match cut → DaVinci → Edit (in the mockup).
References are **platform cards, not bare links**: tabs for TikTok · Instagram · YouTube · Articles; each card shows platform,
creator handle and title. On the phone, tapping opens the video directly in the TikTok / Instagram / YouTube app (their normal
video links open the installed app). Real app: thumbnails via TikTok oEmbed (public) and Instagram oEmbed (needs a Meta app token),
and videos play inside the dashboard with the platforms' embed players. Social search: AI web search restricted to tiktok.com /
instagram.com finds specific videos (neither platform offers an open search API; Instagram Graph hashtag search is a later add-on).
Each card also flags an **Arabic gap** when no Arabic tutorial exists, as a content opportunity.
Other ways to add skills: paste a link, the "+" form, Social "make it a skill", Obsidian `#skill/...` tags, occasional starter packs.

Brainstorm round 12 (mockup gap audit, all added):
- **Planner** screen: next-week plan (Sat–Fri) drafted by the coach within the 5 h budget; shows planned time, expected XP,
  boss damage and season quests; backlog quests can be added (lands on the lightest day); items can be removed or ticked.
- **Season** card back on Today (Color Grading Month, day 12/30, 10 season quests, "Colorist" badge, next season teaser).
- **Add-skill tools**: "+" in any region opens a form (name, tier, notes/link, AI writes the 4 quests) with duplicate check;
  Skill Scout accepts a pasted TikTok/Instagram/YouTube link; Social trend "Make it a skill" adds an idea or reports a duplicate.
- **Quest proof**: every skill shows its 4 quests; done Produce/Article quests take a proof link (portfolio log);
  done Research shows the linked note (in-app Notes since 2026-09-28).
- **Course** screen: stats, 6-chapter map (chapter 1 free), lessons per chapter with status, mastered skills → lessons, student preview.
- **Comments** moderation in Content (approve, hide, reply, turn into an idea; spam flag) + links/affiliates box.
- **Settings**: editable XP rules, AI budget slider, reminder times, connected accounts, and a phone push preview.

Brainstorm round 13: **publishing articles** (no code, no Claude session needed):
- Start from Content "+ Article", from a skill's Article quest (draft pre-filled with quest outline, Obsidian research notes,
  and the Produce video embedded on top), or from an Obsidian note tagged `#publish`.
- Editor: desktop-first (owner writes on the computer), Arabic RTL block editor (Notion-like; TipTap in the real app):
  headings, text, images (drag-and-drop, auto-compressed to Supabase Storage), video embed (YouTube/TikTok/Instagram),
  before/after grade slider, tip callouts, download button (cheat sheet / LUT).
- AI = **helper only** (owner writes in their own voice): outline suggestions, wording fixes, SEO title/description, cheat-sheet generation.
- **Always bilingual**: Arabic written first; "Translate to English" creates the EN version side by side for review; publish
  is blocked until both languages are filled.
- Publish panel: title AR/EN, slug, category, tags, cover, linked skill, schedule; phone/desktop preview; publish now or schedule.
  Live in seconds (on-demand revalidation). Options: email subscribers, copy social caption. Auto-completes the skill's Article quest (+XP).
- Mockup next: clickable article editor + publish flow + preview.

Brainstorm round 14: **features borrowed from Framer, Base44 and Beacons** (researched; owner picked):
- **Brand deals kit (Beacons):** public `/media-kit` page (AR/EN) that auto-updates from `social_snapshots` (followers, reach,
  audience countries, top videos), plus services, rate card and past clients; downloadable as a PDF for brands. Leads board gets a
  **Brand deal** type with a suggested rate (from followers × engagement × deliverable type) and a drafted reply.
- **Automations + AI agents + MCP (Base44):**
  - Workflows (toggle on/off in the dashboard): article published → email subscribers + social caption; new lead → phone push;
    cheat-sheet download → 3-email welcome series; quest done → boss/season update; weekly Saturday → plan draft.
  - Scheduled AI jobs (cron, inside the AI budget cap): weekly trend scan per platform, weekly comment-theme summary, monthly progress recap.
  - **MCP server** for the dashboard, so Claude (chat or Claude Code) can read the map and add skills, quest notes and article drafts
    directly ("look at this skill" → it lands on the map). Owner-only token; every write logged.
- **Instagram auto-DM (later phase):** comment keyword → DM with a link (e.g. "LUT" → shop link). Needs Instagram Messaging API
  permissions via Meta app review; scheduled after the social phase.
- Not picked for now: Framer extras (article search, password pages, A/B tests, AI alt text, scroll effects). Affiliate marketplace
  and multi-user editing skipped. Beacons' 9% store fee is avoided by using Moyasar directly.
- Mockup next: Leads with brand deals + rate suggestion, a media-kit preview, an Automations screen (workflows, AI jobs),
  and MCP/Claude connection in Settings.

Brainstorm round 15: **dashboard enhancements** (owner picked usability, smarter coach, delight):
- Usability: command palette (Ctrl/⌘+K, "/" or 🔍) over screens, skills, islands and commands; phone tab bar = 4 main tabs
  (Today, Map, Planner, Discover) + "More" sheet; opt-in 5-step spotlight tour (chip on first visit, replay in Settings);
  keyboard shortcuts (g+t/m/p/d/r/s…, n = new article, f = focus, ? = list, Esc).
- Smarter coach: one "Do this now" card on Today (next best quest + reasons: boss almost dead / trend + audience asks + Arabic gap /
  closest to mastery), with start-with-focus, done, and "something else"; new **Review** screen: week stats, 4 data insights with
  action buttons, mood + 3 reflection questions (+10 XP), past reviews.
- Delight: 8-bit Web Audio sounds (quest, gems, level-up, chest, boss hit, mastery) with a mute toggle; mastery "victory dance"
  and boss-defeat explosion celebrations, queued so they play one after another; scene follows real time (day/dusk/night);
  special events: Saudi National Day (green bunting + flag, double gems, "Green Green" badge for 3 quests) and Ramadan
  (lanterns + crescent, "Ramadan edits" season), Founding Day listed; previews for time and events in Settings.

Brainstorm round 16: **two worlds in one dashboard** (owner's structure):
- A big switch at the top: **🎮 Training** / **📱 Social**. Each world has its own home, its own menu and its **own look**.
  Shared: Settings (gear in the top bar), the Ctrl+K palette (searches both worlds), language toggle, notifications.
- **🎮 Training world = my own learning** (keeps the cute pixel game style): Today (coach card, avatar + film set, streak,
  quests, focus, boss, chest, drills, season, events) · Map (world of islands) · Learning planner · Discover / Skill Scout ·
  Rewards · Review. Wallet (gems, flame, level) shows here only.
- **📱 Social world = my creator business** (clean cinematic "creator studio" look from the Framer site: dark, green accent,
  rounded cards, no pixel art):
  - **Studio (home):** next post + countdown, this week's posting plan, growth snapshot, inbox (new leads, brand deals,
    pending comments), top 3 "what people want", today's reminder.
  - **Content calendar (new):** week/month view per platform (TikTok, Instagram, YouTube, X, Snapchat); post pipeline
    idea → script → filmed → edited → scheduled → posted; each post has hook ideas, caption + hashtags (AI, Hijazi),
    best time to post; **ideas bank** fed by trends, comments and skills. **Plan + remind:** a phone reminder at the best time,
    you post yourself; "Mark as posted" + link. (Official auto-publishing is a possible later add-on, needs platform approvals.)
  - **Growth:** Social + Audience merged (followers, views, top posts, audience, trends, what people want, site visits).
  - **Website:** articles + editor, comments, newsletter, cheat sheets.
  - **Business:** leads + brand deals, media kit, shop (LUTs), affiliate links, **course** (teaching students lives here).
  - **Automations.**
- **Bridge between the worlds:** a skill's "Produce video" quest creates a post in the Social calendar; marking that post as posted
  completes the quest (+XP) and adds the proof link. Publishing an article completes the Article quest. Trends / audience questions
  in Social can become skills in Training. Linked items show a small 🎮 / 📱 badge.
- ✅ Mockup done (v17): world switch (sidebar + phone top bar), Social world in the cinematic look, **Studio** home,
  **Content calendar** (week + production-stage board, platform filters, post popup with stage stepper, Hijazi hooks,
  caption + copy, best time, remind, "posted" + link → completes the linked Produce quest with celebration), ideas bank
  (audience asks, trends, skills without a video), Growth / Website / Business groupings, map shows "📱 in the calendar" on
  linked Produce quests; phone tab bar switches per world.

Brainstorm round 17: **refining the two worlds** (owner's picks):
- 🎮 Training, **clearer daily flow:** Today opens with one "Today's flow" card of 3 steps:
  ① the coach's main quest → ② one 5-minute micro-action → ③ day complete (flame lit + small celebration).
  Progress shows 0/3 → 3/3. The avatar scene stays under it. Everything else (season, boss, chest, drills, focus timer,
  other quests) moves into a collapsed "More for today" section, so the first view is calm.
- 📱 Social:
  - **Month view** in the Content calendar (next to Week and Stages): October grid, posts as colored platform chips per day,
    today highlighted; tap a post to open it.
  - **Per-platform pages:** Growth gets tabs (All · TikTok · Instagram · YouTube · X · Snapchat). Each platform shows followers,
    30-day views, engagement, best posting time, top 3 posts, its planned posts from the calendar, and a content-mix tip.
  - **Script tools inside a post:** the post popup gets tabs **Overview · Script · Shots**. Script = Hook / 3 body beats / CTA with
    Hijazi AI suggestions and an estimated length (words → seconds); Shots = shot list (type, description, ✓) with a starter
    template per platform plus a B-roll checklist. Writing a script moves the post to "Script"; all shots ticked suggests "Filmed".
- ✅ Built into the local mockup (v18) and tested with Playwright: no JS errors; flow 0/3 → 3/3 fires level-up then "day complete";
  month grid 35 cells / 14 post chips; platform tabs show 4 stat tiles each; no horizontal scroll on phone; backdrop click closes popups.
- ✅ **Published v18** at the usual link https://claude.ai/artifact/SthLJR7GcqKwArRLXPMXi1 (version 18).
  A stray duplicate copy also exists at https://claude.ai/artifact/QpFWeCg62ZXTAp1zW4eyUC; delete it only if the owner asks.

Brainstorm round 18: **DaVinci starter pack via Skill Scout** (owner: starter pack, full cards, intermediate level):
- 21 new skills, 3 per page, each a full Scout card (what, 3 key ideas, steps with real menu names, 4 Hijazi quests with XP,
  trend signal, TikTok/Instagram/YouTube/web refs taken only from real search results, Arabic-gap flag). 244 references total.
  - Media: Smart Bins + Keywords · Audio transcription + text search (Studio) · Scene Cut Detection
  - Cut: Source Tape selects · Smart Insert / Ripple Overwrite / Close Up · Boring Detector + Smooth Cut
  - Edit: Speed ramps with Retime Curve · Auto subtitles + animated captions · Punch-in zooms + shake with Adjustment Clips
  - Fusion: Fusion node basics · Planar Tracker screen replacement · Animated titles with Text+ and Follower
  - Color: Log → Rec.709 with CST in DaVinci Wide Gamut · Face relight with Power Windows + tracking · Shared Nodes + PowerGrades
  - Fairlight: Auto-duck music with Ducker · Loudness for social (−14 LUFS) · EQ + compressor voice chain
  - Deliver: YouTube export (4K upload trick) · Fix washed-out exports (gamma shift) · Render Queue + custom presets
- Arabic gaps (content opportunities) on 17 of 21; Arabic tutorials exist for captions, Fusion basics, voice chain, YouTube export.
- Open checks: Studio-only features flagged (transcription, Smooth Cut, subtitles from audio); Arabic transcription pack unconfirmed;
  a few menu names came from memory (Shared Node add menu, Render Queue "Show All Projects", Ducker location). Cut page and
  loudness/YouTube-export have thin TikTok refs (nothing real found, none invented).
- ✅ Mockup v19 (same link): Discover gets "📦 Starter pack" (grouped by page, open card / ✓ / ✗ / undo, Add all);
  each card uses the Skill Scout layout; added skills land on the DaVinci island with a "🔎 Skill card" button in the map detail.
  Tested desktop + phone: 21 rows, add-all → 33 nodes on DaVinci, card opens from map, no errors, no horizontal scroll.
- Data saved for seeding the real app: `scratchpad/davinci-starter-pack.json` (Phase 1 seed for `skills` + quest texts + refs).
- Next Scout ideas: SRT subtitle export, HDR export, Magic Mask object removal, sky replacement, Color Slice.

Round 19 (owner: "I have DaVinci Resolve Studio"; asked whether skills list sources to learn):
- Owner profile: **DaVinci Resolve Studio (paid)**, so every Studio-only feature is available. Store as `settings.davinci_edition = studio`
  in the real app; Skill Scout stops warning about Studio and can recommend Studio AI tools.
- Answer: yes, all 21 skills carry sources (≈11–12 each). Make them easier to learn from:
  1. **"📚 Start here" learning path on every card and every starter-pack row**: ① one full YouTube tutorial (learn it) →
     ② one written guide (Blackmagic / blog, to look back at) → ③ short TikTok/Instagram clips (ideas + how others use it).
     The picks come from the existing refs in `davinci-starter-pack.json` (first YouTube + first web ref), no new links invented.
  2. **Studio fix:** replace the 8 "Studio-only / needs Studio" warnings in card text with a green "✓ Studio" chip
     (transcription, scene cut AI, Close Up, Smooth Cut, subtitles from audio, retime/optical flow, CST/DWG notes, Shared Nodes, YouTube export notes).
  3. **Studio AI starter pack (scout next, same method, ~6 skills):** Magic Mask object isolation/removal · Voice Isolation +
     Dialogue Leveler · Relight FX · Depth Map (fake depth of field) · Face Refinement · SuperScale / Speed Warp.
- Mockup: bump to v20 at the same link; test with Playwright (desktop + phone) as in round 18.
- ✅ Done (v20 published): "📚 Start here" box on every card (① full tutorial → ② written guide → ③ short clips, jumps to the refs)
  plus a compact start-here line on every pack row; Studio notes rewritten ("✓ in your Studio") with a green ✓ Studio chip on 6 starter
  cards; Settings has a DaVinci edition switch (Studio / Free, Free shows 🔒 Studio).
- ✅ **Studio AI pack** (6 skills, 70 refs, own section in Discover with its own Add all): Magic Mask 2 + Object Removal ·
  Relight FX · Depth Map (fake depth of field / fog) · Face Refinement (Color) · Music Remixer, 5 stems (Fairlight) ·
  SuperScale + Speed Warp (Edit). Arabic tutorials exist for Magic Mask (short reel only), Face Refinement and Music Remixer;
  gaps on Relight, Depth Map, SuperScale/Speed Warp. Unconfirmed: some Studio menu names (Face Refinement controls,
  Depth Map control names, Clip Attributes > Super Scale), best Speed Warp tutorial is from 2022.
  Tested desktop + phone: 27 rows, 27 start-here lines, 3-step path in cards, add-all → 39 DaVinci skills, no errors.
- Data files: `scratchpad/davinci-starter-pack.json` (21, Studio-updated) + `scratchpad/davinci-studio-ai-pack.json` (6).

Round 20 (owner bug: "when I click [a skill on the island map] it doesn't open anything"):
- Cause: tapping a skill node only selects it (pink outline) and redraws the page; the skill details render in a box at the very
  bottom, under all 7 regions, so nothing visible happens (`3z-hq-mockup.html`: node `data-sel` handler → `st.sel=…;render()`, detail block in `vMap()`).
- Fix: tapping a skill opens a **skill popup** right away (bottom sheet on phone, centered on desktop), on its own layer
  (below the celebration layer so level-up / mastery animations still show on top):
  - name + English/Arabic name, page, tier, ✓ Studio chip, progress (n/4)
  - **📚 Start here** (reuses `learnPath()`), when the skill has a Scout card
  - the 4 quests with XP; tap to complete (popup stays open and updates), proof link / Obsidian note / "📱 in the calendar" /
    "✍ write the article" exactly as today (reuse the existing detail markup, moved into the popup)
  - buttons: 🔎 full skill card (Discover) · close (✕, backdrop, Esc)
  - the old bottom box becomes a small hint ("tap any skill to open it")
- Also make it obvious nodes are tappable: hover/press lift on `.node` and the skill name under or beside each node on desktop
  (short name, one line), tooltip kept.
- Verify with Playwright (desktop + phone): tap a node → popup visible in viewport; tick a quest inside → popup stays, progress
  updates, XP toast/celebration shows above it; Esc/backdrop closes; "+" still opens the add-skill form; no errors; republish v21.
- ✅ Done (v21 published): skill popup (sheet on phone, centered on desktop) with progress bar, quests, proof links and
  "📚 Start here"; step ③ opens the full card on the clips tab; tapping a quest keeps the popup open without re-animating
  or losing its scroll; ✕ / backdrop / Esc close it. Every node now has its name under it and lifts on hover/press.
  Tested desktop + phone with all 39 DaVinci skills: popup in view, 0/4 → 1/4 inside it, add-skill "+" still works, no errors.

Brainstorm round 21: **videography craft, not only software** (owner: "the training dashboard must include videography
techniques, not only software"; owner is early in the journey and the dashboard's job is to motivate daily learning).
- The skill tree stays Program → Section → Skill. New **craft programs** sit beside the app programs. `programs.kind = app | craft`.
- Craft programs and draft sections (skills filled later with Skill Scout / starter packs, same card format):
  - **Camera**: Exposure triangle · Shutter angle (180° rule) · Frame rates & slow motion · Picture profiles & Log · White balance ·
    Focus (manual, pulling, hyperfocal) · Lenses & focal length · Stabilization (handheld, gimbal) · Camera movement (push-in, orbit, reveal, whip pan) · Phone videography
  - **Lighting**: Natural light & golden hour · Harsh midday sun (diffusion, shade, negative fill; Saudi conditions) · Three-point · Motivated light ·
    Practicals · Color temperature & gels · Low light & night · Interview setups
  - **Composition**: Shot sizes (WS/MS/CU) · Rule of thirds & leading lines · Headroom & eyeline · Depth layers (FG/MG/BG) · Symmetry & framing ·
    Dutch angle · 180° line · Blocking
  - **Sound on set**: Lav vs shotgun · Levels & headroom · Room tone · Wind protection · Sync (clap / timecode) · Phone audio
  - **Story & directing**: Hook–beats–CTA structure · Shot lists & storyboards · Sequencing (wide→medium→close) · B-roll planning · Coverage ·
    Directing interviews · Pacing & rhythm · Planning a match cut
  - **Color craft** (theory, software-agnostic): Color theory & palettes · Skin tones · Reading scopes · LUT theory · Film emulation · Teal–orange and when not to
  - **Production workflow**: Location scouting · Permits (Saudi Film Commission) · Gear checklist · Call sheet · Data management on set · Backups
- **Quests keep the same 4 types**, adapted for craft: **Train** = a field exercise with proof (e.g. "shoot the same subject at 5 shutter angles",
  photo/clip upload) · **Produce** = a short clip that shows the technique · **Research** = a note in the in-app Notes vault · **Publish** = article (Arabic gap flag applies).
  XP rules unchanged; craft XP feeds the same overall level and rank ladder (the rank names already are videography: صيّاد اللقطات، شايل الكاميرا، ملك الزوايا، مروّض الإضاءة).
- **Combo quests (new, motivational core):** the coach pairs one craft skill with one software skill into a mini-project that ends in one video:
  "shoot Log at golden hour → grade with CST in DaVinci", "record with a lav → voice chain in Fairlight", "plan a match cut → cut it on the Edit page".
  One combo per week fits the < 5 h budget, produces real footage, and the Produce quest of both skills completes from the same clip.
- **Map:** the world map gets two archipelagos: **الحرفة / Craft** (7 islands, themed: Camera = film set, Lighting = sunlit rooftop, Composition = gallery,
  Sound = studio booth, Story = writer's desk, Color craft = paint lab, Workflow = production office) and **البرامج / Tools** (the 13 app islands).
  A bridge between the archipelagos carries the combo quests. Island glow still grows with that program's level.
- **Gear-aware:** `skills.gear = phone | any | camera | gimbal | lights | mic`. Settings gets a "my gear" list; the coach and Skill Scout only suggest skills
  the owner can do today (phone-first at the start, matching the avatar's phone → mirrorless → cinema arc). **Open: owner's current gear.**
- **Related links across kinds:** `skills.related` already exists in the starter-pack JSON; craft ↔ software links power the combo suggestions
  (Log profile ↔ CST · 180° shutter ↔ Retime / Speed Warp · lav recording ↔ Dialogue Leveler · storyboard ↔ Cut page Source Tape).
- **Coach balance:** the weekly plan aims for ~1 craft quest + 1–2 software quests + 1 combo; the Review screen shows a craft/software split.
- **Seed:** next starter pack = **"Camera & light from zero" (phone-first, ~12 skills)** scouted with the same method as the DaVinci packs
  (real references only, Arabic-gap flag). Data model additions: `programs.kind`, `skills.gear`, `combos` (skill_a, skill_b, brief, clip_url, status).
- Mockup: add the Craft archipelago, a combo card on Today, and a gear list in Settings in the next mockup update.
- **Owner gear (answered):** iPhone + lights today (exact models and light kit to be listed in detail later); a **new video camera planned later this year**.
  Consequences: the first craft pack is **phone-first** (iPhone: ProRes / Log where the model supports it, Cinematic mode limits, manual apps such as
  Blackmagic Camera or Filmic Pro, exposure and white-balance lock, stabilization without a gimbal, phone audio), the **Lighting** program is unlocked
  from day one (owner already has lights, so lighting skills count as doable now), and **Camera** skills that need a dedicated camera are tagged
  `gear = camera` and shown as "🔒 when the camera arrives" instead of hidden, so the upgrade has a visible tree waiting for it.
  Gear list in Settings: `gear_items` (type, model, since, notes); adding the new camera later unlocks those skills and could award a
  "first shot on the new camera" badge. The avatar's phone → mirrorless arc (LV10) matches the planned upgrade.

Brainstorm round 22: **six pillars as the top level** (owner shared the Obsidian "Goals and mind map" and the 6 pillars of content
creation; owner: "the list is not absolute truth, you can add to it").
- Structure becomes **Pillar → Program → Section → Skill**. Pillars are the owner's 6; programs inside them are the owner's tools plus the
  craft/technique programs from round 21 (marked ✚ = added by the plan). Each pillar has its own level from its programs' XP, so the mind
  map's "Master X" nodes become progress bars. The Sprint 2 world map draws **6 continents** (one per pillar) instead of 2 archipelagos.
  1. **التصوير / Capture**: iPhone camera app · Blackmagic Camera · Dazz Cam · Lightroom Mobile · Snapseed · ✚ Camera craft · ✚ Lighting ·
     ✚ Composition · ✚ Sound on set · ✚ Story & directing (pre-production, shot lists) · ✚ Equipment & accessories (phone rigs, ND, mics, lights,
     tripod/gimbal, the camera upgrade path)
  2. **المونتاج / Editing**: DaVinci Resolve (owner's sections basics · color · audio · effects · export map onto the 7 pages) · CapCut ·
     ✚ Editing theory (cuts, J/L cuts, pacing, montage) · ✚ Color craft (theory, scopes, LUT theory)
  3. **التصميم والهوية / Design & brand**: Canva · Photoshop · Illustrator · ✚ Brand identity (colors, logo, bio, thumbnails system)
  4. **الذكاء الاصطناعي / AI**: Claude (automation, scripts, cheat sheets) · Gemini (learning, extraction) · Higgsfield (visual AI) ·
     ✚ AI for audio (voice clean-up, music) later
  5. **إدارة المشاريع والإلهام / Projects & inspiration**: Obsidian · Cosmos · ✚ Files, archive & backup (structure, storage, transfers) ·
     ✚ Download sources (sound, fonts, plugins, stock) · ✚ Inspiration sources (where to find what to produce)
  6. **النمو والكسب / Growth & earning**: ✚ Analytics reading · ✚ Publishing strategy & algorithms · ✚ Affiliate & monetization ·
     ✚ Brand deals & media kit · ✚ Newsletter & website basics. Learning lives here; doing it lives in the Social world.
- Training sequence for the owner (iPhone + lights, early journey, 12-month goal = Arabic DaVinci/videography voice):
  weeks 1–8 pillars 1+2 only with one combo/week (shoot on iPhone with a technique → cut and grade in DaVinci); pillar 5 as habits
  (daily Obsidian note = Research quest); pillar 3 when a thumbnail/logo blocks; pillar 4 early as accelerator (Claude scripts and cheat sheets);
  pillar 6 from month 3. Time split ≈ 70 % shoot+edit · 20 % design+AI · 10 % organization+growth.
- Owner's note mentions a Framer site with Salla payments. Salla could replace the shop + Moyasar phase (Saudi store, mada/Apple Pay built in,
  monthly fee, less control). **Open: is the Framer + Salla note current?** Master plan still assumes the self-owned site.
- Data model: `pillars` (id, order, name AR/EN, color, icon); `programs.pillar_id`. App change: Skills screen grouped by pillar with a level per pillar;
  craft programs keep their `kind` for gear/combo logic.

Brainstorm round 23: **the research button** (owner: "for a subject like match cut I want a button that scrubs YouTube, TikTok and Instagram").
- Two layers. **Scout v0 (now, static app):** a 🔎 Research button on every skill and a Discover screen; one tap opens platform search for the topic
  (YouTube `results?search_query`, TikTok `/search?q=`, Instagram keyword search + hashtag page) in AR and EN; on the phone the links open in the apps.
  In-app YouTube results via the free YouTube Data API v3 (`search.list`, 100 quota units per search → ~100 searches/day) using a key the owner
  pastes into Settings (stored on the device, referrer-restricted in Google Cloud, never in the bundle). "Add as reference" attaches a result
  to the skill's Start-here path; a paste-a-link box saves TikTok / Instagram references, since neither has a public search API.
  Saved references live in the local store (`skillRefs`) and later sync to `skill_refs` in Supabase.
- **Scout v1 (Sprint 4):** the AI card (what, steps, 4 quests, trend, Arabic gap, ranked refs) via Claude + web search restricted to the three
  platforms, running on a Cloudflare Worker with the owner's Anthropic key and the `ai_usage` cap. Cannot ship in the static app: an API key in
  client code would be public.

Brainstorm round 24: **TikTok and Instagram results inside the app** (owner: "I do care for Instagram and TikTok, find me any way to include
them"). Searched first (rule): Google Custom Search JSON API is closed to new customers (sunset 2027-01) · Brave Search API dropped its free tier
(card + $5 credits) · Tavily gives 1,000 searches/month free, no card, with `include_domains` · unofficial TikTok/Instagram scrapers
(davidteather/TikTok-Api, szdc/tiktok-api) need a headless browser/server and break with platform changes → rejected.
- **Decision: Scout Worker.** A small Cloudflare Worker (`workers/scout/`, free plan) with: `POST /search` → Tavily with `include_domains`
  tiktok.com / instagram.com / youtube.com, normalized to reference cards (platform, handle from URL, title, snippet, thumbnail, url);
  `GET /oembed?url=` → TikTok oEmbed passthrough (title, author, thumbnail) for pasted links; CORS limited to the app origins; a shared owner
  token checked on every call; Tavily key kept as a Worker secret. The same Worker hosts the AI Scout (Claude) in Sprint 4 and the reminder cron in Sprint 3.
- Deploy from GitHub Actions on push to `main` using repo secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `TAVILY_API_KEY`
  (wrangler deploy + `wrangler secret put`). Owner accounts: Tavily (free) + Cloudflare (free); no card.
- Dashboard: API keys section gets "Scout Worker URL" + "Scout token"; Research panel and Discover show TikTok / Instagram / YouTube results
  from the Worker when configured (YouTube Data API stays as the richer YouTube source when its key exists); pasted TikTok links are enriched.
- Budget: ~33 Tavily searches/day; the UI shows the month's remaining count and caches results per topic on the device.
- Later upgrade path unchanged: Instagram Graph hashtag search after Meta app review; AI Scout in Sprint 4.

Brainstorm round 25 (owner: "build the islands around the 6 pillars, the DaVinci Resolve skills, all the XP system and the full
dashboard"; built as Sprint 2 by parallel agents, each owning its files, merged and tested together):
- **Map (`/map`)**: the world is **6 continents = the 6 pillars**, in pillar order, each with its level (from `pillarXp`) and its programs as
  pixel **islands** on a sea strip (canvas art, color = program color, size grows with level + skill count, glow from level 2, DaVinci is the
  gold "home" island, programs with no skills are fogged and link to Discover). Tap an island → its **region map**: sections as a winding path
  of numbered regions, skills as square nodes filled by quests done (★ gold when mastered, 🔒 when gear-locked) → the skill popup. Every program
  has a theme line (round 10 + 21 themes, new ones for the newer programs). Deep link `/map/#island=<programId>` (hash, static-export safe).
- **Planner (`/planner`)**: rules-based, deterministic per week (Sat–Fri, Riyadh). Time per quest: Train 30 · Research 20 · Produce 60 ·
  Article 45 min × tier factor (1 / 1.25 / 1.5), budget 300 min. Mix: **1 combo + 1 craft + 1–2 software**, then fill by rank while under
  budget; never two Produce quests on one day; heavy items land mid-week. Only completions before the week started shape the picks, so ticking
  a planned quest marks it done instead of redrawing. **Combo quests v1** (`lib/combo.ts`): named pairs first (Log ↔ CST, 180° shutter ↔
  Retime/Speed Warp, lav ↔ voice chain, storyboard ↔ Source Tape; the two craft sides without seed skills wait for their packs), else the best
  craft + software Produce pair; one proof link completes both Produce quests. Manual edits (remove, add from backlog onto the lightest day,
  reset) are stored as `planItems` overlaid on the derived plan.
- **XP system (all rules in `lib/`, tested, every field backwards compatible in the store):**

  | Piece | Rule |
  |---|---|
  | Gems 💎 | quest `max(1, round(xp / 5))` · mastery +10 · day complete +5 · weekly review +5 · badge +15 · boss defeated +50 · season finished +30 · purchases negative |
  | Chests | one film-canister chest per 5 completed quests; loot is deterministic from the chest number: gems +20/+35/+50, a bonus streak freeze, or one of 10 creative prompts |
  | Focus | 25 or 60 min "potion"; quest XP × 1.25 while it runs (mastery bonus not boosted); expired sessions auto-record |
  | Freezes | 1 earned per active week (cap 2) + bonus freezes from chests/shop, total cap 5; earned ones are spent first |
  | Badges | 17: first mastery, 7- and 30-day streaks, 10/50/100 quests, first proof, first article, first region, first island (program LV 5), pillar LV 5, first chest, 10 focus sessions, first review, boss slayer, season finisher |
  | Boss | one per month, 8 rotating bosses; HP = 300 × (1 + 0.1 × (level − 1)) at month start; damage = XP that month (quests, mastery, drills, reviews) |
  | Seasons | 30-day windows from 2026-09-01, 8 rotating themes (color → capture → sound → story → design → AI → projects → growth); target 10 themed quests → badge + gems |
  | Drills | created when a skill is mastered, due in 3 days, then 7 → 14 → 30; 10 minutes, +5 XP, counts toward the program |
  | Review | +10 XP + 5 gems once per week for mood + 3 answers; edits later give nothing |
  | Rewards shop | owner-defined real rewards bought with gems (min level, repeatable); built-in "streak freeze" 40 gems |

- **Rewards (`/rewards`)**: wallet, chest box, gem shop with the owner's own rewards editor, the 17-rank gallery with the avatar stage per rank
  and its unlock, all badges (earned / locked), purchase log. **Review (`/review`)**: week stats (XP with delta, quests with craft/software
  split, active days, focus time), XP by pillar, 8-week history, rules-based insights with "go" links, mood + 3 questions (+10 XP once per week),
  past reviews. **Today** gains the wallet, coach reasons (boss / season / drill), the focus card, chest box, boss HP bar, season card and due drills.
- Nav: phone tab bar Today · Skills · Map · Discover · More; desktop sidebar adds Planner · Review · Rewards · Settings. Dictionaries are split
  by feature (`messages/<feature>.{ar,en}.json`) so screens can be built in parallel; the parity test also rejects duplicate keys.
- **Owner decision: no seasonal events** (National Day, Founding Day, Ramadan, double-gems days; build plan 2.8 and the round-15 event ideas are
  dropped; the National Day badge was removed). The 30-day themed **seasons** (Color month, Capture month…) are a different feature and stay.
- Left for later: AI coach (Sprint 4).

Brainstorm round 26 (owner: "make the dashboard for social media", after "give the character more customization"; built by parallel
agents like round 25, all merged with the full e2e suite green):
- **Avatar customization** (Settings → "🧑‍🎨 مظهرك"): skin (5), hair (6 styles × 5 colors), beard (4), glasses (4), headwear (cap · beanie ·
  شماغ · غترة, cap/beanie in 5 colors), tee / shirt / pants colors; live preview; the same look everywhere (Today, celebrations, rank
  gallery); rank unlocks unchanged (with headwear the rank-7 studio headphones sit on the neck; the crown always sits on top).
- **📱 Social world v1 (static, local, manual data):** the round-16 structure is live behind the 🎮 / 📱 switch in the top bar:
  - **Shell:** `data-world="social"` swaps every design token to the cinematic look (near-black, rounded 14 px, soft shadows, IBM Plex
    Sans Arabic, green accent); Training stays pixel-identical. Social menu: Studio · Calendar · Growth · Ideas · More (Website · Business ·
    Automations = "قريب", Settings, back to Training). Last Social route is remembered when switching.
  - **Studio (`/social`)**: next post with a live countdown (or overdue), this week's plan (Sat–Fri dots per platform), growth snapshot,
    top 3 "إيش يبغون الناس" (→ idea), rules-based inbox (overdue, unscheduled, waiting ideas, stale stats), today's reminder + flame state.
  - **Content calendar (`/social/calendar`)**: Week · Month · Stages views, platform filter (TikTok · Instagram · YouTube · X · Snapchat),
    pipeline idea → script → filmed → edited → scheduled → posted, unplanned tray, overdue marks, best time per platform (Saudi prime time
    after Isha, an assumption until real analytics). **Post popup** with Overview (hook + 3 hook ideas from the skill's Produce quest,
    caption with limit, hashtags with suggestions, day/time, reminder note, linked skill, **Mark as posted + link**, copy, delete),
    Script (Hook / 3 beats / CTA, ≈ seconds at 2.4 words/s, auto-bumps to "script"), Shots (per-platform shot template, ✓ list, B-roll
    checklist, "move to Filmed?"). Deep link `/social/calendar/#post=<id>`.
  - **Growth (`/social/growth`)**: All + per-platform tabs; manual snapshots (form) and **CSV import** (`platform,day,followers,views30d
    [,engagementPct]`, aliases and 1.2K/3M numbers accepted) until the platform APIs are approved; totals, Δ30d, best-growing platform,
    90-day SVG charts, account handles, this week's planned posts per platform, top posted posts, a rules-based content-mix tip,
    "what people want" asks with +1 counts.
  - **Ideas bank (`/social/ideas`)**: ideas from me / audience / trend / skill, filters, "→ make a post" per platform, suggestions from
    skills whose Produce quest has no video yet, trends placeholder (AI coach, Sprint 4).
  - **Bridge 🎮 ↔ 📱**: the skill popup's Produce row gets "📱 خطّط الفيديو" (platform picker → post) / "📱 في التقويم"; the island map
    marks linked skills; **marking a post as posted completes the linked Produce quest exactly once** with the link as proof, with the usual
    XP / gems / mastery / boss moments plus a "انتشر ✓" toast. Gems, chests and badges are unchanged (posting is a quest completion).
- Known gaps: a post planned from a skill or an idea has a best time but no day until it is given one in the calendar (it sits in the
  "بدون يوم" tray and the Studio counts it); reminders are text only until Web Push (Sprint 3); no auto-publishing (needs platform approvals);
  Website / Business / Automations are placeholders (Sprint 5+).

Brainstorm round 27 (owner shared the Beacons.ai handover and screenshots: Beacons has 13 sections; the owner mainly uses the
**Social Analytics** page; Creator plan USD 10/month; Instagram is disconnected there; Post Activity counters unreliable):
- Decision: rebuild **Social Analytics** inside the 📱 Social world (the Growth screen grows into it), metric names identical to the
  handover so numbers can be compared. Beacons keeps link-in-bio (3zprod.com), store, media kit, Smart Reply and email broadcasts for now.
- Static first: the page renders from imported snapshots (native CSV exports + manual demographics) with the **Sep 27, 2026 numbers seeded**
  as the baseline; the daily API job comes later in the Scout Worker after the owner's Phase 0 (Meta app, Google Cloud, TikTok app).
- **Threads** joins the platforms (the owner is connected there). Details, scopes and acceptance test in `tools/06-social-analytics-apis.md`;
  the full inventory in `handovers/beacons-2026-09-27.md`.

Brainstorm round 28 (owner: "I want in my social the ability to post everywhere automatically", "like metricool.com"):
- Decision: **auto-posting from the content calendar**. One post, one media link, a caption per network, then schedule it for the
  planned time or post now. The Scout Worker publishes to **TikTok, Instagram, YouTube and Threads** through their official APIs on a
  five-minute cron and reports each network back; the post is marked posted (Produce quest bridge) when all are out. **X and Snapchat**
  have no free publishing API: they stay a manual step (copy + open the app).
- Metricool/Ayrshare/Postiz were checked and rejected (monthly cost, or cannot run on the free Worker). Zernio (Snapchat) and Buffer's
  free API are the fallbacks. Details, limits and the owner's one-time steps in `tools/07-auto-posting.md`.
- Known limits: until YouTube's and TikTok's audits pass, uploads there are private / "only me" (the inbox mode on TikTok works meanwhile);
  media must be a public link until Supabase Storage (Sprint 3).

Round 29 (Sep 28, 2026, auto-posting goes live; details in `handovers/auto-posting-live-2026-09-28.md`):
- PR #13 (the feature) and PR #14 (fresh Meta container re-check) merged; the Worker is deployed at `https://3z-scout.3zmd95.workers.dev`.
- Owner setup done: publish permissions on the Meta app, `youtube.upload` on the Google consent screen, TikTok Sandbox with Direct Post;
  **✍️ Allow posting** on all four platforms. First real post: a Threads text from the Worker. Instagram / YouTube / TikTok video posts
  still wait for a public MP4 link from the owner; YouTube stays private and TikTok `SELF_ONLY` until the audits.

Brainstorm round 30 (owner: "a tool to post on every platform… seamless, make me work less… and know what is trending now on
TikTok, Instagram and YouTube, Arabic or English… be the mastermind so every agent knows its task"):
- Full repository read (11 subsystem maps, 7 research sweeps, 8 verified code claims) → coordination plan in
  `handovers/mastermind-2026-09-28.md`: two workstreams, an agent roster with single-owner files, three waves, six owner questions.
- **A · Post everywhere v2**: first live video post (owner MP4) → composer that ticks every connected network at post creation, trims
  captions per network, re-syncs the job on edit, refreshes on tab return → media picked on the phone (Backblaze B2, free, no card;
  Cloudflare R2 if a card is ever acceptable) → X through Buffer's free API (decision pending) → Instagram carousels + stories →
  expiry warnings, X/Snapchat nudges → audits (privacy/terms pages). Snapchat stays manual (no open API; Zernio's Snapchat is beta-locked).
- **B · Trend Radar v1** (`tools/08-trends.md`): Google Trends (RSS + RPC, SA and US), YouTube charts SA/US (labelled charts, since
  YouTube's Trending page closed in July 2025), a daily keyword `search.list` (≤ 12 of the 100 daily calls), kworb TikTok sounds and
  trends24 X trends with attribution (pending owner OK), a weekly Tavily scan (Arabic + English, ≤ 40 credits/month), a static Saudi
  moments calendar, manual deep links for TikTok Creative Center and Instagram trending audio. Lives in the Ideas bank: one tap →
  idea (source `trend`) → planned post. Automated TikTok / Instagram trend feeds were rejected (browser-minted headers, terms);
  Threads keyword search waits for App Review after the CR.
- Search-before-building results for both workstreams are recorded in `tools/08-trends.md` and `tools/05-found-on-github.md`.

Brainstorm round 30, later the same day (owner: "I want to have Metricool in my dashboard… and Beacons AI"; "copy Metricool, not connect to it"):
- Decision: the 📱 Social world copies what Metricool (plan, post everywhere, analytics, reports, inbox, comment → DM, link in bio)
  and Beacons (link in bio, media kit, store, email list, Smart Reply, Beam AI) do, built in our own dashboard and Worker. No
  Metricool API/MCP (the API is $53/month and up; the owner wants our own). Beacons ($10/month) is cancelled once its parts are live here.
- First item: the TikTok and YouTube app reviews so posts can be public. Roadmap, status per feature and order in `tools/09-metricool-beacons.md`.

Round 31 (Sep 29, 2026; owner: "search based on genre of edits: cars, food and restaurants, anime, travel… understand the latest
trends and most famous edits by genre"):
- PR #18 (round 30: Trend Radar, post everywhere v2, the search fixes) merged and deployed; the owner added the
  `YOUTUBE_API_KEY` secret and the Worker was redeployed with it.
- **Discover by edit genre** (`tools/11-discover-genres.md`): 12 genres in one JSON shared by the app and the Worker (the four
  the owner named plus football, coffee, perfume, camping & desert, fashion, gaming, weddings, gym), the owner's own genres in
  Settings, genre chips in Discover and every skill's Research panel, a 🔥 Most popular sort, views / likes on the cards, genre
  keywords in the radar's daily YouTube scan (cap 12 → 18 a day, rotated so every keyword is searched within two days) and a
  genre chip on the radar's rows.
- **One place** (owner: "I don't want to get confused having two places"): Discover is the one place for genres. The radar
  has no genre filter; a row's genre chip opens Discover on that genre, where a "📈 Most viewed this week" strip shows the
  radar's rows of the genre above the search results. Social has a Discover shortcut (More page, desktop sidebar).
- Decisions: subject genres first, **edit style** (velocity, beat sync, phonk…) as a later second axis; popularity is views on
  YouTube and likes × 10 on TikTok / Instagram, labelled as a ranking aid; no automated TikTok / Instagram trend lists (terms,
  same as round 30); nothing adopted as a dependency (search log in `tools/11-discover-genres.md` and `tools/05-found-on-github.md`).

Round 32 (Sep 29, 2026; owner: "why instagram doesn't show thumbnail plus i want to watch the video in my dashboard"):
- Round 31 (PR #20) merged and deployed. Research with three agents, facts checked against the live platforms.
- **Instagram thumbnails**: no permitted source. Meta removed `thumbnail_url` from oEmbed on 2025-11-03; every other route is
  scraping (robots.txt and the terms forbid it) and its links die in days. Instagram cards get an honest poster tile.
- **▶ Watch here** (`tools/12-watch-in-dashboard.md`): one player sheet with the platforms' own players in plain sandboxed
  frames (YouTube privacy mode, TikTok player v1, Instagram embed). Decisions: no platform script in our origin (the owner's
  tokens live there), so no player library and no YouTube IFrame API; nothing loads before the tap; a tokenless oEmbed
  pre-check; messages accepted only from the player's origin and the sheet's own frame; a `frame-src` CSP.
- From this round on every executing agent runs on Opus 5.5 (owner's instruction); planning stays with the session model.

Brainstorm round 33 (Oct 3, 2026; owner: "plan today the work on discover page in all aspects… beacons.ai discover trends…
better search… maybe a panel that analyze editors", with his Obsidian creator list; then "I want to have mcp so I connect
claude. im already subbed"):
- Three projects in order: **(1) Discover search v2 + Claude connector**, (2) editor panel for the ~70 creators of
  "Social Media (Categories)", (3) Beacons-style trends on top of 1 and 2. Spec of (1): `tools/13-discover-search-v2.md`.
- A live test of 42 searches set the targets: a bare word drifts off-topic ("flash" → The Flash), 20 results cost the same as
  10, Arabic queries find other creators, ~1 call in 6 comes back empty, TikTok / Instagram numbers are rare.
- Decisions: results in sections (Popular now strip · Examples · Tutorials · Creators · Claude's picks), both languages on
  every search, a built-in editing dictionary instead of in-app AI for now, the owner pays Tavily pay-as-you-go if needed.
- **Claude through a connector, not the API** (owner): an MCP server on the Worker (OAuth login with the Scout token, tools
  search / trends / save picks / read picks, 60 lookups a day) so Claude works on the owner's subscription; an Anthropic key
  for in-app AI stays a later option. Supersedes the `/api/mcp` Next.js route of `tools/01-dashboard.md`.
- Editor panel research: Instagram Business Discovery gives other creator / business accounts' followers, posts, likes,
  comments and views, but only through Facebook Login (a Facebook Page linked to @3z.prod); TikTok has no route; YouTube
  is free with the key.

Round 34 (Oct 3, 2026; owner: "I want us to work on auto reply its an important feature for me" → "its made with beacons.ai I
want our version" → "I dont want anything that will get me banned"):
- Social improvements queued in this order: **auto replies first**, then the Studio home screen, Calendar and posting, Ideas
  and trends (each its own round, same workflow).
- Real check first: Beacons Smart Reply is down (Instagram signed it out, 0 sends); our v1 never ran (the Meta app lacks both
  reply permissions and is Unpublished). Public privacy, terms and data-deletion pages added (PR #24) for the **Live test**:
  does a private reply reach a commenter with no role on the app without App Review?
- **v2 design** (`tools/14-auto-replies-v2.md`): comment rules with buttons and a «تابعني» follow invite, DM and story-reply
  keyword answers, a default reply (once a day per person), quiet while the owner chats by hand, a pause switch, polling
  every minute with a KV write guard, a Beacons-style screen. **No follow gate**: Meta's spam rules forbid gating content
  behind a follow. **Instant mode** (webhooks) after Business Verification + App Review; the owner is getting a freelance
  document (Meta's acceptance of it is unconfirmed; a commercial registration is the safer fallback).

Brainstorm round 35 (Oct 6, 2026; owner: "you are like the head designer at apple ios system. premium and sleek", "change only
cinematic", "I want real icons", "dont forget the smooth animation thats the most important thing", "plan with fable first then we
gonna execute with opus 5.5"): **the Social world gets an iOS 26 look**; the Training pixel world is untouched. Owner picks, one
question at a time: glass navigation layer + solid content cards (not full Liquid Glass, not classic grouped lists) · light + dark
following the iPhone (no in-app switch) · real line icons everywhere in Social (Lucide; emoji only inside his own content) · full
depth, screen by screen (not a skin-only pass, not a ready-made kit) · font **Vazirmatn** (chosen over IBM Plex Sans Arabic after
seeing both in the mockup) · motion first (springs, title collapse, minimizing tab bar, sheets with two heights, pull to refresh,
chart scrub, swipe to favorite). Approved mockup: `planning/social-ios-mockup.html` (live copy
https://claude.ai/artifact/H7TN2Yh1gA3ZkabVpGj28f). Spec: `tools/18-social-ios-design.md`; plan:
`plans/2026-10-06-social-ios-design.md` (Fable designed and planned; Opus 5.5 executes, one PR per phase). Search before building:
own CSS glass (libraries need SVG filters WebKit ignores), `lucide-react`, an in-house bottom sheet (`vaul` was rejected at
execution: its Radix modal fights the app's stacked overlays), simple-icons paths for platform glyphs; Konsta UI, shadcn/Base UI and Motion not adopted this round (`tools/05-found-on-github.md`). The owner briefly
asked for the public website first ("i want to build the website first not the app… in ios theme"), chose "Portfolio first" pages and
platform-embedded videos, then stopped it: "Dont do the website now only the social panel". Those website answers are kept in
`tools/02-website.md` for the day it comes back.

Round 35 shipped (Oct 7, 2026): the Social iOS look went out in eight PRs — 1/8 foundations #52, 2/8 shell #53, 3/8 Studio #55,
4/8 Calendar and sheets #61, 5/8 Growth #64, 6/8 Ideas and More #65, 7/8 Replies, Automations, Soon #63, 8/8 icons everywhere
and final polish #68. Owner: "can you make it faster? sub agents" — Phases 5–7 were built in parallel worktrees, one review per
phase, then a review of the whole restyle fed one last polish round. Open owner checks on the iPhone: the light-mode status bar
in the installed app, sheets, pull to refresh, chart scrub, Reduce Motion / Transparency.

Round 36 (Oct 6, 2026). The owner shared a clone-effect reel and asked: "does it show in discover page as trendy or our discover
page needs working?"
- **Answer: no.** Nothing tracks editing-effect trends. The Trend Radar follows general topics, and "Popular now" only ranks one
  search. A manual "clone effect" search works, but its Arabic side mixes in biology "الاستنساخ".
- **Owner's picks for Trending effects:**
  - catch new effects early;
  - global first, Instagram and TikTok first;
  - compact chips at the top of Discover, refreshed every day;
  - new names cleaned up by the free built-in AI.
- **The daily job:** 6 Tavily mention searches, then rules plus one AI cleanup, then a YouTube numbers check on the top 6, then
  the chips.
- **Cost:** about 180 Tavily credits a month. YouTube use rises to 94 of the 100 searches a day in total.
- **Rejected:** scraping TikTok Creative Center, which TikTok's rules forbid since April 2026. We link to it instead.
- **Spec:** `tools/18-trending-effects.md`.
- **Built** on branch `claude/trending-effects-spec` (PR #41); the live check follows the merge and the Worker deploy.
- **Live fix, real post dates (Oct 7):** the owner saw "this week" chips resting on May posts and beauty reels under
  "Glow Effect": "rework if needed. English First. Instagram and tiktok first". Tavily sends no Instagram dates and its
  "week" is unreliable, and creators were filed under scan days. Each TikTok / Instagram post is now dated by its own id
  (checked on the owner's reels); creators count on the day they posted; Discover's week asks Tavily for a month and keeps
  the posts dated inside it; searches are English first, chip taps add an editing check; Instagram and TikTok come first.
  Branch `claude/trends-real-dates`; `tools/18-trending-effects.md` "Real post dates" and `tools/13` "Live fix".

Round 37 (Oct 6, 2026). The owner asked for Discover's categories to teach: "every category should show me the best
and the most trendy … I wanna learn from each category how it will benefit me in terms of photography and videography
and editing".
- **Owner's picks:** trends, then lessons; every 3 days, with lessons weekly; videos plus a short ✦ AI how-to; his
  skills linked; layout B (shelves); category scans like Trending effects; English first.
- **The job:** 4 category slots a day (05:40–05:55 UTC), 6 Tavily credits a scan, lessons 10 credits a category every
  6 days. A category tapped with nothing typed shows its page instead of the automatic search.
- **Cost:** about 2,000 Tavily credits a month in all, about $8 over the free plan with pay-as-you-go (the owner turns
  it on).
- **Rejected:** scraping-based trend tools (social-trend-agent, trendscope).
- **Spec:** `tools/19-category-trends.md`. **Plan:** `plans/2026-10-06-category-trends.md`.
- **Built** on branch `claude/category-trends-spec`; the live check follows the merge and the Worker deploy.
- **Live fix 1** (Oct 7, branch `claude/category-trends-live-1`). The first real Cars scan had no trends (24 posts:
  Instagram's week and TikTok gave about 1 a call) and poor lessons: Arabic names in Latin letters, generic how-tos,
  an unrelated song as a "tutorial", videos not about cars. The owner: "I want everything to be english first",
  "Plus it doesn't have to be tutorial". Now:
  - 6 queries over Instagram's month (still 6 credits), and the AI is asked to answer every key;
  - lesson searches find examples for the subject, keep only videos about the technique, and show a tutorial only
    when one teaches;
  - how-tos are concrete for the subject;
  - English first on the page and the 🔥 row, with Arabic only in Arabic script;
  - lessons carry a version, so Cars' first lessons refresh at its next scan.
  Details: `tools/19-category-trends.md` "Live check (2026-10-07)".
- **Top videos per platform** (Oct 7, branch `claude/category-top-videos`). The owner: "Every category should show at
  least 50 results in every platform with top tier results"; for TikTok he chose Brave's official Search API (he adds
  `BRAVE_API_KEY` in Cloudflare himself).
  - **The page:** "🏆 Top in Cars" after the 🔥 row, with YouTube · TikTok · Instagram tabs, up to 50 videos each, as
    Discover's result cards.
  - **YouTube:** its 50 most viewed of the month, 1 `search.list` on each cron scan and a category's first top scan
    (Scan again keeps the list); Discover's YouTube cap went from 70 to 66.
  - **Instagram:** the scan's own posts.
  - **TikTok, and Instagram under 50:** Brave when the tab is chosen, ≤ 40 requests a day (about 1,000 a month in
    Brave's $5 credit). Brave's results are never stored and are shown as Brave gave them, as their own group "More
    from Brave Search", with "Powered by Brave Search" under it (its terms and its credit).
  - **After the live rescan** (35 posts, 1 style at 3 creators): YouTube's videos feed the category trends, and a
    category style needs 2 creators (Trending effects keeps 3).
  - **Fix round and live fix 3** (the reviewer's findings; the Food and Anime lessons copied the prompt's coffee
    example, wrote "high-quality camera" lines, picked car techniques for anime and showed a backpack review): copied
    and generic how-tos dropped, no car example in the pick prompt, examples must name the category, gpt-oss-120b for
    the lessons with llama as the fallback, lessons version 4.
  - Details: `tools/19-category-trends.md` §3, §6 and its live check.
- **TikTok from TikTok's Discovery API** (Oct 7, branch `claude/category-tiktok-discovery`). Live, Brave's index held
  TikTok topic pages, not videos (Cars: 60 TikTok links, 0 posts). The owner: "brave is not the answer then we need
  another solution", then chose "Build it (Recommended)": his approved TikTok for Business app "ONUS Content Planner"
  (scope Discovery), official and free, with no ban risk.
  - **Connect once:** the owner adds the secret `TIKTOK_ADS_SECRET` in Cloudflare, then taps "Connect TikTok trends"
    on an empty TikTok tab, approves in TikTok for Business and lands back on Discover ("TikTok connected").
  - **Every scan** (free): the category's industry's popular hashtags in the US over 7 days, then their top videos, ≤ 50
    taken in turns, titled with the hashtag (the card shows the caption).
  - **Brave off** (`BRAVE_DAILY` "0"); its "once Brave search is connected" line is gone.
  - **Rejected:** TikTok's official Business API SDK (no new dependencies).
  - Details: `tools/19-category-trends.md` §6 "TikTok from TikTok's Discovery API".

## Tech stack (≈ $0/month + domain)
| Need | Choice | Why |
|---|---|---|
| App framework | Next.js (App Router) + TypeScript + Tailwind | One codebase for the public site, dashboard and API routes |
| i18n / RTL | next-intl, `/ar` (default) + `/en`, logical CSS (`ms-`/`me-`) | Proper RTL mirroring |
| Hosting | Cloudflare Workers via OpenNext (free) | Free tier allows commercial use (Vercel Hobby does not); fast in the Gulf; cron triggers |
| DB / Auth / Files | Supabase free: Postgres + Auth + Storage | Owner role + member accounts; private bucket for paid LUT/plugin files; row-level security |
| Email | Resend (free 3k/mo) | Newsletter + receipts |
| Analytics | Own cookieless page-view logging → Supabase | The dashboard reads it directly; no paid Plausible/Framer analytics |
| AI coach | Claude API (Haiku for cheap tasks, Sonnet for weekly plan) + web search tool | Hard cap: app-side budget counter + spend limit in the Anthropic Console |
| Video | Bunny Stream (~$1–5/mo) | Token-signed playback for paid students only |
| Payments | Moyasar (mada, Apple Pay, STC Pay) | Switched on when the CR/freelance document is approved; until then products show "Notify me" |
| Fonts / look | Training: cute pixel world (Baloo Bhaijaan 2 + Pixelify Sans). Social (round 35): iOS 26 look, light + dark, Vazirmatn, Lucide icons, green accent from Framer | Two worlds, one brand green; see `tools/18-social-ios-design.md` |

Note: the Supabase free tier pauses after 7 days with no activity. Daily dashboard use plus a cron ping prevents it.

## Data model (Supabase / Postgres)
- `programs` (name, icon, color) → `sections` (program_id, name) → `skills` (section_id, title_ar/en, description, difficulty, source_links, status: idea|active|mastered)
- `quests` (skill_id, type: train|produce|research|article, status, evidence_url, notes, completed_at)
- `xp_events` (source, amount, created_at) → derived: total XP, overall level, per-program level, streak
- `badges`, `user_badges`; `plan_items` (week, skill/quest ref, due, done, generated_by: ai|me)
- `articles` (slug, title/content ar+en, category, tags[], cover, status, read_time, **skill_id**), `categories`, `tags`
- `products` (type: lut|plugin|app|preset, price_sar, files → private storage, status: coming_soon|live), `orders`, `downloads`
- `course`, `lessons` (bunny_video_id), `enrollments`
- `affiliate_links` (title, url, category, clicks), `link_clicks`
- `subscribers` (email, lang, confirmed), members = Supabase auth users with `role` (owner|member)
- `page_views` (path, referrer, country, ts), `social_accounts`, `social_snapshots` (platform, followers, views, top_posts JSON, date)
- `ai_usage` (month, tokens, cost_usd) for the cap; `trend_items` (platform, topic, score, suggested_skill_id)

**Key link:** publishing an article with `skill_id` set **auto-completes that skill's "Article" quest** and awards XP.
The website itself feeds the game.

## Gamification rules (v1, tunable in settings)
- XP: Train 10 · Research 15 · Produce video 25 · Publish article 30 · Skill mastered bonus +20
- Overall level curve: level n needs `50 × n^1.5` cumulative XP. Program levels are computed the same way from that program's XP ("DaVinci Lv 3")
- Daily streak (any quest completed), weekly goal ring, badges (first mastered skill, 7-day streak, first sale, 100 subscribers…)
- Evidence: a quest can hold a link (YouTube/IG video, research notes, Obsidian link) so the dashboard doubles as a portfolio log

## Dashboard screens (owner only, `/dashboard`, PWA)
1. **Today** — level/XP bar, streak, 3 "next quests" (planner picks: nearest-to-mastery skill, a trending-topic match, an overdue plan item), quick check-off
2. **Skill Tree** — Program → Section → Skill tree/cards, 4 quest pips per skill, filters, add/edit skills
3. **Discover (AI)** — "Find skills for DaVinci → Color": AI searches web/YouTube/trends and proposes skills with sources; approve → added to the tree
4. **Planner** — weekly plan (AI-drafted or manual), calendar-ish list
5. **Content (CMS)** — articles (ar/en editor, categories/tags, cover upload, link to skill), products, affiliate links, CV/bio sections, course lessons
6. **Audience** — visits (daily chart, top pages, countries), newsletter subscribers, members, link clicks, sales
7. **Social** — per-platform followers/views, top posts, comment-theme summary ("what people ask for"), trend feed → "turn into skill/article idea"
8. **Settings** — XP rules, AI budget cap, connected accounts

## Public site (`/ar`, `/en`)
Home (hero in the Framer style) · About/Bio · CV · Articles (list with category/tag filters, article page, reading time) · Course (landing + waitlist → later lessons) ·
Shop (product pages, "Notify me" → later Moyasar checkout + secure download) · Links (link-in-bio + affiliate links, click-tracked, Beacons-like) ·
Newsletter subscribe everywhere · Member login (for purchases/course) · SEO: sitemap, OG images, hreflang.

## Social integrations (what's realistic)
- **YouTube**: Data API + Analytics API (OAuth, free): subs, views, top videos, comments → AI "what people want" summary. Trending in SA region.
- **Instagram**: Graph API needs a Creator/Business account linked to a Facebook Page. Followers, reach, media insights, comments.
- **TikTok**: Display API (app approval required): profile + video stats. No official trends API → AI web search for trends.
- **X**: API is paid (pay-per-post since Feb 2026), so manual stat entry and manual posting. **Snapchat**: manual entry and posting.
- **Auto-posting** (round 28): TikTok, Instagram, YouTube and Threads through the Scout Worker (`tools/07-auto-posting.md`).
- Daily cron snapshots into `social_snapshots` so the dashboard shows growth over time.

## Phases (each ends deployed and usable)
0. **Foundation** — Next.js scaffold, Tailwind design tokens from Framer, next-intl ar/en, Supabase project + schema migrations, owner login, Cloudflare deploy, PWA manifest
1. **Dashboard MVP** — Skill tree CRUD, quests, XP/levels/streaks/badges, Today screen, manual planner; seed programs from the app list above
2. **AI coach** — Discover (skill research with sources), weekly plan generation, budget cap enforcement
3. **Public site v1** — Home/Bio/CV, articles CMS + public pages (article → quest link), Links/affiliates page, newsletter (Resend), page-view analytics → Audience screen
4. **Social** — YouTube → Instagram → TikTok connectors, daily snapshots, comment/trend summaries, manual X/Snapchat entry
5. **Shop + Course** — products + private files, member accounts, Bunny Stream lessons, Moyasar checkout (when CR ready), orders/sales on dashboard
6. **Domain + polish** — buy domain, DNS on Cloudflare, SEO, OG images, performance pass

## Accounts the owner creates (step by step when we reach each phase)
Phase 0: Supabase, Cloudflare · Phase 2: Anthropic API key (+ spend limit) · Phase 3: Resend · Phase 4: Google Cloud (YouTube API),
Meta developer app, TikTok developer app · Phase 5: Bunny, Moyasar · Phase 6: domain registrar

## Monthly cost estimate
Hosting $0 · Supabase $0 · Resend $0 · AI ≤ $5 (capped) · Bunny ~$1–5 (Phase 5) · Domain ~$1/mo equivalent · Moyasar: % per sale only.
**≈ $2–11/month total, versus Framer + Base44 subscriptions.**

## Verification (per phase)
- `npm run lint`, `npm run typecheck`, unit tests for XP/level/streak math and the planner picker (Vitest)
- Playwright (Chromium is pre-installed) e2e: owner login → create skill → complete 4 quests → level up; publish article linked to skill → quest auto-completes;
  public pages render in `/ar` (RTL) and `/en`; non-owner cannot reach `/dashboard`
- Supabase RLS tests: anonymous/member cannot read owner tables or private files
- Deploy preview on Cloudflare checked on phone (PWA install) and desktop

## Next step after approval (still brainstorming, NOT building the project)
Only a **visual, clickable dashboard mockup** as a private Artifact page with fake sample data (nothing committed to the repo, no real app code),
covering: Today (level/XP, daily streak + micro-actions, 3 next quests, reward progress, active season), Skill Tree (DaVinci → Color → skills
with 4 quest pips and difficulty tier), Discover (AI suggestions in Saudi Arabic), Audience + Social (growth charts), Leads, and Content.
Arabic RTL with an English toggle, in the dark/green 3z Prod look, phone and desktop layouts.
The owner reacts to it, and we keep brainstorming (DaVinci skill tree, social/trends, money/legal) before any Phase 0 work.
