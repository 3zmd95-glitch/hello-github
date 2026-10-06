# Social world iOS 26 look — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the 📱 Social world (every route under `/social`) the approved iOS 26 look: glass navigation layer, solid
cards, light + dark following the phone, Vazirmatn, Lucide icons, and the spring motion system, while the 🎮 Training
world stays pixel-identical.

**Architecture:** The `[data-world="social"]` token block in `app/globals.css` is rewritten with light and dark values
(same token names, so every `.px-*` class and Tailwind color utility restyles on its own) plus new glass, tint and
motion tokens. A small primitive set in `components/ui/ios/` (PageHeader, Card, ListGroup/ListRow, Segmented, Switch,
Sheet on vaul, Chip, StatTile, PlatformBadge, EmptyState) and five hooks carry the behaviors; the shell gets Social
variants of the top area, tab bar and sidebar; then each Social screen moves onto the primitives, one PR per phase.
The approved interactive mockup `planning/social-ios-mockup.html` is the visual and motion reference for every task.

**Tech Stack:** Next.js 16 App Router (static export), React 19, TypeScript strict, Tailwind v4 (`@theme inline`),
zustand, Vitest + jsdom, Playwright (phone = iPhone 14 on Chromium, desktop). New: `lucide-react`, `vaul`.

**Spec:** `planning/tools/18-social-ios-design.md` (read it first; this plan argues from it). Mockup:
`planning/social-ios-mockup.html` (open it in a browser; live copy https://claude.ai/artifact/H7TN2Yh1gA3ZkabVpGj28f).

## Global Constraints

- **Training is untouched.** No change to the `:root` / `:root[data-world="training"]` tokens, to `components/today`,
  `components/map`, `components/skills` or any Training route. Shared files (shell, `ConfirmDialog`, `CelebrationProvider`,
  `globals.css`) change only inside `[data-world="social"]` selectors or behind `world === "social"` branches.
- Only two new dependencies: `lucide-react` and `vaul` (pinned). No animation library, no UI kit.
- Every animation runs on `transform` or `opacity` (never `width`, `height`, `padding`, `blur`). Every duration comes
  from the tokens `--t-fast` 160ms · `--t-med` 320ms · `--t-spring` 500ms; `prefers-reduced-motion: reduce` zeroes them.
- Glass (`.glass`, `.slab`) only on: top slab, world capsule, gear button, tab bar, Calendar "+" button, toasts, pull
  spinner, chart tooltip. Never on cards, lists, sheets or content buttons. At most three on screen.
- Text floor 11px; tap targets ≥ 44px; contrast ≥ 4.5:1 for text ≤ 18px in both schemes (tokens in the spec §3.1 were
  checked; do not invent new colors, use the tokens).
- Logical CSS only (`inset-inline-start`, `margin-inline-start`, `ps-`/`pe-`/`ms-`/`me-`). Forward chevron is
  `ChevronLeft` (RTL). Charts keep an LTR time axis. Numbers: Western digits, `tabular-nums`, `.num`.
- Dashboard copy: friendly Hijazi Arabic first, English second; every key exists in both `*.ar.json` and `*.en.json`
  (`messages/messages.test.ts` enforces parity and placeholders). Wording does not change in this plan, only emoji go.
- Test contracts that must keep working are listed in the spec §8 (class names `.studio-wday`, `.post-card` with the
  open button first, `role="switch"`, `<summary>`, SVG charts, data-testids). Keep them.
- Quality gates before any push: `pnpm.cmd lint`, `pnpm.cmd typecheck`, `pnpm.cmd test`, `pnpm.cmd build`,
  `E2E_PORT=3141 pnpm.cmd e2e`. On this Windows machine run pnpm as `pnpm.cmd` from Git Bash (`pnpm.ps1` is blocked).
  Never use port 3000 or the primary checkout (another agent uses them); work in this worktree.
- Branching: one branch and one PR per phase, from the latest `origin/main`: `claude/social-ios-1-foundations`,
  `claude/social-ios-2-shell`, … `claude/social-ios-8-sweep`. The owner merges each PR before the next phase starts.
- Executing agents run on Opus 5.5 (owner's instruction, round 35). Commits end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (the executing model's own trailer).
- After each phase: screenshots of every touched route on the phone project in light and dark go into the PR
  description (Playwright `page.screenshot` into `test-results/look/`), and the owner checks on his iPhone.

## File map

| File | Responsibility |
| --- | --- |
| `app/globals.css` (modify, Social block only) | light + dark tokens, glass, motion tokens, `ios-*` component classes, `.px-*` Social overrides, Alert and toast Social styles |
| `app/layout.tsx` (modify) | Vazirmatn in `FONTS_CSS`; later drop IBM Plex |
| `lib/motion.ts` (new) | pure helpers: `prefersReducedMotion`, `easeOutCubic`, `rubberBand`, `clamp01` |
| `lib/motion.test.ts` (new) | tests for the helpers |
| `lib/platformIcons.tsx` (new) | simple-icons paths + `PlatformGlyph` |
| `components/ui/ios/chrome.ts` (new) | zustand slice: page title for the compact bar |
| `components/ui/ios/PageHeader.tsx` (new) | large title + eyebrow + registers the compact title |
| `components/ui/ios/Card.tsx` (new) | solid card (`pressable`, `hero`) |
| `components/ui/ios/List.tsx` (new) | `ListGroup`, `ListRow` |
| `components/ui/ios/Segmented.tsx` (new) | equal-width segmented control, spring thumb, arrow keys |
| `components/ui/ios/Switch.tsx` (new) | native checkbox `role="switch"` styled |
| `components/ui/ios/Chip.tsx` (new) | pill chip, tones |
| `components/ui/ios/StatTile.tsx` (new) | label / value / delta, count-up |
| `components/ui/ios/PlatformBadge.tsx` (new) | brand glyph on platform color |
| `components/ui/ios/EmptyState.tsx` (new) | icon, title, hint, action |
| `components/ui/ios/Sheet.tsx` (new) | vaul drawer with two detents, back closes |
| `components/ui/ios/useCountUp.ts` (new) | count-up hook |
| `components/ui/ios/useScrollChrome.ts` (new) | writes `--scroll-p`, `data-compact`, `data-tabbar` |
| `components/ui/ios/usePullToRefresh.ts` (new) | window-level pull on the Studio |
| `components/ui/ios/useSwipeAction.ts` (new) | leading swipe on a row |
| `components/ui/ios/Segmented.test.tsx`, `Switch.test.tsx`, `useCountUp.test.ts` (new) | unit tests |
| `components/ui/ConfirmDialog.tsx` (modify) | class hooks for the iOS alert style |
| `components/celebrate/CelebrationProvider.tsx` (modify) | Social toast class |
| `components/shell/nav.ts`, `nav.test.ts` (modify) | `lucide` icon per Social item |
| `components/shell/AppShell.tsx` (modify) | Social top area, tab bar, sidebar, scroll chrome, launch, theme-color |
| `components/shell/WorldSwitch.tsx` (modify) | glass capsule with icons in Social |
| `components/shell/MoreScreen.tsx` (modify) | language segmented + sound switch rows in Social |
| `components/social/StudioScreen.tsx` + `studio/*` (modify) | phase 3 |
| `components/social/CalendarScreen.tsx` + `calendar/*` (modify) | phase 4 |
| `components/skills/SkillSheet.tsx:68` (modify) | drop `md:rounded-[2px]` leftover in Social |
| `components/social/GrowthScreen.tsx` + `growth/*` (modify) | phase 5 |
| `components/social/IdeasScreen.tsx` + `ideas/*`, `trends/*` (modify) | phase 6 |
| `components/social/AutoRepliesScreen.tsx` + `replies/*`, `AutoPostScreen.tsx`, `SoonScreen.tsx` (modify) | phase 7 |
| `lib/social.ts` (modify) | `glyph` on `PLATFORM_META`, colors from tokens |
| `messages/{social,publish,ideas,calendar,trends,replies,growth}.{ar,en}.json`, `messages/{ar,en}.json` (modify) | emoji sweep |
| `scripts/strip-emoji.mjs` (new, one-off) | the sweep script |
| `e2e/social-look.spec.ts` (new), `e2e/world.spec.ts`, `e2e/calendar.spec.ts`, `e2e/autopost.spec.ts` (modify) | tests |
| `planning/tools/18-social-ios-design.md`, `planning/master-plan.md` (modify at the end) | status |

---

# Phase 1 — Foundations (branch `claude/social-ios-1-foundations`)

### Task 1.1: Dependencies

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`

**Interfaces:**
- Produces: `lucide-react` icons (`import { Clapperboard } from "lucide-react"`), `vaul` (`import { Drawer } from "vaul"`).

- [ ] **Step 1: Add the two packages, pinned**

Run: `pnpm.cmd add lucide-react@latest vaul@latest` then open `package.json` and replace the `^` on both with the exact
version installed (e.g. `"lucide-react": "0.5xx.0"`, `"vaul": "1.1.2"`).

- [ ] **Step 2: Verify the build still passes with the new modules importable**

Run: `pnpm.cmd typecheck && pnpm.cmd build`
Expected: both succeed; bundle size unchanged (nothing imports them yet).

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add lucide-react and vaul for the Social iOS look"
```

### Task 1.2: Vazirmatn

**Files:**
- Modify: `app/layout.tsx:9-10` (`FONTS_CSS`)
- Modify: `app/globals.css` (Social `--font-body`, in the token block rewritten in Task 1.3 — set it here first)
- Test: `e2e/world.spec.ts:57`

- [ ] **Step 1: Change the test expectation first**

In `e2e/world.spec.ts` replace `expect(await bodyFont(page)).toContain("IBM Plex Sans Arabic");` with
`expect(await bodyFont(page)).toContain("Vazirmatn");` and the comment above it with
`// iOS look: rounded cards and Vazirmatn.`

- [ ] **Step 2: Run it to see it fail**

Run: `E2E_PORT=3141 pnpm.cmd e2e e2e/world.spec.ts --project=phone -g "restyles the shell"`
Expected: FAIL on the font assertion.

- [ ] **Step 3: Load the font and use it in Social**

In `app/layout.tsx` set:

```ts
// Training: Baloo Bhaijaan 2 + Pixelify Sans. Social: Vazirmatn (round 35). Plex stays until phase 8 removes its last use.
const FONTS_CSS =
  "https://fonts.googleapis.com/css2?family=Baloo+Bhaijaan+2:wght@400;600;800&family=Pixelify+Sans:wght@400;700&family=IBM+Plex+Sans+Arabic:wght@400;600;700&family=Vazirmatn:wght@400;500;600;700&display=swap";
```

In `app/globals.css`, inside `:root[data-world="social"] { … }` replace the `--font-body` line with:

```css
  --font-body: "Vazirmatn", -apple-system, "SF Arabic", "Segoe UI", system-ui, sans-serif;
```

- [ ] **Step 4: Run the test again**

Run: `E2E_PORT=3141 pnpm.cmd e2e e2e/world.spec.ts --project=phone -g "restyles the shell"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/layout.tsx app/globals.css e2e/world.spec.ts
git commit -m "feat(social): Vazirmatn as the Social body font"
```

### Task 1.3: Light + dark tokens, glass and motion tokens

**Files:**
- Modify: `app/globals.css` — the block starting at `/* ---- Social world ---- */` (`:root[data-world="social"] { … }`)
  and the `@theme inline` block near the top (add the new colors so Tailwind utilities exist).
- Test: `e2e/social-look.spec.ts` (new, first version)

**Interfaces:**
- Produces CSS custom properties on `[data-world="social"]`: all existing names plus `--fill`, `--hair`, `--tint`,
  `--tint-bg`, `--warn`, `--warn-bg`, `--pc-tiktok` … `--pc-threads`, `--glass-bg`, `--glass-blur`, `--glass-rim`,
  `--glass-hi`, `--glass-spec`, `--glass-shadow`, `--lens`, `--lens-shadow`, `--spring`, `--out`, `--t-fast`,
  `--t-med`, `--t-spring`.
- Produces Tailwind utilities: `bg-tint`, `text-tint`, `bg-tint-bg`, `text-warn`, `bg-warn-bg`, `bg-fill`, `border-hair`.

- [ ] **Step 1: Write the failing e2e (light and dark page background, font, no horizontal scroll)**

Create `e2e/social-look.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { freshState } from "./helpers";

const SOCIAL_PATHS = [
  "/social/",
  "/social/calendar/",
  "/social/growth/",
  "/social/ideas/",
  "/social/website/",
  "/social/business/",
  "/social/automations/",
  "/social/replies/",
  "/social/more/",
];

// Spec §3.1: --bg per scheme.
const BG = { light: "rgb(242, 243, 246)", dark: "rgb(11, 13, 16)" } as const;

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} scheme`, () => {
    test.use({ colorScheme: scheme });
    for (const path of SOCIAL_PATHS) {
      test(`${path} uses the iOS tokens and fits the screen`, async ({ page }) => {
        await freshState(page, path);
        await expect(page.locator("html")).toHaveAttribute("data-world", "social");
        const css = await page.evaluate(() => {
          const s = getComputedStyle(document.body);
          return { font: s.fontFamily, bg: s.backgroundColor };
        });
        expect(css.font).toContain("Vazirmatn");
        expect(css.bg).toBe(BG[scheme]);
        const fits = await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        );
        expect(fits).toBe(true);
      });
    }
  });
}

test("Training keeps the pixel look", async ({ page }) => {
  await freshState(page, "/");
  await expect(page.locator("html")).toHaveAttribute("data-world", "training");
  const css = await page.evaluate(() => {
    const card = document.querySelector(".px-card") as HTMLElement;
    return {
      font: getComputedStyle(document.body).fontFamily,
      radius: parseFloat(getComputedStyle(card).borderRadius),
      border: parseFloat(getComputedStyle(card).borderTopWidth),
    };
  });
  expect(css.font).toContain("Baloo Bhaijaan 2");
  expect(css.radius).toBe(2);
  expect(css.border).toBe(3);
});
```

- [ ] **Step 2: Run it to see the light-scheme assertions fail**

Run: `E2E_PORT=3141 pnpm.cmd e2e e2e/social-look.spec.ts --project=phone`
Expected: light-scheme tests FAIL (`rgb(11, 13, 16)` today for both schemes), Training test PASS.

- [ ] **Step 3: Replace the Social token block**

In `app/globals.css` replace the whole `:root[data-world="social"] { … }` rule (the one that starts with
`color-scheme: dark; --radius: 14px;`) with:

```css
/* 📱 Social = iOS 26 look (round 35, tools/18): glass navigation layer, solid cards, light + dark following the
 * phone, Vazirmatn, Lucide icons, spring motion. Same token names as Training so every `.px-*` class and color
 * utility restyles on its own; the new tokens below are Social-only. Dark values live in the media query after it. */
:root[data-world="social"] {
  color-scheme: light dark;
  --radius: 22px;
  --radius-sm: 14px;
  --bg: #f2f3f6;
  --bg-dot: transparent;
  --panel: #ffffff;
  --panel-2: #f2f3f6;
  --panel-3: #e4e7ec;
  --fill: var(--panel-3);
  --edge: rgba(16, 22, 30, 0.1);
  --hair: var(--edge);
  --ink: #0b0d10;
  --ink-2: #555d69;
  --muted: #6b7482;
  --accent: #45e08e;
  --accent-ink: #06130d;
  --tint: #0f7a47;
  --tint-bg: rgba(18, 138, 81, 0.12);
  --sky: var(--tint);
  --gold: #9a5b00;
  --gold-ink: #ffffff;
  --orange: var(--gold);
  --warn: var(--gold);
  --warn-bg: rgba(184, 110, 0, 0.12);
  --danger: #d4342c;
  --pc-tiktok: #fe2c55;
  --pc-instagram: #e1306c;
  --pc-youtube: #e60000;
  --pc-snapchat: #e6c700;
  --pc-x: var(--ink);
  --pc-threads: var(--ink);
  --shadow: 0 1px 1px rgba(16, 24, 32, 0.03), 0 8px 24px rgba(16, 24, 32, 0.05);
  --shadow-sm: 0 1px 3px rgba(16, 24, 32, 0.08);
  --glass-bg: rgba(255, 255, 255, 0.66);
  --glass-blur: 22px;
  --glass-rim: rgba(255, 255, 255, 0.95);
  --glass-hi: rgba(255, 255, 255, 0.9);
  --glass-spec: rgba(255, 255, 255, 0.55);
  --glass-shadow: 0 10px 30px rgba(16, 24, 32, 0.1), 0 0 0 0.5px rgba(16, 24, 32, 0.08);
  --lens: rgba(255, 255, 255, 0.92);
  --lens-shadow: 0 2px 8px rgba(16, 24, 32, 0.14), inset 0 0 0 0.5px #fff;
  --spring: cubic-bezier(0.34, 1.3, 0.64, 1);
  --out: cubic-bezier(0.2, 0.8, 0.2, 1);
  --t-fast: 0.16s;
  --t-med: 0.32s;
  --t-spring: 0.5s;
  --font-body: "Vazirmatn", -apple-system, "SF Arabic", "Segoe UI", system-ui, sans-serif;
}
@supports (transition-timing-function: linear(0, 1)) {
  :root[data-world="social"] {
    --spring: linear(
      0, 0.004 0.8%, 0.019 1.7%, 0.073 3.5%, 0.164 5.5%, 0.309 8%, 0.484 10.6%, 0.671 13.4%, 0.834 16.2%,
      0.955 18.9%, 1.036 21.8%, 1.08 24.7%, 1.094 27.5%, 1.083 30.5%, 1.059 33.8%, 1.028 37.6%, 1.002 41.9%,
      0.99 46%, 0.987 51.7%, 1 71.1%, 1
    );
  }
}
@media (prefers-color-scheme: dark) {
  :root[data-world="social"] {
    --bg: #0b0d10;
    --panel: #15181e;
    --panel-2: #1c2027;
    --panel-3: #262b34;
    --edge: rgba(255, 255, 255, 0.08);
    --ink: #f2f4f7;
    --ink-2: #a9b1bc;
    --muted: #8b94a1;
    --tint: #5be59f;
    --tint-bg: rgba(69, 224, 142, 0.15);
    --gold: #ffb75a;
    --gold-ink: #1e1606;
    --warn-bg: rgba(255, 183, 90, 0.14);
    --danger: #ff6b6b;
    --pc-snapchat: #fffc00;
    --shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03), 0 10px 30px rgba(0, 0, 0, 0.35);
    --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.35);
    --glass-bg: rgba(24, 28, 34, 0.58);
    --glass-rim: rgba(255, 255, 255, 0.12);
    --glass-hi: rgba(255, 255, 255, 0.08);
    --glass-spec: rgba(255, 255, 255, 0.1);
    --glass-shadow: 0 12px 40px rgba(0, 0, 0, 0.55), 0 0 0 0.5px rgba(255, 255, 255, 0.06);
    --lens: rgba(255, 255, 255, 0.14);
    --lens-shadow: inset 0 0 0 0.5px rgba(255, 255, 255, 0.18), 0 2px 10px rgba(0, 0, 0, 0.35);
  }
}
@media (prefers-reduced-motion: reduce) {
  :root[data-world="social"] {
    --t-fast: 0s;
    --t-med: 0s;
    --t-spring: 0s;
  }
}
```

`--fill`, `--hair`, `--warn`, `--orange`, `--sky` are aliases (`var(--…)`), so the dark block only redefines base tokens.

- [ ] **Step 4: Expose the new colors to Tailwind**

In the `@theme inline { … }` block at the top of `app/globals.css` add, after `--color-orange: var(--orange);`:

```css
  --color-tint: var(--tint, var(--sky));
  --color-tint-bg: var(--tint-bg, transparent);
  --color-warn: var(--warn, var(--gold));
  --color-warn-bg: var(--warn-bg, transparent);
  --color-fill: var(--fill, var(--panel-3));
  --color-hair: var(--hair, var(--edge));
```

(The fallbacks keep the utilities meaningful in Training, which never defines the new names.)

- [ ] **Step 5: Replace the Social `body` background rule**

In the `@layer base` block that contains `[data-world="social"] body { background-image: radial-gradient(…) }` replace
that rule with:

```css
  [data-world="social"] body {
    background-image: none;
    background-color: var(--bg);
    transition: background-color var(--t-med) var(--out);
  }
```

- [ ] **Step 6: Run the e2e again**

Run: `E2E_PORT=3141 pnpm.cmd e2e e2e/social-look.spec.ts --project=phone`
Expected: all PASS (light `rgb(242, 243, 246)`, dark `rgb(11, 13, 16)`, Training unchanged).

- [ ] **Step 7: Run the existing Social suites to catch regressions**

Run: `E2E_PORT=3141 pnpm.cmd e2e --project=phone e2e/world.spec.ts e2e/studio.spec.ts e2e/calendar.spec.ts e2e/growth.spec.ts`
Expected: PASS (they check behavior, not colors).

- [ ] **Step 8: Commit**

```bash
git add app/globals.css e2e/social-look.spec.ts
git commit -m "feat(social): light + dark iOS tokens, glass and motion tokens"
```

### Task 1.4: `.px-*` Social overrides and the `ios-*` component classes

**Files:**
- Modify: `app/globals.css` — replace the Social `@layer components { [data-world="social"] .px-… }` block and the Social
  `@layer base` / motion overrides (everything between `/* ---- Social world ---- */` and `/* ---- /Social world ---- */`
  except the token rules written in Task 1.3) with the CSS below. Keep the `[data-world="social"] .num` utility.

**Interfaces:**
- Produces classes used by every later task: `.glass`, `.slab`, `.ios-lt`, `.ios-eyebrow`, `.ios-card`, `.ios-hero`,
  `.ios-list`, `.ios-row`, `.ios-ic` (+ `.warn`, `.fill`), `.ios-tx`, `.ios-gh`, `.ios-chip` (+ `.tint`, `.warn`),
  `.ios-seg`, `.ios-seg-thumb`, `.ios-switch`, `.ios-stat`, `.ios-delta`, `.ios-pressable`, `.ios-fab`, `.ios-ptr`,
  `.ios-toast`, `.ios-alert`, `.ios-stagger`, keyframes `ios-up`, `ios-pin`, `ios-pout`, `ios-pop`, `ios-spin`,
  `ios-drift`.

- [ ] **Step 1: Write the CSS**

```css
/* ---- Social world: component skin (round 35, tools/18 §3.3–3.5; the mockup is the reference) ---- */
@layer base {
  [data-world="social"] :is(h1, h2, h3) {
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  [data-world="social"] :where(button, a, summary, input, select, textarea):focus-visible {
    outline: 2px solid var(--tint);
    outline-offset: 2px;
  }
  [data-world="social"] a {
    color: var(--tint);
  }
  @supports (corner-shape: squircle) {
    [data-world="social"] :is(.px-card, .px-inset, .ios-card, .ios-list, .ios-ic, .ios-stat, .ios-seg, .ios-sheet) {
      corner-shape: squircle;
    }
  }
}

@layer components {
  /* Glass: navigation layer only (spec §3.4). */
  [data-world="social"] .glass {
    position: relative;
    background: var(--glass-bg);
    -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(180%);
    backdrop-filter: blur(var(--glass-blur)) saturate(180%);
    box-shadow: var(--glass-shadow), inset 0 1px 0 var(--glass-hi), inset 0 0 0 0.5px var(--glass-rim);
  }
  [data-world="social"] .glass::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    background: linear-gradient(180deg, var(--glass-spec), transparent 45%);
  }
  [data-world="social"] .slab {
    background: var(--glass-bg);
    -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(180%);
    backdrop-filter: blur(var(--glass-blur)) saturate(180%);
    box-shadow: 0 0.5px 0 var(--hair);
  }
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    [data-world="social"] :is(.glass, .slab) {
      background: var(--panel);
    }
  }
  @media (prefers-reduced-transparency: reduce) {
    [data-world="social"] :is(.glass, .slab) {
      background: var(--panel);
      -webkit-backdrop-filter: none;
      backdrop-filter: none;
    }
    [data-world="social"] .glass::before {
      display: none;
    }
  }

  /* Existing pixel classes, restyled (spec §5: screens migrate one by one). */
  [data-world="social"] .px-card {
    border: 0;
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 16px;
  }
  [data-world="social"] .px-inset {
    border: 0;
    border-radius: 16px;
    background: var(--panel-2);
    padding: 12px 14px;
  }
  [data-world="social"] .px-btn {
    border: 0;
    border-radius: 999px;
    box-shadow: none;
    min-height: 44px;
    padding: 0 18px;
    font-weight: 600;
    font-size: 15px;
    transition:
      transform var(--t-fast) var(--out),
      opacity var(--t-fast) var(--out),
      background-color var(--t-fast) var(--out);
  }
  [data-world="social"] .px-btn:active:not(:disabled) {
    transform: scale(0.97);
    box-shadow: none;
  }
  [data-world="social"] .px-btn-ghost {
    background: var(--tint-bg);
    color: var(--tint);
  }
  [data-world="social"] .px-btn-gold {
    background: var(--warn-bg);
    color: var(--warn);
  }
  [data-world="social"] .px-btn-danger {
    background: var(--danger);
    color: #fff;
  }
  [data-world="social"] .px-btn-sm {
    min-height: 34px;
    padding: 0 12px;
    font-size: 13px;
  }
  [data-world="social"] .px-chip {
    border: 0;
    border-radius: 999px;
    height: 24px;
    padding: 0 9px;
    background: var(--fill);
    color: var(--ink-2);
    font-size: 12px;
    font-weight: 600;
  }
  [data-world="social"] :is(.px-chip-green, .px-chip-t1) {
    background: var(--tint-bg);
    color: var(--tint);
  }
  [data-world="social"] :is(.px-chip-gold, .px-chip-t2) {
    background: var(--warn-bg);
    color: var(--warn);
  }
  [data-world="social"] .px-chip-t3 {
    background: color-mix(in srgb, var(--danger) 14%, transparent);
    color: var(--danger);
  }
  [data-world="social"] .px-chip-lock {
    border: 0;
    background: var(--fill);
    color: var(--muted);
  }
  [data-world="social"] .px-bar {
    height: 8px;
    border: 0;
    border-radius: 999px;
    background: var(--fill);
  }
  [data-world="social"] .px-bar > i {
    background: var(--c, var(--accent));
    border-radius: 999px;
    transition: width var(--t-spring) var(--out);
  }
  [data-world="social"] .px-bar-sm {
    height: 6px;
  }
  [data-world="social"] .px-input {
    background: var(--panel-2);
    border: 0;
    border-radius: 14px;
    padding: 11px 14px;
    color: var(--ink);
  }
  [data-world="social"] .px-input:focus-visible {
    outline: 2px solid var(--tint);
    outline-offset: 0;
  }
  [data-world="social"] .px-check {
    border: 0;
    border-radius: 8px;
    box-shadow: none;
    background: var(--fill);
    font-family: var(--font-body);
    transition: background-color var(--t-fast) var(--out), transform var(--t-fast) var(--out);
  }
  [data-world="social"] .px-check:active {
    transform: scale(0.9);
  }
  [data-world="social"] .px-pip {
    border: 0;
    border-radius: 999px;
    background: var(--fill);
  }
  [data-world="social"] .px-fchip {
    border: 0;
    border-radius: 999px;
    min-height: 34px;
    padding: 0 13px;
    background: var(--panel);
    color: var(--ink-2);
    box-shadow: var(--shadow-sm);
    transition:
      background-color var(--t-med) var(--out),
      color var(--t-med) var(--out),
      transform var(--t-fast) var(--out);
  }
  [data-world="social"] .px-fchip[aria-pressed="true"] {
    background: var(--ink);
    color: var(--bg);
  }
  [data-world="social"] .px-fchip:active {
    transform: scale(0.95);
  }
  [data-world="social"] .px-tile {
    background-image: none;
  }
  [data-world="social"] .px-skel {
    border-radius: 8px;
    animation-timing-function: ease-in-out;
  }
  [data-world="social"] .px-link {
    color: var(--tint);
    text-decoration: none;
    font-weight: 600;
  }

  /* Page header: large title that fades and shrinks with --scroll-p (written by the shell, Task 2.2). */
  .ios-lt {
    padding: 4px 4px 14px;
  }
  .ios-eyebrow {
    display: block;
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
    margin-bottom: 2px;
  }
  .ios-lt h1 {
    font-size: 34px;
    line-height: 1.15;
    font-weight: 700;
    letter-spacing: -0.015em;
    text-wrap: balance;
    transform-origin: 100% 0;
    opacity: calc(1 - var(--scroll-p, 0));
    transform: translateY(calc(var(--scroll-p, 0) * -6px)) scale(calc(1 - var(--scroll-p, 0) * 0.06));
  }
  [dir="ltr"] .ios-lt h1 {
    transform-origin: 0 0;
  }
  .ios-lt p {
    margin-top: 4px;
    color: var(--ink-2);
    font-size: 15px;
    opacity: calc(1 - var(--scroll-p, 0) * 1.4);
  }

  /* Cards, lists, rows. */
  .ios-card {
    position: relative;
    background: var(--panel);
    border-radius: var(--radius);
    padding: 16px;
    box-shadow: var(--shadow);
    min-width: 0;
  }
  .ios-hero {
    overflow: hidden;
  }
  .ios-hero::before {
    content: "";
    position: absolute;
    inset: -40%;
    pointer-events: none;
    background:
      radial-gradient(closest-side at 72% 28%, color-mix(in srgb, var(--accent) 26%, transparent), transparent 72%),
      radial-gradient(closest-side at 22% 85%, color-mix(in srgb, var(--pc-tiktok) 9%, transparent), transparent 70%);
    animation: ios-drift 16s ease-in-out infinite alternate;
  }
  .ios-hero > * {
    position: relative;
    z-index: 1;
  }
  .ios-list {
    background: var(--panel);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    overflow: hidden;
  }
  .ios-row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: 58px;
    padding: 11px 16px;
    text-align: start;
    color: inherit;
    text-decoration: none;
    transition: background-color var(--t-fast) var(--out);
  }
  .ios-row + .ios-row::before,
  .ios-swipe + .ios-swipe > .ios-row::before {
    content: "";
    position: absolute;
    top: 0;
    inset-inline-start: 62px;
    inset-inline-end: 0;
    height: 0.5px;
    background: var(--hair);
  }
  .ios-row[data-sep="16"]::before,
  .ios-swipe + .ios-swipe > .ios-row::before {
    inset-inline-start: 16px;
  }
  :is(button, a).ios-row:active {
    background: var(--panel-2);
  }
  .ios-ic {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    display: grid;
    place-items: center;
    background: var(--tint-bg);
    color: var(--tint);
    flex: none;
  }
  .ios-ic.warn {
    background: var(--warn-bg);
    color: var(--warn);
  }
  .ios-ic.fill {
    background: var(--fill);
    color: var(--ink-2);
  }
  .ios-tx {
    flex: 1;
    min-width: 0;
  }
  .ios-tx b {
    display: block;
    font-weight: 500;
    font-size: 15px;
    line-height: 1.35;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ios-tx small {
    display: block;
    color: var(--ink-2);
    font-size: 13px;
    margin-top: 1px;
  }
  .ios-gh {
    padding: 0 16px;
    font-size: 13px;
    font-weight: 600;
    color: var(--ink-2);
  }
  .ios-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    padding: 0 9px;
    border-radius: 999px;
    background: var(--fill);
    color: var(--ink-2);
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
  }
  .ios-chip.tint {
    background: var(--tint-bg);
    color: var(--tint);
  }
  .ios-chip.warn {
    background: var(--warn-bg);
    color: var(--warn);
  }
  .ios-stat {
    background: var(--panel-2);
    border-radius: 16px;
    padding: 12px 14px;
    min-width: 0;
  }
  .ios-stat small {
    display: block;
    color: var(--ink-2);
    font-size: 12px;
    font-weight: 500;
  }
  .ios-stat b {
    display: block;
    margin-top: 2px;
    font-size: 24px;
    font-weight: 700;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
    direction: ltr;
    text-align: start;
    unicode-bidi: isolate;
  }
  .ios-delta {
    display: inline-flex;
    gap: 4px;
    align-items: center;
    margin-top: 4px;
    color: var(--tint);
    font-size: 12px;
    font-weight: 600;
  }
  .ios-pressable {
    transition: transform var(--t-fast) var(--out);
  }
  .ios-pressable:active {
    transform: scale(0.97);
  }

  /* Segmented control: equal segments, thumb moves on transform only (width is set once by the component). */
  .ios-seg {
    position: relative;
    display: flex;
    background: var(--fill);
    border-radius: 12px;
    padding: 3px;
    min-width: 0;
  }
  .ios-seg > button {
    position: relative;
    z-index: 1;
    flex: 1 1 0;
    min-height: 32px;
    padding: 0 10px;
    border-radius: 9px;
    font-size: 13px;
    font-weight: 600;
    color: var(--ink-2);
    white-space: nowrap;
    transition:
      color var(--t-med) var(--out),
      transform var(--t-fast) var(--out);
  }
  .ios-seg > button:is([aria-selected="true"], [aria-checked="true"]) {
    color: var(--ink);
  }
  .ios-seg > button:active {
    transform: scale(0.96);
  }
  .ios-seg-thumb {
    position: absolute;
    top: 3px;
    bottom: 3px;
    left: 0;
    border-radius: 9px;
    background: var(--panel);
    box-shadow:
      0 1px 3px rgba(0, 0, 0, 0.14),
      0 0 0 0.5px rgba(0, 0, 0, 0.04);
    transform: translateX(var(--x, 0px));
    transition: transform var(--t-spring) var(--spring);
    pointer-events: none;
  }

  /* iOS switch on a native checkbox (keeps role="switch" for the tests). */
  .ios-switch {
    appearance: none;
    -webkit-appearance: none;
    width: 51px;
    height: 31px;
    margin: 0;
    border-radius: 999px;
    background: var(--fill);
    position: relative;
    flex: none;
    cursor: pointer;
    transition: background-color var(--t-med) var(--out);
  }
  .ios-switch::after {
    content: "";
    position: absolute;
    top: 2px;
    inset-inline-start: 2px;
    width: 27px;
    height: 27px;
    border-radius: 999px;
    background: #fff;
    box-shadow:
      0 3px 8px rgba(0, 0, 0, 0.22),
      0 0 0 0.5px rgba(0, 0, 0, 0.04);
    transition: transform var(--t-spring) var(--spring);
  }
  .ios-switch:checked {
    background: var(--accent);
  }
  .ios-switch:checked::after {
    transform: translateX(-20px);
  }
  [dir="ltr"] .ios-switch:checked::after {
    transform: translateX(20px);
  }
  .ios-switch:disabled {
    opacity: 0.45;
    cursor: default;
  }

  /* Swipe-to-action row wrapper (Task 1.10 hook). */
  .ios-swipe {
    position: relative;
    overflow: hidden;
  }
  .ios-swipe > .ios-act {
    position: absolute;
    inset-block: 0;
    inset-inline-start: 0;
    width: 96px;
    display: grid;
    place-items: center;
    background: var(--warn);
    color: #fff;
    transform: scale(0.8);
    opacity: 0.7;
    transition:
      transform 0.35s var(--spring),
      opacity var(--t-fast) var(--out);
  }
  .ios-swipe[data-armed="true"] > .ios-act {
    transform: scale(1.12);
    opacity: 1;
  }
  .ios-swipe > .ios-row {
    background: var(--panel);
    touch-action: pan-y;
    transition:
      transform var(--t-spring) var(--spring),
      background-color var(--t-fast) var(--out);
  }
  .ios-swipe[data-dragging="true"] > .ios-row {
    transition: none;
  }

  /* Floating action button, pull indicator, toast, alert. */
  .ios-fab {
    position: fixed;
    inset-inline-end: 16px;
    bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px) + 26px);
    width: 52px;
    height: 52px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: var(--tint);
    z-index: 35;
    transform: scale(0.5);
    opacity: 0;
    pointer-events: none;
    transition:
      transform var(--t-spring) var(--spring),
      opacity var(--t-med) var(--out);
  }
  .ios-fab[data-show="true"] {
    transform: none;
    opacity: 1;
    pointer-events: auto;
  }
  [data-tabbar="mini"] .ios-fab[data-show="true"] {
    transform: translateY(10px) scale(0.9);
  }
  .ios-fab[data-show="true"]:active {
    transform: scale(0.9);
  }
  .ios-ptr {
    position: fixed;
    top: calc(56px + env(safe-area-inset-top, 0px) + 6px);
    left: 50%;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: var(--tint);
    z-index: 36;
    opacity: 0;
    transform: translate(-50%, 0) scale(0.6);
    pointer-events: none;
  }
  .ios-ptr[data-spin="true"] svg {
    animation: ios-spin 0.8s linear infinite;
  }
  [data-world="social"] .ios-toast {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 44px;
    padding: 0 18px 0 14px;
    border-radius: 999px;
    font-weight: 600;
    font-size: 14px;
    color: var(--ink);
    white-space: nowrap;
  }
  [data-world="social"] .ios-toast svg {
    color: var(--tint);
  }
  /* ConfirmDialog in Social = iOS alert (Task 1.12 adds the class hooks). */
  [data-world="social"] .ios-alert {
    width: 270px;
    max-width: 100%;
    padding: 0;
    border-radius: 14px;
    overflow: hidden;
    text-align: center;
  }
  [data-world="social"] .ios-alert-body {
    padding: 18px 16px 14px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  [data-world="social"] .ios-alert-body h2 {
    font-size: 17px;
    font-weight: 600;
  }
  [data-world="social"] .ios-alert-body p {
    font-size: 13px;
    color: var(--ink-2);
  }
  [data-world="social"] .ios-alert-actions {
    display: flex;
    flex-direction: column;
    border-top: 0.5px solid var(--hair);
  }
  [data-world="social"] .ios-alert-actions > button {
    all: unset;
    cursor: pointer;
    min-height: 44px;
    display: grid;
    place-items: center;
    font-size: 17px;
    color: var(--tint);
    transition: background-color var(--t-fast) var(--out);
  }
  [data-world="social"] .ios-alert-actions > button + button {
    border-top: 0.5px solid var(--hair);
  }
  [data-world="social"] .ios-alert-actions > button:active {
    background: var(--panel-2);
  }
  [data-world="social"] .ios-alert-actions > button[data-danger="true"] {
    color: var(--danger);
  }
  [data-world="social"] .ios-alert-actions > button[data-primary="true"] {
    font-weight: 600;
  }

  /* Staggered entrance for the first view of a screen (max 8 children). */
  .ios-stagger > * {
    animation: ios-up 0.6s var(--out) both;
  }
  .ios-stagger > :nth-child(2) { animation-delay: 0.05s; }
  .ios-stagger > :nth-child(3) { animation-delay: 0.1s; }
  .ios-stagger > :nth-child(4) { animation-delay: 0.15s; }
  .ios-stagger > :nth-child(5) { animation-delay: 0.2s; }
  .ios-stagger > :nth-child(6) { animation-delay: 0.25s; }
  .ios-stagger > :nth-child(7) { animation-delay: 0.3s; }
  .ios-stagger > :nth-child(n + 8) { animation-delay: 0.35s; }
}

@layer utilities {
  [data-world="social"] .num {
    font-family: var(--font-body);
    font-variant-numeric: tabular-nums;
  }
}

/* Motion: springs instead of the pixel steps(). */
[data-world="social"] :is(.anim-popin, .anim-sheet, .anim-toast, .anim-fade, .anim-pop) {
  animation-timing-function: var(--out);
}
[data-world="social"] .anim-sheet {
  animation-timing-function: var(--spring);
  animation-duration: var(--t-spring);
}
[data-world="social"] .px-particle {
  border-radius: 999px;
  box-shadow: none;
  animation-timing-function: var(--out);
}
@keyframes ios-up {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
}
@keyframes ios-pin {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.992);
  }
}
@keyframes ios-pout {
  to {
    opacity: 0;
    transform: translateY(-6px);
  }
}
@keyframes ios-pop {
  50% {
    transform: scale(1.35);
  }
}
@keyframes ios-spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes ios-drift {
  to {
    transform: translate(-7%, 5%) rotate(10deg) scale(1.08);
  }
}
/* ---- /Social world ---- */
```

- [ ] **Step 2: Run prettier and the e2e that checks `.px-card` has no border**

In `e2e/social-look.spec.ts` add after the font check inside the per-path test:

```ts
        const card = await page.evaluate(() => {
          const el = document.querySelector(".px-card, .ios-card, .ios-list") as HTMLElement | null;
          if (!el) return null;
          const s = getComputedStyle(el);
          return { border: parseFloat(s.borderTopWidth), radius: parseFloat(s.borderRadius) };
        });
        if (card) {
          expect(card.border).toBe(0);
          expect(card.radius).toBeGreaterThanOrEqual(16);
        }
```

Run: `pnpm.cmd format && E2E_PORT=3141 pnpm.cmd e2e e2e/social-look.spec.ts e2e/world.spec.ts --project=phone`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css e2e/social-look.spec.ts
git commit -m "feat(social): iOS component skin for px classes and the ios-* set"
```

### Task 1.5: Motion helpers

**Files:**
- Create: `lib/motion.ts`
- Test: `lib/motion.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function prefersReducedMotion(): boolean;
  export function clamp01(n: number): number;
  export function easeOutCubic(p: number): number;            // 1 - (1 - p)^3
  export function rubberBand(raw: number, limit: number, k?: number): number; // raw ≤ limit unchanged, beyond it log resistance
  export const MINI_DOWN = 140, MINI_UP = 80, MINI_DELTA = 6, TITLE_SPAN = 56, COMPACT_AT = 44;
  export function nextMini(prev: boolean, y: number, lastY: number): boolean;
  export function pullOffset(dy: number, resistance?: number, max?: number): number;
  export function pickDetent(y: number, velocity: number, heights: { medium: number; closed: number }): "large" | "medium" | "closed";
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// lib/motion.test.ts
import { describe, expect, it } from "vitest";
import { clamp01, easeOutCubic, nextMini, pickDetent, pullOffset, rubberBand } from "./motion";

describe("motion helpers", () => {
  it("clamps and eases", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875);
  });

  it("rubber bands past the limit with log resistance", () => {
    expect(rubberBand(50, 96)).toBe(50);
    expect(rubberBand(96, 96)).toBe(96);
    expect(rubberBand(200, 96)).toBeGreaterThan(96);
    expect(rubberBand(200, 96)).toBeLessThan(130);
  });

  it("minimizes the tab bar only after a clear scroll down past 140px, restores on scroll up or above 80px", () => {
    expect(nextMini(false, 150, 140)).toBe(true); // down by 10 past the threshold
    expect(nextMini(false, 150, 148)).toBe(false); // down by 2: ignored
    expect(nextMini(false, 100, 50)).toBe(false); // below 140 never minimizes
    expect(nextMini(true, 300, 310)).toBe(false); // up by 10 restores
    expect(nextMini(true, 300, 302)).toBe(true); // up by 2: stays mini
    expect(nextMini(true, 60, 60)).toBe(false); // above 80px (near the top) restores
  });

  it("pull offset applies resistance and a cap", () => {
    expect(pullOffset(-10)).toBe(0);
    expect(pullOffset(100)).toBeCloseTo(55);
    expect(pullOffset(1000)).toBe(130);
  });

  it("picks the sheet detent from position and velocity", () => {
    const h = { medium: 200, closed: 500 };
    expect(pickDetent(10, 0, h)).toBe("large");
    expect(pickDetent(190, 0, h)).toBe("medium");
    expect(pickDetent(420, 0, h)).toBe("closed");
    expect(pickDetent(50, 1, h)).toBe("medium"); // flung down from large
    expect(pickDetent(250, 1, h)).toBe("closed"); // flung down from medium
    expect(pickDetent(250, -1, h)).toBe("large"); // flung up
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `pnpm.cmd test lib/motion.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// lib/motion.ts
/** Pure motion helpers for the Social iOS look (tools/18 §3.5). No DOM here except prefersReducedMotion(). */

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export function easeOutCubic(p: number): number {
  return 1 - Math.pow(1 - clamp01(p), 3);
}

/** Up to `limit` moves 1:1; beyond it the extra distance is compressed with a log curve (iOS rubber band). */
export function rubberBand(raw: number, limit: number, k = 24): number {
  if (raw <= limit) return raw;
  return limit + Math.log1p((raw - limit) / k) * (k * 0.6);
}

export const TITLE_SPAN = 56;
export const COMPACT_AT = 44;
export const MINI_DOWN = 140;
export const MINI_UP = 80;
export const MINI_DELTA = 6;

/** Tab bar minimize state: down by ≥ 6px past 140px minimizes; up by ≥ 6px or above 80px restores. */
export function nextMini(prev: boolean, y: number, lastY: number): boolean {
  if (!prev) return y - lastY >= MINI_DELTA && y > MINI_DOWN;
  if (lastY - y >= MINI_DELTA || y < MINI_UP) return false;
  return true;
}

/** Pull-to-refresh offset: resistance then a hard cap. Negative pulls (scrolling up) give 0. */
export function pullOffset(dy: number, resistance = 0.55, max = 130): number {
  if (dy <= 0) return 0;
  return Math.min(max, dy * resistance);
}

/**
 * Sheet detent after a drag. `y` = current translateY in px (0 = large), `velocity` in px/ms (positive = down).
 * A fling (|v| > 0.6) steps one detent; otherwise the nearest detent wins.
 */
export function pickDetent(
  y: number,
  velocity: number,
  heights: { medium: number; closed: number },
): "large" | "medium" | "closed" {
  if (velocity > 0.6) return y < heights.medium / 2 ? "medium" : y < heights.medium ? "medium" : "closed";
  if (velocity < -0.6) return "large";
  if (y < heights.medium / 2) return "large";
  if (y < (heights.medium + heights.closed) / 2) return "medium";
  return "closed";
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm.cmd test lib/motion.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/motion.ts lib/motion.test.ts
git commit -m "feat(social): pure motion helpers (rubber band, tab bar minimize, pull, detents)"
```

### Task 1.6: Primitives — chrome store, PageHeader, Card, ListGroup/ListRow, Chip, StatTile, EmptyState

**Files:**
- Create: `components/ui/ios/chrome.ts`, `components/ui/ios/PageHeader.tsx`, `components/ui/ios/Card.tsx`,
  `components/ui/ios/List.tsx`, `components/ui/ios/Chip.tsx`, `components/ui/ios/StatTile.tsx`,
  `components/ui/ios/EmptyState.tsx`
- Test: `components/ui/ios/PageHeader.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  // chrome.ts
  export const useChrome: UseBoundStore<StoreApi<{ title: string; setTitle: (t: string) => void }>>;
  // PageHeader.tsx
  export default function PageHeader(p: { title: string; sub?: string; eyebrow?: string; trailing?: ReactNode; testId?: string }): JSX.Element;
  // Card.tsx
  export default function Card(p: { hero?: boolean; pressable?: boolean; className?: string; testId?: string; children: ReactNode } & HTMLAttributes<HTMLDivElement>): JSX.Element;
  // List.tsx
  export function ListGroup(p: { header?: string; className?: string; testId?: string; children: ReactNode }): JSX.Element;
  export function ListRow(p: { icon?: ReactNode; iconTone?: "tint" | "warn" | "fill"; title: ReactNode; sub?: ReactNode; trailing?: ReactNode; chevron?: boolean; href?: string; onClick?: () => void; testId?: string; className?: string }): JSX.Element;
  // Chip.tsx
  export default function Chip(p: { tone?: "default" | "tint" | "warn"; icon?: ReactNode; className?: string; children: ReactNode }): JSX.Element;
  // StatTile.tsx
  export default function StatTile(p: { label: string; value: number; decimals?: number; suffix?: string; prefix?: string; delta?: ReactNode; countUp?: boolean; className?: string; testId?: string }): JSX.Element;
  // EmptyState.tsx
  export default function EmptyState(p: { icon: ReactNode; title: string; hint?: string; action?: ReactNode; testId?: string }): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test for PageHeader (title registration)**

```tsx
// components/ui/ios/PageHeader.test.tsx
// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PageHeader from "./PageHeader";
import { useChrome } from "./chrome";

afterEach(cleanup);

describe("PageHeader", () => {
  it("renders the large title and registers it for the compact bar", () => {
    const { getByRole, unmount } = render(<PageHeader title="الاستوديو" sub="مساحتك" eyebrow="الثلاثاء" />);
    expect(getByRole("heading", { level: 1 }).textContent).toBe("الاستوديو");
    expect(useChrome.getState().title).toBe("الاستوديو");
    unmount();
    expect(useChrome.getState().title).toBe("");
  });
});
```

If `@testing-library/react` is not installed, check `package.json` first: the repo tests hooks and components with
plain `vitest` + `jsdom` (see `components/discover/DiscoverScreen.test.ts` for the pattern used here) — follow that
pattern instead of adding a dependency: render with `react-dom/client` into a `document.createElement("div")` inside
`act()` from `react`.

- [ ] **Step 2: Run to see it fail**

Run: `pnpm.cmd test components/ui/ios/PageHeader.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the files**

```ts
// components/ui/ios/chrome.ts
import { create } from "zustand";

/** The Social shell's compact title (shown in the glass slab once the page scrolls). PageHeader sets it. */
export const useChrome = create<{ title: string; setTitle: (title: string) => void }>((set) => ({
  title: "",
  setTitle: (title) => set({ title }),
}));
```

```tsx
// components/ui/ios/PageHeader.tsx
"use client";

import { useEffect, type ReactNode } from "react";
import { useChrome } from "./chrome";

/** Large iOS page title (34px) with an optional eyebrow line and subtitle; registers the compact title. */
export default function PageHeader({
  title,
  sub,
  eyebrow,
  trailing,
  testId,
}: {
  title: string;
  sub?: string;
  eyebrow?: string;
  trailing?: ReactNode;
  testId?: string;
}) {
  const setTitle = useChrome((s) => s.setTitle);
  useEffect(() => {
    setTitle(title);
    return () => setTitle("");
  }, [title, setTitle]);
  return (
    <header className="ios-lt flex items-end justify-between gap-3" data-testid={testId}>
      <div className="min-w-0">
        {eyebrow && <span className="ios-eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {trailing}
    </header>
  );
}
```

```tsx
// components/ui/ios/Card.tsx
import type { HTMLAttributes, ReactNode } from "react";

export default function Card({
  hero,
  pressable,
  className = "",
  testId,
  children,
  ...rest
}: {
  hero?: boolean;
  pressable?: boolean;
  className?: string;
  testId?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`ios-card ${hero ? "ios-hero" : ""} ${pressable ? "ios-pressable" : ""} ${className}`}
      data-testid={testId}
      {...rest}
    >
      {children}
    </div>
  );
}
```

```tsx
// components/ui/ios/List.tsx
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

export function ListGroup({
  header,
  className = "",
  testId,
  children,
}: {
  header?: string;
  className?: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <section className={`flex flex-col gap-1.5 ${className}`} data-testid={testId}>
      {header && <h2 className="ios-gh text-[13px]">{header}</h2>}
      <div className="ios-list">{children}</div>
    </section>
  );
}

/** One row: icon square, title + sub, trailing content or a forward chevron. Renders a link, a button or a div. */
export function ListRow({
  icon,
  iconTone = "tint",
  title,
  sub,
  trailing,
  chevron,
  href,
  onClick,
  testId,
  className = "",
}: {
  icon?: ReactNode;
  iconTone?: "tint" | "warn" | "fill";
  title: ReactNode;
  sub?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  href?: string;
  onClick?: () => void;
  testId?: string;
  className?: string;
}) {
  const body = (
    <>
      {icon && <span className={`ios-ic ${iconTone === "tint" ? "" : iconTone}`}>{icon}</span>}
      <span className="ios-tx">
        <b>{title}</b>
        {sub && <small>{sub}</small>}
      </span>
      {trailing}
      {chevron && <ChevronLeft size={18} strokeWidth={1.75} className="text-muted" aria-hidden />}
    </>
  );
  const cls = `ios-row ${className}`;
  const sep = icon ? undefined : "16";
  if (href)
    return (
      <Link href={href} className={cls} data-testid={testId} data-sep={sep}>
        {body}
      </Link>
    );
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={cls} data-testid={testId} data-sep={sep}>
        {body}
      </button>
    );
  return (
    <div className={cls} data-testid={testId} data-sep={sep}>
      {body}
    </div>
  );
}
```

```tsx
// components/ui/ios/Chip.tsx
import type { ReactNode } from "react";

export default function Chip({
  tone = "default",
  icon,
  className = "",
  children,
}: {
  tone?: "default" | "tint" | "warn";
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={`ios-chip ${tone === "default" ? "" : tone} ${className}`}>
      {icon}
      {children}
    </span>
  );
}
```

```tsx
// components/ui/ios/StatTile.tsx
"use client";

import type { ReactNode } from "react";
import { useCountUp } from "./useCountUp";

export default function StatTile({
  label,
  value,
  decimals = 0,
  suffix = "",
  prefix = "",
  delta,
  countUp = true,
  className = "",
  testId,
}: {
  label: string;
  value: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
  delta?: ReactNode;
  countUp?: boolean;
  className?: string;
  testId?: string;
}) {
  const shown = useCountUp(value, { decimals, enabled: countUp });
  return (
    <div className={`ios-stat ${className}`} data-testid={testId}>
      <small>{label}</small>
      <b className="num">
        {prefix}
        {shown}
        {suffix}
      </b>
      {delta && <span className="ios-delta">{delta}</span>}
    </div>
  );
}
```

```tsx
// components/ui/ios/EmptyState.tsx
import type { ReactNode } from "react";

export default function EmptyState({
  icon,
  title,
  hint,
  action,
  testId,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
  testId?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-6 text-center" data-testid={testId}>
      <span className="ios-ic fill h-12 w-12 rounded-2xl">{icon}</span>
      <p className="text-[15px] font-semibold">{title}</p>
      {hint && <p className="text-ink-2 max-w-[28ch] text-[13px]">{hint}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
```

`StatTile` imports `useCountUp` from Task 1.10; create that file in this task with the final code from Task 1.10 so
the typecheck passes (the two tasks ship in the same PR).

- [ ] **Step 4: Run the test and the typecheck**

Run: `pnpm.cmd test components/ui/ios && pnpm.cmd typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/ui/ios
git commit -m "feat(social): iOS primitives: PageHeader, Card, List, Chip, StatTile, EmptyState"
```

### Task 1.7: Segmented control

**Files:**
- Create: `components/ui/ios/Segmented.tsx`
- Test: `components/ui/ios/Segmented.test.tsx`

**Interfaces:**
- Produces:
  ```tsx
  export interface SegmentedOption<T extends string> { value: T; label: ReactNode; testId?: string }
  export default function Segmented<T extends string>(p: { options: readonly SegmentedOption<T>[]; value: T; onChange: (v: T) => void; label: string; role?: "tablist" | "radiogroup"; className?: string; testId?: string }): JSX.Element;
  ```
  Buttons carry `role="tab"` + `aria-selected` (tablist) or `role="radio"` + `aria-checked` (radiogroup).

- [ ] **Step 1: Write the failing test**

```tsx
// components/ui/ios/Segmented.test.tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import Segmented from "./Segmented";

function mount(ui: React.ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(ui));
  return { host, root };
}

describe("Segmented", () => {
  it("marks the value, changes on click and on arrow keys", () => {
    let value = "week";
    const opts = [
      { value: "week", label: "أسبوع" },
      { value: "month", label: "شهر" },
      { value: "stages", label: "مراحل" },
    ] as const;
    const { host } = mount(
      <Segmented options={opts} value={value} onChange={(v) => (value = v)} label="العرض" />,
    );
    const tabs = host.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(3);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    act(() => (tabs[1] as HTMLButtonElement).click());
    expect(value).toBe("month");
    act(() => {
      tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });
    expect(value).toBe("month"); // ArrowLeft in RTL = forward = next option
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `pnpm.cmd test components/ui/ios/Segmented.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```tsx
// components/ui/ios/Segmented.tsx
"use client";

import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  testId?: string;
}

/**
 * iOS segmented control. Equal-width segments; the thumb is positioned once per layout (width + translateX) and
 * then only `transform` animates. Arrow keys move the selection (ArrowLeft = forward in RTL, back in LTR).
 */
export default function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  role = "tablist",
  className = "",
  testId,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  role?: "tablist" | "radiogroup";
  className?: string;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const seg = ref.current;
    const th = thumb.current;
    if (!seg || !th) return;
    const place = () => {
      const btn = seg.querySelector<HTMLButtonElement>(`button[data-v="${CSS.escape(value)}"]`);
      if (!btn) return;
      th.style.width = `${btn.offsetWidth}px`;
      th.style.setProperty("--x", `${btn.offsetLeft}px`);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(seg);
    return () => ro.disconnect();
  }, [value, options.length]);

  const idx = options.findIndex((o) => o.value === value);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const rtl = (ref.current?.closest("[dir]") as HTMLElement | null)?.dir !== "ltr";
    const forward = e.key === (rtl ? "ArrowLeft" : "ArrowRight");
    const back = e.key === (rtl ? "ArrowRight" : "ArrowLeft");
    if (!forward && !back) return;
    e.preventDefault();
    const next = options[(idx + (forward ? 1 : -1) + options.length) % options.length];
    onChange(next.value);
    ref.current?.querySelector<HTMLButtonElement>(`button[data-v="${CSS.escape(next.value)}"]`)?.focus();
  };

  const item = role === "tablist" ? "tab" : "radio";
  const state = role === "tablist" ? "aria-selected" : "aria-checked";
  return (
    <div ref={ref} role={role} aria-label={label} className={`ios-seg ${className}`} onKeyDown={onKey} data-testid={testId}>
      <span ref={thumb} className="ios-seg-thumb" aria-hidden />
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role={item}
            {...{ [state]: on }}
            tabIndex={on ? 0 : -1}
            data-v={o.value}
            data-testid={o.testId}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
```

jsdom has no `ResizeObserver` and no `CSS.escape`: in the test file add before the imports
`globalThis.ResizeObserver ??= class { observe() {} disconnect() {} } as never;` and
`globalThis.CSS ??= { escape: (s: string) => s } as never;`.

- [ ] **Step 4: Run the test**

Run: `pnpm.cmd test components/ui/ios/Segmented.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/ui/ios/Segmented.tsx components/ui/ios/Segmented.test.tsx
git commit -m "feat(social): Segmented control with a spring thumb and arrow keys"
```

### Task 1.8: Switch

**Files:**
- Create: `components/ui/ios/Switch.tsx`
- Test: `components/ui/ios/Switch.test.tsx`

**Interfaces:**
- Produces: `export default function Switch(p: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; testId?: string; id?: string }): JSX.Element` rendering
  `<input type="checkbox" role="switch" class="ios-switch">` (so `getByRole("switch", { name })` keeps working).

- [ ] **Step 1: Write the failing test**

```tsx
// components/ui/ios/Switch.test.tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import Switch from "./Switch";

describe("Switch", () => {
  it("is a native checkbox with role=switch and reports changes", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    let on = false;
    act(() => createRoot(host).render(<Switch checked={on} onChange={(v) => (on = v)} label="الأصوات" />));
    const el = host.querySelector('input[role="switch"]') as HTMLInputElement;
    expect(el.getAttribute("aria-label")).toBe("الأصوات");
    expect(el.className).toContain("ios-switch");
    act(() => el.click());
    expect(on).toBe(true);
  });
});
```

- [ ] **Step 2: Run to see it fail**, then **Step 3: Implement**

```tsx
// components/ui/ios/Switch.tsx
"use client";

export default function Switch({
  checked,
  onChange,
  label,
  disabled,
  testId,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  testId?: string;
  id?: string;
}) {
  return (
    <input
      id={id}
      type="checkbox"
      role="switch"
      className="ios-switch"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      aria-checked={checked}
      data-testid={testId}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}
```

- [ ] **Step 4: Run the test** → PASS. **Step 5: Commit**

```bash
git add components/ui/ios/Switch.tsx components/ui/ios/Switch.test.tsx
git commit -m "feat(social): iOS Switch on a native checkbox"
```

### Task 1.9: Sheet on vaul

**Files:**
- Create: `components/ui/ios/Sheet.tsx`
- Modify: `components/shell/AppShell.tsx` (add `data-vaul-drawer-wrapper` to the outer `<div className="flex min-h-dvh flex-col">`)
- Modify: `app/globals.css` (sheet classes, appended inside the Social `@layer components` block from Task 1.4)

**Interfaces:**
- Produces:
  ```tsx
  export default function Sheet(p: {
    open: boolean;
    onClose: () => void;
    title: string;
    sub?: string;
    titleId: string;
    testId: string;
    /** Fractions of the viewport height; default two detents: medium 0.6, large 0.92. One value = a single height. */
    detents?: number[];
    /** Opens on this detent (index into `detents`), default 0. */
    initialDetent?: number;
    footer?: ReactNode;
    attrs?: Record<string, string>;
    children: ReactNode;
  }): JSX.Element;
  ```
  Behaviors: drag from the grabber, snap to the detents, swipe down past the lowest closes, Esc and backdrop close,
  focus trap and `aria-modal` from vaul's Radix Dialog, the phone's Back closes (`useBackToClose`), body scroll locked,
  the content behind scales to 0.965 (vaul `shouldScaleBackground` on the wrapper).

- [ ] **Step 1: Implement**

```tsx
// components/ui/ios/Sheet.tsx
"use client";

import { X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Drawer } from "vaul";
import { useBackToClose } from "@/components/player/useBackToClose";
import { useT } from "@/lib/i18n";

const DETENTS = [0.6, 0.92];

/** iOS bottom sheet: two heights, drag, spring, back-button close. Replaces SheetFrame / GrowthDialog in Social. */
export default function Sheet({
  open,
  onClose,
  title,
  sub,
  titleId,
  testId,
  detents = DETENTS,
  initialDetent = 0,
  footer,
  attrs,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  sub?: string;
  titleId: string;
  testId: string;
  detents?: number[];
  initialDetent?: number;
  footer?: ReactNode;
  attrs?: Record<string, string>;
  children: ReactNode;
}) {
  const { t } = useT();
  const [snap, setSnap] = useState<number | string | null>(detents[initialDetent] ?? detents[0]);
  useBackToClose(open, onClose);
  return (
    <Drawer.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
        else setSnap(detents[initialDetent] ?? detents[0]);
      }}
      snapPoints={detents}
      activeSnapPoint={snap}
      setActiveSnapPoint={setSnap}
      fadeFromIndex={0}
      direction="bottom"
      shouldScaleBackground
      setBackgroundColorOnScale={false}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="ios-backdrop" data-testid="sheet-backdrop" />
        <Drawer.Content
          className="ios-sheet"
          aria-labelledby={titleId}
          aria-describedby={undefined}
          data-testid={testId}
          {...attrs}
        >
          <div className="ios-grab">
            <Drawer.Handle className="ios-handle" />
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <Drawer.Title id={titleId} className="text-[20px] font-bold tracking-tight">
                  {title}
                </Drawer.Title>
                {sub && <p className="text-muted text-[12px]">{sub}</p>}
              </div>
              <Drawer.Close className="ios-close" aria-label={t("common.close")}>
                <X size={16} strokeWidth={1.75} />
              </Drawer.Close>
            </div>
          </div>
          <div className="ios-sheet-body">{children}</div>
          {footer && <div className="ios-sheet-footer">{footer}</div>}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
```

Check `messages/ar.json` for the close label key: the inventory lists `common.*` with 3 keys; if none is "close", add
`common.close` = `إغلاق` / `Close` to `messages/ar.json` and `messages/en.json`.

- [ ] **Step 2: Sheet CSS** (append inside the Social `@layer components` block):

```css
  [data-world="social"] .ios-backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgba(0, 0, 0, 0.38);
    -webkit-backdrop-filter: blur(6px);
    backdrop-filter: blur(6px);
  }
  [data-world="social"] .ios-sheet {
    position: fixed;
    inset-inline: 0;
    bottom: 0;
    z-index: 41;
    height: 92dvh;
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border-radius: 30px 30px 0 0;
    box-shadow:
      0 -10px 40px rgba(0, 0, 0, 0.25),
      inset 0 0.5px 0 rgba(255, 255, 255, 0.12);
    outline: none;
  }
  @media (min-width: 768px) {
    [data-world="social"] .ios-sheet {
      inset-inline: auto;
      left: 50%;
      width: min(560px, 100vw - 32px);
      transform: translateX(-50%);
    }
  }
  [data-world="social"] .ios-grab {
    flex: none;
    padding: 8px 16px 6px;
    cursor: grab;
  }
  [data-world="social"] .ios-handle {
    display: block;
    width: 38px;
    height: 5px;
    margin: 0 auto 10px;
    border-radius: 3px;
    background: var(--fill);
    opacity: 1;
  }
  [data-world="social"] .ios-close {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--fill);
    color: var(--ink-2);
    display: grid;
    place-items: center;
    flex: none;
  }
  [data-world="social"] .ios-sheet-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 8px 16px calc(16px + env(safe-area-inset-bottom, 0px));
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  [data-world="social"] .ios-sheet-footer {
    flex: none;
    padding: 8px 16px calc(12px + env(safe-area-inset-bottom, 0px));
    border-top: 0.5px solid var(--hair);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  [data-world="social"] [data-vaul-drawer-wrapper] {
    transition: transform var(--t-spring) var(--spring), border-radius var(--t-spring) var(--spring) !important;
  }
```

vaul positions the drawer with its own inline transforms; on desktop the `translateX(-50%)` centering is overridden
while dragging, so keep the desktop rule simple: if centering fights vaul in testing, use `inset-inline: 0; margin-inline: auto; width: min(560px, 100vw - 32px)` instead.

- [ ] **Step 3: Smoke test in the browser (no unit test: vaul needs a real layout)**

Temporarily render `<Sheet open … >` from `components/social/SoonScreen.tsx` behind a button, run
`pnpm.cmd dev -p 3141`, open `/social/website` on the phone project in the Browser pane, verify: opens at 60%, drag up
to 92%, drag down closes, Esc closes, backdrop closes, browser Back closes without leaving the page, content behind
scales. Remove the temporary button before committing.

- [ ] **Step 4: Commit**

```bash
git add components/ui/ios/Sheet.tsx components/shell/AppShell.tsx app/globals.css messages/ar.json messages/en.json
git commit -m "feat(social): Sheet primitive on vaul with two detents and back-to-close"
```

### Task 1.10: Hooks — useCountUp, useScrollChrome, usePullToRefresh, useSwipeAction

**Files:**
- Create: `components/ui/ios/useCountUp.ts`, `useScrollChrome.ts`, `usePullToRefresh.ts`, `useSwipeAction.ts`
- Test: `components/ui/ios/useCountUp.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function useCountUp(target: number, o?: { decimals?: number; duration?: number; enabled?: boolean }): string;
  export function useScrollChrome(enabled: boolean, resetKey: string): void; // writes html.style --scroll-p, html[data-compact], html[data-tabbar="mini"]
  export function usePullToRefresh(onRefresh: () => Promise<unknown> | void, o?: { enabled?: boolean; threshold?: number; targetRef?: RefObject<HTMLElement | null> }): { pull: number; refreshing: boolean };
  export function useSwipeAction(onTrigger: () => void, o?: { max?: number; arm?: number; enabled?: boolean }): { handlers: Pick<HTMLAttributes<HTMLElement>, "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel">; x: number; armed: boolean; dragging: boolean };
  ```

- [ ] **Step 1: Failing test for useCountUp (formatting + reduced motion short-circuit)**

```ts
// components/ui/ios/useCountUp.test.ts
// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { useCountUp } from "./useCountUp";

function Probe({ v, dec }: { v: number; dec?: number }) {
  return createElement("b", null, useCountUp(v, { decimals: dec }));
}

describe("useCountUp", () => {
  it("renders the final value at once when motion is reduced", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    const host = document.createElement("div");
    act(() => createRoot(host).render(createElement(Probe, { v: 12430 })));
    expect(host.textContent).toBe("12,430");
    vi.unstubAllGlobals();
  });

  it("keeps the decimals and starts from zero when animating", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal("requestAnimationFrame", () => 0);
    const host = document.createElement("div");
    act(() => createRoot(host).render(createElement(Probe, { v: 184.2, dec: 1 })));
    expect(host.textContent).toBe("0.0");
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run to see it fail**, then **Step 3: Implement the four hooks**

```ts
// components/ui/ios/useCountUp.ts
"use client";

import { useEffect, useState } from "react";
import { easeOutCubic, prefersReducedMotion } from "@/lib/motion";

function fmt(v: number, decimals: number): string {
  return v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Counts from 0 to `target` once (1000ms, ease-out cubic). Reduced motion or `enabled: false` shows the target. */
export function useCountUp(
  target: number,
  { decimals = 0, duration = 1000, enabled = true }: { decimals?: number; duration?: number; enabled?: boolean } = {},
): string {
  const still = !enabled || prefersReducedMotion();
  const [shown, setShown] = useState(() => fmt(still ? target : 0, decimals));
  useEffect(() => {
    if (still) {
      setShown(fmt(target, decimals));
      return;
    }
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setShown(fmt(target * easeOutCubic(p), decimals));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, decimals, duration, still]);
  return shown;
}
```

```ts
// components/ui/ios/useScrollChrome.ts
"use client";

import { useEffect } from "react";
import { clamp01, COMPACT_AT, nextMini, TITLE_SPAN } from "@/lib/motion";

/**
 * Scroll-linked chrome for the Social shell: `--scroll-p` (0–1 over the first 56px) feeds the large title,
 * `data-compact` shows the glass slab + compact title past 44px, `data-tabbar="mini"` minimizes the tab bar on a
 * clear scroll down. Passive listener, one write per frame. `resetKey` (the pathname) restarts the direction memory.
 */
export function useScrollChrome(enabled: boolean, resetKey: string): void {
  useEffect(() => {
    const html = document.documentElement;
    const clear = () => {
      html.style.removeProperty("--scroll-p");
      delete html.dataset.compact;
      delete html.dataset.tabbar;
    };
    if (!enabled) {
      clear();
      return;
    }
    let last = window.scrollY;
    let mini = false;
    let ticking = false;
    const run = () => {
      ticking = false;
      const y = window.scrollY;
      html.style.setProperty("--scroll-p", clamp01(y / TITLE_SPAN).toFixed(3));
      if (y > COMPACT_AT) html.dataset.compact = "true";
      else delete html.dataset.compact;
      mini = nextMini(mini, y, last);
      if (mini) html.dataset.tabbar = "mini";
      else delete html.dataset.tabbar;
      last = y;
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(run);
    };
    run();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      clear();
    };
  }, [enabled, resetKey]);
}
```

```ts
// components/ui/ios/usePullToRefresh.ts
"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { pullOffset } from "@/lib/motion";

/**
 * Pull-to-refresh on the window scroll (the dashboard scrolls the document). Touch only (desktop has a button).
 * While pulling, the target element (default `#main`) is translated down with resistance; past `threshold` the
 * release calls `onRefresh`, holds the content at 56px with `refreshing: true`, then springs back (≥ 1.1s).
 */
export function usePullToRefresh(
  onRefresh: () => Promise<unknown> | void,
  {
    enabled = true,
    threshold = 70,
    targetRef,
  }: { enabled?: boolean; threshold?: number; targetRef?: RefObject<HTMLElement | null> } = {},
): { pull: number; refreshing: boolean } {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const cb = useRef(onRefresh);
  cb.current = onRefresh;

  useEffect(() => {
    if (!enabled) return;
    const target = () => targetRef?.current ?? document.getElementById("main");
    let y0 = 0;
    let dy = 0;
    let pulling = false;
    let busy = false;
    const setY = (px: number, animate: boolean) => {
      const el = target();
      if (!el) return;
      el.style.transition = animate ? "transform var(--t-spring) var(--spring)" : "none";
      el.style.transform = px ? `translateY(${px}px)` : "";
    };
    const start = (e: TouchEvent) => {
      if (busy || window.scrollY > 0) return;
      pulling = true;
      y0 = e.touches[0].clientY;
      dy = 0;
    };
    const move = (e: TouchEvent) => {
      if (!pulling) return;
      const raw = e.touches[0].clientY - y0;
      dy = pullOffset(raw);
      if (dy > 0) {
        if (e.cancelable) e.preventDefault();
        setY(dy, false);
        setPull(dy);
      }
    };
    const end = () => {
      if (!pulling) return;
      pulling = false;
      if (dy >= threshold) {
        busy = true;
        setRefreshing(true);
        setY(56, true);
        const done = Promise.all([Promise.resolve(cb.current()), new Promise((r) => setTimeout(r, 1100))]);
        done.finally(() => {
          busy = false;
          setRefreshing(false);
          setPull(0);
          setY(0, true);
          setTimeout(() => {
            const el = target();
            if (el) el.style.transition = "";
          }, 600);
        });
      } else {
        setPull(0);
        setY(0, true);
      }
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", end);
    window.addEventListener("touchcancel", end);
    return () => {
      window.removeEventListener("touchstart", start);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
      setY(0, false);
    };
  }, [enabled, threshold, targetRef]);

  return { pull, refreshing };
}
```

```ts
// components/ui/ios/useSwipeAction.ts
"use client";

import { useRef, useState, type HTMLAttributes, type PointerEvent } from "react";
import { rubberBand } from "@/lib/motion";

type Handlers = Pick<HTMLAttributes<HTMLElement>, "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel">;

/**
 * Leading swipe on a row (toward the end edge: left in RTL). Returns the translateX to apply to the row, whether
 * the action is armed (past `arm` px) and pointer handlers. A vertical move at the start hands the gesture back to
 * scrolling (the row has `touch-action: pan-y`). Releasing while armed calls `onTrigger` and springs back.
 */
export function useSwipeAction(
  onTrigger: () => void,
  { max = 96, arm = 64, enabled = true }: { max?: number; arm?: number; enabled?: boolean } = {},
): { handlers: Handlers; x: number; armed: boolean; dragging: boolean } {
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const s = useRef({ x0: 0, y0: 0, active: false, decided: false, rtl: true });

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (!enabled || e.button) return;
    const st = s.current;
    st.x0 = e.clientX;
    st.y0 = e.clientY;
    st.active = true;
    st.decided = false;
    st.rtl = (e.currentTarget.closest("[dir]") as HTMLElement | null)?.dir !== "ltr";
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const st = s.current;
    if (!st.active) return;
    const mx = e.clientX - st.x0;
    const my = e.clientY - st.y0;
    if (!st.decided) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      if (Math.abs(my) > Math.abs(mx)) {
        st.active = false;
        return;
      }
      st.decided = true;
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    // Toward the end edge only: negative in RTL, positive in LTR.
    const toward = st.rtl ? -mx : mx;
    const d = rubberBand(Math.max(0, toward), max);
    setX(st.rtl ? -d : d);
  };
  const finish = () => {
    const st = s.current;
    if (!st.active) return;
    st.active = false;
    const armed = Math.abs(x) >= arm;
    setDragging(false);
    setX(0);
    if (st.decided && armed) onTrigger();
  };
  return {
    handlers: { onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: finish },
    x,
    armed: Math.abs(x) >= arm,
    dragging,
  };
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm.cmd test components/ui/ios && pnpm.cmd typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/ui/ios
git commit -m "feat(social): motion hooks: count-up, scroll chrome, pull to refresh, swipe action"
```

### Task 1.11: Platform glyphs and PlatformBadge

**Files:**
- Create: `lib/platformIcons.tsx`, `components/ui/ios/PlatformBadge.tsx`
- Modify: `lib/social.ts:60-66` (`PlatformMeta` gets `glyph`), `lib/social.ts:76-160` (colors → tokens)
- Test: `lib/social.test.ts` (existing; add one assertion)

**Interfaces:**
- Produces:
  ```tsx
  // lib/platformIcons.tsx
  export const PLATFORM_PATHS: Record<Platform, string>; // 24×24 simple-icons path data (CC0)
  export function PlatformGlyph(p: { platform: Platform; size?: number; className?: string }): JSX.Element; // <svg viewBox="0 0 24 24" fill="currentColor">
  // components/ui/ios/PlatformBadge.tsx
  export default function PlatformBadge(p: { platform: Platform; size?: number; className?: string }): JSX.Element; // colored square with the white glyph
  ```
  `PLATFORM_META[p].color` becomes `var(--pc-<platform>)` strings; `PLATFORM_META[p].glyph = true` marks that a glyph exists (the emoji `icon` stays for Training users of the meta).

- [ ] **Step 1: Fetch the six brand paths (CC0) into the module**

Run, from the repo root (each prints an `<svg>` whose single `<path d="…">` is the data to copy):

```bash
for s in tiktok instagram youtube snapchat x threads; do echo "== $s"; curl -s "https://cdn.simpleicons.org/$s" | grep -o 'd="[^"]*"' | head -1; done
```

Create `lib/platformIcons.tsx` with the six `d` strings:

```tsx
import type { Platform } from "./social";

/** Brand marks from simple-icons (CC0 1.0), 24×24, filled. White on the platform color in PlatformBadge. */
export const PLATFORM_PATHS: Record<Platform, string> = {
  tiktok: "<paste tiktok d>",
  instagram: "<paste instagram d>",
  youtube: "<paste youtube d>",
  snapchat: "<paste snapchat d>",
  x: "<paste x d>",
  threads: "<paste threads d>",
};

export function PlatformGlyph({ platform, size = 20, className }: { platform: Platform; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" className={className} aria-hidden>
      <path d={PLATFORM_PATHS[platform]} />
    </svg>
  );
}
```

(The `<paste … d>` placeholders are filled by the curl output in this step; the module must not ship with them.)

- [ ] **Step 2: PlatformBadge**

```tsx
// components/ui/ios/PlatformBadge.tsx
import type { Platform } from "@/lib/social";
import { PlatformGlyph } from "@/lib/platformIcons";

/** 40px (default) rounded square in the platform color with its white glyph; Snapchat and X use dark glyphs. */
export default function PlatformBadge({ platform, size = 40, className = "" }: { platform: Platform; size?: number; className?: string }) {
  const dark = platform === "snapchat";
  return (
    <span
      className={`grid shrink-0 place-items-center ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.33),
        background: `var(--pc-${platform})`,
        color: dark ? "#111" : platform === "x" || platform === "threads" ? "var(--bg)" : "#fff",
      }}
      aria-hidden
    >
      <PlatformGlyph platform={platform} size={Math.round(size * 0.5)} />
    </span>
  );
}
```

- [ ] **Step 3: Tokens in `PLATFORM_META`**

In `lib/social.ts` add `glyph: true` to each entry's type and object, and set `color` to `"var(--pc-tiktok)"`,
`"var(--pc-instagram)"`, `"var(--pc-youtube)"`, `"var(--pc-threads)"`, `"var(--pc-x)"`, `"var(--pc-snapchat)"`.
Then grep every reader of `.color` (`PlatformTab.tsx:74` chart lines, `calendar/PlatformChip.tsx`, `studio/platform.tsx`,
`globals.css` `--pc` usages) and confirm each passes the string into CSS (`style={{ color }}`, `stroke={color}`,
`--pc: ${color}`), which all accept `var()`. Add to `lib/social.test.ts`:

```ts
it("platform colors are theme tokens", () => {
  for (const m of Object.values(PLATFORM_META)) expect(m.color).toMatch(/^var\(--pc-[a-z]+\)$/);
});
```

Training does not render platform colors (verify with `grep -rn "PLATFORM_META" components/today components/map components/skills` → no hits).

- [ ] **Step 4: Run tests and typecheck** → PASS. **Step 5: Commit**

```bash
git add lib/platformIcons.tsx lib/social.ts lib/social.test.ts components/ui/ios/PlatformBadge.tsx
git commit -m "feat(social): brand glyphs and token colors for platforms"
```

### Task 1.12: ConfirmDialog as an iOS alert, Social toast class

**Files:**
- Modify: `components/ui/ConfirmDialog.tsx` (class hooks only, markup order unchanged)
- Modify: `components/celebrate/CelebrationProvider.tsx:269` (the small toast element)

- [ ] **Step 1: ConfirmDialog hooks**

In the panel `<div role="alertdialog" … className="px-card anim-popin flex w-full max-w-[400px] flex-col gap-3">` add
the class `ios-alert`; wrap the `<h2>` and `<p>` in `<div className="ios-alert-body">`; give the buttons' container the
class `ios-alert-actions` and put `data-primary="true"` on the confirm button and `data-danger={danger ? "true" : undefined}`
on it when `danger`. In Training nothing changes (the `ios-alert*` rules are scoped to `[data-world="social"]`).
Keep `data-testid="confirm-dialog"`, the ids and the focus logic.

- [ ] **Step 2: Toast class**

At `CelebrationProvider.tsx:269` the small toast has `rounded-[2px] border-[3px] text-[#16202c] …`. Read the world with
`useWorld()` inside the toast component and render `className={world === "social" ? "ios-toast glass anim-toast" : <existing classes>}`.
Keep `data-testid="toast"` and `data-kind`. Also at `:390` and `:405` (`font-pixel`, 3px text-shadow on the big
celebration) wrap those classes the same way: in Social use `font-semibold` and no text-shadow.

- [ ] **Step 3: Check both worlds in the browser**

Run `pnpm.cmd dev -p 3141`; on `/social/calendar` open a post and delete it (ConfirmDialog) → the 270px centered
alert with stacked buttons; on `/` complete a quest → the pixel toast unchanged.

- [ ] **Step 4: Commit**

```bash
git add components/ui/ConfirmDialog.tsx components/celebrate/CelebrationProvider.tsx
git commit -m "feat(social): iOS alert style for ConfirmDialog and glass toast in Social"
```

### Task 1.13: Phase 1 gates and PR

- [ ] **Step 1: All gates**

Run: `pnpm.cmd lint && pnpm.cmd typecheck && pnpm.cmd test && pnpm.cmd build && E2E_PORT=3141 pnpm.cmd e2e`
Expected: all green. If `e2e` fails on a Training spec, the change leaked outside `[data-world="social"]`: fix the
selector, never the Training test.

- [ ] **Step 2: Screenshots for the PR**

Add a throwaway script run (not committed) with Playwright: for each Social route and both color schemes, `page.screenshot({ path: `test-results/look/${scheme}${path.replace(/\//g, "_")}.png`, fullPage: true })` on the phone project. Attach the Studio and Calendar images to the PR.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin claude/social-ios-1-foundations
gh pr create --title "Social iOS look 1/8: foundations (tokens, Vazirmatn, primitives)" --body-file - <<'EOF'
Phase 1 of planning/plans/2026-10-06-social-ios-design.md (spec: planning/tools/18-social-ios-design.md).

- Light + dark tokens for the Social world, glass + motion tokens, Vazirmatn
- `.px-*` Social skin and the `ios-*` classes; iOS primitives in components/ui/ios (PageHeader, Card, List, Segmented, Switch, Sheet on vaul, Chip, StatTile, PlatformBadge, EmptyState) and the motion hooks
- ConfirmDialog as an iOS alert and a glass toast in Social
- New e2e: e2e/social-look.spec.ts (both schemes, Training guard)

Training is untouched (guard test + full e2e green). Screenshots below.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

The owner merges; phase 2 branches from the new `origin/main`.

---

# Phase 2 — Shell (branch `claude/social-ios-2-shell`)

### Task 2.1: Lucide icons on the Social nav items

**Files:**
- Modify: `components/shell/nav.ts:1-50`
- Test: `components/shell/nav.test.ts`

**Interfaces:**
- Produces: `NavItem.lucide?: LucideIcon` set on every `SOCIAL_NAV_ITEMS` entry; Training items unchanged.

- [ ] **Step 1: Failing test**

Add to `components/shell/nav.test.ts`:

```ts
import { SOCIAL_NAV_ITEMS, NAV_ITEMS } from "./nav";

it("every Social nav item has a Lucide icon, Training items keep emoji only", () => {
  for (const item of SOCIAL_NAV_ITEMS) expect(typeof item.lucide, item.href).toBe("function");
  for (const item of NAV_ITEMS) expect(item.lucide, item.href).toBeUndefined();
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**

```ts
import {
  Briefcase, Calendar, Clapperboard, Ellipsis, Globe, Lightbulb, MessageCircle, Rocket, Search, Settings,
  TrendingUp, type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  icon: string;
  /** Social world: the line icon drawn instead of the emoji (tools/18 §3.6). */
  lucide?: LucideIcon;
  label: MessageKey;
  soon?: boolean;
  desktopOnly?: boolean;
}

export const SOCIAL_NAV_ITEMS: readonly NavItem[] = [
  { href: "/social", icon: "🎬", lucide: Clapperboard, label: "nav.studio" },
  { href: "/social/calendar", icon: "📅", lucide: Calendar, label: "nav.calendar" },
  { href: "/social/growth", icon: "📈", lucide: TrendingUp, label: "nav.growth" },
  { href: "/social/ideas", icon: "💡", lucide: Lightbulb, label: "nav.ideas" },
  { href: "/social/more", icon: "☰", lucide: Ellipsis, label: "nav.more" },
  { href: "/social/website", icon: "🌐", lucide: Globe, label: "nav.website", soon: true, desktopOnly: true },
  { href: "/social/business", icon: "💼", lucide: Briefcase, label: "nav.business", soon: true, desktopOnly: true },
  { href: "/social/replies", icon: "💬", lucide: MessageCircle, label: "nav.replies", desktopOnly: true },
  { href: "/social/automations", icon: "🚀", lucide: Rocket, label: "nav.automations", desktopOnly: true },
  { href: "/discover", icon: "🔎", lucide: Search, label: "nav.discover", desktopOnly: true },
  { href: "/settings", icon: "⚙️", lucide: Settings, label: "nav.settings", desktopOnly: true },
];
```

`nav.ts` is imported by `nav.test.ts` under Vitest (jsdom): `lucide-react` components are plain functions, fine.

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat(social): Lucide icons on the Social nav items`.

### Task 2.2: Social shell — top area, glass tab bar, sidebar, scroll chrome, launch choreography, theme-color

**Files:**
- Modify: `components/shell/AppShell.tsx` (`AppShell`, `TopBar`, `NavEntry`, `SideNav`, `TabBar`, `Logo`)
- Modify: `app/globals.css` (shell classes, inside the Social `@layer components` block)
- Test: `e2e/social-look.spec.ts` (tab bar + compact title checks), `e2e/world.spec.ts` (hrefs unchanged)

**Interfaces:**
- Consumes: `useScrollChrome(enabled, pathname)`, `useChrome` (Task 1.6/1.10), `NavItem.lucide` (Task 2.1).
- Produces: `data-testid="tabbar"` (kept), `data-testid="sidenav"` (kept), new `data-testid="social-top"`,
  `data-testid="compact-title"`, `data-testid="tab-indicator"`; `<html data-compact data-tabbar>` attributes;
  `<meta name="theme-color">` follows the world and scheme.

- [ ] **Step 1: Extend the e2e first**

Append to `e2e/social-look.spec.ts`:

```ts
test("Social shell: glass tab bar with icons, compact title after scrolling", async ({ page, isMobile }) => {
  test.skip(!isMobile, "tab bar is phone only");
  await freshState(page, "/social/");
  const tabbar = page.getByTestId("tabbar");
  await expect(tabbar).toHaveClass(/glass/);
  await expect(tabbar.locator("svg")).toHaveCount(5);
  await expect(tabbar.locator('a[href="/social/"]')).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("compact-title")).toHaveCSS("opacity", "0");
  await page.evaluate(() => window.scrollTo(0, 400));
  await expect(page.locator("html")).toHaveAttribute("data-compact", "true");
  await expect(page.getByTestId("compact-title")).toHaveText("الاستوديو");
  await expect(page.getByTestId("compact-title")).toHaveCSS("opacity", "1");
});
```

(`reducedMotion: "reduce"` in the Playwright config makes the opacity transitions instant.)

- [ ] **Step 2: Run** → FAIL (no `glass` class, no compact title).

- [ ] **Step 3: Shell changes in `AppShell.tsx`**

Imports to add:

```ts
import { Gamepad2, Settings, Smartphone } from "lucide-react";
import { useChrome } from "@/components/ui/ios/chrome";
import { useScrollChrome } from "@/components/ui/ios/useScrollChrome";
```

In `AppShell()` after `useDocumentWorld();` add:

```ts
  const pathname = usePathname();
  const world = useWorld();
  useScrollChrome(world === "social", pathname ?? "/");
  useThemeColor(world);
  useLaunch(world);
```

and these helpers at module level:

```tsx
/** `<meta name="theme-color">` follows the active world: pixel navy for Training, the Social `--bg` per scheme. */
function useThemeColor(world: World): void {
  useEffect(() => {
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const color = world === "training" ? "#0d141d" : dark.matches ? "#0b0d10" : "#f2f3f6";
      let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
      if (!meta) {
        meta = document.createElement("meta");
        meta.name = "theme-color";
        document.head.appendChild(meta);
      }
      meta.content = color;
    };
    apply();
    dark.addEventListener("change", apply);
    return () => dark.removeEventListener("change", apply);
  }, [world]);
}

/** Launch choreography: `data-launch` on <html> for the first 1.4s of a Social page load (CSS does the rest). */
function useLaunch(world: World): void {
  useEffect(() => {
    if (world !== "social") return;
    const html = document.documentElement;
    html.dataset.launch = "boot";
    const t1 = requestAnimationFrame(() => requestAnimationFrame(() => (html.dataset.launch = "in")));
    const t2 = setTimeout(() => delete html.dataset.launch, 1400);
    return () => {
      cancelAnimationFrame(t1);
      clearTimeout(t2);
      delete html.dataset.launch;
    };
    // Runs once per full load (world only changes with a navigation that remounts nothing here).
  }, [world]);
}
```

`viewport.themeColor` in `app/layout.tsx` stays `#0d141d` (first paint); the hook corrects it after hydration.

Replace `TopBar()` with a world switch:

```tsx
function TopBar() {
  const world = useWorld();
  return world === "social" ? <SocialTop /> : <TrainingTopBar />;
}
```

Rename the existing `TopBar` body to `TrainingTopBar` unchanged, and add:

```tsx
/**
 * Social top area (tools/18 §4): no bar at rest. Start: brand mark + the world switch as a glass capsule.
 * End: the gear in a glass circle. A glass slab with the page title fades in once the page scrolls (`data-compact`).
 * The language toggle lives in More and Settings in Social.
 */
function SocialTop() {
  const { t } = useT();
  const title = useChrome((s) => s.title);
  return (
    <header className="ios-top pt-safe" data-testid="social-top">
      <div className="ios-top-bg slab" aria-hidden />
      <div className="mx-auto flex h-14 max-w-[1180px] items-center gap-2 px-3 md:px-6">
        <Link href="/social" className="ios-top-brand" aria-label={t("app.name")}>
          <Logo />
        </Link>
        <WorldSwitch />
        <div className="ios-top-title" data-testid="compact-title" aria-hidden>
          {title}
        </div>
        <div className="ms-auto flex items-center gap-2 ios-top-end">
          <Link href="/settings" aria-label={t("top.settings")} title={t("top.settings")} className="ios-icbtn glass">
            <Settings size={20} strokeWidth={1.75} />
          </Link>
        </div>
      </div>
    </header>
  );
}
```

In `Logo()` the Social branch keeps `rounded-[12px]` but replace the literal glow with the token:
`"rounded-[12px] shadow-[0_6px_18px_color-mix(in_srgb,var(--accent)_30%,transparent)]"`.

Replace `NavEntry` so Social items draw the Lucide icon and the lens:

```tsx
function NavEntry({ item, variant, active, world }: { item: NavItem; variant: "side" | "tab"; active: boolean; world: World }) {
  const { t } = useT();
  const side = variant === "side";
  const pixel = world === "training";
  if (!pixel) {
    const Icon = item.lucide;
    return (
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={side ? "ios-side-item" : "ios-tab"}
        data-active={active ? "true" : undefined}
      >
        {Icon ? <Icon size={side ? 20 : 23} strokeWidth={1.75} aria-hidden /> : <span aria-hidden>{item.icon}</span>}
        <span className="truncate">{t(item.label)}</span>
        {item.soon && <span className={`ios-chip ${side ? "ms-auto" : "hidden"}`}>{t("nav.soon")}</span>}
      </Link>
    );
  }
  // --- Training branch: the existing code, unchanged ---
  const shape = "rounded-[2px] border-2";
  const base = side
    ? `flex items-center gap-3 ${shape} px-3 py-2 text-[0.95rem] font-semibold no-underline`
    : `flex min-w-0 flex-1 flex-col items-center gap-0.5 ${shape} px-1 py-1 text-[0.7rem] font-semibold no-underline`;
  const tone = active
    ? "border-edge bg-panel-2 text-gold shadow-[3px_3px_0_var(--edge)]"
    : "border-transparent text-ink-2 hover:bg-panel-2";
  const soon = item.soon ? "text-muted" : "";
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined} className={`${base} ${tone} ${soon}`}>
      <span aria-hidden className={side ? "w-6 text-center" : "text-lg leading-none"}>{item.icon}</span>
      <span className="truncate">{t(item.label)}</span>
      {item.soon && <span className={`px-chip px-1 text-[0.6rem] ${side ? "ms-auto" : ""}`}>{t("nav.soon")}</span>}
    </Link>
  );
}
```

Replace `TabBar()`:

```tsx
function TabBar() {
  const { t } = useT();
  const { world, items, current } = useNav();
  const pixel = world === "training";
  const visible = items.filter((i) => !i.desktopOnly);
  const ref = useRef<HTMLElement>(null);
  const activeIndex = visible.findIndex((i) => i.href === current);

  // Social: the glass lens sits under the active tab; measured once per layout, moved on transform only.
  useLayoutEffect(() => {
    if (pixel) return;
    const nav = ref.current;
    const ind = nav?.querySelector<HTMLElement>("[data-indicator]");
    if (!nav || !ind) return;
    const place = () => {
      const a = nav.querySelectorAll<HTMLElement>(".ios-tab")[Math.max(0, activeIndex)];
      if (!a) return;
      ind.style.width = `${a.offsetWidth}px`;
      ind.style.setProperty("--x", `${a.offsetLeft}px`);
    };
    place();
    ind.classList.remove("pulse");
    void ind.offsetWidth;
    ind.classList.add("pulse");
    const ro = new ResizeObserver(place);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [pixel, activeIndex, visible.length]);

  if (pixel) {
    return (
      <nav aria-label={t("nav.main")} className="border-edge bg-panel fixed inset-x-0 bottom-0 z-30 flex gap-1 border-t-[3px] px-2 pt-1.5 pb-[calc(6px+env(safe-area-inset-bottom,0px))] md:hidden" data-testid="tabbar">
        {visible.map((item) => <NavEntry key={item.href} item={item} variant="tab" active={item.href === current} world={world} />)}
      </nav>
    );
  }
  return (
    <nav ref={ref} aria-label={t("nav.main")} className="ios-tabbar glass md:hidden" data-testid="tabbar">
      <i className="ios-ind" data-indicator data-testid="tab-indicator" aria-hidden />
      {visible.map((item) => <NavEntry key={item.href} item={item} variant="tab" active={item.href === current} world={world} />)}
    </nav>
  );
}
```

(`useLayoutEffect`, `useRef` join the React import.) `SideNav` keeps its markup; only its class string becomes
`pixel ? <existing> : "ios-side sticky top-[80px] hidden h-fit w-[210px] shrink-0 flex-col gap-1 pt-6 md:flex"`.

- [ ] **Step 4: Shell CSS** (inside the Social `@layer components` block):

```css
  /* Top area: clear at rest, glass capsules; slab + compact title once scrolled. */
  .ios-top {
    position: sticky;
    top: 0;
    z-index: 30;
  }
  .ios-top-bg {
    position: absolute;
    inset: 0;
    opacity: 0;
    transition: opacity var(--t-med) var(--out);
    pointer-events: none;
  }
  [data-compact] .ios-top-bg {
    opacity: 1;
  }
  .ios-top-title {
    position: absolute;
    inset-inline: 0;
    top: 0;
    height: 56px;
    display: grid;
    place-items: center;
    font-weight: 600;
    font-size: 17px;
    opacity: 0;
    transform: translateY(8px) scale(0.96);
    transition:
      opacity var(--t-med) var(--out),
      transform var(--t-spring) var(--spring);
    pointer-events: none;
  }
  [data-compact] .ios-top-title {
    opacity: 1;
    transform: none;
  }
  .ios-top-brand {
    display: inline-flex;
    text-decoration: none;
  }
  .ios-icbtn {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: var(--ink);
    text-decoration: none;
    transition: transform var(--t-fast) var(--out);
  }
  .ios-icbtn:active {
    transform: scale(0.9);
  }
  /* Launch choreography (useLaunch): boot = hidden, in = springs into place, then the attribute is removed. */
  .ios-top-brand, .ios-world, .ios-top-end {
    transition:
      opacity 0.5s var(--out),
      transform 0.7s var(--spring);
  }
  [data-launch="boot"] :is(.ios-top-brand, .ios-world, .ios-top-end) {
    opacity: 0;
    transform: translateY(-14px);
    transition: none;
  }
  [data-launch="in"] .ios-world { transition-delay: 0.07s; }
  [data-launch="in"] .ios-top-end { transition-delay: 0.13s; }
  [data-launch="boot"] .ios-tabbar {
    transform: translateY(160%);
    transition: none;
  }
  [data-launch="in"] .ios-tabbar {
    transition-delay: 0.22s;
  }
  [data-launch="boot"] .ios-lt {
    opacity: 0;
    transform: translateY(14px);
    transition: none;
  }
  .ios-lt {
    transition:
      opacity 0.6s var(--out) 0.05s,
      transform 0.8s var(--spring) 0.05s;
  }

  /* Tab bar: floating glass capsule, lens under the active tab, minimizes on scroll down. */
  .ios-tabbar {
    position: fixed;
    inset-inline: 14px;
    bottom: calc(12px + env(safe-area-inset-bottom, 0px));
    height: 64px;
    border-radius: 999px;
    display: flex;
    padding: 6px;
    z-index: 30;
    transform-origin: 50% 100%;
    transition: transform var(--t-spring) var(--spring);
  }
  [data-tabbar="mini"] .ios-tabbar {
    transform: translateY(10px) scale(0.88);
  }
  .ios-tab {
    position: relative;
    z-index: 1;
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    border-radius: 999px;
    color: var(--ink-2);
    font-size: 11px;
    font-weight: 600;
    text-decoration: none;
    transition:
      color var(--t-med) var(--out),
      transform var(--t-fast) var(--out);
  }
  .ios-tab > span {
    max-width: 100%;
    transition:
      opacity 0.25s var(--out),
      transform 0.3s var(--out);
  }
  [data-tabbar="mini"] .ios-tab > span {
    opacity: 0;
    transform: translateY(5px);
  }
  .ios-tab[data-active="true"] {
    color: var(--tint);
  }
  .ios-tab:active {
    transform: scale(0.9);
  }
  .ios-tab > svg {
    transition: transform var(--t-spring) var(--spring);
  }
  .ios-tab[data-active="true"] > svg {
    transform: translateY(-1px) scale(1.08);
    animation: ios-bounce 0.6s var(--spring);
  }
  .ios-ind {
    position: absolute;
    top: 6px;
    bottom: 6px;
    left: 0;
    width: 0;
    transform: translateX(var(--x, 0px));
    transition: transform var(--t-spring) var(--spring);
  }
  .ios-ind::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 999px;
    background: var(--lens);
    box-shadow: var(--lens-shadow);
  }
  .ios-ind.pulse::before {
    animation: ios-lens 0.55s var(--out);
  }

  /* Sidebar (md+): solid rows, lens-style active row. */
  .ios-side-item {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    padding: 0 12px;
    border-radius: 12px;
    color: var(--ink-2);
    font-size: 15px;
    font-weight: 500;
    text-decoration: none;
    transition:
      background-color var(--t-fast) var(--out),
      color var(--t-fast) var(--out),
      transform var(--t-fast) var(--out);
  }
  .ios-side-item:hover {
    background: var(--panel);
  }
  .ios-side-item:active {
    transform: scale(0.98);
  }
  .ios-side-item[data-active="true"] {
    background: var(--panel);
    color: var(--tint);
    box-shadow: var(--shadow-sm);
    font-weight: 600;
  }
```

Also add the two keyframes next to the others: `@keyframes ios-bounce { 35% { transform: translateY(-5px) scale(1.18); } }`
and `@keyframes ios-lens { 35% { transform: scaleX(1.24) scaleY(0.9); } }`. The main content needs room under the
floating bar: `.pb-safe-tabbar` already pads by `--tabbar-h + 24px`; in Social set `--tabbar-h: 76px` on
`:root[data-world="social"]` (Task 1.3 block) so content clears the capsule.

- [ ] **Step 5: Run the shell tests**

Run: `E2E_PORT=3141 pnpm.cmd e2e e2e/social-look.spec.ts e2e/world.spec.ts e2e/layout.spec.ts`
Expected: PASS on phone and desktop (`world.spec` still finds `a[href="/social/calendar/"]` inside `tabbar` / `sidenav`).

- [ ] **Step 6: Commit** `feat(social): glass top area, floating tab bar, sidebar, scroll chrome, launch`.

### Task 2.3: WorldSwitch as a glass capsule in Social

**Files:**
- Modify: `components/shell/WorldSwitch.tsx`

- [ ] **Step 1:** Keep the Training branch. In the Social branch render:

```tsx
<div role="group" aria-label={t("world.switch")} data-testid="world-switch" className="ios-world glass flex gap-0.5 rounded-full p-[3px]">
  {WORLDS.map((w) => {
    const on = w.id === world;
    const Icon = w.id === "training" ? Gamepad2 : Smartphone;
    return (
      <button key={w.id} type="button" aria-pressed={on} aria-label={t(w.full)} title={t(w.full)} onClick={() => go(w.id)} data-testid={`world-${w.id}`}
        className={`ios-world-btn ${on ? "on" : ""}`}>
        <Icon size={20} strokeWidth={1.75} aria-hidden />
      </button>
    );
  })}
</div>
```

CSS (Social block): `.ios-world-btn { position: relative; width: 40px; height: 34px; border-radius: 999px; display: grid; place-items: center; color: var(--ink-2); transition: color var(--t-med) var(--out), transform var(--t-fast) var(--out); } .ios-world-btn:active { transform: scale(.92); } .ios-world-btn.on { background: var(--lens); box-shadow: var(--lens-shadow); color: var(--tint); }`

`world.spec.ts` clicks `world-training` / `world-social` by test id and reads `aria-pressed`: unchanged.

- [ ] **Step 2:** Run `E2E_PORT=3141 pnpm.cmd e2e e2e/world.spec.ts` → PASS. **Step 3: Commit** `feat(social): glass world switch with icons`.

### Task 2.4: Language and sound move into More (Social)

**Files:**
- Modify: `components/shell/MoreScreen.tsx` (Social branch only)
- Test: `components/shell/MoreScreen.test.ts` (link order unchanged; add a check that the two controls exist in Social)

- [ ] **Step 1:** Read `MoreScreen.tsx`. In the Social world it renders a list of `Link.px-card` rows per `SOCIAL_NAV_ITEMS`
  (desktop-only items). Keep that list and its order (the unit test checks hrefs in order). Below the links add a
  `ListGroup header={t("more.quick")}` with two `ListRow`s: language (`Languages` icon; trailing
  `<Segmented options={[{value:"ar",label:"عربي"},{value:"en",label:"EN"}]} value={lang} onChange={(l) => setSettings({ lang: l })} label={t("top.lang")} role="radiogroup" className="w-[118px]" />`
  with `data-testid="lang-ar"` / `lang-en` on the options, since `settings.spec`/`world.spec` may click them) and sound
  (`Volume2` icon; trailing `<Switch checked={sound} onChange={(v) => setSettings({ sound: v })} label={t(sound ? "top.soundOn" : "top.soundOff")} testId="sound-toggle" />`).
  Add keys `more.quick` = `الإعدادات السريعة` / `Quick settings` to `messages/ar.json` and `messages/en.json`.
- [ ] **Step 2:** grep the e2e for `lang-en`, `lang-ar`, `sound-toggle` (`settings.spec.ts`, `world.spec.ts`, `layout.spec.ts`): any test that clicks them while on a Social route must now open `/social/more/` first; update those tests accordingly (Training routes still have them in the top bar).
- [ ] **Step 3:** `pnpm.cmd test components/shell && E2E_PORT=3141 pnpm.cmd e2e e2e/world.spec.ts e2e/settings.spec.ts e2e/layout.spec.ts` → PASS.
- [ ] **Step 4: Commit** `feat(social): language and sound controls in More`.

### Task 2.5: Phase 2 gates, screenshots, PR

- [ ] Run all gates (`pnpm.cmd lint && pnpm.cmd typecheck && pnpm.cmd test && pnpm.cmd build && E2E_PORT=3141 pnpm.cmd e2e`), take the phone screenshots of `/social/` in both schemes at scroll 0 and scroll 400 (compact), and open PR "Social iOS look 2/8: shell" with the same body pattern as Task 1.13.

---

# Phase 3 — Studio (branch `claude/social-ios-3-studio`)

Reference: the Studio panel of the mockup (hero with ring, reminder row, week plan, growth snapshot with sparkline,
inbox list, asks list). Keep every `data-testid` the Studio e2e uses (`studio-screen`, the hero's, `.studio-wday`,
`[data-today]`, `data-count`).

### Task 3.1: Page header and layout

**Files:**
- Modify: `components/social/StudioScreen.tsx`

- [ ] **Step 1:** Replace the `<header>` with
  `<PageHeader eyebrow={eyebrow} title={t("social.studio.title")} sub={t("social.studio.sub")} />` where
  `eyebrow = new Intl.DateTimeFormat(lang === "ar" ? "ar-SA-u-ca-gregory-nu-arab" : "en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date(nowMinute))`.
  Wrap the cards in `<div className="ios-stagger flex flex-col gap-3 md:grid md:grid-cols-[1.6fr_1fr] …">` keeping
  the current responsive grid (hero + reminder on one row from md; week plan + toolkit; growth / asks / inbox three
  columns from md). Add `usePullToRefresh` here:

```tsx
const configured = useStore((s) => scoutConfig(s.settings.apiKeys.scoutUrl, s.settings.apiKeys.scoutToken) !== null);
const { toast } = useCelebrate();
const { pull, refreshing } = usePullToRefresh(async () => {
  if (configured) await syncSocialNow();
  toast("notice", { icon: "🔄", name: t("social.studio.refreshed") });
});
```

  with `<div className="ios-ptr glass" data-spin={refreshing ? "true" : undefined} style={{ opacity: Math.min(1, pull / 70), transform: `translate(-50%, ${pull * 0.55}px) scale(${0.6 + 0.4 * Math.min(1, pull / 70)}) rotate(${Math.min(1, pull / 70) * 180}deg)` }} aria-hidden>{refreshing ? <LoaderCircle size={18} strokeWidth={1.75} /> : <ArrowDown size={18} strokeWidth={1.75} />}</div>`
  rendered once at the top of the screen. New key `social.studio.refreshed` = `تم التحديث الحين` / `Refreshed just now`
  in `messages/social.{ar,en}.json`. The toast icon string stays an emoji only until phase 8 swaps the toast API to icons; pass `icon: ""` if the Social toast renders an `ios-toast` with its own check icon (see Task 1.12).
- [ ] **Step 2:** `E2E_PORT=3141 pnpm.cmd e2e e2e/studio.spec.ts` → PASS. **Step 3: Commit** `feat(studio): iOS page header, stagger, pull to refresh`.

### Task 3.2: Next post hero

**Files:**
- Modify: `components/social/studio/NextPostHero.tsx`, `app/globals.css` (`.studio-hero*` rules → iOS values)

- [ ] **Step 1:** Render `<Card hero testId=<existing>>`: header row = `t("social.studio.heroLabel")` + a platform `Chip tone="tint" icon={<PlatformGlyph platform size={13} />}`; body row = title (19px/700), the countdown line in `text-tint font-semibold text-[14px]`, the "today at / best time" line in `text-ink-2 text-[13px]`; at the end side a 60px SVG ring (`r=24`, `stroke-width 5`, `stroke-dasharray 150.8`, `stroke-dashoffset = 150.8 × (1 − remaining / 48h)`, transition `stroke-dashoffset 1.4s var(--out)`, `transform: rotate(-90deg)`); actions = primary `px-btn` (`CalendarPlus` 18px + `t("social.studio.heroCta")` without its emoji — strip the "📅 " in the string now for this key only, both languages) and `px-btn px-btn-ghost` "افتح في التقويم". Empty state (no post): title `heroEmpty`, hint `heroHint`, same primary button, no ring. Overdue: the countdown line in `text-warn` with a `Clock` icon.
- [ ] **Step 2:** Replace the `.studio-hero` CSS block with: `.studio-hero h3 { font-size: 19px; font-weight: 700; line-height: 1.3; letter-spacing: -0.01em; }` and remove the old gradient/border rules (the `ios-hero` ambient replaces them).
- [ ] **Step 3:** `E2E_PORT=3141 pnpm.cmd e2e e2e/studio.spec.ts -g "hero|countdown|next post"` → PASS. **Commit** `feat(studio): iOS hero card with progress ring`.

### Task 3.3: Reminder, week plan, growth snapshot

**Files:**
- Modify: `components/social/studio/ReminderCard.tsx`, `WeekPlanCard.tsx`, `GrowthSnapshotCard.tsx`, `app/globals.css` (`.studio-week`, `.studio-wday`, `.studio-pdot`)

- [ ] **Step 1 — Reminder:** `<Card>` with `.ios-gh`-style header `t("social.studio.reminder")` (emoji stripped from the key in both languages) and one `ListRow`-like row inside the card (`className="ios-row bare"` → add `.ios-row.bare { padding: 0; min-height: 0; }` to the CSS): `Clock` in an `ios-ic`, title = the reminder line, sub = the flame line, trailing = `px-btn px-btn-ghost px-btn-sm` "للتدريب" with a `Flame` icon.
- [ ] **Step 2 — Week plan:** keep `.studio-week` as a 7-column grid and **keep the `.studio-wday` class, `data-today` and `data-count` attributes** on the 7 cells (the e2e counts them). Restyle in CSS: `.studio-wday { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 0 6px; border-radius: 14px; border: 0; background: none; } .studio-wday small { font-size: 11px; color: var(--muted); font-weight: 600; } .studio-wday b { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 50%; font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; transition: background-color var(--t-med) var(--out), color var(--t-med) var(--out), transform var(--t-spring) var(--spring); } .studio-wday[data-today="true"] b { background: var(--accent); color: var(--accent-ink); } .studio-pdot { width: 6px; height: 6px; border-radius: 50%; background: var(--pc, var(--muted)); }` (replace the fixed hex at the old `.studio-pdot`). Header trailing link = `px-link` "التقويم" + `ChevronLeft 14`. Footer chips: `Chip tone="tint" icon={<Check size={12} />}` for `weekPosted`, default chip for unplanned.
- [ ] **Step 3 — Growth snapshot:** two `StatTile`s (`growthFollowers`, `growthViews`; `value` numbers from the store, `suffix` "K"/"M" via the existing `format.ts` helpers: pass the scaled number and suffix separately), delta line = `TrendingUp 13` + `.num` + " · ٣٠ يوم" in `ios-delta`; a 70px-tall SVG sparkline of the last 30 days (reuse `LineChart` with a `mini` prop added in phase 5; until then draw the path here with the same smoothing: `M x0 y0`, then `Q` to midpoints, `T` last) that draws itself once (`stroke-dasharray = getTotalLength()` → `stroke-dashoffset 0` with `transition 1.3s var(--out)` after a double `requestAnimationFrame`; skip the animation when `prefersReducedMotion()`); the "fastest growing" line with a `Trophy 15` icon in `text-warn`. Empty state: `EmptyState icon={<TrendingUp />} title={t("social.studio.growthEmpty")} action={<Link className="px-btn px-btn-ghost px-btn-sm" href="/social/growth">{t("social.studio.growthAdd")}</Link>} />`.
- [ ] **Step 4:** `E2E_PORT=3141 pnpm.cmd e2e e2e/studio.spec.ts` → PASS (7 `.studio-wday`, `data-today`, `data-count`). **Commit** `feat(studio): reminder row, week strip, growth tiles with sparkline`.

### Task 3.4: Inbox and asks as grouped lists

**Files:**
- Modify: `components/social/studio/InboxCard.tsx`, `AsksCard.tsx`, `TikTokToolkitCard.tsx`

- [ ] **Step 1 — Inbox:** `<ListGroup header={t("social.studio.inbox")} testId=<existing>>` with one `ListRow` per item: overdue → `Clock` + `iconTone="warn"`; unscheduled → `Film`; manual publish → `Rocket`; ideas waiting → `Lightbulb`; stale stats → `TrendingUp` + `iconTone="fill"`; each `href` to its target (calendar `#post=`, ideas, growth) and `chevron`. Empty: a single row with `Check` and `inboxClear`. Strip the leading emoji from `social.studio.inbox*` keys in both languages now.
- [ ] **Step 2 — Asks:** `<ListGroup header={t("social.studio.asks")}>`, rows with `MessageCircle`, title = the ask, sub = `asksMentions`; trailing = `px-btn px-btn-ghost px-btn-sm` with `Sparkles 14` + `asksToIdea` (emoji stripped) or `Chip tone="tint"` `asksInIdeas` when already an idea. On click: keep the existing "turn into idea" action, then swap the button for the chip with the class `ios-pop` (`.ios-pop { animation: ios-pop .45s var(--spring); }`).
- [ ] **Step 3 — TikTok toolkit card:** `<Card>` with a `PlatformBadge platform="tiktok" size={34}` next to its title; buttons → `px-btn` classes (already), remove any emoji in its JSX (use `Sparkles`, `Link` icons as fitting).
- [ ] **Step 4:** `E2E_PORT=3141 pnpm.cmd e2e e2e/studio.spec.ts e2e/creator.spec.ts` → PASS. **Commit** `feat(studio): inbox and asks as grouped lists`.

### Task 3.5: Phase 3 gates and PR

- [ ] Gates, screenshots (`/social/` light + dark, top and scrolled), PR "Social iOS look 3/8: Studio".

---

# Phase 4 — Calendar + the Sheet system (branch `claude/social-ios-4-calendar`)

Reference: the Calendar panel of the mockup (segmented Week · Month · Stages, swipeable week strip, posts grouped by
day with platform badges and stage chips, "+" glass button, the new-post sheet). Contracts to keep: `.post-card` with
the open button as its **first** `<button>` (12 e2e places), `data-testid`s of `CalendarScreen`, `PostSheet`,
`PostForm`, the `#post=<id>` and `#day=` hash deep links.

### Task 4.1: Calendar header, segmented views, platform filter

**Files:**
- Modify: `components/social/CalendarScreen.tsx`, `app/globals.css` (`.cal-tabs`, `.cal-tab`, `.cal-fchip`)

- [ ] **Step 1:** `<PageHeader title={t("calendar.title")} sub={t("calendar.sub")} />` (keys as they exist in
  `messages/calendar.ar.json`; strip their leading emoji in both languages). Replace the `.cal-tabs` tablist with
  `<Segmented options={VIEWS.map((v) => ({ value: v, label: t(`calendar.view.${v}`), testId: `cal-view-${v}` }))} value={view} onChange={setView} label={t("calendar.views")} />`
  — first read the existing test ids / roles the calendar e2e uses for the view tabs (`grep -n "cal-view\|role=\"tab\"\|getByRole(\"tab\"" e2e/calendar.spec.ts`) and keep those exact ids / roles (Segmented renders `role="tab"` + `aria-selected`, which matches a `getByRole("tab", { name })` query).
- [ ] **Step 2:** Platform filter chips stay `.px-fchip` (already pill-styled by Task 1.4); replace the emoji inside them with `PlatformGlyph platform size={14}` and drop the fixed hex in `.cal-fchip` for `var(--pc)` set from `PLATFORM_META[p].color`.
- [ ] **Step 3:** `E2E_PORT=3141 pnpm.cmd e2e e2e/calendar.spec.ts -g "view|filter|week|month|stages"` → PASS. **Commit** `feat(calendar): iOS header, segmented views, glyph filters`.

### Task 4.2: Week strip, day groups, month grid, stages

**Files:**
- Modify: `components/social/calendar/WeekView.tsx`, `MonthView.tsx`, `StagesBoard.tsx`, `calendar/PostCard.tsx`, `app/globals.css` (`.cal-week`, `.cal-day`, `.post-card`, `.cal-month`, `.month-day`, `.cal-board`, `.cal-col`)

- [ ] **Step 1 — Week strip:** render three weeks (previous, current, next) in `<div className="ios-weeks">` (`display:flex; gap:32px; overflow-x:auto; scroll-snap-type:x mandatory; scrollbar-width:none; margin:0 -16px; padding:0 16px;` children `flex:0 0 100%; scroll-snap-align:start`), each week a 7-column grid of day buttons styled like `.studio-wday` (Task 3.3; reuse the same CSS by giving the cells both classes `cal-day studio-wday`), with platform dots from the day's posts. On mount scroll the current week into view: `ref.current?.scrollIntoView({ inline: "start", block: "nearest" })`. Selecting a day keeps the existing `focusDay` state and the `#day=` hash. The existing week grid of post cards stays below, grouped by day.
- [ ] **Step 2 — Post card:** keep the element `className="post-card …"` and its first child `<button>` that opens the post; inside render `PlatformBadge platform={post.platform}` (40px), title (15px/500, ellipsis), sub = time · platform name, trailing = stage `Chip` (`tint` for scheduled/posted, `warn` for overdue/unplanned, default otherwise). CSS: `.post-card { display:flex; align-items:center; gap:12px; min-height:58px; padding:11px 16px; border:0; background:var(--panel); } .post-card + .post-card::before { hairline as .ios-row }` (day groups wrap their cards in `.ios-list`).
- [ ] **Step 3 — Month grid:** `.cal-month { display:grid; grid-template-columns:repeat(7,1fr); gap:4px; } .month-day { min-height:52px; border:0; border-radius:14px; background:var(--panel); padding:6px; box-shadow:var(--shadow-sm); } .month-day[data-today="true"] b { background:var(--accent); color:var(--accent-ink); border-radius:50%; }` with 6px platform dots (`--pc`).
- [ ] **Step 4 — Stages:** `.cal-board { display:flex; gap:12px; overflow-x:auto; scroll-snap-type:x mandatory; margin:0 -16px; padding:0 16px 8px; } .cal-col { flex:0 0 min(86vw, 320px); scroll-snap-align:start; background:var(--panel); border-radius:var(--radius); box-shadow:var(--shadow); padding:12px; }`, column header = stage name + count `Chip`.
- [ ] **Step 5:** `E2E_PORT=3141 pnpm.cmd e2e e2e/calendar.spec.ts e2e/autopost.spec.ts e2e/creator.spec.ts` → PASS (the first `<button>` inside `.post-card` still opens the post). **Commit** `feat(calendar): iOS week strip, post rows, month grid, stages`.

### Task 4.3: Post popup and new-post form as Sheets, Back closes

**Files:**
- Modify: `components/social/calendar/PostSheet.tsx`, `PostForm.tsx`, `SheetFrame.tsx` (becomes a thin wrapper), `CalendarScreen.tsx:76` (`open`), `components/skills/SkillSheet.tsx:68`
- Modify: `app/globals.css` (`.cal-sheet` rules → delete)

- [ ] **Step 1 — SheetFrame delegates to Sheet:** keep `SheetFrame`'s props (`testId`, `titleId`, `onClose`, `wide`, `attrs`, `children`) so `PostSheet`, `PostForm` and `CreatorAssistant` do not change their call sites; inside, in the Social world render `<Sheet open onClose={onClose} title={title} titleId={titleId} testId={testId} attrs={attrs} detents={wide ? [0.92] : [0.6, 0.92]} initialDetent={0}>{children}</Sheet>` — this needs the title: add a `title: string` prop to `SheetFrame` and pass it from the three callers (they already render an `<h2 id={titleId}>`; move that text into the prop and delete the `<h2>`). Keep `data-testid="sheet-backdrop"` (the overlay) because the e2e clicks it to close.
- [ ] **Step 2 — Tabs inside the post sheet:** `PostSheet` renders its Overview · Script · Shots tabs with `<Segmented role="tablist" …>`; read the test ids the e2e uses for those tabs first and pass them as `testId` on each option.
- [ ] **Step 3 — Back closes, deep link kept:** in `CalendarScreen.tsx` change `open()` from `history.replaceState(null, "", postHash(id))` to `history.pushState(null, "", postHash(id))` and `close()` to `history.back()` **when** `window.location.hash.startsWith("#post=")`, else `clearHash()`; keep the `hashchange` listener (going back to a URL without the hash sets `openId` to null through `apply()`: add `if (!h.post) setOpenId(null)` there). Because `Sheet` also calls `useBackToClose`, remove that hook call inside `Sheet` when the caller passes `historyManaged` → simpler: give `Sheet` a prop `backCloses?: boolean` (default `true`) and pass `backCloses={false}` from `SheetFrame` when `attrs?.["data-post"]` is set (the post popup manages history itself). Check `e2e/calendar.spec.ts` for tests that read `location.hash` after closing and keep them green.
- [ ] **Step 4 — SkillSheet corner:** in `components/skills/SkillSheet.tsx:68` replace `md:rounded-[2px]` with `md:rounded-[var(--radius)]` (Training's `--radius` is 2px, so Training is unchanged).
- [ ] **Step 5:** `E2E_PORT=3141 pnpm.cmd e2e e2e/calendar.spec.ts e2e/autopost.spec.ts e2e/creator.spec.ts e2e/mastery.spec.ts` → PASS. **Commit** `feat(calendar): post popup and new post as iOS sheets, Back closes`.

### Task 4.4: The "+" glass button and the linked-skill chip

**Files:**
- Modify: `components/social/CalendarScreen.tsx`, `components/social/calendar/PostCard.tsx:48`, `e2e/calendar.spec.ts:167`

- [ ] **Step 1:** Render `<button type="button" className="ios-fab glass" data-show="true" aria-label={t("calendar.newPost")} data-testid="cal-new-post" onClick={() => setDraft({ day: focusDay })}><Plus size={26} strokeWidth={1.75} /></button>` on phones (`md:hidden`); the desktop keeps the existing "+ New post" button in the header (`px-btn`). Read the existing test id of the new-post button and reuse it on the fab if the phone project clicks it.
- [ ] **Step 2:** `PostCard.tsx:48` renders "📎🎮" for a post linked to a skill: replace with `<Chip icon={<Gamepad2 size={12} />} data-testid="post-linked-skill">{t("calendar.linkedSkill")}</Chip>` (add the key: `مرتبط بمهارة` / `Linked skill`). Update `e2e/calendar.spec.ts:167` to `await expect(card.getByTestId("post-linked-skill")).toBeVisible()`.
- [ ] **Step 3:** `E2E_PORT=3141 pnpm.cmd e2e e2e/calendar.spec.ts` → PASS. **Commit** `feat(calendar): glass new-post button, linked-skill chip`.

### Task 4.5: Phase 4 gates and PR

- [ ] Gates, screenshots (`/social/calendar/` week + month + stages, the post sheet at both heights, light + dark), PR "Social iOS look 4/8: Calendar and sheets".

---

# Phase 5 — Growth (branch `claude/social-ios-5-growth`)

Reference: the Growth panel of the mockup (segmented platforms, 2×2 stat tiles with count-up, 90-day chart that draws
itself with finger scrub + glass tooltip, top posts list). Contracts: `growth.spec.ts:265` expects the chart to be an
`svg`; file inputs and the CSV import flow keep their test ids.

### Task 5.1: Header, platform segmented, KPI tiles

**Files:**
- Modify: `components/social/GrowthScreen.tsx`, `growth/PlatformFilter.tsx`, `growth/KpiRow.tsx`, `app/globals.css` (`.gr-tabs`, `.gr-tab`, `.an-overview`, `.an-kpi`)

- [ ] **Step 1:** `<PageHeader title={t("social.growth.title")} sub={t("social.growth.sub")} />` (strip emoji from the keys). `PlatformFilter` → `<Segmented role="tablist" options={[all, ...platforms]} …>` where each platform option's label is `<span className="inline-flex items-center gap-1"><PlatformGlyph platform size={13} />{L(PLATFORM_META[p].name)}</span>`; keep the option test ids the e2e uses (`grep -n "gr-tab\|platform-tab" e2e/growth.spec.ts`). On narrow phones six segments overflow: wrap the Segmented in `<div className="overflow-x-auto -mx-4 px-4 scrollbar-none">` and give it `min-w-[520px]`.
- [ ] **Step 2:** `KpiRow` → `<div className="grid grid-cols-2 gap-2 md:grid-cols-4">` of `StatTile`s (`className="ios-card"` so they are white cards on the page ground: in the mockup the Growth tiles are cards, the Studio ones insets). Values: followers, 30-day views (`K`/`M` suffix from `growth/format.ts`), engagement `%` with `decimals={1}`, posts this month with the goal as the delta (`text-muted`).
- [ ] **Step 3:** `E2E_PORT=3141 pnpm.cmd e2e e2e/growth.spec.ts -g "tabs|kpi|overview|platform"` → PASS. **Commit** `feat(growth): iOS header, platform segmented, stat tiles`.

### Task 5.2: LineChart draw-on and scrub

**Files:**
- Modify: `components/social/growth/LineChart.tsx` (keep its `ChartSeries` / `ChartPoint` interfaces), `app/globals.css` (`.an-chart*`)

- [ ] **Step 1 — props:** add `scrub?: boolean` and `mini?: boolean` to the component props. Keep rendering `<svg>` (test).
- [ ] **Step 2 — draw-on:** for each series path, after mount: `const L = path.getTotalLength(); path.style.strokeDasharray = `${L}`; path.style.strokeDashoffset = `${L}`;` then on the second `requestAnimationFrame` set `path.style.transition = "stroke-dashoffset 1.3s var(--out)"; path.style.strokeDashoffset = "0";` (skip when `prefersReducedMotion()`); area fill `opacity 0 → 1` with `transition: opacity .9s var(--out) .5s`; end dot `transform: scale(0) → 1` with `transition: transform .5s var(--spring) 1.1s` (`transform-box: fill-box; transform-origin: center`). Re-run when `series` changes (dependency on a stable key of the series ids + last values).
- [ ] **Step 3 — scrub:** when `scrub`, add `<line class="an-mk">` (dashed, `stroke: var(--muted)`), `<circle class="an-mkd" r="5">` (fill `var(--panel)`, stroke `var(--accent)` 3) and a `<div className="an-tip glass">` positioned absolutely inside the chart card (`position:absolute; top:44px; left:0; transform:translate(-50%, 6px); opacity:0; transition: opacity .2s var(--out), transform .2s var(--out)` → `.on { opacity:1; transform:translate(-50%,0) }`), with `<b className="num">` value and `<small>` date (`Intl.DateTimeFormat(lang === "ar" ? "ar-u-ca-gregory-nu-latn" : "en-GB", { day: "numeric", month: "long" })`, "اليوم" / "Today" for the last point). Pointer handlers on the `<svg>` (`touch-action: none` only when `scrub`): on `pointerdown`/`pointermove` (mouse: always; touch: only while pressed) compute the nearest index of the first series by x, move the marker and the dot, set the tooltip text and `left` (clamped 60px from both card edges), add `.on`; hide 900ms after `pointerup` / `pointerleave` / `pointercancel`. Chart text (ticks) must use `fill: var(--muted)`; grid lines `stroke: var(--hair)`.
- [ ] **Step 4 — mini:** when `mini`, hide axes/ticks and the legend, height 70, pad 8 (used by the Studio sparkline: switch `GrowthSnapshotCard` to `<LineChart mini series={[…]} />` in this task and delete the hand-drawn path from Task 3.3).
- [ ] **Step 5:** `pnpm.cmd test components/social/growth && E2E_PORT=3141 pnpm.cmd e2e e2e/growth.spec.ts e2e/studio.spec.ts` → PASS. **Commit** `feat(growth): chart draw-on and finger scrub with glass tooltip`.

### Task 5.3: Platform cards, posts, forms as sheets, dialogs as alerts

**Files:**
- Modify: `growth/PlatformTab.tsx`, `growth/PlatformCards.tsx`, `growth/PostCard.tsx`, `growth/MyContent.tsx`, `growth/SnapshotForm.tsx`, `growth/CsvImport.tsx`, `growth/PostImport.tsx`, `growth/DemographicsForm.tsx`, `growth/GrowthDialog.tsx`, `growth/AudienceAsks.tsx`, `growth/SourceBadge.tsx`, `growth/AiButton.tsx`, `app/globals.css` (`.an-*`, `.gr-cta`, `.src-badge`, `.acc-spin`)

- [ ] **Step 1 — GrowthDialog → Sheet:** `GrowthDialog` keeps its props and renders `<Sheet open onClose title titleId testId detents={[0.92]}>` in Social (it is Social-only, so no world branch is needed). The four users (snapshot form, CSV import, post import, demographics form) therefore open as full-height sheets; their `ConfirmDialog`s are already iOS alerts (Task 1.12).
- [ ] **Step 2 — Platform cards:** `.an-pcard` → `ios-card` with a `PlatformBadge` header, handle as `text-ink-2`, numbers as `StatTile`s (`countUp={false}` inside lists to avoid 20 animations at once), the per-platform chart with `scrub`.
- [ ] **Step 3 — Top posts:** `growth/PostCard.tsx` rows → `ListRow` with `icon={<PlatformBadge platform size={40} />}` (pass `iconTone="fill"` and let the badge override the square: give `ListRow` an `iconRaw?: ReactNode` prop rendered without the `ios-ic` wrapper — add it to `List.tsx`), sub = relative date, trailing = `Chip icon={<Eye size={13} />}` with the view count in `.num`.
- [ ] **Step 4 — Asks, tips, badges:** `AudienceAsks` → `ListGroup` with `MessageCircle` rows and the same "turn into idea" button as Studio; `SourceBadge` → `Chip` (`tint` for live, default for manual); `AiButton` → `px-btn px-btn-ghost px-btn-sm` with `Sparkles`; `.acc-spin` keeps its spinner but uses `LoaderCircle` with `ios-spin`; replace every emoji in these files' JSX with the matching Lucide icon (`➕` → `Plus`, flags in `Demographics.tsx:234` stay — they are content).
- [ ] **Step 5:** `pnpm.cmd test && E2E_PORT=3141 pnpm.cmd e2e e2e/growth.spec.ts e2e/accounts.spec.ts` → PASS. **Commit** `feat(growth): cards, posts, forms as sheets`.

### Task 5.4: Phase 5 gates and PR

- [ ] Gates, screenshots (`/social/growth/` all + one platform, the CSV sheet, light + dark), PR "Social iOS look 5/8: Growth".

---

# Phase 6 — Ideas + More (branch `claude/social-ios-6-ideas-more`)

### Task 6.1: Ideas screen

**Files:**
- Modify: `components/social/IdeasScreen.tsx`, `ideas/IdeaRow.tsx`, `ideas/AddIdeaForm.tsx`, `ideas/SkillSuggestions.tsx`, `ideas/TrendsCard.tsx`, `trends/TrendRow.tsx`, `trends/TrendRadar.tsx`, `trends/MomentsRail.tsx`, `app/globals.css` (`.studio-seg`, `.studio-pfilter`, `.studio-pbtn`, `.trend-row`)

- [ ] **Step 1:** `<PageHeader title sub />` (emoji stripped from `ideas.*` title keys). Filters: the `.studio-seg` becomes `Segmented` (status: all · favorites · waiting · used; keep test ids), the platform filter stays `.px-fchip` with glyphs.
- [ ] **Step 2 — IdeaRow with swipe-to-favorite:** wrap each row: `<div className="ios-swipe" data-armed={armed} data-dragging={dragging}><div className="ios-act"><Star size={22} /></div><div className="ios-row" style={{ transform: `translateX(${x}px)` }} {...handlers}>…</div></div>` using `useSwipeAction(() => toggleFavorite(idea.id))`; title + sub (source: `MessageCircle` for comments, `TrendingUp` for trends, `Sparkles` for skills, `RefreshCw` when used, with counts in `.num`); trailing = the star button (`className="ios-starb"` → CSS: `.ios-starb { width:40px; height:40px; border-radius:50%; display:grid; place-items:center; color:var(--muted); transition: transform var(--t-fast) var(--out), color .2s; } .ios-starb[aria-pressed="true"] { color: var(--warn); } .ios-starb[aria-pressed="true"] svg { fill: var(--warn); } .ios-starb:active { transform: scale(.85); }`) that gets `ios-pop` re-applied on each favorite. Replace `⭐⏳🔄` in JSX with `Star` / `Clock` / `RefreshCw`.
- [ ] **Step 3 — Add idea:** `AddIdeaForm` opens inside a `Sheet` (`detents={[0.6, 0.92]}`) from a full-width `px-btn` "فكرة جديدة" with `Plus`; the form's fields use `px-input` (iOS field style from Task 1.4).
- [ ] **Step 4 — Trend Radar:** `TrendsCard`/`TrendRadar` → `ListGroup header=<radar title>`, `TrendRow` → `ListRow` with `iconRaw={<PlatformBadge platform size={34} />}`, sub = metric line, trailing = `Chip` (`tint` for rising) + the action menu (`TrendActions`) as `px-btn px-btn-ghost px-btn-sm`. `MomentsRail` cards → `ios-card` in a snap rail (`.ios-rail { display:flex; gap:12px; overflow-x:auto; scroll-snap-type:x mandatory; margin:0 -16px; padding:0 16px 6px; } .ios-rail > * { flex:0 0 72%; scroll-snap-align:start; }`).
- [ ] **Step 5:** `pnpm.cmd test components/social/trends && E2E_PORT=3141 pnpm.cmd e2e e2e/trends.spec.ts e2e/studio.spec.ts` → PASS. **Commit** `feat(ideas): grouped lists, swipe to favorite, trend rail`.

### Task 6.2: More screen

**Files:**
- Modify: `components/shell/MoreScreen.tsx` (Social branch), `components/shell/MoreScreen.test.ts`

- [ ] **Step 1:** Social branch renders: `<PageHeader title={t("morePage.title")} sub={t("morePage.sub")} />`; `ListGroup` 1 = Replies (`MessageCircle`), Automations (`Rocket`), Discover (`Search`); `ListGroup` 2 = Website (`Globe`, `Chip` "قريب", `iconTone="fill"`), Business (`Briefcase`, same); `ListGroup` 3 (`more.quick`) = the language and sound rows from Task 2.4 + "كل الإعدادات" (`Settings`, chevron, `/settings`); `ListGroup` 4 = "ارجع للتدريب" (`Gamepad2`, `href="/"`) with sub `t("world.backToTrainingHint")` (new key: `عالمك البكسلي كما هو` / `Your pixel world, as it is`). **Keep the link order the unit test asserts** (compare with the test's expected hrefs and adjust the groups' order to match, not the test).
- [ ] **Step 2:** `pnpm.cmd test components/shell && E2E_PORT=3141 pnpm.cmd e2e e2e/world.spec.ts e2e/layout.spec.ts` → PASS. **Commit** `feat(more): grouped lists in the Social More screen`.

### Task 6.3: Phase 6 gates and PR

- [ ] Gates, screenshots (`/social/ideas/`, `/social/more/`, light + dark), PR "Social iOS look 6/8: Ideas and More".

---

# Phase 7 — Replies, Automations, Website, Business (branch `claude/social-ios-7-replies-automations`)

### Task 7.1: Auto replies

**Files:**
- Modify: `components/social/AutoRepliesScreen.tsx`, `replies/RulesTable.tsx`, `replies/RuleEditor.tsx`, `replies/DefaultReplyEditor.tsx`, `replies/PhonePreview.tsx:34`, `replies/PostGrid.tsx:44`

Contracts: `getByRole("switch", { name, exact: true })` (`autoreplies.spec.ts:533`), the `<details>`/`<summary>` tester (`:582`), `getByRole("heading", { name: "تعديل الرد التلقائي" })` (`:381`), `input[type="radio"]` tiles.

- [ ] **Step 1:** `<PageHeader …>` (emoji stripped from `replies.*` title keys). `RulesTable` → `ListGroup` of `ListRow`s: title = keyword, sub = reply preview (one line, ellipsis), trailing = `<Switch checked label={<same accessible name as today>} />` (the accessible name must stay byte-identical to what the test passes: read `autoreplies.spec.ts:533` and keep the `aria-label` text), chevron opens the editor.
- [ ] **Step 2:** `RuleEditor` and `DefaultReplyEditor` open in `<Sheet detents={[0.92]} title={t("replies.editTitle")}>` so the `<h2>` heading text "تعديل الرد التلقائي" stays (Sheet renders `Drawer.Title` as an `h2`); the platform picker tiles keep `input[type="radio"]`; the "قدّم الصورة 2" button keeps its name.
- [ ] **Step 3:** `PhonePreview.tsx:34` `rounded-[28px] border-2` → `rounded-[28px] border border-hair bg-panel-2`; `PostGrid.tsx:44` `border-2` → `border border-hair`; replace `💬📌📣🕒` in JSX with `MessageCircle` / `Pin` / `Megaphone` / `Clock` (all in lucide-react). The tester stays a `<details>` block; style `summary` as an `ios-row` with a chevron.
- [ ] **Step 4:** `E2E_PORT=3141 pnpm.cmd e2e e2e/autoreplies.spec.ts` → PASS. **Commit** `feat(replies): grouped rules with switches, editor as a sheet`.

### Task 7.2: Automations

**Files:**
- Modify: `components/social/AutoPostScreen.tsx`, `components/social/calendar/TikTokFinishCard.tsx:36`, `e2e/autopost.spec.ts:440`

Contracts: `li[data-platform]` (`autopost.spec.ts:425`), `getByRole("link", { name: "الإعدادات", exact: true })` (`:514`), the cancel-schedule button text.

- [ ] **Step 1:** `<PageHeader …>` (emoji stripped). Accounts section → `ListGroup` with `iconRaw={<PlatformBadge …/>}` rows and status `Chip`s; the queue → `ListGroup` with the post title, sub = when/where, trailing = stage `Chip`; keep each queue entry an `<li data-platform=…>` inside the list (`ListRow` can be given `as="li"`: add an `as?: "div" | "li"` prop to `ListRow` for the plain variant). The "copied" inline label → `toast("notice", …)`.
- [ ] **Step 2:** The cancel-schedule button text "❌ إلغاء الجدولة" → "إلغاء الجدولة" with an `X` icon; update `e2e/autopost.spec.ts:440` to `getByRole("button", { name: "إلغاء الجدولة" })`. `TikTokFinishCard.tsx:36` `border-amber-500` → `border-warn` with `bg-warn-bg`. Remove `✋` and other JSX emoji here (use `Hand` from lucide for the manual-publish hint).
- [ ] **Step 3:** `E2E_PORT=3141 pnpm.cmd e2e e2e/autopost.spec.ts e2e/accounts.spec.ts` → PASS. **Commit** `feat(automations): grouped accounts and queue, alerts, toast`.

### Task 7.3: Website and Business "soon" cards

**Files:**
- Modify: `components/social/SoonScreen.tsx:13,19`

- [ ] **Step 1:** `<PageHeader title sub />` and one `Card` with `ios-ic fill` holding `Globe` or `Briefcase` (replace the `🌐` / `💼` at lines 13 and 19), the explanation copy, and a `Chip` "قريب". **Step 2:** `E2E_PORT=3141 pnpm.cmd e2e e2e/world.spec.ts` → PASS. **Commit** `feat(social): soon cards with icons`.

### Task 7.4: Phase 7 gates and PR

- [ ] Gates, screenshots (`/social/replies/` list + editor sheet, `/social/automations/`, light + dark), PR "Social iOS look 7/8: Replies, Automations, Soon".

---

# Phase 8 — Emoji sweep, test updates, performance pass (branch `claude/social-ios-8-sweep`)

### Task 8.1: Strip leading emoji from the Social message files

**Files:**
- Create: `scripts/strip-emoji.mjs` (one-off, committed for the record)
- Modify: `messages/{social,publish,ideas,calendar,trends,replies,growth}.{ar,en}.json`, `messages/{ar,en}.json` (keys `world.training`, `world.social`, `nav.*` have no emoji; `morePage.*` are Training: leave them)

- [ ] **Step 1:** Write the script:

```js
// scripts/strip-emoji.mjs — removes a leading emoji (and its joiners / variation selectors / following space)
// from every value of the given message files. Usage: node scripts/strip-emoji.mjs messages/social.ar.json …
import { readFileSync, writeFileSync } from "node:fs";

const LEAD = /^(?:(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:️|‍(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}))*\s*)+/u;
let total = 0;
for (const file of process.argv.slice(2)) {
  const json = JSON.parse(readFileSync(file, "utf8"));
  let n = 0;
  for (const [k, v] of Object.entries(json)) {
    if (typeof v !== "string") continue;
    const out = v.replace(LEAD, "");
    if (out !== v) {
      json[k] = out;
      n++;
    }
  }
  writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
  console.log(`${file}: ${n} values`);
  total += n;
}
console.log(`total ${total}`);
```

- [ ] **Step 2:** Run it on the 14 Social files, then `git diff --stat messages/` and read the diff: numbers must match per language pair (e.g. `social.ar.json: 32` and `social.en.json: 32`). Values that **end** with an emoji (`countdownNow` "الحين! 🚀", `inboxClear` "كل شي تمام ✨", `reminderNoPost` "… 🎥") are left for a manual pass: remove those trailing emoji by hand in both languages where the component now shows an icon, keep them where they are the owner's playful copy (`countdownNow` keeps 🚀).
- [ ] **Step 3:** `pnpm.cmd test messages` → PASS (parity unchanged). Then run the whole e2e: any test that matched text with an emoji fails here and is fixed by removing the emoji from the expectation (list them in the PR). **Commit** `chore(social): strip leading emoji from Social strings`.

### Task 8.2: JSX emoji → icons, `PLATFORM_META.icon` readers, font link

**Files:**
- Modify: the remaining files from the inventory grep (`grep -rnP "[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}\x{2B50}\x{203C}-\x{3299}]" components/social components/shell/MoreScreen.tsx components/shell/AppShell.tsx components/shell/WorldSwitch.tsx`), `app/layout.tsx` (`FONTS_CSS`)

- [ ] **Step 1:** For each hit in a Social file replace the glyph with the Lucide icon named in the spec §3.6 (or the `PlatformGlyph` for platform emoji from `PLATFORM_META[p].icon`); `AppShell.tsx:114-123` toast icons (`🔗 🔄 ⚠️`) stay strings but in Social the `ios-toast` renders a leading `Check`/`TriangleAlert` icon chosen from the kind instead of the string — implement that mapping in the toast component (`kind === "notice" && payload.icon === "⚠️"` → `TriangleAlert`, else `Check`). Training keeps the emoji strings.
- [ ] **Step 2:** Remove `IBM+Plex+Sans+Arabic` from `FONTS_CSS` in `app/layout.tsx` after `grep -rn "Plex" app components lib` returns only comments; update those comments.
- [ ] **Step 3:** `grep -rnP "[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]" components/social components/ui/ios` → no hits except `Demographics.tsx` flags. Add to `e2e/social-look.spec.ts`:

```ts
test("Social navigation has no emoji", async ({ page }) => {
  await freshState(page, "/social/more/");
  const text = await page.evaluate(
    () => (document.querySelector('[data-testid="tabbar"], [data-testid="sidenav"]')?.textContent ?? "") +
      (document.querySelector("main")?.querySelector("h1")?.textContent ?? ""),
  );
  expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
});
```

- [ ] **Step 4:** All gates → PASS. **Commit** `feat(social): icons instead of emoji everywhere in Social`.

### Task 8.3: iPhone performance pass and status

- [ ] **Step 1:** Build and serve (`pnpm.cmd build && npx serve@latest out -l 3141`), open on the owner's iPhone over the LAN, or in Safari's Responsive Design Mode with the Timelines tab: scroll Studio for 10s with the tab bar and slab visible → frame rate stays at 60 fps and no layout thrash in the timeline; if not, lower `--glass-blur` to 16px for `.ios-tabbar` first, then drop the top slab's blur on phones (`@media (max-width: 767px) { .ios-top-bg { -webkit-backdrop-filter: none; backdrop-filter: none; background: color-mix(in srgb, var(--bg) 92%, transparent); } }`) and record which fallback was needed in the PR.
- [ ] **Step 2:** Check "Reduce Motion" and "Reduce Transparency" on the iPhone: nothing moves, bars are solid.
- [ ] **Step 3:** Update `planning/tools/18-social-ios-design.md` **Status** to "built (rounds 35 → 35h, PRs #…)" and add a one-line entry under round 35 in `planning/master-plan.md` listing the eight PRs. **Commit** `docs: Social iOS look shipped` and open PR "Social iOS look 8/8: sweep and performance".

---

## Self-review (done while writing; keep for the executor)

- Spec coverage: §3.1 tokens → Task 1.3; §3.2 type → 1.2, 1.4 (`.ios-lt`, sizes), 8.2 (Plex removed); §3.3 shape → 1.4; §3.4 glass → 1.4 (+ allowed surfaces 2.2, 4.4, 5.2, 3.1); §3.5 motion → 1.4, 1.5, 1.10, 2.2 (launch, title, tab bar), 3.x (count-up, ring, draw), 4.3 (sheet), 6.1 (swipe), reduced motion (1.3 tokens + hooks); §3.6 icons → 1.11, 2.1, per screen, 8.2; §4 shell → 2.2–2.4; §5 primitives → 1.6–1.10 (+ `iconRaw`, `as` props added in 5.3 and 7.2); §6 screens → phases 3–7; §7 sweep → 8.1–8.2; §8 tests → 1.2, 1.3, 2.2, 4.4, 7.2, 8.1, 8.2; §11 acceptance → 8.3; §12 follow-ups stay out.
- Names used across tasks: `useChrome.setTitle`, `useScrollChrome(enabled, resetKey)`, `usePullToRefresh(onRefresh, { enabled, threshold, targetRef })`, `useSwipeAction(onTrigger, { max, arm, enabled })` → `{ handlers, x, armed, dragging }`, `useCountUp(target, { decimals, duration, enabled })`, `Segmented({ options, value, onChange, label, role, className, testId })`, `Switch({ checked, onChange, label, disabled, testId, id })`, `Sheet({ open, onClose, title, sub, titleId, testId, detents, initialDetent, footer, attrs, children, backCloses })`, `ListRow({ icon, iconRaw, iconTone, title, sub, trailing, chevron, href, onClick, testId, className, as })`, `StatTile({ label, value, decimals, suffix, prefix, delta, countUp, className, testId })`, `PlatformBadge({ platform, size, className })`, `PlatformGlyph({ platform, size, className })`, `PageHeader({ title, sub, eyebrow, trailing, testId })`, `Card({ hero, pressable, className, testId })`, `Chip({ tone, icon, className })`, `EmptyState({ icon, title, hint, action, testId })`. `pickDetent` (1.5) is used by nothing after vaul took over snapping; keep it tested, delete it in Task 8.2 if still unused.
- Placeholders: the only literal placeholders are the six `<paste … d>` strings in Task 1.11, filled by that task's curl step before the file is committed.

