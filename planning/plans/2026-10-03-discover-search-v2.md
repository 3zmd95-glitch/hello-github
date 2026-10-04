# Discover search v2 + Claude connector — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discover answers one search with sections (Popular now, Examples, Tutorials, Creators, Claude's picks) from
planned English + Arabic queries, and the Scout Worker exposes the same search to Claude through an MCP connector.

**Architecture:** A new `src/discover/` pipeline in the Scout Worker (plan from a bundled editing dictionary → Tavily
and YouTube searches with retries and a daily YouTube cap → labels, creators → one JSON answer, cached 6 h in KV) behind
`POST /discover`. The dashboard calls it once per search when the Worker says it can (`/health` → `discover: true`) and
renders sections; without that it keeps today's path. Part B wraps the Worker in `@cloudflare/workers-oauth-provider`
and serves `/mcp` with the Agents SDK's stateless `createMcpHandler`, whose tools call the same pipeline.

**Tech Stack:** Cloudflare Workers (wrangler 4, free plan, KV), TypeScript strict, Vitest (plain Node for the Worker,
plain unit tests for `lib/`), Next.js static export + React + Tailwind, Playwright.

**Spec:** `planning/tools/13-discover-search-v2.md` (read it first; this plan argues from it).

## Global Constraints

- Free plans only: Worker free plan (≤ 50 subrequests per invocation, KV 1,000 writes/day), Tavily 1,000 credits/month
  (owner may enable pay-as-you-go), YouTube `search.list` 100 calls/day per project (radar keeps 18).
- Worker unit tests run in **plain Node** (`workers/scout/vitest.config.ts`): no Workers runtime, no `cloudflare:*`
  imports in any module a test imports.
- No new dashboard dependency. Worker dependencies are added only in Part B (the MCP and OAuth packages).
- `/search`, `/oembed`, `/trends*`, `/social/*`, `/go/*` and the cron behave exactly as before.
- Dashboard copy: friendly Hijazi Arabic first, English second; every key exists in both `*.ar.json` and `*.en.json`
  (`messages/messages.test.ts` enforces parity and placeholders).
- Quality gates before any push: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm e2e`.
- On this Windows machine run pnpm as `pnpm.cmd` from Git Bash (`pnpm.ps1` is blocked by the execution policy).
  E2E with a dev server already on port 3000: `E2E_PORT=3100 pnpm.cmd e2e`.
- Every executing agent runs on Opus 5.5 (owner's instruction, master plan round 32).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on branch `claude/discover-search-v2`.

## File map

| File | Responsibility |
| --- | --- |
| `planning/data/edit-terms.json` (new) | The editing dictionary (owner-editable) |
| `workers/scout/src/discover/terms.ts` (new) | Load + validate the dictionary, match what was typed |
| `workers/scout/src/discover/plan.ts` (new) | Request → search plan (queries, understood, alternatives, on-topic words) |
| `workers/scout/src/normalize.ts` (modify) | `published` on cards, `profileFromUrl`, `normalizeDiscoverHits` |
| `workers/scout/src/discover/fetchers.ts` (new) | One Tavily call, one YouTube `search.list` call, the daily YouTube reservation |
| `workers/scout/src/discover/label.ts` (new) | Sections, off-topic, creators |
| `workers/scout/src/discover/run.ts` (new) | The pipeline + 6 h KV answer cache |
| `workers/scout/src/discover/usage.ts` (new) | Tavily `/usage` + today's counters |
| `workers/scout/src/discover/routes.ts` (new) | `POST /discover`, `GET /discover/usage` (Part B adds `/discover/picks`) |
| `workers/scout/src/discover/types.ts` (new) | Shared request / response types |
| `workers/scout/src/scout.ts` (modify) | Route `/discover*`, `discover: true` on `/health` |
| `lib/scoutClient.ts` (modify) | Export the authenticated `scoutCall`, health capabilities |
| `lib/discover.ts` (new) | Client types, request builder, cache, section / tab / popular helpers |
| `components/research/useDiscover.ts` (new) | Hooks: capability check, the search, usage |
| `components/research/DiscoverSections.tsx` (new) | The sections UI |
| `components/research/ResearchPanel.tsx` (modify) | Use v2 when the Worker can |
| `components/research/ResultCard.tsx` (modify) | Lazy TikTok thumbnail via `/oembed` |
| `messages/search.ar.json`, `messages/search.en.json` (new), `lib/i18n.ts` (modify) | Copy |
| `e2e/discover.spec.ts` (new) | Playwright for v2 |
| Part B: `workers/scout/src/discover/picks.ts`, `tools.ts`, `auth.ts`, `mcp.ts`, `src/index.ts`, `wrangler.jsonc`, `.github/workflows/worker.yml`, `workers/scout/package.json`, `components/research/PicksSection.tsx` | Picks, connector, deploy wiring |

---

# Part A — Discover search v2

### Task 1: The editing dictionary and its matcher

**Files:**
- Create: `planning/data/edit-terms.json`
- Create: `workers/scout/src/discover/terms.ts`
- Test: `workers/scout/src/discover/terms.test.ts`
- Modify: `.github/workflows/worker.yml` (watch the new file)

**Interfaces:**
- Consumes: `normalizeForMatch(text: string): string` from `workers/scout/src/social/replies.ts`.
- Produces:
  ```ts
  export type Lang = "ar" | "en";
  export interface LangText { ar: string; en: string }
  export type TermKind = "transition" | "effect" | "color" | "audio" | "technique" | "style" | "photo";
  export interface EditTerm { id: string; kind: TermKind; label: LangText; match: { ar: string[]; en: string[] };
    specific: boolean; queries: { examples: LangText; tutorials: LangText } }
  export const TERMS: readonly EditTerm[];
  export function parseTerms(file: unknown): EditTerm[];
  export interface TermMatch { best?: EditTerm; others: EditTerm[]; rest: string[] }
  export function matchTerms(q: string, terms?: readonly EditTerm[]): TermMatch;
  export const INTENT_WORDS: ReadonlySet<string>;
  ```

- [ ] **Step 1: Write the dictionary**

Create `planning/data/edit-terms.json` (order matters: on equal-length matches the earlier entry wins):

```json
[
  { "id": "flash-transition", "kind": "transition", "label": { "en": "flash transition", "ar": "انتقال فلاش" }, "match": { "en": ["flash", "flash transition", "flash cut", "flash effect", "white flash"], "ar": ["فلاش", "انتقال فلاش", "تأثير فلاش", "فلاش ابيض"] }, "specific": false, "queries": { "examples": { "en": "flash transition edit", "ar": "ايديت انتقال فلاش" }, "tutorials": { "en": "flash transition tutorial capcut davinci", "ar": "شرح تأثير فلاش مونتاج" } } },
  { "id": "camera-flash", "kind": "photo", "label": { "en": "camera flash photography", "ar": "تصوير بالفلاش" }, "match": { "en": ["flash", "camera flash", "flash photography", "direct flash"], "ar": ["فلاش", "فلاش الكاميرا", "تصوير بالفلاش"] }, "specific": false, "queries": { "examples": { "en": "direct flash photography", "ar": "تصوير بالفلاش" }, "tutorials": { "en": "camera flash photography tutorial", "ar": "شرح التصوير بالفلاش" } } },
  { "id": "match-cut", "kind": "transition", "label": { "en": "match cut", "ar": "ماتش كت" }, "match": { "en": ["match cut", "matchcut", "match cuts", "match cut transition"], "ar": ["ماتش كت", "قص متطابق"] }, "specific": true, "queries": { "examples": { "en": "match cut transition edit", "ar": "ايديت ماتش كت" }, "tutorials": { "en": "match cut tutorial", "ar": "شرح ماتش كت مونتاج" } } },
  { "id": "speed-ramp", "kind": "technique", "label": { "en": "speed ramp", "ar": "سبيد رامب" }, "match": { "en": ["speed ramp", "speed ramping", "speedramp"], "ar": ["سبيد رامب", "تسريع وتبطيء"] }, "specific": true, "queries": { "examples": { "en": "speed ramp edit", "ar": "ايديت سبيد رامب" }, "tutorials": { "en": "speed ramp tutorial capcut", "ar": "شرح سبيد رامب كاب كت" } } },
  { "id": "velocity", "kind": "style", "label": { "en": "velocity edit", "ar": "ايديت فيلوسيتي" }, "match": { "en": ["velocity", "velocity edit"], "ar": ["فيلوسيتي"] }, "specific": false, "queries": { "examples": { "en": "velocity edit", "ar": "ايديت فيلوسيتي" }, "tutorials": { "en": "velocity edit tutorial capcut", "ar": "شرح فيلوسيتي كاب كت" } } },
  { "id": "color-grading", "kind": "color", "label": { "en": "color grading", "ar": "تلوين سينمائي" }, "match": { "en": ["color grading", "colour grading", "color grade", "grading"], "ar": ["تلوين", "تلوين سينمائي", "تصحيح الالوان", "كلر قريدنق"] }, "specific": true, "queries": { "examples": { "en": "cinematic color grading reel", "ar": "تلوين سينمائي" }, "tutorials": { "en": "color grading tutorial davinci resolve", "ar": "شرح تلوين دافنشي ريزولف" } } },
  { "id": "mask-transition", "kind": "transition", "label": { "en": "mask transition", "ar": "انتقال ماسك" }, "match": { "en": ["mask transition", "masking transition", "mask effect"], "ar": ["انتقال ماسك", "ماسك"] }, "specific": true, "queries": { "examples": { "en": "mask transition edit", "ar": "ايديت انتقال ماسك" }, "tutorials": { "en": "mask transition tutorial", "ar": "شرح انتقال ماسك" } } },
  { "id": "whip-pan", "kind": "transition", "label": { "en": "whip pan", "ar": "ويب بان" }, "match": { "en": ["whip pan", "whip transition", "swish pan"], "ar": ["ويب بان"] }, "specific": true, "queries": { "examples": { "en": "whip pan transition edit", "ar": "ايديت ويب بان" }, "tutorials": { "en": "whip pan transition tutorial", "ar": "شرح انتقال ويب بان" } } },
  { "id": "zoom-transition", "kind": "transition", "label": { "en": "zoom transition", "ar": "انتقال زوم" }, "match": { "en": ["zoom", "zoom transition", "zoom in transition", "zoom effect"], "ar": ["زوم", "انتقال زوم"] }, "specific": false, "queries": { "examples": { "en": "zoom transition edit", "ar": "ايديت انتقال زوم" }, "tutorials": { "en": "zoom transition tutorial capcut", "ar": "شرح انتقال زوم" } } },
  { "id": "jl-cut", "kind": "technique", "label": { "en": "J cut and L cut", "ar": "جي كت وال كت" }, "match": { "en": ["j cut", "l cut", "j-cut", "l-cut", "split edit"], "ar": ["جي كت", "ال كت"] }, "specific": true, "queries": { "examples": { "en": "j cut l cut example", "ar": "ايديت جي كت" }, "tutorials": { "en": "j cut l cut tutorial", "ar": "شرح جي كت وال كت" } } },
  { "id": "glitch", "kind": "effect", "label": { "en": "glitch effect", "ar": "تأثير قليتش" }, "match": { "en": ["glitch", "glitch effect", "glitch transition"], "ar": ["قليتش", "تأثير قليتش"] }, "specific": false, "queries": { "examples": { "en": "glitch effect edit", "ar": "ايديت قليتش" }, "tutorials": { "en": "glitch effect tutorial", "ar": "شرح تأثير قليتش" } } },
  { "id": "light-leak", "kind": "effect", "label": { "en": "light leak", "ar": "لايت ليك" }, "match": { "en": ["light leak", "light leaks"], "ar": ["لايت ليك", "تسريب ضوء"] }, "specific": true, "queries": { "examples": { "en": "light leak transition edit", "ar": "ايديت لايت ليك" }, "tutorials": { "en": "light leak tutorial", "ar": "شرح لايت ليك" } } },
  { "id": "film-burn", "kind": "transition", "label": { "en": "film burn", "ar": "فيلم بيرن" }, "match": { "en": ["film burn", "burn transition"], "ar": ["فيلم بيرن", "حرق فيلم"] }, "specific": true, "queries": { "examples": { "en": "film burn transition edit", "ar": "ايديت فيلم بيرن" }, "tutorials": { "en": "film burn transition tutorial", "ar": "شرح انتقال فيلم بيرن" } } },
  { "id": "freeze-frame", "kind": "effect", "label": { "en": "freeze frame", "ar": "فريز فريم" }, "match": { "en": ["freeze frame", "freeze effect"], "ar": ["فريز فريم", "تجميد اللقطة"] }, "specific": true, "queries": { "examples": { "en": "freeze frame edit", "ar": "ايديت فريز فريم" }, "tutorials": { "en": "freeze frame tutorial", "ar": "شرح فريز فريم" } } },
  { "id": "split-screen", "kind": "effect", "label": { "en": "split screen", "ar": "تقسيم الشاشة" }, "match": { "en": ["split screen", "splitscreen"], "ar": ["سبليت سكرين", "تقسيم الشاشة"] }, "specific": true, "queries": { "examples": { "en": "split screen edit", "ar": "ايديت تقسيم الشاشة" }, "tutorials": { "en": "split screen tutorial", "ar": "شرح تقسيم الشاشة" } } },
  { "id": "rotoscope", "kind": "technique", "label": { "en": "rotoscoping", "ar": "روتوسكوب" }, "match": { "en": ["rotoscope", "rotoscoping", "roto"], "ar": ["روتوسكوب"] }, "specific": true, "queries": { "examples": { "en": "rotoscope edit", "ar": "ايديت روتوسكوب" }, "tutorials": { "en": "rotoscoping tutorial", "ar": "شرح روتوسكوب" } } },
  { "id": "chroma-key", "kind": "technique", "label": { "en": "green screen", "ar": "كروما" }, "match": { "en": ["chroma key", "chromakey", "green screen"], "ar": ["كروما", "كروما كي", "شاشة خضراء"] }, "specific": true, "queries": { "examples": { "en": "green screen edit", "ar": "ايديت كروما" }, "tutorials": { "en": "chroma key tutorial", "ar": "شرح كروما" } } },
  { "id": "beat-sync", "kind": "technique", "label": { "en": "beat sync", "ar": "ايديت على البيت" }, "match": { "en": ["beat sync", "beat sync edit", "edit to the beat", "beat edit"], "ar": ["بيت سينك", "ايديت على البيت", "مونتاج على الايقاع"] }, "specific": true, "queries": { "examples": { "en": "beat sync edit", "ar": "ايديت على البيت" }, "tutorials": { "en": "beat sync tutorial capcut", "ar": "شرح بيت سينك كاب كت" } } },
  { "id": "motion-blur", "kind": "effect", "label": { "en": "motion blur", "ar": "موشن بلر" }, "match": { "en": ["motion blur"], "ar": ["موشن بلر", "ضبابية الحركة"] }, "specific": true, "queries": { "examples": { "en": "motion blur edit", "ar": "ايديت موشن بلر" }, "tutorials": { "en": "motion blur tutorial", "ar": "شرح موشن بلر" } } },
  { "id": "camera-shake", "kind": "effect", "label": { "en": "camera shake", "ar": "اهتزاز الكاميرا" }, "match": { "en": ["shake", "camera shake", "shake effect"], "ar": ["شيك", "اهتزاز الكاميرا", "تأثير الاهتزاز"] }, "specific": false, "queries": { "examples": { "en": "camera shake effect edit", "ar": "ايديت اهتزاز" }, "tutorials": { "en": "camera shake effect tutorial", "ar": "شرح تأثير الاهتزاز" } } },
  { "id": "smooth-slowmo", "kind": "technique", "label": { "en": "smooth slow motion", "ar": "سلو موشن ناعم" }, "match": { "en": ["slow motion", "slowmo", "smooth slow motion", "optical flow"], "ar": ["سلو موشن", "حركة بطيئة"] }, "specific": false, "queries": { "examples": { "en": "smooth slow motion edit", "ar": "ايديت سلو موشن" }, "tutorials": { "en": "smooth slow motion optical flow tutorial", "ar": "شرح سلو موشن ناعم" } } },
  { "id": "text-animation", "kind": "effect", "label": { "en": "text animation", "ar": "تحريك النص" }, "match": { "en": ["text animation", "animated text", "kinetic typography", "text effect"], "ar": ["انيميشن نص", "تحريك النص", "نص متحرك"] }, "specific": true, "queries": { "examples": { "en": "text animation edit", "ar": "ايديت نص متحرك" }, "tutorials": { "en": "text animation tutorial capcut", "ar": "شرح تحريك النص" } } },
  { "id": "captions", "kind": "style", "label": { "en": "captions", "ar": "الكتابة على الفيديو" }, "match": { "en": ["captions", "subtitles", "auto captions"], "ar": ["ترجمة", "كابشن", "الكتابة على الفيديو"] }, "specific": false, "queries": { "examples": { "en": "captions style reel", "ar": "ستايل كتابة على الفيديو" }, "tutorials": { "en": "captions tutorial capcut", "ar": "شرح الكتابة على الفيديو" } } },
  { "id": "sound-design", "kind": "audio", "label": { "en": "sound design", "ar": "مؤثرات صوتية" }, "match": { "en": ["sound design", "sfx", "sound effects"], "ar": ["تصميم صوت", "مؤثرات صوتية"] }, "specific": true, "queries": { "examples": { "en": "sound design edit", "ar": "ايديت مؤثرات صوتية" }, "tutorials": { "en": "sound design tutorial video editing", "ar": "شرح المؤثرات الصوتية مونتاج" } } },
  { "id": "lut", "kind": "color", "label": { "en": "LUTs", "ar": "اللوتات" }, "match": { "en": ["lut", "luts", "color lut"], "ar": ["لوت", "لوتات"] }, "specific": false, "queries": { "examples": { "en": "cinematic lut before after", "ar": "لوت سينمائي" }, "tutorials": { "en": "how to use luts davinci resolve", "ar": "شرح استخدام اللوت" } } },
  { "id": "day-for-night", "kind": "color", "label": { "en": "day for night", "ar": "تحويل النهار لليل" }, "match": { "en": ["day for night"], "ar": ["نهار الى ليل", "تحويل النهار لليل"] }, "specific": true, "queries": { "examples": { "en": "day for night color grading", "ar": "تحويل النهار لليل" }, "tutorials": { "en": "day for night tutorial davinci resolve", "ar": "شرح تحويل النهار لليل" } } },
  { "id": "teal-orange", "kind": "color", "label": { "en": "teal and orange", "ar": "تيل اورنج" }, "match": { "en": ["teal and orange", "teal orange"], "ar": ["تيل اورنج", "ازرق وبرتقالي"] }, "specific": true, "queries": { "examples": { "en": "teal and orange color grade", "ar": "تلوين تيل اورنج" }, "tutorials": { "en": "teal and orange tutorial", "ar": "شرح تلوين تيل اورنج" } } },
  { "id": "film-grain", "kind": "effect", "label": { "en": "film grain", "ar": "حبيبات الفيلم" }, "match": { "en": ["grain", "film grain"], "ar": ["قرين", "حبيبات الفيلم"] }, "specific": false, "queries": { "examples": { "en": "film grain look edit", "ar": "ايديت حبيبات فيلم" }, "tutorials": { "en": "film grain tutorial davinci", "ar": "شرح اضافة قرين" } } },
  { "id": "film-look", "kind": "style", "label": { "en": "film look", "ar": "لوك سينمائي" }, "match": { "en": ["film look", "cinematic look", "filmic look"], "ar": ["لوك سينمائي", "ستايل سينمائي"] }, "specific": true, "queries": { "examples": { "en": "cinematic film look edit", "ar": "لوك سينمائي" }, "tutorials": { "en": "film look tutorial davinci resolve", "ar": "شرح لوك سينمائي" } } },
  { "id": "smooth-transition", "kind": "transition", "label": { "en": "smooth transitions", "ar": "انتقالات ناعمة" }, "match": { "en": ["transitions", "smooth transition", "seamless transition"], "ar": ["انتقالات", "انتقال ناعم", "انتقالات سلسة"] }, "specific": false, "queries": { "examples": { "en": "smooth transitions edit", "ar": "ايديت انتقالات ناعمة" }, "tutorials": { "en": "smooth transition tutorial capcut", "ar": "شرح انتقالات ناعمة" } } },
  { "id": "zoom-3d", "kind": "effect", "label": { "en": "3D zoom / parallax", "ar": "زوم ثلاثي الابعاد" }, "match": { "en": ["3d zoom", "3d photo effect", "parallax", "2.5d"], "ar": ["زوم ثلاثي الابعاد", "بارالاكس"] }, "specific": true, "queries": { "examples": { "en": "3d zoom parallax edit", "ar": "ايديت بارالاكس" }, "tutorials": { "en": "3d zoom parallax tutorial capcut", "ar": "شرح زوم ثلاثي الابعاد" } } },
  { "id": "clone-effect", "kind": "effect", "label": { "en": "clone effect", "ar": "تأثير الاستنساخ" }, "match": { "en": ["clone effect", "clone trick", "cloning"], "ar": ["استنساخ", "تأثير الاستنساخ"] }, "specific": true, "queries": { "examples": { "en": "clone effect video", "ar": "تأثير الاستنساخ فيديو" }, "tutorials": { "en": "clone effect tutorial", "ar": "شرح تأثير الاستنساخ" } } },
  { "id": "invisible-cut", "kind": "transition", "label": { "en": "invisible cut", "ar": "قص مخفي" }, "match": { "en": ["invisible cut", "hidden cut", "seamless cut"], "ar": ["قص مخفي", "انفزبل كت"] }, "specific": true, "queries": { "examples": { "en": "invisible cut transition edit", "ar": "ايديت قص مخفي" }, "tutorials": { "en": "invisible cut tutorial", "ar": "شرح القص المخفي" } } },
  { "id": "broll", "kind": "technique", "label": { "en": "cinematic b-roll", "ar": "بي رول سينمائي" }, "match": { "en": ["b-roll", "b roll", "broll", "cinematic b roll"], "ar": ["بي رول", "لقطات بي رول"] }, "specific": true, "queries": { "examples": { "en": "cinematic b roll", "ar": "بي رول سينمائي" }, "tutorials": { "en": "how to shoot b roll", "ar": "شرح تصوير بي رول" } } },
  { "id": "hyperlapse", "kind": "technique", "label": { "en": "hyperlapse", "ar": "هايبرلابس" }, "match": { "en": ["hyperlapse", "hyper lapse"], "ar": ["هايبرلابس"] }, "specific": true, "queries": { "examples": { "en": "hyperlapse edit", "ar": "هايبرلابس" }, "tutorials": { "en": "hyperlapse tutorial", "ar": "شرح هايبرلابس" } } },
  { "id": "stop-motion", "kind": "technique", "label": { "en": "stop motion", "ar": "ستوب موشن" }, "match": { "en": ["stop motion", "stopmotion"], "ar": ["ستوب موشن"] }, "specific": true, "queries": { "examples": { "en": "stop motion video", "ar": "ستوب موشن" }, "tutorials": { "en": "stop motion tutorial", "ar": "شرح ستوب موشن" } } },
  { "id": "timelapse", "kind": "technique", "label": { "en": "timelapse", "ar": "تايم لابس" }, "match": { "en": ["timelapse", "time lapse"], "ar": ["تايم لابس"] }, "specific": true, "queries": { "examples": { "en": "timelapse video", "ar": "تايم لابس" }, "tutorials": { "en": "timelapse tutorial", "ar": "شرح تايم لابس" } } },
  { "id": "dolly-zoom", "kind": "technique", "label": { "en": "dolly zoom", "ar": "دولي زوم" }, "match": { "en": ["dolly zoom", "vertigo effect"], "ar": ["دولي زوم"] }, "specific": true, "queries": { "examples": { "en": "dolly zoom effect", "ar": "دولي زوم" }, "tutorials": { "en": "dolly zoom tutorial", "ar": "شرح دولي زوم" } } },
  { "id": "keyframes", "kind": "technique", "label": { "en": "keyframes", "ar": "الكي فريم" }, "match": { "en": ["keyframe", "keyframes", "keyframe animation"], "ar": ["كي فريم", "كيفريم"] }, "specific": true, "queries": { "examples": { "en": "keyframe animation edit", "ar": "ايديت كي فريم" }, "tutorials": { "en": "keyframe tutorial capcut", "ar": "شرح الكي فريم" } } }
]
```

- [ ] **Step 2: Write the failing tests**

Create `workers/scout/src/discover/terms.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import raw from "../../../../planning/data/edit-terms.json";
import { matchTerms, parseTerms, TERMS } from "./terms";

describe("the bundled dictionary", () => {
  it("is well formed: every entry parses and ids are unique", () => {
    expect(TERMS.length).toBe((raw as unknown[]).length);
    expect(new Set(TERMS.map((t) => t.id)).size).toBe(TERMS.length);
  });

  it("covers the golden-test topics", () => {
    const ids = (q: string) => matchTerms(q).best?.id;
    expect(ids("flash")).toBe("flash-transition");
    expect(ids("matchcut")).toBe("match-cut");
    expect(ids("speed ramp")).toBe("speed-ramp");
    expect(ids("color grading")).toBe("color-grading");
    expect(ids("velocity edit")).toBe("velocity");
    expect(ids("mask transition")).toBe("mask-transition");
    expect(ids("whip pan")).toBe("whip-pan");
    expect(ids("تلوين سينمائي")).toBe("color-grading");
    expect(ids("شرح سبيد رامب")).toBe("speed-ramp");
    expect(ids("film look")).toBe("film-look");
  });
});

describe("parseTerms", () => {
  const good = {
    id: "x-cut",
    kind: "transition",
    label: { en: "x cut", ar: "اكس كت" },
    match: { en: ["x cut"], ar: [] },
    specific: true,
    queries: { examples: { en: "x cut edit", ar: "ايديت اكس كت" }, tutorials: { en: "x cut tutorial", ar: "شرح اكس كت" } },
  };

  it("keeps good entries and drops malformed or duplicate ones", () => {
    const out = parseTerms([
      good,
      { ...good },
      { ...good, id: "Bad Id" },
      { ...good, id: "no-match", match: { en: [], ar: [] } },
      { ...good, id: "bad-kind", kind: "nope" },
      { ...good, id: "no-query", queries: { examples: { en: "", ar: "x" }, tutorials: good.queries.tutorials } },
      "not an object",
    ]);
    expect(out.map((t) => t.id)).toEqual(["x-cut"]);
  });

  it("returns [] for a file that is not a list", () => {
    expect(parseTerms({})).toEqual([]);
  });
});

describe("matchTerms", () => {
  it("picks the longest match and lists the other meanings", () => {
    const m = matchTerms("flash");
    expect(m.best?.id).toBe("flash-transition");
    expect(m.others.map((t) => t.id)).toEqual(["camera-flash"]);
    expect(m.rest).toEqual([]);
  });

  it("prefers a longer synonym over an earlier entry", () => {
    expect(matchTerms("camera flash").best?.id).toBe("camera-flash");
  });

  it("ignores case, punctuation and Arabic letter forms", () => {
    expect(matchTerms("FLASH!").best?.id).toBe("flash-transition");
    expect(matchTerms("تصحيح الألوان").best?.id).toBe("color-grading");
  });

  it("keeps the words that are not the term or an intent word", () => {
    expect(matchTerms("speed ramp cars tutorial").rest).toEqual(["cars"]);
    expect(matchTerms("شرح سبيد رامب").rest).toEqual([]);
  });

  it("matches whole words only", () => {
    expect(matchTerms("flashlight").best).toBeUndefined();
  });

  it("returns the topic words for an unknown topic", () => {
    const m = matchTerms("Bokeh balls tutorial");
    expect(m.best).toBeUndefined();
    expect(m.others).toEqual([]);
    expect(m.rest).toEqual(["bokeh", "balls"]);
  });

  it("keeps an intent-only query as its own words", () => {
    expect(matchTerms("tutorial").rest).toEqual(["tutorial"]);
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `cd workers/scout && pnpm.cmd exec vitest run src/discover/terms.test.ts`
Expected: FAIL — `Cannot find module './terms'`.

- [ ] **Step 4: Write `terms.ts`**

Create `workers/scout/src/discover/terms.ts`:

```ts
/**
 * The editing dictionary (round 33, planning/tools/13-discover-search-v2.md): `planning/data/edit-terms.json`
 * is bundled at build like genres.json (`../trends/json.d.ts` types it for tsc) and checked by hand here (the
 * Worker has no zod). `matchTerms` reads what the owner typed with the auto-replies rules (case, Arabic
 * diacritics / tatweel / alef / yaa forms, punctuation do not matter) and whole words only.
 */

import raw from "../../../../planning/data/edit-terms.json";
import { normalizeForMatch } from "../social/replies";

export type Lang = "ar" | "en";
export interface LangText {
  ar: string;
  en: string;
}
export type TermKind = "transition" | "effect" | "color" | "audio" | "technique" | "style" | "photo";
const KINDS: readonly TermKind[] = ["transition", "effect", "color", "audio", "technique", "style", "photo"];

export interface EditTerm {
  /** `^[a-z][a-z0-9-]*$`, unique in the file. */
  id: string;
  kind: TermKind;
  label: LangText;
  /** What the owner may type, per language (at least one word in one of them). */
  match: { ar: string[]; en: string[] };
  /** false: a card also needs an editing word to count as on-topic (the word alone means other things). */
  specific: boolean;
  queries: { examples: LangText; tutorials: LangText };
}

const ID_RE = /^[a-z][a-z0-9-]*$/;
const isText = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;
const isLangText = (x: unknown): x is LangText =>
  !!x && typeof x === "object" && isText((x as LangText).ar) && isText((x as LangText).en);
const words = (x: unknown): string[] | null =>
  Array.isArray(x) && x.every(isText) ? (x as string[]).map((w) => w.trim()) : null;

function parseTerm(x: unknown): EditTerm | null {
  if (!x || typeof x !== "object") return null;
  const t = x as Record<string, unknown>;
  if (typeof t.id !== "string" || !ID_RE.test(t.id)) return null;
  if (!KINDS.includes(t.kind as TermKind)) return null;
  if (!isLangText(t.label) || typeof t.specific !== "boolean") return null;
  const m = t.match as Record<string, unknown> | undefined;
  const ar = words(m?.ar);
  const en = words(m?.en);
  if (!ar || !en || ar.length + en.length === 0) return null;
  const q = t.queries as Record<string, unknown> | undefined;
  if (!isLangText(q?.examples) || !isLangText(q?.tutorials)) return null;
  return {
    id: t.id,
    kind: t.kind as TermKind,
    label: { ar: (t.label as LangText).ar, en: (t.label as LangText).en },
    match: { ar, en },
    specific: t.specific,
    queries: { examples: q.examples as LangText, tutorials: q.tutorials as LangText },
  };
}

/** Every well-formed entry of a dictionary file, in file order; a repeated id keeps the first. */
export function parseTerms(file: unknown): EditTerm[] {
  if (!Array.isArray(file)) return [];
  const seen = new Set<string>();
  const out: EditTerm[] = [];
  for (const x of file) {
    const t = parseTerm(x);
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

export const TERMS: readonly EditTerm[] = parseTerms(raw);

/**
 * Words that say what kind of result is wanted, not what about: dropped from the topic (the plan asks for
 * examples and tutorials anyway). Normalized forms (`normalizeForMatch`).
 */
export const INTENT_WORDS: ReadonlySet<string> = new Set([
  "edit", "edits", "editing", "video", "videos", "tutorial", "tutorials", "how", "to", "guide", "reel", "reels",
  "tiktok", "instagram", "youtube", "شرح", "طريقة", "كيف", "ايديت", "مونتاج", "فيديو", "تعليم", "درس", "تعلم",
]);

export interface TermMatch {
  /** The entry whose matched synonym is longest (ties: file order). */
  best?: EditTerm;
  /** Other entries that matched (other meanings), file order, at most 3. */
  others: EditTerm[];
  /** The typed words left once the best synonym and the intent words are taken out (normalized). */
  rest: string[];
}

const has = (q: string, phrase: string) => !!phrase && ` ${q} `.includes(` ${phrase} `);

export function matchTerms(q: string, terms: readonly EditTerm[] = TERMS): TermMatch {
  const nq = normalizeForMatch(q);
  let best: EditTerm | undefined;
  let bestPhrase = "";
  const matched: EditTerm[] = [];
  for (const term of terms) {
    let longest = "";
    for (const w of [...term.match.en, ...term.match.ar]) {
      const n = normalizeForMatch(w);
      if (has(nq, n) && n.length > longest.length) longest = n;
    }
    if (!longest) continue;
    matched.push(term);
    if (longest.length > bestPhrase.length) {
      best = term;
      bestPhrase = longest;
    }
  }
  const left = best ? ` ${nq} `.replace(` ${bestPhrase} `, " ") : nq;
  const all = left.split(" ").filter(Boolean);
  const kept = all.filter((w) => !INTENT_WORDS.has(w));
  const rest = best ? kept : kept.length ? kept : all;
  return { best, others: matched.filter((t) => t !== best).slice(0, 3), rest };
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd workers/scout && pnpm.cmd exec vitest run src/discover/terms.test.ts`
Expected: PASS (all tests). If a golden-topic expectation fails, fix the JSON entry, not the test.

- [ ] **Step 6: Watch the file in the deploy workflow**

In `.github/workflows/worker.yml`, under `on.push.paths`, after `- "planning/data/genres.json"` add:

```yaml
      - "planning/data/edit-terms.json"
```

- [ ] **Step 7: Typecheck and commit**

Run: `cd workers/scout && pnpm.cmd typecheck`
Expected: no errors.

```bash
git add planning/data/edit-terms.json workers/scout/src/discover/terms.ts workers/scout/src/discover/terms.test.ts .github/workflows/worker.yml
git commit -m "Discover v2: the editing dictionary and its matcher

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The search plan

**Files:**
- Create: `workers/scout/src/discover/types.ts`
- Create: `workers/scout/src/discover/plan.ts`
- Test: `workers/scout/src/discover/plan.test.ts`

**Interfaces:**
- Consumes: `TERMS`, `matchTerms`, `EditTerm`, `Lang`, `LangText` (Task 1); `normalizeForMatch` (replies.ts);
  `hasArabic(text)` from `workers/scout/src/trends/normalize.ts`; `Platform`, `PLATFORMS` from `workers/scout/src/normalize.ts`.
- Produces (`types.ts`): `Intent`, `DiscoverTimeRange`, `DiscoverRequest`, `PlannedQuery`, `Alternative`, `SearchPlan`,
  `Section`, `DiscoverItem`, `Creator`, `PlatformError`, `PlatformStatus`, `DiscoverResponse` (exact code below).
- Produces (`plan.ts`): `export function planSearch(req: DiscoverRequest, terms?: readonly EditTerm[]): SearchPlan`

- [ ] **Step 1: Write the types**

Create `workers/scout/src/discover/types.ts`:

```ts
/**
 * Discover v2 (round 33, planning/tools/13-discover-search-v2.md): the request, the plan and the answer.
 * The answer's shape is MIRRORED in the dashboard's lib/discover.ts (hand-copied): change both together.
 */

import type { Platform, ScoutResult } from "../normalize";
import type { Lang, LangText } from "./terms";

export type Intent = "examples" | "tutorials";
export type DiscoverTimeRange = "week" | "month" | "year";

export interface DiscoverRequest {
  q: string;
  /** "Search exactly this": no dictionary, no editing words, nothing hidden. */
  exact?: boolean;
  /** A dictionary id the owner picked from "Not this?". */
  term?: string;
  /** The genre chip's main query per language (built-in or custom genre). */
  genreQuery?: { ar?: string; en?: string };
  /** "DaVinci Resolve": goes on the tutorial queries. */
  program?: string;
  timeRange?: DiscoverTimeRange;
  ytLength?: "short" | "long";
  /** Default: all three. */
  platforms?: Platform[];
}

export interface PlannedQuery {
  /** `<platform>-<intent>-<lang>`, unique in a plan. */
  id: string;
  platform: Platform;
  lang: Lang;
  intent: Intent;
  q: string;
  /** Asked once more with these words when the first answer holds no post (TikTok / Instagram only). */
  retryQ?: string;
}

export type Alternative = { termId: string; label: LangText } | { exact: true };

export interface SearchPlan {
  /** What was typed, trimmed. */
  topic: string;
  /** The dictionary id, else the normalized topic words: picks for "flash" and "Flash transition" meet. */
  topicKey: string;
  termId?: string;
  exact: boolean;
  understood: { termId?: string; label: LangText; exact: boolean };
  alternatives: Alternative[];
  /** Normalized words / phrases; a card must mention one of them to be on-topic (empty: nothing is hidden). */
  topicWords: string[];
  /** The card must also mention an editing word (dictionary entries with `specific: false`). */
  needsEditingWord: boolean;
  queries: PlannedQuery[];
}

export type Section = "example" | "tutorial";

export interface DiscoverItem extends ScoutResult {
  lang: Lang;
  section: Section;
  offTopic?: true;
  /** The creator's page (YouTube channel, TikTok / Instagram profile) when known. */
  profile?: string;
}

export interface Creator {
  platform: Platform;
  handle: string;
  url: string;
  /** On-topic cards of this creator in the answer (0: found as a profile page only). */
  count: number;
  views?: number;
}

export type PlatformError = "quota" | "auth" | "upstream" | "daily_cap" | "not_configured";
export type PlatformStatus = { ok: true; retried?: boolean } | { ok: false; error: PlatformError };

export interface DiscoverResponse {
  topicKey: string;
  understood: SearchPlan["understood"];
  alternatives: Alternative[];
  items: DiscoverItem[];
  creators: Creator[];
  platforms: Partial<Record<Platform, PlatformStatus>>;
  cost: { tavily: number; youtubeSearch: number };
  cached: boolean;
}
```

- [ ] **Step 2: Write the failing tests**

Create `workers/scout/src/discover/plan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { planSearch } from "./plan";

const byId = (plan: ReturnType<typeof planSearch>) =>
  Object.fromEntries(plan.queries.map((q) => [q.id, q]));

describe("planSearch with a dictionary term", () => {
  const plan = planSearch({ q: "flash" });

  it("understands the term and offers the other meaning and the exact search", () => {
    expect(plan.termId).toBe("flash-transition");
    expect(plan.topicKey).toBe("flash-transition");
    expect(plan.understood).toEqual({
      termId: "flash-transition",
      label: { en: "flash transition", ar: "انتقال فلاش" },
      exact: false,
    });
    expect(plan.alternatives).toEqual([
      { termId: "camera-flash", label: { en: "camera flash photography", ar: "تصوير بالفلاش" } },
      { exact: true },
    ]);
  });

  it("asks 3 queries per platform: examples en, tutorials en, tutorials ar", () => {
    const q = byId(plan);
    expect(plan.queries).toHaveLength(9);
    expect(q["tt-examples-en"]).toMatchObject({ q: "flash transition edit", retryQ: "flash transition tutorial capcut davinci" });
    expect(q["ig-tutorials-en"]).toMatchObject({ q: "flash transition tutorial capcut davinci", retryQ: "flash transition edit" });
    expect(q["tt-tutorials-ar"]).toMatchObject({ lang: "ar", q: "شرح تأثير فلاش مونتاج", retryQ: "ايديت انتقال فلاش" });
    expect(q["yt-examples-en"].retryQ).toBeUndefined();
    expect(q["yt-tutorials-ar"]).toMatchObject({ lang: "ar", intent: "tutorials" });
  });

  it("needs an editing word for a non-specific term and lists its words", () => {
    expect(plan.needsEditingWord).toBe(true);
    expect(plan.topicWords).toContain("flash");
    expect(plan.topicWords).toContain("فلاش");
  });
});

describe("planSearch options", () => {
  it("adds the genre to the examples and the program to the tutorials", () => {
    const q = byId(
      planSearch({ q: "speed ramp", genreQuery: { en: "car edit", ar: "ايديت سيارات" }, program: "DaVinci Resolve" }),
    );
    expect(q["tt-examples-en"].q).toBe("speed ramp edit car edit");
    expect(q["tt-tutorials-en"].q).toBe("speed ramp tutorial capcut DaVinci Resolve");
    expect(q["tt-tutorials-ar"].q).toBe("شرح سبيد رامب كاب كت DaVinci Resolve");
    expect(q["tt-tutorials-ar"].retryQ).toBe("ايديت سبيد رامب ايديت سيارات");
  });

  it("keeps extra typed words on every query", () => {
    expect(byId(planSearch({ q: "speed ramp cars" }))["ig-examples-en"].q).toBe("speed ramp edit cars");
  });

  it("plans an unknown topic from its words", () => {
    const plan = planSearch({ q: "bokeh balls" });
    const q = byId(plan);
    expect(plan.termId).toBeUndefined();
    expect(plan.topicKey).toBe("bokeh balls");
    expect(plan.understood.label).toEqual({ ar: "bokeh balls", en: "bokeh balls" });
    expect(q["tt-examples-en"].q).toBe("bokeh balls edit");
    expect(q["tt-tutorials-en"].q).toBe("bokeh balls tutorial");
    expect(q["tt-tutorials-ar"].q).toBe("شرح bokeh balls");
    expect(plan.needsEditingWord).toBe(false);
    expect(plan.topicWords).toEqual(["bokeh", "balls"]);
    expect(plan.alternatives).toEqual([{ exact: true }]);
  });

  it("searches exactly what was typed, once per platform, hiding nothing", () => {
    const plan = planSearch({ q: "flash", exact: true });
    expect(plan.queries.map((q) => [q.platform, q.q, q.lang])).toEqual([
      ["tt", "flash", "en"],
      ["ig", "flash", "en"],
      ["yt", "flash", "en"],
    ]);
    expect(plan.topicWords).toEqual([]);
    expect(plan.alternatives).toEqual([
      { termId: "flash-transition", label: { en: "flash transition", ar: "انتقال فلاش" } },
    ]);
    expect(planSearch({ q: "فلاش", exact: true }).queries[0].lang).toBe("ar");
  });

  it("uses a term picked from Not this?", () => {
    const plan = planSearch({ q: "flash", term: "camera-flash" });
    expect(plan.termId).toBe("camera-flash");
    expect(plan.alternatives[0]).toEqual({ termId: "flash-transition", label: { en: "flash transition", ar: "انتقال فلاش" } });
  });

  it("plans only the platforms asked for", () => {
    const plan = planSearch({ q: "flash", platforms: ["yt"] });
    expect(new Set(plan.queries.map((q) => q.platform))).toEqual(new Set(["yt"]));
  });

  it("never repeats a query on a platform", () => {
    const plan = planSearch({ q: "hyperlapse" });
    const keys = plan.queries.map((q) => `${q.platform}|${q.q.toLowerCase()}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `cd workers/scout && pnpm.cmd exec vitest run src/discover/plan.test.ts`
Expected: FAIL — `Cannot find module './plan'`.

- [ ] **Step 4: Write `plan.ts`**

Create `workers/scout/src/discover/plan.ts`:

```ts
/**
 * Discover v2 step 1: what to search (planning/tools/13-discover-search-v2.md, "The pipeline"). A dictionary
 * entry gives the queries; an unknown topic gets "<topic> edit" / "<topic> tutorial" / "شرح <topic>". TikTok and
 * Instagram ask examples en, tutorials en and tutorials ar (the Arabic examples query is the Arabic retry);
 * YouTube asks the same three without retries (a retry there costs a `search.list` call). With an Anthropic key
 * this is the step that would call Claude instead.
 */

import { PLATFORMS, type Platform } from "../normalize";
import { normalizeForMatch } from "../social/replies";
import { hasArabic } from "../trends/normalize";
import { matchTerms, TERMS, type EditTerm, type Lang } from "./terms";
import type { Alternative, DiscoverRequest, Intent, PlannedQuery, SearchPlan } from "./types";

const MAX_QUERY = 200;

const join = (...parts: (string | undefined)[]) =>
  parts
    .filter((p): p is string => !!p && !!p.trim())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_QUERY);

interface Words {
  examples: Record<Lang, string>;
  tutorials: Record<Lang, string>;
}

function termWords(term: EditTerm, rest: string): Words {
  return {
    examples: { en: join(term.queries.examples.en, rest), ar: join(term.queries.examples.ar, rest) },
    tutorials: { en: join(term.queries.tutorials.en, rest), ar: join(term.queries.tutorials.ar, rest) },
  };
}

function unknownWords(topic: string): Words {
  return {
    examples: { en: join(topic, "edit"), ar: join("ايديت", topic) },
    tutorials: { en: join(topic, "tutorial"), ar: join("شرح", topic) },
  };
}

function plannedQueries(platforms: Platform[], w: Words, req: DiscoverRequest): PlannedQuery[] {
  const genre = req.genreQuery ?? {};
  const ex = (l: Lang) => join(w.examples[l], genre[l]);
  const tut = (l: Lang) => join(w.tutorials[l], req.program);
  const out: PlannedQuery[] = [];
  for (const platform of platforms) {
    const retry = platform !== "yt";
    const list: [Intent, Lang, string, string | undefined][] = [
      ["examples", "en", ex("en"), retry ? tut("en") : undefined],
      ["tutorials", "en", tut("en"), retry ? ex("en") : undefined],
      ["tutorials", "ar", tut("ar"), retry ? ex("ar") : undefined],
    ];
    const seen = new Set<string>();
    for (const [intent, lang, q, retryQ] of list) {
      const key = q.toLowerCase();
      if (!q || seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: `${platform}-${intent}-${lang}`,
        platform,
        lang,
        intent,
        q,
        ...(retryQ && retryQ.toLowerCase() !== key ? { retryQ } : {}),
      });
    }
  }
  return out;
}

function termAlternative(t: EditTerm): Alternative {
  return { termId: t.id, label: { en: t.label.en, ar: t.label.ar } };
}

export function planSearch(req: DiscoverRequest, terms: readonly EditTerm[] = TERMS): SearchPlan {
  const topic = req.q.trim().replace(/\s+/g, " ");
  const platforms = PLATFORMS.filter((p) => !req.platforms || req.platforms.includes(p));
  const m = matchTerms(topic, terms);
  const picked = req.term ? terms.find((t) => t.id === req.term) : undefined;
  const term = picked ?? m.best;
  const others = [m.best, ...m.others].filter((t): t is EditTerm => !!t && t !== term);

  if (req.exact) {
    const lang: Lang = hasArabic(topic) ? "ar" : "en";
    return {
      topic,
      topicKey: normalizeForMatch(topic),
      exact: true,
      understood: { label: { ar: topic, en: topic }, exact: true },
      alternatives: term ? [termAlternative(term)] : [],
      topicWords: [],
      needsEditingWord: false,
      queries: platforms.map((platform) => ({
        id: `${platform}-examples-${lang}`,
        platform,
        lang,
        intent: "examples" as const,
        q: topic.slice(0, MAX_QUERY),
      })),
    };
  }

  const rest = m.rest.join(" ");
  const words = term ? termWords(term, rest) : unknownWords(rest || topic);
  const topicWords = term
    ? [...new Set([...term.match.en, ...term.match.ar, term.label.en, term.label.ar].map(normalizeForMatch))]
    : m.rest.length
      ? m.rest
      : [normalizeForMatch(topic)];
  return {
    topic,
    topicKey: term ? term.id : normalizeForMatch(rest || topic),
    ...(term ? { termId: term.id } : {}),
    exact: false,
    understood: {
      ...(term ? { termId: term.id } : {}),
      label: term ? { en: term.label.en, ar: term.label.ar } : { ar: topic, en: topic },
      exact: false,
    },
    alternatives: [...others.map(termAlternative), { exact: true }],
    topicWords: topicWords.filter(Boolean),
    needsEditingWord: term ? !term.specific : false,
    queries: plannedQueries(platforms, words, req),
  };
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd workers/scout && pnpm.cmd exec vitest run src/discover/plan.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

Run: `cd workers/scout && pnpm.cmd typecheck` — expected: no errors.

```bash
git add workers/scout/src/discover/types.ts workers/scout/src/discover/plan.ts workers/scout/src/discover/plan.test.ts
git commit -m "Discover v2: plan English and Arabic queries from the dictionary

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Cards with dates, and profile pages kept as creator candidates

**Files:**
- Modify: `workers/scout/src/normalize.ts` (`TavilyHit`, `ScoutResult`, `normalizeHits`, new `profileFromUrl`,
  `normalizeDiscoverHits`)
- Test: `workers/scout/src/normalize.test.ts` (append)

**Interfaces:**
- Produces:
  ```ts
  // ScoutResult gains: published?: string   (as sent: Tavily published_date, YouTube publishedAt)
  // TavilyHit gains:   published_date?: string
  export interface Profile { platform: Platform; handle: string; url: string }
  export function profileFromUrl(platform: Platform, u: URL): Profile | undefined;
  export function normalizeDiscoverHits(hits: readonly TavilyHit[], platform: Platform): { cards: ScoutResult[]; profiles: Profile[] };
  ```

- [ ] **Step 1: Write the failing tests**

Append to `workers/scout/src/normalize.test.ts` (add `normalizeDiscoverHits, profileFromUrl` to its import from
`./normalize`):

```ts
describe("profileFromUrl", () => {
  const p = (platform: "tt" | "ig" | "yt", url: string) => profileFromUrl(platform, new URL(url));

  it("reads TikTok, Instagram and YouTube profile pages", () => {
    expect(p("tt", "https://www.tiktok.com/@zenko.edit")).toEqual({
      platform: "tt",
      handle: "@zenko.edit",
      url: "https://www.tiktok.com/@zenko.edit",
    });
    expect(p("ig", "https://www.instagram.com/nilstobli_nt/")).toEqual({
      platform: "ig",
      handle: "@nilstobli_nt",
      url: "https://www.instagram.com/nilstobli_nt/",
    });
    expect(p("yt", "https://www.youtube.com/@cinecom")).toEqual({
      platform: "yt",
      handle: "@cinecom",
      url: "https://www.youtube.com/@cinecom",
    });
  });

  it("is not fooled by posts, tags or Instagram routes", () => {
    expect(p("tt", "https://www.tiktok.com/@a/video/123")).toBeUndefined();
    expect(p("tt", "https://www.tiktok.com/tag/edit")).toBeUndefined();
    expect(p("ig", "https://www.instagram.com/explore/")).toBeUndefined();
    expect(p("ig", "https://www.instagram.com/p/ABC/")).toBeUndefined();
    expect(p("yt", "https://www.youtube.com/watch?v=x")).toBeUndefined();
  });
});

describe("normalizeDiscoverHits", () => {
  it("splits posts from profile pages and keeps the published date", () => {
    const { cards, profiles } = normalizeDiscoverHits(
      [
        {
          url: "https://www.tiktok.com/@zenko.edit/video/7300000000000000001",
          title: "flash transition tutorial | TikTok",
          content: "How I make the flash transition",
          published_date: "2026-09-30",
        },
        { url: "https://www.tiktok.com/@zenko.edit", title: "zenko (@zenko.edit) | TikTok" },
        { url: "https://www.instagram.com/p/XYZ/", title: "Instagram" },
      ],
      "tt",
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ platform: "tt", handle: "@zenko.edit", published: "2026-09-30" });
    expect(profiles).toEqual([
      { platform: "tt", handle: "@zenko.edit", url: "https://www.tiktok.com/@zenko.edit" },
    ]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd workers/scout && pnpm.cmd exec vitest run src/normalize.test.ts`
Expected: FAIL — `profileFromUrl is not a function` (or a missing-export error).

- [ ] **Step 3: Implement in `normalize.ts`**

1. In `interface ScoutResult`, after `stats?: Stats;` add:
   ```ts
     /** When the page was published, as the source sent it (Tavily `published_date`, YouTube `publishedAt`). */
     published?: string;
   ```
2. In `interface TavilyHit` add: `published_date?: string;`
3. In `normalizeHits`, right after `if (thumb) result.thumb = thumb;` add:
   ```ts
       if (typeof hit.published_date === "string" && hit.published_date) result.published = hit.published_date;
   ```
4. Append to the end of the file:

```ts
/* ---------- profile pages (Discover v2: creator candidates) ---------- */

export interface Profile {
  platform: Platform;
  /** "@name". */
  handle: string;
  url: string;
}

const TT_PROFILE_PATH = /^\/@([\w.-]+)\/?$/;
const IG_PROFILE_PATH = /^\/([A-Za-z0-9._]+)\/?$/;
const YT_PROFILE_PATH = /^\/@([\w.-]+)\/?$/;

/** The account a profile page belongs to (TikTok `/@name`, Instagram `/<name>/`, YouTube `/@name`), else undefined. */
export function profileFromUrl(platform: Platform, u: URL): Profile | undefined {
  if (platform === "tt") {
    const m = u.pathname.match(TT_PROFILE_PATH);
    return m ? { platform, handle: `@${m[1]}`, url: `https://www.tiktok.com/@${m[1]}` } : undefined;
  }
  if (platform === "ig") {
    const m = u.pathname.match(IG_PROFILE_PATH);
    if (!m || IG_RESERVED.has(m[1].toLowerCase())) return undefined;
    return { platform, handle: `@${m[1]}`, url: `https://www.instagram.com/${m[1]}/` };
  }
  const m = u.pathname.match(YT_PROFILE_PATH);
  return m ? { platform, handle: `@${m[1]}`, url: `https://www.youtube.com/@${m[1]}` } : undefined;
}

/**
 * One platform's Tavily hits as Discover wants them: the post cards (`normalizeHits`) and, apart, the profile
 * pages a search found (dropped by `/search`; Discover lists them as creators).
 */
export function normalizeDiscoverHits(
  hits: readonly TavilyHit[],
  platform: Platform,
): { cards: ScoutResult[]; profiles: Profile[] } {
  const cards = normalizeHits(hits, [platform]);
  const seen = new Set<string>();
  const profiles: Profile[] = [];
  for (const hit of hits) {
    let u: URL;
    try {
      u = new URL(hit.url ?? "");
    } catch {
      continue;
    }
    if (platformForHost(u.hostname) !== platform) continue;
    const p = profileFromUrl(platform, u);
    if (!p || seen.has(p.handle.toLowerCase())) continue;
    seen.add(p.handle.toLowerCase());
    profiles.push(p);
  }
  return { cards, profiles };
}
```

- [ ] **Step 4: Run all Worker tests**

Run: `cd workers/scout && pnpm.cmd exec vitest run`
Expected: PASS (existing `/search` tests unchanged: `published` appears only when Tavily sends a date).

- [ ] **Step 5: Commit**

```bash
git add workers/scout/src/normalize.ts workers/scout/src/normalize.test.ts
git commit -m "Discover v2: published dates on cards, profile pages as creator candidates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: One Tavily call, one YouTube call, the daily YouTube reservation

**Files:**
- Create: `workers/scout/src/discover/fetchers.ts`
- Test: `workers/scout/src/discover/fetchers.test.ts`

**Interfaces:**
- Consumes: `normalizeDiscoverHits`, `Profile`, `ScoutResult`, `PLATFORM_DOMAIN` (normalize.ts); `TAVILY_URL`
  (`../trends/tavily`); `YT_SEARCH_URL` (`../trends/youtubeSearch`); `utcDay` (`../trends/kv`); `DiscoverTimeRange`,
  `PlatformError` (types.ts); `Lang` (terms.ts).
- Produces:
  ```ts
  export interface FetchEnv { TAVILY_API_KEY?: string; YOUTUBE_API_KEY?: string; SOCIAL_KV?: KVNamespace; DISCOVER_YT_CAP?: string }
  export const CALL_TIMEOUT_MS = 12_000; export const RESULTS_PER_CALL = 20; export const DEFAULT_YT_CAP = 70;
  export const discoverKeys: { yt: (day: string) => string };
  export type TavilyOutcome = { ok: true; cards: ScoutResult[]; profiles: Profile[]; credits: number } | { ok: false; error: PlatformError };
  export function tavilyCall(env: FetchEnv, doFetch: typeof fetch, call: { q: string; platform: "tt" | "ig"; lang: Lang; timeRange?: DiscoverTimeRange }, timeoutMs?: number): Promise<TavilyOutcome>;
  export type YoutubeOutcome = { ok: true; cards: (ScoutResult & { profile?: string })[] } | { ok: false; error: PlatformError };
  export function youtubeCall(env: FetchEnv, doFetch: typeof fetch, call: { q: string; lang: Lang; timeRange?: DiscoverTimeRange; ytLength?: "short" | "long" }, now: Date, timeoutMs?: number): Promise<YoutubeOutcome>;
  export function youtubeUsedToday(env: FetchEnv, now: Date): Promise<number>;
  export function youtubeCap(env: FetchEnv): number;
  export function reserveYoutube(env: FetchEnv, wanted: number, now: Date): Promise<number>;
  ```

- [ ] **Step 1: Write the failing tests**

Create `workers/scout/src/discover/fetchers.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { discoverKeys, reserveYoutube, tavilyCall, youtubeCall } from "./fetchers";

const NOW = new Date("2026-10-03T09:00:00Z");

type Entry = { value: string; expirationTtl?: number };
function fakeKV() {
  const store = new Map<string, Entry>();
  return {
    store,
    async get(key: string) {
      return store.get(key)?.value ?? null;
    },
    async put(key: string, value: string, opts?: { expirationTtl?: number }) {
      store.set(key, { value, expirationTtl: opts?.expirationTtl });
    },
  } as unknown as KVNamespace & { store: Map<string, Entry> };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("tavilyCall", () => {
  it("asks 20 results from one platform in the query's language, with dates and usage", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json({
        results: [{ url: "https://www.tiktok.com/@a/video/1", title: "flash edit", content: "x" }],
        usage: { credits: 1 },
      }),
    );
    const out = await tavilyCall(
      { TAVILY_API_KEY: "k" },
      fetchMock,
      { q: "شرح فلاش", platform: "tt", lang: "ar", timeRange: "month" },
    );
    expect(out).toMatchObject({ ok: true, credits: 1 });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      query: "شرح فلاش",
      include_domains: ["tiktok.com"],
      max_results: 20,
      search_depth: "basic",
      include_published_date: true,
      include_usage: true,
      language: "ar",
      country: "saudi arabia",
      time_range: "month",
    });
  });

  it("maps Tavily's errors", async () => {
    const call = { q: "x", platform: "ig" as const, lang: "en" as const };
    expect(await tavilyCall({}, vi.fn(), call)).toEqual({ ok: false, error: "not_configured" });
    expect(await tavilyCall({ TAVILY_API_KEY: "k" }, vi.fn(async () => json({}, 432)), call)).toEqual({ ok: false, error: "quota" });
    expect(await tavilyCall({ TAVILY_API_KEY: "k" }, vi.fn(async () => json({}, 401)), call)).toEqual({ ok: false, error: "auth" });
    expect(await tavilyCall({ TAVILY_API_KEY: "k" }, vi.fn(async () => json({}, 500)), call)).toEqual({ ok: false, error: "upstream" });
    expect(
      await tavilyCall({ TAVILY_API_KEY: "k" }, vi.fn(async () => {
        throw new TypeError("down");
      }), call),
    ).toEqual({ ok: false, error: "upstream" });
  });
});

describe("youtubeCall", () => {
  it("searches 20 videos in the query's language and region, cards with channel links", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json({
        items: [
          {
            id: { videoId: "abc" },
            snippet: {
              title: "Flash &amp; glow transition",
              description: "tutorial",
              channelTitle: "Cinecom",
              channelId: "UC1",
              publishedAt: "2026-09-01T00:00:00Z",
              thumbnails: { medium: { url: "https://i.ytimg.com/vi/abc/mqdefault.jpg" } },
            },
          },
        ],
      }),
    );
    const out = await youtubeCall(
      { YOUTUBE_API_KEY: "y" },
      fetchMock,
      { q: "شرح فلاش", lang: "ar", timeRange: "week", ytLength: "short" },
      NOW,
    );
    expect(out).toEqual({
      ok: true,
      cards: [
        {
          platform: "yt",
          handle: "Cinecom",
          title: "Flash & glow transition",
          snippet: "tutorial",
          url: "https://www.youtube.com/watch?v=abc",
          thumb: "https://i.ytimg.com/vi/abc/mqdefault.jpg",
          published: "2026-09-01T00:00:00Z",
          profile: "https://www.youtube.com/channel/UC1",
        },
      ],
    });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("maxResults")).toBe("20");
    expect(url.searchParams.get("relevanceLanguage")).toBe("ar");
    expect(url.searchParams.get("regionCode")).toBe("SA");
    expect(url.searchParams.get("videoDuration")).toBe("short");
    expect(url.searchParams.get("publishedAfter")).toBe("2026-09-26T09:00:00.000Z");
  });

  it("maps quota to daily_cap and other refusals to auth", async () => {
    const call = { q: "x", lang: "en" as const };
    expect(await youtubeCall({}, vi.fn(), call, NOW)).toEqual({ ok: false, error: "not_configured" });
    const quota = json({ error: { errors: [{ reason: "quotaExceeded" }] } }, 403);
    expect(await youtubeCall({ YOUTUBE_API_KEY: "y" }, vi.fn(async () => quota), call, NOW)).toEqual({ ok: false, error: "daily_cap" });
    const bad = json({ error: { errors: [{ reason: "keyInvalid" }] } }, 400);
    expect(await youtubeCall({ YOUTUBE_API_KEY: "y" }, vi.fn(async () => bad), call, NOW)).toEqual({ ok: false, error: "auth" });
  });
});

describe("reserveYoutube", () => {
  it("grants calls up to the day's cap and counts them", async () => {
    const kv = fakeKV();
    const env = { SOCIAL_KV: kv, DISCOVER_YT_CAP: "5" };
    expect(await reserveYoutube(env, 3, NOW)).toBe(3);
    expect(await reserveYoutube(env, 3, NOW)).toBe(2);
    expect(await reserveYoutube(env, 3, NOW)).toBe(0);
    expect(kv.store.get(discoverKeys.yt("2026-10-03"))).toEqual({ value: "5", expirationTtl: 172_800 });
  });

  it("grants everything without KV (local dev) and uses 70 by default", async () => {
    expect(await reserveYoutube({}, 3, NOW)).toBe(3);
    const kv = fakeKV();
    await kv.put(discoverKeys.yt("2026-10-03"), "69");
    expect(await reserveYoutube({ SOCIAL_KV: kv }, 3, NOW)).toBe(1);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd workers/scout && pnpm.cmd exec vitest run src/discover/fetchers.test.ts`
Expected: FAIL — `Cannot find module './fetchers'`.

- [ ] **Step 3: Write `fetchers.ts`**

Create `workers/scout/src/discover/fetchers.ts`:

```ts
/**
 * Discover v2 step 2: the outbound calls (planning/tools/13-discover-search-v2.md). One Tavily search per
 * TikTok / Instagram query (20 results, the same 1 credit as 10), one YouTube `search.list` per YouTube query
 * (20 results, 1 of the project's 100 calls a day), and the day's YouTube reservation: Discover and the connector
 * may spend `DISCOVER_YT_CAP` (70) calls a UTC day, so the Trend Radar keeps its 18. KV has no atomic increment:
 * the cap is best-effort when two searches overlap (the radar's counter works the same way).
 */

import { normalizeDiscoverHits, PLATFORM_DOMAIN, type Profile, type ScoutResult } from "../normalize";
import { utcDay } from "../trends/kv";
import { TAVILY_URL } from "../trends/tavily";
import { YT_SEARCH_URL } from "../trends/youtubeSearch";
import type { Lang } from "./terms";
import type { DiscoverTimeRange, PlatformError } from "./types";

export interface FetchEnv {
  TAVILY_API_KEY?: string;
  YOUTUBE_API_KEY?: string;
  SOCIAL_KV?: KVNamespace;
  /** Var: `search.list` calls Discover and the connector may spend a UTC day (default 70). */
  DISCOVER_YT_CAP?: string;
}

export const CALL_TIMEOUT_MS = 12_000;
export const RESULTS_PER_CALL = 20;
export const DEFAULT_YT_CAP = 70;
const COUNTER_TTL_S = 2 * 86_400;
const SNIPPET_MAX = 220;
const TITLE_MAX = 160;
const DAY_MS = 86_400_000;
const RANGE_DAYS: Record<DiscoverTimeRange, number> = { week: 7, month: 30, year: 365 };

export const discoverKeys = {
  yt: (day: string) => `discover:yt:${day}`,
};

/** Runs `run` with a hard limit (body included) so one slow site cannot hold the whole search. */
async function timed<T>(timeoutMs: number, run: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      ac.abort();
      resolve(undefined);
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(ac.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- Tavily ---------- */

export type TavilyOutcome =
  | { ok: true; cards: ScoutResult[]; profiles: Profile[]; credits: number }
  | { ok: false; error: PlatformError };

export async function tavilyCall(
  env: FetchEnv,
  doFetch: typeof fetch,
  call: { q: string; platform: "tt" | "ig"; lang: Lang; timeRange?: DiscoverTimeRange },
  timeoutMs = CALL_TIMEOUT_MS,
): Promise<TavilyOutcome> {
  if (!env.TAVILY_API_KEY) return { ok: false, error: "not_configured" };
  const key = env.TAVILY_API_KEY;
  try {
    const out = await timed(timeoutMs, async (signal): Promise<TavilyOutcome> => {
      const res = await doFetch(TAVILY_URL, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          query: call.q,
          include_domains: [PLATFORM_DOMAIN[call.platform]],
          max_results: RESULTS_PER_CALL,
          search_depth: "basic",
          include_images: true,
          include_published_date: true,
          include_usage: true,
          language: call.lang,
          ...(call.lang === "ar" ? { country: "saudi arabia" } : {}),
          ...(call.timeRange ? { time_range: call.timeRange } : {}),
        }),
      });
      if (res.status === 401 || res.status === 403) return { ok: false, error: "auth" };
      if (res.status === 429 || res.status === 432 || res.status === 433) return { ok: false, error: "quota" };
      if (!res.ok) return { ok: false, error: "upstream" };
      const data = (await res.json()) as { results?: unknown[]; usage?: { credits?: number } };
      const hits = (Array.isArray(data.results) ? data.results : []) as Parameters<typeof normalizeDiscoverHits>[0];
      const { cards, profiles } = normalizeDiscoverHits(hits, call.platform);
      return { ok: true, cards, profiles, credits: data.usage?.credits ?? 1 };
    });
    return out ?? { ok: false, error: "upstream" };
  } catch {
    return { ok: false, error: "upstream" };
  }
}

/* ---------- YouTube ---------- */

interface YtSearchReply {
  items?: {
    id?: { videoId?: string };
    snippet?: {
      title?: string;
      description?: string;
      channelTitle?: string;
      channelId?: string;
      publishedAt?: string;
      thumbnails?: Partial<Record<"default" | "medium" | "high", { url?: string }>>;
    };
  }[];
  error?: { errors?: { reason?: string }[] };
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&#39;": "'", "&lt;": "<", "&gt;": ">" };
const decode = (s: string) => s.replace(/&(?:amp|quot|#39|lt|gt);/g, (e) => ENTITIES[e] ?? e);
const clip = (s: string, max: number) => {
  const flat = decode(s).replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

export type YoutubeOutcome =
  | { ok: true; cards: (ScoutResult & { profile?: string })[] }
  | { ok: false; error: PlatformError };

export function youtubeSearchUrl(
  key: string,
  call: { q: string; lang: Lang; timeRange?: DiscoverTimeRange; ytLength?: "short" | "long" },
  now: Date,
): string {
  const u = new URL(YT_SEARCH_URL);
  u.searchParams.set("part", "snippet");
  u.searchParams.set("type", "video");
  u.searchParams.set("maxResults", String(RESULTS_PER_CALL));
  u.searchParams.set("q", call.q);
  u.searchParams.set("relevanceLanguage", call.lang);
  u.searchParams.set("regionCode", call.lang === "ar" ? "SA" : "US");
  if (call.ytLength) u.searchParams.set("videoDuration", call.ytLength);
  if (call.timeRange) {
    u.searchParams.set(
      "publishedAfter",
      new Date(now.getTime() - RANGE_DAYS[call.timeRange] * DAY_MS).toISOString(),
    );
  }
  u.searchParams.set("key", key);
  return u.toString();
}

export async function youtubeCall(
  env: FetchEnv,
  doFetch: typeof fetch,
  call: { q: string; lang: Lang; timeRange?: DiscoverTimeRange; ytLength?: "short" | "long" },
  now: Date,
  timeoutMs = CALL_TIMEOUT_MS,
): Promise<YoutubeOutcome> {
  if (!env.YOUTUBE_API_KEY) return { ok: false, error: "not_configured" };
  const url = youtubeSearchUrl(env.YOUTUBE_API_KEY, call, now);
  try {
    const out = await timed(timeoutMs, async (signal): Promise<YoutubeOutcome> => {
      const res = await doFetch(url, { signal, headers: { Accept: "application/json" } });
      let body: YtSearchReply | null = null;
      try {
        body = (await res.json()) as YtSearchReply;
      } catch {
        body = null;
      }
      if (!res.ok) {
        const reason = body?.error?.errors?.[0]?.reason ?? "";
        if (/quota|dailyLimit|rateLimit/i.test(reason)) return { ok: false, error: "daily_cap" };
        if (res.status === 400 || res.status === 403) return { ok: false, error: "auth" };
        return { ok: false, error: "upstream" };
      }
      const cards = (body?.items ?? []).flatMap((it) => {
        const id = it.id?.videoId;
        const s = it.snippet;
        if (!id || !s?.title) return [];
        const thumb =
          s.thumbnails?.medium?.url ?? s.thumbnails?.high?.url ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
        return [
          {
            platform: "yt" as const,
            handle: clip(s.channelTitle ?? "", 80),
            title: clip(s.title, TITLE_MAX),
            snippet: clip(s.description ?? "", SNIPPET_MAX),
            url: `https://www.youtube.com/watch?v=${id}`,
            thumb,
            ...(s.publishedAt ? { published: s.publishedAt } : {}),
            ...(s.channelId ? { profile: `https://www.youtube.com/channel/${s.channelId}` } : {}),
          },
        ];
      });
      return { ok: true, cards };
    });
    return out ?? { ok: false, error: "upstream" };
  } catch {
    return { ok: false, error: "upstream" };
  }
}

/* ---------- the day's YouTube calls ---------- */

export function youtubeCap(env: FetchEnv): number {
  const n = Number(env.DISCOVER_YT_CAP);
  return env.DISCOVER_YT_CAP !== undefined && Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_YT_CAP;
}

export async function youtubeUsedToday(env: FetchEnv, now: Date): Promise<number> {
  if (!env.SOCIAL_KV) return 0;
  const n = Number((await env.SOCIAL_KV.get(discoverKeys.yt(utcDay(now)), "text")) ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Reserves up to `wanted` calls of today's cap; returns how many were granted (all of them without KV). */
export async function reserveYoutube(env: FetchEnv, wanted: number, now: Date): Promise<number> {
  if (!env.SOCIAL_KV) return wanted;
  const used = await youtubeUsedToday(env, now);
  const granted = Math.max(0, Math.min(wanted, youtubeCap(env) - used));
  if (granted > 0) {
    await env.SOCIAL_KV.put(discoverKeys.yt(utcDay(now)), String(used + granted), {
      expirationTtl: COUNTER_TTL_S,
    });
  }
  return granted;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd workers/scout && pnpm.cmd exec vitest run src/discover/fetchers.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `cd workers/scout && pnpm.cmd typecheck` — expected: no errors.

```bash
git add workers/scout/src/discover/fetchers.ts workers/scout/src/discover/fetchers.test.ts
git commit -m "Discover v2: Tavily and YouTube calls with a daily YouTube reservation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Sections, off-topic and creators

**Files:**
- Create: `workers/scout/src/discover/label.ts`
- Test: `workers/scout/src/discover/label.test.ts`

**Interfaces:**
- Consumes: `SearchPlan`, `PlannedQuery`, `DiscoverItem`, `Creator` (types.ts); `Profile`, `ScoutResult`
  (normalize.ts); `normalizeForMatch` (replies.ts); `hasArabic` (trends/normalize.ts).
- Produces:
  ```ts
  export const TUTORIAL_RE: RegExp;
  export function labelCards(found: { card: ScoutResult & { profile?: string }; query: PlannedQuery }[], plan: SearchPlan): DiscoverItem[];
  export function creatorsOf(items: readonly DiscoverItem[], profiles: readonly Profile[], max?: number): Creator[];
  ```

- [ ] **Step 1: Write the failing tests**

Create `workers/scout/src/discover/label.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ScoutResult } from "../normalize";
import { creatorsOf, labelCards } from "./label";
import { planSearch } from "./plan";
import type { PlannedQuery } from "./types";

const plan = planSearch({ q: "flash" });
const query = (id: string): PlannedQuery => plan.queries.find((q) => q.id === id)!;
let n = 0;
const card = (over: Partial<ScoutResult>): ScoutResult => ({
  platform: "tt",
  handle: "@a",
  title: "",
  snippet: "",
  url: `https://www.tiktok.com/@a/video/${++n}`,
  ...over,
});

describe("labelCards", () => {
  it("files tutorials by their words and the rest by their query", () => {
    const items = labelCards(
      [
        { card: card({ title: "How to do the flash transition in CapCut" }), query: query("tt-examples-en") },
        { card: card({ title: "My flash transition edit" }), query: query("tt-tutorials-en") },
        { card: card({ title: "flash effect edit 🔥" }), query: query("tt-examples-en") },
      ],
      plan,
    );
    expect(items.map((i) => i.section)).toEqual(["tutorial", "tutorial", "example"]);
  });

  it("marks cards that are not about the effect as off-topic", () => {
    const items = labelCards(
      [
        { card: card({ title: "WATCHING THE FLASH FOR THE FIRST TIME" }), query: query("tt-examples-en") },
        { card: card({ title: "Bike ride vlog" }), query: query("tt-examples-en") },
        { card: card({ title: "شرح تأثير فلاش في كاب كت" }), query: query("tt-tutorials-ar") },
      ],
      plan,
    );
    expect(items.map((i) => i.offTopic ?? false)).toEqual([true, true, false]);
    expect(items[2].lang).toBe("ar");
  });

  it("hides nothing on an exact search and keeps the first copy of a post", () => {
    const exact = planSearch({ q: "flash", exact: true });
    const c = card({ title: "The Flash" });
    const items = labelCards(
      [
        { card: c, query: exact.queries[0] },
        { card: { ...c }, query: exact.queries[0] },
      ],
      exact,
    );
    expect(items).toHaveLength(1);
    expect(items[0].offTopic).toBeUndefined();
  });
});

describe("creatorsOf", () => {
  it("ranks accounts by on-topic cards, then views, and adds profile pages last", () => {
    const items = labelCards(
      [
        { card: card({ handle: "@b", title: "flash transition edit" }), query: query("tt-examples-en") },
        { card: card({ handle: "@a", title: "flash transition edit" }), query: query("tt-examples-en") },
        { card: card({ handle: "@a", title: "flash transition tutorial" }), query: query("tt-tutorials-en") },
        { card: card({ handle: "@c", title: "The Flash" }), query: query("tt-examples-en") },
        {
          card: {
            ...card({ platform: "yt", handle: "Cinecom", title: "flash transition tutorial", stats: { views: 900 } }),
            profile: "https://www.youtube.com/channel/UC1",
          },
          query: query("yt-tutorials-en"),
        },
        { card: card({ platform: "ig", handle: "", title: "flash transition edit" }), query: query("ig-examples-en") },
      ],
      plan,
    );
    const creators = creatorsOf(items, [
      { platform: "tt", handle: "@a", url: "https://www.tiktok.com/@a" },
      { platform: "ig", handle: "@zenko.edit", url: "https://www.instagram.com/zenko.edit/" },
    ]);
    expect(creators).toEqual([
      { platform: "tt", handle: "@a", url: "https://www.tiktok.com/@a", count: 2 },
      { platform: "yt", handle: "Cinecom", url: "https://www.youtube.com/channel/UC1", count: 1, views: 900 },
      { platform: "tt", handle: "@b", url: "https://www.tiktok.com/@b", count: 1 },
      { platform: "ig", handle: "@zenko.edit", url: "https://www.instagram.com/zenko.edit/", count: 0 },
    ]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd workers/scout && pnpm.cmd exec vitest run src/discover/label.test.ts`
Expected: FAIL — `Cannot find module './label'`.

- [ ] **Step 3: Write `label.ts`**

Create `workers/scout/src/discover/label.ts`:

```ts
/**
 * Discover v2 step 3: sections, off-topic and creators (planning/tools/13-discover-search-v2.md). Word rules,
 * no AI: a card is a Tutorial when it says so, else its query's intent; it is off-topic when it mentions none of
 * the topic's words, or (a dictionary entry with `specific: false`) no editing word either. With an Anthropic key
 * this is the step that would call Claude instead.
 */

import type { Profile, ScoutResult } from "../normalize";
import { normalizeForMatch } from "../social/replies";
import { hasArabic } from "../trends/normalize";
import type { Creator, DiscoverItem, PlannedQuery, SearchPlan } from "./types";

export const TUTORIAL_RE =
  /\b(?:tutorial|tutorials|how to|how-to|guide|step by step|explained|breakdown|learn|lesson)\b|شرح|طريقة|كيف|تعلم|درس|خطوات|تعليم/i;

/** Editing words in `normalizeForMatch` form ("تأثير" becomes "تاثير"): they make a vague word an editing topic. */
const EDITING_WORDS = [
  "edit", "edits", "editing", "editor", "transition", "transitions", "effect", "effects", "capcut", "davinci",
  "premiere", "after effects", "final cut", "cut", "vfx", "مونتاج", "ايديت", "تاثير", "انتقال", "كاب كت",
  "دافنشي", "مونتير", "فاينل كت",
];

const mentions = (text: string, phrase: string) => !!phrase && ` ${text} `.includes(` ${phrase} `);

export function labelCards(
  found: { card: ScoutResult & { profile?: string }; query: PlannedQuery }[],
  plan: SearchPlan,
): DiscoverItem[] {
  const seen = new Set<string>();
  const out: DiscoverItem[] = [];
  for (const { card, query } of found) {
    if (seen.has(card.url)) continue;
    seen.add(card.url);
    const raw = `${card.title} ${card.snippet}`;
    const text = normalizeForMatch(raw);
    const section = TUTORIAL_RE.test(raw) || query.intent === "tutorials" ? "tutorial" : "example";
    const onTopic =
      plan.topicWords.length === 0 ||
      (plan.topicWords.some((w) => mentions(text, w)) &&
        (!plan.needsEditingWord || EDITING_WORDS.some((w) => mentions(text, w))));
    out.push({
      ...card,
      lang: hasArabic(raw) ? "ar" : query.lang,
      section,
      ...(onTopic ? {} : { offTopic: true as const }),
    });
  }
  return out;
}

/** A card's account page: the YouTube channel it came with, else built from the TikTok / Instagram "@handle". */
function creatorUrl(item: DiscoverItem): string | undefined {
  if (item.profile) return item.profile;
  if (!item.handle.startsWith("@")) return undefined;
  if (item.platform === "tt") return `https://www.tiktok.com/${item.handle}`;
  if (item.platform === "ig") return `https://www.instagram.com/${item.handle.slice(1)}/`;
  return `https://www.youtube.com/${item.handle}`;
}

export function creatorsOf(
  items: readonly DiscoverItem[],
  profiles: readonly Profile[],
  max = 8,
): Creator[] {
  const byKey = new Map<string, Creator>();
  for (const item of items) {
    if (item.offTopic || !item.handle) continue;
    const url = creatorUrl(item);
    if (!url) continue;
    const key = `${item.platform}:${item.handle.toLowerCase()}`;
    const c = byKey.get(key) ?? { platform: item.platform, handle: item.handle, url, count: 0 };
    c.count += 1;
    const views = item.stats?.views;
    if (views !== undefined) c.views = (c.views ?? 0) + views;
    byKey.set(key, c);
  }
  const ranked = [...byKey.values()].sort((a, b) => b.count - a.count || (b.views ?? 0) - (a.views ?? 0));
  for (const p of profiles) {
    const key = `${p.platform}:${p.handle.toLowerCase()}`;
    if (byKey.has(key)) continue;
    const c: Creator = { platform: p.platform, handle: p.handle, url: p.url, count: 0 };
    byKey.set(key, c);
    ranked.push(c);
  }
  return ranked.slice(0, max);
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd workers/scout && pnpm.cmd exec vitest run src/discover/label.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add workers/scout/src/discover/label.ts workers/scout/src/discover/label.test.ts
git commit -m "Discover v2: sections, off-topic hiding and creators by word rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The pipeline, `POST /discover`, `GET /discover/usage`, `/health` says `discover: true`

**Files:**
- Create: `workers/scout/src/youtubeStats.ts` (moved out of `scout.ts`, so `discover/run.ts` can use it without an
  import cycle)
- Modify: `workers/scout/src/scout.ts`
- Create: `workers/scout/src/discover/run.ts`, `workers/scout/src/discover/usage.ts`, `workers/scout/src/discover/routes.ts`
- Test: `workers/scout/src/discover/run.test.ts`, `workers/scout/src/discover/routes.test.ts`
- Modify: `workers/scout/wrangler.jsonc` (the two new vars)

**Interfaces:**
- Consumes: Tasks 2–5 (`planSearch`, `tavilyCall`, `youtubeCall`, `reserveYoutube`, `youtubeUsedToday`, `youtubeCap`,
  `labelCards`, `creatorsOf`, types); `riyadhDay` (`../social/time`).
- Produces:
  ```ts
  // youtubeStats.ts
  export const YT_STATS_MAX = 50; export const STATS_TIMEOUT_MS = 2500;
  export function youtubeStatsUrl(key: string, ids: readonly string[]): string;
  export function enrichYoutubeStats(results: ScoutResult[], env: { YOUTUBE_API_KEY?: string }, doFetch: typeof fetch, timeoutMs?: number): Promise<void>;
  // run.ts
  export const ANSWER_TTL_S = 21_600; export const MAX_RETRIES = 2;
  export const discoverAnswerKey: (hash: string) => string;
  export interface RunDeps { fetch: typeof fetch; now: Date; timeoutMs?: number }
  export function requestHash(req: DiscoverRequest): Promise<string>;
  export function runDiscover(env: FetchEnv, req: DiscoverRequest, deps: RunDeps): Promise<DiscoverResponse>;
  // usage.ts
  export const TAVILY_USAGE_URL = "https://api.tavily.com/usage"; export const USAGE_TTL_S = 600; export const DEFAULT_CONNECTOR_CAP = 60;
  export const usageKeys: { tavily: string; connector: (riyadhDayKey: string) => string };
  export interface UsageEnv extends FetchEnv { MCP_DAILY_LOOKUPS?: string }
  export interface TavilyUsage { used: number; limit: number | null; plan?: string; paygoUsed?: number; paygoLimit?: number | null }
  export interface UsageAnswer { tavily: TavilyUsage | { error: PlatformError }; youtube: { usedToday: number; cap: number }; connector: { usedToday: number; cap: number } }
  export function connectorCap(env: UsageEnv): number;
  export function connectorUsedToday(env: UsageEnv, now: Date): Promise<number>;
  export function discoverUsage(env: UsageEnv, doFetch: typeof fetch, now: Date): Promise<UsageAnswer>;
  // routes.ts
  export function parseDiscoverBody(raw: unknown): DiscoverRequest | null;
  export function handleDiscover(req: Request, env: UsageEnv, cors: Headers, deps: { fetch?: typeof fetch; now?: () => Date }): Promise<Response | null>;
  ```

- [ ] **Step 1: Move the YouTube statistics helper**

Create `workers/scout/src/youtubeStats.ts` holding, unchanged, the code now in `scout.ts` under
`/* ---------- YouTube statistics ---------- */` (`interface YtStatsReply`, `ytCount`, `youtubeStatsUrl`,
`enrichYoutubeStats`), headed by:

```ts
/**
 * YouTube view / like / comment counts for search cards (round 31, the "Most popular" sort): ONE
 * `videos.list?part=statistics` for every YouTube card. Moved out of scout.ts in round 33 so Discover v2
 * (discover/run.ts) uses it without an import cycle; scout.ts re-exports it.
 */

import { youtubeVideoId, type ScoutResult, type Stats } from "./normalize";
import { YT_VIDEOS_URL } from "./trends/youtube";

/** `videos.list` takes at most this many ids in one call. */
export const YT_STATS_MAX = 50;
/** The statistics call gives up after this long; the cards then stay without counts. */
export const STATS_TIMEOUT_MS = 2500;
```

Change only the signature of `enrichYoutubeStats` to
`(results: ScoutResult[], env: { YOUTUBE_API_KEY?: string }, doFetch: typeof fetch, timeoutMs = STATS_TIMEOUT_MS)`.
In `scout.ts`: delete that section and `export const YT_STATS_MAX = 50;`, delete the now unused
`import { YT_VIDEOS_URL } from "./trends/youtube";`, and add next to the other imports:

```ts
import { enrichYoutubeStats } from "./youtubeStats";
export { enrichYoutubeStats, YT_STATS_MAX, youtubeStatsUrl } from "./youtubeStats";
```

Run: `cd workers/scout && pnpm.cmd exec vitest run src/scout.test.ts && pnpm.cmd typecheck`
Expected: PASS, no type errors (the tests import these names from `./scout`, which re-exports them).

- [ ] **Step 2: Write the failing pipeline tests**

Create `workers/scout/src/discover/run.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { TAVILY_URL } from "../trends/tavily";
import { discoverKeys } from "./fetchers";
import { ANSWER_TTL_S, discoverAnswerKey, requestHash, runDiscover } from "./run";
import { discoverUsage, usageKeys } from "./usage";

const NOW = new Date("2026-10-03T09:00:00Z");

type Entry = { value: string; expirationTtl?: number };
function fakeKV() {
  const store = new Map<string, Entry>();
  return {
    store,
    async get(key: string) {
      return store.get(key)?.value ?? null;
    },
    async put(key: string, value: string, opts?: { expirationTtl?: number }) {
      store.set(key, { value, expirationTtl: opts?.expirationTtl });
    },
  } as unknown as KVNamespace & { store: Map<string, Entry> };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Body = Record<string, unknown>;

/** A fake internet: Tavily answers per platform and query, YouTube search and statistics answer. */
function web(over: { tavily?: (body: Body) => Response | undefined } = {}) {
  let n = 0;
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (url.href === TAVILY_URL) {
      const body = JSON.parse(String(init?.body)) as Body;
      const custom = over.tavily?.(body);
      if (custom) return custom;
      const q = String(body.query);
      const domain = (body.include_domains as string[])[0];
      const results =
        domain === "tiktok.com"
          ? [
              { url: `https://www.tiktok.com/@ed/video/${++n}`, title: `${q} 🔥`, content: q },
              { url: `https://www.tiktok.com/@fan/video/${++n}`, title: "The Flash reaction", content: "superhero" },
            ]
          : [{ url: `https://www.instagram.com/p/P${++n}/`, title: `${q} reel`, content: `${q} reel` }];
      return json({ results, usage: { credits: 1 } });
    }
    if (url.pathname.endsWith("/youtube/v3/search")) {
      const q = url.searchParams.get("q") ?? "";
      return json({
        items: [
          {
            id: { videoId: `v${++n}` },
            snippet: { title: q, description: "", channelTitle: "Cinecom", channelId: "UC1", publishedAt: "2026-09-01T00:00:00Z" },
          },
        ],
      });
    }
    if (url.pathname.endsWith("/youtube/v3/videos")) {
      const ids = (url.searchParams.get("id") ?? "").split(",");
      return json({ items: ids.map((id) => ({ id, statistics: { viewCount: "1000" } })) });
    }
    return json({ error: "not_found" }, 404);
  });
}

const ENV = () => ({ TAVILY_API_KEY: "k", YOUTUBE_API_KEY: "y", SOCIAL_KV: fakeKV() });

describe("runDiscover", () => {
  it("searches every platform, labels, ranks creators, counts the cost and caches the answer", async () => {
    const env = ENV();
    const fetchMock = web();
    const answer = await runDiscover(env, { q: "flash" }, { fetch: fetchMock, now: NOW });

    expect(answer.topicKey).toBe("flash-transition");
    expect(answer.platforms).toEqual({ tt: { ok: true }, ig: { ok: true }, yt: { ok: true } });
    expect(answer.cost).toEqual({ tavily: 6, youtubeSearch: 3 });
    expect(answer.cached).toBe(false);
    const tiktok = answer.items.filter((i) => i.platform === "tt");
    expect(tiktok).toHaveLength(6);
    expect(tiktok.filter((i) => i.offTopic)).toHaveLength(3);
    expect(answer.items.filter((i) => i.platform === "yt").every((i) => i.stats?.views === 1000)).toBe(true);
    expect(answer.creators.slice(0, 2).map((c) => c.handle)).toEqual(["Cinecom", "@ed"]);
    expect(new Set(answer.items.map((i) => i.section))).toEqual(new Set(["example", "tutorial"]));

    const key = discoverAnswerKey(await requestHash({ q: "flash" }));
    expect(env.SOCIAL_KV.store.get(key)?.expirationTtl).toBe(ANSWER_TTL_S);
    expect(env.SOCIAL_KV.store.get(discoverKeys.yt("2026-10-03"))?.value).toBe("3");

    const calls = fetchMock.mock.calls.length;
    const again = await runDiscover(env, { q: "  FLASH " }, { fetch: fetchMock, now: NOW });
    expect(again.cached).toBe(true);
    expect(again.items).toEqual(answer.items);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("asks an empty TikTok query once more with its other words", async () => {
    const fetchMock = web({
      tavily: (body) =>
        body.query === "flash transition edit" && (body.include_domains as string[])[0] === "tiktok.com"
          ? json({ results: [{ url: "https://www.tiktok.com/@ed", title: "ed" }], usage: { credits: 1 } })
          : undefined,
    });
    const answer = await runDiscover(ENV(), { q: "flash" }, { fetch: fetchMock, now: NOW });
    expect(answer.platforms.tt).toEqual({ ok: true, retried: true });
    expect(answer.cost.tavily).toBe(7);
  });

  it("reports a platform that failed and does not cache that answer", async () => {
    const env = ENV();
    const fetchMock = web({
      tavily: (body) => ((body.include_domains as string[])[0] === "instagram.com" ? json({}, 500) : undefined),
    });
    const answer = await runDiscover(env, { q: "flash" }, { fetch: fetchMock, now: NOW });
    expect(answer.platforms.ig).toEqual({ ok: false, error: "upstream" });
    expect(answer.items.some((i) => i.platform === "tt")).toBe(true);
    expect([...env.SOCIAL_KV.store.keys()].some((k) => k.startsWith("discover:answer:"))).toBe(false);
  });

  it("stops YouTube at the day's cap without calling it", async () => {
    const env = ENV();
    await env.SOCIAL_KV.put(discoverKeys.yt("2026-10-03"), "70");
    const fetchMock = web();
    const answer = await runDiscover(env, { q: "flash" }, { fetch: fetchMock, now: NOW });
    expect(answer.platforms.yt).toEqual({ ok: false, error: "daily_cap" });
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/youtube/v3/search"))).toBe(false);
    expect(answer.cost.youtubeSearch).toBe(0);
  });

  it("says YouTube is not configured without its key", async () => {
    const answer = await runDiscover({ TAVILY_API_KEY: "k" }, { q: "flash" }, { fetch: web(), now: NOW });
    expect(answer.platforms.yt).toEqual({ ok: false, error: "not_configured" });
  });

  it("hashes the request, not its spelling", async () => {
    expect(await requestHash({ q: "Flash" })).toBe(await requestHash({ q: " flash  " }));
    expect(await requestHash({ q: "flash" })).not.toBe(await requestHash({ q: "flash", exact: true }));
    expect(await requestHash({ q: "flash", platforms: ["yt", "tt"] })).toBe(
      await requestHash({ q: "flash", platforms: ["tt", "yt"] }),
    );
  });
});

describe("discoverUsage", () => {
  it("reads Tavily's usage once per 10 minutes and today's counters", async () => {
    const kv = fakeKV();
    await kv.put(discoverKeys.yt("2026-10-03"), "9");
    await kv.put(usageKeys.connector("2026-10-03"), "12");
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json({
        key: { usage: 400, limit: null },
        account: { current_plan: "Researcher", plan_usage: 412, plan_limit: 1000, paygo_usage: 0, paygo_limit: 5000 },
      }),
    );
    const env = { TAVILY_API_KEY: "k", SOCIAL_KV: kv };
    const usage = await discoverUsage(env, fetchMock, NOW);
    expect(usage).toEqual({
      tavily: { used: 412, limit: 1000, plan: "Researcher", paygoUsed: 0, paygoLimit: 5000 },
      youtube: { usedToday: 9, cap: 70 },
      connector: { usedToday: 12, cap: 60 },
    });
    expect(kv.store.get(usageKeys.tavily)?.expirationTtl).toBe(600);
    await discoverUsage(env, fetchMock, NOW);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("says why Tavily's usage is missing", async () => {
    expect((await discoverUsage({}, vi.fn(), NOW)).tavily).toEqual({ error: "not_configured" });
    const refused = vi.fn<typeof fetch>(async () => json({}, 401));
    expect((await discoverUsage({ TAVILY_API_KEY: "k" }, refused, NOW)).tavily).toEqual({ error: "auth" });
  });
});
```

Note: `usageKeys.connector` takes the **Riyadh** day; 2026-10-03T09:00Z is 12:00 in Riyadh, the same date.

- [ ] **Step 3: Run them to see them fail**

Run: `cd workers/scout && pnpm.cmd exec vitest run src/discover/run.test.ts`
Expected: FAIL — `Cannot find module './run'`.

- [ ] **Step 4: Write `run.ts`**

Create `workers/scout/src/discover/run.ts`:

```ts
/**
 * Discover v2: the whole search (planning/tools/13-discover-search-v2.md). Plan → Tavily (TikTok, Instagram) and
 * YouTube at once → one `videos.list` for the YouTube numbers → labels and creators → one answer, kept 6 h in KV
 * (`discover:answer:<sha-256 of the normalized request>`) when every platform answered, so the dashboard and the
 * connector asking the same thing spend once. At most ~16 outbound calls (9 searches, 2 retries, the statistics
 * call, KV) of the 50 a free invocation allows.
 */

import type { Platform, Profile, ScoutResult } from "../normalize";
import { enrichYoutubeStats } from "../youtubeStats";
import { reserveYoutube, tavilyCall, youtubeCall, type FetchEnv, type TavilyOutcome } from "./fetchers";
import { creatorsOf, labelCards } from "./label";
import { planSearch } from "./plan";
import type { DiscoverRequest, DiscoverResponse, PlannedQuery, PlatformError, PlatformStatus } from "./types";

export const ANSWER_TTL_S = 6 * 3600;
export const MAX_RETRIES = 2;
export const discoverAnswerKey = (hash: string) => `discover:answer:${hash}`;

export interface RunDeps {
  fetch: typeof fetch;
  now: Date;
  /** Each search call's limit (ms); tests may shorten it. */
  timeoutMs?: number;
}

/** SHA-256 of the request in a normal form (case, spaces and platform order do not matter). */
export async function requestHash(req: DiscoverRequest): Promise<string> {
  const canonical = JSON.stringify({
    q: req.q.trim().toLowerCase().replace(/\s+/g, " "),
    exact: !!req.exact,
    term: req.term ?? "",
    genre: [req.genreQuery?.ar ?? "", req.genreQuery?.en ?? ""],
    program: req.program ?? "",
    timeRange: req.timeRange ?? "",
    ytLength: req.ytLength ?? "",
    platforms: [...(req.platforms ?? ["tt", "ig", "yt"])].sort(),
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Card = ScoutResult & { profile?: string };
interface QueryResult {
  query: PlannedQuery;
  cards: Card[];
  error?: PlatformError;
  retried?: boolean;
}

/** Round robin over the queries' cards, so every query shows near the top of its section. */
function interleave(results: readonly QueryResult[]): { card: Card; query: PlannedQuery }[] {
  const out: { card: Card; query: PlannedQuery }[] = [];
  const longest = Math.max(0, ...results.map((r) => r.cards.length));
  for (let i = 0; i < longest; i++) {
    for (const r of results) if (r.cards[i]) out.push({ card: r.cards[i], query: r.query });
  }
  return out;
}

/** A platform answered when one of its queries did; else the first query's error. */
function statusOf(results: readonly QueryResult[]): PlatformStatus {
  const ok = results.filter((r) => !r.error);
  if (ok.length) return ok.some((r) => r.retried) ? { ok: true, retried: true } : { ok: true };
  return { ok: false, error: results[0]?.error ?? "upstream" };
}

export async function runDiscover(env: FetchEnv, req: DiscoverRequest, deps: RunDeps): Promise<DiscoverResponse> {
  const key = discoverAnswerKey(await requestHash(req));
  const cached = env.SOCIAL_KV ? await env.SOCIAL_KV.get(key, "text").catch(() => null) : null;
  if (cached) {
    try {
      return { ...(JSON.parse(cached) as DiscoverResponse), cached: true };
    } catch {
      // A broken entry: search again (the new answer replaces it).
    }
  }

  const plan = planSearch(req);
  const profiles: Profile[] = [];
  let credits = 0;
  let retriesLeft = MAX_RETRIES;

  const tavily = plan.queries
    .filter((q) => q.platform !== "yt")
    .map(async (query): Promise<QueryResult> => {
      const call = { q: query.q, platform: query.platform as "tt" | "ig", lang: query.lang, timeRange: req.timeRange };
      let out: TavilyOutcome = await tavilyCall(env, deps.fetch, call, deps.timeoutMs);
      if (out.ok) credits += out.credits;
      let retried = false;
      if (out.ok && out.cards.length === 0 && query.retryQ && retriesLeft > 0) {
        retriesLeft -= 1;
        retried = true;
        const again = await tavilyCall(env, deps.fetch, { ...call, q: query.retryQ }, deps.timeoutMs);
        if (again.ok) {
          credits += again.credits;
          out = { ...again, profiles: [...out.profiles, ...again.profiles] };
        }
      }
      if (!out.ok) return { query, cards: [], error: out.error };
      profiles.push(...out.profiles);
      return { query, cards: out.cards, retried };
    });

  const ytQueries = plan.queries.filter((q) => q.platform === "yt");
  let youtubeSearch = 0;
  const youtube = (async (): Promise<QueryResult[]> => {
    if (!ytQueries.length) return [];
    if (!env.YOUTUBE_API_KEY) return ytQueries.map((query) => ({ query, cards: [], error: "not_configured" as const }));
    const granted = await reserveYoutube(env, ytQueries.length, deps.now).catch(() => ytQueries.length);
    youtubeSearch = granted;
    if (granted === 0) return ytQueries.map((query) => ({ query, cards: [], error: "daily_cap" as const }));
    return Promise.all(
      ytQueries.slice(0, granted).map(async (query): Promise<QueryResult> => {
        const call = { q: query.q, lang: query.lang, timeRange: req.timeRange, ytLength: req.ytLength };
        const out = await youtubeCall(env, deps.fetch, call, deps.now, deps.timeoutMs);
        return out.ok ? { query, cards: out.cards } : { query, cards: [], error: out.error };
      }),
    );
  })();

  const [tavilyResults, ytResults] = await Promise.all([Promise.all(tavily), youtube]);
  const ytCards = ytResults.flatMap((r) => r.cards);
  if (ytCards.length) await enrichYoutubeStats(ytCards, env, deps.fetch);

  const results = [...tavilyResults, ...ytResults];
  const items = labelCards(interleave(results), plan);
  const platforms: Partial<Record<Platform, PlatformStatus>> = {};
  for (const p of ["tt", "ig", "yt"] as const) {
    const mine = results.filter((r) => r.query.platform === p);
    if (mine.length) platforms[p] = statusOf(mine);
  }
  const answer: DiscoverResponse = {
    topicKey: plan.topicKey,
    understood: plan.understood,
    alternatives: plan.alternatives,
    items,
    creators: creatorsOf(items, profiles),
    platforms,
    cost: { tavily: credits, youtubeSearch },
    cached: false,
  };
  if (env.SOCIAL_KV && Object.values(platforms).every((s) => s?.ok)) {
    await env.SOCIAL_KV.put(key, JSON.stringify(answer), { expirationTtl: ANSWER_TTL_S }).catch(() => undefined);
  }
  return answer;
}
```

- [ ] **Step 5: Write `usage.ts`**

Create `workers/scout/src/discover/usage.ts`:

```ts
/**
 * GET /discover/usage: the real numbers behind the dashboard's "412 of 1,000" line (planning/tools/13). Tavily's
 * own `GET /usage` (account and key), kept 10 minutes in KV so opening Discover does not ask every time; today's
 * YouTube calls of Discover + the connector (UTC day); today's connector lookups (Riyadh day, the connector's cap).
 */

import { riyadhDay } from "../social/time";
import { youtubeCap, youtubeUsedToday, type FetchEnv } from "./fetchers";
import type { PlatformError } from "./types";

export const TAVILY_USAGE_URL = "https://api.tavily.com/usage";
export const USAGE_TTL_S = 600;
export const DEFAULT_CONNECTOR_CAP = 60;
export const usageKeys = {
  tavily: "discover:usage:tavily",
  connector: (riyadhDayKey: string) => `discover:mcp:${riyadhDayKey}`,
};

export interface UsageEnv extends FetchEnv {
  /** Var: Tavily lookups the connector may spend a Riyadh day (default 60). */
  MCP_DAILY_LOOKUPS?: string;
}

export interface TavilyUsage {
  used: number;
  limit: number | null;
  plan?: string;
  paygoUsed?: number;
  paygoLimit?: number | null;
}

export interface UsageAnswer {
  tavily: TavilyUsage | { error: PlatformError };
  youtube: { usedToday: number; cap: number };
  connector: { usedToday: number; cap: number };
}

interface TavilyUsageReply {
  key?: { usage?: unknown; limit?: unknown };
  account?: { current_plan?: unknown; plan_usage?: unknown; plan_limit?: unknown; paygo_usage?: unknown; paygo_limit?: unknown };
}

const count = (x: unknown): number | undefined =>
  typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.floor(x) : undefined;

export function connectorCap(env: UsageEnv): number {
  const n = Number(env.MCP_DAILY_LOOKUPS);
  return env.MCP_DAILY_LOOKUPS !== undefined && Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_CONNECTOR_CAP;
}

export async function connectorUsedToday(env: UsageEnv, now: Date): Promise<number> {
  if (!env.SOCIAL_KV) return 0;
  const n = Number((await env.SOCIAL_KV.get(usageKeys.connector(riyadhDay(now)), "text")) ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

async function tavilyUsage(env: UsageEnv, doFetch: typeof fetch): Promise<TavilyUsage | { error: PlatformError }> {
  if (!env.TAVILY_API_KEY) return { error: "not_configured" };
  const kept = env.SOCIAL_KV ? await env.SOCIAL_KV.get(usageKeys.tavily, "text").catch(() => null) : null;
  if (kept) {
    try {
      return JSON.parse(kept) as TavilyUsage;
    } catch {
      // ask again
    }
  }
  let res: Response;
  try {
    res = await doFetch(TAVILY_USAGE_URL, {
      headers: { Authorization: `Bearer ${env.TAVILY_API_KEY}`, Accept: "application/json" },
    });
  } catch {
    return { error: "upstream" };
  }
  if (res.status === 401 || res.status === 403) return { error: "auth" };
  if (!res.ok) return { error: "upstream" };
  const body = (await res.json().catch(() => null)) as TavilyUsageReply | null;
  const k = body?.key ?? {};
  const a = body?.account ?? {};
  const paygoLimit = a.paygo_limit === null ? null : count(a.paygo_limit);
  const paygoUsed = count(a.paygo_usage);
  const usage: TavilyUsage = {
    used: count(a.plan_usage) ?? count(k.usage) ?? 0,
    limit: count(a.plan_limit) ?? count(k.limit) ?? null,
    ...(typeof a.current_plan === "string" ? { plan: a.current_plan } : {}),
    ...(paygoUsed !== undefined ? { paygoUsed } : {}),
    ...(paygoLimit !== undefined ? { paygoLimit } : {}),
  };
  if (env.SOCIAL_KV) {
    await env.SOCIAL_KV.put(usageKeys.tavily, JSON.stringify(usage), { expirationTtl: USAGE_TTL_S }).catch(() => undefined);
  }
  return usage;
}

export async function discoverUsage(env: UsageEnv, doFetch: typeof fetch, now: Date): Promise<UsageAnswer> {
  const [tavily, yt, connector] = await Promise.all([
    tavilyUsage(env, doFetch),
    youtubeUsedToday(env, now).catch(() => 0),
    connectorUsedToday(env, now).catch(() => 0),
  ]);
  return {
    tavily,
    youtube: { usedToday: yt, cap: youtubeCap(env) },
    connector: { usedToday: connector, cap: connectorCap(env) },
  };
}
```

- [ ] **Step 6: Run the pipeline tests to see them pass**

Run: `cd workers/scout && pnpm.cmd exec vitest run src/discover/run.test.ts`
Expected: PASS.

- [ ] **Step 7: Write the failing route tests**

Create `workers/scout/src/discover/routes.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { handle, type Env } from "../scout";
import { parseDiscoverBody } from "./routes";

const TOKEN = "s3cret-token";
const APP = "https://3zmd95-glitch.github.io";
const BASE = "https://3z-scout.example.workers.dev";
const ENV: Env = { SCOUT_TOKEN: TOKEN, ALLOWED_ORIGINS: APP, TAVILY_API_KEY: "k" };

const req = (path: string, init: RequestInit & { token?: string | null } = {}) => {
  const { token = TOKEN, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  headers.set("Origin", APP);
  return new Request(`${BASE}${path}`, { ...rest, headers });
};
const post = (body: unknown, token: string | null = TOKEN) =>
  req("/discover", { method: "POST", token, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("parseDiscoverBody", () => {
  it("normalizes a good request", () => {
    expect(
      parseDiscoverBody({ q: " flash ", term: "camera-flash", genreQuery: { en: "car edit" }, platforms: ["tt", "tt", "yt"] }),
    ).toEqual({ q: "flash", term: "camera-flash", genreQuery: { en: "car edit" }, platforms: ["tt", "yt"] });
  });

  it("refuses bad fields", () => {
    for (const bad of [
      null,
      {},
      { q: "" },
      { q: "x".repeat(201) },
      { q: "x", exact: "yes" },
      { q: "x", term: "Bad Id" },
      { q: "x", timeRange: "day" },
      { q: "x", ytLength: "medium" },
      { q: "x", platforms: [] },
      { q: "x", platforms: ["fb"] },
      { q: "x", genreQuery: "car" },
      { q: "x", genreQuery: { ar: " " } },
    ]) {
      expect(parseDiscoverBody(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("/discover routes", () => {
  it("needs the token", async () => {
    const res = await handle(post({ q: "flash" }, null), ENV, undefined, { fetch: vi.fn() });
    expect(res.status).toBe(401);
  });

  it("answers 400 to a bad body without spending anything", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const res = await handle(post({ q: "" }), ENV, undefined, { fetch: fetchMock });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers a search with CORS for the dashboard", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json({ results: [], usage: { credits: 1 } }));
    const res = await handle(post({ q: "flash", platforms: ["tt"] }), ENV, undefined, { fetch: fetchMock });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(APP);
    const body = (await res.json()) as { topicKey: string; platforms: unknown };
    expect(body.topicKey).toBe("flash-transition");
    // Every TikTok query came back empty, so two of them were asked again (retries) — still an answer.
    expect(body.platforms).toEqual({ tt: { ok: true, retried: true } });
  });

  it("serves the usage", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json({ account: { plan_usage: 5, plan_limit: 1000 } }));
    const res = await handle(req("/discover/usage"), ENV, undefined, { fetch: fetchMock });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { tavily: unknown }).tavily).toEqual({ used: 5, limit: 1000 });
  });

  it("tells the dashboard it can search the new way", async () => {
    const res = await handle(req("/health"), ENV, undefined, { fetch: vi.fn() });
    expect(((await res.json()) as { discover?: boolean }).discover).toBe(true);
  });

  it("leaves unknown /discover paths to the 404", async () => {
    const res = await handle(req("/discover/nope"), ENV, undefined, { fetch: vi.fn() });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 8: Run them to see them fail**

Run: `cd workers/scout && pnpm.cmd exec vitest run src/discover/routes.test.ts`
Expected: FAIL — `Cannot find module './routes'`.

- [ ] **Step 9: Write `routes.ts`**

Create `workers/scout/src/discover/routes.ts`:

```ts
/**
 * Discover v2 routes (planning/tools/13-discover-search-v2.md), behind the owner token like `/search`:
 *   POST /discover        → the sectioned answer (run.ts)
 *   GET  /discover/usage  → Tavily's usage and today's counters (usage.ts)
 * Returns null for any other path, so the router goes on (and answers 404 at the end).
 */

import { PLATFORMS, type Platform } from "../normalize";
import { runDiscover } from "./run";
import type { DiscoverRequest, DiscoverTimeRange } from "./types";
import { discoverUsage, type UsageEnv } from "./usage";

const TIME_RANGES: readonly DiscoverTimeRange[] = ["week", "month", "year"];
const TERM_ID = /^[a-z][a-z0-9-]{0,59}$/;

function reply(body: unknown, status: number, cors: Headers): Response {
  const headers = new Headers(cors);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

/** undefined: absent; null: present but not a usable text of at most `max` characters. */
function optText(x: unknown, max: number): string | undefined | null {
  if (x === undefined) return undefined;
  return typeof x === "string" && x.trim() && x.length <= max ? x.trim() : null;
}

export function parseDiscoverBody(raw: unknown): DiscoverRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const q = typeof b.q === "string" ? b.q.trim() : "";
  if (!q || q.length > 200) return null;
  if (b.exact !== undefined && typeof b.exact !== "boolean") return null;
  if (b.term !== undefined && (typeof b.term !== "string" || !TERM_ID.test(b.term))) return null;
  const program = optText(b.program, 60);
  if (program === null) return null;
  if (b.timeRange !== undefined && !TIME_RANGES.includes(b.timeRange as DiscoverTimeRange)) return null;
  if (b.ytLength !== undefined && b.ytLength !== "short" && b.ytLength !== "long") return null;
  let genreQuery: DiscoverRequest["genreQuery"];
  if (b.genreQuery !== undefined) {
    if (!b.genreQuery || typeof b.genreQuery !== "object") return null;
    const g = b.genreQuery as Record<string, unknown>;
    const ar = optText(g.ar, 100);
    const en = optText(g.en, 100);
    if (ar === null || en === null) return null;
    genreQuery = { ...(ar ? { ar } : {}), ...(en ? { en } : {}) };
  }
  let platforms: Platform[] | undefined;
  if (b.platforms !== undefined) {
    if (!Array.isArray(b.platforms) || b.platforms.length === 0) return null;
    if (!b.platforms.every((p) => PLATFORMS.includes(p as Platform))) return null;
    platforms = [...new Set(b.platforms as Platform[])];
  }
  return {
    q,
    ...(b.exact === true ? { exact: true } : {}),
    ...(typeof b.term === "string" ? { term: b.term } : {}),
    ...(genreQuery ? { genreQuery } : {}),
    ...(program ? { program } : {}),
    ...(b.timeRange ? { timeRange: b.timeRange as DiscoverTimeRange } : {}),
    ...(b.ytLength ? { ytLength: b.ytLength as "short" | "long" } : {}),
    ...(platforms ? { platforms } : {}),
  };
}

export async function handleDiscover(
  req: Request,
  env: UsageEnv,
  cors: Headers,
  deps: { fetch?: typeof fetch; now?: () => Date },
): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  if (pathname !== "/discover" && !pathname.startsWith("/discover/")) return null;
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now?.() ?? new Date();
  if (pathname === "/discover" && req.method === "POST") {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return reply({ error: "bad_request" }, 400, cors);
    }
    const body = parseDiscoverBody(raw);
    if (!body) return reply({ error: "bad_request" }, 400, cors);
    try {
      return reply(await runDiscover(env, body, { fetch: doFetch, now }), 200, cors);
    } catch {
      return reply({ error: "upstream" }, 502, cors);
    }
  }
  if (pathname === "/discover/usage" && req.method === "GET") {
    return reply(await discoverUsage(env, doFetch, now), 200, cors);
  }
  return null;
}
```

- [ ] **Step 10: Wire it into `scout.ts`**

1. Add `import { handleDiscover } from "./discover/routes";`.
2. In `interface Env`, add:
   ```ts
     /** Var: YouTube `search.list` calls Discover and the connector may spend a UTC day (default 70). */
     DISCOVER_YT_CAP?: string;
     /** Var: Tavily lookups the Claude connector may spend a Riyadh day (default 60). */
     MCP_DAILY_LOOKUPS?: string;
   ```
3. In the valid-token `/health` answer, add `discover: true,` after `trends: healthTrends(env),`.
4. In `handle()`, right before `const social = await handleSocial(...)`, add:
   ```ts
     const discover = await handleDiscover(req, env, cors, { fetch: deps.fetch, now: deps.now });
     if (discover) return discover;
   ```
5. In the header comment's route list, after the `/oembed` line, add:
   ```
    *   POST /discover        → Discover v2: one sectioned search (discover/, planning/tools/13-discover-search-v2.md)
    *   GET  /discover/usage  → Tavily's usage and today's YouTube / connector counters
   ```

- [ ] **Step 11: Document the vars in `wrangler.jsonc`**

Inside `"vars"`, after `"TREND_KEYWORDS_EN"`, add:

```jsonc
    // Discover v2 (planning/tools/13-discover-search-v2.md): YouTube search.list calls Discover and the Claude
    // connector may spend a UTC day (the radar keeps its 18 of Google's 100), and the connector's Tavily
    // lookups a Riyadh day.
    "DISCOVER_YT_CAP": "70",
    "MCP_DAILY_LOOKUPS": "60",
```

- [ ] **Step 12: Run every Worker test and the typecheck**

Run: `cd workers/scout && pnpm.cmd exec vitest run && pnpm.cmd typecheck`
Expected: all PASS, no type errors. An existing `/health` test in `scout.test.ts` that compares the whole body with
`toEqual` must gain `discover: true` (the documented new field).

- [ ] **Step 13: Commit**

```bash
git add workers/scout/src workers/scout/wrangler.jsonc
git commit -m "Discover v2: POST /discover and GET /discover/usage in the Scout Worker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The dashboard's Discover client

**Files:**
- Modify: `lib/scoutClient.ts` (export `scoutCall`; `scoutHealth` reports `discover`)
- Create: `lib/discover.ts`
- Test: `lib/discover.test.ts`

**Interfaces:**
- Consumes: `ScoutConfig`, `ScoutError`, `ScoutSearchOpts`, `KeyValueStorage`, `Stats` (scoutClient);
  `popularityOf(stats?: Stats): number | undefined`, `ResearchTab`, `Recency`, `LengthFilter`, `SortMode`
  (lib/research.ts); `Genre`, `Lang` (lib/domain.ts).
- Produces:
  ```ts
  // lib/scoutClient.ts
  export const scoutCall: (config: ScoutConfig, path: string, init: RequestInit, opts: ScoutOpts) => Promise<{ ok: true; data: unknown } | { ok: false; error: ScoutError }>;
  export type ScoutHealthResult = { ok: true; tavily: boolean; discover: boolean } | { ok: false; error: ScoutError };
  // lib/discover.ts
  export type DiscoverPlatform; DiscoverSection; DiscoverItem; DiscoverCreator; DiscoverAlternative; DiscoverPlatformError;
  export type DiscoverPlatformStatus; DiscoverAnswer; DiscoverRequest; DiscoverResult; DiscoverPick; ViewOpts; DiscoverUsage;
  export function discoverRequestFrom(input: { base: string; genre?: Pick<Genre, "queries">; programHint?: string; recency: Recency; length: LengthFilter; pick?: DiscoverPick }): DiscoverRequest | null;
  export function parseDiscoverAnswer(raw: unknown): DiscoverAnswer | null;
  export function discoverRequestKey(config: ScoutConfig, req: DiscoverRequest): string;
  export function clearDiscoverCache(storage?: KeyValueStorage | null): void;
  export function peekDiscover(config: ScoutConfig | null, req: DiscoverRequest | null): DiscoverAnswer | undefined;
  export function discoverSearch(config: ScoutConfig, req: DiscoverRequest, opts?: ScoutSearchOpts): Promise<DiscoverResult>;
  export function sectionItems(answer: DiscoverAnswer, section: DiscoverSection, opts: ViewOpts & { sort: SortMode; arFirst: boolean }): DiscoverItem[];
  export function popularItems(answer: DiscoverAnswer, opts: ViewOpts, max?: number): DiscoverItem[];
  export function tabCounts(answer: DiscoverAnswer, showHidden: boolean): Record<ResearchTab, number>;
  export function hiddenCount(answer: DiscoverAnswer, tab: ResearchTab): number;
  export function creatorsOn(answer: DiscoverAnswer, tab: ResearchTab): DiscoverCreator[];
  export function discoverUsage(config: ScoutConfig, opts?: ScoutSearchOpts): Promise<{ ok: true; usage: DiscoverUsage } | { ok: false; error: ScoutError }>;
  ```

- [ ] **Step 1: Export the call and the capability**

In `lib/scoutClient.ts`:
1. Change the `ScoutHealthResult` type to `{ ok: true; tavily: boolean; discover: boolean } | { ok: false; error: ScoutError }`.
2. In `scoutHealth`, read `discover` and return it:
   ```ts
     const d = (r.data ?? {}) as { ok?: unknown; tavily?: unknown; discover?: unknown };
     // (the existing auth check stays)
     return { ok: true, tavily: d.tavily, discover: d.discover === true };
   ```
3. After the `call` function add:
   ```ts
   /** The authenticated Worker call (JSON in and out), for the other Worker clients (lib/discover.ts). */
   export const scoutCall = call;
   ```
4. Run `grep -rn "scoutHealth" lib components e2e` and add `discover: false` to any test expectation of a whole
   `scoutHealth` result whose stub sends no `discover`.

- [ ] **Step 2: Write the failing tests**

Create `lib/discover.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  clearDiscoverCache,
  creatorsOn,
  discoverRequestFrom,
  discoverSearch,
  hiddenCount,
  parseDiscoverAnswer,
  popularItems,
  sectionItems,
  tabCounts,
  type DiscoverAnswer,
  type DiscoverItem,
} from "./discover";

const config = { url: "https://w.example", token: "t" };
let n = 0;
const item = (over: Partial<DiscoverItem>): DiscoverItem => ({
  platform: "tt",
  handle: "@a",
  title: "flash transition edit",
  snippet: "",
  url: `https://www.tiktok.com/@a/video/${++n}`,
  lang: "en",
  section: "example",
  ...over,
});
const answer = (items: DiscoverItem[], over: Partial<DiscoverAnswer> = {}): DiscoverAnswer => ({
  topicKey: "flash-transition",
  understood: { termId: "flash-transition", label: { ar: "انتقال فلاش", en: "flash transition" }, exact: false },
  alternatives: [{ exact: true }],
  items,
  creators: [{ platform: "tt", handle: "@a", url: "https://www.tiktok.com/@a", count: 2 }],
  platforms: { tt: { ok: true } },
  cost: { tavily: 6, youtubeSearch: 3 },
  cached: false,
  ...over,
});

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

const CARS = {
  id: "cars",
  emoji: "🚗",
  name: { ar: "سيارات", en: "Cars" },
  queries: { ar: ["ايديت سيارات"], en: ["car edit"] },
  hashtags: ["caredit"],
};

describe("discoverRequestFrom", () => {
  it("builds the Worker request from the panel's state", () => {
    expect(
      discoverRequestFrom({ base: " flash ", genre: CARS, programHint: "DaVinci Resolve", recency: "week", length: "short" }),
    ).toEqual({
      q: "flash",
      genreQuery: { ar: "ايديت سيارات", en: "car edit" },
      program: "DaVinci Resolve",
      timeRange: "week",
      ytLength: "short",
    });
  });

  it("searches the genre alone when nothing is typed, and passes the owner's pick", () => {
    expect(discoverRequestFrom({ base: "", genre: CARS, recency: "any", length: "any", pick: { term: "camera-flash" } })).toEqual({
      q: "car edit",
      genreQuery: { ar: "ايديت سيارات", en: "car edit" },
      term: "camera-flash",
    });
    expect(discoverRequestFrom({ base: "  ", recency: "any", length: "any" })).toBeNull();
  });
});

describe("parseDiscoverAnswer", () => {
  it("keeps well-formed items and drops broken ones", () => {
    const raw = answer([item({}), { ...item({}), url: 7 } as unknown as DiscoverItem]);
    expect(parseDiscoverAnswer(raw)?.items).toHaveLength(1);
    expect(parseDiscoverAnswer({ nope: true })).toBeNull();
  });
});

describe("discoverSearch", () => {
  it("asks once, caches an answer where every platform answered, and serves it from the cache", async () => {
    clearDiscoverCache(null);
    const storage = memoryStorage();
    const body = answer([item({})]);
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body)));
    const first = await discoverSearch(config, { q: "flash" }, { fetchImpl, storage });
    const second = await discoverSearch(config, { q: "flash" }, { fetchImpl, storage });
    expect(first.ok && second.ok).toBe(true);
    expect(second.ok && second.answer.cached).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://w.example/discover");
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({ q: "flash" });
  });

  it("does not keep an answer with a failed platform", async () => {
    clearDiscoverCache(null);
    const storage = memoryStorage();
    const body = answer([item({})], { platforms: { tt: { ok: true }, ig: { ok: false, error: "upstream" } } });
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body)));
    await discoverSearch(config, { q: "flash" }, { fetchImpl, storage });
    await discoverSearch(config, { q: "flash" }, { fetchImpl, storage });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("views over an answer", () => {
  const items = [
    item({ section: "example", stats: { likes: 10 } }),
    item({ section: "tutorial", platform: "yt", stats: { views: 5000 }, published: "2026-09-01" }),
    item({ section: "example", platform: "ig", offTopic: true }),
    item({ section: "tutorial", lang: "ar", title: "شرح فلاش" }),
  ];
  const a = answer(items);

  it("counts the posts per tab, hidden ones apart", () => {
    expect(tabCounts(a, false)).toEqual({ all: 3, tt: 2, ig: 0, yt: 1 });
    expect(tabCounts(a, true)).toEqual({ all: 4, tt: 2, ig: 1, yt: 1 });
    expect(hiddenCount(a, "all")).toBe(1);
    expect(hiddenCount(a, "tt")).toBe(0);
  });

  it("fills a section for a tab, popular first or Arabic first when asked", () => {
    const opts = { tab: "all" as const, showHidden: false, sort: "relevance" as const, arFirst: false };
    expect(sectionItems(a, "tutorial", opts).map((i) => i.platform)).toEqual(["yt", "tt"]);
    expect(sectionItems(a, "tutorial", { ...opts, arFirst: true })[0].lang).toBe("ar");
    expect(sectionItems(a, "example", { ...opts, tab: "ig", showHidden: true })).toHaveLength(1);
  });

  it("ranks Popular now by views, else likes x 10", () => {
    expect(popularItems(a, { tab: "all", showHidden: false }).map((i) => i.platform)).toEqual(["yt", "tt"]);
  });

  it("lists creators of the tab", () => {
    expect(creatorsOn(a, "tt")).toHaveLength(1);
    expect(creatorsOn(a, "yt")).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm.cmd exec vitest run lib/discover.test.ts`
Expected: FAIL — `Cannot find module './discover'`.

- [ ] **Step 4: Write `lib/discover.ts`**

Create `lib/discover.ts`:

```ts
import type { Genre, Lang } from "./domain";
import { popularityOf, type LengthFilter, type Recency, type ResearchTab, type SortMode } from "./research";
import {
  scoutCall,
  type KeyValueStorage,
  type ScoutConfig,
  type ScoutError,
  type ScoutSearchOpts,
  type Stats,
} from "./scoutClient";

/**
 * Discover v2 client (round 33, planning/tools/13-discover-search-v2.md): one `POST /discover` per search, the
 * answer cached 24 h on this device (memory + localStorage, 30 entries) when every platform answered, and the
 * pure helpers the sections screen uses. The answer's shape MIRRORS workers/scout/src/discover/types.ts
 * (hand-copied): change both together.
 */

export type DiscoverPlatform = "tt" | "ig" | "yt";
export type DiscoverSection = "example" | "tutorial";

export interface DiscoverItem {
  platform: DiscoverPlatform;
  handle: string;
  title: string;
  snippet: string;
  url: string;
  thumb?: string;
  stats?: Stats;
  published?: string;
  lang: Lang;
  section: DiscoverSection;
  offTopic?: true;
  profile?: string;
}

export interface DiscoverCreator {
  platform: DiscoverPlatform;
  handle: string;
  url: string;
  count: number;
  views?: number;
}

export type DiscoverAlternative = { termId: string; label: { ar: string; en: string } } | { exact: true };
export type DiscoverPlatformError = "quota" | "auth" | "upstream" | "daily_cap" | "not_configured";
export type DiscoverPlatformStatus = { ok: true; retried?: boolean } | { ok: false; error: DiscoverPlatformError };

export interface DiscoverAnswer {
  topicKey: string;
  understood: { termId?: string; label: { ar: string; en: string }; exact: boolean };
  alternatives: DiscoverAlternative[];
  items: DiscoverItem[];
  creators: DiscoverCreator[];
  platforms: Partial<Record<DiscoverPlatform, DiscoverPlatformStatus>>;
  cost: { tavily: number; youtubeSearch: number };
  cached: boolean;
}

export interface DiscoverRequest {
  q: string;
  exact?: boolean;
  term?: string;
  genreQuery?: { ar?: string; en?: string };
  program?: string;
  timeRange?: "week" | "month" | "year";
  ytLength?: "short" | "long";
  platforms?: DiscoverPlatform[];
}

export type DiscoverResult = { ok: true; answer: DiscoverAnswer } | { ok: false; error: ScoutError };

/** The owner's "Not this?" choice for the current topic. */
export interface DiscoverPick {
  term?: string;
  exact?: boolean;
}

/* ---------- the request ---------- */

export function discoverRequestFrom(input: {
  base: string;
  genre?: Pick<Genre, "queries">;
  programHint?: string;
  recency: Recency;
  length: LengthFilter;
  pick?: DiscoverPick;
}): DiscoverRequest | null {
  const genreQuery = input.genre ? { ar: input.genre.queries.ar[0], en: input.genre.queries.en[0] } : undefined;
  const q = input.base.trim() || genreQuery?.en || genreQuery?.ar || "";
  if (!q) return null;
  return {
    q,
    ...(input.pick?.exact ? { exact: true } : {}),
    ...(input.pick?.term ? { term: input.pick.term } : {}),
    ...(genreQuery ? { genreQuery } : {}),
    ...(input.programHint ? { program: input.programHint } : {}),
    ...(input.recency !== "any" ? { timeRange: input.recency } : {}),
    ...(input.length !== "any" ? { ytLength: input.length } : {}),
  };
}

/* ---------- the answer ---------- */

const PLATFORM_SET = new Set(["tt", "ig", "yt"]);
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object";
const isStr = (x: unknown): x is string => typeof x === "string";

function parseItem(x: unknown): DiscoverItem | null {
  if (!isObj(x)) return null;
  if (!PLATFORM_SET.has(x.platform as string) || !isStr(x.url) || !isStr(x.title) || !isStr(x.handle)) return null;
  if (x.section !== "example" && x.section !== "tutorial") return null;
  return {
    platform: x.platform as DiscoverPlatform,
    handle: x.handle,
    title: x.title,
    snippet: isStr(x.snippet) ? x.snippet : "",
    url: x.url,
    lang: x.lang === "ar" ? "ar" : "en",
    section: x.section,
    ...(isStr(x.thumb) ? { thumb: x.thumb } : {}),
    ...(isObj(x.stats) ? { stats: x.stats as Stats } : {}),
    ...(isStr(x.published) ? { published: x.published } : {}),
    ...(x.offTopic === true ? { offTopic: true as const } : {}),
    ...(isStr(x.profile) ? { profile: x.profile } : {}),
  };
}

/** The Worker's answer checked field by field (a broken item is dropped, a broken answer is null). */
export function parseDiscoverAnswer(raw: unknown): DiscoverAnswer | null {
  if (!isObj(raw) || !Array.isArray(raw.items) || !isObj(raw.understood) || !isStr(raw.topicKey)) return null;
  const items = raw.items.map(parseItem).filter((i): i is DiscoverItem => !!i);
  const creators = Array.isArray(raw.creators)
    ? (raw.creators.filter((c) => isObj(c) && PLATFORM_SET.has(c.platform as string) && isStr(c.url)) as DiscoverCreator[])
    : [];
  return {
    topicKey: raw.topicKey,
    understood: raw.understood as DiscoverAnswer["understood"],
    alternatives: Array.isArray(raw.alternatives) ? (raw.alternatives as DiscoverAlternative[]) : [],
    items,
    creators,
    platforms: isObj(raw.platforms) ? (raw.platforms as DiscoverAnswer["platforms"]) : {},
    cost: isObj(raw.cost) ? (raw.cost as DiscoverAnswer["cost"]) : { tavily: 0, youtubeSearch: 0 },
    cached: raw.cached === true,
  };
}

/* ---------- cache ---------- */

export const DISCOVER_CACHE_KEY = "3z-discover-cache";
export const DISCOVER_CACHE_VERSION = 1;
export const DISCOVER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const DISCOVER_CACHE_MAX = 30;

interface Entry {
  at: number;
  answer: DiscoverAnswer;
}
const memory = new Map<string, Entry>();
const inflight = new Map<string, Promise<DiscoverResult>>();

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Where a request is cached: the version, the Worker URL and the request in a stable form. */
export function discoverRequestKey(config: ScoutConfig, req: DiscoverRequest): string {
  return `v${DISCOVER_CACHE_VERSION}|${config.url}|${JSON.stringify({
    q: req.q.trim().toLowerCase().replace(/\s+/g, " "),
    exact: !!req.exact,
    term: req.term ?? "",
    genre: [req.genreQuery?.ar ?? "", req.genreQuery?.en ?? ""],
    program: req.program ?? "",
    timeRange: req.timeRange ?? "",
    ytLength: req.ytLength ?? "",
    platforms: [...(req.platforms ?? [])].sort(),
  })}`;
}

function readStored(storage: KeyValueStorage | null): Record<string, Entry> {
  if (!storage) return {};
  try {
    const raw = JSON.parse(storage.getItem(DISCOVER_CACHE_KEY) ?? "{}") as unknown;
    return isObj(raw) ? (raw as Record<string, Entry>) : {};
  } catch {
    return {};
  }
}

const fresh = (e: Entry | undefined, now: number): e is Entry =>
  !!e && typeof e.at === "number" && now - e.at < DISCOVER_CACHE_TTL_MS && isObj(e.answer);

function cacheGet(key: string, storage: KeyValueStorage | null, now: number): DiscoverAnswer | undefined {
  const mem = memory.get(key);
  if (fresh(mem, now)) return mem.answer;
  const stored = readStored(storage)[key];
  if (fresh(stored, now)) {
    memory.set(key, stored);
    return stored.answer;
  }
  return undefined;
}

function cacheSet(key: string, answer: DiscoverAnswer, storage: KeyValueStorage | null, now: number): void {
  const entry = { at: now, answer };
  memory.set(key, entry);
  if (!storage) return;
  const kept = Object.entries({ ...readStored(storage), [key]: entry })
    .filter(([k, e]) => k.startsWith(`v${DISCOVER_CACHE_VERSION}|`) && fresh(e, now))
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, DISCOVER_CACHE_MAX);
  try {
    storage.setItem(DISCOVER_CACHE_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Storage full or blocked: memory still saves credits for this session.
  }
}

export function clearDiscoverCache(storage: KeyValueStorage | null = defaultStorage()): void {
  memory.clear();
  inflight.clear();
  try {
    storage?.removeItem(DISCOVER_CACHE_KEY);
  } catch {
    // ignore
  }
}

export function peekDiscover(config: ScoutConfig | null, req: DiscoverRequest | null): DiscoverAnswer | undefined {
  if (!config || !req) return undefined;
  return cacheGet(discoverRequestKey(config, req), defaultStorage(), Date.now());
}

export async function discoverSearch(
  config: ScoutConfig,
  req: DiscoverRequest,
  opts: ScoutSearchOpts = {},
): Promise<DiscoverResult> {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const now = opts.now ?? Date.now;
  const key = discoverRequestKey(config, req);
  if (!opts.force) {
    const hit = cacheGet(key, storage, now());
    if (hit) return { ok: true, answer: { ...hit, cached: true } };
  }
  const running = inflight.get(key);
  if (running) return running;
  const run = (async (): Promise<DiscoverResult> => {
    const r = await scoutCall(
      config,
      "/discover",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) },
      opts,
    );
    if (!r.ok) return r;
    const answer = parseDiscoverAnswer(r.data);
    if (!answer) return { ok: false, error: { type: "upstream" } };
    if (Object.values(answer.platforms).every((s) => s?.ok)) cacheSet(key, answer, storage, now());
    return { ok: true, answer };
  })();
  inflight.set(key, run);
  try {
    return await run;
  } finally {
    inflight.delete(key);
  }
}

/* ---------- views ---------- */

export interface ViewOpts {
  tab: ResearchTab;
  showHidden: boolean;
}

const onTab = (i: DiscoverItem, tab: ResearchTab) => tab === "all" || i.platform === tab;

/** Arabic posts first, each group keeping its order. */
function arabicFirstOf(list: DiscoverItem[]): DiscoverItem[] {
  return [...list.filter((i) => i.lang === "ar"), ...list.filter((i) => i.lang !== "ar")];
}

function byPopularity(list: DiscoverItem[]): DiscoverItem[] {
  return list
    .map((item, i) => ({ item, i, p: popularityOf(item.stats) }))
    .sort((a, b) => (b.p ?? -1) - (a.p ?? -1) || a.i - b.i)
    .map((x) => x.item);
}

export function sectionItems(
  answer: DiscoverAnswer,
  section: DiscoverSection,
  opts: ViewOpts & { sort: SortMode; arFirst: boolean },
): DiscoverItem[] {
  let list = answer.items.filter((i) => i.section === section && onTab(i, opts.tab) && (opts.showHidden || !i.offTopic));
  if (opts.sort === "popular") list = byPopularity(list);
  if (opts.arFirst) list = arabicFirstOf(list);
  return list;
}

/** The shown posts with the biggest numbers (views, else likes x 10), 6 by default; ties: newest first. */
export function popularItems(answer: DiscoverAnswer, opts: ViewOpts, max = 6): DiscoverItem[] {
  return answer.items
    .filter((i) => onTab(i, opts.tab) && (opts.showHidden || !i.offTopic) && popularityOf(i.stats) !== undefined)
    .sort(
      (a, b) =>
        (popularityOf(b.stats) ?? 0) - (popularityOf(a.stats) ?? 0) || (b.published ?? "").localeCompare(a.published ?? ""),
    )
    .slice(0, max);
}

export function tabCounts(answer: DiscoverAnswer, showHidden: boolean): Record<ResearchTab, number> {
  const shown = answer.items.filter((i) => showHidden || !i.offTopic);
  const n = (p: DiscoverPlatform) => shown.filter((i) => i.platform === p).length;
  return { all: shown.length, tt: n("tt"), ig: n("ig"), yt: n("yt") };
}

export function hiddenCount(answer: DiscoverAnswer, tab: ResearchTab): number {
  return answer.items.filter((i) => i.offTopic && onTab(i, tab)).length;
}

export function creatorsOn(answer: DiscoverAnswer, tab: ResearchTab): DiscoverCreator[] {
  return answer.creators.filter((c) => tab === "all" || c.platform === tab);
}

/* ---------- usage ---------- */

export interface DiscoverUsage {
  tavily: { used: number; limit: number | null; plan?: string; paygoUsed?: number; paygoLimit?: number | null } | { error: string };
  youtube: { usedToday: number; cap: number };
  connector: { usedToday: number; cap: number };
}

export async function discoverUsage(
  config: ScoutConfig,
  opts: ScoutSearchOpts = {},
): Promise<{ ok: true; usage: DiscoverUsage } | { ok: false; error: ScoutError }> {
  const r = await scoutCall(config, "/discover/usage", {}, opts);
  if (!r.ok) return r;
  const d = r.data as DiscoverUsage;
  if (!isObj(d) || !isObj(d.tavily) || !isObj(d.youtube) || !isObj(d.connector)) {
    return { ok: false, error: { type: "upstream" } };
  }
  return { ok: true, usage: d };
}
```

`popularityOf` is exported from `lib/research.ts` today (views, else likes × 10).

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm.cmd exec vitest run lib/discover.test.ts lib/scoutClient.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm.cmd typecheck` — expected: no errors.

```bash
git add lib/discover.ts lib/discover.test.ts lib/scoutClient.ts lib/scoutClient.test.ts
git commit -m "Discover v2: dashboard client, cache and section helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The sections screen

**Files:**
- Create: `messages/search.ar.json`, `messages/search.en.json`; Modify: `lib/i18n.ts` (register them)
- Create: `components/research/useDiscover.ts`
- Create: `components/research/DiscoverSections.tsx`
- Modify: `components/research/ResearchPanel.tsx`
- Modify: `components/research/ResultCard.tsx` (a TikTok card that arrives without a picture asks for one)

**Interfaces:**
- Consumes: Task 7; `scoutHealth`; `ResultCard`, `PLATFORM_META` (ResultCard.tsx); `useScoutConfig`, `settledFor`,
  `OFF`, `LOADING`, `Tagged` (useScout.ts); `useT`, `MessageKey` (lib/i18n.ts).
- Produces:
  ```ts
  // useDiscover.ts
  export function useScoutCaps(config: ScoutConfig | null): { discover: boolean } | null;
  export type DiscoverState = typeof OFF | typeof LOADING | Tagged<{ status: "ok"; answer: DiscoverAnswer }> | Tagged<{ status: "error"; error: ScoutError }>;
  export function useDiscoverQuery(req: DiscoverRequest | null, attempt: number, force?: boolean): DiscoverState;
  export function useDiscoverUsage(config: ScoutConfig | null, refresh: number): DiscoverUsage | null;
  // DiscoverSections.tsx (default export)
  props: { answer: DiscoverAnswer; q: string; tab: ResearchTab; sort: SortMode; arFirst: boolean; headingLevel: "h2" | "h3";
           renderAction: (item: ResearchItem) => ReactNode; onAlternative: (alt: DiscoverAlternative) => void; onRetry: () => void }
  ```

- [ ] **Step 1: The copy**

Create `messages/search.en.json`:

```json
{
  "search.understood": "Understood: {label}",
  "search.bothLangs": "Arabic + English",
  "search.exactNow": "Exact search for “{q}”",
  "search.notThis": "Not this?",
  "search.exactly": "Search exactly “{q}”",
  "search.popular": "🔥 Popular now",
  "search.popularSource": "By YouTube views, and TikTok / Instagram likes when they show",
  "search.examples": "🎬 Examples",
  "search.tutorials": "📘 Tutorials",
  "search.creators": "👤 Creators",
  "search.creatorCount": "{n} posts",
  "search.creatorProfile": "profile found",
  "search.showMore": "Show more ({n})",
  "search.showLess": "Show less",
  "search.hidden": "{n} hidden as off-topic",
  "search.showHidden": "show",
  "search.hideHidden": "hide",
  "search.offTopicChip": "Off-topic?",
  "search.platformDown": "{platform} didn't answer",
  "search.platformAuth": "{platform}: the Worker's key was refused",
  "search.platformNotSet": "{platform} isn't set up in the Worker",
  "search.retry": "Retry",
  "search.ytBackTomorrow": "YouTube is done for today, back tomorrow",
  "search.creditsOut": "Free lookups used up · turn on pay-as-you-go in Tavily",
  "search.creditsOutLink": "Open Tavily ↗",
  "search.usage": "{used} of {limit} free lookups this month",
  "search.usageYt": "YouTube {used}/{cap} today",
  "search.cached": "From memory, cost nothing",
  "search.searching": "Searching TikTok, Instagram and YouTube in Arabic and English…"
}
```

Create `messages/search.ar.json`:

```json
{
  "search.understood": "فهمتها: {label}",
  "search.bothLangs": "عربي + English",
  "search.exactNow": "أدوّر بالضبط على «{q}»",
  "search.notThis": "مو هذا؟",
  "search.exactly": "دوّر بالضبط على «{q}»",
  "search.popular": "🔥 الأكثر انتشار",
  "search.popularSource": "حسب المشاهدات في يوتيوب، واللايكات في تيك توك وانستقرام لما تبان",
  "search.examples": "🎬 أمثلة",
  "search.tutorials": "📘 شروحات",
  "search.creators": "👤 صناع محتوى",
  "search.creatorCount": "{n} مقطع",
  "search.creatorProfile": "لقينا حسابه",
  "search.showMore": "اعرض أكثر ({n})",
  "search.showLess": "أقل",
  "search.hidden": "{n} خبّيتها لأنها برا الموضوع",
  "search.showHidden": "اعرضها",
  "search.hideHidden": "خبّيها",
  "search.offTopicChip": "برا الموضوع؟",
  "search.platformDown": "{platform} ما رد",
  "search.platformAuth": "{platform}: مفتاح الـ Worker مرفوض",
  "search.platformNotSet": "{platform} مو مضبوط في الـ Worker",
  "search.retry": "جرّب مرة ثانية",
  "search.ytBackTomorrow": "يوتيوب خلّص حدّه اليوم، يرجع بكرة",
  "search.creditsOut": "خلصت عمليات البحث المجانية · فعّل الدفع حسب الاستخدام في Tavily",
  "search.creditsOutLink": "افتح Tavily ↗",
  "search.usage": "{used} من {limit} بحث مجاني هالشهر",
  "search.usageYt": "يوتيوب {used}/{cap} اليوم",
  "search.cached": "من الذاكرة، ما كلّف شي",
  "search.searching": "أدوّر في تيك توك وانستقرام ويوتيوب بالعربي والإنجليزي…"
}
```

In `lib/i18n.ts`: import the pair like the others (`import arSearch from "@/messages/search.ar.json";`,
`import enSearch from "@/messages/search.en.json";`) and register them in `MESSAGE_FILES` and in the merged
dictionaries exactly the way `player` is registered.

Run: `pnpm.cmd exec vitest run messages/messages.test.ts` — expected: PASS.

- [ ] **Step 2: The hooks**

Create `components/research/useDiscover.ts`:

```ts
"use client";

import { useEffect, useState } from "react";
import {
  discoverRequestKey,
  discoverSearch,
  discoverUsage,
  type DiscoverAnswer,
  type DiscoverRequest,
  type DiscoverUsage,
} from "@/lib/discover";
import { scoutHealth, type ScoutConfig, type ScoutError } from "@/lib/scoutClient";
import { LOADING, OFF, settledFor, useScoutConfig, type Tagged } from "./useScout";

/**
 * Whether the configured Worker serves Discover v2 (`/health` → `discover: true`), asked once per Worker URL and
 * session (memory + sessionStorage); null while unknown. An older Worker means false: the panel then keeps the
 * per-platform `/search` path. A failed check is not remembered (asked again next time).
 */
const capsMemory = new Map<string, boolean>();
const CAPS_KEY = "3z-scout-caps";

function readCaps(url: string): boolean | undefined {
  if (capsMemory.has(url)) return capsMemory.get(url);
  try {
    const all = JSON.parse(sessionStorage.getItem(CAPS_KEY) ?? "{}") as Record<string, unknown>;
    return typeof all[url] === "boolean" ? (all[url] as boolean) : undefined;
  } catch {
    return undefined;
  }
}

function writeCaps(url: string, discover: boolean): void {
  capsMemory.set(url, discover);
  try {
    const all = JSON.parse(sessionStorage.getItem(CAPS_KEY) ?? "{}") as Record<string, unknown>;
    sessionStorage.setItem(CAPS_KEY, JSON.stringify({ ...all, [url]: discover }));
  } catch {
    // memory only
  }
}

export function useScoutCaps(config: ScoutConfig | null): { discover: boolean } | null {
  const url = config?.url ?? "";
  const [checked, setChecked] = useState<{ url: string; discover: boolean } | null>(null);
  const known = url ? readCaps(url) : undefined;
  useEffect(() => {
    if (!config || known !== undefined) return;
    let alive = true;
    void scoutHealth(config).then((r) => {
      const discover = r.ok && r.discover;
      if (r.ok) writeCaps(config.url, discover);
      if (alive) setChecked({ url: config.url, discover });
    });
    return () => {
      alive = false;
    };
  }, [config, known]);
  if (!config) return null;
  if (known !== undefined) return { discover: known };
  return checked?.url === url ? { discover: checked.discover } : null;
}

export type DiscoverState =
  | typeof OFF
  | typeof LOADING
  | Tagged<{ status: "ok"; answer: DiscoverAnswer }>
  | Tagged<{ status: "error"; error: ScoutError }>;

type Settled = Exclude<DiscoverState, typeof OFF | typeof LOADING>;

/** One Discover v2 search (null = off). A new `attempt` asks again after an error; `force` skips the cache. */
export function useDiscoverQuery(req: DiscoverRequest | null, attempt: number, force = false): DiscoverState {
  const config = useScoutConfig();
  const key = config && req ? discoverRequestKey(config, req) : "";
  const body = req ? JSON.stringify(req) : "";
  const [settled, setSettled] = useState<Settled | null>(null);

  useEffect(() => {
    if (!config || !body) return;
    let alive = true;
    void discoverSearch(config, JSON.parse(body) as DiscoverRequest, { force }).then((r) => {
      if (!alive) return;
      setSettled(
        r.ok ? { key, attempt, status: "ok", answer: r.answer } : { key, attempt, status: "error", error: r.error },
      );
    });
    return () => {
      alive = false;
    };
  }, [config, body, key, attempt, force]);

  if (!config || !req) return OFF;
  return settled && settledFor(settled, key, attempt) ? settled : LOADING;
}

/** `GET /discover/usage`, asked again whenever `refresh` changes (after each answered search). */
export function useDiscoverUsage(config: ScoutConfig | null, refresh: number): DiscoverUsage | null {
  const [usage, setUsage] = useState<DiscoverUsage | null>(null);
  useEffect(() => {
    if (!config) return;
    let alive = true;
    void discoverUsage(config).then((r) => {
      if (alive && r.ok) setUsage(r.usage);
    });
    return () => {
      alive = false;
    };
  }, [config, refresh]);
  return config ? usage : null;
}
```

`OFF`, `LOADING`, `settledFor` and `Tagged` are exported from `useScout.ts` today.

- [ ] **Step 3: The sections component**

Check `ResultCard`'s props first (`components/research/ResultCard.tsx`, the default export): it takes `item`,
`action`, and the "Most viewed this week" strip passes `testId` and `className`. Use those names. Create
`components/research/DiscoverSections.tsx`:

```tsx
"use client";

import { useId, useState, type ReactNode } from "react";
import {
  creatorsOn,
  hiddenCount,
  popularItems,
  sectionItems,
  type DiscoverAlternative,
  type DiscoverAnswer,
  type DiscoverItem,
  type DiscoverPlatform,
  type DiscoverPlatformStatus,
  type DiscoverSection,
} from "@/lib/discover";
import { useT, type MessageKey } from "@/lib/i18n";
import type { ResearchItem, ResearchTab, SortMode } from "@/lib/research";
import ResultCard, { PLATFORM_META } from "./ResultCard";

const SHOW = 6;
const TAVILY_HOME = "https://app.tavily.com/";

const toItem = (i: DiscoverItem): ResearchItem => ({
  platform: i.platform,
  handle: i.handle,
  title: i.title,
  snippet: i.snippet,
  url: i.url,
  ...(i.thumb ? { thumb: i.thumb } : {}),
  ...(i.stats ? { stats: i.stats } : {}),
});

/**
 * Discover v2 (round 33, planning/tools/13-discover-search-v2.md): how the search was understood (and the other
 * meanings), one line per platform that failed, the Popular now strip, Examples, Tutorials and Creators (each
 * section 6 cards, then "Show more"), and the off-topic cards behind a count. The platform tab filters every part.
 */
export default function DiscoverSections({
  answer,
  q,
  tab,
  sort,
  arFirst,
  headingLevel,
  renderAction,
  onAlternative,
  onRetry,
}: {
  answer: DiscoverAnswer;
  q: string;
  tab: ResearchTab;
  sort: SortMode;
  arFirst: boolean;
  headingLevel: "h2" | "h3";
  renderAction: (item: ResearchItem) => ReactNode;
  onAlternative: (alt: DiscoverAlternative) => void;
  onRetry: () => void;
}) {
  const { t, L } = useT();
  const ids = useId();
  const [showHidden, setShowHidden] = useState(false);
  const [open, setOpen] = useState<Record<DiscoverSection, boolean>>({ example: false, tutorial: false });
  const H = headingLevel;
  const view = { tab, showHidden };
  const hidden = hiddenCount(answer, tab);
  const popular = popularItems(answer, view);
  const creators = creatorsOn(answer, tab);
  const failed = (Object.entries(answer.platforms) as [DiscoverPlatform, DiscoverPlatformStatus | undefined][]).flatMap(
    ([p, s]) => (s && !s.ok && (tab === "all" || tab === p) ? [{ p, error: s.error }] : []),
  );
  const quota = failed.some((f) => f.error === "quota");

  const card = (i: DiscoverItem, className?: string) => (
    <ResultCard
      key={i.url}
      item={toItem(i)}
      action={
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          {i.offTopic && (
            <span className="px-chip text-xs" data-testid="discover-offtopic-chip">
              {t("search.offTopicChip")}
            </span>
          )}
          {renderAction(toItem(i))}
        </span>
      }
      {...(className ? { className } : {})}
    />
  );

  const section = (s: DiscoverSection, title: MessageKey) => {
    const list = sectionItems(answer, s, { ...view, sort, arFirst });
    if (!list.length) return null;
    const shown = open[s] ? list : list.slice(0, SHOW);
    return (
      <section
        aria-labelledby={`${ids}-${s}`}
        className="flex flex-col gap-2"
        data-testid={`discover-section-${s}`}
        data-count={list.length}
      >
        <H id={`${ids}-${s}`} className="text-sm">
          {t(title)}
        </H>
        <ul className="grid grid-cols-1 gap-3 @lg:grid-cols-2 @3xl:grid-cols-3">{shown.map((i) => card(i))}</ul>
        {list.length > SHOW && (
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm w-fit"
            onClick={() => setOpen((o) => ({ ...o, [s]: !o[s] }))}
            data-testid={`discover-more-${s}`}
          >
            {open[s] ? t("search.showLess") : t("search.showMore", { n: list.length - SHOW })}
          </button>
        )}
      </section>
    );
  };

  return (
    <div className="flex flex-col gap-4" data-testid="discover-sections" data-topic={answer.topicKey}>
      <div className="flex flex-wrap items-center gap-1.5 text-xs" data-testid="discover-understood">
        <span className="text-ink-2">
          {answer.understood.exact
            ? t("search.exactNow", { q })
            : `${t("search.understood", { label: L(answer.understood.label) })} · ${t("search.bothLangs")}`}
        </span>
        {answer.alternatives.length > 0 && <span className="text-muted">{t("search.notThis")}</span>}
        {answer.alternatives.map((alt) => (
          <button
            key={"exact" in alt ? "exact" : alt.termId}
            type="button"
            className="px-fchip"
            onClick={() => onAlternative(alt)}
            data-testid={"exact" in alt ? "discover-alt-exact" : `discover-alt-${alt.termId}`}
          >
            {"exact" in alt ? t("search.exactly", { q }) : L(alt.label)}
          </button>
        ))}
        {answer.cached && (
          <span className="text-muted ms-auto" data-testid="discover-cached">
            {t("search.cached")}
          </span>
        )}
      </div>

      {quota && (
        <div
          className="px-tile border-edge flex flex-wrap items-center gap-2 rounded-[2px] border-2 p-2 text-xs"
          data-testid="discover-credits-out"
        >
          <span>{t("search.creditsOut")}</span>
          <a href={TAVILY_HOME} target="_blank" rel="noopener noreferrer" className="px-link">
            {t("search.creditsOutLink")}
          </a>
        </div>
      )}
      {failed
        .filter((f) => f.error !== "quota")
        .map(({ p, error }) => {
          const name = PLATFORM_META[p].label;
          return (
            <div
              key={p}
              className="text-muted flex flex-wrap items-center gap-2 text-xs"
              data-testid={`discover-down-${p}`}
              data-error={error}
            >
              <span>
                {error === "daily_cap"
                  ? t("search.ytBackTomorrow")
                  : error === "auth"
                    ? t("search.platformAuth", { platform: name })
                    : error === "not_configured"
                      ? t("search.platformNotSet", { platform: name })
                      : t("search.platformDown", { platform: name })}
              </span>
              {error === "upstream" && (
                <button
                  type="button"
                  className="px-btn px-btn-ghost px-btn-sm"
                  onClick={onRetry}
                  data-testid={`discover-retry-${p}`}
                >
                  {t("search.retry")}
                </button>
              )}
            </div>
          );
        })}

      {popular.length > 0 && (
        <section
          aria-labelledby={`${ids}-popular`}
          className="flex min-w-0 flex-col gap-1.5"
          data-testid="discover-popular"
          data-count={popular.length}
        >
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <H id={`${ids}-popular`} className="text-sm">
              {t("search.popular")}
            </H>
            <p className="text-muted text-xs">{t("search.popularSource")}</p>
          </div>
          <ul className="flex min-w-0 snap-x scroll-px-1 gap-3 overflow-x-auto px-1 pt-0.5 pb-2">
            {popular.map((i) => card(i, "w-60 shrink-0 snap-start"))}
          </ul>
        </section>
      )}

      {section("example", "search.examples")}
      {section("tutorial", "search.tutorials")}

      {creators.length > 0 && (
        <section
          aria-labelledby={`${ids}-creators`}
          className="flex flex-col gap-2"
          data-testid="discover-creators"
          data-count={creators.length}
        >
          <H id={`${ids}-creators`} className="text-sm">
            {t("search.creators")}
          </H>
          <ul className="flex flex-wrap gap-2">
            {creators.map((c) => (
              <li key={`${c.platform}:${c.handle}`}>
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-chip flex items-center gap-1.5"
                  dir="ltr"
                  data-testid="discover-creator"
                >
                  <span aria-hidden>{PLATFORM_META[c.platform].glyph}</span>
                  <span>{c.handle}</span>
                  <span className="text-muted text-[11px]">
                    {c.count > 0 ? t("search.creatorCount", { n: c.count }) : t("search.creatorProfile")}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {hidden > 0 && (
        <p className="text-muted flex flex-wrap items-center gap-2 text-xs" data-testid="discover-hidden" data-count={hidden}>
          <span>{t("search.hidden", { n: hidden })}</span>
          <button
            type="button"
            className="px-link"
            onClick={() => setShowHidden((v) => !v)}
            data-testid="discover-hidden-toggle"
          >
            {showHidden ? t("search.hideHidden") : t("search.showHidden")}
          </button>
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Use v2 in `ResearchPanel`**

In `components/research/ResearchPanel.tsx`:

1. Imports: `import DiscoverSections from "./DiscoverSections";`,
   `import { useDiscoverQuery, useDiscoverUsage, useScoutCaps } from "./useDiscover";`,
   `import { discoverRequestFrom, tabCounts, type DiscoverAlternative, type DiscoverPick } from "@/lib/discover";`.
2. After `const usage = useScoutUsage();` add:
   ```tsx
     const caps = useScoutCaps(scoutCfg);
     // Discover v2 when the Worker says it can; the per-platform /search path otherwise (and without a Worker).
     const v2 = !!scoutCfg && caps?.discover === true;
     const legacy = !scoutCfg || caps?.discover === false;
     const [pick, setPick] = useState<DiscoverPick>({});
     const [force, setForce] = useState(false);
   ```
3. In `commit`, after `setDraft(null);`, and as the first line of `pickGenre`, reset the pick and the force flag:
   `setPick({}); setForce(false);`.
4. Gate the old sources:
   `const ytWanted = live && legacy && hasYt && (tab === "all" || tab === "yt");` and
   `const wants = (p: Platform) => live && legacy && (tab === "all" || tab === p);`.
5. After the `scoutBy` line add:
   ```tsx
     const discoverReq =
       v2 && !savedOnly
         ? discoverRequestFrom({ base, genre, programHint: hintOn ? hint : undefined, recency, length, pick })
         : null;
     const disc = useDiscoverQuery(discoverReq, attempt, force);
     const discUsage = useDiscoverUsage(v2 ? scoutCfg : null, disc.status === "ok" ? attempt + 1 : attempt);
     const onAlternative = (alt: DiscoverAlternative) => {
       setPick("exact" in alt ? { exact: true } : { term: alt.termId });
       setForce(false);
       setAttempt((a) => a + 1);
     };
     const onRetry = () => {
       setForce(true);
       setAttempt((a) => a + 1);
     };
   ```
6. Replace the `loading` line with
   `const loading = v2 ? disc.status === "loading" || (live && caps === null) : [yt, scoutTt, scoutIg, scoutYt].some((s) => s.status === "loading");`
   and right after the `counts` `useMemo` add:
   ```tsx
     const shownCounts =
       v2 && !savedOnly
         ? disc.status === "ok"
           ? tabCounts(disc.answer, false)
           : { all: undefined, yt: undefined, tt: undefined, ig: undefined }
         : counts;
   ```
   In the tabs JSX use `const count = shownCounts[tb];`.
7. Before `const showEmpty = …` add
   `const v2Empty = v2 && !savedOnly && disc.status === "ok" && tabCounts(disc.answer, true)[tab] === 0;`
   and change `showEmpty` to
   `savedOnly ? items.length === 0 : v2 ? v2Empty : !!q && anySettled && !loading && items.length === 0`.
8. Replace the filters-row usage block (`{scoutCfg && ( <p … data-testid="scout-usage" …> )}`) with:
   ```tsx
           {scoutCfg && v2 && discUsage && "used" in discUsage.tavily && (
             <p className="text-muted ms-auto text-xs" data-testid="discover-usage">
               {t("search.usage", { used: discUsage.tavily.used, limit: discUsage.tavily.limit ?? "∞" })}
               {" · "}
               {t("search.usageYt", { used: discUsage.youtube.usedToday, cap: discUsage.youtube.cap })}
             </p>
           )}
           {scoutCfg && !v2 && (
             <p className="text-muted ms-auto text-xs" data-testid="scout-usage" data-count={usage}>
               {t("research.scoutUsage", { n: usage, max: SCOUT_MONTHLY_FREE })}
             </p>
           )}
   ```
9. In the results panel, add `!v2 &&` to the conditions of the old error lines (`scoutErrors.map`,
   `yt.status === "error"`, `ytViaScout`, `lenNote`, `popularNote`), of the `result-list` block and of `noneOn.map`;
   then, before the `showEmpty` block, add:
   ```tsx
           {v2 && !savedOnly && disc.status === "error" && <ScoutErrorLine error={disc.error} />}
           {v2 && !savedOnly && loading && (
             <div className="flex flex-col gap-2" data-testid="discover-loading">
               <p className="text-muted text-xs">{t("search.searching")}</p>
               <ul className="grid grid-cols-1 gap-3 @lg:grid-cols-2 @3xl:grid-cols-3">
                 {Array.from({ length: 3 }, (_, i) => (
                   <SkeletonCard key={i} vertical={i % 3 !== 1} />
                 ))}
               </ul>
             </div>
           )}
           {v2 && !savedOnly && disc.status === "ok" && !v2Empty && (
             <DiscoverSections
               answer={disc.answer}
               q={discoverReq?.q ?? q}
               tab={tab}
               sort={sort}
               arFirst={arFirst}
               headingLevel={skill ? "h3" : "h2"}
               renderAction={renderAction}
               onAlternative={onAlternative}
               onRetry={onRetry}
             />
           )}
           {v2 && savedOnly && items.length > 0 && (
             <ul
               className="grid grid-cols-1 gap-3 @lg:grid-cols-2 @3xl:grid-cols-3"
               aria-label={t("research.results")}
               data-testid="result-list"
             >
               {items.map((item) => (
                 <ResultCard key={item.url} item={item} action={renderAction(item)} />
               ))}
             </ul>
           )}
   ```
   `ScoutErrorLine` takes `{ error, platforms? }`: pass only `error`.

- [ ] **Step 5: A TikTok card that arrives without a picture asks for one**

In `components/research/ResultCard.tsx`, add `useEffect` to the React import and, inside `useThumb` after the
`onError` const, add:

```tsx
  // Discover v2 sends TikTok cards without oEmbed pictures (they used to cost the search 10 calls): a card that
  // shows up without one asks the Worker's cached /oembed itself, once per post per session.
  useEffect(() => {
    if (item.platform !== "tt" || item.thumb || !config) return;
    let alive = true;
    const url = item.url;
    void freshTiktokThumb(config, url).then((t) => {
      if (alive && t) setFresh({ url, thumb: t });
    });
    return () => {
      alive = false;
    };
  }, [config, item.platform, item.thumb, item.url]);
```

- [ ] **Step 6: Lint, typecheck, unit tests**

Run: `pnpm.cmd lint && pnpm.cmd typecheck && pnpm.cmd test`
Expected: no new lint errors (the existing warnings may remain), no type errors, all unit tests pass.

- [ ] **Step 7: Look at it**

Start the Worker and the dashboard locally (`pnpm.cmd worker:dev`; `pnpm.cmd dev`), point Settings → API keys at
`http://localhost:8787` with the token from `workers/scout/.dev.vars`, search "flash" in Discover and check the
understood line, the sections, the tabs and Show more at phone (375 px) and desktop widths in both languages.
Without a Tavily key in `.dev.vars` the TikTok / Instagram lines say "isn't set up in the Worker": the expected
message.

- [ ] **Step 8: Commit**

```bash
git add messages/search.ar.json messages/search.en.json lib/i18n.ts components/research
git commit -m "Discover v2: sections screen (Popular now, Examples, Tutorials, Creators)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Playwright for v2, docs, gates

**Files:**
- Create: `e2e/discover.spec.ts`
- Modify: `workers/scout/README.md`, `planning/tools/13-discover-search-v2.md`

- [ ] **Step 1: Write the end-to-end tests**

Find `ResultCard`'s root test id first (`grep -n "data-testid" components/research/ResultCard.tsx`); below it is
written as `result-card`, replace it if the component uses another id. Create `e2e/discover.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";
import { freshState } from "./helpers";

const WORKER = "https://3z-scout.example.workers.dev";
const TOKEN = "test-token";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

const item = (n: number, over: Record<string, unknown>) => ({
  platform: "tt",
  handle: "@ed",
  title: `flash transition edit ${n}`,
  snippet: "",
  url: `https://www.tiktok.com/@ed/video/${n}`,
  thumb: "https://example.com/t.jpg",
  lang: "en",
  section: "example",
  ...over,
});

const ANSWER = {
  topicKey: "flash-transition",
  understood: { termId: "flash-transition", label: { ar: "انتقال فلاش", en: "flash transition" }, exact: false },
  alternatives: [
    { termId: "camera-flash", label: { ar: "تصوير بالفلاش", en: "camera flash photography" } },
    { exact: true },
  ],
  items: [
    ...Array.from({ length: 8 }, (_, i) => item(i + 1, {})),
    item(20, {
      platform: "yt",
      url: "https://www.youtube.com/watch?v=abc",
      handle: "Cinecom",
      section: "tutorial",
      stats: { views: 90000 },
    }),
    item(21, { section: "tutorial", lang: "ar", title: "شرح تأثير فلاش" }),
    item(22, { platform: "ig", url: "https://www.instagram.com/p/OFF/", handle: "", title: "The Flash", offTopic: true }),
  ],
  creators: [{ platform: "tt", handle: "@ed", url: "https://www.tiktok.com/@ed", count: 9 }],
  platforms: { tt: { ok: true }, ig: { ok: false, error: "upstream" }, yt: { ok: true } },
  cost: { tavily: 6, youtubeSearch: 3 },
  cached: false,
};

async function stubWorker(page: Page, discover: (body: Record<string, unknown>) => unknown) {
  const asked: Record<string, unknown>[] = [];
  await page.route(`${WORKER}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const reply = (body: unknown, status = 200) =>
      route.fulfill({ status, headers: CORS, contentType: "application/json", body: JSON.stringify(body) });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (url.pathname === "/health") return reply({ ok: true, auth: true, tavily: true, discover: true });
    if (url.pathname === "/discover" && req.method() === "POST") {
      const body = JSON.parse(req.postData() ?? "{}") as Record<string, unknown>;
      asked.push(body);
      return reply(discover(body));
    }
    if (url.pathname === "/discover/usage") {
      return reply({
        tavily: { used: 412, limit: 1000 },
        youtube: { usedToday: 9, cap: 70 },
        connector: { usedToday: 0, cap: 60 },
      });
    }
    return reply({ error: "not_found" }, 404);
  });
  await page.route(/^https?:\/\/([\w-]+\.)*(tiktok|instagram|youtube|ytimg|example)\.com\//, (r) => r.abort());
  return asked;
}

async function connectWorker(page: Page) {
  await freshState(page, "/settings/");
  await page.getByTestId("apikey-scoutUrl-input").fill(WORKER);
  await page.getByTestId("apikey-scoutUrl-input").press("Enter");
  await page.getByTestId("apikey-scoutToken-input").fill(TOKEN);
  await page.getByTestId("apikey-scoutToken-test").click();
  await expect(page.getByTestId("apikey-scoutToken-status")).toHaveText("اتأكد ✓");
}

async function search(page: Page, q: string) {
  await page.goto("/discover/");
  await page.getByTestId("discover-topic").fill(q);
  await page.getByTestId("discover-topic").press("Enter");
}

test("Discover v2: one search, sections, Not this?, tabs, hidden posts, a failed platform", async ({ page }) => {
  const asked = await stubWorker(page, () => ANSWER);
  await connectWorker(page);
  await search(page, "flash");

  await expect(page.getByTestId("discover-sections")).toBeVisible();
  expect(asked).toHaveLength(1);
  expect(asked[0]).toMatchObject({ q: "flash" });
  await expect(page.getByTestId("discover-understood")).toContainText("انتقال فلاش");
  await expect(page.getByTestId("discover-popular")).toHaveAttribute("data-count", "1");
  await expect(page.getByTestId("discover-section-example")).toHaveAttribute("data-count", "8");
  await expect(page.getByTestId("discover-section-tutorial")).toHaveAttribute("data-count", "2");
  await expect(page.getByTestId("discover-creator")).toHaveCount(1);
  await expect(page.getByTestId("tab-all")).toHaveAttribute("data-count", "10");
  await expect(page.getByTestId("discover-usage")).toContainText("412");

  // Show more opens the rest of a section.
  const examples = page.getByTestId("discover-section-example");
  await expect(examples.getByTestId("result-card")).toHaveCount(6);
  await page.getByTestId("discover-more-example").click();
  await expect(examples.getByTestId("result-card")).toHaveCount(8);

  // The off-topic post is behind its count.
  await expect(page.getByTestId("discover-hidden")).toHaveAttribute("data-count", "1");
  await page.getByTestId("discover-hidden-toggle").click();
  await expect(page.getByTestId("discover-offtopic-chip")).toHaveCount(1);

  // A failed platform says so, with a retry that asks again past the cache.
  await expect(page.getByTestId("discover-down-ig")).toBeVisible();
  await page.getByTestId("discover-retry-ig").click();
  await expect.poll(() => asked.length).toBe(2);

  // The TikTok tab filters every section.
  await page.getByTestId("tab-tt").click();
  await expect(page.getByTestId("discover-popular")).toHaveCount(0);
  await expect(page.getByTestId("discover-section-tutorial")).toHaveAttribute("data-count", "1");

  // Not this? asks again with the other meaning, then exactly.
  await page.getByTestId("discover-alt-camera-flash").click();
  await expect.poll(() => asked.at(-1)).toMatchObject({ q: "flash", term: "camera-flash" });
  await page.getByTestId("discover-alt-exact").click();
  await expect.poll(() => asked.at(-1)).toMatchObject({ q: "flash", exact: true });
});

test("Discover v2: Tavily's limit shows the pay-as-you-go banner", async ({ page }) => {
  await stubWorker(page, () => ({
    ...ANSWER,
    platforms: { tt: { ok: false, error: "quota" }, ig: { ok: false, error: "quota" }, yt: { ok: true } },
  }));
  await connectWorker(page);
  await search(page, "flash");
  await expect(page.getByTestId("discover-credits-out")).toBeVisible();
});
```

- [ ] **Step 2: Run them**

Run: `E2E_PORT=3100 pnpm.cmd exec playwright test e2e/discover.spec.ts`
Expected: PASS on the phone and desktop projects. Fix the component, not the test, when behaviour differs from the
spec.

- [ ] **Step 3: Run the whole suite**

Run: `E2E_PORT=3100 pnpm.cmd e2e`
Expected: PASS. Older specs whose stub `/health` sends no `discover` keep the `/search` path. If a spec counts
every Worker request and now sees extra `/oembed` calls (Task 8 Step 5), make that count ignore `/oembed`.

- [ ] **Step 4: Docs**

In `workers/scout/README.md`, add to the Endpoints table:

```markdown
| `POST /discover`        | Discover v2 (planning/tools/13-discover-search-v2.md): body `{ q, exact?, term?, genreQuery?, program?, timeRange?, ytLength?, platforms? }` → `{ topicKey, understood, alternatives, items, creators, platforms, cost, cached }`. Plans English + Arabic queries from `planning/data/edit-terms.json`, asks Tavily (TikTok, Instagram: 3 each, 20 results, ≤ 2 retries) and YouTube `search.list` (3 a search, daily cap `DISCOVER_YT_CAP`), labels sections and off-topic cards, ranks creators; the answer is kept 6 h in KV when every platform answered. |
| `GET /discover/usage`   | `{ tavily: { used, limit, plan?, paygoUsed?, paygoLimit? } \| { error }, youtube: { usedToday, cap }, connector: { usedToday, cap } }`; Tavily's figure is kept 10 minutes. |
```

Add rows for `DISCOVER_YT_CAP` (var, default 70) and `MCP_DAILY_LOOKUPS` (var, default 60) to its Configuration
table. In `planning/tools/13-discover-search-v2.md`, under the title, add:
`**Status:** Part A (in-app search) built on branch claude/discover-search-v2; Part B (connector) next.`

- [ ] **Step 5: All gates, then commit**

Run: `pnpm.cmd lint && pnpm.cmd typecheck && pnpm.cmd test && pnpm.cmd build && E2E_PORT=3100 pnpm.cmd e2e`
Expected: all pass.

```bash
git add e2e/discover.spec.ts workers/scout/README.md planning/tools/13-discover-search-v2.md
git commit -m "Discover v2: end-to-end tests and docs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

# Part B — Claude's picks and the Claude connector (MCP)

Verified on 2026-10-03 in a throwaway spike (`wrangler deploy --dry-run`, `wrangler dev` + curl through the whole
OAuth flow): `agents` 0.26.0 (`createMcpHandler`, `getMcpAuthContext` from `"agents/mcp/server"`),
`@modelcontextprotocol/server` 2.0.0 (`McpServer`), `@modelcontextprotocol/sdk` 1.30.0 (peer of `agents`),
`@cloudflare/workers-oauth-provider` 1.2.1, `zod` 4.6.5. Bundle ≈ 255 KiB gzip. `compatibility_date` 2026-09-01
already turns `nodejs_compat` on (the Agents SDK needs `node:async_hooks`). Gotchas that shape the code below:
`apiHandler` must be an object `{ fetch }` wrapping the MCP handler; `resourceMetadata.resource` is required, so the
provider is built lazily from the `MCP_RESOURCE` var; requests with `Origin: https://claude.ai` need
`allowedOriginHostnames`; the OAuth KV binding must be named `OAUTH_KV`; `@cloudflare/workers-oauth-provider` imports
`cloudflare:workers`, so **only `src/index.ts` may import it** (never a module a Node test imports).

### Task 10: Claude's picks, and the tools as plain functions

**Files:**
- Modify: `workers/scout/src/discover/types.ts` (`DiscoverRequest.queries`), `plan.ts` (use them), `run.ts`
  (`requestHash` covers them), `routes.ts` (`GET /discover/picks`)
- Create: `workers/scout/src/discover/picks.ts`, `workers/scout/src/discover/tools.ts`
- Test: `workers/scout/src/discover/picks.test.ts`, `workers/scout/src/discover/tools.test.ts`, `plan.test.ts` (append)

**Interfaces:**
- Produces:
  ```ts
  // types.ts — DiscoverRequest gains (internal: the HTTP body parser never accepts it; only the connector sets it)
  queries?: { q: string; platform: Platform; lang: Lang; intent: Intent }[];
  // picks.ts
  export const PICKS_KEY = "discover:picks"; export const MAX_TOPICS = 50; export const MAX_PICKS = 20;
  export interface Pick { url: string; platform: Platform; title: string; handle?: string; label: Section; note?: string; savedAt: string }
  export interface PicksTopic { topicKey: string; topic: string; savedAt: string; items: Pick[] }
  export interface PickInput { url: string; title: string; handle?: string; label: Section; note?: string }
  export function topicKeyOf(topic: string): string;
  export function pickFromInput(x: PickInput, savedAt: string): Pick | null;
  export function readPicks(env: { SOCIAL_KV?: KVNamespace }, topic?: string): Promise<PicksTopic[]>;
  export function savePicks(env: { SOCIAL_KV?: KVNamespace }, topic: string, inputs: PickInput[], replace: boolean, now: Date): Promise<{ topicKey: string; saved: number; rejected: number }>;
  // tools.ts
  export type PlatformName = "tiktok" | "instagram" | "youtube";
  export interface ToolDeps { fetch: typeof fetch; now: Date }
  export interface SearchInput { topic: string; queries?: { q: string; platform: PlatformName; lang: Lang; intent: Intent }[]; platforms?: PlatformName[]; timeRange?: "week" | "month" | "year"; exact?: boolean }
  export function addConnectorLookups(env: UsageEnv, n: number, now: Date): Promise<void>;
  export function searchVideos(env: UsageEnv, deps: ToolDeps, input: SearchInput): Promise<Record<string, unknown>>;
  export function getTrends(env: UsageEnv, input: { region?: "SA" | "US"; genre?: string; limit?: number }): Promise<Record<string, unknown>>;
  export function savePicksTool(env: UsageEnv, deps: ToolDeps, input: { topic: string; items: PickInput[]; replace?: boolean }): Promise<Record<string, unknown>>;
  export function getPicksTool(env: UsageEnv, input: { topic?: string }): Promise<Record<string, unknown>>;
  ```

- [ ] **Step 1: Claude's own queries in the plan (test first)**

Append to `workers/scout/src/discover/plan.test.ts`:

```ts
describe("planSearch with Claude's own queries", () => {
  it("uses them as they are, hides nothing and keeps the topic key", () => {
    const plan = planSearch({
      q: "flash",
      queries: [
        { q: "flash transition velocity edit", platform: "tt", lang: "en", intent: "examples" },
        { q: "شرح فلاش كاب كت", platform: "ig", lang: "ar", intent: "tutorials" },
        { q: "   ", platform: "yt", lang: "en", intent: "examples" },
      ],
    });
    expect(plan.topicKey).toBe("flash-transition");
    expect(plan.topicWords).toEqual([]);
    expect(plan.alternatives).toEqual([]);
    expect(plan.queries).toEqual([
      { id: "tt-examples-en-0", platform: "tt", lang: "en", intent: "examples", q: "flash transition velocity edit" },
      { id: "ig-tutorials-ar-1", platform: "ig", lang: "ar", intent: "tutorials", q: "شرح فلاش كاب كت" },
    ]);
  });
});
```

Run: `cd workers/scout && pnpm.cmd exec vitest run src/discover/plan.test.ts` — expected: FAIL (queries ignored).

In `types.ts`, add to `DiscoverRequest` (import `Lang` is already there):

```ts
  /** Claude's own queries (the connector only; never read from an HTTP body). At most 9 are used. */
  queries?: { q: string; platform: Platform; lang: Lang; intent: Intent }[];
```

In `plan.ts`, inside `planSearch`, right after `const others = …`, add:

```ts
  if (req.queries?.length) {
    return {
      topic,
      topicKey: m.best ? m.best.id : normalizeForMatch(topic),
      ...(m.best ? { termId: m.best.id } : {}),
      exact: false,
      understood: { label: { ar: topic, en: topic }, exact: false },
      alternatives: [],
      topicWords: [],
      needsEditingWord: false,
      queries: req.queries
        .slice(0, 9)
        .map((q, i) => ({ ...q, q: q.q.trim().slice(0, MAX_QUERY), i }))
        .filter((q) => q.q && platforms.includes(q.platform))
        .map(({ q, platform, lang, intent, i }) => ({ id: `${platform}-${intent}-${lang}-${i}`, platform, lang, intent, q })),
    };
  }
```

In `run.ts` `requestHash`, add `queries: (req.queries ?? []).map((q) => [q.platform, q.lang, q.intent, q.q.trim().toLowerCase()]),`
to the canonical object. Run the plan and run tests — expected: PASS.

- [ ] **Step 2: Picks tests**

Create `workers/scout/src/discover/picks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MAX_PICKS, PICKS_KEY, pickFromInput, readPicks, savePicks, topicKeyOf } from "./picks";

const NOW = new Date("2026-10-03T09:00:00Z");
function fakeKV() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  } as unknown as KVNamespace & { store: Map<string, string> };
}

describe("pickFromInput", () => {
  it("keeps one post per pick, canonical, and refuses anything else", () => {
    expect(
      pickFromInput({ url: "https://www.instagram.com/zenko.edit/reel/ABC/?igsh=x", title: " Flash ", label: "example", note: "clean cut" }, "t"),
    ).toEqual({ url: "https://www.instagram.com/p/ABC", platform: "ig", title: "Flash", label: "example", note: "clean cut", savedAt: "t" });
    expect(pickFromInput({ url: "https://www.tiktok.com/@a", title: "x", label: "example" }, "t")).toBeNull();
    expect(pickFromInput({ url: "http://www.tiktok.com/@a/video/1", title: "x", label: "example" }, "t")).toBeNull();
    expect(pickFromInput({ url: "https://evil.example/video/1", title: "x", label: "example" }, "t")).toBeNull();
    expect(pickFromInput({ url: "https://www.youtube.com/watch?v=abc", title: " ", label: "tutorial" }, "t")).toBeNull();
  });
});

describe("savePicks / readPicks", () => {
  it("saves under the dictionary key, merges without duplicates, and reads newest first", async () => {
    const env = { SOCIAL_KV: fakeKV() };
    expect(topicKeyOf("Flash")).toBe("flash-transition");
    const one = { url: "https://www.tiktok.com/@a/video/1", title: "one", label: "example" as const };
    const two = { url: "https://www.youtube.com/watch?v=abc", title: "two", label: "tutorial" as const };
    expect(await savePicks(env, "flash", [one, { ...one, url: "nope" }], false, NOW)).toEqual({
      topicKey: "flash-transition",
      saved: 1,
      rejected: 1,
    });
    await savePicks(env, "Flash transition", [two, one], false, new Date("2026-10-03T10:00:00Z"));
    await savePicks(env, "speed ramp", [two], false, new Date("2026-10-03T11:00:00Z"));
    const all = await readPicks(env);
    expect(all.map((t) => t.topicKey)).toEqual(["speed-ramp", "flash-transition"]);
    expect(all[1].items.map((i) => i.title)).toEqual(["two", "one"]);
    expect((await readPicks(env, "flash")).map((t) => t.topicKey)).toEqual(["flash-transition"]);
    expect(JSON.parse(env.SOCIAL_KV.store.get(PICKS_KEY)!)["speed-ramp"].topic).toBe("speed ramp");
  });

  it("replaces when asked and caps the list", async () => {
    const env = { SOCIAL_KV: fakeKV() };
    const many = Array.from({ length: MAX_PICKS + 5 }, (_, i) => ({
      url: `https://www.tiktok.com/@a/video/${i + 1}`,
      title: `t${i}`,
      label: "example" as const,
    }));
    await savePicks(env, "flash", many, false, NOW);
    expect((await readPicks(env, "flash"))[0].items).toHaveLength(MAX_PICKS);
    await savePicks(env, "flash", many.slice(0, 1), true, NOW);
    expect((await readPicks(env, "flash"))[0].items).toHaveLength(1);
  });

  it("reads nothing without KV", async () => {
    expect(await readPicks({})).toEqual([]);
  });
});
```

Run: `cd workers/scout && pnpm.cmd exec vitest run src/discover/picks.test.ts` — expected: FAIL (no module).

- [ ] **Step 3: Write `picks.ts`**

```ts
/**
 * Claude's picks (round 33, planning/tools/13-discover-search-v2.md): the connector's `save_picks` writes the posts
 * Claude chose for a topic; Discover shows them as "⭐ Claude's picks". One KV document `discover:picks`
 * (`{ [topicKey]: PicksTopic }`, at most 50 topics × 20 posts, the oldest topic dropped). A pick is one post of
 * TikTok, Instagram or YouTube (https), stored in its canonical form.
 */

import { canonicalUrl, isVideoUrl, platformForHost, type Platform } from "../normalize";
import { planSearch } from "./plan";
import type { Section } from "./types";

export const PICKS_KEY = "discover:picks";
export const MAX_TOPICS = 50;
export const MAX_PICKS = 20;

export interface Pick {
  url: string;
  platform: Platform;
  title: string;
  handle?: string;
  label: Section;
  note?: string;
  savedAt: string;
}

export interface PicksTopic {
  topicKey: string;
  topic: string;
  savedAt: string;
  items: Pick[];
}

export interface PickInput {
  url: string;
  title: string;
  handle?: string;
  label: Section;
  note?: string;
}

type PicksEnv = { SOCIAL_KV?: KVNamespace };

/** The dictionary id when the topic is a known effect ("flash" and "Flash transition" meet), else its words. */
export function topicKeyOf(topic: string): string {
  return planSearch({ q: topic }).topicKey;
}

export function pickFromInput(x: PickInput, savedAt: string): Pick | null {
  let u: URL;
  try {
    u = new URL(x.url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const platform = platformForHost(u.hostname);
  if (!platform || !isVideoUrl(platform, u)) return null;
  const title = (x.title ?? "").trim().slice(0, 160);
  if (!title) return null;
  const handle = x.handle?.trim().slice(0, 80);
  const note = x.note?.trim().slice(0, 200);
  return {
    url: canonicalUrl(platform, u),
    platform,
    title,
    ...(handle ? { handle } : {}),
    label: x.label === "tutorial" ? "tutorial" : "example",
    ...(note ? { note } : {}),
    savedAt,
  };
}

async function readDoc(env: PicksEnv): Promise<Record<string, PicksTopic>> {
  if (!env.SOCIAL_KV) return {};
  const text = await env.SOCIAL_KV.get(PICKS_KEY, "text").catch(() => null);
  if (!text) return {};
  try {
    const doc = JSON.parse(text) as unknown;
    return doc && typeof doc === "object" ? (doc as Record<string, PicksTopic>) : {};
  } catch {
    return {};
  }
}

/** Every topic's picks, newest first; only the topic's own when `topic` is given. */
export async function readPicks(env: PicksEnv, topic?: string): Promise<PicksTopic[]> {
  const all = Object.values(await readDoc(env)).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  if (!topic) return all;
  const key = topicKeyOf(topic);
  return all.filter((t) => t.topicKey === key);
}

export async function savePicks(
  env: PicksEnv,
  topic: string,
  inputs: PickInput[],
  replace: boolean,
  now: Date,
): Promise<{ topicKey: string; saved: number; rejected: number }> {
  const savedAt = now.toISOString();
  const picks = inputs.map((x) => pickFromInput(x, savedAt)).filter((p): p is Pick => !!p);
  const topicKey = topicKeyOf(topic);
  if (!env.SOCIAL_KV) return { topicKey, saved: 0, rejected: inputs.length };
  const doc = await readDoc(env);
  const seen = new Set<string>();
  const items = [...picks, ...(replace ? [] : (doc[topicKey]?.items ?? []))]
    .filter((p) => (seen.has(p.url) ? false : (seen.add(p.url), true)))
    .slice(0, MAX_PICKS);
  doc[topicKey] = { topicKey, topic: topic.trim().slice(0, 100), savedAt, items };
  const kept = Object.values(doc)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
    .slice(0, MAX_TOPICS);
  await env.SOCIAL_KV.put(PICKS_KEY, JSON.stringify(Object.fromEntries(kept.map((t) => [t.topicKey, t]))));
  return { topicKey, saved: picks.length, rejected: inputs.length - picks.length };
}
```

Run the picks tests — expected: PASS.

- [ ] **Step 4: Tools tests**

Create `workers/scout/src/discover/tools.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { trendKeys } from "../trends/kv";
import { TAVILY_URL } from "../trends/tavily";
import { readPicks } from "./picks";
import { getPicksTool, getTrends, savePicksTool, searchVideos } from "./tools";
import { usageKeys } from "./usage";

const NOW = new Date("2026-10-03T09:00:00Z");
function fakeKV() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  } as unknown as KVNamespace & { store: Map<string, string> };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const tavily = () =>
  vi.fn<typeof fetch>(async (input, init) => {
    if (String(input) !== TAVILY_URL) return json({}, 404);
    const q = String((JSON.parse(String(init?.body)) as { query: string }).query);
    return json({ results: [{ url: `https://www.tiktok.com/@ed/video/${q.length}`, title: `${q} edit`, content: q }], usage: { credits: 1 } });
  });

describe("searchVideos", () => {
  it("runs Claude's own queries, counts the lookups and says how many are left", async () => {
    const env = { TAVILY_API_KEY: "k", SOCIAL_KV: fakeKV(), MCP_DAILY_LOOKUPS: "10" };
    const out = await searchVideos(env, { fetch: tavily(), now: NOW }, {
      topic: "flash",
      queries: [
        { q: "flash transition velocity", platform: "tiktok", lang: "en", intent: "examples" },
        { q: "flash cut capcut tutorial", platform: "tiktok", lang: "en", intent: "tutorials" },
      ],
    });
    expect(out.lookupsLeftToday).toBe(8);
    expect((out.items as { platform: string }[]).every((i) => i.platform === "tiktok")).toBe(true);
    expect(env.SOCIAL_KV.store.get(usageKeys.connector("2026-10-03"))).toBe("2");
  });

  it("refuses past the day's cap without searching", async () => {
    const env = { TAVILY_API_KEY: "k", SOCIAL_KV: fakeKV(), MCP_DAILY_LOOKUPS: "5" };
    await env.SOCIAL_KV.put(usageKeys.connector("2026-10-03"), "5");
    const fetchMock = tavily();
    const out = await searchVideos(env, { fetch: fetchMock, now: NOW }, { topic: "flash" });
    expect(out.error).toBe("daily_limit");
    expect(String(out.message)).toContain("midnight Riyadh");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getTrends", () => {
  it("filters the radar's feed by region and genre", async () => {
    const kv = fakeKV();
    await kv.put(
      trendKeys.latest,
      JSON.stringify({
        fetchedAt: "2026-10-03T06:00:00Z",
        degraded: false,
        sources: [],
        items: [
          { id: "a", platform: "youtube", region: "SA", lang: "ar", title: "car edit", source: "YouTube search", seenAt: "x", tags: [], genre: "cars", score: 90 },
          { id: "b", platform: "google", region: "US", lang: "en", title: "news", source: "Google Trends", seenAt: "x", tags: [] },
        ],
      }),
    );
    const out = await getTrends({ SOCIAL_KV: kv }, { region: "SA", genre: "cars" });
    expect(out.items).toEqual([
      { title: "car edit", platform: "youtube", region: "SA", source: "YouTube search", genre: "cars", score: 90 },
    ]);
  });
});

describe("save / get picks", () => {
  it("saves Claude's picks and reads them back", async () => {
    const env = { SOCIAL_KV: fakeKV() };
    const saved = await savePicksTool(env, { fetch: vi.fn(), now: NOW }, {
      topic: "flash",
      items: [{ url: "https://www.tiktok.com/@ed/video/1", title: "clean flash", label: "example", note: "watch 0:03" }],
    });
    expect(saved).toMatchObject({ saved: 1, rejected: 0, topicKey: "flash-transition" });
    expect((await readPicks(env, "flash"))[0].items[0].note).toBe("watch 0:03");
    const got = await getPicksTool(env, { topic: "flash" });
    expect((got.picks as unknown[]).length).toBe(1);
  });
});
```

Run: `cd workers/scout && pnpm.cmd exec vitest run src/discover/tools.test.ts` — expected: FAIL (no module).

- [ ] **Step 5: Write `tools.ts`**

```ts
/**
 * The Claude connector's tools as plain functions (round 33, planning/tools/13-discover-search-v2.md), so Node
 * tests run them without the MCP runtime; `mcp.ts` only registers them. Platform names are spelled out for Claude
 * ("tiktok", "instagram", "youtube"). Tavily lookups through the connector are counted per Riyadh day
 * (`discover:mcp:<day>`) against `MCP_DAILY_LOOKUPS`; a cached answer costs nothing and counts nothing.
 */

import type { Platform } from "../normalize";
import { riyadhDay } from "../social/time";
import { latestFeed } from "../trends/kv";
import { readPicks, savePicks, type PickInput } from "./picks";
import { runDiscover } from "./run";
import type { Lang } from "./terms";
import type { DiscoverRequest, Intent } from "./types";
import { connectorCap, connectorUsedToday, usageKeys, type UsageEnv } from "./usage";

export type PlatformName = "tiktok" | "instagram" | "youtube";
const CODE: Record<PlatformName, Platform> = { tiktok: "tt", instagram: "ig", youtube: "yt" };
const NAME: Record<Platform, PlatformName> = { tt: "tiktok", ig: "instagram", yt: "youtube" };

export interface ToolDeps {
  fetch: typeof fetch;
  now: Date;
}

export interface SearchInput {
  topic: string;
  queries?: { q: string; platform: PlatformName; lang: Lang; intent: Intent }[];
  platforms?: PlatformName[];
  timeRange?: "week" | "month" | "year";
  exact?: boolean;
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export async function addConnectorLookups(env: UsageEnv, n: number, now: Date): Promise<void> {
  if (!env.SOCIAL_KV || n <= 0) return;
  const used = await connectorUsedToday(env, now);
  await env.SOCIAL_KV.put(usageKeys.connector(riyadhDay(now)), String(used + n), { expirationTtl: 2 * 86_400 });
}

export async function searchVideos(env: UsageEnv, deps: ToolDeps, input: SearchInput): Promise<Record<string, unknown>> {
  const cap = connectorCap(env);
  const used = await connectorUsedToday(env, deps.now);
  if (used >= cap) {
    return { error: "daily_limit", message: `Daily limit reached (${cap} lookups). It resets at midnight Riyadh time.` };
  }
  const req: DiscoverRequest = {
    q: input.topic,
    ...(input.exact ? { exact: true } : {}),
    ...(input.timeRange ? { timeRange: input.timeRange } : {}),
    ...(input.platforms?.length ? { platforms: input.platforms.map((p) => CODE[p]) } : {}),
    ...(input.queries?.length ? { queries: input.queries.map((q) => ({ ...q, platform: CODE[q.platform] })) } : {}),
  };
  const answer = await runDiscover(env, req, { fetch: deps.fetch, now: deps.now });
  const spent = answer.cached ? 0 : answer.cost.tavily;
  await addConnectorLookups(env, spent, deps.now);
  const items = [...answer.items.filter((i) => !i.offTopic), ...answer.items.filter((i) => i.offTopic)]
    .slice(0, 40)
    .map((i) => ({
      platform: NAME[i.platform],
      url: i.url,
      title: clip(i.title, 160),
      snippet: clip(i.snippet, 160),
      handle: i.handle,
      section: i.section,
      lang: i.lang,
      ...(i.offTopic ? { offTopic: true } : {}),
      ...(i.stats?.views !== undefined ? { views: i.stats.views } : {}),
      ...(i.stats?.likes !== undefined ? { likes: i.stats.likes } : {}),
      ...(i.published ? { published: i.published } : {}),
    }));
  return {
    topicKey: answer.topicKey,
    understood: answer.understood,
    alternatives: answer.alternatives,
    items,
    creators: answer.creators.map((c) => ({ ...c, platform: NAME[c.platform] })),
    platforms: Object.fromEntries(Object.entries(answer.platforms).map(([p, s]) => [NAME[p as Platform], s])),
    cached: answer.cached,
    lookupsLeftToday: Math.max(0, cap - used - spent),
  };
}

export async function getTrends(
  env: UsageEnv,
  input: { region?: "SA" | "US"; genre?: string; limit?: number },
): Promise<Record<string, unknown>> {
  const feed = await latestFeed(env);
  const limit = Math.max(1, Math.min(input.limit ?? 20, 50));
  const items = feed.items
    .filter((r) => (!input.region || r.region === input.region) && (!input.genre || r.genre === input.genre))
    .slice(0, limit)
    .map((r) => ({
      title: r.title,
      platform: r.platform,
      region: r.region,
      ...(r.url ? { url: r.url } : {}),
      source: r.source,
      ...(r.genre ? { genre: r.genre } : {}),
      ...(r.score !== undefined ? { score: r.score } : {}),
      ...(r.volume !== undefined ? { volume: r.volume } : {}),
      ...(r.why ? { why: r.why } : {}),
    }));
  return { fetchedAt: feed.fetchedAt, items };
}

export async function savePicksTool(
  env: UsageEnv,
  deps: ToolDeps,
  input: { topic: string; items: PickInput[]; replace?: boolean },
): Promise<Record<string, unknown>> {
  const r = await savePicks(env, input.topic, input.items, !!input.replace, deps.now);
  return { ...r, where: `Discover → search "${input.topic}" (⭐ Claude's picks)` };
}

export async function getPicksTool(env: UsageEnv, input: { topic?: string }): Promise<Record<string, unknown>> {
  return { picks: await readPicks(env, input.topic) };
}
```

Run the tools tests — expected: PASS. (`getTrends`' expected row has no `url`, `volume` or `why` because the fixture
row has none.)

- [ ] **Step 6: `GET /discover/picks`**

In `routes.ts`, import `readPicks` from `./picks` and, before the final `return null;`, add:

```ts
  if (pathname === "/discover/picks" && req.method === "GET") {
    const topic = new URL(req.url).searchParams.get("topic") ?? undefined;
    return reply({ picks: await readPicks(env, topic || undefined) }, 200, cors);
  }
```

Append to `routes.test.ts`:

```ts
it("serves Claude's picks", async () => {
  const res = await handle(req("/discover/picks?topic=flash"), ENV, undefined, { fetch: vi.fn() });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ picks: [] });
});
```

Run: `cd workers/scout && pnpm.cmd exec vitest run && pnpm.cmd typecheck` — expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add workers/scout/src/discover
git commit -m "Discover v2: Claude's picks and the connector's tools as plain functions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The connector: `/mcp`, the login page, OAuth, deploy wiring

**Files:**
- Modify: `workers/scout/package.json` (+ lockfile)
- Create: `workers/scout/src/discover/auth.ts`, `workers/scout/src/discover/mcp.ts`, `workers/scout/scripts/mcp-smoke.mjs`
- Test: `workers/scout/src/discover/auth.test.ts`
- Modify: `workers/scout/src/index.ts`, `workers/scout/wrangler.jsonc`, `.github/workflows/worker.yml`,
  `workers/scout/README.md`

**Interfaces:**
- Consumes: Task 10 tools; `safeEqual` (scout.ts); `handle` (scout.ts).
- Produces:
  ```ts
  // auth.ts (Node-testable: only a type import from the OAuth package)
  export const CLAUDE_CALLBACKS: readonly string[];
  export function isAllowedRedirect(uri: string): boolean;
  export interface AuthHelpers { parseAuthRequest(req: Request): Promise<{ redirectUri: string; scope: string[] } & Record<string, unknown>>;
    completeAuthorization(o: { request: unknown; userId: string; scope: string[]; props: unknown; metadata: unknown }): Promise<{ redirectTo: string }> }
  export function authorize(req: Request, env: { SCOUT_TOKEN?: string; OAUTH_PROVIDER?: AuthHelpers }): Promise<Response>;
  // mcp.ts
  export function mcpFetch(req: Request, env: UsageEnv, ctx: ExecutionContext): Promise<Response>;
  ```

- [ ] **Step 1: Dependencies (the exact versions the spike verified)**

Run: `cd workers/scout && pnpm.cmd add agents@0.26.0 @modelcontextprotocol/server@2.0.0 @modelcontextprotocol/sdk@1.30.0 @cloudflare/workers-oauth-provider@1.2.1 zod@4.6.5`
Expected: `dependencies` in `workers/scout/package.json` lists the five; `pnpm-lock.yaml` updated.

- [ ] **Step 2: The login page (test first)**

Create `workers/scout/src/discover/auth.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { authorize, isAllowedRedirect, type AuthHelpers } from "./auth";

const URL_ = "https://3z-scout.example.workers.dev/authorize?client_id=c&redirect_uri=x&state=s";
function helpers(redirectUri = "https://claude.ai/api/mcp/auth_callback") {
  return {
    parseAuthRequest: vi.fn(async () => ({ clientId: "c", redirectUri, scope: [], state: "s" })),
    completeAuthorization: vi.fn(async () => ({ redirectTo: "https://claude.ai/api/mcp/auth_callback?code=abc&state=s" })),
  } satisfies AuthHelpers;
}
const form = (token: string) =>
  new Request(URL_, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
  });

describe("isAllowedRedirect", () => {
  it("allows Claude's callbacks only", () => {
    expect(isAllowedRedirect("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isAllowedRedirect("https://claude.com/api/mcp/auth_callback")).toBe(true);
    expect(isAllowedRedirect("https://evil.example/cb")).toBe(false);
    expect(isAllowedRedirect("http://localhost:1234/callback")).toBe(false);
  });
});

describe("authorize", () => {
  it("shows the bilingual form on GET, never framed", async () => {
    const res = await authorize(new Request(URL_), { SCOUT_TOKEN: "t0k", OAUTH_PROVIDER: helpers() });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    const html = await res.text();
    expect(html).toContain('<form method="post"');
    expect(html).toContain("Scout");
  });

  it("refuses a redirect that is not Claude's", async () => {
    const res = await authorize(new Request(URL_), { SCOUT_TOKEN: "t0k", OAUTH_PROVIDER: helpers("https://evil.example/cb") });
    expect(res.status).toBe(400);
  });

  it("refuses a wrong token and lets the right one through", async () => {
    const h = helpers();
    expect((await authorize(form("nope"), { SCOUT_TOKEN: "t0k", OAUTH_PROVIDER: h })).status).toBe(403);
    expect(h.completeAuthorization).not.toHaveBeenCalled();
    const ok = await authorize(form(" t0k "), { SCOUT_TOKEN: "t0k", OAUTH_PROVIDER: h });
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toContain("code=abc");
    expect(h.completeAuthorization).toHaveBeenCalledWith(expect.objectContaining({ userId: "owner", props: { owner: true } }));
  });

  it("refuses everything when the Worker has no token", async () => {
    expect((await authorize(form(""), { OAUTH_PROVIDER: helpers() })).status).toBe(403);
  });
});
```

Run: `cd workers/scout && pnpm.cmd exec vitest run src/discover/auth.test.ts` — expected: FAIL (no module).

Create `workers/scout/src/discover/auth.ts`:

```ts
/**
 * The connector's login (round 33, planning/tools/13-discover-search-v2.md): `/authorize` is one page, Arabic and
 * English, asking for the Scout token (dashboard → Settings → API keys, 👁 shows it). The right token completes
 * the OAuth request for "owner"; a wrong one shows the form again (403). Only Claude's callbacks are accepted as
 * redirect targets, because dynamic client registration lets anyone register a client. The OAuth helpers come from
 * `env.OAUTH_PROVIDER` (`@cloudflare/workers-oauth-provider`, injected by index.ts); this module has no runtime
 * import of that package, so Node tests run it with a fake.
 */

import { safeEqual } from "../scout";

export const CLAUDE_CALLBACKS: readonly string[] = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
];

export const isAllowedRedirect = (uri: string) => CLAUDE_CALLBACKS.includes(uri);

export interface AuthHelpers {
  parseAuthRequest(req: Request): Promise<{ redirectUri: string; scope: string[] } & Record<string, unknown>>;
  completeAuthorization(o: {
    request: unknown;
    userId: string;
    scope: string[];
    props: unknown;
    metadata: unknown;
  }): Promise<{ redirectTo: string }>;
}

type Notice = "wrong" | "redirect" | "bad" | undefined;

const NOTICE: Record<Exclude<Notice, undefined>, string> = {
  wrong: "التوكن غلط · Wrong token",
  redirect: "هذا الطلب مو من Claude · This request is not from Claude",
  bad: "الطلب ناقص · Bad request",
};

function page(notice: Notice, status = 200): Response {
  const note = notice ? `<p class="n">${NOTICE[notice]}</p>` : "";
  const form =
    notice === "redirect" || notice === "bad"
      ? ""
      : `<form method="post">
  <label for="t">توكن الـ Scout · Scout token</label>
  <input id="t" name="token" type="password" autocomplete="off" required>
  <p class="h">من لوحتك: الإعدادات ← مفاتيح API ← 👁 · From your dashboard: Settings → API keys → 👁</p>
  <button type="submit">اربط Claude · Connect Claude</button>
</form>`;
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>3z Prod · Claude</title>
<style>body{font:16px system-ui,sans-serif;background:#111;color:#eee;max-width:28rem;margin:3rem auto;padding:0 1rem}
input,button{font:inherit;width:100%;padding:.6rem;margin:.4rem 0;box-sizing:border-box}button{background:#3ddc84;border:0;font-weight:700}
.n{color:#ff8a80}.h{color:#aaa;font-size:.85rem}</style></head><body>
<h1>3z Prod ← Claude</h1><p>Claude يبغى يدوّر في Discover ويحفظ اختيارات. · Claude wants to search Discover and save picks.</p>
${note}${form}</body></html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Frame-Options": "DENY",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
    },
  });
}

export async function authorize(
  req: Request,
  env: { SCOUT_TOKEN?: string; OAUTH_PROVIDER?: AuthHelpers },
): Promise<Response> {
  const helpers = env.OAUTH_PROVIDER;
  if (!helpers) return page("bad", 500);
  let oauthReq: Awaited<ReturnType<AuthHelpers["parseAuthRequest"]>>;
  try {
    oauthReq = await helpers.parseAuthRequest(req);
  } catch {
    return page("bad", 400);
  }
  if (!isAllowedRedirect(oauthReq.redirectUri)) return page("redirect", 400);
  if (req.method === "GET") return page(undefined);
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
  const form = await req.formData().catch(() => null);
  const given = String(form?.get("token") ?? "").trim();
  if (!env.SCOUT_TOKEN || !given || !safeEqual(given, env.SCOUT_TOKEN)) return page("wrong", 403);
  const { redirectTo } = await helpers.completeAuthorization({
    request: oauthReq,
    userId: "owner",
    scope: oauthReq.scope,
    props: { owner: true },
    metadata: { label: "Claude" },
  });
  return Response.redirect(redirectTo, 302);
}
```

Run the auth tests — expected: PASS.

- [ ] **Step 3: The MCP server**

Create `workers/scout/src/discover/mcp.ts`:

```ts
/**
 * The Claude connector's MCP server (round 33, planning/tools/13-discover-search-v2.md): four tools over the
 * Discover pipeline, served stateless at `/mcp` (Agents SDK `createMcpHandler`, a new server per request, so the
 * tools see this request's env). The OAuth check runs before this (index.ts). Tool replies are JSON text; web titles
 * and snippets in them are data, clipped (tools.ts).
 */

import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { getPicksTool, getTrends, savePicksTool, searchVideos, type ToolDeps } from "./tools";
import type { UsageEnv } from "./usage";

const PLATFORM = z.enum(["tiktok", "instagram", "youtube"]);
const reply = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }] });

export function createServer(env: UsageEnv, deps: () => ToolDeps): McpServer {
  const server = new McpServer({ name: "3z-scout", version: "1.0.0" });

  server.registerTool(
    "search_videos",
    {
      description:
        "Search TikTok, Instagram and YouTube for video-editing examples and tutorials, in Arabic and English. " +
        "Give a topic (an editing effect or style, e.g. 'flash transition'); optionally your own queries (up to 9, " +
        "each with platform, lang ar|en and intent examples|tutorials). Returns posts with section, numbers when " +
        "known, creators, and lookupsLeftToday. Each new search costs about 6 lookups; repeats are free for 6 hours.",
      inputSchema: z.object({
        topic: z.string().min(1).max(200),
        queries: z
          .array(
            z.object({
              q: z.string().min(1).max(200),
              platform: PLATFORM,
              lang: z.enum(["ar", "en"]),
              intent: z.enum(["examples", "tutorials"]),
            }),
          )
          .max(9)
          .optional(),
        platforms: z.array(PLATFORM).min(1).optional(),
        timeRange: z.enum(["week", "month", "year"]).optional(),
        exact: z.boolean().optional(),
      }),
    },
    async (input) => reply(await searchVideos(env, deps(), input)),
  );

  server.registerTool(
    "get_trends",
    {
      description:
        "Read the owner's Trend Radar: what is trending now in Saudi Arabia (SA, Arabic) and the US (English) from " +
        "Google Trends, YouTube charts and searches, and the Saudi moments calendar. Optional genre id " +
        "(cars, food, anime, travel, football, coffee, perfume, camping, fashion, gaming, weddings, gym). Free.",
      inputSchema: z.object({
        region: z.enum(["SA", "US"]).optional(),
        genre: z.string().max(40).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
    },
    async (input) => reply(await getTrends(env, input)),
  );

  server.registerTool(
    "save_picks",
    {
      description:
        "Save the posts you picked for a topic into the owner's dashboard (Discover → ⭐ Claude's picks). Each item " +
        "is one TikTok / Instagram / YouTube post URL with its title, label example|tutorial and an optional short " +
        "note on why it is worth studying. replace=true replaces the topic's earlier picks. Up to 20 per topic.",
      inputSchema: z.object({
        topic: z.string().min(1).max(100),
        items: z
          .array(
            z.object({
              url: z.string().url().max(300),
              title: z.string().min(1).max(200),
              handle: z.string().max(80).optional(),
              label: z.enum(["example", "tutorial"]),
              note: z.string().max(200).optional(),
            }),
          )
          .min(1)
          .max(20),
        replace: z.boolean().optional(),
      }),
    },
    async (input) => reply(await savePicksTool(env, deps(), input)),
  );

  server.registerTool(
    "get_picks",
    {
      description: "Read the picks saved before, newest topic first; give a topic for that topic only.",
      inputSchema: z.object({ topic: z.string().max(100).optional() }),
    },
    async (input) => reply(await getPicksTool(env, input)),
  );

  return server;
}

export function mcpFetch(req: Request, env: UsageEnv, ctx: ExecutionContext): Promise<Response> {
  const handler = createMcpHandler(() => createServer(env, () => ({ fetch, now: new Date() })), {
    route: "/mcp",
    allowedOriginHostnames: ["claude.ai", "claude.com"],
  });
  return handler(req, env, ctx);
}
```

Note: `fetch` is handed over as a value and later called as `doFetch(...)` (never as a method), which workerd
requires (see `social/http.ts`).

- [ ] **Step 4: The entry point**

Replace `workers/scout/src/index.ts` with:

```ts
import { OAuthProvider, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { authorize } from "./discover/auth";
import { mcpFetch } from "./discover/mcp";
import { handle, type Env } from "./scout";
import { runTick, TICK_CRON } from "./social/cron";
import { runScheduled } from "./social/sync";

// Worker entry. Keep this module's exports to the default handler only: workerd treats every named export of
// the main module as an entrypoint and refuses to start on anything else. This is the only module that imports
// the OAuth provider (it imports `cloudflare:workers`, which plain-Node tests cannot load).
//
// Claude connector (round 33, planning/tools/13-discover-search-v2.md): OAuthProvider guards `/mcp` and serves
// `/token`, `/register` and the `.well-known` documents; `/authorize` is our login page; every other route goes to
// `handle()` exactly as before. Without OAUTH_KV or MCP_RESOURCE (local dev without them) only `handle()` runs.

type WorkerEnv = Env & { OAUTH_KV?: KVNamespace; MCP_RESOURCE?: string; OAUTH_PROVIDER?: OAuthHelpers };

let provider: OAuthProvider<WorkerEnv> | undefined;
function oauth(env: WorkerEnv): OAuthProvider<WorkerEnv> {
  provider ??= new OAuthProvider<WorkerEnv>({
    apiRoute: "/mcp",
    // Must be an object: handing createMcpHandler's function straight in throws at construction.
    apiHandler: { fetch: (req, e, ctx) => mcpFetch(req, e, ctx) },
    defaultHandler: {
      fetch: (req, e, ctx) => (new URL(req.url).pathname === "/authorize" ? authorize(req, e) : handle(req, e, ctx)),
    },
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
    resourceMetadata: { resource: env.MCP_RESOURCE ?? "" },
  });
  return provider;
}

export default {
  fetch(req, env, ctx) {
    if (!env.OAUTH_KV || !env.MCP_RESOURCE) return handle(req, env, ctx);
    return oauth(env).fetch(req, env, ctx);
  },
  // Cron (wrangler.jsonc `triggers.crons`): every five minutes the auto-post queue, and the daily social
  // sync on the 06:00–06:30 Riyadh ticks (social/cron.ts). Any other cron string (the four daily triggers
  // of older deployments) still runs the sync alone.
  async scheduled(event, env) {
    const result =
      event.cron === TICK_CRON ? await runTick(env, event.scheduledTime) : await runScheduled(env, event.cron);
    console.log(JSON.stringify({ cron: event.cron, ...result }));
  },
} satisfies ExportedHandler<WorkerEnv>;
```

If `tsc` reports that `authorize(req, e)` does not accept `OAuthHelpers` for `AuthHelpers`, pass
`{ SCOUT_TOKEN: e.SCOUT_TOKEN, OAUTH_PROVIDER: e.OAUTH_PROVIDER as unknown as AuthHelpers }` (import the type from
`./discover/auth`): the two shapes match at runtime (the spike called exactly these methods).

- [ ] **Step 5: Config and deploy wiring**

In `workers/scout/wrangler.jsonc`:
1. `kv_namespaces` becomes:
   ```jsonc
     "kv_namespaces": [
       { "binding": "SOCIAL_KV", "id": "00000000000000000000000000000000" },
       // The Claude connector's OAuth clients and tokens (@cloudflare/workers-oauth-provider needs this exact name).
       // Placeholder id like SOCIAL_KV's: the deploy workflow creates "3z-scout-OAUTH_KV" once and swaps the id in.
       { "binding": "OAUTH_KV", "id": "00000000000000000000000000000000" },
     ],
   ```
2. In `"vars"` add:
   ```jsonc
     // The connector's address as Claude sees it (OAuth protected-resource metadata must equal it).
     "MCP_RESOURCE": "https://3z-scout.3zmd95.workers.dev/mcp",
   ```

In `.github/workflows/worker.yml`, copy the whole "Ensure the SOCIAL_KV namespace" step right after it as
"Ensure the OAUTH_KV namespace", changing: `KV_TITLE: 3z-scout-OAUTH_KV`; the `hit` test to
`n.title === process.env.KV_TITLE || n.title === "OAUTH_KV"`; the create command to
`wrangler kv namespace create OAUTH_KV`; every message text from SOCIAL_KV to OAUTH_KV; and the replace regex to
`/("binding":\s*"OAUTH_KV",\s*"id":\s*")[0-9a-f]+(")/`; and the final `grep -n '"OAUTH_KV"' workers/scout/wrangler.jsonc`.

For local dev add to `workers/scout/.dev.vars` (git-ignored): `MCP_RESOURCE=http://localhost:8787/mcp`.

- [ ] **Step 6: The smoke test script**

Create `workers/scout/scripts/mcp-smoke.mjs`:

```js
// The Claude connector end to end, the way Claude's custom connector does it: register a client, log in on
// /authorize with the Scout token, swap the code for a token (PKCE S256), then MCP initialize, tools/list and a
// get_picks call. Usage (the token never goes on the command line):
//   SCOUT_TOKEN=… node workers/scout/scripts/mcp-smoke.mjs http://localhost:8787
const base = (process.argv[2] ?? "http://localhost:8787").replace(/\/$/, "");
const token = process.env.SCOUT_TOKEN;
if (!token) throw new Error("Set SCOUT_TOKEN in the environment");
const redirect = "https://claude.ai/api/mcp/auth_callback";
const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const check = (ok, what) => {
  if (!ok) throw new Error(`FAIL: ${what}`);
  console.log(`ok  ${what}`);
};

const anon = await fetch(`${base}/mcp`, { method: "POST" });
check(anon.status === 401, `unauthenticated /mcp answers 401 (${anon.status})`);

const reg = await (
  await fetch(`${base}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "3z smoke test",
      redirect_uris: [redirect],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  })
).json();
check(typeof reg.client_id === "string", "client registered");

const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
const authUrl = `${base}/authorize?${new URLSearchParams({
  response_type: "code",
  client_id: reg.client_id,
  redirect_uri: redirect,
  state: "smoke",
  code_challenge: challenge,
  code_challenge_method: "S256",
})}`;
check((await fetch(authUrl)).status === 200, "login page shows");
const wrong = await fetch(authUrl, { method: "POST", body: new URLSearchParams({ token: "wrong" }), redirect: "manual" });
check(wrong.status === 403, "wrong token refused");
const login = await fetch(authUrl, { method: "POST", body: new URLSearchParams({ token }), redirect: "manual" });
const location = login.headers.get("location") ?? "";
check(login.status === 302 && location.startsWith(redirect), "right token redirects to Claude with a code");
const code = new URL(location).searchParams.get("code");

const tok = await (
  await fetch(`${base}/token`, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirect, client_id: reg.client_id, code_verifier: verifier }),
  })
).json();
check(typeof tok.access_token === "string", "access token issued");

let id = 0;
async function rpc(method, params) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tok.access_token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  const text = await res.text();
  const data = text
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .join("");
  return { status: res.status, body: JSON.parse(data || text) };
}

const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } });
check(init.status === 200 && init.body.result, "MCP initialize");
const list = await rpc("tools/list", {});
const names = (list.body.result?.tools ?? []).map((t) => t.name).sort();
check(JSON.stringify(names) === JSON.stringify(["get_picks", "get_trends", "save_picks", "search_videos"]), `tools: ${names.join(", ")}`);
const picks = await rpc("tools/call", { name: "get_picks", arguments: {} });
check(Array.isArray(JSON.parse(picks.body.result.content[0].text).picks), "get_picks answers");
console.log("connector smoke test passed");
```

- [ ] **Step 7: Verify the build and the flow locally**

Run, in order:
1. `cd workers/scout && pnpm.cmd exec vitest run && pnpm.cmd typecheck` — expected: PASS (no test imports
   `index.ts` or `mcp.ts`).
2. `cd workers/scout && pnpm.cmd exec wrangler deploy --dry-run --outdir dist` — expected: builds; the printed
   gzip size is far under 3 MB (the spike: ~255 KiB plus the existing Worker).
3. In one terminal `pnpm.cmd worker:dev` (with `.dev.vars` holding `SCOUT_TOKEN` and `MCP_RESOURCE`); in another,
   from the repo root, with the token read from `.dev.vars` into the environment (do not paste it into chat or
   commit it):
   `SCOUT_TOKEN="$(grep '^SCOUT_TOKEN=' workers/scout/.dev.vars | cut -d= -f2)" node workers/scout/scripts/mcp-smoke.mjs http://localhost:8787`
   Expected: every line `ok`, ending `connector smoke test passed`.
4. `curl -s -H "Authorization: Bearer $(grep '^SCOUT_TOKEN=' workers/scout/.dev.vars | cut -d= -f2)" http://localhost:8787/health`
   still answers the old health body plus `discover: true` (the dashboard's routes are untouched).

- [ ] **Step 8: Docs and commit**

In `workers/scout/README.md` add a section "## Claude connector (MCP)" with: the endpoint
(`https://3z-scout.<sub>.workers.dev/mcp`), the four tools and their inputs (copy the descriptions from `mcp.ts`),
the login (Scout token on `/authorize`, Claude callbacks only), the daily cap (`MCP_DAILY_LOOKUPS`), the `OAUTH_KV`
binding and the `MCP_RESOURCE` var, the owner's steps (Claude → Customize → Connectors → Add custom connector →
paste the `/mcp` address → log in with the Scout token), and the smoke script. Add `/mcp`, `/authorize`, `/token`,
`/register` to the header comment of `scout.ts`'s route list as "served by index.ts (OAuth + MCP)".

```bash
git add workers/scout/package.json pnpm-lock.yaml workers/scout/src workers/scout/scripts workers/scout/wrangler.jsonc .github/workflows/worker.yml workers/scout/README.md
git commit -m "Claude connector: MCP tools at /mcp behind an OAuth login with the Scout token

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Claude's picks in Discover

**Files:**
- Modify: `lib/discover.ts` (+ test), `components/research/useDiscover.ts`, `components/research/DiscoverSections.tsx`,
  `components/research/ResearchPanel.tsx`, `messages/search.*.json`, `e2e/discover.spec.ts`
- Create: `components/research/PicksSection.tsx`

**Interfaces:**
- Produces:
  ```ts
  // lib/discover.ts
  export interface ClaudePick { url: string; platform: DiscoverPlatform; title: string; handle?: string; label: DiscoverSection; note?: string; savedAt: string }
  export interface PicksTopic { topicKey: string; topic: string; savedAt: string; items: ClaudePick[] }
  export function parsePicks(raw: unknown): PicksTopic[];
  export function discoverPicks(config: ScoutConfig, opts?: ScoutSearchOpts): Promise<{ ok: true; picks: PicksTopic[] } | { ok: false; error: ScoutError }>;
  export function picksFor(picks: readonly PicksTopic[], topicKey: string): PicksTopic | undefined;
  // useDiscover.ts
  export function useDiscoverPicks(config: ScoutConfig | null, refresh: number): PicksTopic[];
  // PicksSection.tsx (default export) props: { topic: PicksTopic; headingLevel: "h2" | "h3"; renderAction: (item: ResearchItem) => ReactNode; showTopic?: boolean }
  // DiscoverSections gains an optional prop: picks?: PicksTopic
  ```

- [ ] **Step 1: Client (test first)**

Append to `lib/discover.test.ts` (and add `parsePicks, picksFor` to its import):

```ts
describe("picks", () => {
  it("parses the Worker's picks and finds a topic's", () => {
    const picks = parsePicks({
      picks: [
        {
          topicKey: "flash-transition",
          topic: "flash",
          savedAt: "2026-10-03T09:00:00Z",
          items: [
            { url: "https://www.tiktok.com/@ed/video/1", platform: "tt", title: "clean flash", label: "example", note: "0:03", savedAt: "x" },
            { url: 5, platform: "tt", title: "broken", label: "example", savedAt: "x" },
          ],
        },
        { nope: true },
      ],
    });
    expect(picks).toHaveLength(1);
    expect(picks[0].items).toHaveLength(1);
    expect(picksFor(picks, "flash-transition")?.topic).toBe("flash");
    expect(picksFor(picks, "speed-ramp")).toBeUndefined();
  });
});
```

Add to `lib/discover.ts`:

```ts
/* ---------- Claude's picks ---------- */

export interface ClaudePick {
  url: string;
  platform: DiscoverPlatform;
  title: string;
  handle?: string;
  label: DiscoverSection;
  note?: string;
  savedAt: string;
}

export interface PicksTopic {
  topicKey: string;
  topic: string;
  savedAt: string;
  items: ClaudePick[];
}

function parsePick(x: unknown): ClaudePick | null {
  if (!isObj(x) || !PLATFORM_SET.has(x.platform as string) || !isStr(x.url) || !isStr(x.title)) return null;
  return {
    url: x.url,
    platform: x.platform as DiscoverPlatform,
    title: x.title,
    label: x.label === "tutorial" ? "tutorial" : "example",
    savedAt: isStr(x.savedAt) ? x.savedAt : "",
    ...(isStr(x.handle) ? { handle: x.handle } : {}),
    ...(isStr(x.note) ? { note: x.note } : {}),
  };
}

export function parsePicks(raw: unknown): PicksTopic[] {
  if (!isObj(raw) || !Array.isArray(raw.picks)) return [];
  return raw.picks.flatMap((t) => {
    if (!isObj(t) || !isStr(t.topicKey) || !isStr(t.topic) || !Array.isArray(t.items)) return [];
    const items = t.items.map(parsePick).filter((p): p is ClaudePick => !!p);
    return items.length ? [{ topicKey: t.topicKey, topic: t.topic, savedAt: isStr(t.savedAt) ? t.savedAt : "", items }] : [];
  });
}

export async function discoverPicks(
  config: ScoutConfig,
  opts: ScoutSearchOpts = {},
): Promise<{ ok: true; picks: PicksTopic[] } | { ok: false; error: ScoutError }> {
  const r = await scoutCall(config, "/discover/picks", {}, opts);
  return r.ok ? { ok: true, picks: parsePicks(r.data) } : r;
}

export function picksFor(picks: readonly PicksTopic[], topicKey: string): PicksTopic | undefined {
  return picks.find((t) => t.topicKey === topicKey);
}
```

Run: `pnpm.cmd exec vitest run lib/discover.test.ts` — expected: PASS.

- [ ] **Step 2: Hook, section, copy**

Add to `components/research/useDiscover.ts` (import `discoverPicks`, `PicksTopic`):

```ts
/** Claude's picks from the Worker, asked again whenever `refresh` changes (each search, each Discover visit). */
export function useDiscoverPicks(config: ScoutConfig | null, refresh: number): PicksTopic[] {
  const [picks, setPicks] = useState<PicksTopic[]>([]);
  useEffect(() => {
    if (!config) return;
    let alive = true;
    void discoverPicks(config).then((r) => {
      if (alive && r.ok) setPicks(r.picks);
    });
    return () => {
      alive = false;
    };
  }, [config, refresh]);
  return config ? picks : [];
}
```

Add to both message files (same keys, same placeholders):
- en: `"search.picks": "⭐ Claude's picks"`, `"search.picksLatest": "⭐ Latest from Claude"`,
  `"search.picksTopic": "for “{topic}”"`
- ar: `"search.picks": "⭐ اختيارات Claude"`, `"search.picksLatest": "⭐ آخر اختيارات Claude"`,
  `"search.picksTopic": "عن «{topic}»"`

Create `components/research/PicksSection.tsx`:

```tsx
"use client";

import { useId, type ReactNode } from "react";
import type { ClaudePick, PicksTopic } from "@/lib/discover";
import { useT } from "@/lib/i18n";
import type { ResearchItem } from "@/lib/research";
import ResultCard from "./ResultCard";

const toItem = (p: ClaudePick): ResearchItem => ({
  platform: p.platform,
  handle: p.handle ?? "",
  title: p.title,
  snippet: "",
  url: p.url,
});

/** ⭐ Claude's picks (the connector's `save_picks`): the posts and Claude's note on each, one swipeable row. */
export default function PicksSection({
  topic,
  headingLevel,
  renderAction,
  showTopic = false,
}: {
  topic: PicksTopic;
  headingLevel: "h2" | "h3";
  renderAction: (item: ResearchItem) => ReactNode;
  showTopic?: boolean;
}) {
  const { t } = useT();
  const id = useId();
  const H = headingLevel;
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-1.5" data-testid="discover-picks" data-topic={topic.topicKey}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <H id={id} className="text-sm">
          {t("search.picks")}
        </H>
        {showTopic && <p className="text-muted text-xs" dir="auto">{t("search.picksTopic", { topic: topic.topic })}</p>}
      </div>
      <ul className="flex min-w-0 snap-x scroll-px-1 gap-3 overflow-x-auto px-1 pt-0.5 pb-2">
        {topic.items.map((p) => (
          <ResultCard
            key={p.url}
            item={toItem(p)}
            className="w-60 shrink-0 snap-start"
            action={
              <span className="flex min-w-0 flex-col gap-1">
                {p.note && (
                  <span className="text-ink-2 text-xs" dir="auto" data-testid="discover-pick-note">
                    “{p.note}”
                  </span>
                )}
                {renderAction(toItem(p))}
              </span>
            }
          />
        ))}
      </ul>
    </section>
  );
}
```

In `DiscoverSections.tsx`: add the optional prop `picks?: PicksTopic` (import the type and `PicksSection`), and
render `{picks && <PicksSection topic={picks} headingLevel={headingLevel} renderAction={renderAction} />}` right after
the understood line (before the error lines).

In `ResearchPanel.tsx`:
1. Import `useDiscoverPicks` and `PicksSection`, and `picksFor` from `@/lib/discover`.
2. After `const disc = useDiscoverQuery(…)` add `const picks = useDiscoverPicks(v2 ? scoutCfg : null, attempt);`.
3. Pass `picks={picksFor(picks, disc.answer.topicKey)}` to `<DiscoverSections …>`.
4. Next to the `research-start` line (shown when nothing is typed in Discover), add:
   ```tsx
           {v2 && !skill && !q && !savedOnly && picks.length > 0 && (
             <div className="flex flex-col gap-3" data-testid="discover-picks-latest">
               <p className="text-sm font-bold">{t("search.picksLatest")}</p>
               {picks.slice(0, 3).map((topic) => (
                 <PicksSection key={topic.topicKey} topic={topic} headingLevel="h2" renderAction={renderAction} showTopic />
               ))}
             </div>
           )}
   ```

Run: `pnpm.cmd exec vitest run messages/messages.test.ts && pnpm.cmd typecheck` — expected: PASS.

- [ ] **Step 3: End-to-end**

In `e2e/discover.spec.ts`, inside `stubWorker` before the final 404, answer the picks:

```ts
    if (url.pathname === "/discover/picks") {
      return reply({
        picks: [
          {
            topicKey: "flash-transition",
            topic: "flash",
            savedAt: "2026-10-03T09:00:00Z",
            items: [{ url: "https://www.tiktok.com/@ed/video/99", platform: "tt", title: "the cleanest flash", label: "example", note: "watch 0:03", savedAt: "x" }],
          },
        ],
      });
    }
```

and add a test:

```ts
test("Discover v2: Claude's picks show on the topic and on an empty Discover", async ({ page }) => {
  await stubWorker(page, () => ANSWER);
  await connectWorker(page);
  await page.goto("/discover/");
  await expect(page.getByTestId("discover-picks-latest")).toBeVisible();
  await page.getByTestId("discover-topic").fill("flash");
  await page.getByTestId("discover-topic").press("Enter");
  await expect(page.getByTestId("discover-sections").getByTestId("discover-picks")).toHaveAttribute("data-topic", "flash-transition");
  await expect(page.getByTestId("discover-pick-note")).toContainText("watch 0:03");
});
```

Run: `E2E_PORT=3100 pnpm.cmd exec playwright test e2e/discover.spec.ts` — expected: PASS.

- [ ] **Step 4: Gates and commit**

Run: `pnpm.cmd lint && pnpm.cmd typecheck && pnpm.cmd test && pnpm.cmd build && E2E_PORT=3100 pnpm.cmd e2e`
Expected: all pass.

```bash
git add lib/discover.ts lib/discover.test.ts components/research messages e2e/discover.spec.ts
git commit -m "Discover v2: Claude's picks on the topic and on an empty Discover

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Ship and test live

- [ ] **Step 1: Gates on the whole branch**

Run from the repo root: `pnpm.cmd lint && pnpm.cmd typecheck && pnpm.cmd test && pnpm.cmd build && E2E_PORT=3100 pnpm.cmd e2e`
Expected: all pass. Record the counts (unit tests, e2e) for the PR body.

- [ ] **Step 2: Review**

Dispatch a code review of `main...claude/discover-search-v2` (correctness, security of `/authorize` and `/mcp`, the
free-plan limits, Arabic copy). Fix what is confirmed; re-run the gates.

- [ ] **Step 3: Push and open the PR (owner's OK first)**

Ask the owner before pushing. Then `git push -u origin claude/discover-search-v2` and open a PR to `main` whose body
lists: what changed (Part A, Part B), the test counts, the owner's steps (merge; optionally Tavily pay-as-you-go;
add the connector), and ends with the Claude Code attribution line. The owner merges (auto-merge is not available
to the agent).

- [ ] **Step 4: After the deploy**

1. The "Deploy Scout Worker" workflow run is green and its log shows `OAUTH_KV id: …`.
2. In the owner's dashboard (`http://localhost:3000/settings/`), Settings → API keys → Test passes; Discover shows
   the sections for "flash".
3. Golden test: in the dashboard page (browser automation, page context; the token stays in the page, never
   printed), run for the ten golden topics (flash, matchcut, speed ramp, color grading, velocity edit, mask
   transition, whip pan, تلوين سينمائي, شرح سبيد رامب, film look):
   ```js
   const s = JSON.parse(localStorage.getItem("3z-prod-v1"));
   const k = (s.state ?? s).settings.apiKeys;
   const topics = ["flash", "matchcut", "speed ramp", "color grading", "velocity edit", "mask transition", "whip pan", "تلوين سينمائي", "شرح سبيد رامب", "film look"];
   const rows = [];
   for (const q of topics) {
     const t0 = performance.now();
     const r = await fetch(k.scoutUrl + "/discover", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + k.scoutToken }, body: JSON.stringify({ q }) });
     const a = await r.json();
     const on = a.items.filter((i) => !i.offTopic);
     const has = (p) => on.some((i) => i.platform === p);
     rows.push({ q, ms: Math.round(performance.now() - t0), onTopic: on.length, total: a.items.length,
       pctOn: Math.round((100 * on.length) / Math.max(1, a.items.length)),
       sections: ["example", "tutorial"].every((s) => on.some((i) => i.section === s)) && a.creators.length > 0 && on.some((i) => i.stats),
       emptyPlatforms: ["tt", "ig", "yt"].filter((p) => a.platforms[p]?.ok && !has(p)).length, credits: a.cost.tavily, cached: a.cached });
   }
   JSON.stringify(rows);
   ```
   Then run it again: every row must say `cached: true` and take well under a second.
4. Write the before/after table into `planning/tools/13-discover-search-v2.md` (the "How we know it is better"
   section) with the measured numbers and whether each target was met. If a target is missed, say so plainly and
   list the next step (more dictionary words, a second provider).
5. Connector: the owner adds it in Claude (Customize → Connectors → Add custom connector →
   `https://3z-scout.3zmd95.workers.dev/mcp` → log in with the Scout token) and asks: "find the best flash transition
   examples and tutorials in Arabic and English and save the top 5 to Discover". Check Discover → "flash" shows ⭐
   Claude's picks with notes.
6. Commit the doc update on a follow-up branch and PR (owner merges).

