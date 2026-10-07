# 18 · Social world, iOS 26 look (glass navigation, solid cards, light + dark, real icons, spring motion)

**Status:** designed and approved by the owner on October 6, 2026 (round 35). Not built yet. Plan: `../plans/2026-10-06-social-ios-design.md` (Opus 5.5 executes, one PR per phase). The owner briefly asked for the public website first the same afternoon, then said "Dont do the website now only the social panel", so this round proceeds.
Owner, round 35 (Oct 6, 2026): "you are like the head designer at apple ios system. premium and sleek" · "change only
cinematic" (= the 📱 Social world; the 🎮 Training pixel world stays as it is) · "I want real icons" · "dont forget the
smooth animation thats the most important thing" · "plan with fable first then we gonna execute with opus 5.5" ·
"further enhance the design" · font: "Vazirmatn" · "direction OK".

Decisions the owner made in this round (one question at a time):

| Question | Owner's pick |
| --- | --- |
| Which iOS feel | **iOS 26: glass navigation layer, solid content cards** (how Apple uses Liquid Glass: bars, sheets, toasts; never the content) |
| Appearance | **Light + dark, follows the iPhone setting** (no manual switch in the app) |
| Icons | **Real line icons everywhere in Social** (Lucide, SF Symbols spirit). Emoji only inside the owner's own content |
| Depth | **Full iOS layer, screen by screen** (shared skin + every Social screen re-laid-out), built in phases with a review each |
| Font | **Vazirmatn** (closest free match to SF Arabic; variable weight; clean Latin and digits) |
| Motion | The most important thing: every interaction springs; nothing snaps |

## 1. What changes, in plain words

- The Social world gets the look of a current iPhone app: a clear top area whose controls float as frosted-glass capsules,
  a floating glass tab bar, big page titles that shrink into the bar as you scroll, solid white / near-black cards with
  soft shadows and no borders, grouped lists with hairline separators, pill buttons, segmented controls, iOS switches,
  bottom sheets you drag, capsule toasts.
- It follows the phone's light or dark setting. Both looks are designed, not inverted.
- Every emoji that works as an icon in Social (menus, buttons, cards, section titles) becomes a line icon. Emoji typed by
  the owner in captions, ideas and notes stay.
- Motion is the headline: launch choreography, title collapse on scroll, tab bar that minimizes while scrolling down,
  glass lens that stretches as it slides between tabs, sheets with two heights and rubber band, pull to refresh,
  finger scrub on charts, swipe to favorite, count-ups, chart draw-on, spring switches. All on `transform` / `opacity`,
  all honoring "Reduce motion".
- The Training world is untouched: same CSS, same components, same tests. Shared components (shell, ConfirmDialog,
  toasts) restyle through the `data-world="social"` tokens only.

## 2. Scope

**In:** `app/social/**` routes and `components/social/**`, the shell for the Social world (`components/shell/*`), the
shared `[data-world="social"]` token block and `.px-*` overrides in `app/globals.css`, Social message files
(`messages/{social,publish,ideas,calendar,trends,replies,growth}.{ar,en}.json` and the `nav.*` / `world.*` keys),
`lib/social.ts` platform glyphs, the new `components/ui/ios/*` primitives, tests that pin the old look.

**Out (follow-ups, recorded in §12):** Settings and Discover opened from Social (they are Training routes and keep the pixel
look for now), a light mode for Training (never), Website / Business pages beyond their "قريب" cards, native haptics.

## 3. Design system (the `social` theme)

Token names stay the ones every `.px-*` class and Tailwind color utility already use (`--bg`, `--panel`, `--panel-2`,
`--panel-3`, `--edge`, `--ink`, `--ink-2`, `--muted`, `--accent`, `--accent-ink`, `--gold`, `--gold-ink`, `--danger`,
`--sky`, `--orange`, `--shadow`, `--shadow-sm`, `--radius`, `--radius-sm`, `--font-body`), so existing markup restyles
on its own. New tokens are added next to them. Training's `:root` block does not change.

### 3.1 Color

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--bg` | `#F2F3F6` | `#0B0D10` | page ground (iOS grouped background) |
| `--panel` | `#FFFFFF` | `#15181E` | card / list surface |
| `--panel-2` | `#F2F3F6` | `#1C2027` | inset surface (stat tiles, fields, sheet lists) |
| `--panel-3` (alias `--fill`) | `#E4E7EC` | `#262B34` | fills: chips, segmented track, switch off |
| `--edge` (alias `--hair`) | `rgba(16,22,30,.10)` | `rgba(255,255,255,.08)` | hairline separators only (cards have no border) |
| `--ink` | `#0B0D10` | `#F2F4F7` | primary text |
| `--ink-2` | `#555D69` | `#A9B1BC` | secondary text (AA on surfaces) |
| `--muted` | `#676F7D` | `#8B94A1` | tertiary text, chevrons, day letters (AA on surfaces) |
| `--accent` | `#45E08E` | `#45E08E` | brand green: filled buttons, rings, active dots, switch on |
| `--accent-ink` | `#06130D` | `#06130D` | text on accent |
| `--tint` (new; `--sky` aliases it) | `#0E7443` | `#5BE59F` | green for text, icons, links, active tab |
| `--tint-bg` (new) | `rgba(18,138,81,.12)` | `rgba(69,224,142,.15)` | tinted icon squares, secondary buttons |
| `--gold` / `--orange` (alias `--warn`) | `#945700` | `#FFB75A` | warnings, overdue, favorites |
| `--warn-bg` (new) | `rgba(184,110,0,.12)` | `rgba(255,183,90,.14)` | warning icon squares, chips |
| `--gold-ink` | `#FFFFFF` | `#1E1606` | text on a solid warn fill |
| `--danger` | `#D0332B` | `#FF6B6B` | destructive text and buttons |
| `--pc-tiktok` `--pc-instagram` `--pc-youtube` `--pc-snapchat` `--pc-x` `--pc-threads` | `#FE2C55` `#E1306C` `#E60000` `#E6C700` `var(--ink)` `var(--ink)` | same, Snapchat `#FFFC00` | platform badges, calendar dots, chart lines (replaces the hex in `lib/social.ts`) |

Glass and elevation tokens (new):

| Token | Light | Dark |
| --- | --- | --- |
| `--glass-bg` | `rgba(255,255,255,.66)` | `rgba(24,28,34,.58)` |
| `--glass-blur` | `22px` | `22px` |
| `--glass-rim` (inset .5px) | `rgba(255,255,255,.95)` | `rgba(255,255,255,.12)` |
| `--glass-hi` (inset top 1px) | `rgba(255,255,255,.9)` | `rgba(255,255,255,.08)` |
| `--glass-spec` (top gradient) | `rgba(255,255,255,.55)` | `rgba(255,255,255,.10)` |
| `--glass-shadow` | `0 10px 30px rgba(16,24,32,.10), 0 0 0 .5px rgba(16,24,32,.08)` | `0 12px 40px rgba(0,0,0,.55), 0 0 0 .5px rgba(255,255,255,.06)` |
| `--lens` (active pill on glass) | `rgba(255,255,255,.92)` | `rgba(255,255,255,.14)` |
| `--lens-shadow` | `0 2px 8px rgba(16,24,32,.14), inset 0 0 0 .5px #fff` | `inset 0 0 0 .5px rgba(255,255,255,.18), 0 2px 10px rgba(0,0,0,.35)` |
| `--shadow` (cards) | `0 1px 1px rgba(16,24,32,.03), 0 8px 24px rgba(16,24,32,.05)` | `inset 0 1px 0 rgba(255,255,255,.03), 0 10px 30px rgba(0,0,0,.35)` |
| `--shadow-sm` | `0 1px 3px rgba(16,24,32,.08)` | `0 2px 8px rgba(0,0,0,.35)` |

Scheme switching: inside `:root[data-world="social"]` set `color-scheme: light dark`; the dark values live under
`@media (prefers-color-scheme: dark)` scoped to the same selector. `theme-color` follows: the shell updates the
`<meta name="theme-color">` to `--bg` of the active world and scheme (Training stays `#0d141d`).

Contrast was checked for every text token on `--bg`, `--panel`, `--panel-2` in both schemes (≥ 4.5:1 for text ≤ 18px).
`--accent` is a fill color only; green text always uses `--tint`.

### 3.2 Type

Font: **Vazirmatn** (Google Fonts, OFL), weights 400 / 500 / 600 / 700, loaded in the existing `FONTS_CSS` link in
`app/layout.tsx` (`family=Vazirmatn:wght@400;500;600;700`); IBM Plex Sans Arabic leaves the link once nothing uses it.
`--font-body` for Social = `"Vazirmatn", -apple-system, "SF Arabic", "Segoe UI", system-ui, sans-serif`.

| Role | Size / weight | Where |
| --- | --- | --- |
| Large title | 34px / 700, line-height 1.15, letter-spacing −0.015em | page title (`PageHeader`) |
| Compact title | 17px / 600 | in the glass bar once scrolled |
| Title 2 | 22px / 700 | sheet titles 20px, dialog titles |
| Title 3 | 19px / 700 | hero headline |
| Headline | 17px / 600 | emphasized rows |
| Body | 15px / 400 (500 for row titles) | everything else (app base stays 15px) |
| Subhead | 13px / 600 | section headers (`.gh`), card eyebrows, links in headers |
| Footnote | 12px / 500 | chips, deltas, stat labels |
| Caption | 11px / 600 | tab bar labels, day letters, chart tooltip dates. **Floor: 11px**, nothing smaller |

Numbers: Western digits, `font-variant-numeric: tabular-nums`, `direction: ltr; unicode-bidi: isolate` (the existing `.num`
utility, without the pixel font in Social). Prose copy keeps the Arabic-Indic digits already in the strings.

### 3.3 Shape and space

| Thing | Value |
| --- | --- |
| Card, list group | radius 22px, padding 16px, shadow `--shadow`, **no border** |
| Inset tile / field | radius 16px / 14px, background `--panel-2` |
| Icon square in rows | 34×34, radius 10px, `--tint-bg` + `--tint` (warn and fill variants) |
| Platform badge | 40×40, radius 13px, platform color, white glyph |
| Pill (buttons, chips, segmented pill, tab bar) | radius 999px |
| Segmented control | track radius 12px, thumb 9px, 3px inset |
| Sheet | top radius 30px |
| Gutter | 16px; card gap 12px; group header padding 0 16px |
| Row | min height 58px, padding 11px 16px, separator .5px from 62px (16px when no icon) |
| Tap targets | ≥ 44px tall; icon buttons 40–44px |
| `corner-shape: squircle` | progressive enhancement on cards, tiles, icon squares, sheet (Safari 26, Chrome 139+) |

Buttons: primary = `--accent` fill + `--accent-ink`, 44px pill; secondary = `--tint-bg` + `--tint`; ghost = text only;
small = 34px. Destructive = `--danger` text (ghost) or fill. `.px-btn*` classes map onto these in Social.

### 3.4 Glass recipe (only on the navigation layer)

```css
.glass {
  background: var(--glass-bg);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(180%);
  backdrop-filter: blur(var(--glass-blur)) saturate(180%);
  box-shadow: var(--glass-shadow), inset 0 1px 0 var(--glass-hi), inset 0 0 0 .5px var(--glass-rim);
}
.glass::before { /* specular */ content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  background: linear-gradient(180deg, var(--glass-spec), transparent 45%); }
.slab { /* top bar background once scrolled */ background: var(--glass-bg); backdrop-filter: blur(var(--glass-blur)) saturate(180%); box-shadow: 0 .5px 0 var(--edge); }
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) { .glass, .slab { background: var(--panel); } }
@media (prefers-reduced-transparency: reduce) { .glass, .slab { background: var(--panel); backdrop-filter: none; } .glass::before { display: none; } }
```

Allowed glass surfaces: top slab, world-switch capsule, gear button, tab bar, the Calendar "+" button, toasts, the
pull-to-refresh spinner, the chart tooltip. **Never** cards, lists, sheets or buttons inside content. At most three
blurred surfaces visible at once. SVG-filter "refraction" is not used (WebKit ignores `backdrop-filter: url()`).

### 3.5 Motion system

Tokens: `--spring` = CSS `linear()` spring (fallback `cubic-bezier(.34,1.3,.64,1)`), `--out` = `cubic-bezier(.2,.8,.2,1)`,
sheet-close `cubic-bezier(.4,0,1,1)`; durations `--t-fast` 160ms (press, highlights), `--t-med` 320ms (fades, panel
cross-fade), `--t-spring` 500ms (anything that moves: lens, thumb, switch, sheet, toast).

```css
--spring: linear(0, 0.004 0.8%, 0.019 1.7%, 0.073 3.5%, 0.164 5.5%, 0.309 8%, 0.484 10.6%, 0.671 13.4%, 0.834 16.2%,
  0.955 18.9%, 1.036 21.8%, 1.08 24.7%, 1.094 27.5%, 1.083 30.5%, 1.059 33.8%, 1.028 37.6%, 1.002 41.9%, 0.99 46%,
  0.987 51.7%, 1 71.1%, 1);
```

Signature behaviors (each one exists in the mockup; numbers are the mockup's):

| Behavior | Rule |
| --- | --- |
| Launch | brand mark, world capsule, gear fade+drop in (delays 50/120/180ms); tab bar rises from below (220ms delay); page title rises; cards stagger 50ms apart (max 8), first view of each screen only |
| Large title | fades and scales (1 → 0.94) over the first 56px of scroll; compact title + glass slab appear past 44px |
| Tab bar | minimizes (translateY 10px, scale .88, labels fade) after scrolling down ≥ 6px past 140px; restores on any 6px scroll up or above 80px; the "+" button follows |
| Tab change | panels cross-fade (out 160ms, in 320ms with 12px rise); glass lens slides with the spring and pulses (scaleX 1.24 / scaleY .9 at 35%); the new icon bounces (−5px, 1.18×) |
| Press | buttons, cards, chips scale .97 (160ms); rows highlight `--panel-2`; tabs scale .9 |
| Segmented / switch / star | thumb springs on transform only (equal-width segments, width set once); switch thumb springs 20px and stretches 1.15× while pressed; favorite star pops 1.35× |
| Sheet | opens at **medium** (60% visible), drag up to **large** (92%); backdrop dims .38 + blur 6px; content behind scales .965 and rounds 36px; drag from the grabber + header; velocity ±0.6 px/ms decides, else nearest height; rubber band `-log1p(-y/30)·30` above the top; close 280ms ease-in |
| Pull to refresh | Studio only; resistance .55, trigger at 70px, holds 56px while refreshing (≥ 1.1s), spinner glass circle rotates, then toast |
| Numbers | count up 1000ms cubic ease-out on first view; charts draw their line 1.3s, area fades in after .5s, end dot pops after 1.1s |
| Chart scrub | finger or mouse over the big chart shows a dashed marker, a ring dot and a glass tooltip (value + date); hides 900ms after release; `touch-action: pan-y`: a finger scrubs once it moves sideways (~6px), a vertical swipe scrolls the page (ruling at build time — `none` trapped the scroll on phones) |
| Week strip | `scroll-snap-type: x mandatory`, previous / current / next week; opens on the current week |
| Swipe to favorite | ideas rows: drag toward the end (left in RTL) up to 96px then log resistance; arm at 64px; release toggles the star and springs back; `touch-action: pan-y` keeps vertical scroll |
| Toast | glass capsule drops from the top with the spring, 1.9s, `role="status"` |
| Lists | inserted rows rise in (`up` 600ms); converted items morph button → chip with a pop |
| Reduce motion | `prefers-reduced-motion` (and the mockup's manual switch) sets every duration to 0: states still change, nothing moves, charts render drawn |

Performance rules: animate `transform` and `opacity` only (no width/height/blur animation); scroll handlers are
`passive` and coalesced in `requestAnimationFrame`; no `will-change` on more than the moving element; blur radius never
animates; measure on an iPhone in the installed PWA (Safari engine): 60 fps while scrolling Studio with the tab bar and
top slab visible.

Implementation: plain CSS + small hooks (`useScrollChrome`, `usePullToRefresh`, `useSwipeAction`, `useCountUp`,
`useChartScrub`). No animation library in this round (the mockup proves it is not needed). The sheet is built in-house
(Oct 6 execution ruling: `vaul`'s Radix modal traps focus and dismisses on outside clicks, which breaks the app's own
stacked layers: the skill popup over the post popup, the player, alerts, celebrations).

### 3.6 Icons

- `lucide-react` (ISC), `strokeWidth={1.75}`, default size 22 (tab bar 23, row icons 22, chips 13–14).
- Navigation: Studio `Clapperboard` · Calendar `Calendar` · Growth `TrendingUp` · Ideas `Lightbulb` · More `Ellipsis` ·
  Website `Globe` · Business `Briefcase` · Replies `MessageCircle` · Automations `Rocket` · Discover `Search` · Settings
  `Settings` · Training `Gamepad2` · Social `Smartphone` · back-to-Training row `Gamepad2`.
- Common: time `Clock`, overdue `Clock` in warn, filmed `Film`, idea `Lightbulb`, ask `MessageCircle`, convert `Sparkles`,
  growth `TrendingUp`, best `Trophy`, views `Eye`, favorite `Star`, waiting `Clock`, used `RefreshCw`, add `Plus`,
  new post `CalendarPlus`, confirm `Check`, close `X`, forward chevron `ChevronLeft` (RTL), language `Languages`,
  sound `Volume2`, refresh `ArrowDown` → `LoaderCircle`.
- Platform glyphs: brand marks from simple-icons (CC0), six SVG paths copied into `lib/platformIcons.tsx` (TikTok,
  Instagram, YouTube, Snapchat, X, Threads), rendered white on the platform color badge. No `simple-icons` dependency.
- SF Symbols themselves are not used (Apple's license limits them to Apple platforms).

## 4. Shell (Social only; Training's shell code paths stay)

- **Top area**: no full-width bar at rest. Start side: brand mark (36px, radius 11, accent) + the world switch as a glass
  capsule with two icon buttons (`Gamepad2`, `Smartphone`; active one on a lens). End side: gear in a glass circle.
  The language toggle leaves the top bar (lives in More and Settings). Once the page scrolls past 44px a glass slab fades
  in behind, with the current screen's title centered (17px / 600).
- **Tab bar** (phones): floating glass capsule, 14px side insets, 12px above the safe area, 64px tall, five items
  (Studio · Calendar · Growth · Ideas · More) with Lucide icons and 11px labels; a lens pill marks the active item;
  minimizes on scroll down. The "+" (new post) glass button sits above it on Calendar.
- **Sidebar** (≥ md): solid list on the page ground, 10px radius rows, lens-style active row with `--tint` text, same
  icons. Desktop keeps the 1180px content width.
- **Toasts** in Social: capsule glass toast at the top (the celebration provider picks the Social style from the world).
- **Scroll chrome**: the shell listens to window scroll (passive + rAF) and writes `--scroll-p` (0–1 over 56px),
  `data-compact` and `data-tabbar="mini"` on `<html>`; `PageHeader` and the bars read them. Screens register their title
  for the compact bar through `PageHeader`.
- **Launch choreography** plays when the Social shell mounts (a full load, or switching from Training): CSS keyframes, no JS timers.
- **As built (Phase 2, Oct 7):** theme-color comes from `app/social/layout.tsx` (`viewport.themeColor` light/dark pair, `colorScheme: "light dark"`), so it is in the static HTML and Next swaps it on navigation; the compact title sits between the two side groups (never under the world switch); the tab-bar lens is absent on routes without a tab; language and sound live in More.

## 5. Primitives (`components/ui/ios/`)

| Component | Replaces | Notes |
| --- | --- | --- |
| `PageHeader` (eyebrow?, title, sub?, trailing?) | the `<header>` copied in all 8 Social screens | large title + registers the compact title |
| `Card` | `.px-card` markup in Social | class wrapper, `pressable` prop |
| `ListGroup` + `ListRow` (icon, iconTone, title, sub, trailing, chevron, href / onClick) | ad-hoc `px-inset` rows, More links | hairline separators, press highlight |
| `Segmented` (options, value, onChange, role tablist / radiogroup) | `.cal-tabs`, `.gr-tabs`, `.studio-seg` | equal widths, spring thumb, keyboard arrows |
| `Switch` | `role="switch"` checkboxes in Auto replies | styled native `<input type="checkbox" role="switch">` (tests already query `getByRole("switch")`) |
| `Sheet` (title, detents, children), in-house | `SheetFrame`, `GrowthDialog`, post popup | portaled on z-39 under the skill popup / alerts / player / celebrations; detents `[0.6, 0.92]`, drag + fling, `useBackToClose`, focus in and out, scroll lock |
| `Alert` = `ConfirmDialog` restyled by `data-world` | centered 270px iOS alert: title, message, stacked buttons with hairlines | one component for both worlds |
| `Chip` (`.px-chip` restyle) | tone: default / tint / warn | 24px pill, 12px / 600 |
| `StatTile` (label, value, delta, countUp) | `.an-kpi`, Studio growth tiles | 24px tabular numbers |
| `PlatformBadge` (platform, size) | emoji in `PLATFORM_META` | brand glyph on platform color |
| `EmptyState` (icon, title, hint, action) | inline empty copies | one layout |
| `GlassToast` | pixel toast in Social | capsule |
| hooks: `useScrollChrome`, `usePullToRefresh`, `useSwipeAction`, `useCountUp`, `useChartScrub` | | small, no deps |

`.px-*` classes keep working in Social during the migration (their Social overrides adopt the new tokens, radii and
shadows), so screens can move to the primitives one by one without a flag day.

## 6. Screens

- **Studio** (`/social`): eyebrow with today's date, large title, then: hero card (next post with platform chip, live
  countdown, 60px progress ring, primary "خطّط بوست" + secondary "افتح في التقويم"; soft ambient green glow); today's
  reminder row card with a tinted clock icon and the flame line; week plan card (7 days, platform dots, today in accent,
  "x/y انتشر" chips, link to Calendar); growth snapshot card (two stat tiles with count-up, a 70px sparkline that draws
  itself, "fastest growing" line with a trophy icon); **الوارد** as a grouped list (warn icon for overdue, film, bulb,
  trend) with chevrons; **إيش يبغون الناس** grouped list with "حوّلها فكرة" small buttons that morph into "في البنك" chips.
  Pull to refresh re-runs the social sync (when the Worker is configured) and shows a toast.
- **Calendar**: large title, segmented Week · Month · Stages, swipeable week strip card, posts grouped by day
  (platform badge, title, time, stage chip), unplanned group, "+" glass button → the new-post **Sheet**. The post popup
  becomes a Sheet with a segmented Overview · Script · Shots inside; "Mark as posted", copy and delete stay. Month view =
  a card grid with platform dots; Stages = horizontal cards per stage. Deep link `#post=<id>` keeps working; opening
  pushes history so Back closes the sheet.
- **Growth**: large title, segmented All · per platform, 2×2 stat tiles (count-up), 90-day chart card with the draw-on
  and finger scrub (tooltip with value and date), top posts grouped list with view chips, content-mix tip card, asks
  list. Manual snapshot and CSV import forms open in Sheets; the four `GrowthDialog`s become Sheets or Alerts.
- **Ideas**: large title, filter chips row (Lucide icons: star, clock, refresh), ideas grouped list with swipe-to-favorite
  and a star button, Trend Radar rows as a grouped list with platform badges, full-width "فكرة جديدة" primary button.
- **More**: large title, grouped lists: Replies · Automations · Discover; Website · Business with "قريب" chips; quick
  settings group (language segmented, sounds switch, all settings); "ارجع للتدريب" tinted row.
- **Replies** (`/social/replies`): rules as grouped list rows (keyword, reply preview, on/off Switch); the editor opens as
  a large Sheet; the phone preview keeps its mock frame restyled with tokens; the tester `<details>` stays (tests).
- **Automations** (`/social/automations`): queue as grouped list with platform badges and stage chips; confirm dialogs
  are Alerts; "copied" feedback becomes a toast.
- **Website / Business**: one card each with the Lucide icon, the "قريب" chip and the explanation copy.
- **Settings / Discover from Social**: unchanged this round (open in the Training shell).

## 7. Copy and emoji sweep

- Social message files: remove the leading emoji from values that start with one (about 94 keys per language; every Social
  `h1`, `social.studio.inbox*`, `social.studio.reminder`, platform words, etc.). Where the emoji carried meaning, the
  component renders the Lucide icon or platform glyph instead. `messages/messages.test.ts` parity holds (same keys).
- Core keys used by Social: `world.training` / `world.social` lose "🎮 " / "📱 " (the Training WorldSwitch draws its own
  emoji from its `icon` field, so Training does not change visibly).
- JSX emoji in `components/social/**` (55 lines in 29 files) become icons; `PLATFORM_META` gets `glyph` (brand SVG) next to
  the existing `icon` emoji, and Social reads `glyph`.
- Hijazi Arabic first, English second, unchanged wording otherwise.

## 8. Tests that pin the old look (update, do not delete)

| Test | Today | After |
| --- | --- | --- |
| `e2e/world.spec.ts:57` | body font contains "IBM Plex Sans Arabic" | contains "Vazirmatn" |
| `e2e/world.spec.ts:18-20,56` | first `.px-card` radius ≥ 10px in Social | still true (22px); add: `.px-card` has no border |
| `e2e/calendar.spec.ts:167` | text "📎🎮" | the linked-skill chip by test id, no emoji |
| `e2e/autopost.spec.ts:440` | text "❌ إلغاء الجدولة" | "إلغاء الجدولة" |
| `e2e/studio.spec.ts:47-48,184` | 7 `.studio-wday`, `[data-today]`, `data-count` | keep the class names and data attributes on the new week strip |
| `e2e/calendar.spec.ts` + `autopost.spec.ts` (12 places) | first `<button>` inside `.post-card` opens the post | keep `.post-card` with the open button first |
| `e2e/autoreplies.spec.ts:533,582` | `getByRole("switch")`, `<summary>` | native switch keeps the role; tester keeps `<details>` |
| `e2e/growth.spec.ts:265` | chart is `svg` | still SVG |
| `e2e/world.spec.ts:202-210` | no horizontal scroll on 9 Social routes | still true, in both schemes |
| `components/shell/MoreScreen.test.ts` | link order and hrefs | unchanged order |

New: `e2e/social-look.spec.ts` visits every Social route in light and dark (`colorScheme` emulation) and checks the font,
no emoji in nav / tab bar text, the glass tab bar exists, no horizontal scroll, `prefers-reduced-motion` leaves no
running transitions on the tab bar, and the Training Today page still has the pixel font and 2px radius (guard).

## 9. Search before building (round 35)

| Need | Found | Decision |
| --- | --- | --- |
| Liquid glass | [liquid-glass-react](https://github.com/rdev/liquid-glass-react), [simple-liquid-glass](https://github.com/lucaperullo/simple-liquid-glass), [liquid-glass-showcase](https://github.com/aryankholqi/liquid-glass-showcase) | **Rejected / reference**: refraction needs SVG filters WebKit ignores; own 12-line CSS recipe adopted |
| 21st.dev | Segmented Control (ddoemonn), Bottom Nav Bar (arunachalam), Animated Tabs (Build UI), shadcn Drawer | **Reference patterns** (all need `framer-motion`; converted to CSS + logical properties) |
| Primitives | shadcn/ui on Base UI, Radix, [Konsta UI](https://konstaui.com), Ark UI, Silk | shadcn/Base UI **maybe later** (no popovers / menus needed now); Konsta **rejected** (whole-app theme fights our tokens); Silk rejected (commercial) |
| Bottom sheet | [vaul](https://github.com/emilkowalski/vaul) 1.1.x (MIT, 18.5 KB gz incl. Radix Dialog) | First adopted, then **rejected at execution** (Oct 6): its Radix modal (focus trap, outside-click dismiss, hidden siblings) fights the app's stacked overlays, and its background scale needs a viewport-sized wrapper; in-house sheet instead (the mockup's) |
| Icons | [Lucide](https://lucide.dev) (ISC), Hugeicons free, Phosphor, Tabler, Heroicons | **Lucide adopted** (`lucide-react`, tree-shaken); Hugeicons fallback for missing glyphs |
| Brand glyphs | [simple-icons](https://github.com/simple-icons/simple-icons) (CC0) | **Adopted as copied paths**, no dependency |
| Motion | [Motion](https://motion.dev) (`m` + `LazyMotion` ≈ 20 KB), CSS `linear()` springs, React `<ViewTransition>` | **CSS adopted**; Motion deferred; `<ViewTransition>` a stretch task for route changes |
| Arabic font | Vazirmatn, IBM Plex Sans Arabic, Noto Sans Arabic, Readex Pro, Cairo, Tajawal, Almarai, Rubik | **Vazirmatn adopted** (owner's pick after seeing both) |
| SF Symbols | Apple license | **Not allowed** on the web |

## 10. Build order (one PR each, review + gates after each)

1. Foundations: tokens (light + dark), Vazirmatn, Lucide, platform glyphs, the `components/ui/ios/*` primitives and hooks,
   `.px-*` Social overrides, `social-look.spec.ts`.
2. Shell: top area, glass tab bar + minimize, sidebar, world switch, toast, scroll chrome, launch choreography,
   theme-color.
3. Studio.
4. Calendar + the Sheet system (post popup, new post, SkillSheet corner fix, Back closes).
5. Growth (tiles, chart draw + scrub, forms as sheets).
6. Ideas + More.
7. Replies, Automations, Website, Business.
8. Emoji sweep in strings and JSX, test updates, iPhone performance pass, master-plan update.

## 11. Acceptance

- Every Social route matches the mockup's language in light and dark on a 390px phone and at 1180px desktop.
- Training: `pnpm e2e` Training specs unchanged and green; Today page screenshot identical before and after (manual check).
- All quality gates green: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm e2e` (with `E2E_PORT`).
- Owner's phone check: smooth 60 fps scroll in Studio, glass visible, sheet drag works at both heights, pull to refresh,
  swipe to favorite, chart scrub, "Reduce motion" respected, both appearances.
- No emoji left in Social navigation, buttons, section titles or chips.

## 12. Follow-ups (not in this round)

- Settings and Discover rendered in the Social look when opened from Social (today they jump to the pixel shell).
- Route transitions with React `<ViewTransition>` (Next 16 App Router) once the static-export behavior is verified.
- Haptics are not available on the web; skip.
- A manual appearance override (System · Light · Dark) in Settings if the owner asks.

## 13. Risks

- `backdrop-filter` cost on iOS WebKit over scrolling content: cap at three blurred surfaces; measure on the owner's phone.
- RTL regressions in pasted patterns: use logical properties; the mockup is the reference for direction (chevrons point
  left, swipe toward the left, week strip starts at the right).
- The in-house sheet must match native feel: drag, fling and detents are checked on the owner's iPhone in phase 4.
- The emoji sweep touches ~190 strings and 29 components: do it last, in one PR, with the parity test and the e2e suite.
