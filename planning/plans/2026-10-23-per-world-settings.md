# Per-world Social menu and Social settings — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every link inside the Social world stays inside Social, and Social gets its own Settings page at `/social/settings` in the iOS look.

**Architecture:** The shell already derives the world from the URL and renders one nav list per world (`components/shell/nav.ts`, `AppShell.tsx`). This plan removes the two Training routes from Social's list, adds a Social settings route that reuses the existing settings cards (API keys, Connected accounts, backup) plus More's quick-settings rows, and points Social's "connect accounts" links and the OAuth return page at the new route. Discover stays Training-only, so the Trend Radar's genre chips become plain chips.

**Tech Stack:** Next.js static export (App Router), React client components, Zustand store, Vitest unit tests, Playwright e2e (`phone` + `desktop` projects, `E2E_PORT`).

**Spec:** `planning/tools/20-per-world-settings.md`

## Global Constraints

- Dashboard copy: Hijazi Arabic first, English second; `messages/ar.json` and `messages/en.json` (and `messages/trends.{ar,en}.json`) keep key parity.
- Social chrome carries no emoji in titles (h1–h3), nav links, buttons, chips (`e2e/social-look.spec.ts` "no emoji" test).
- No new store fields, no migration: language, sound, Worker URL + token stay one shared value.
- Quality gates before push: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm e2e` (with `E2E_PORT` set, never port 3000).
- Commit per task; attribution line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: Social menu links only to Social

**Files:**
- Modify: `components/shell/nav.ts:46-92` (SOCIAL_NAV_ITEMS)
- Modify: `components/shell/MoreScreen.tsx:682-786` (SocialMore)
- Modify: `components/shell/AppShell.tsx:327` (SocialTop gear href)
- Modify: `components/shell/useWorld.ts:28-31` (comment)
- Test: `components/shell/nav.test.ts`

**Interfaces:**
- Produces: `SOCIAL_NAV_ITEMS` ends with `/social/replies`, `/social/automations`, `/social/settings` (desktopOnly). No `/discover`, no `/settings`.

- [ ] **Step 1: Update the unit test.** In `nav.test.ts` replace the "has one Discover shortcut…" and "hands Discover to the Training list…" tests with:

```ts
  it("links only to Social routes: Settings is /social/settings and there is no Discover shortcut", () => {
    for (const item of SOCIAL_NAV_ITEMS) expect(worldOf(item.href), item.href).toBe("social");
    const hrefs = SOCIAL_NAV_ITEMS.map((i) => i.href);
    expect(hrefs.slice(-3)).toEqual(["/social/replies", "/social/automations", "/social/settings"]);
    expect(SOCIAL_NAV_ITEMS.find((i) => i.href === "/social/settings")).toEqual({
      href: "/social/settings",
      icon: "⚙️",
      lucide: Settings,
      label: "nav.settings",
      desktopOnly: true,
    });
  });
```
Import `Settings` from lucide-react, drop `Search`. Rename "never marks Discover or Settings active…" to "every Social route activates a Social item" and add `"/social/settings/"` to `SOCIAL_PATHS`. Fix the header comment (round 31b note is gone).

- [ ] **Step 2: Run** `pnpm vitest run components/shell/nav.test.ts` → FAIL (Discover still listed).

- [ ] **Step 3: Edit `nav.ts`:** delete the `/discover` entry from `SOCIAL_NAV_ITEMS`; change the last entry's href to `/social/settings`; drop the `Search` import; rewrite the doc comment: "Every entry is a Social route (tools/20): the world comes from the URL, so a Social link never opens the Training shell."

- [ ] **Step 4: Edit `MoreScreen.tsx` SocialMore:** delete the `/discover` `ListRow` (and the `Search` import); the "all settings" row `href="/social/settings"`. Update the comment above `SocialMore`.

- [ ] **Step 5: Edit `AppShell.tsx` SocialTop:** gear `href="/social/settings"`.

- [ ] **Step 6: Edit `useWorld.ts`:** comment on `rememberSocialPath`: "A route outside Social is never remembered (defensive: every Social link is a Social route since tools/20)."

- [ ] **Step 7: Run** `pnpm vitest run components/shell/nav.test.ts` → PASS. `pnpm typecheck`.

- [ ] **Step 8: Commit** `Shell: Social menu links only to Social routes (tools/20)`.

---

### Task 2: Settings cards shared by both worlds

**Files:**
- Create: `components/settings/ApiKeysCard.tsx` (moved from `SettingsScreen.tsx:264-463`, plus `rows` prop)
- Create: `components/settings/DataCard.tsx` (moved from `SettingsScreen.tsx:46-87,180-230,249-258`)
- Modify: `components/settings/Card.tsx` (strip leading emoji in Social)
- Modify: `components/settings/SettingsScreen.tsx` (use the two cards, drop `ConnectedAccountsCard`)
- Modify: `lib/i18n.ts` (export `withoutEmoji`), `components/social/trends/TrendRow.tsx:13-15` (import it)

**Interfaces:**
- Produces: `ApiKeysCard({ rows = ["youtube", "scoutUrl", "scoutToken"] }: { rows?: readonly ApiKeyName[] })`, `DataCard()`, `withoutEmoji(label: string): string`.

- [ ] **Step 1: `lib/i18n.ts`:** add at the end
```ts
const LEADING_EMOJI = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|️|‍)+\s*/u;
/** A label without its leading emoji (Social chrome carries none, tools/18 §7); the label itself when it is only an emoji. */
export function withoutEmoji(label: string): string {
  return label.replace(LEADING_EMOJI, "") || label;
}
```
Copy `LEADING_EMOJI` verbatim from `TrendRow.tsx:13-14`, then make TrendRow import `withoutEmoji` from `@/lib/i18n` and delete its local copy.

- [ ] **Step 2: `Card.tsx`:** add `"use client"`, `import { useWorld } from "@/components/shell/useWorld"; import { withoutEmoji } from "@/lib/i18n";` and render `{useWorld() === "social" ? withoutEmoji(title) : title}`.

- [ ] **Step 3: `ApiKeysCard.tsx`:** move `ApiKeysCard`, `ApiKeyRow`, `RowStatus`, `TestResult`, `RowTest`, `SCOUT_README_URL`, `testYoutubeKey`, `testScoutToken` and their imports out of `SettingsScreen.tsx`; `export default function ApiKeysCard({ rows = ALL_ROWS }: { rows?: readonly ApiKeyName[] })` where `const ALL_ROWS = ["youtube", "scoutUrl", "scoutToken"] as const;` and each `<ApiKeyRow>` renders only when `rows.includes(name)`.

- [ ] **Step 4: `DataCard.tsx`:** move the export / import / reset handlers, `Pending`, `notice`, the file input, the buttons and the `ConfirmDialog` into `export default function DataCard()`. In Social strip the button emoji: `const plain = useWorld() === "social"; const label = (k: MessageKey) => (plain ? withoutEmoji(t(k)) : t(k));` for `settings.export`, `settings.import`, `settings.reset`.

- [ ] **Step 5: `SettingsScreen.tsx`:** render `<ApiKeysCard />` and `<DataCard />` in the old places; remove `<ConnectedAccountsCard />` and the moved code and now-unused imports.

- [ ] **Step 6: Run** `pnpm typecheck && pnpm lint && pnpm vitest run` → PASS. `pnpm e2e --project=desktop e2e/settings.spec.ts e2e/scout.spec.ts` (with `E2E_PORT`) → PASS.

- [ ] **Step 7: Commit** `Settings: API keys and backup cards in their own files; Training loses the accounts card`.

---

### Task 3: Social settings page

**Files:**
- Create: `app/social/settings/page.tsx`
- Create: `components/settings/SocialSettingsScreen.tsx`
- Modify: `components/shell/MoreScreen.tsx` (export `QuickSettingRows`)
- Modify: `components/settings/ConnectedAccountsCard.tsx` (emoji out), `messages/ar.json`, `messages/en.json` (`settings.accounts.title`, `.sync`, `.removeSeed` without emoji)

**Interfaces:**
- Consumes: `ApiKeysCard`, `DataCard`, `ConnectedAccountsCard`, `PageHeader`, `ListGroup`.
- Produces: `QuickSettingRows()` (two `ListRow`s: language segmented, sound switch; test ids `lang-ar`, `lang-en`, `sound-toggle`).

- [ ] **Step 1: `MoreScreen.tsx`:** cut the language and sound `ListRow`s out of `SocialMore` into `export function QuickSettingRows()` (same markup, same test ids); `SocialMore` renders `<QuickSettingRows />` before its settings row.

- [ ] **Step 2: `ConnectedAccountsCard.tsx`:** delete the inline `✍️ `, `📥 `, `💬 ` before the chip and button labels; keep the `🔑` warning line. In `messages/{ar,en}.json` drop the leading emoji from `settings.accounts.title`, `settings.accounts.sync`, `settings.accounts.removeSeed`.

- [ ] **Step 3: `SocialSettingsScreen.tsx`:**
```tsx
"use client";

import ApiKeysCard from "@/components/settings/ApiKeysCard";
import ConnectedAccountsCard from "@/components/settings/ConnectedAccountsCard";
import DataCard from "@/components/settings/DataCard";
import { QuickSettingRows } from "@/components/shell/MoreScreen";
import { ListGroup } from "@/components/ui/ios/List";
import PageHeader from "@/components/ui/ios/PageHeader";
import { useT } from "@/lib/i18n";

/**
 * Social settings (tools/20): the Social cards only, in the iOS look. Worker URL + token (the accounts card's "set the
 * Worker first" link lands on `#api-keys`), Connected accounts (`#accounts`, where Growth and the auto tools link and
 * where OAuth comes back), More's quick settings, and the backup. Language, sound and the Worker are the same values
 * Training uses: one store until the two worlds become separate sites.
 */
export default function SocialSettingsScreen() {
  const { t } = useT();
  return (
    <>
      <PageHeader title={t("settings.title")} sub={t("settings.sub")} testId="social-settings" />
      <ApiKeysCard rows={["scoutUrl", "scoutToken"]} />
      <ConnectedAccountsCard />
      <ListGroup header={t("more.quick")}>
        <QuickSettingRows />
      </ListGroup>
      <DataCard />
    </>
  );
}
```
and `app/social/settings/page.tsx` like `app/social/more/page.tsx` (`metadata.title = "الإعدادات · 3z Prod"`).

- [ ] **Step 4: Run** `pnpm typecheck && pnpm lint && pnpm build` → PASS; open `/social/settings/` in the e2e server (phone + desktop) and check: iOS look, no emoji in h2/buttons/chips, `#api-keys` and `#accounts` present.

- [ ] **Step 5: Commit** `Social: own Settings page at /social/settings (tools/20)`.

---

### Task 4: Social links stay in Social; genre chips plain

**Files:**
- Modify: `components/social/AutoPostScreen.tsx:126`, `AutoRepliesScreen.tsx:139`, `calendar/AutoPostTab.tsx:149`, `growth/TikTokBrief.tsx:58`, `GrowthScreen.tsx:160`, `trends/TrendRadar.tsx:129,204` (`/settings…` → `/social/settings…`)
- Modify: `components/social/useSocialSync.ts:168-171` (`connectReturnTo` → `/social/settings/`)
- Modify: `components/social/trends/TrendRow.tsx:46,124-140` (drop `genreHref`), `lib/trends.ts:233-241` (drop `trendGenreHref`), `lib/trends.test.ts:298-341`, `messages/trends.{ar,en}.json` (`trends.genreOpen` out)

- [ ] **Step 1:** replace `"/settings/#accounts"` with `"/social/settings/#accounts"` and `"/settings#accounts"` with `"/social/settings#accounts"` in `AutoPostScreen.tsx`, `AutoRepliesScreen.tsx`, `calendar/AutoPostTab.tsx`, `growth/TikTokBrief.tsx`, `GrowthScreen.tsx`; TrendRadar's `href="/settings/"` → `href="/social/settings/"`; `connectReturnTo` returns `withBasePath("/social/settings/")` and its comment says Social settings.

- [ ] **Step 2:** `TrendRow.tsx`: remove the `genreHref` prop and the `Link` branch so the chip is always the plain `<span className="px-chip" … data-testid="trend-genre" data-genre={item.genre}>{genre}</span>`; drop the `Link` import if unused. `TrendRadar.tsx`: remove `genreHref=…` and the `trendGenreHref` import. `lib/trends.ts`: delete `trendGenreHref` and the `discoverGenreHref` import. `lib/trends.test.ts`: delete the `trendGenreHref` describe block and its imports. Delete `trends.genreOpen` from both `messages/trends.*.json`.

- [ ] **Step 3: Run** `pnpm typecheck && pnpm lint && pnpm vitest run` → PASS.

- [ ] **Step 4: Commit** `Social: connect links and OAuth return go to /social/settings; trend genre chips are plain`.

---

### Task 5: e2e specs follow

**Files:**
- Modify: `e2e/world.spec.ts`, `e2e/social-look.spec.ts`, `e2e/accounts.spec.ts`, `e2e/autopost.spec.ts:142-150`, `e2e/autoreplies.spec.ts:185-201`, `e2e/trends.spec.ts`

- [ ] **Step 1: `world.spec.ts`:** add `"/social/settings/"` to `SOCIAL_PATHS`; in "Social More lists…" drop `more-discover`, assert `more-settings` href `/social/settings/`; replace the two Discover tests (lines 120-183) with:
```ts
test("Social stays Social: Settings opens /social/settings in the Social look, and nothing links to Training routes", async ({
  page,
  isMobile,
}) => {
  await freshState(page, "/social/growth/");
  await expect(page.getByTestId("growth-screen")).toBeVisible();
  const nav = page.getByTestId(isMobile ? "tabbar" : "sidenav");
  for (const href of ["/discover/", "/settings/"]) {
    await expect(nav.locator(`a[href="${href}"]`)).toHaveCount(0);
  }
  if (isMobile) {
    await nav.locator('a[href="/social/more/"]').click();
    await expect(page.getByTestId("more-discover")).toHaveCount(0);
    await page.getByTestId("more-settings").click();
  } else {
    await nav.locator('a[href="/social/settings/"]').click();
  }
  await expect(page).toHaveURL(/\/social\/settings\/$/);
  await expect(page.locator("html")).toHaveAttribute("data-world", "social");
  await expect(page.getByTestId("social-settings")).toBeVisible();
  await expect(page.locator("#accounts")).toHaveCount(1);
  await expect(page.locator("#api-keys")).toHaveCount(1);
  await expect(page.getByTestId("apikey-youtube")).toHaveCount(0);
  await expect(page.getByTestId("gear-list")).toHaveCount(0);
  if (!isMobile) {
    await expect(nav.locator('a[href="/social/settings/"]')).toHaveAttribute("aria-current", "page");
  }
  // The gear in the top bar goes to the same page, and the world switch still remembers it.
  await page.goto("/social/");
  await page.getByTestId("social-top").locator('a[href="/social/settings/"]').click();
  await expect(page).toHaveURL(/\/social\/settings\/$/);
  await page.getByTestId("world-training").click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByTestId("world-social").click();
  await expect(page).toHaveURL(/\/social\/settings\/$/);
});
```
Line 53's comment: "Discover is a Training tab: Social has no link to it (tools/20)."

- [ ] **Step 2: `social-look.spec.ts`:** add `"/social/settings/"` to `SOCIAL_PATHS`.

- [ ] **Step 3: `accounts.spec.ts`:** every `"/settings/"` → `"/social/settings/"`, `"/settings/#accounts"` → `"/social/settings/#accounts"`, the `returnTo` regex → `/^http:\/\/localhost:\d+\/social\/settings\/$/`, `u.pathname.endsWith("/social/settings/")`, test title "…keeps its key emoji in Settings, the Training look" → "…keeps its key line in Social settings". **`autopost.spec.ts` + `autoreplies.spec.ts`:** `connectWorker` opens `/social/settings/` (and the `freshState(page, "/settings/")` calls before it → `/social/settings/`).

- [ ] **Step 4: `trends.spec.ts`:** genre chips: replace every `toHaveAttribute("href", "/discover/?genre=…")` with `not.toHaveAttribute("href")`, delete the `getByRole("link", { name: "افتح … في «اكتشف»" })` / `"Open Cars in Discover"` assertions and the test(s) that click a chip and expect `DISCOVER_URL` (lines ~555-575, ~640-650: assert the chip is a plain span instead). Drop `DISCOVER_URL` if unused.

- [ ] **Step 5: Run** (with `E2E_PORT=<free port>`) `pnpm e2e e2e/world.spec.ts e2e/social-look.spec.ts e2e/accounts.spec.ts e2e/autopost.spec.ts e2e/autoreplies.spec.ts e2e/trends.spec.ts` → PASS on both projects.

- [ ] **Step 6: Commit** `e2e: Social settings page, Social-only menu, plain genre chips`.

---

### Task 6: Docs, gates, review, PR

**Files:**
- Modify: `planning/tools/18-social-ios-design.md:43-44,278,348`, `planning/master-plan.md` (one line after round 35 shipped)

- [ ] **Step 1:** tools/18: §2 "Out" → "Settings opened from Social: done in tools/20 (`/social/settings`); Discover stays Training"; §6 line 278 and §12 line 348 → "done, tools/20". Master plan after line 590: "Round 36 (Oct 23, 2026): each world on its own — Social menu links only to Social, `/social/settings` in the iOS look, Discover stays Training (`tools/20-per-world-settings.md`)."

- [ ] **Step 2: Gates:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, then `pnpm e2e` (full, `E2E_PORT`) → all PASS.

- [ ] **Step 3: Review:** dispatch one reviewer subagent on `git diff main...HEAD`; fix findings.

- [ ] **Step 4: Commit** `Planning: tools/18 follow-up done, master plan round 36`; push; open PR "Social: own menu and settings per world (tools/20)".
