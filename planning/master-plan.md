# 3z Creator Platform — Master Plan

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
- Leveling = **XP + 4 quests per skill**: Train, Produce (video), Research, Publish article. Plus streaks and badges.
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
  done Research shows the linked Obsidian note.
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
  photo/clip upload) · **Produce** = a short clip that shows the technique · **Research** = Obsidian note · **Publish** = article (Arabic gap flag applies).
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
| Fonts / look | Dark cinematic, green accent from Framer, 3z logo, Arabic font (e.g. IBM Plex Sans Arabic) + Latin pairing | Continuity with the current brand |

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
- **X**: API is paid (~$200/mo), so manual stat entry in the dashboard for now. **Snapchat**: manual entry.
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
