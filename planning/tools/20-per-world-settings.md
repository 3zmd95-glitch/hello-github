# 20 · Each world on its own: Social menu and Social settings

**Owner's ask (22 October 2026):** "I don't like that the sidebar makes me transition between Social and Training. I want
each project separate, each with its own settings. They are together now only to navigate fast; later they will be separate
websites."

**Decision (owner, 23 October 2026):**
- Discover stays a **Training** route only. Social loses its Discover shortcut; the Trend Radar's genre chips stop linking to it.
- Social gets its own **Settings** page at `/social/settings` in the iOS look, with the Social cards only:
  Worker URL + token · Connected accounts · Language + Sound · Backup (export / import / reset).
- Training `/settings` keeps avatar, language, sound, reminder, gear, genres, YouTube key, Worker, DaVinci, backup. It loses
  only the Connected accounts card.
- The 🎮 / 📱 world switch in the top bar and the "back to Training" row in Social's More stay: that is the fast navigation
  until the two worlds become separate sites.
- Language, sound and the Worker URL + token stay **one shared value** (one store). Nothing migrates.

## 1. Social menu (sidebar, phone tab bar, More)

- `SOCIAL_NAV_ITEMS` (components/shell/nav.ts): drop `/discover`; Settings points at `/social/settings`.
- Social More (components/shell/MoreScreen.tsx): drop the Discover row; the "all settings" row points at `/social/settings`.
- Social top bar gear (components/shell/AppShell.tsx `SocialTop`): `/social/settings`.
- Result: every link inside Social stays inside Social. `useWorld`'s "never remembered" note about Discover and Settings goes.

## 2. Social settings page

- Route `app/social/settings/page.tsx` → `components/settings/SocialSettingsScreen.tsx`:
  `PageHeader` (large iOS title, registers the compact title) · Worker card (the `scoutUrl` + `scoutToken` rows of the API
  keys card, `id="api-keys"` so the accounts card's "set the Worker first" link still lands) · `ConnectedAccountsCard`
  (`id="accounts"`) · quick settings list (language segmented + sound switch, the same rows as More) · backup card.
- The pixel `Card` is already restyled under `[data-world="social"]` (globals.css §px-card); `Card` strips a leading emoji from
  its title in Social (tools/18 rule: no emoji in Social titles, buttons, chips). The backup buttons do the same. The accounts
  card renders in Social only now, so its labels and chips lose their emoji outright (`settings.accounts.title`, `.sync`,
  `.removeSeed`; the ✍️ 📥 💬 chips and buttons). The 🔑 "reconnect in N days" warning line is not chrome and keeps its key.
- `SettingsScreen` (Training) drops `ConnectedAccountsCard`. The API keys card and the backup card move to their own files
  (`ApiKeysCard.tsx` with a `rows` prop, `DataCard.tsx`) so both screens share them.
- No new i18n keys: the Social page reuses `settings.title`, `settings.sub`, `settings.apiKeys`, `more.quick`, `settings.data`.

## 3. Links fixed

- `/settings#accounts` and `/settings/#accounts` inside Social (Growth, TikTok brief, Auto-posting screen + tab, Auto replies,
  Trend Radar's `/settings/`) → `/social/settings/#accounts`.
- `connectReturnTo()` (components/social/useSocialSync.ts): the Worker sends the owner back to `/social/settings/`. The
  Worker's check is origin-only (workers/scout/src/origins.ts), so nothing changes there.
- Trend Radar genre chips: plain chips (TrendRow loses its `genreHref` branch; `trendGenreHref` and `trends.genreOpen` go).

## 4. Tests

- `e2e/world.spec.ts`: the two "Discover opens in the Training world" tests become one "Social stays Social" test (sidebar on
  desktop, More on the phone, the gear: Settings opens `/social/settings/` with `data-world="social"`; no `/discover/` or
  `/settings/` link in Social's sidebar, tab bar or More). `SOCIAL_PATHS` gains `/social/settings/`.
- `e2e/social-look.spec.ts`: `SOCIAL_PATHS` gains `/social/settings/` (iOS tokens, fits the screen, no emoji in chrome).
- `e2e/accounts.spec.ts`, `autopost.spec.ts`, `autoreplies.spec.ts`: the Worker + accounts setup happens on
  `/social/settings/`; `returnTo` ends with `/social/settings/`; Growth's connect link is `/social/settings/#accounts`.
- `e2e/trends.spec.ts`: genre chips are never links.
- `components/shell/nav.test.ts`, `lib/trends` unit tests: follow the code.
- Training specs (`settings`, `scout`, `research`, `discover`, `layout`) unchanged.

## 5. Out of scope

- A Social Discover, a per-world language or Worker, a Social look for Training settings. Revisit when the sites split.
