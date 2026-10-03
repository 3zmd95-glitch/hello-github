# Auto Replies v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn v1's comment-only auto replies into our own Smart Reply: comment rules with buttons and a «تابعني»
follow invite, DM and story-reply keyword answers, a default reply, a pause switch, every-minute polling with a KV
write guard, and a Beacons-style screen.

**Architecture:** The Scout Worker (Cloudflare Worker + KV, one cron trigger) keeps v1's three KV documents and adds a
DM poll (`inbox.ts`) next to the comment poll (`replies.ts`); both run in one `pollReplies` call that shares one lock,
one answer cap and one final write. Matching, message building, error mapping and sending move to `replyCore.ts`
(imported by both polls, so there is no import cycle). The dashboard (Next.js static export) mirrors the validation in
`lib/replies.ts` and gets a Beacons-style rules page and a full-page editor with a phone preview.

**Tech Stack:** TypeScript 5.9, Cloudflare Workers + KV, vitest 5 (root config runs dashboard and Worker tests),
Next.js (App Router, static export), React, Tailwind 4, zod, Playwright.

**Spec:** `planning/tools/14-auto-replies-v2.md` — read it before any task; this plan implements it.

## Global Constraints

- Official Instagram API only; never message anyone first: one private reply per comment (within 7 days), DM answers
  only inside the 24-hour window the person's own message opened.
- No follow gate: everyone gets the link; «تابعني» is only an invitation button to `https://www.instagram.com/<username>/`.
- Plain-text DMs (including the "title: link" lines) ≤ 1,000 UTF-8 bytes; button-template text ≤ 640 characters;
  at most 3 buttons including «تابعني»; button titles ≤ 20 characters; links `https:` only; ≤ 3 public replies.
- At most `REPLY_CAP` = 8 answers per poll for comments and DMs together; `REPLIES_FETCH_BUDGET` = 30 outbound calls.
- KV: `replies:doc` is written only by the dashboard routes, `replies:state` only by the poll, `replies:clicks` only
  by `/go`. An idle poll writes nothing. Write guard: ≥ 300 `replies:state` writes in a UTC day → poll only on
  five-minute ticks; ≥ 600 → answer nothing until 00:00 UTC.
- One cron trigger `* * * * *`; minutes divisible by five keep today's schedule; every sync and trend slot stays on
  the five-minute grid.
- Dashboard copy: friendly Hijazi Arabic first, English second. Every key in `messages/replies.ar.json` exists in
  `messages/replies.en.json` with the same `{placeholders}` (checked by `messages/messages.test.ts`); a key lives in
  one file only.
- Windows shell: use `pnpm.cmd` (PowerShell blocks `pnpm.ps1`). Single test file:
  `pnpm.cmd exec vitest run <path>` from the repo root.
- Quality gates before any push: `pnpm.cmd lint`, `pnpm.cmd typecheck`, `pnpm.cmd test`, `pnpm.cmd build`,
  `pnpm.cmd e2e` (set `E2E_PORT=3127` if port 3000 is taken).
- Executing agents run on Opus 5.5 (owner's instruction, round 32). Commit messages end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Code style: match the surrounding files (comment density, naming, `/* ---------- section ---------- */` dividers);
  `ponytail:` comments mark deliberate ceilings.

## File map

| File | Status | Responsibility |
| --- | --- | --- |
| `workers/scout/src/social/replyCore.ts` | Create (T1, T2) | Keyword matching; message building (buttons, text body, template, size check, random public reply); Graph error mapping; `sendReply` |
| `workers/scout/src/social/replyCore.test.ts` | Create (T1) | Unit tests of the pure builders |
| `workers/scout/src/social/replies.ts` | Modify (T1–T4) | v2 types, validation, settings, routes, `/go`, the comment poll and the `pollReplies` orchestrator |
| `workers/scout/src/social/inbox.ts` | Create (T3) | The DM poll: read conversations, decide, answer, move `seenAt` |
| `workers/scout/src/social/replies.test.ts` | Modify (T1–T4) | Route and poll tests (comments and DMs share the harness) |
| `workers/scout/src/social/cron.ts`, `src/index.ts`, `wrangler.jsonc` | Modify (T4) | Every-minute trigger |
| `workers/scout/src/trends/trends.test.ts` | Modify (T4) | The trigger string in the grid test |
| `lib/domain.ts`, `lib/replies.ts`, `lib/replies.test.ts`, `components/social/useReplies.ts` | Modify (T5) | Dashboard schemas, mirrored validation, settings call |
| `components/social/AutoRepliesScreen.tsx` | Rewrite (T6) | Beacons-style rules page |
| `components/social/replies/RulesTable.tsx`, `DefaultReplyEditor.tsx` | Create (T6) | Rules table/cards; the default reply editor |
| `components/social/replies/RuleEditor.tsx`, `PhonePreview.tsx`, `PostGrid.tsx` | Create (T7) | Full-page editor, preview, post picker |
| `components/social/replies/AutoReplyForm.tsx` | Modify (T5), delete (T7) | v1 builder, kept compiling until the new editor replaces it |
| `components/shell/nav.ts`, `components/shell/nav.test.ts` | Modify (T6) | 💬 in the Social desktop sidebar |
| `messages/replies.ar.json`, `messages/replies.en.json`, `messages/ar.json`, `messages/en.json` | Modify (T6, T7) | Copy |
| `e2e/autoreplies.spec.ts` | Modify (T6, T7) | Screen tests against the stubbed Worker |
| `planning/build-plan.md`, `planning/tools/14-auto-replies-v2.md`, `planning/tools/10-auto-replies.md` | Modify (T8) | Status and owner steps |

---

### Task 1: Worker — v2 rules, settings and routes

**Files:**
- Create: `workers/scout/src/social/replyCore.ts`
- Create: `workers/scout/src/social/replyCore.test.ts`
- Modify: `workers/scout/src/social/replies.ts`
- Modify: `workers/scout/src/social/replies.test.ts`

**Interfaces:**
- Consumes: v1 `replies.ts` (`ReplyButton`, `ReplyMatch`, `Automation`, `mergeAutomation`, `emptyStats`, `view`,
  `pollReplies`, `handleReplies`, `handleGo`, `publicDoc`, `readAll`).
- Produces (`replyCore.ts`): `DM_TEXT_BYTES = 1000`, `TEMPLATE_TEXT_MAX = 640`, `USERNAME_MAX = 30`,
  `FOLLOW_TITLE = "تابعني"`, `DEFAULT_STATS_ID = "default"`, `normalizeForMatch(text: string): string`,
  `matches(text: string, a: { keywords: readonly string[]; match: ReplyMatch }): boolean`,
  `utf8Bytes(s: string): number`, `profileUrl(username: string): string`,
  `interface LinkButton { title: string; url: string }`,
  `messageButtons(a: { id: string; buttons: readonly ReplyButton[]; followButton?: boolean }, origin: string | undefined, username: string | undefined): LinkButton[]`,
  `textBody(text: string, buttons: readonly LinkButton[]): string`,
  `messagePayload(text: string, buttons: readonly LinkButton[]): Record<string, unknown>`,
  `dmFits(a: { id: string; dmText: string; buttons: readonly ReplyButton[]; followButton?: boolean }, origin: string | undefined): boolean`,
  `pickPublicReply(replies: readonly string[], random?: () => number): string | undefined`.
- Produces (`replies.ts`): `type ReplyTrigger = "comment" | "message"`; `AutomationInput` gains
  `trigger: ReplyTrigger`, `publicReplies: string[]`, `followButton: boolean` and loses `publicReply`;
  `interface DefaultReply { enabled: boolean; text: string; enabledAt?: string; updatedAt: string }`;
  `AutomationsDoc` gains `paused?: boolean` and `defaultReply?: DefaultReply`; `type StoredDoc`;
  `PUBLIC_REPLIES_MAX = 3`; `readAutomations(raw: StoredDoc | null): AutomationsDoc`;
  `parseAutomationInput(body: unknown, origin?: string)`;
  `interface SettingsInput { paused?: boolean; defaultReply?: { enabled: boolean; text: string } }`;
  `parseSettingsInput(body: unknown): { ok: true; settings: SettingsInput } | { ok: false; detail: string }`;
  `mergeSettings(doc: AutomationsDoc, s: SettingsInput, now: Date): AutomationsDoc`; `PollDeps.random?: () => number`;
  `GET /social/replies` adds `paused: boolean`, `defaultReply` (with `stats`) and `ownerUsername`;
  new route `POST /social/replies/settings`. `matches` and `normalizeForMatch` stay importable from `./replies`.

- [ ] **Step 1: Write the failing builder tests**

Create `workers/scout/src/social/replyCore.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DM_TEXT_BYTES,
  dmFits,
  FOLLOW_TITLE,
  messageButtons,
  messagePayload,
  pickPublicReply,
  profileUrl,
  textBody,
  utf8Bytes,
} from "./replyCore";

const ORIGIN = "https://3z-scout.example.workers.dev";
const LUT = "https://3zprod.com/lut";
const rule = {
  id: "lut",
  dmText: "حمل اللت من الزر تحت",
  buttons: [{ title: "تحميل اللت", url: LUT }],
};

describe("message building", () => {
  it("routes links through /go when the origin is known, and puts «تابعني» last", () => {
    expect(messageButtons({ ...rule, followButton: true }, ORIGIN, "3z.prod")).toEqual([
      { title: "تحميل اللت", url: `${ORIGIN}/go/lut/0` },
      { title: FOLLOW_TITLE, url: "https://www.instagram.com/3z.prod/" },
    ]);
    expect(messageButtons(rule, undefined, "3z.prod")).toEqual([{ title: "تحميل اللت", url: LUT }]);
    // No username yet (before the first poll read /me): no follow button rather than a broken link.
    expect(messageButtons({ ...rule, followButton: true }, ORIGIN, undefined)).toHaveLength(1);
  });

  it("writes the plain-text form with one 'title: link' line per button", () => {
    expect(
      textBody(" هلا ", [
        { title: "أ", url: LUT },
        { title: "ب", url: ORIGIN },
      ]),
    ).toBe(`هلا\n\nأ: ${LUT}\nب: ${ORIGIN}`);
    expect(textBody("هلا", [])).toBe("هلا");
  });

  it("sends text without buttons and a button template with them", () => {
    expect(messagePayload(" هلا ", [])).toEqual({ text: "هلا" });
    expect(messagePayload("هلا", [{ title: "أ", url: LUT }])).toEqual({
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "هلا",
          buttons: [{ type: "web_url", url: LUT, title: "أ" }],
        },
      },
    });
  });

  it("counts UTF-8 bytes (an Arabic letter is two) and builds the profile link", () => {
    expect(utf8Bytes("abc")).toBe(3);
    expect(utf8Bytes("لت")).toBe(4);
    expect(profileUrl("3z.prod")).toBe("https://www.instagram.com/3z.prod/");
  });
});

describe("dmFits", () => {
  const ar = (n: number) => "ل".repeat(n);

  it("allows 1,000 bytes of plain text (500 Arabic letters) and no more", () => {
    expect(DM_TEXT_BYTES).toBe(1000);
    expect(dmFits({ id: "x", dmText: ar(500), buttons: [] }, ORIGIN)).toBe(true);
    expect(dmFits({ id: "x", dmText: ar(501), buttons: [] }, ORIGIN)).toBe(false);
  });

  it("counts the link lines and «تابعني» with the longest username, and caps a template's text at 640", () => {
    const withButton = { ...rule, dmText: "x".repeat(640) };
    expect(dmFits(withButton, ORIGIN)).toBe(true);
    expect(dmFits({ ...withButton, dmText: "x".repeat(641) }, ORIGIN)).toBe(false);
    // 470 Arabic letters (940 bytes) fit alone, but not with a link line and the follow line.
    const long = { id: "lut", dmText: ar(470), buttons: [] };
    expect(dmFits(long, ORIGIN)).toBe(true);
    expect(dmFits({ ...long, buttons: rule.buttons, followButton: true }, ORIGIN)).toBe(false);
  });
});

describe("pickPublicReply", () => {
  it("picks one of the non-blank replies with the given random source", () => {
    expect(pickPublicReply(["أ", " ", "ب"], () => 0.9)).toBe("ب");
    expect(pickPublicReply(["أ", "ب"], () => 0)).toBe("أ");
    expect(pickPublicReply([" "], () => 0)).toBeUndefined();
    expect(pickPublicReply([])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm.cmd exec vitest run workers/scout/src/social/replyCore.test.ts`
Expected: FAIL — `Failed to resolve import "./replyCore"`.

- [ ] **Step 3: Create `replyCore.ts`**

Create `workers/scout/src/social/replyCore.ts`. Move `normalizeForMatch` and `matches` here **verbatim** from
`replies.ts` (cut them there, with their doc comments), and add the builders:

```ts
/**
 * 💬 Auto replies, the parts both polls share (planning/tools/14-auto-replies-v2.md): keyword matching and how a
 * reply is built — the link buttons (through the Worker's /go counter), the optional «تابعني» button, the plain-text
 * form, the button template, Instagram's size limits and the random public reply. The comment poll (replies.ts) and
 * the DM poll (inbox.ts) import from here; the dashboard mirrors it in lib/replies.ts.
 */

import type { ReplyButton, ReplyMatch } from "./replies";

/** Instagram: a text message "must be UTF-8 and be a 1000 bytes or less" (about 500 Arabic letters). */
export const DM_TEXT_BYTES = 1000;
/** The button template's text limit, in characters. */
export const TEMPLATE_TEXT_MAX = 640;
/** Instagram usernames are at most 30 characters; the size check counts «تابعني» with the longest one. */
export const USERNAME_MAX = 30;
/** The follow invitation's button title. */
export const FOLLOW_TITLE = "تابعني";
/** The stats key and log id of the default reply (never an automation id). */
export const DEFAULT_STATS_ID = "default";

/* ---------- matching ---------- */

// ← normalizeForMatch (with its doc comment) and matches, moved verbatim from replies.ts. Give `matches` the
//   parameter type `a: { keywords: readonly string[]; match: ReplyMatch }`.

/* ---------- building a reply ---------- */

export const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

export const profileUrl = (username: string): string =>
  `https://www.instagram.com/${encodeURIComponent(username)}/`;

/** A button as Instagram gets it. */
export interface LinkButton {
  title: string;
  url: string;
}

/**
 * The reply's buttons: the owner's links (through `/go/:id/:n`, which counts the tap, when the Worker's origin is
 * known), then «تابعني» when it is switched on and the account's username is known (no username, no button).
 */
export function messageButtons(
  a: { id: string; buttons: readonly ReplyButton[]; followButton?: boolean },
  origin: string | undefined,
  username: string | undefined,
): LinkButton[] {
  const links = a.buttons.map((b, i) => ({
    title: b.title,
    url: origin ? `${origin}/go/${encodeURIComponent(a.id)}/${i}` : b.url,
  }));
  return a.followButton && username
    ? [...links, { title: FOLLOW_TITLE, url: profileUrl(username) }]
    : links;
}

/** The plain-text form: the text, then one "title: link" line per button (v1's DM, and the template fallback). */
export function textBody(text: string, buttons: readonly LinkButton[]): string {
  const lines = buttons.map((b) => `${b.title}: ${b.url}`);
  return [text.trim(), lines.join("\n")].filter(Boolean).join("\n\n");
}

/** The Send API's `message`: plain text without buttons, else a button template. */
export function messagePayload(
  text: string,
  buttons: readonly LinkButton[],
): Record<string, unknown> {
  if (!buttons.length) return { text: text.trim() };
  return {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text: text.trim(),
        buttons: buttons.map((b) => ({ type: "web_url", url: b.url, title: b.title })),
      },
    },
  };
}

/**
 * Whether a DM fits Instagram's limits in both forms it may take: the plain text with its link lines (also what a
 * refused template falls back to) within 1,000 bytes, counting «تابعني» with the longest possible username, and a
 * template's text within 640 characters.
 */
export function dmFits(
  a: { id: string; dmText: string; buttons: readonly ReplyButton[]; followButton?: boolean },
  origin: string | undefined,
): boolean {
  const buttons = messageButtons(a, origin, "x".repeat(USERNAME_MAX));
  if (utf8Bytes(textBody(a.dmText, buttons)) > DM_TEXT_BYTES) return false;
  return !buttons.length || a.dmText.trim().length <= TEMPLATE_TEXT_MAX;
}

/** One of the non-blank public replies, at random (identical replies at volume read as spam). */
export function pickPublicReply(
  replies: readonly string[],
  random: () => number = Math.random,
): string | undefined {
  const usable = replies.map((r) => r.trim()).filter(Boolean);
  return usable.length ? usable[Math.floor(random() * usable.length)] : undefined;
}
```

- [ ] **Step 4: Run the builder tests**

Run: `pnpm.cmd exec vitest run workers/scout/src/social/replyCore.test.ts`
Expected: PASS (8 tests). `replies.ts` does not compile yet if you already cut the functions; Step 7 fixes it.

- [ ] **Step 5: Update `replies.test.ts` for v2 and add the failing tests**

1. In the import list from `./replies`, remove `dmBody`; add `PUBLIC_REPLIES_MAX`.
2. Delete the whole `describe("dmBody", …)` block (the builder tests above replace it).
3. In the `input()` helper, replace `publicReply: "أرسلته لك على الخاص 🎬",` with:
   ```ts
   trigger: "comment",
   publicReplies: ["أرسلته لك على الخاص 🎬"],
   followButton: false,
   ```
4. Replace every `publicReply: ""` **inside an `input({ … })` call** with `publicReplies: []` (lines ~543–546, 618, 706,
   740, 822, 823, 857, 875, 883). Leave the log expectations (`publicReply: "sent" | "skipped" | "failed"`) alone: the
   log keeps that field.
5. In "accepts the LUT automation with the defaults filled in", the expected automation becomes:
   ```ts
   automation: {
     id: "lut",
     enabled: true,
     trigger: "comment",
     postId: null,
     keywords: ["لت"],
     match: "contains",
     publicReplies: [],
     dmText: "x",
     buttons: [],
     followButton: false,
   },
   ```
6. Add after `describe("mergeAutomation", …)`:

```ts
describe("parseAutomationInput (v2)", () => {
  const ar = (n: number) => "ل".repeat(n);
  const b = { title: "t", url: LUT };

  it("keeps the v2 fields, and a message rule keeps no post and no public replies", () => {
    const r = parseAutomationInput(
      { ...input(), trigger: "message", followButton: true, title: "x", buttons: [] },
      BASE,
    );
    expect(r).toMatchObject({
      ok: true,
      automation: { trigger: "message", postId: null, publicReplies: [], followButton: true },
    });
    expect(r.ok && r.automation).not.toHaveProperty("title");
  });

  it("reads a v1 dashboard's single publicReply as one public reply", () => {
    const v1: Record<string, unknown> = { ...input() };
    delete v1.publicReplies;
    expect(parseAutomationInput({ ...v1, publicReply: " هلا " }, BASE)).toMatchObject({
      ok: true,
      automation: { publicReplies: ["هلا"] },
    });
  });

  it("accepts 500 Arabic letters without buttons (1,000 bytes) and 640 characters with a button", () => {
    expect(parseAutomationInput({ ...input(), buttons: [], dmText: ar(500) }, BASE).ok).toBe(true);
    expect(parseAutomationInput({ ...input(), dmText: "x".repeat(640) }, BASE).ok).toBe(true);
  });

  it.each([
    [{ ...input(), trigger: "story" }, "trigger"],
    [{ ...input(), publicReplies: ["a", "b", "c", "d"] }, "publicReplies"],
    [{ ...input(), publicReplies: [7] }, "publicReplies"],
    [{ ...input(), followButton: true, buttons: [b, b, b] }, "buttons"],
    [{ ...input(), buttons: [], dmText: ar(501) }, "dmText"],
    [{ ...input(), dmText: "x".repeat(641) }, "dmText"],
    [{ ...input(), id: "settings" }, "id"],
    [{ ...input(), id: "default" }, "id"],
  ])("refuses %j → %s", (body, detail) => {
    expect(parseAutomationInput(body, BASE)).toEqual({ ok: false, detail });
  });

  it("allows three public replies and drops the blank ones", () => {
    expect(PUBLIC_REPLIES_MAX).toBe(3);
    expect(parseAutomationInput({ ...input(), publicReplies: ["أ", " ", "ب"] }, BASE)).toMatchObject({
      ok: true,
      automation: { publicReplies: ["أ", "ب"] },
    });
  });
});

describe("v1 documents", () => {
  it("read as comment rules with their one public reply and no follow button", async () => {
    const env = makeEnv();
    await Store.from(env)!.putReplies({
      v: 1,
      origin: BASE,
      automations: {
        lut: {
          id: "lut",
          enabled: true,
          postId: "m1",
          keywords: ["لت"],
          match: "contains",
          publicReply: "أرسلته لك",
          dmText: "x",
          buttons: [],
          createdAt: NOW.toISOString(),
          updatedAt: NOW.toISOString(),
          enabledAt: NOW.toISOString(),
        },
      },
    });
    const body = (await (await handle(req("/social/replies"), env)).json()) as {
      automations: Record<string, unknown>[];
      paused: boolean;
    };
    expect(body.paused).toBe(false);
    expect(body.automations[0]).toMatchObject({
      trigger: "comment",
      publicReplies: ["أرسلته لك"],
      followButton: false,
    });
    expect(body.automations[0]).not.toHaveProperty("publicReply");
  });
});

describe("/social/replies/settings", () => {
  it("saves pause and the default reply, stamping enabledAt when it is switched on", async () => {
    const env = makeEnv();
    const post = (json: unknown, at = NOW) =>
      handle(req("/social/replies/settings", { method: "POST", json }), env, undefined, {
        now: () => at,
      });
    let res = await post({ paused: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ paused: true, automations: [] });

    res = await post({ defaultReply: { enabled: true, text: " وصلت رسالتك " } });
    expect(await res.json()).toMatchObject({
      paused: true,
      defaultReply: {
        enabled: true,
        text: "وصلت رسالتك",
        enabledAt: NOW.toISOString(),
        stats: { sends: 0 },
      },
    });

    const later = new Date(NOW.getTime() + 60_000);
    await post({ defaultReply: { enabled: false, text: "وصلت رسالتك" } }, later);
    const config = await configOf(env);
    expect(config.defaultReply).toEqual({
      enabled: false,
      text: "وصلت رسالتك",
      enabledAt: NOW.toISOString(),
      updatedAt: later.toISOString(),
    });
    expect(config.paused).toBe(true);
    expect(config.origin).toBe(BASE);
  });

  it.each([
    [{ paused: "yes" }, "paused"],
    [{ defaultReply: { enabled: true, text: " " } }, "defaultReply"],
    [{ defaultReply: { enabled: true, text: "ل".repeat(501) } }, "defaultReply"],
    [{ defaultReply: { text: "x" } }, "defaultReply"],
  ])("refuses %j → %s", async (json, detail) => {
    const res = await handle(req("/social/replies/settings", { method: "POST", json }), makeEnv());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request", detail });
  });
});
```

7. Add inside `describe("pollReplies", …)`:

```ts
  it("picks one of the public replies at random", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input({ publicReplies: ["أ", "ب", "ج"] })]);
    let said = "";
    const { routes } = igRoutes({
      [`POST ${IG}/c1/replies`]: (_u, init) => {
        said = new URLSearchParams(String(init?.body)).get("message") ?? "";
        return { id: "r1" };
      },
    });
    await pollReplies(env, { fetch: mockFetch(routes), now: NOW, random: () => 0.5 });
    expect(said).toBe("ب");
  });

  it("leaves comments to comment rules: a message rule with the same word does not answer them", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input({ id: "dm", trigger: "message", postId: null, publicReplies: [] })]);
    const fetchMock = mockFetch(igRoutes().routes);
    expect((await pollReplies(env, { fetch: fetchMock, now: NOW })).sent).toEqual([]);
    expect(fetchMock.calls()).not.toContain(`POST ${IG}/17841/messages`);
  });

  it("lists the account's username once a poll has read it", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input()]);
    await pollReplies(env, { fetch: mockFetch(igRoutes().routes), now: NOW });
    const body = (await (await handle(req("/social/replies"), env)).json()) as Record<string, unknown>;
    expect(body.ownerUsername).toBe("3z.prod");
  });
```

- [ ] **Step 6: Run them to see them fail**

Run: `pnpm.cmd exec vitest run workers/scout/src/social/replies.test.ts`
Expected: FAIL (compile errors for `publicReplies`, `trigger`, `followButton`, `PUBLIC_REPLIES_MAX`, the settings
route answering 404, …).

- [ ] **Step 7: Update `replies.ts`**

1. Imports — add, and re-export the moved matchers so `./replies` imports keep working:
   ```ts
   import {
     DEFAULT_STATS_ID,
     dmFits,
     DM_TEXT_BYTES,
     matches,
     messageButtons,
     normalizeForMatch,
     pickPublicReply,
     textBody,
     utf8Bytes,
   } from "./replyCore";

   export { DEFAULT_STATS_ID, matches, normalizeForMatch } from "./replyCore";
   ```
   Delete v1's `normalizeForMatch`, `matches` and `dmBody` from this file.
2. Types — replace `AutomationInput` and `AutomationsDoc`, and add `ReplyTrigger`, `DefaultReply`, `StoredDoc`:
   ```ts
   /** What starts a rule (round 34): a comment on a post, or a DM / story reply. */
   export type ReplyTrigger = "comment" | "message";

   /** What the owner typed in the builder. */
   export interface AutomationInput {
     id: string;
     enabled: boolean;
     trigger: ReplyTrigger;
     /** Comment rules: Instagram media id; null = any of the newest posts. Always null for message rules. */
     postId: string | null;
     /** Display only (copied from the synced posts by the dashboard). */
     permalink?: string;
     title?: string;
     thumbUrl?: string;
     keywords: string[];
     match: ReplyMatch;
     /** Comment rules: up to PUBLIC_REPLIES_MAX, one picked at random; `{username}` becomes @handle. [] = none. */
     publicReplies: string[];
     dmText: string;
     buttons: ReplyButton[];
     /** Adds «تابعني» (the account's profile) after the link buttons. */
     followButton: boolean;
   }

   /** The answer to a DM that matches no rule (round 34): at most once per person per 24 hours. */
   export interface DefaultReply {
     enabled: boolean;
     text: string;
     /** ISO: when it was last switched on; messages from before are left alone. */
     enabledAt?: string;
     updatedAt: string;
   }

   /** `replies:doc`: the owner's automations and settings. */
   export interface AutomationsDoc {
     v: 1;
     /** The Worker's origin, recorded on every save (the cron has no request URL for the /go links). */
     origin?: string;
     /** Pause all: the poll answers nothing while true. */
     paused?: boolean;
     defaultReply?: DefaultReply;
     automations: Record<string, Automation>;
   }

   /** An automation as KV may hold it: documents from before round 34 lack the v2 fields and carry `publicReply`. */
   type StoredAutomation = Omit<Automation, "trigger" | "publicReplies" | "followButton"> &
     Partial<Pick<Automation, "trigger" | "publicReplies" | "followButton">> & { publicReply?: string };
   export type StoredDoc = Omit<AutomationsDoc, "automations"> & {
     automations: Record<string, StoredAutomation>;
   };
   ```
3. Limits — delete `DM_MAX` (only `parseAutomationInput` used it; `dmFits` replaces it) and add:
   ```ts
   /** Public replies per comment rule (one is picked at random each time). */
   export const PUBLIC_REPLIES_MAX = 3;
   ```
   and make `RESERVED_IDS` `new Set(["poll", "settings", DEFAULT_STATS_ID])`.
4. After `emptyStats`, add:
   ```ts
   /** The document in the v2 shape: v1 automations become comment rules with their one public reply. */
   export function readAutomations(raw: StoredDoc | null): AutomationsDoc {
     const doc: StoredDoc = raw ?? emptyAutomations();
     const automations: Record<string, Automation> = {};
     for (const [id, a] of Object.entries(doc.automations)) {
       const { publicReply, ...rest } = a;
       automations[id] = {
         ...rest,
         trigger: a.trigger ?? "comment",
         publicReplies: a.publicReplies ?? (publicReply?.trim() ? [publicReply.trim()] : []),
         followButton: a.followButton ?? false,
       };
     }
     return { ...doc, automations };
   }
   ```
5. Replace `parseAutomationInput` entirely:
   ```ts
   /**
    * The request body as an AutomationInput, or the reason it is refused (`detail` names the field). `origin` (the
    * Worker's own) sizes the /go link lines the DM carries. Message rules keep no post and no public replies.
    */
   export function parseAutomationInput(
     body: unknown,
     origin?: string,
   ): { ok: true; automation: AutomationInput } | { ok: false; detail: string } {
     const b = (body ?? {}) as Record<string, unknown>;
     const bad = (detail: string) => ({ ok: false as const, detail });
     if (typeof b.id !== "string" || !ID_RE.test(b.id) || RESERVED_IDS.has(b.id)) return bad("id");
     const trigger = b.trigger ?? "comment";
     if (trigger !== "comment" && trigger !== "message") return bad("trigger");
     if (b.postId !== null && b.postId !== undefined && typeof b.postId !== "string") {
       return bad("postId");
     }
     if (typeof b.postId === "string" && !/^[0-9A-Za-z_-]{1,64}$/.test(b.postId)) return bad("postId");
     if (!Array.isArray(b.keywords) || !b.keywords.length || b.keywords.length > KEYWORDS_MAX) {
       return bad("keywords");
     }
     const keywords: string[] = [];
     for (const k of b.keywords) {
       if (typeof k !== "string") return bad("keywords");
       const trimmed = k.trim();
       if (!trimmed || trimmed.length > KEYWORD_MAX) return bad("keywords");
       if (!normalizeForMatch(trimmed)) return bad("keywords");
       keywords.push(trimmed);
     }
     const match = b.match ?? "contains";
     if (match !== "contains" && match !== "exact") return bad("match");
     // v2 sends `publicReplies`; a v1 dashboard's single `publicReply` still works.
     const rawReplies =
       b.publicReplies ?? (typeof b.publicReply === "string" ? [b.publicReply] : []);
     if (!Array.isArray(rawReplies) || rawReplies.length > PUBLIC_REPLIES_MAX) {
       return bad("publicReplies");
     }
     const publicReplies: string[] = [];
     for (const r of rawReplies) {
       if (typeof r !== "string" || r.length > PUBLIC_MAX) return bad("publicReplies");
       if (r.trim()) publicReplies.push(r.trim());
     }
     if (typeof b.dmText !== "string" || !b.dmText.trim()) return bad("dmText");
     const followButton = b.followButton === true;
     const rawButtons = b.buttons === undefined ? [] : b.buttons;
     if (!Array.isArray(rawButtons) || rawButtons.length + (followButton ? 1 : 0) > BUTTONS_MAX) {
       return bad("buttons");
     }
     const buttons: ReplyButton[] = [];
     for (const raw of rawButtons) {
       const btn = (raw ?? {}) as Record<string, unknown>;
       const title = optString(btn.title, BUTTON_TITLE_MAX);
       if (!title) return bad("buttons.title");
       if (!isHttps(btn.url)) return bad("buttons.url");
       buttons.push({ title, url: btn.url });
     }
     const onPost = trigger === "comment";
     const permalink = onPost ? optString(b.permalink, 300) : undefined;
     const title = onPost ? optString(b.title, 120) : undefined;
     const automation: AutomationInput = {
       id: b.id,
       enabled: b.enabled !== false,
       trigger,
       postId: onPost && typeof b.postId === "string" ? b.postId : null,
       ...(permalink ? { permalink } : {}),
       ...(title ? { title } : {}),
       ...(onPost && isHttps(b.thumbUrl) ? { thumbUrl: b.thumbUrl } : {}),
       keywords,
       match,
       publicReplies: onPost ? publicReplies : [],
       dmText: b.dmText.trim(),
       buttons,
       followButton,
     };
     return dmFits(automation, origin) ? { ok: true, automation } : bad("dmText");
   }
   ```
6. After `mergeAutomation`, add the settings:
   ```ts
   /** `POST /social/replies/settings`: pause all, and the default reply. */
   export interface SettingsInput {
     paused?: boolean;
     defaultReply?: { enabled: boolean; text: string };
   }

   export function parseSettingsInput(
     body: unknown,
   ): { ok: true; settings: SettingsInput } | { ok: false; detail: string } {
     const b = (body ?? {}) as Record<string, unknown>;
     const settings: SettingsInput = {};
     if (b.paused !== undefined) {
       if (typeof b.paused !== "boolean") return { ok: false, detail: "paused" };
       settings.paused = b.paused;
     }
     if (b.defaultReply !== undefined) {
       const d = (b.defaultReply ?? {}) as Record<string, unknown>;
       const text = typeof d.text === "string" ? d.text.trim() : "";
       if (typeof d.enabled !== "boolean" || (d.enabled && !text) || utf8Bytes(text) > DM_TEXT_BYTES) {
         return { ok: false, detail: "defaultReply" };
       }
       settings.defaultReply = { enabled: d.enabled, text };
     }
     return { ok: true, settings };
   }

   /** The saved settings over the old; the default reply's `enabledAt` is stamped when it is switched on. */
   export function mergeSettings(doc: AutomationsDoc, s: SettingsInput, now: Date): AutomationsDoc {
     const at = now.toISOString();
     const next: AutomationsDoc = { ...doc };
     if (s.paused !== undefined) next.paused = s.paused;
     if (s.defaultReply) {
       const was = doc.defaultReply;
       const turnedOn = s.defaultReply.enabled && !was?.enabled;
       const enabledAt = turnedOn ? at : was?.enabledAt;
       next.defaultReply = { ...s.defaultReply, updatedAt: at, ...(enabledAt ? { enabledAt } : {}) };
     }
     return next;
   }
   ```
7. `PollDeps` — add:
   ```ts
   /** Picks the public reply (tests pass a fixed source). */
   random?: () => number;
   ```
8. In `pollReplies`:
   - `const config = readAutomations(await store.getReplies<StoredDoc>());`
   - `const enabled = Object.values(config.automations).filter((a) => a.enabled && a.trigger === "comment");`
   - after `const at = now.toISOString();` add `const random = deps.random ?? Math.random;`
   - in the answer loop, replace `if (http.budget.left < (a.publicReply ? 2 : 1)) break;` with:
     ```ts
     const pub = pickPublicReply(a.publicReplies, random);
     if (http.budget.left < (pub ? 2 : 1)) break;
     ```
   - the DM body becomes `message: { text: textBody(a.dmText, messageButtons(a, config.origin, undefined)) },`
     (Task 2 replaces this call with `sendReply`);
   - the public reply: `if (dmSent && pub && http.budget.ok) {` and
     `formPost({ message: fill(pub, username), access_token: token }),`.
9. Routes and documents:
   - `readAll`: read the automations through `readAutomations(await store.getReplies<StoredDoc>())` (keep the
     `Promise.all` for the other two documents).
   - The save: `const parsed = parseAutomationInput(body, new URL(req.url).origin);`
   - `DELETE`: `const config = readAutomations(await store.getReplies<StoredDoc>());`
   - Before the `poll` route, add:
     ```ts
     if (first === "settings" && req.method === "POST") {
       let body: unknown;
       try {
         body = await req.json();
       } catch {
         return reply.json({ error: "bad_request", detail: "json" }, 400);
       }
       const parsed = parseSettingsInput(body);
       if (!parsed.ok) return reply.json({ error: "bad_request", detail: parsed.detail }, 400);
       if (!store) return reply.fail("not_configured");
       const [config, state, clicks] = await readAll(store);
       const next = mergeSettings(config, parsed.settings, now);
       next.origin = new URL(req.url).origin;
       await store.putReplies(next);
       return reply.json(publicDoc(next, state, clicks), 200);
     }
     ```
   - `publicDoc` returns, in this order: `automations` (as before), `log`, `paused: config.paused === true`,
     `...(config.defaultReply ? { defaultReply: { ...config.defaultReply, stats: state.stats[DEFAULT_STATS_ID] ?? emptyStats() } } : {})`,
     then `origin`, `igUserId`, `...(state.ownerUsername ? { ownerUsername: state.ownerUsername } : {})`,
     `lastPollAt`, `lastError` as before.
   - `handleGo`: `const config = store ? readAutomations(await store.getReplies<StoredDoc>()) : null;`
10. Update the file's header comment: the poller answers comments (this file) and DMs (`inbox.ts`, Task 3); the
    shared parts live in `replyCore.ts`.

- [ ] **Step 8: Run the Worker tests and typecheck**

Run: `pnpm.cmd exec vitest run workers/scout/src/social/` then `pnpm.cmd typecheck`
Expected: all PASS; typecheck clean. If `grep -rn "DM_MAX\|dmBody" workers/scout/src` still finds a use, fix it
(`dmFits` / `textBody` replace them).

- [ ] **Step 9: Commit**

```bash
git add workers/scout/src/social/replyCore.ts workers/scout/src/social/replyCore.test.ts workers/scout/src/social/replies.ts workers/scout/src/social/replies.test.ts
git commit -m "Auto replies v2: rule triggers, public reply variants, follow button, settings route" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Worker — buttons in replies, the private-reply fallback, the ids of our own sends

**Files:**
- Modify: `workers/scout/src/social/replyCore.ts`
- Modify: `workers/scout/src/social/replies.ts`
- Modify: `workers/scout/src/social/replies.test.ts`

**Interfaces:**
- Consumes (Task 1): `messageButtons`, `messagePayload`, `textBody`, `pickPublicReply`, `LinkButton`.
- Produces (`replyCore.ts`, moved from `replies.ts` unchanged): `type ReplyErrorCode`, `class ReplyError`,
  `graph<T extends MetaError>(reply: JsonReply<T>, what: string): T`,
  `toReplyCode(e: unknown): { code: ReplyErrorCode; detail?: string; transient: boolean }`. New:
  `type Recipient = { id: string } | { comment_id: string }`,
  `interface SendTarget { http: Http; igUserId: string; token: string }`,
  `sendReply(t: SendTarget, recipient: Recipient, text: string, buttons: readonly LinkButton[]): Promise<string | undefined>`
  (resolves to the Send API's `message_id`).
- Produces (`replies.ts`): `interface SentMessage { to: string; at: string }`, `SENT_TTL_MS = 86_400_000`,
  `PollState.sent: Record<string, SentMessage>` (in `emptyState()`); `ReplyError`, `graph` and the
  `ReplyErrorCode` type stay importable from `./replies` (re-exported).

- [ ] **Step 1: Write the failing tests**

In `replies.test.ts`:

1. In "DMs a matching comment, then replies publicly, then leaves it alone", the DM is now a button template; replace
   the `expect(JSON.parse(String(init?.body))).toEqual({ … })` call with:
   ```ts
   expect(JSON.parse(String(init?.body))).toEqual({
     recipient: { comment_id: "c1" },
     message: {
       attachment: {
         type: "template",
         payload: {
           template_type: "button",
           text: "حمل اللت من الرابط تحت وجربه على لقطاتك",
           buttons: [{ type: "web_url", url: `${BASE}/go/lut/0`, title: "حمل اللت" }],
         },
       },
     },
   });
   ```
   and add at the end of that test, after the state checks:
   ```ts
   expect(state.sent).toEqual({ mid1: { to: "uc1", at: NOW.toISOString() } });
   ```
2. Add inside `describe("pollReplies", …)`:

```ts
  it("adds «تابعني» after the links once the account's username is known", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input({ followButton: true })]);
    let sent: unknown;
    const { routes } = igRoutes({
      [`POST ${IG}/17841/messages`]: (_u, init) => {
        sent = JSON.parse(String(init?.body));
        return { message_id: "mid1" };
      },
    });
    await pollReplies(env, { fetch: mockFetch(routes), now: NOW });
    expect(sent).toMatchObject({
      message: {
        attachment: {
          payload: {
            buttons: [
              { type: "web_url", url: `${BASE}/go/lut/0`, title: "حمل اللت" },
              { type: "web_url", url: "https://www.instagram.com/3z.prod/", title: "تابعني" },
            ],
          },
        },
      },
    });
  });

  it("sends plain text when the rule has no buttons", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input({ buttons: [] })]);
    let sent: unknown;
    const { routes } = igRoutes({
      [`POST ${IG}/17841/messages`]: (_u, init) => {
        sent = JSON.parse(String(init?.body));
        return { message_id: "mid1" };
      },
    });
    await pollReplies(env, { fetch: mockFetch(routes), now: NOW });
    expect(sent).toEqual({
      recipient: { comment_id: "c1" },
      message: { text: "حمل اللت من الرابط تحت وجربه على لقطاتك" },
    });
  });

  it("sends the links as lines when Instagram refuses buttons in a private reply", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input({ followButton: true })]);
    const bodies: unknown[] = [];
    const { routes } = igRoutes({
      [`POST ${IG}/17841/messages`]: (_u, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return bodies.length === 1
          ? json({ error: { code: 100, error_subcode: 2534015, message: "Invalid message data" } }, 400)
          : { message_id: "mid1" };
      },
    });
    const r = await pollReplies(env, { fetch: mockFetch(routes), now: NOW });
    expect(r.sent).toEqual(["c1"]);
    expect(bodies[1]).toEqual({
      recipient: { comment_id: "c1" },
      message: {
        text: `حمل اللت من الرابط تحت وجربه على لقطاتك\n\nحمل اللت: ${BASE}/go/lut/0\nتابعني: https://www.instagram.com/3z.prod/`,
      },
    });
  });

  it("does not resend as text when the comment already had its private reply", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input()]);
    const { routes } = igRoutes({
      [`POST ${IG}/17841/messages`]: () =>
        json(
          {
            error: {
              code: 100,
              error_subcode: 2534025,
              message: "The comment is invalid for a private reply",
            },
          },
          400,
        ),
    });
    const fetchMock = mockFetch(routes);
    const r = await pollReplies(env, { fetch: fetchMock, now: NOW });
    expect(r.failed).toEqual(["c1"]);
    expect(fetchMock.calls().filter((c) => c === `POST ${IG}/17841/messages`)).toHaveLength(1);
    expect((await stateOf(env)).log[0]).toMatchObject({ dm: "failed", error: "not_eligible" });
  });

  it("forgets the ids of its own sends after a day", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    const old = new Date(NOW.getTime() - 25 * 3_600_000).toISOString();
    await seed(env, [input()], { sent: { mid0: { to: "p0", at: old } } });
    await pollReplies(env, { fetch: mockFetch(igRoutes().routes), now: NOW });
    expect((await stateOf(env)).sent).toEqual({ mid1: { to: "uc1", at: NOW.toISOString() } });
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm.cmd exec vitest run workers/scout/src/social/replies.test.ts`
Expected: FAIL (the DM is still `{ text }`, no `sent` in the state, no fallback).

- [ ] **Step 3: Move the error mapping to `replyCore.ts` and add `sendReply`**

1. Cut from `replies.ts` and paste into `replyCore.ts` (unchanged, below the builders, under a
   `/* ---------- errors ---------- */` divider): `ReplyErrorCode`, `ReplyError`, `APP_PERMISSION_SUBCODES`,
   `WINDOW_SUBCODES`, `PRIVATE_REPLY_INVALID`, `graph` and `toReplyCode` with their comments. Export `toReplyCode`.
2. `replyCore.ts` imports become:
   ```ts
   import { fetchJson, type Http, type JsonReply } from "./http";
   import { IG_API } from "./instagram";
   import { metaBody, type MetaError } from "./meta";
   import type { ReplyButton, ReplyMatch } from "./replies";
   import { SocialError } from "./types";
   ```
3. Append to `replyCore.ts`:
   ```ts
   /* ---------- sending ---------- */

   /** Where a reply goes: a person (inside the 24-hour window) or, for the private reply, a comment. */
   export type Recipient = { id: string } | { comment_id: string };

   export interface SendTarget {
     http: Http;
     /** The professional account id (`user_id` from GET /me). */
     igUserId: string;
     token: string;
   }

   /**
    * Sends one reply and returns the Send API's message id. With buttons it is a button template; a private reply
    * whose template Instagram refuses (code 100 with any subcode but 2534025, "already answered") goes once more as
    * plain text with "title: link" lines — a refused call does not use up the comment's one private reply. Throws
    * like `graph`.
    */
   export async function sendReply(
     t: SendTarget,
     recipient: Recipient,
     text: string,
     buttons: readonly LinkButton[],
   ): Promise<string | undefined> {
     const post = (message: Record<string, unknown>) =>
       fetchJson<MetaError & { message_id?: string }>(t.http, `${IG_API}/${t.igUserId}/messages`, {
         method: "POST",
         headers: {
           Authorization: `Bearer ${t.token}`,
           "Content-Type": "application/json",
           Accept: "application/json",
         },
         body: JSON.stringify({ recipient, message }),
       });
     let reply = await post(messagePayload(text, buttons));
     const err = reply.body?.error;
     const templateRefused =
       buttons.length > 0 &&
       "comment_id" in recipient &&
       err?.code === 100 &&
       err.error_subcode !== PRIVATE_REPLY_INVALID.subcode;
     if (templateRefused && t.http.budget.ok) reply = await post({ text: textBody(text, buttons) });
     return graph(reply, "dm").message_id;
   }
   ```
4. In `replies.ts`, import what moved and keep it importable from here:
   ```ts
   import {
     graph,
     ReplyError,
     sendReply,
     toReplyCode,
     type ReplyErrorCode,
   } from "./replyCore";

   export { graph, ReplyError } from "./replyCore";
   export type { ReplyErrorCode } from "./replyCore";
   ```
   (merge these names into the Task 1 import from `./replyCore`; drop imports that became unused, such as
   `metaBody`, `SocialError` or `textBody`, if `pnpm.cmd lint` reports them).

- [ ] **Step 4: Send through `sendReply` and remember the message ids**

In `replies.ts`:

1. Next to `ReplyLogEntry`, add:
   ```ts
   /** A message the poll sent: to whom (Instagram-scoped id) and when. */
   export interface SentMessage {
     to: string;
     at: string;
   }
   ```
   and in `PollState`:
   ```ts
   /** Message id → the poll's own sends (pruned after SENT_TTL_MS): tells its DMs from the owner's (inbox.ts). */
   sent: Record<string, SentMessage>;
   ```
   `emptyState()` gains `sent: {}`. Add the limit `export const SENT_TTL_MS = 24 * 60 * 60_000;`.
2. Read the state so documents written before this round get the new fields:
   ```ts
   const state: PollState = { ...emptyState(), ...(await store.getRepliesState<PollState>()) };
   ```
3. In the answer loop, replace the budget line from Task 1 and the whole `try { graph(await fetchJson(… /messages …)) … }`
   DM block with:
   ```ts
   const buttons = messageButtons(a, config.origin, state.ownerUsername);
   const pub = pickPublicReply(a.publicReplies, random);
   // The DM, its text fallback when Instagram refuses buttons, and the public reply.
   if (http.budget.left < 1 + (buttons.length ? 1 : 0) + (pub ? 1 : 0)) break;
   ```
   (keep `const id = c.id!; attempted.add(id);` and the log `entry` after this check) and, for the DM:
   ```ts
   let dmSent = false;
   try {
     const messageId = await sendReply({ http, igUserId, token }, { comment_id: id }, a.dmText, buttons);
     dmSent = true;
     entry.dm = "sent";
     s.sends += 1;
     s.lastSentAt = at;
     s.lastError = undefined;
     state.handled[id] = at;
     delete state.retries[id];
     if (messageId) state.sent[messageId] = { to: c.from?.id ?? "", at };
     result.sent.push(id);
   } catch (e) {
     // ← the v1 catch block, unchanged
   }
   ```
4. In the pruning at the end of `pollReplies`, after the `handled` loop:
   ```ts
   for (const [mid, s] of Object.entries(state.sent)) {
     if (now.getTime() - Date.parse(s.at) > SENT_TTL_MS) {
       delete state.sent[mid];
       changed = true;
     }
   }
   ```

- [ ] **Step 5: Run the tests and typecheck**

Run: `pnpm.cmd exec vitest run workers/scout/src/social/` then `pnpm.cmd typecheck` and `pnpm.cmd lint`
Expected: all PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add workers/scout/src/social/replyCore.ts workers/scout/src/social/replies.ts workers/scout/src/social/replies.test.ts
git commit -m "Auto replies v2: button template DMs with a text fallback, ids of our own sends" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Worker — DMs and story replies (`inbox.ts`) inside `pollReplies`

**Files:**
- Create: `workers/scout/src/social/inbox.ts`
- Modify: `workers/scout/src/social/replyCore.ts`
- Modify: `workers/scout/src/social/replies.ts`
- Modify: `workers/scout/src/social/replies.test.ts`

**Interfaces:**
- Consumes (Tasks 1–2): `matches`, `normalizeForMatch`, `messageButtons`, `sendReply`, `graph`, `toReplyCode`,
  `DEFAULT_STATS_ID`, `ReplyErrorCode` (replyCore); `AutomationsDoc`, `Automation`, `PollState`, `ReplyStats`,
  `ReplyLogEntry`, `SentMessage` (replies, types only).
- Produces (`replyCore.ts`, moved from `replies.ts`): `MAX_RETRIES = 3`,
  `TICK_STOPPERS: ReadonlySet<ReplyErrorCode>`, `LOG_TEXT_CLIP = 120` (v1's private `TEXT_CLIP`).
- Produces (`inbox.ts`): `CONVERSATIONS_PAGE = 20`, `MESSAGES_PER_CONVERSATION = 5`, `WINDOW_MS`,
  `OWN_SEND_SLACK_MS`, `CONVO_TTL_MS`, `toMs(v)`, `isOwnSend(state, id, ms, personId)`, `interface InboxItem`,
  `interface ConversationBatch`, `interface InboxDeps`, `interface InboxOutcome`, `inboxActive(config): boolean`,
  `pickMessageRule(config, text, ms)`, `readInbox(d): Promise<{ batches: ConversationBatch[]; changed: boolean }>`,
  `answerInbox(d, batches, capLeft): Promise<InboxOutcome>`.
- Produces (`replies.ts`): `type ReplyKind = "comment" | "message" | "story" | "default"`; `ReplyLogEntry` gains
  `kind: ReplyKind` and `messageId?: string`, and `postId` / `commentId` become optional; `PollState` gains
  `inboxSince?: string`, `convos: Record<string, { seenAt: string }>`, `defaultSentAt: Record<string, string>`.

- [ ] **Step 1: Write the failing DM tests**

In `replies.test.ts`, import `REPLY_CAP` is already there; add after the `tick` helper:

```ts
/* ---------- DMs ---------- */

const msgAt = (minAgo: number) => new Date(NOW.getTime() - minAgo * 60_000).toISOString();
const ME = { id: "17841", username: "3z.prod" };
const dm = (id: string, text: string, over: Record<string, unknown> = {}) => ({
  id,
  message: text,
  created_time: msgAt(1),
  from: { id: "p1", username: "sara" },
  ...over,
});
/** A conversation as the Conversations API lists it: messages newest first. */
const convo = (id: string, messages: Record<string, unknown>[]) => ({
  id,
  updated_time: messages[0]?.created_time,
  messages: { data: messages },
});
const camRule = (over: Partial<AutomationInput> = {}) =>
  input({
    id: "cam",
    trigger: "message",
    postId: null,
    keywords: ["كاميرا"],
    publicReplies: [],
    dmText: "أصور بالآيفون",
    buttons: [{ title: "أدواتي", url: "https://3zprod.com/gear" }],
    ...over,
  });
/** The mocks of a DM poll: /me, the conversations, and the Send API (which records what it got). */
function dmRoutes(conversations: unknown[], sent: unknown[] = []): Record<string, Handler> {
  return {
    [`GET ${IG}/me`]: () => ({ user_id: 17841, username: "3z.prod" }),
    [`GET ${IG}/17841/conversations`]: () => ({ data: conversations }),
    [`POST ${IG}/17841/messages`]: (_u, init) => {
      sent.push(JSON.parse(String(init?.body)));
      return { recipient_id: "p1", message_id: `out${sent.length}` };
    },
  };
}
/** The DM side has run before: messages from the last hour are new. */
const SINCE = { inboxSince: new Date(NOW.getTime() - 3_600_000).toISOString() };
```

and a new block after `describe("pollReplies", …)`:

```ts
describe("pollReplies: DMs and story replies", () => {
  it("the first DM poll only notes the time; nothing older is ever answered", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [camRule()]);
    const fetchMock = mockFetch(dmRoutes([convo("t1", [dm("d1", "كاميرا؟")])]));
    const r = await pollReplies(env, { fetch: fetchMock, now: NOW });
    expect(r.sent).toEqual([]);
    expect(fetchMock.calls()).not.toContain(`GET ${IG}/17841/conversations`);
    expect((await stateOf(env)).inboxSince).toBe(NOW.toISOString());
  });

  it("answers a DM keyword with the rule's text, buttons and «تابعني», once", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [camRule({ followButton: true })], SINCE);
    const sent: unknown[] = [];
    const convos = [convo("t1", [dm("d1", "إيش الكاميرا اللي تستخدمها؟")])];
    const r = await pollReplies(env, { fetch: mockFetch(dmRoutes(convos, sent)), now: NOW });
    expect(r.sent).toEqual(["d1"]);
    expect(sent[0]).toEqual({
      recipient: { id: "p1" },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text: "أصور بالآيفون",
            buttons: [
              { type: "web_url", url: `${BASE}/go/cam/0`, title: "أدواتي" },
              { type: "web_url", url: "https://www.instagram.com/3z.prod/", title: "تابعني" },
            ],
          },
        },
      },
    });
    const state = await stateOf(env);
    expect(state.convos.t1).toEqual({ seenAt: msgAt(1) });
    expect(state.stats.cam).toMatchObject({ sends: 1 });
    expect(state.sent.out1).toEqual({ to: "p1", at: NOW.toISOString() });
    expect(state.log[0]).toMatchObject({
      kind: "message",
      automationId: "cam",
      messageId: "d1",
      username: "sara",
      dm: "sent",
      publicReply: "skipped",
    });

    // The next poll finds nothing new: no send, no KV write.
    const writes = env.SOCIAL_KV.writes;
    const again = await pollReplies(env, { fetch: mockFetch(dmRoutes(convos)), now: tick(1) });
    expect(again.sent).toEqual([]);
    expect(env.SOCIAL_KV.writes).toBe(writes);
  });

  it("answers a story reply with the keyword (logged as story) and leaves story mentions alone", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [camRule()], SINCE);
    const sent: unknown[] = [];
    const r = await pollReplies(env, {
      fetch: mockFetch(
        dmRoutes(
          [
            convo("t1", [dm("d1", "كاميرا", { story: { reply_to: { id: "s1", link: "https://cdn/x" } } })]),
            convo("t2", [
              dm("d2", "", { from: { id: "p2" }, story: { mention: { id: "s2", link: "https://cdn/y" } } }),
            ]),
          ],
          sent,
        ),
      ),
      now: NOW,
    });
    expect(r.sent).toEqual(["d1"]);
    expect(sent).toHaveLength(1);
    const state = await stateOf(env);
    expect(state.log[0]).toMatchObject({ kind: "story", messageId: "d1" });
    expect(state.convos.t2).toEqual({ seenAt: msgAt(1) });
  });

  it("sends the default reply once per person a day, never to story replies or emoji-only messages", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [], SINCE);
    const store = Store.from(env)!;
    await store.putReplies({
      ...(await configOf(env)),
      defaultReply: {
        enabled: true,
        text: "وصلت رسالتك",
        enabledAt: SINCE.inboxSince,
        updatedAt: SINCE.inboxSince,
      },
    });
    const sent: unknown[] = [];
    const r = await pollReplies(env, {
      fetch: mockFetch(
        dmRoutes(
          [
            convo("t1", [dm("d2", "وينك"), dm("d1", "هلا عز", { created_time: msgAt(2) })]),
            convo("t2", [dm("d3", "🔥", { from: { id: "p2" } })]),
            convo("t3", [dm("d4", "حلو", { from: { id: "p3" }, story: { reply_to: { id: "s1" } } })]),
          ],
          sent,
        ),
      ),
      now: NOW,
    });
    expect(r.sent).toEqual(["d1"]);
    expect(sent).toEqual([{ recipient: { id: "p1" }, message: { text: "وصلت رسالتك" } }]);
    const state = await stateOf(env);
    expect(state.defaultSentAt).toEqual({ p1: NOW.toISOString() });
    expect(state.stats.default).toMatchObject({ sends: 1 });
    expect(state.log[0]).toMatchObject({ kind: "default", automationId: "default" });
    expect(state.convos).toEqual({
      t1: { seenAt: msgAt(1) },
      t2: { seenAt: msgAt(1) },
      t3: { seenAt: msgAt(1) },
    });
  });

  it("stays quiet where the owner wrote by hand in the last day, but not after the poll's own sends", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [camRule()], {
      ...SINCE,
      sent: { out9: { to: "p2", at: msgAt(5) }, out8: { to: "p3", at: msgAt(5) } },
    });
    const r = await pollReplies(env, {
      fetch: mockFetch(
        dmRoutes([
          // The owner answered by hand an hour ago.
          convo("t1", [dm("d1", "كاميرا"), dm("h1", "هلا والله", { from: ME, created_time: msgAt(60) })]),
          // The account's message is the poll's own send, by id.
          convo("t2", [
            dm("d2", "كاميرا", { from: { id: "p2" } }),
            dm("out9", "أصور بالآيفون", { from: ME, created_time: msgAt(5) }),
          ]),
          // The same, matched by time: Instagram's id differs, a minute after the send to p3.
          convo("t3", [
            dm("d3", "كاميرا", { from: { id: "p3" } }),
            dm("x7", "أصور بالآيفون", { from: ME, created_time: msgAt(4) }),
          ]),
        ]),
      ),
      now: NOW,
    });
    expect(r.sent).toEqual(["d2", "d3"]);
    expect((await stateOf(env)).convos.t1).toEqual({ seenAt: msgAt(1) });
  });

  it("leaves alone messages from before the rule was on and messages older than a day", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [camRule()], { inboxSince: msgAt(48 * 60) }, 30 * 60_000);
    const r = await pollReplies(env, {
      fetch: mockFetch(
        dmRoutes([
          convo("t1", [dm("d1", "كاميرا", { created_time: msgAt(45) })]),
          convo("t2", [dm("d2", "كاميرا", { from: { id: "p2" }, created_time: msgAt(25 * 60) })]),
        ]),
      ),
      now: NOW,
    });
    expect(r.sent).toEqual([]);
    expect(Object.keys((await stateOf(env)).convos).sort()).toEqual(["t1", "t2"]);
  });

  it("answers at most REPLY_CAP DMs a poll and the rest on the next one", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [camRule()], SINCE);
    const convos = Array.from({ length: 10 }, (_, i) =>
      convo(`t${i}`, [dm(`d${i}`, "كاميرا", { from: { id: `p${i}` } })]),
    );
    const r = await pollReplies(env, { fetch: mockFetch(dmRoutes(convos)), now: NOW });
    expect(r.sent).toHaveLength(REPLY_CAP);
    const next = await pollReplies(env, { fetch: mockFetch(dmRoutes(convos)), now: tick(1) });
    expect(next.sent).toEqual(["d8", "d9"]);
  });

  it("a refusal is final for its message; a glitch is retried on the next poll", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [camRule()], SINCE);
    let n = 0;
    const routes = {
      ...dmRoutes([
        convo("t1", [dm("d1", "كاميرا")]),
        convo("t2", [dm("d2", "كاميرا", { from: { id: "p2" } })]),
      ]),
      [`POST ${IG}/17841/messages`]: () => {
        n += 1;
        return n === 1
          ? json(
              {
                error: {
                  code: 10,
                  error_subcode: 2534022,
                  message: "This message is sent outside of allowed window.",
                },
              },
              400,
            )
          : json({ error: { message: "boom" } }, 500);
      },
    };
    const r = await pollReplies(env, { fetch: mockFetch(routes), now: NOW });
    expect(r.failed).toEqual(["d1", "d2"]);
    const state = await stateOf(env);
    expect(state.convos.t1).toEqual({ seenAt: msgAt(1) });
    expect(state.convos.t2).toBeUndefined();
    expect(state.retries.d2).toBe(1);
    expect(state.log.map((e) => e.error)).toEqual(["upstream", "not_eligible"]);
  });

  it("a conversations read that fails leaves the comments alone", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input(), camRule()], SINCE);
    const { routes } = igRoutes({
      [`GET ${IG}/17841/conversations`]: () => json({ error: { message: "boom" } }, 500),
    });
    const r = await pollReplies(env, { fetch: mockFetch(routes), now: NOW });
    expect(r.sent).toEqual(["c1"]);
    expect(r.error).toBe("upstream");
  });

  it("keeps the default reply's counters when it drops a deleted rule's", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    const zero = { sends: 1, publicReplies: 0, failures: 0, clicks: 0 };
    await seed(env, [input()], { stats: { default: zero, gone: zero } });
    await pollReplies(env, { fetch: mockFetch(igRoutes().routes), now: NOW });
    const { stats } = await stateOf(env);
    expect(stats.default).toBeDefined();
    expect(stats.gone).toBeUndefined();
  });
});
```

In the existing test "DMs a matching comment, then replies publicly, then leaves it alone", add `kind: "comment"` to
the `state.log[0]` expectation.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm.cmd exec vitest run workers/scout/src/social/replies.test.ts`
Expected: FAIL (no `inboxSince`, no conversations read, `kind` missing).

- [ ] **Step 3: Move the shared poll policy to `replyCore.ts`**

Cut from `replies.ts` into `replyCore.ts` (under the errors section), exported: `MAX_RETRIES`, `TICK_STOPPERS`
(type it `ReadonlySet<ReplyErrorCode>`), and v1's private `TEXT_CLIP` renamed `LOG_TEXT_CLIP`. Import them back in
`replies.ts` and rename the one `TEXT_CLIP` use to `LOG_TEXT_CLIP`.

- [ ] **Step 4: The new state and log fields in `replies.ts`**

1. Replace `ReplyLogEntry`:
   ```ts
   /** What a log entry answered (round 34): a comment, a DM, a story reply, or a DM with the default reply. */
   export type ReplyKind = "comment" | "message" | "story" | "default";

   export interface ReplyLogEntry {
     at: string;
     kind: ReplyKind;
     /** The rule, or DEFAULT_STATS_ID for the default reply. */
     automationId: string;
     /** Comments: the post and the comment. */
     postId?: string;
     commentId?: string;
     /** DMs and story replies: the person's message. */
     messageId?: string;
     username?: string;
     /** The comment or message, clipped. */
     text: string;
     publicReply: "sent" | "skipped" | "failed";
     dm: "sent" | "failed";
     error?: ReplyErrorCode;
     /** The platform's words (never a token). */
     detail?: string;
   }
   ```
   and add `kind: "comment",` to the entry the comment loop builds.
2. `PollState` gains:
   ```ts
   /** ISO: when the DM side first ran; nothing older is ever answered (inbox.ts). */
   inboxSince?: string;
   /** Conversation id → the newest message handled (pruned after CONVO_TTL_MS). */
   convos: Record<string, { seenAt: string }>;
   /** Instagram-scoped id → when the default reply last went to that person (pruned after a day). */
   defaultSentAt: Record<string, string>;
   ```
   and `emptyState()` gains `convos: {}, defaultSentAt: {}`.

- [ ] **Step 5: Create `inbox.ts`**

```ts
/**
 * 💬 Auto replies, the DM side (round 34, planning/tools/14-auto-replies-v2.md): reads the newest conversations and
 * answers the DMs and story replies that carry a message rule's keyword, plus the default reply (at most once per
 * person a day). `pollReplies` (replies.ts) runs it after the comments, under the same lock, answer cap and single
 * write. It never starts a conversation: every answer is inside the 24-hour window the person's own message opened.
 *
 *   GET  /{IG_ID}/conversations?platform=instagram&limit=20&fields=id,updated_time,messages.limit(5){…}  one call
 *   POST /{IG_ID}/messages { recipient: { id: IGSID }, message }                         replyCore.sendReply
 *
 * Where a conversation stands: `state.convos[id].seenAt`, the newest message handled. The first poll ever only
 * stamps `state.inboxSince` and answers nothing. The owner chatting by hand (a message from the account in the last
 * day that the poll did not send) keeps rules and the default reply out of that conversation. Instagram does not
 * document the order of the list, so every returned conversation is checked.
 */

import { clip, fetchJson, type Http } from "./http";
import { IG_API } from "./instagram";
import type { MetaPage } from "./meta";
import {
  DEFAULT_STATS_ID,
  graph,
  LOG_TEXT_CLIP,
  matches,
  MAX_RETRIES,
  messageButtons,
  normalizeForMatch,
  sendReply,
  TICK_STOPPERS,
  toReplyCode,
  type ReplyErrorCode,
} from "./replyCore";
import type {
  Automation,
  AutomationsDoc,
  PollState,
  ReplyLogEntry,
  ReplyStats,
} from "./replies";

/** Conversations read per poll (one call). */
export const CONVERSATIONS_PAGE = 20;
/** Newest messages read per conversation. */
export const MESSAGES_PER_CONVERSATION = 5;
/** Instagram's messaging window: only messages younger than this are answered. */
export const WINDOW_MS = 24 * 60 * 60_000;
/** A message from the account this soon after a poll's send to the same person is that send (ids may differ). */
export const OWN_SEND_SLACK_MS = 2 * 60_000;
/** Conversation positions are forgotten after a week without news. */
export const CONVO_TTL_MS = 7 * 24 * 60 * 60_000;

interface IgMessage {
  id?: string;
  created_time?: string | number;
  from?: { id?: string; username?: string };
  message?: string;
  story?: { mention?: { id?: string }; reply_to?: { id?: string } };
  is_unsupported?: boolean;
}

interface IgConversation {
  id?: string;
  updated_time?: string | number;
  messages?: { data?: IgMessage[] };
}

/** ISO 8601 or UNIX seconds (Instagram's docs show both) → epoch ms; NaN when unreadable. */
export function toMs(v: string | number | undefined): number {
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  if (typeof v === "string" && /^\d+$/.test(v)) return toMs(Number(v));
  return Date.parse(v ?? "");
}

/** Whether a message from the account is one the poll sent: by id, else by time just after a send to that person. */
export function isOwnSend(
  state: Pick<PollState, "sent">,
  id: string,
  ms: number,
  personId: string,
): boolean {
  if (state.sent[id]) return true;
  return Object.values(state.sent).some((s) => {
    const after = ms - Date.parse(s.at);
    return s.to === personId && after >= -60_000 && after <= OWN_SEND_SLACK_MS;
  });
}

/** One of the person's new messages. */
export interface InboxItem {
  id: string;
  ms: number;
  text: string;
  /** A reply to one of the account's stories. */
  story: boolean;
  /** Left alone but handled: a story mention, no text, unsupported, older than a day, or the owner is chatting. */
  skip: boolean;
}

/** A conversation with something new from the person. */
export interface ConversationBatch {
  id: string;
  personId: string;
  username?: string;
  /** The person's new messages, oldest first. */
  items: InboxItem[];
  /** The newest message time in the conversation: `seenAt` moves there once every item was handled. */
  newestMs: number;
}

export interface InboxDeps {
  http: Http;
  token: string;
  igUserId: string;
  config: AutomationsDoc;
  state: PollState;
  now: Date;
  /** A rule's counters (or the default reply's), created on first use. */
  statsOf: (id: string) => ReplyStats;
  /** Puts an entry at the top of the log. */
  log: (entry: ReplyLogEntry) => void;
}

export interface InboxOutcome {
  /** Message ids answered. */
  sent: string[];
  failed: string[];
  /** A failure after which nothing else will work this poll. */
  stop?: ReplyErrorCode;
  changed: boolean;
}

/** Whether the DM side has anything to do: a switched-on message rule, or the default reply. */
export function inboxActive(config: AutomationsDoc): boolean {
  return (
    !!config.defaultReply?.enabled ||
    Object.values(config.automations).some((a) => a.enabled && a.trigger === "message")
  );
}

/** The first switched-on message rule (oldest first) that matches and was on when the message came. */
export function pickMessageRule(
  config: AutomationsDoc,
  text: string,
  ms: number,
): Automation | undefined {
  return Object.values(config.automations)
    .filter(
      (a) =>
        a.enabled && a.trigger === "message" && (!a.enabledAt || Date.parse(a.enabledAt) <= ms),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .find((a) => matches(text, a));
}

/**
 * The conversations with new messages from the person. The very first read only stamps `state.inboxSince`.
 * Conversations whose news is only the account's own messages move their `seenAt` here. Throws (ReplyError /
 * SocialError) when the list cannot be read.
 */
export async function readInbox(
  d: InboxDeps,
): Promise<{ batches: ConversationBatch[]; changed: boolean }> {
  const { state, now, igUserId } = d;
  if (!state.inboxSince) {
    state.inboxSince = now.toISOString();
    return { batches: [], changed: true };
  }
  const url = new URL(`${IG_API}/${igUserId}/conversations`);
  url.searchParams.set("platform", "instagram");
  url.searchParams.set("limit", String(CONVERSATIONS_PAGE));
  url.searchParams.set(
    "fields",
    `id,updated_time,messages.limit(${MESSAGES_PER_CONVERSATION}){id,created_time,from,message,story,is_unsupported}`,
  );
  url.searchParams.set("access_token", d.token);
  const page = graph(
    await fetchJson<MetaPage<IgConversation>>(d.http, url.toString()),
    "conversations",
  );
  const nowMs = now.getTime();
  const batches: ConversationBatch[] = [];
  let changed = false;
  for (const c of page.data ?? []) {
    if (!c.id) continue;
    const seen = toMs(state.convos[c.id]?.seenAt ?? state.inboxSince);
    const msgs = (c.messages?.data ?? [])
      .filter((m): m is IgMessage & { id: string } => !!m.id)
      .map((m) => ({ m, ms: toMs(m.created_time) }))
      .filter((x) => Number.isFinite(x.ms))
      .sort((a, b) => a.ms - b.ms);
    const newestMs = msgs.length ? msgs[msgs.length - 1].ms : NaN;
    if (!(newestMs > seen)) continue;
    const person = msgs.find((x) => x.m.from?.id && x.m.from.id !== igUserId)?.m.from;
    const personId = person?.id;
    const fresh = msgs.filter((x) => x.ms > seen && x.m.from?.id !== igUserId);
    if (!personId || !fresh.length) {
      state.convos[c.id] = { seenAt: new Date(newestMs).toISOString() };
      changed = true;
      continue;
    }
    const ownerChatting = msgs.some(
      (x) =>
        x.m.from?.id === igUserId &&
        nowMs - x.ms <= WINDOW_MS &&
        !isOwnSend(state, x.m.id, x.ms, personId),
    );
    batches.push({
      id: c.id,
      personId,
      ...(person?.username ? { username: person.username } : {}),
      newestMs,
      items: fresh.map(({ m, ms }) => {
        const text = m.message ?? "";
        return {
          id: m.id,
          ms,
          text,
          story: !!m.story?.reply_to,
          skip:
            ownerChatting ||
            !!m.story?.mention ||
            !!m.is_unsupported ||
            !text.trim() ||
            nowMs - ms > WINDOW_MS,
        };
      }),
    });
  }
  return { batches, changed };
}

/**
 * Answers the batches while `capLeft` answers and the call budget last, and moves each conversation's `seenAt` up to
 * the last message handled. A refusal is final for its message; a glitch is retried on later polls (up to
 * MAX_RETRIES) and its conversation waits for it; a tick stopper ends the poll.
 */
export async function answerInbox(
  d: InboxDeps,
  batches: readonly ConversationBatch[],
  capLeft: number,
): Promise<InboxOutcome> {
  const { state, now, config } = d;
  const at = now.toISOString();
  const out: InboxOutcome = { sent: [], failed: [], changed: false };
  const def = config.defaultReply;
  for (const batch of batches) {
    if (out.stop) break;
    let handledUpTo: number | undefined;
    let done = true;
    for (const item of batch.items) {
      const rule = item.skip ? undefined : pickMessageRule(config, item.text, item.ms);
      const lastDefault = state.defaultSentAt[batch.personId];
      const useDefault =
        !item.skip &&
        !rule &&
        !item.story &&
        !!def?.enabled &&
        !!def.text &&
        !!normalizeForMatch(item.text) &&
        (!def.enabledAt || Date.parse(def.enabledAt) <= item.ms) &&
        !(lastDefault && now.getTime() - Date.parse(lastDefault) < WINDOW_MS);
      if (!rule && !useDefault) {
        handledUpTo = item.ms;
        continue;
      }
      if (out.sent.length >= capLeft || !d.http.budget.ok) {
        done = false;
        break;
      }
      const id = rule?.id ?? DEFAULT_STATS_ID;
      const s = d.statsOf(id);
      const entry: ReplyLogEntry = {
        at,
        kind: rule ? (item.story ? "story" : "message") : "default",
        automationId: id,
        messageId: item.id,
        ...(batch.username ? { username: batch.username } : {}),
        text: clip(item.text, LOG_TEXT_CLIP) ?? "",
        publicReply: "skipped",
        dm: "failed",
      };
      let final = true;
      try {
        const messageId = await sendReply(
          { http: d.http, igUserId: d.igUserId, token: d.token },
          { id: batch.personId },
          rule ? rule.dmText : (def?.text ?? ""),
          rule ? messageButtons(rule, config.origin, state.ownerUsername) : [],
        );
        entry.dm = "sent";
        s.sends += 1;
        s.lastSentAt = at;
        s.lastError = undefined;
        if (messageId) state.sent[messageId] = { to: batch.personId, at };
        if (!rule) state.defaultSentAt[batch.personId] = at;
        delete state.retries[item.id];
        out.sent.push(item.id);
      } catch (e) {
        const { code, detail, transient } = toReplyCode(e);
        entry.error = code;
        if (detail) entry.detail = detail.slice(0, 200);
        s.failures += 1;
        s.lastError = code;
        out.failed.push(item.id);
        if (TICK_STOPPERS.has(code)) {
          out.stop = code;
          final = false;
        } else if (transient) {
          const tries = (state.retries[item.id] ?? 0) + 1;
          if (tries < MAX_RETRIES) {
            state.retries[item.id] = tries;
            final = false;
          } else {
            delete state.retries[item.id];
          }
        }
      }
      d.log(entry);
      out.changed = true;
      if (!final) {
        done = false;
        break;
      }
      handledUpTo = item.ms;
    }
    const upTo = done ? batch.newestMs : handledUpTo;
    const seen = toMs(state.convos[batch.id]?.seenAt ?? state.inboxSince);
    if (upTo !== undefined && upTo > seen) {
      state.convos[batch.id] = { seenAt: new Date(upTo).toISOString() };
      out.changed = true;
    }
  }
  return out;
}
```

- [ ] **Step 6: Run the DM poll from `pollReplies`**

In `replies.ts`:

1. Import:
   ```ts
   import {
     answerInbox,
     CONVO_TTL_MS,
     inboxActive,
     readInbox,
     WINDOW_MS,
     type ConversationBatch,
     type InboxDeps,
   } from "./inbox";
   ```
2. Replace the "nothing to do" check:
   ```ts
   const enabled = Object.values(config.automations).filter(
     (a) => a.enabled && a.trigger === "comment",
   );
   const dmOn = inboxActive(config);
   if (!enabled.length && !dmOn) return { ...result, skipped: "none" };
   ```
3. The counters of deleted automations: `if (!config.automations[id] && id !== DEFAULT_STATS_ID) {`.
4. Next to `statsOf`, add a log helper and use it in the comment loop instead of the inline `unshift`:
   ```ts
   const addLog = (entry: ReplyLogEntry) => {
     state.log.unshift(entry);
     if (state.log.length > LOG_MAX) state.log.length = LOG_MAX;
   };
   ```
5. After the comment candidates are sorted and **before** the lock, read the DMs:
   ```ts
   const inbox: InboxDeps = { http, token, igUserId, config, state, now, statsOf, log: addLog };
   let batches: ConversationBatch[] = [];
   if (dmOn) {
     try {
       const read = await readInbox(inbox);
       batches = read.batches;
       if (read.changed) changed = true;
     } catch (e) {
       const { code, detail } = toReplyCode(e);
       if (TICK_STOPPERS.has(code)) throw e;
       result.error = code;
       if (detail) result.detail = detail.slice(0, 200);
     }
   }
   const dmToAnswer = batches.some((b) => b.items.some((i) => !i.skip));
   ```
   and take the lock when either side has work: `if (candidates.length || dmToAnswer) {`.
6. After the comment loop and before `setError(stop)`:
   ```ts
   if (!stop && batches.length) {
     const dms = await answerInbox(inbox, batches, REPLY_CAP - result.sent.length);
     result.sent.push(...dms.sent);
     result.failed.push(...dms.failed);
     if (dms.changed) changed = true;
     stop = dms.stop;
   }
   ```
7. In the pruning at the end, add:
   ```ts
   for (const [id, c] of Object.entries(state.convos)) {
     if (now.getTime() - Date.parse(c.seenAt) > CONVO_TTL_MS) {
       delete state.convos[id];
       changed = true;
     }
   }
   for (const [person, when] of Object.entries(state.defaultSentAt)) {
     if (now.getTime() - Date.parse(when) > WINDOW_MS) {
       delete state.defaultSentAt[person];
       changed = true;
     }
   }
   ```
8. Header comment of `replies.ts`: mention that the same poll answers DMs (`inbox.ts`).

- [ ] **Step 7: Run the tests, typecheck and lint**

Run: `pnpm.cmd exec vitest run workers/scout/src/social/` then `pnpm.cmd typecheck` and `pnpm.cmd lint`
Expected: all PASS, clean.

- [ ] **Step 8: Commit**

```bash
git add workers/scout/src/social/inbox.ts workers/scout/src/social/replyCore.ts workers/scout/src/social/replies.ts workers/scout/src/social/replies.test.ts
git commit -m "Auto replies v2: answer DMs and story replies, and the default reply" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Worker — pause, the write guard, and the every-minute trigger

**Files:**
- Modify: `workers/scout/src/social/replies.ts`
- Modify: `workers/scout/src/social/cron.ts`
- Modify: `workers/scout/src/index.ts` (comment only)
- Modify: `workers/scout/wrangler.jsonc`
- Modify: `workers/scout/src/social/replies.test.ts`
- Modify: `workers/scout/src/trends/trends.test.ts`

**Interfaces:**
- Consumes (Tasks 1–3): `pollReplies`, `PollState`, `publicDoc`, `AutomationsDoc.paused`.
- Produces (`replies.ts`): `WRITE_SLOW = 300`, `WRITE_STOP = 600`,
  `writeGuard(state: Pick<PollState, "writes">, now: Date): "slow" | "stop" | undefined`,
  `PollState.writes?: { day: string; count: number }` (UTC day), `PollDeps.fiveMinuteTick?: boolean` (default
  true), `PollResult.skipped` adds `"paused" | "guard"`, `publicDoc(config, state, clicks, now?: Date)` adds
  `guard?: "slow" | "stop"`.
- Produces (`cron.ts`): `TICK_CRON = "* * * * *"`; `TickResult` adds `{ replies: PollResult }` (off-grid minutes).

- [ ] **Step 1: Write the failing tests**

In `replies.test.ts`, add after `describe("pollReplies: DMs and story replies", …)`:

```ts
describe("pause and the write guard", () => {
  const today = NOW.toISOString().slice(0, 10);

  it("answers nothing while paused", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input()]);
    await Store.from(env)!.putReplies({ ...(await configOf(env)), paused: true });
    const fetchMock = mockFetch(igRoutes().routes);
    expect(await pollReplies(env, { fetch: fetchMock, now: NOW })).toMatchObject({ skipped: "paused" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("counts its writes per UTC day; from 300 it skips the off-grid minutes", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input()], { writes: { day: today, count: 300 } });
    const fetchMock = mockFetch(igRoutes().routes);
    expect(
      await pollReplies(env, { fetch: fetchMock, now: NOW, fiveMinuteTick: false }),
    ).toMatchObject({ skipped: "guard" });
    expect(fetchMock).not.toHaveBeenCalled();

    const r = await pollReplies(env, { fetch: fetchMock, now: NOW });
    expect(r.sent).toEqual(["c1"]);
    // The lock, then the result.
    expect((await stateOf(env)).writes).toEqual({ day: today, count: 302 });
    const listed = (await (
      await handle(req("/social/replies"), env, undefined, { now: () => NOW })
    ).json()) as Record<string, unknown>;
    expect(listed.guard).toBe("slow");
  });

  it("from 600 it answers nothing until the next UTC day", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input()], { writes: { day: today, count: 600 } });
    const fetchMock = mockFetch(igRoutes().routes);
    expect(await pollReplies(env, { fetch: fetchMock, now: NOW })).toMatchObject({ skipped: "guard" });
    const tomorrow = new Date(NOW.getTime() + 86_400_000);
    expect((await pollReplies(env, { fetch: fetchMock, now: tomorrow })).sent).toEqual(["c1"]);
  });
});
```

In `describe("cron tick", …)` add:

```ts
  it("polls only the replies on minutes off the five-minute grid", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input()]);
    const r = await runTick(env, tickAt("09:01"), { fetch: mockFetch(igRoutes().routes), now: NOW });
    expect(r).toMatchObject({ replies: { sent: ["c1"] } });
    expect(r).not.toHaveProperty("publish");
  });

  it("the write guard's slow mode skips the off-grid minutes only", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input()], { writes: { day: "2026-09-29", count: 300 } });
    const fetchMock = mockFetch(igRoutes().routes);
    expect(await runTick(env, tickAt("09:01"), { fetch: fetchMock, now: NOW })).toMatchObject({
      replies: { skipped: "guard" },
    });
    expect(await runTick(env, tickAt("09:05"), { fetch: fetchMock, now: NOW })).toMatchObject({
      replies: { sent: ["c1"] },
    });
  });
```

In `workers/scout/src/trends/trends.test.ts`, in "every slot sits on the five-minute grid of the one trigger, …",
change `expect(TICK_CRON).toBe("*/5 * * * *");` to `expect(TICK_CRON).toBe("* * * * *");`.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm.cmd exec vitest run workers/scout/src/social/replies.test.ts workers/scout/src/trends/trends.test.ts`
Expected: FAIL (no `paused` / `guard` skips, `TICK_CRON` still `*/5 * * * *`, 09:01 runs the publish queue).

- [ ] **Step 3: Pause and the write guard in `replies.ts`**

1. Limits:
   ```ts
   /** replies:state writes in a UTC day from which the poll runs on five-minute ticks only… */
   export const WRITE_SLOW = 300;
   /** …and from which it answers nothing until 00:00 UTC. The free plan allows 1,000 KV writes a day for every
    * key of the Worker together (the sync, the publish queue, the Trend Radar, /go). ponytail: one shared counter;
    * move the poller's state to D1 when instant mode (webhooks) lands, since then every event writes. */
   export const WRITE_STOP = 600;
   ```
2. `PollState` gains:
   ```ts
   /** replies:state writes on a UTC day (Cloudflare's daily limits reset at 00:00 UTC). */
   writes?: { day: string; count: number };
   ```
3. Add, next to `emptyStats`:
   ```ts
   const utcDay = (d: Date) => d.toISOString().slice(0, 10);

   /** The write guard today: "slow" (five-minute ticks only), "stop" (nothing until 00:00 UTC), or nothing. */
   export function writeGuard(
     state: Pick<PollState, "writes">,
     now: Date,
   ): "slow" | "stop" | undefined {
     const n = state.writes?.day === utcDay(now) ? state.writes.count : 0;
     return n >= WRITE_STOP ? "stop" : n >= WRITE_SLOW ? "slow" : undefined;
   }
   ```
4. `PollDeps` gains:
   ```ts
   /** False on the cron's off-grid minutes, which the guard's "slow" mode skips. Default true. */
   fiveMinuteTick?: boolean;
   ```
   and `PollResult.skipped` becomes
   `"none" | "not_connected" | "no_permission" | "token_expired" | "locked" | "paused" | "guard"`.
5. In `pollReplies`, right after `config` is read: `if (config.paused) return { ...result, skipped: "paused" };`.
   Right after the `locked` check:
   ```ts
   const guard = writeGuard(state, now);
   if (guard === "stop" || (guard === "slow" && deps.fiveMinuteTick === false)) {
     return { ...result, skipped: "guard" };
   }
   ```
6. Count every write of the state. Add, next to `save`:
   ```ts
   const put = async () => {
     const day = utcDay(now);
     state.writes = { day, count: (state.writes?.day === day ? state.writes.count : 0) + 1 };
     await store.putRepliesState(state);
   };
   ```
   and replace both `await store.putRepliesState(state);` (the lock and `save`) with `await put();`.
7. `publicDoc(config, state, clicks, now: Date = new Date())` adds, after `lastError`:
   ```ts
   ...(writeGuard(state, now) ? { guard: writeGuard(state, now) } : {}),
   ```
   and every caller in `handleReplies` passes the route's `now` as the fourth argument
   (`publicDoc(...(await readAll(store)), now)` and `publicDoc(next, state, clicks, now)`).

- [ ] **Step 4: The every-minute trigger**

1. `cron.ts`:
   - `export const TICK_CRON = "* * * * *";`
   - `TickResult` gains `| { replies: PollResult }`.
   - `runTick` starts with:
     ```ts
     const now = deps.now ?? new Date(scheduledTime);
     // Off the five-minute grid only the replies run (every sync and trend slot sits on the grid).
     if (new Date(scheduledTime).getUTCMinutes() % 5 !== 0) {
       return { replies: await pollReplies(env, { fetch: deps.fetch, now, fiveMinuteTick: false }) };
     }
     ```
     (delete the later `const now = …` line; the rest of the function is unchanged).
   - Rewrite the header comment's first sentence: the one cron trigger (`* * * * *`) polls the auto replies
     (comments and DMs) every minute; on the five-minute grid it keeps today's schedule — the auto-post queue, the
     daily sync slots, the Trend Radar slots, and the replies when publishing moved nothing.
2. `workers/scout/wrangler.jsonc`: `"triggers": { "crons": ["* * * * *"] },`.
3. `workers/scout/src/index.ts`: update the `scheduled` comment ("every minute the auto replies; on the five-minute
   grid the auto-post queue, …").

- [ ] **Step 5: Run the Worker tests, typecheck and lint**

Run: `pnpm.cmd exec vitest run workers/scout/` then `pnpm.cmd typecheck` and `pnpm.cmd lint`
Expected: all PASS (including `publish.test.ts` and `trends.test.ts`), clean.

- [ ] **Step 6: Commit**

```bash
git add workers/scout/src/social/replies.ts workers/scout/src/social/cron.ts workers/scout/src/index.ts workers/scout/wrangler.jsonc workers/scout/src/social/replies.test.ts workers/scout/src/trends/trends.test.ts
git commit -m "Auto replies v2: pause, a KV write guard, and the every-minute trigger" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Dashboard — v2 schemas, mirrored rules, the settings call

**Files:**
- Modify: `lib/domain.ts:466-532` (the auto-reply schemas)
- Modify: `lib/replies.ts`
- Modify: `lib/replies.test.ts`
- Modify: `components/social/useReplies.ts`
- Modify: `components/social/replies/AutoReplyForm.tsx` (compile fixes only; Task 7 replaces it)
- Modify: `messages/replies.ar.json`, `messages/replies.en.json` (two problem messages)

**Interfaces:**
- Consumes (Worker, Tasks 1–4): the `GET /social/replies` document (`automations[]` with `trigger`,
  `publicReplies`, `followButton`; `log[]` with `kind`, `messageId`; `paused`; `defaultReply` with `stats`; `guard`;
  `ownerUsername`) and `POST /social/replies/settings`.
- Produces (`lib/domain.ts`): `REPLY_TRIGGERS`, `ReplyTriggerSchema`, `type ReplyTrigger`; `AutoReply` gains
  `trigger`, `publicReplies: string[]`, `followButton: boolean` (and loses `publicReply`; v1 documents' `publicReply`
  is read into `publicReplies`); `AutoReplyLog` gains `kind` (default `"comment"`), `messageId?`, and `postId` /
  `commentId` become optional; `DefaultReplySchema`, `type DefaultReply`; `AutoRepliesDoc` gains `paused` (default
  false), `defaultReply?`, `guard?: "slow" | "stop"`, `ownerUsername?`.
- Produces (`lib/replies.ts`): `PUBLIC_REPLIES_MAX = 3`, `DM_TEXT_BYTES = 1000`, `TEMPLATE_TEXT_MAX = 640`,
  `USERNAME_MAX = 30`, `FOLLOW_TITLE = "تابعني"`, `utf8Bytes`, `profileUrl`, `interface LinkButton`,
  `messageButtons(a, origin, username)`, `textBody(text, buttons)`, `dmBytesLeft(a, origin): number`,
  `firstMatch(text, replies, trigger: ReplyTrigger = "comment")`, `newAutoReply(id?, trigger = "comment")`,
  `replyProblems(a, status, origin?)` with the new codes `"tooManyPublic"` and `"templateTooLong"`,
  `defaultReplyProblems(d: { enabled: boolean; text: string }): ReplyProblem[]`, `replyInput` (v2 body),
  `interface RepliesSettings { paused?: boolean; defaultReply?: { enabled: boolean; text: string } }`,
  `repliesSettings(config, settings, opts?): Promise<SocialResult<{ doc: AutoRepliesDoc }>>`. `DM_MAX` is removed;
  `dmPreview` stays until Task 7.
- Produces (`useReplies.ts`): `saveSettings(settings: RepliesSettings): Promise<boolean>`.

- [ ] **Step 1: Write the failing tests**

In `lib/replies.test.ts`:

1. Imports from `./replies`: add `defaultReplyProblems`, `dmBytesLeft`, `messageButtons`, `repliesSettings`,
   `textBody`.
2. The `reply()` fixture keeps `publicReply: "أرسلته لك 🎬"` on purpose (the schema reads a v1 field into
   `publicReplies`); add one assertion to "normalizes like the Worker":
   ```ts
   expect(reply().publicReplies).toEqual(["أرسلته لك 🎬"]);
   expect(reply()).not.toHaveProperty("publicReply");
   ```
3. In "names every missing or oversized part", replace `publicReply: "x".repeat(2201),` with
   `publicReplies: ["x".repeat(2201)],` and replace the `dmTooLong` expectation with:
   ```ts
   expect(replyProblems(reply({ buttons: [], dmText: "ل".repeat(501) }), null)).toEqual([
     { code: "dmTooLong" },
   ]);
   expect(replyProblems(reply({ dmText: "x".repeat(641) }), null)).toEqual([
     { code: "templateTooLong", max: 640 },
   ]);
   expect(
     replyProblems(reply({ publicReplies: ["a", "b", "c", "d"] }), null).map((p) => p.code),
   ).toEqual(["tooManyPublic"]);
   expect(replyProblems(reply({ followButton: true, buttons: [
     { title: "a", url: LUT }, { title: "b", url: LUT }, { title: "c", url: LUT },
   ] }), null).map((p) => p.code)).toEqual(["tooManyButtons"]);
   // A message rule's public replies are never sent, so they never block saving.
   expect(
     replyProblems(reply({ trigger: "message", publicReplies: ["x".repeat(2201)] }), null),
   ).toEqual([]);
   ```
4. In "builds the Worker body without the counters", the expected body becomes:
   ```ts
   {
     id: "lut",
     enabled: true,
     trigger: "comment",
     postId: "m1",
     keywords: ["لت"],
     match: "contains",
     publicReplies: ["أرسلته لك 🎬"],
     dmText: "حمل اللت من الرابط تحت",
     buttons: [{ title: "حمل اللت", url: LUT }],
     followButton: false,
   }
   ```
   and add after it:
   ```ts
   it("sends a message rule without a post or public replies", () => {
     const a = reply({ trigger: "message", title: "x", thumbUrl: "https://cdn.test/t.jpg" });
     expect(replyInput(a)).toMatchObject({ trigger: "message", postId: null, publicReplies: [] });
     expect(replyInput(a)).not.toHaveProperty("title");
   });
   ```
5. Add:

```ts
describe("the reply as the Worker builds it", () => {
  it("routes links through /go, puts «تابعني» last, and writes the plain-text form", () => {
    const a = reply({ followButton: true });
    expect(messageButtons(a, "https://w.test", "3z.prod")).toEqual([
      { title: "حمل اللت", url: "https://w.test/go/lut/0" },
      { title: "تابعني", url: "https://www.instagram.com/3z.prod/" },
    ]);
    expect(textBody("هلا", [{ title: "أ", url: LUT }])).toBe(`هلا\n\nأ: ${LUT}`);
  });

  it("counts the bytes left like the Worker's dmFits (Arabic letters are two bytes)", () => {
    expect(dmBytesLeft(reply({ buttons: [], dmText: "ل".repeat(500) }), "https://w.test")).toBe(0);
    expect(dmBytesLeft(reply({ buttons: [], dmText: "ل".repeat(501) }), "https://w.test")).toBe(-2);
  });

  it("firstMatch answers DMs with the oldest message rule only", () => {
    const comment = reply({ id: "c", keywords: ["كاميرا"] });
    const newer = reply({ id: "new", trigger: "message", keywords: ["كاميرا"], createdAt: "2026-10-02T00:00:00Z" });
    const older = reply({ id: "old", trigger: "message", keywords: ["كاميرا"], createdAt: "2026-10-01T00:00:00Z" });
    expect(firstMatch("كاميرا؟", [comment, newer, older], "message")?.id).toBe("old");
    expect(firstMatch("كاميرا؟", [comment, newer, older])?.id).toBe("c");
  });

  it("checks the default reply like the Worker", () => {
    expect(defaultReplyProblems({ enabled: true, text: " " })).toEqual([{ code: "noDm" }]);
    expect(defaultReplyProblems({ enabled: false, text: "" })).toEqual([]);
    expect(defaultReplyProblems({ enabled: true, text: "ل".repeat(501) })).toEqual([{ code: "dmTooLong" }]);
  });
});

describe("repliesSettings", () => {
  it("posts the settings and answers with the fresh document", async () => {
    const fetchMock = replying({ automations: [], log: [], paused: true, guard: "slow" });
    const r = await repliesSettings(CONFIG, { paused: true }, { fetch: fetchMock });
    expect(r).toMatchObject({ ok: true, doc: { paused: true, guard: "slow" } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://scout.test/social/replies/settings");
    expect(JSON.parse(String(init?.body))).toEqual({ paused: true });
  });

  it("reads a v2 document: default reply with its counters, log kinds", async () => {
    const doc = parseRepliesDoc({
      automations: [],
      log: [{ at: "t", kind: "default", automationId: "default", messageId: "d1", text: "هلا", publicReply: "skipped", dm: "sent" }],
      paused: false,
      defaultReply: { enabled: true, text: "وصلت رسالتك", stats: { sends: 3 } },
      ownerUsername: "3z.prod",
    });
    expect(doc).toMatchObject({
      log: [{ kind: "default", messageId: "d1" }],
      defaultReply: { enabled: true, stats: { sends: 3, clicks: 0 } },
      ownerUsername: "3z.prod",
    });
  });
});
```

Check how `repliesList` tests pass the fetch option in this file (`{ fetch: fetchMock }` in `SocialSyncOpts`) and use
the same option name.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm.cmd exec vitest run lib/replies.test.ts`
Expected: FAIL (missing exports, `publicReplies` undefined, old `dmTooLong` shape).

- [ ] **Step 3: The schemas in `lib/domain.ts`**

Replace `AutoReplySchema`, `AutoReplyLogSchema` and `AutoRepliesDocSchema` (keep `REPLY_MATCHES`,
`AutoReplyButtonSchema`, `AutoReplyStatsSchema`), and update the block comment to "our own Smart Reply (round 30;
DMs, story replies and the default reply since round 34)":

```ts
export const REPLY_TRIGGERS = ["comment", "message"] as const;
export const ReplyTriggerSchema = z.enum(REPLY_TRIGGERS);
export type ReplyTrigger = z.infer<typeof ReplyTriggerSchema>;

export const AutoReplySchema = z
  .object({
    id: z.string().min(1),
    enabled: z.boolean().default(true),
    /** "comment": a comment on a post; "message": a DM or a story reply. */
    trigger: ReplyTriggerSchema.default("comment"),
    /** Instagram media id; null = any post. Always null for message rules. */
    postId: z.string().nullable().default(null),
    /** Display only, copied from the synced post. */
    permalink: z.string().optional(),
    title: z.string().optional(),
    thumbUrl: z.string().optional(),
    keywords: z.array(z.string()).default([]),
    match: ReplyMatchSchema.default("contains"),
    /** Comment rules: up to 3, one picked at random; `{username}` becomes @handle. */
    publicReplies: z.array(z.string()).default([]),
    /** Only from a Worker older than round 34: its single public reply (read into `publicReplies`). */
    publicReply: z.string().optional(),
    dmText: z.string().default(""),
    buttons: z.array(AutoReplyButtonSchema).default([]),
    /** Adds «تابعني» (the profile) after the link buttons. */
    followButton: z.boolean().default(false),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    enabledAt: z.string().optional(),
    stats: AutoReplyStatsSchema.default({ sends: 0, publicReplies: 0, failures: 0, clicks: 0 }),
  })
  .transform(({ publicReply, ...a }) => ({
    ...a,
    publicReplies:
      a.publicReplies.length || !publicReply?.trim() ? a.publicReplies : [publicReply.trim()],
  }));
export type AutoReply = z.infer<typeof AutoReplySchema>;
export type AutoReplyInput = z.input<typeof AutoReplySchema>;

export const AutoReplyLogSchema = z.object({
  at: z.string(),
  /** What was answered; entries from before round 34 are comments. */
  kind: z.enum(["comment", "message", "story", "default"]).default("comment"),
  automationId: z.string(),
  postId: z.string().optional(),
  commentId: z.string().optional(),
  messageId: z.string().optional(),
  username: z.string().optional(),
  text: z.string().default(""),
  publicReply: z.enum(["sent", "skipped", "failed"]),
  dm: z.enum(["sent", "failed"]),
  error: z.string().optional(),
  detail: z.string().optional(),
});
export type AutoReplyLog = z.infer<typeof AutoReplyLogSchema>;

/** The answer to a DM that matches no rule: at most once per person a day. */
export const DefaultReplySchema = z.object({
  enabled: z.boolean().default(false),
  text: z.string().default(""),
  enabledAt: z.string().optional(),
  updatedAt: z.string().optional(),
  stats: AutoReplyStatsSchema.default({ sends: 0, publicReplies: 0, failures: 0, clicks: 0 }),
});
export type DefaultReply = z.infer<typeof DefaultReplySchema>;

export const AutoRepliesDocSchema = z.object({
  automations: z.array(AutoReplySchema).default([]),
  log: z.array(AutoReplyLogSchema).default([]),
  /** Pause all. */
  paused: z.boolean().default(false),
  defaultReply: DefaultReplySchema.optional(),
  /** The KV write guard today: "slow" = every five minutes, "stop" = nothing until 03:00 Riyadh. */
  guard: z.enum(["slow", "stop"]).optional(),
  /** The Instagram username the Worker read (the «تابعني» link). */
  ownerUsername: z.string().optional(),
  origin: z.string().optional(),
  igUserId: z.string().optional(),
  lastPollAt: z.string().optional(),
  lastError: z.string().optional(),
});
export type AutoRepliesDoc = z.infer<typeof AutoRepliesDocSchema>;
```

- [ ] **Step 4: Mirror the Worker's rules in `lib/replies.ts`**

1. Imports gain `type ReplyTrigger` from `./domain`. Update the header comment: comments, DMs and story replies; the
   Worker side is `replyCore.ts` + `replies.ts`.
2. Limits: delete `DM_MAX`; add after `PUBLIC_MAX`:
   ```ts
   export const PUBLIC_REPLIES_MAX = 3;
   /** Instagram: a text message "must be UTF-8 and be a 1000 bytes or less" (about 500 Arabic letters). */
   export const DM_TEXT_BYTES = 1000;
   /** The button template's text limit, in characters. */
   export const TEMPLATE_TEXT_MAX = 640;
   /** Instagram usernames are at most 30 characters; the size check counts «تابعني» with the longest one. */
   export const USERNAME_MAX = 30;
   export const FOLLOW_TITLE = "تابعني";
   ```
3. Replace `firstMatch` and `newAutoReply`:
   ```ts
   /**
    * The switched-on rule that would answer: for a comment, specific-post rules first, then "any post"; for a DM or
    * a story reply, the oldest message rule. The Worker's order.
    */
   export function firstMatch(
     text: string,
     replies: readonly AutoReply[],
     trigger: ReplyTrigger = "comment",
   ): AutoReply | undefined {
     const on = replies.filter((r) => r.enabled && r.trigger === trigger);
     if (trigger === "message") {
       return [...on]
         .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))
         .find((r) => matchesAutoReply(text, r));
     }
     return (
       on.find((r) => r.postId !== null && matchesAutoReply(text, r)) ??
       on.find((r) => r.postId === null && matchesAutoReply(text, r))
     );
   }
   ```
   ```ts
   export function newAutoReply(
     id: string = crypto.randomUUID(),
     trigger: ReplyTrigger = "comment",
   ): AutoReply {
     return AutoReplySchema.parse({ id, trigger });
   }
   ```
4. After `newAutoReply`, add the builders (the Worker's `replyCore.ts`):
   ```ts
   /* ---------- the reply as the Worker builds it (workers/scout/src/social/replyCore.ts) ---------- */

   export const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

   export const profileUrl = (username: string): string =>
     `https://www.instagram.com/${encodeURIComponent(username)}/`;

   export interface LinkButton {
     title: string;
     url: string;
   }

   /** The links (through the Worker's /go counter when its origin is known), then «تابعني» when on and known. */
   export function messageButtons(
     a: Pick<AutoReply, "id" | "buttons" | "followButton">,
     origin: string | undefined,
     username: string | undefined,
   ): LinkButton[] {
     const links = a.buttons.map((b, i) => ({
       title: b.title.trim(),
       url: origin ? `${origin}/go/${encodeURIComponent(a.id)}/${i}` : b.url.trim(),
     }));
     return a.followButton && username
       ? [...links, { title: FOLLOW_TITLE, url: profileUrl(username) }]
       : links;
   }

   /** The plain-text form: the text, then one "title: link" line per button. */
   export function textBody(text: string, buttons: readonly LinkButton[]): string {
     const lines = buttons.map((b) => `${b.title}: ${b.url}`);
     return [text.trim(), lines.join("\n")].filter(Boolean).join("\n\n");
   }

   /** Bytes left in the DM's plain-text form, counted like the Worker's `dmFits`; negative = too long. */
   export function dmBytesLeft(
     a: Pick<AutoReply, "id" | "dmText" | "buttons" | "followButton">,
     origin: string | undefined,
   ): number {
     return (
       DM_TEXT_BYTES -
       utf8Bytes(textBody(a.dmText, messageButtons(a, origin, "x".repeat(USERNAME_MAX))))
     );
   }
   ```
5. `ReplyProblemCode` gains `| "tooManyPublic" | "templateTooLong"`. Replace `replyProblems` and add
   `defaultReplyProblems`:
   ```ts
   /** What keeps a rule from being saved (the Worker's rules), plus the account state. */
   export function replyProblems(
     a: AutoReply,
     status: SocialStatusMap | null,
     origin?: string,
   ): ReplyProblem[] {
     const out: ReplyProblem[] = [];
     const keywords = a.keywords.filter((k) => normalizeForMatch(k));
     if (!keywords.length) out.push({ code: "noKeywords" });
     else if (keywords.length > KEYWORDS_MAX) out.push({ code: "tooManyKeywords" });
     else if (keywords.some((k) => k.trim().length > KEYWORD_MAX)) {
       out.push({ code: "keywordTooLong", max: KEYWORD_MAX });
     }
     const buttonCount = a.buttons.length + (a.followButton ? 1 : 0);
     if (!a.dmText.trim()) out.push({ code: "noDm" });
     else if (dmBytesLeft(a, origin) < 0) out.push({ code: "dmTooLong" });
     else if (buttonCount && a.dmText.trim().length > TEMPLATE_TEXT_MAX) {
       out.push({ code: "templateTooLong", max: TEMPLATE_TEXT_MAX });
     }
     if (a.trigger === "comment") {
       if (a.publicReplies.length > PUBLIC_REPLIES_MAX) {
         out.push({ code: "tooManyPublic", max: PUBLIC_REPLIES_MAX });
       }
       if (a.publicReplies.some((r) => r.length > PUBLIC_MAX)) {
         out.push({ code: "publicTooLong", max: PUBLIC_MAX });
       }
     }
     if (buttonCount > BUTTONS_MAX) out.push({ code: "tooManyButtons" });
     if (a.buttons.some((b) => !b.title.trim())) out.push({ code: "noTitle" });
     if (a.buttons.some((b) => !isHttps(b.url.trim()))) out.push({ code: "badUrl" });
     if (status) {
       const ig = status.instagram;
       if (!ig?.connected) out.push({ code: "notConnected" });
       else if (!ig.canReply) out.push({ code: "noPermission" });
     }
     return out;
   }

   /** What keeps the default reply from being saved (the Worker's rule). */
   export function defaultReplyProblems(d: { enabled: boolean; text: string }): ReplyProblem[] {
     const text = d.text.trim();
     if (d.enabled && !text) return [{ code: "noDm" }];
     if (utf8Bytes(text) > DM_TEXT_BYTES) return [{ code: "dmTooLong" }];
     return [];
   }
   ```
   (`isHttps` must now be declared above `replyProblems`, as it is today.)
6. `dmPreview` becomes `textBody(a.dmText, messageButtons(a, origin, undefined))` (its signature gains
   `"followButton"` in the `Pick`); Task 7 deletes it.
7. Replace `replyInput`:
   ```ts
   /** The `POST /social/replies` body: what the owner typed, tidied; the Worker keeps its own counters. */
   export function replyInput(a: AutoReply): Record<string, unknown> {
     const onPost = a.trigger === "comment";
     return {
       id: a.id,
       enabled: a.enabled,
       trigger: a.trigger,
       postId: onPost ? a.postId : null,
       ...(onPost && a.permalink ? { permalink: a.permalink } : {}),
       ...(onPost && a.title ? { title: a.title } : {}),
       ...(onPost && a.thumbUrl ? { thumbUrl: a.thumbUrl } : {}),
       keywords: a.keywords.map((k) => k.trim()).filter((k) => normalizeForMatch(k)),
       match: a.match,
       publicReplies: onPost ? a.publicReplies.map((r) => r.trim()).filter(Boolean) : [],
       dmText: a.dmText.trim(),
       buttons: a.buttons.map((b) => ({ title: b.title.trim(), url: b.url.trim() })),
       followButton: a.followButton,
     };
   }
   ```
8. After `repliesDelete`, add:
   ```ts
   export interface RepliesSettings {
     paused?: boolean;
     defaultReply?: { enabled: boolean; text: string };
   }

   /** `POST /social/replies/settings`: pause all, or the default reply; answers with the fresh document. */
   export async function repliesSettings(
     config: ScoutConfig | null,
     settings: RepliesSettings,
     opts: SocialSyncOpts = {},
   ): Promise<SocialResult<{ doc: AutoRepliesDoc }>> {
     if (!config) return { ok: false, error: { type: "unconfigured" } };
     const r = await call(config, "/social/replies/settings", jsonPost(settings), opts);
     if (!r.ok) return r;
     const doc = parseRepliesDoc(r.data);
     return doc ? { ok: true, doc } : { ok: false, error: { type: "upstream" } };
   }
   ```

- [ ] **Step 5: `saveSettings` in `useReplies.ts`**

Import `repliesSettings` and `type RepliesSettings` from `@/lib/replies`, and add after `deleteReply`:

```ts
/** Pause all, or the default reply; the document comes back fresh from the Worker. */
export async function saveSettings(settings: RepliesSettings): Promise<boolean> {
  const cfg = currentConfig();
  if (!cfg) return fail({ type: "unconfigured" });
  set({ busy: true, error: null });
  const r = await repliesSettings(cfg, settings);
  if (!r.ok) return fail(r.error);
  set({ doc: r.doc, busy: false, loadedAt: Date.now() });
  return true;
}
```

- [ ] **Step 6: Keep the v1 builder compiling, and the two problem messages**

In `components/social/replies/AutoReplyForm.tsx`:
- import `dmBytesLeft` instead of `DM_MAX`; the counter `{draft.dmText.length}/{DM_MAX}` becomes
  `{dmBytesLeft(current, origin)}`;
- the public-reply textarea reads `value={draft.publicReplies[0] ?? ""}` and writes
  `onChange={(e) => patch({ publicReplies: e.target.value ? [e.target.value] : [] })}`;
- `replyProblems(current, status)` becomes `replyProblems(current, status, origin)`;
- `PROBLEM_KEY` gains `tooManyPublic: "replies.problem.tooManyPublic"` and
  `templateTooLong: "replies.problem.templateTooLong"`.

In `messages/replies.ar.json` replace `"replies.problem.dmTooLong"` and add two keys:
```json
"replies.problem.dmTooLong": "الرسالة أطول من حد إنستقرام (تقريباً 500 حرف عربي مع الروابط).",
"replies.problem.templateTooLong": "مع الأزرار، الرسالة لازم تكون {max} حرف أو أقل.",
"replies.problem.tooManyPublic": "ثلاث ردود عامة بالكثير.",
```
In `messages/replies.en.json`:
```json
"replies.problem.dmTooLong": "The message is longer than Instagram allows (about 1,000 English letters, 500 Arabic, with the links).",
"replies.problem.templateTooLong": "With buttons, the message must be {max} characters or fewer.",
"replies.problem.tooManyPublic": "Three public replies at most.",
```
(`tooManyPublic` takes no `{max}`: the number is in the copy.)

- [ ] **Step 7: Run the tests, typecheck and lint**

Run: `pnpm.cmd exec vitest run lib/ components/ messages/` then `pnpm.cmd typecheck` and `pnpm.cmd lint`
Expected: all PASS, clean.

- [ ] **Step 8: Commit**

```bash
git add lib/domain.ts lib/replies.ts lib/replies.test.ts components/social/useReplies.ts components/social/replies/AutoReplyForm.tsx messages/replies.ar.json messages/replies.en.json
git commit -m "Auto replies v2 dashboard: schemas, mirrored rules and the settings call" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Dashboard — the Beacons-style rules page, the default reply, the sidebar link

**Files:**
- Rewrite: `components/social/AutoRepliesScreen.tsx`
- Create: `components/social/replies/RulesTable.tsx`
- Create: `components/social/replies/DefaultReplyEditor.tsx`
- Modify: `components/shell/nav.ts`, `components/shell/nav.test.ts`
- Modify: `messages/replies.ar.json`, `messages/replies.en.json`, `messages/ar.json`, `messages/en.json`
- Modify: `e2e/autoreplies.spec.ts`

**Interfaces:**
- Consumes (Task 5): `AutoReply`, `AutoReplyLog`, `DefaultReply`, `ReplyTrigger`, `AutoRepliesDoc.paused / guard /
  defaultReply / ownerUsername`; `firstMatch(text, replies, trigger)`, `newAutoReply`, `ctr`, `FOLLOW_TITLE`,
  `DM_TEXT_BYTES`, `utf8Bytes`, `defaultReplyProblems`, `ReplyProblemCode`; `saveReply`, `deleteReply`,
  `checkReplies`, `saveSettings`, `useReplies`. The rule editor is still v1's `AutoReplyForm` (Task 7 replaces it).
- Produces: `RulesTable` props `{ automations, defaultReply, busy, errorText, onToggle, onEdit, onDelete,
  onToggleDefault, onEditDefault }`; `DefaultReplyEditor` props `{ value, busy, onSave, onCancel }`. Test ids used
  later: `autoreplies-screen`, `autoreplies-new`, `autoreplies-can-reply` (with `data-status`), `autoreplies-pause`,
  `autoreply-row` (`data-id`, `data-enabled`; on the table row **and** the phone card, select with `:visible`),
  `autoreply-default-row`, `autoreply-toggle`, `autoreply-menu` (the ⋯ summary), `autoreply-edit`,
  `autoreply-delete`, `autoreplies-tester-open`, `editor-back`, `default-reply-*`. Copy keys `replies.back`,
  `replies.saveChanges`, `replies.lettersLeft`, `replies.lettersOver` (Task 7 reuses them).

- [ ] **Step 1: The copy**

In `messages/replies.ar.json` change these values:
```json
"replies.hub.sub": "لما أحد يعلّق أو يرسل لك كلمة معيّنة في إنستقرام، نرد عليه ونرسل له الرابط على الخاص بنفسنا.",
"replies.autoNote": "نفحص التعليقات والرسائل كل دقيقة، ونرد على الجديد بس.",
"replies.new": "+ رد تلقائي جديد",
"replies.checkNow": "🔄 افحص الآن",
"replies.tester.title": "جرّب كلمة",
"replies.tester.placeholder": "اكتب تعليق أو رسالة تجريبية…",
```
and add:
```json
"replies.status.live": "يرد بنفسه · يفحص كل دقيقة",
"replies.status.paused": "موقّف",
"replies.status.slow": "اليوم نفحص كل 5 دقايق (حد التخزين المجاني)",
"replies.status.stop": "وقفنا لين 3 الفجر (حد التخزين المجاني)",
"replies.pauseAll": "إيقاف كل الردود",
"replies.rules.title": "الردود الشغّالة",
"replies.table.content": "المحتوى",
"replies.table.message": "الرسالة",
"replies.table.destination": "الوجهة",
"replies.table.active": "شغّال",
"replies.table.more": "خيارات",
"replies.table.messages": "الخاص والستوري",
"replies.table.default": "الرد الافتراضي",
"replies.table.anyMessage": "أي رسالة",
"replies.tester.comment": "تعليق",
"replies.tester.message": "رسالة",
"replies.log.kind.comment": "تعليق",
"replies.log.kind.message": "رسالة",
"replies.log.kind.story": "رد على ستوري",
"replies.log.kind.default": "رد افتراضي",
"replies.default.title": "الرد الافتراضي",
"replies.default.hint": "لما أحد يرسل لك رسالة ما فيها أي كلمة من الردود. مرة وحدة باليوم لكل شخص، وما يرد على الستوري ولا الإيموجي ولا لما ترد أنت بنفسك.",
"replies.default.suggested": "وصلت رسالتك 🙏 برد عليك أول ما أقدر.",
"replies.back": "→ رجوع",
"replies.saveChanges": "حفظ التغييرات",
"replies.lettersLeft": "باقي تقريباً {n} حرف",
"replies.lettersOver": "زادت تقريباً {n} حرف",
```
In `messages/replies.en.json` the same keys:
```json
"replies.hub.sub": "When someone comments or DMs you a keyword on Instagram, we reply and send them the link in a DM by ourselves.",
"replies.autoNote": "We check comments and messages every minute and answer only new ones.",
"replies.new": "+ New auto reply",
"replies.checkNow": "🔄 Check now",
"replies.tester.title": "Try a word",
"replies.tester.placeholder": "Type a test comment or message…",
"replies.status.live": "Replying · checks every minute",
"replies.status.paused": "Paused",
"replies.status.slow": "Checking every 5 minutes today (free storage limit)",
"replies.status.stop": "Stopped until 03:00 (free storage limit)",
"replies.pauseAll": "Pause all replies",
"replies.rules.title": "Active auto replies",
"replies.table.content": "Content",
"replies.table.message": "Message",
"replies.table.destination": "Destination",
"replies.table.active": "Active",
"replies.table.more": "Options",
"replies.table.messages": "DMs and stories",
"replies.table.default": "Default reply",
"replies.table.anyMessage": "Any message",
"replies.tester.comment": "Comment",
"replies.tester.message": "Message",
"replies.log.kind.comment": "Comment",
"replies.log.kind.message": "Message",
"replies.log.kind.story": "Story reply",
"replies.log.kind.default": "Default reply",
"replies.default.title": "Default reply",
"replies.default.hint": "When someone DMs you without any of your keywords. Once a day per person; never for story replies, emoji-only messages, or chats you're answering yourself.",
"replies.default.suggested": "Got your message 🙏 I'll reply as soon as I can.",
"replies.back": "← Back",
"replies.saveChanges": "Save changes",
"replies.lettersLeft": "About {n} Arabic letters left",
"replies.lettersOver": "About {n} Arabic letters too long",
```
In `messages/ar.json` add `"nav.replies": "الردود التلقائية",` next to `"nav.automations"`; in `messages/en.json`
`"nav.replies": "Auto replies",`.

- [ ] **Step 2: The sidebar link (test first)**

In `components/shell/nav.test.ts` add `"/social/replies/",` to the list of Social paths and a test:
```ts
  it("lists 💬 Auto replies in the Social desktop sidebar, before the last three", () => {
    expect(SOCIAL_NAV_ITEMS.find((i) => i.href === "/social/replies")).toEqual({
      href: "/social/replies",
      icon: "💬",
      label: "nav.replies",
      desktopOnly: true,
    });
    expect(activeHref(SOCIAL_NAV_ITEMS, "/social/replies/")).toBe("/social/replies");
  });
```
Run `pnpm.cmd exec vitest run components/shell/nav.test.ts` (FAIL), then in `components/shell/nav.ts` insert before the
`/social/automations` item:
```ts
  { href: "/social/replies", icon: "💬", label: "nav.replies", desktopOnly: true },
```
and mention "💬 Auto replies" in the comment above `SOCIAL_NAV_ITEMS`. Run again: PASS (the "last three" test still
holds).

- [ ] **Step 3: Write the failing e2e changes**

In `e2e/autoreplies.spec.ts`:

1. The fake's `Automation` interface: replace `publicReply: string;` with
   `trigger: string; publicReplies: string[]; followButton: boolean;`.
2. `Fake` gains `paused: boolean; defaultReply?: { enabled: boolean; text: string; stats: Automation["stats"] };
   settings: Record<string, unknown>[];` (initialise `paused: false, settings: []`), and `doc()` returns
   additionally `paused: fake.paused, ...(fake.defaultReply ? { defaultReply: fake.defaultReply } : {}),
   ownerUsername: "3z.prod",`.
3. Before the `/social/replies/poll` branch, add:
   ```ts
   if (url.pathname === "/social/replies/settings" && req.method() === "POST") {
     const body = JSON.parse(req.postData() || "{}") as {
       paused?: boolean;
       defaultReply?: { enabled: boolean; text: string };
     };
     fake.settings.push(body);
     if (typeof body.paused === "boolean") fake.paused = body.paused;
     if (body.defaultReply) {
       fake.defaultReply = {
         ...body.defaultReply,
         stats: fake.defaultReply?.stats ?? { sends: 0, publicReplies: 0, failures: 0, clicks: 0 },
       };
     }
     return json(doc());
   }
   ```
4. In the big test:
   - the saved body expectation: replace `publicReply: "أرسلته لك على الخاص 🎬",` with
     `trigger: "comment", publicReplies: ["أرسلته لك على الخاص 🎬"], followButton: false,`;
   - `const row = page.locator(\`[data-testid="autoreply-row"][data-id="${id}"]:visible\`);`
   - before filling the tester: `await page.getByTestId("autoreplies-tester-open").click();`
   - delete through the ⋯ menu: `await row.getByTestId("autoreply-menu").click();` then
     `await row.getByTestId("autoreply-delete").click();`.
5. Add two tests at the end:

```ts
test("pause all, and the default reply with its size check", async ({ page }) => {
  const fake = await stubWorker(page);
  fake.status.instagram = { ...fake.status.instagram, canReply: true };
  await freshState(page, "/settings/");
  await connectWorker(page);
  await page.goto("/social/replies/");
  const status = page.getByTestId("autoreplies-can-reply");
  await expect(status).toHaveAttribute("data-status", "live");

  await page.getByTestId("autoreplies-pause").click();
  await expect.poll(() => fake.settings.at(-1)).toEqual({ paused: true });
  await expect(status).toHaveAttribute("data-status", "paused");

  // The default reply is off until it has a text; switching it on opens its editor with a suggestion.
  const row = page.locator('[data-testid="autoreply-default-row"]:visible');
  await expect(row).toHaveAttribute("data-enabled", "false");
  await row.getByTestId("autoreply-toggle").click();
  await expect(page.getByTestId("default-reply-editor")).toBeVisible();
  await expect(page.getByTestId("default-reply-text")).not.toHaveValue("");
  await page.getByTestId("default-reply-text").fill("ل".repeat(501));
  await expect(page.getByTestId("default-reply-left")).toContainText("1");
  await page.getByTestId("default-reply-save").click();
  await expect(page.getByTestId("default-reply-problems")).toBeVisible();
  expect(fake.settings).toHaveLength(1);
  await page.getByTestId("default-reply-text").fill("وصلت رسالتك 🙏");
  await page.getByTestId("default-reply-save").click();
  await expect
    .poll(() => fake.settings.at(-1))
    .toEqual({ defaultReply: { enabled: true, text: "وصلت رسالتك 🙏" } });
  await expect(row).toHaveAttribute("data-enabled", "true");
  expect(await fitsViewport(page)).toBe(true);
});

test("desktop: 💬 Auto replies is in the Social sidebar", async ({ page, isMobile }) => {
  test.skip(isMobile, "the sidebar is desktop only");
  await freshState(page, "/social/growth/");
  const link = page.getByTestId("sidenav").locator('a[href="/social/replies/"]');
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/social\/replies\/$/);
  await expect(page.getByTestId("autoreplies-screen")).toBeVisible();
});
```

Run: `pnpm.cmd e2e e2e/autoreplies.spec.ts` (with `E2E_PORT=3127` set in the environment if needed)
Expected: FAIL (no pause switch, no default row, no tester summary, …).

- [ ] **Step 4: `RulesTable.tsx`**

```tsx
"use client";

import type { AutoReply, DefaultReply } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { ctr, FOLLOW_TITLE } from "@/lib/replies";

/**
 * The rules, Beacons style: a table on wide screens and cards on phones. Both are rendered (CSS hides one) and share
 * test ids, so tests select the visible one. Columns: content, message, keywords, destination, sends, clicks, click
 * rate, on/off and a ⋯ menu. The default reply is always the last row.
 */
export default function RulesTable({
  automations,
  defaultReply,
  busy,
  errorText,
  onToggle,
  onEdit,
  onDelete,
  onToggleDefault,
  onEditDefault,
}: {
  automations: readonly AutoReply[];
  defaultReply: DefaultReply | undefined;
  busy: boolean;
  errorText: (code: string | undefined) => string;
  onToggle: (a: AutoReply) => void;
  onEdit: (a: AutoReply) => void;
  onDelete: (a: AutoReply) => void;
  onToggleDefault: () => void;
  onEditDefault: () => void;
}) {
  const { t } = useT();
  const d = defaultReply;

  const content = (a: AutoReply) =>
    a.trigger === "message"
      ? t("replies.table.messages")
      : a.postId
        ? (a.title ?? t("replies.table.post"))
        : t("replies.form.anyPost");
  const destination = (a: AutoReply) => a.buttons[0]?.title ?? (a.followButton ? FOLLOW_TITLE : "—");
  const rate = (a: AutoReply) => {
    const r = ctr(a.stats.sends, a.stats.clicks);
    return r === null ? "–" : `${r}%`;
  };
  const thumb = (a: AutoReply) =>
    a.thumbUrl ? (
      // eslint-disable-next-line @next/next/no-img-element -- Instagram CDN thumbnail, expires; no loader
      <img src={a.thumbUrl} alt="" className="h-9 w-9 flex-none rounded object-cover" />
    ) : (
      <span aria-hidden className="w-9 flex-none text-center text-lg">
        {a.trigger === "message" ? "💬" : a.postId ? "📌" : "📣"}
      </span>
    );
  const toggle = (checked: boolean, onChange: () => void, label: string) => (
    <input
      type="checkbox"
      role="switch"
      aria-label={label}
      checked={checked}
      disabled={busy}
      onChange={onChange}
      data-testid="autoreply-toggle"
    />
  );
  const menu = (edit: () => void, remove?: () => void) => (
    <details className="relative">
      <summary
        className="px-btn px-btn-ghost px-btn-sm cursor-pointer list-none"
        aria-label={t("replies.table.more")}
        data-testid="autoreply-menu"
      >
        ⋯
      </summary>
      <div className="px-card absolute end-0 z-10 mt-1 flex min-w-24 flex-col gap-1 p-1">
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm"
          disabled={busy}
          onClick={edit}
          data-testid="autoreply-edit"
        >
          {t("replies.edit")}
        </button>
        {remove && (
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            disabled={busy}
            onClick={remove}
            data-testid="autoreply-delete"
          >
            {t("replies.delete")}
          </button>
        )}
      </div>
    </details>
  );
  const chips = (a: AutoReply) => (
    <div className="flex flex-wrap gap-1">
      {a.keywords.map((k) => (
        <span key={k} className="px-chip text-xs" data-testid="autoreply-keyword">
          {k}
        </span>
      ))}
    </div>
  );
  const lastError = (a: AutoReply) =>
    a.stats.lastError ? (
      <span className="text-danger block text-xs" data-testid="autoreply-last-error">
        {errorText(a.stats.lastError)}
      </span>
    ) : null;

  return (
    <>
      <table className="hidden w-full table-fixed text-sm md:table" data-testid="autoreplies-table">
        <thead className="text-muted text-xs">
          <tr>
            <th className="w-[22%] p-2 text-start font-normal">{t("replies.table.content")}</th>
            <th className="w-[24%] p-2 text-start font-normal">{t("replies.table.message")}</th>
            <th className="p-2 text-start font-normal">{t("replies.table.keywords")}</th>
            <th className="p-2 text-start font-normal">{t("replies.table.destination")}</th>
            <th className="w-16 p-2 text-start font-normal">{t("replies.table.sends")}</th>
            <th className="w-16 p-2 text-start font-normal">{t("replies.table.clicks")}</th>
            <th className="w-16 p-2 text-start font-normal">{t("replies.table.ctr")}</th>
            <th className="w-14 p-2 text-start font-normal">{t("replies.table.active")}</th>
            <th className="w-12 p-2">
              <span className="sr-only">{t("replies.table.more")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {automations.map((a) => (
            <tr
              key={a.id}
              className="border-edge border-t align-middle"
              data-testid="autoreply-row"
              data-id={a.id}
              data-enabled={a.enabled}
            >
              <td className="p-2">
                <div className="flex min-w-0 items-center gap-2">
                  {thumb(a)}
                  <span className="truncate">{content(a)}</span>
                </div>
              </td>
              <td className="p-2">
                <span className="block truncate" dir="auto">
                  {a.dmText}
                </span>
                {lastError(a)}
              </td>
              <td className="p-2">{chips(a)}</td>
              <td className="truncate p-2">{destination(a)}</td>
              <td className="num p-2" data-testid="autoreply-sends">
                {a.stats.sends}
              </td>
              <td className="num p-2" data-testid="autoreply-clicks">
                {a.stats.clicks}
              </td>
              <td className="num p-2" data-testid="autoreply-ctr">
                {rate(a)}
              </td>
              <td className="p-2">{toggle(a.enabled, () => onToggle(a), t("replies.form.enabled"))}</td>
              <td className="p-2">{menu(() => onEdit(a), () => onDelete(a))}</td>
            </tr>
          ))}
          <tr
            className="border-edge border-t align-middle"
            data-testid="autoreply-default-row"
            data-enabled={!!d?.enabled}
          >
            <td className="p-2">
              <div className="flex items-center gap-2">
                <span aria-hidden className="w-9 flex-none text-center text-lg">
                  🕒
                </span>
                <span className="truncate">{t("replies.table.default")}</span>
              </div>
            </td>
            <td className="truncate p-2" dir="auto">
              {d?.text || "—"}
            </td>
            <td className="text-muted p-2 text-xs">{t("replies.table.anyMessage")}</td>
            <td className="text-muted p-2">—</td>
            <td className="num p-2" data-testid="autoreply-sends">
              {d?.stats.sends ?? 0}
            </td>
            <td className="text-muted p-2">—</td>
            <td className="text-muted p-2">—</td>
            <td className="p-2">{toggle(!!d?.enabled, onToggleDefault, t("replies.table.default"))}</td>
            <td className="p-2">{menu(onEditDefault)}</td>
          </tr>
        </tbody>
      </table>

      <ul className="flex flex-col gap-2 md:hidden" data-testid="autoreplies-cards">
        {automations.map((a) => (
          <li
            key={a.id}
            className="px-inset flex flex-col gap-1.5"
            data-testid="autoreply-row"
            data-id={a.id}
            data-enabled={a.enabled}
          >
            <div className="flex items-center gap-2">
              {thumb(a)}
              <b className="min-w-0 flex-1 truncate text-sm">{content(a)}</b>
              {toggle(a.enabled, () => onToggle(a), t("replies.form.enabled"))}
              {menu(() => onEdit(a), () => onDelete(a))}
            </div>
            <p className="text-ink-2 truncate text-xs" dir="auto">
              {a.dmText}
            </p>
            {chips(a)}
            <div className="text-muted num flex flex-wrap items-center gap-3 text-xs">
              <span>
                {t("replies.table.sends")} <b data-testid="autoreply-sends">{a.stats.sends}</b>
              </span>
              <span>
                {t("replies.table.clicks")} <b data-testid="autoreply-clicks">{a.stats.clicks}</b>
              </span>
              <span>
                {t("replies.table.ctr")} <b data-testid="autoreply-ctr">{rate(a)}</b>
              </span>
              {lastError(a)}
            </div>
          </li>
        ))}
        <li
          className="px-inset flex flex-col gap-1.5"
          data-testid="autoreply-default-row"
          data-enabled={!!d?.enabled}
        >
          <div className="flex items-center gap-2">
            <span aria-hidden className="w-9 flex-none text-center text-lg">
              🕒
            </span>
            <b className="min-w-0 flex-1 truncate text-sm">{t("replies.table.default")}</b>
            {toggle(!!d?.enabled, onToggleDefault, t("replies.table.default"))}
            {menu(onEditDefault)}
          </div>
          <p className="text-ink-2 truncate text-xs" dir="auto">
            {d?.text || "—"}
          </p>
          <div className="text-muted num text-xs">
            {t("replies.table.sends")} <b data-testid="autoreply-sends">{d?.stats.sends ?? 0}</b>
          </div>
        </li>
      </ul>
    </>
  );
}
```

If `border-edge` is not a Tailwind color in this project, use `border-[var(--edge)]` (check `app/globals.css` for the
`--color-edge` theme token).

- [ ] **Step 5: `DefaultReplyEditor.tsx`**

```tsx
"use client";

import { useState } from "react";
import type { DefaultReply } from "@/lib/domain";
import { useT, type MessageKey } from "@/lib/i18n";
import { defaultReplyProblems, DM_TEXT_BYTES, utf8Bytes, type ReplyProblemCode } from "@/lib/replies";

const PROBLEM_KEY: Partial<Record<ReplyProblemCode, MessageKey>> = {
  noDm: "replies.problem.noDm",
  dmTooLong: "replies.problem.dmTooLong",
};

/** The default reply, full page: on/off and its text (DMs that match no rule; once a day per person). */
export default function DefaultReplyEditor({
  value,
  busy,
  onSave,
  onCancel,
}: {
  value: DefaultReply | undefined;
  busy: boolean;
  onSave: (d: { enabled: boolean; text: string }) => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const [enabled, setEnabled] = useState(value?.enabled ?? true);
  const [text, setText] = useState(value?.text || t("replies.default.suggested"));
  const [tried, setTried] = useState(false);
  const problems = defaultReplyProblems({ enabled, text });
  const left = DM_TEXT_BYTES - utf8Bytes(text.trim());
  const letters = Math.trunc(Math.abs(left) / 2);

  const submit = () => {
    setTried(true);
    if (!problems.length) onSave({ enabled, text: text.trim() });
  };

  return (
    <form
      className="flex flex-col gap-4"
      data-testid="default-reply-editor"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="px-btn px-btn-ghost px-btn-sm" onClick={onCancel} data-testid="editor-back">
          {t("replies.back")}
        </button>
        <h1 className="text-xl">{t("replies.default.title")}</h1>
        <button
          type="submit"
          className="px-btn px-btn-primary ms-auto"
          disabled={busy}
          data-testid="default-reply-save"
        >
          {t("replies.saveChanges")}
        </button>
      </div>
      <section className="px-card flex flex-col gap-3">
        <p className="text-ink-2 text-sm">{t("replies.default.hint")}</p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            role="switch"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            data-testid="default-reply-enabled"
          />
          {t("replies.form.enabled")}
        </label>
        <label className="flex flex-col gap-1">
          <span className="flex items-center gap-2 text-sm font-bold">
            <span className="text-ink-2">{t("replies.form.dm")}</span>
            <span
              className={`num ms-auto text-xs font-normal ${left < 0 ? "text-danger" : "text-muted"}`}
              data-testid="default-reply-left"
            >
              {t(left < 0 ? "replies.lettersOver" : "replies.lettersLeft", { n: letters })}
            </span>
          </span>
          <textarea
            className="px-input min-h-24"
            dir="auto"
            value={text}
            onChange={(e) => setText(e.target.value)}
            data-testid="default-reply-text"
          />
        </label>
        {tried && problems.length > 0 && (
          <ul className="text-danger flex flex-col gap-0.5 text-xs" data-testid="default-reply-problems">
            {problems.map((p) => (
              <li key={p.code}>{t(PROBLEM_KEY[p.code] ?? "replies.problem.noDm")}</li>
            ))}
          </ul>
        )}
      </section>
    </form>
  );
}
```

- [ ] **Step 6: Rewrite `AutoRepliesScreen.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import type { AutoReply, AutoReplyLog, ReplyTrigger } from "@/lib/domain";
import { useT, type MessageKey } from "@/lib/i18n";
import { firstMatch, newAutoReply } from "@/lib/replies";
import { timeAgo } from "@/lib/socialSync";
import { postStatsFor, useStore } from "@/store";
import { formatInstant } from "./calendar/dates";
import AutoReplyForm from "./replies/AutoReplyForm";
import DefaultReplyEditor from "./replies/DefaultReplyEditor";
import RulesTable from "./replies/RulesTable";
import { checkReplies, deleteReply, saveReply, saveSettings, useReplies } from "./useReplies";
import { useSocialSync } from "./useSocialSync";

/** Worker error codes → copy (the log's `error`, the document's `lastError`). */
const ERROR_KEY: Record<string, MessageKey> = {
  not_connected: "replies.err.notConnected",
  no_permission: "replies.err.noPermission",
  token_expired: "replies.err.tokenExpired",
  rate_limited: "replies.err.rateLimited",
  rejected: "replies.err.rejected",
  upstream: "replies.err.upstream",
  not_eligible: "replies.err.notEligible",
};

const errorText = (t: (k: MessageKey) => string, code: string | undefined) =>
  code ? t(ERROR_KEY[code] ?? "replies.err.upstream") : "";

type Editing = { kind: "rule"; rule: AutoReply } | { kind: "default" } | null;

/**
 * 💬 Auto replies, Beacons style (round 34, planning/tools/14-auto-replies-v2.md): the account with its permission,
 * status and pause switch; the rules table (comment rules, DM and story rules, the default reply) with sends and
 * clicks; a tester and the log folded underneath; a full-page editor. Everything is read from and written to the
 * Scout Worker (`useReplies`), which answers every minute.
 */
export default function AutoRepliesScreen() {
  const { t, lang } = useT();
  const { configured, status, busy: accountBusy, connect } = useSocialSync({ auto: true });
  const { doc, busy, error } = useReplies();
  const postStats = useStore((s) => s.socialPostStats);
  const posts = useMemo(() => postStatsFor({ socialPostStats: postStats }, "instagram"), [postStats]);
  const [editing, setEditing] = useState<Editing>(null);
  const [pendingDelete, setPendingDelete] = useState<AutoReply | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const ig = status?.instagram;
  const automations = doc?.automations ?? [];
  const username = doc?.ownerUsername ?? ig?.handle;
  const state: "paused" | "stop" | "slow" | "live" = doc?.paused
    ? "paused"
    : doc?.guard === "stop"
      ? "stop"
      : doc?.guard === "slow"
        ? "slow"
        : "live";

  const saved = () => setNotice(t("replies.notice.saved"));
  const saveRule = async (a: AutoReply) => {
    setNotice(null);
    if (await saveReply(a)) {
      setEditing(null);
      saved();
    }
  };
  const saveDefault = async (d: { enabled: boolean; text: string }) => {
    setNotice(null);
    if (await saveSettings({ defaultReply: d })) {
      setEditing(null);
      saved();
    }
  };
  /** A row's On/Off: never touches an open editor. */
  const toggle = async (a: AutoReply) => {
    setNotice(null);
    if (await saveReply({ ...a, enabled: !a.enabled })) saved();
  };
  /** The default reply's On/Off; without a text yet it opens the editor instead. */
  const toggleDefault = async () => {
    const d = doc?.defaultReply;
    if (!d?.text) return setEditing({ kind: "default" });
    setNotice(null);
    if (await saveSettings({ defaultReply: { enabled: !d.enabled, text: d.text } })) saved();
  };
  const togglePause = async () => {
    setNotice(null);
    await saveSettings({ paused: !doc?.paused });
  };
  const remove = async () => {
    const a = pendingDelete;
    setPendingDelete(null);
    if (!a) return;
    if (await deleteReply(a.id)) setNotice(t("replies.notice.deleted"));
  };
  const check = async () => {
    setNotice(null);
    const r = await checkReplies();
    if (!r) return;
    setNotice(
      r.skipped === "locked"
        ? t("replies.notice.busy")
        : t("replies.notice.checked", { n: r.checked, sent: r.sent }),
    );
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-4" data-testid="autoreplies-screen">
        {editing.kind === "default" ? (
          <DefaultReplyEditor
            value={doc?.defaultReply}
            busy={busy}
            onSave={(d) => void saveDefault(d)}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <AutoReplyForm
            key={editing.rule.id}
            value={editing.rule}
            posts={posts}
            status={status}
            origin={doc?.origin}
            busy={busy}
            onSave={(a) => void saveRule(a)}
            onCancel={() => setEditing(null)}
          />
        )}
        {error && (
          <p role="alert" className="text-danger text-xs" data-testid="autoreplies-error">
            {t(error)}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="autoreplies-screen">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl">{t("replies.hub.title")}</h1>
        <p className="text-ink-2 text-sm">{t("replies.hub.sub")}</p>
      </header>

      <section className="px-card flex flex-col gap-2" data-testid="autoreplies-account">
        {!configured ? (
          <p className="text-ink-2 text-sm" data-testid="autoreplies-need-worker">
            {t("replies.needWorker")}{" "}
            <Link href="/settings#accounts" className="px-link">
              {t("replies.needWorkerLink")}
            </Link>
          </p>
        ) : !ig?.connected ? (
          <p className="text-ink-2 text-sm" data-testid="autoreplies-need-ig">
            {t("replies.needIg")}{" "}
            <Link href="/settings#accounts" className="px-link">
              {t("replies.needWorkerLink")}
            </Link>
          </p>
        ) : !ig.canReply ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-ink-2 min-w-0 flex-1 text-sm" data-testid="autoreplies-need-permission">
              {t("replies.needPermission")}
            </p>
            <button
              type="button"
              className="px-btn px-btn-sm"
              disabled={accountBusy}
              onClick={() => void connect("instagram", true, true)}
              data-testid="autoreplies-allow"
            >
              {t("replies.allow")}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span
              aria-hidden
              className="grid h-9 w-9 flex-none place-items-center rounded-full border text-sm font-bold"
            >
              {(username ?? "?").slice(0, 1).toUpperCase()}
            </span>
            <b className="text-sm" dir="ltr">
              @{username ?? "instagram"}
            </b>
            <span
              className={`px-chip text-xs ${state === "live" ? "px-chip-green" : ""}`}
              data-testid="autoreplies-can-reply"
              data-status={state}
            >
              {t(`replies.status.${state}`)}
            </span>
            {doc?.lastPollAt && (
              <span className="text-muted text-xs">
                {t("replies.lastCheck", { ago: timeAgo(doc.lastPollAt, lang) })}
              </span>
            )}
            <button
              type="button"
              className="px-btn px-btn-ghost px-btn-sm"
              disabled={busy}
              aria-busy={busy}
              onClick={() => void check()}
              data-testid="autoreplies-check"
            >
              {t("replies.checkNow")}
            </button>
            <label className="ms-auto flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                role="switch"
                checked={!!doc?.paused}
                disabled={busy || !doc}
                onChange={() => void togglePause()}
                data-testid="autoreplies-pause"
              />
              {t("replies.pauseAll")}
            </label>
          </div>
        )}
        {doc?.lastError && (
          <p className="text-danger text-xs" data-testid="autoreplies-last-error">
            {errorText(t, doc.lastError)}
          </p>
        )}
        {error && (
          <p role="alert" className="text-danger text-xs" data-testid="autoreplies-error">
            {t(error)}
          </p>
        )}
        {notice && (
          <p className="text-ink-2 text-xs" data-testid="autoreplies-notice">
            {notice}
          </p>
        )}
      </section>

      <section className="px-card flex flex-col gap-3" data-testid="autoreplies-list">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base">{t("replies.rules.title")}</h2>
          {configured && (
            <button
              type="button"
              className="px-btn px-btn-sm ms-auto"
              disabled={busy}
              onClick={() => setEditing({ kind: "rule", rule: newAutoReply() })}
              data-testid="autoreplies-new"
            >
              {t("replies.new")}
            </button>
          )}
        </div>
        {doc === null ? (
          configured &&
          busy &&
          !error && (
            <p className="text-muted text-sm" aria-busy data-testid="autoreplies-loading">
              {t("replies.loading")}
            </p>
          )
        ) : (
          <>
            {automations.length === 0 && (
              <p className="text-ink-2 text-sm" data-testid="autoreplies-empty">
                {t("replies.empty")}
              </p>
            )}
            <RulesTable
              automations={automations}
              defaultReply={doc.defaultReply}
              busy={busy}
              errorText={(code) => errorText(t, code)}
              onToggle={(a) => void toggle(a)}
              onEdit={(a) => setEditing({ kind: "rule", rule: a })}
              onDelete={setPendingDelete}
              onToggleDefault={() => void toggleDefault()}
              onEditDefault={() => setEditing({ kind: "default" })}
            />
          </>
        )}
      </section>

      {automations.length > 0 && <Tester automations={automations} />}

      {doc && doc.log.length > 0 && (
        <details className="px-card" data-testid="autoreplies-log">
          <summary className="cursor-pointer text-base">{t("replies.log.title")}</summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {doc.log.map((e) => (
              <LogRow key={`${e.messageId ?? e.commentId}-${e.at}`} e={e} />
            ))}
          </ul>
        </details>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={t("replies.deleteTitle")}
          body={t("replies.deleteBody")}
          confirmLabel={t("replies.delete")}
          danger
          onConfirm={() => void remove()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

/** "Would this comment or message get an answer?", with the Worker's matcher and order. */
function Tester({ automations }: { automations: readonly AutoReply[] }) {
  const { t } = useT();
  const [sample, setSample] = useState("");
  const [trigger, setTrigger] = useState<ReplyTrigger>("comment");
  const match = sample.trim() ? firstMatch(sample, automations, trigger) : undefined;
  return (
    <details className="px-card" data-testid="autoreplies-tester">
      <summary className="cursor-pointer text-base" data-testid="autoreplies-tester-open">
        {t("replies.tester.title")}
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <div className="cal-tabs self-start" role="radiogroup" aria-label={t("replies.tester.title")}>
          {(["comment", "message"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              className="cal-tab"
              aria-checked={trigger === k}
              onClick={() => setTrigger(k)}
              data-testid={`autoreplies-tester-${k}`}
            >
              {t(`replies.tester.${k}`)}
            </button>
          ))}
        </div>
        <input
          type="text"
          className="px-input"
          autoComplete="off"
          placeholder={t("replies.tester.placeholder")}
          value={sample}
          onChange={(e) => setSample(e.target.value)}
          data-testid="autoreplies-tester-input"
        />
        {sample.trim() && (
          <p
            className={`text-xs ${match ? "text-ink-2" : "text-muted"}`}
            data-testid="autoreplies-tester-result"
            data-match={!!match}
          >
            {match
              ? t("replies.tester.match", { name: match.title ?? match.keywords.join(", ") })
              : t("replies.tester.noMatch")}
          </p>
        )}
      </div>
    </details>
  );
}

function LogRow({ e }: { e: AutoReplyLog }) {
  const { t, lang } = useT();
  const dm = e.dm === "sent" ? t("replies.log.dmSent") : t("replies.log.dmFailed");
  const pub =
    e.publicReply === "sent"
      ? t("replies.log.publicSent")
      : e.publicReply === "failed"
        ? t("replies.log.publicFailed")
        : null;
  return (
    <li className="px-inset flex flex-col gap-0.5 text-xs" data-testid="autoreplies-log-row" data-dm={e.dm}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="px-chip text-[0.65rem]" data-testid="autoreplies-log-kind">
          {t(`replies.log.kind.${e.kind}`)}
        </span>
        <b dir="ltr">{e.username ? `@${e.username}` : "—"}</b>
        <span className="text-ink-2 min-w-0 flex-1 truncate" dir="auto">
          {e.text}
        </span>
        <span className="text-muted num">{formatInstant(e.at, lang)}</span>
      </div>
      <div className={`flex flex-wrap gap-2 ${e.dm === "failed" ? "text-danger" : "text-muted"}`}>
        <span>{dm}</span>
        {pub && <span>{pub}</span>}
        {e.error && (
          <span>
            {errorText(t, e.error)}
            {e.detail && e.error === "rejected" ? ` («${e.detail}»)` : ""}
          </span>
        )}
      </div>
    </li>
  );
}
```

- [ ] **Step 7: Run the unit tests, typecheck, lint and the e2e spec**

Run: `pnpm.cmd exec vitest run components/ messages/` then `pnpm.cmd typecheck`, `pnpm.cmd lint`,
`pnpm.cmd e2e e2e/autoreplies.spec.ts e2e/world.spec.ts`
Expected: all PASS on both the phone and the desktop projects; `fitsViewport` true.

- [ ] **Step 8: Commit**

```bash
git add components/social/AutoRepliesScreen.tsx components/social/replies/RulesTable.tsx components/social/replies/DefaultReplyEditor.tsx components/shell/nav.ts components/shell/nav.test.ts messages/ e2e/autoreplies.spec.ts
git commit -m "Auto replies v2 screen: Beacons-style rules table, pause, default reply, sidebar link" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Dashboard — the full-page rule editor with the phone preview

**Files:**
- Create: `components/social/replies/RuleEditor.tsx`
- Create: `components/social/replies/PhonePreview.tsx`
- Create: `components/social/replies/PostGrid.tsx`
- Delete: `components/social/replies/AutoReplyForm.tsx`
- Modify: `components/social/AutoRepliesScreen.tsx` (use `RuleEditor`)
- Modify: `lib/replies.ts`, `lib/replies.test.ts` (delete `dmPreview` and its test)
- Modify: `messages/replies.ar.json`, `messages/replies.en.json`
- Modify: `e2e/autoreplies.spec.ts`

**Interfaces:**
- Consumes (Tasks 5–6): `AutoReply`, `ReplyTrigger`, `SocialPostStat`, `SocialStatusMap`; `replyProblems`,
  `dmBytesLeft`, `messageButtons`, `splitKeywords`, `BUTTONS_MAX`, `BUTTON_TITLE_MAX`, `PUBLIC_REPLIES_MAX`,
  `REPLY_PLATFORMS`, `ReplyProblemCode`; copy keys `replies.back`, `replies.saveChanges`, `replies.lettersLeft`,
  `replies.lettersOver`; test id `editor-back`.
- Produces: `RuleEditor` props `{ value: AutoReply; posts: readonly SocialPostStat[]; status: SocialStatusMap | null;
  origin?: string; username?: string; busy: boolean; onSave: (a: AutoReply) => void; onCancel: () => void }`;
  `PhonePreview` props `{ rule: AutoReply; origin?: string; username?: string }`; `PostGrid` props
  `{ posts: readonly SocialPostStat[]; value: string | null; onPick: (p: SocialPostStat) => void }`.

- [ ] **Step 1: The copy**

`messages/replies.ar.json` — change:
```json
"replies.form.publicHint": "نختار واحد منها عشوائياً كل مرة. اكتب {username} عشان نحط اسم المعلّق.",
"replies.form.dmHint": "الأزرار تودّي لروابطك وتنحسب ضغطاتها. لو إنستقرام ما قبل الأزرار في أول رسالة، نرسل الروابط كسطور تحت الرسالة.",
```
and add:
```json
"replies.form.newTitle": "رد تلقائي جديد",
"replies.form.editTitle": "تعديل الرد التلقائي",
"replies.form.when": "لما أحد…",
"replies.form.target.post": "يعلّق على بوست معيّن",
"replies.form.target.anyPost": "يعلّق على أي بوست (آخر 5)",
"replies.form.target.message": "يرسل لك على الخاص أو يرد على ستوري",
"replies.form.noPosts": "ما فيه بوستات مزامنة لسا؛ زامن إنستقرام من صفحة النمو.",
"replies.form.exact": "تطابق تام",
"replies.form.removeKeyword": "احذف «{word}»",
"replies.form.publicSuggested": "أرسلت لك الرابط على الخاص 🎬",
"replies.form.addPublic": "+ رد ثاني",
"replies.form.follow": "زر «تابعني» (يفتح حسابك)",
"replies.preview.open": "👁 المعاينة",
"replies.preview.post": "البوست",
"replies.preview.comments": "التعليقات",
"replies.preview.dm": "الخاص",
"replies.preview.noPublic": "بدون رد عام",
"replies.problem.noPost": "اختر البوست من الشبكة.",
```
`messages/replies.en.json` — change:
```json
"replies.form.publicHint": "One is picked at random each time. Write {username} to mention the commenter.",
"replies.form.dmHint": "Buttons open your links and count the taps. If Instagram refuses buttons in the first message, the links go as lines under it.",
```
and add:
```json
"replies.form.newTitle": "New auto reply",
"replies.form.editTitle": "Edit auto reply",
"replies.form.when": "When someone…",
"replies.form.target.post": "Comments on a specific post",
"replies.form.target.anyPost": "Comments on any post (the latest 5)",
"replies.form.target.message": "DMs you or replies to a story",
"replies.form.noPosts": "No synced posts yet; sync Instagram from Growth.",
"replies.form.exact": "Exact match",
"replies.form.removeKeyword": "Remove «{word}»",
"replies.form.publicSuggested": "Sent you the link in a DM 🎬",
"replies.form.addPublic": "+ Another reply",
"replies.form.follow": "«Follow me» button (opens your profile)",
"replies.preview.open": "👁 Preview",
"replies.preview.post": "Post",
"replies.preview.comments": "Comments",
"replies.preview.dm": "DM",
"replies.preview.noPublic": "No public reply",
"replies.problem.noPost": "Pick the post from the grid.",
```

- [ ] **Step 2: Write the failing e2e changes**

In `e2e/autoreplies.spec.ts`:

1. The big test's signature becomes `async ({ page, isMobile }) => {`, and the block from
   `// Build the LUT automation.` up to and including the `expect(fake.saved[0]).toMatchObject({ … });` call is
   replaced by:

```ts
  // Build the LUT automation in the full-page editor.
  await page.getByTestId("autoreplies-new").click();
  await page.getByTestId("autoreply-save").click();
  await expect(page.getByTestId("autoreply-problems")).toBeVisible();
  expect(fake.saved).toHaveLength(0);
  await page.getByTestId("autoreply-target-post").click();
  await page.locator('[data-testid="autoreply-post-tile"][data-post-id="18001"]').click();
  await page.getByTestId("autoreply-keyword-input").fill("لت, LUT,");
  await expect(page.getByTestId("autoreply-keyword-chip")).toHaveCount(2);
  await page.getByTestId("autoreply-public-on").check();
  await page.getByTestId("autoreply-public-0").fill("أرسلته لك على الخاص 🎬");
  await page.getByTestId("autoreply-public-add").click();
  await page.getByTestId("autoreply-public-1").fill("شيّك على الخاص {username}");
  await page.getByTestId("autoreply-dm").fill("حمل اللت من الرابط تحت وجربه على لقطاتك");
  await page.getByTestId("autoreply-add-button").click();
  await page.getByTestId("autoreply-button-title-0").fill("حمل اللت");
  await page.getByTestId("autoreply-button-url-0").fill(LUT);
  await page.getByTestId("autoreply-follow").check();

  // The phone preview: the DM with both buttons, and the comment with a public reply under it.
  if (isMobile) await page.getByTestId("autoreply-preview-open").click();
  const preview = page.locator('[data-testid="autoreply-preview"]:visible');
  await expect(preview.getByTestId("autoreply-preview-button")).toHaveText(["حمل اللت", "تابعني"]);
  await preview.getByTestId("autoreply-preview-tab-comments").click();
  await expect(preview.getByTestId("autoreply-preview-comments")).toContainText(
    "أرسلته لك على الخاص 🎬",
  );
  expect(await fitsViewport(page)).toBe(true);

  await page.getByTestId("autoreply-save").click();
  await expect(page.getByTestId("autoreplies-notice")).toBeVisible();
  expect(fake.saved).toHaveLength(1);
  expect(fake.saved[0]).toMatchObject({
    enabled: true,
    trigger: "comment",
    postId: "18001",
    permalink: "https://www.instagram.com/reel/LUT1/",
    title: "T&O LUT reel",
    keywords: ["لت", "LUT"],
    match: "contains",
    publicReplies: ["أرسلته لك على الخاص 🎬", "شيّك على الخاص {username}"],
    dmText: "حمل اللت من الرابط تحت وجربه على لقطاتك",
    buttons: [{ title: "حمل اللت", url: LUT }],
    followButton: true,
  });
```

2. Add:

```ts
test("a DM rule has no post or public replies, and the counter stops a DM that is too long", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  fake.status.instagram = { ...fake.status.instagram, canReply: true };
  await freshState(page, "/settings/");
  await connectWorker(page);
  await page.goto("/social/replies/");
  await page.getByTestId("autoreplies-new").click();
  await page.getByTestId("autoreply-target-message").click();
  await expect(page.getByTestId("autoreply-public-section")).toHaveCount(0);
  await page.getByTestId("autoreply-keyword-input").fill("كاميرا");
  await page.getByTestId("autoreply-keyword-input").press("Enter");
  await page.getByTestId("autoreply-dm").fill("ل".repeat(501));
  await expect(page.getByTestId("autoreply-dm-left")).toContainText("1");
  await page.getByTestId("autoreply-save").click();
  await expect(page.getByTestId("autoreply-problems")).toBeVisible();
  expect(fake.saved).toHaveLength(0);

  await page.getByTestId("autoreply-dm").fill("أصور بالآيفون 17 برو");
  await page.getByTestId("autoreply-save").click();
  await expect.poll(() => fake.saved.length).toBe(1);
  expect(fake.saved[0]).toMatchObject({
    trigger: "message",
    postId: null,
    publicReplies: [],
    keywords: ["كاميرا"],
  });
  const id = String(fake.saved[0].id);
  await expect(page.locator(`[data-testid="autoreply-row"][data-id="${id}"]:visible`)).toContainText(
    "الخاص والستوري",
  );
  expect(await fitsViewport(page)).toBe(true);
});
```

Run: `pnpm.cmd e2e e2e/autoreplies.spec.ts`
Expected: FAIL (the v1 form has no target cards, chips, preview or follow switch).

- [ ] **Step 3: `PostGrid.tsx`**

```tsx
"use client";

import type { SocialPostStat } from "@/lib/domain";
import { useT } from "@/lib/i18n";

/** The synced Instagram posts as a thumbnail grid (newest first); the chosen one is outlined. */
export default function PostGrid({
  posts,
  value,
  onPick,
}: {
  posts: readonly SocialPostStat[];
  value: string | null;
  onPick: (p: SocialPostStat) => void;
}) {
  const { t } = useT();
  if (!posts.length) {
    return (
      <p className="text-muted text-xs" data-testid="autoreply-no-posts">
        {t("replies.form.noPosts")}
      </p>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4" role="radiogroup" aria-label={t("replies.form.post")}>
      {posts.map((p) => (
        <button
          key={p.postId}
          type="button"
          role="radio"
          aria-checked={value === p.postId}
          aria-label={p.title?.trim() || p.publishedAt.slice(0, 10)}
          onClick={() => onPick(p)}
          className={`relative aspect-square overflow-hidden rounded border-2 ${
            value === p.postId ? "border-accent" : "border-transparent"
          }`}
          data-testid="autoreply-post-tile"
          data-post-id={p.postId}
        >
          {p.thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Instagram CDN thumbnail, expires; no loader
            <img src={p.thumbUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="bg-panel-2 grid h-full w-full place-items-center p-1 text-[0.65rem] leading-tight">
              {p.title?.trim() || p.publishedAt.slice(0, 10)}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: `PhonePreview.tsx`**

```tsx
"use client";

import { useState } from "react";
import type { AutoReply } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { messageButtons } from "@/lib/replies";

type Tab = "post" | "comments" | "dm";

/**
 * What people get, on a phone-shaped card (Beacons style): the post, the comment with the public reply under it,
 * and the DM with its buttons. Message rules show the DM only. Buttons are shown by title, as Instagram does.
 */
export default function PhonePreview({
  rule,
  origin,
  username,
}: {
  rule: AutoReply;
  origin?: string;
  username?: string;
}) {
  const { t } = useT();
  const tabs: readonly Tab[] = rule.trigger === "message" ? ["dm"] : ["post", "comments", "dm"];
  const [tab, setTab] = useState<Tab>("dm");
  const shown = tabs.includes(tab) ? tab : "dm";
  const handle = username ?? "3z.prod";
  const word = rule.keywords[0] ?? "لت";
  const pub = rule.publicReplies.find((r) => r.trim())?.replace(/\{username\}/g, "@fan") ?? "";
  const buttons = messageButtons(rule, origin, handle);

  return (
    <div className="flex flex-col items-center gap-2" data-testid="autoreply-preview">
      <div className="border-edge flex min-h-80 w-full max-w-72 flex-col gap-2 rounded-[28px] border-2 p-3">
        <div className="border-edge flex items-center gap-2 border-b pb-2 text-xs">
          <span
            aria-hidden
            className="grid h-7 w-7 place-items-center rounded-full border font-bold"
          >
            {handle.slice(0, 1).toUpperCase()}
          </span>
          <b dir="ltr">{handle}</b>
        </div>
        {shown === "post" &&
          (rule.thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Instagram CDN thumbnail, expires; no loader
            <img src={rule.thumbUrl} alt="" className="aspect-square w-full rounded object-cover" />
          ) : (
            <div className="bg-panel-2 grid aspect-square place-items-center rounded text-3xl">
              <span aria-hidden>{rule.postId ? "📌" : "📣"}</span>
            </div>
          ))}
        {shown === "post" && (
          <p className="text-xs">
            {rule.title ?? t(rule.postId ? "replies.table.post" : "replies.form.anyPost")}
          </p>
        )}
        {shown === "comments" && (
          <div className="flex flex-col gap-2 text-xs" data-testid="autoreply-preview-comments">
            <p>
              <b dir="ltr">@fan</b> <span dir="auto">{word}</span>
            </p>
            {pub ? (
              <p className="ms-4">
                <b dir="ltr">@{handle}</b> <span dir="auto">{pub}</span>
              </p>
            ) : (
              <p className="text-muted ms-4">{t("replies.preview.noPublic")}</p>
            )}
          </div>
        )}
        {shown === "dm" && (
          <div
            className="bg-panel-2 max-w-[85%] self-start rounded-2xl border p-2 text-xs"
            data-testid="autoreply-preview-dm"
          >
            <p className="break-words whitespace-pre-wrap" dir="auto">
              {rule.dmText.trim() || "…"}
            </p>
            {buttons.map((b, i) => (
              <span
                key={i}
                className="mt-1.5 block rounded-lg border p-1.5 text-center"
                data-testid="autoreply-preview-button"
              >
                {b.title}
              </span>
            ))}
          </div>
        )}
      </div>
      {tabs.length > 1 && (
        <div className="cal-tabs" role="tablist" aria-label={t("replies.form.preview")}>
          {tabs.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              className="cal-tab"
              aria-selected={shown === k}
              onClick={() => setTab(k)}
              data-testid={`autoreply-preview-tab-${k}`}
            >
              {t(`replies.preview.${k}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: `RuleEditor.tsx`**

```tsx
"use client";

import { useState } from "react";
import type { AutoReply, SocialPostStat, SocialStatusMap } from "@/lib/domain";
import { useT, type MessageKey } from "@/lib/i18n";
import {
  BUTTON_TITLE_MAX,
  BUTTONS_MAX,
  dmBytesLeft,
  PUBLIC_REPLIES_MAX,
  REPLY_PLATFORMS,
  replyProblems,
  splitKeywords,
  type ReplyProblemCode,
} from "@/lib/replies";
import PhonePreview from "./PhonePreview";
import PostGrid from "./PostGrid";

const PROBLEM_KEY: Record<ReplyProblemCode, MessageKey> = {
  noKeywords: "replies.problem.noKeywords",
  tooManyKeywords: "replies.problem.tooManyKeywords",
  keywordTooLong: "replies.problem.keywordTooLong",
  noDm: "replies.problem.noDm",
  dmTooLong: "replies.problem.dmTooLong",
  templateTooLong: "replies.problem.templateTooLong",
  publicTooLong: "replies.problem.publicTooLong",
  tooManyPublic: "replies.problem.tooManyPublic",
  badUrl: "replies.problem.badUrl",
  noTitle: "replies.problem.noTitle",
  tooManyButtons: "replies.problem.tooManyButtons",
  notConnected: "replies.problem.notConnected",
  noPermission: "replies.problem.noPermission",
};

type Target = "post" | "anyPost" | "message";
const NO_POST = { postId: null, permalink: undefined, title: undefined, thumbUrl: undefined };

/**
 * The rule editor, full page and Beacons style (round 34): trigger cards (a chosen post from a thumbnail grid, any
 * post, or a DM / story reply), keywords as chips with an exact-match switch, up to three public replies (comment
 * rules), the DM with its link buttons and the «تابعني» switch, and a live phone preview. Saving is refused while a
 * problem is listed; the Worker checks the same rules again.
 */
export default function RuleEditor({
  value,
  posts,
  status,
  origin,
  username,
  busy,
  onSave,
  onCancel,
}: {
  value: AutoReply;
  posts: readonly SocialPostStat[];
  status: SocialStatusMap | null;
  origin?: string;
  username?: string;
  busy: boolean;
  onSave: (a: AutoReply) => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const [draft, setDraft] = useState<AutoReply>(value);
  const [choosingPost, setChoosingPost] = useState(value.trigger === "comment" && value.postId !== null);
  const [word, setWord] = useState("");
  const [tried, setTried] = useState(false);
  const patch = (p: Partial<AutoReply>) => setDraft((d) => ({ ...d, ...p }));

  const igPosts = posts.filter((p) =>
    REPLY_PLATFORMS.includes(p.platform as (typeof REPLY_PLATFORMS)[number]),
  );
  const target: Target = draft.trigger === "message" ? "message" : choosingPost ? "post" : "anyPost";
  const problems = replyProblems(draft, status, origin);
  // "Specific post" chosen but no post picked yet would save as "any post": refuse it here.
  const noPost = target === "post" && !draft.postId;
  const left = dmBytesLeft(draft, origin);
  const buttonsLeft = BUTTONS_MAX - draft.buttons.length - (draft.followButton ? 1 : 0);

  const setTarget = (next: Target) => {
    setChoosingPost(next === "post");
    if (next === "message") patch({ trigger: "message", publicReplies: [], ...NO_POST });
    else if (next === "anyPost") patch({ trigger: "comment", ...NO_POST });
    else patch({ trigger: "comment" });
  };
  const pickPost = (p: SocialPostStat) =>
    patch({ postId: p.postId, permalink: p.permalink, title: p.title, thumbUrl: p.thumbUrl });
  const addWords = (text: string) => {
    patch({ keywords: splitKeywords([...draft.keywords, text].join("\n")) });
    setWord("");
  };
  const submit = () => {
    setTried(true);
    if (noPost || problems.length) return;
    onSave(draft);
  };

  const preview = <PhonePreview rule={draft} origin={origin} username={username} />;

  return (
    <form
      className="flex flex-col gap-4"
      data-testid="autoreply-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="px-btn px-btn-ghost px-btn-sm" onClick={onCancel} data-testid="editor-back">
          {t("replies.back")}
        </button>
        <h1 className="text-xl">{t(value.createdAt ? "replies.form.editTitle" : "replies.form.newTitle")}</h1>
        <button type="submit" className="px-btn px-btn-primary ms-auto" disabled={busy} data-testid="autoreply-save">
          {t("replies.saveChanges")}
        </button>
      </div>

      {tried && (noPost || problems.length > 0) && (
        <ul className="text-danger flex flex-col gap-0.5 text-xs" data-testid="autoreply-problems">
          {noPost && <li>{t("replies.problem.noPost")}</li>}
          {problems.map((p) => (
            <li key={p.code}>
              {t(PROBLEM_KEY[p.code], p.max !== undefined ? { max: p.max } : undefined)}
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          {/* Trigger */}
          <section className="px-card flex flex-col gap-2">
            <span className="text-ink-2 text-sm font-bold">{t("replies.form.when")}</span>
            <div className="flex flex-col gap-1.5" role="radiogroup" aria-label={t("replies.form.when")}>
              {(["post", "anyPost", "message"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={target === k}
                  onClick={() => setTarget(k)}
                  className="px-inset flex items-center gap-2 text-start text-sm"
                  style={target === k ? { outline: "2px solid var(--accent)" } : undefined}
                  data-testid={`autoreply-target-${k}`}
                >
                  <span aria-hidden>{k === "message" ? "💬" : k === "post" ? "📌" : "📣"}</span>
                  {t(`replies.form.target.${k}`)}
                </button>
              ))}
            </div>
            {target === "post" && <PostGrid posts={igPosts} value={draft.postId} onPick={pickPost} />}
          </section>

          {/* Keywords */}
          <section className="px-card flex flex-col gap-2">
            <span className="text-ink-2 text-sm font-bold">{t("replies.form.keywords")}</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {draft.keywords.map((k) => (
                <span key={k} className="px-chip flex items-center gap-1 text-xs" data-testid="autoreply-keyword-chip">
                  {k}
                  <button
                    type="button"
                    aria-label={t("replies.form.removeKeyword", { word: k })}
                    onClick={() => patch({ keywords: draft.keywords.filter((x) => x !== k) })}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                type="text"
                className="px-input min-w-32 flex-1"
                autoComplete="off"
                placeholder="لت, lut"
                value={word}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/[,،\n]/.test(v)) addWords(v);
                  else setWord(v);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (word.trim()) addWords(word);
                  }
                }}
                onBlur={() => {
                  if (word.trim()) addWords(word);
                }}
                data-testid="autoreply-keyword-input"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                role="switch"
                checked={draft.match === "exact"}
                onChange={(e) => patch({ match: e.target.checked ? "exact" : "contains" })}
                data-testid="autoreply-exact"
              />
              {t("replies.form.exact")}
            </label>
            <span className="text-muted text-xs">{t("replies.form.keywordsHint")}</span>
          </section>

          {/* Public replies (comment rules) */}
          {draft.trigger === "comment" && (
            <section className="px-card flex flex-col gap-2" data-testid="autoreply-public-section">
              <label className="flex items-center gap-2 text-sm font-bold">
                <span className="text-ink-2">{t("replies.form.publicReply")}</span>
                <input
                  type="checkbox"
                  role="switch"
                  className="ms-auto"
                  checked={draft.publicReplies.length > 0}
                  onChange={(e) =>
                    patch({ publicReplies: e.target.checked ? [t("replies.form.publicSuggested")] : [] })
                  }
                  data-testid="autoreply-public-on"
                />
              </label>
              {draft.publicReplies.map((r, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input
                    type="text"
                    className="px-input min-w-0 flex-1"
                    dir="auto"
                    value={r}
                    onChange={(e) =>
                      patch({
                        publicReplies: draft.publicReplies.map((x, j) => (j === i ? e.target.value : x)),
                      })
                    }
                    data-testid={`autoreply-public-${i}`}
                  />
                  <button
                    type="button"
                    className="px-btn px-btn-ghost px-btn-sm"
                    aria-label={t("replies.delete")}
                    onClick={() => patch({ publicReplies: draft.publicReplies.filter((_, j) => j !== i) })}
                    data-testid={`autoreply-public-remove-${i}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {draft.publicReplies.length > 0 && draft.publicReplies.length < PUBLIC_REPLIES_MAX && (
                <button
                  type="button"
                  className="px-btn px-btn-ghost px-btn-sm self-start"
                  onClick={() => patch({ publicReplies: [...draft.publicReplies, ""] })}
                  data-testid="autoreply-public-add"
                >
                  {t("replies.form.addPublic")}
                </button>
              )}
              <span className="text-muted text-xs">
                {t("replies.form.publicHint", { username: "{username}" })}
              </span>
            </section>
          )}

          {/* The DM */}
          <section className="px-card flex flex-col gap-2">
            <label className="flex flex-col gap-1">
              <span className="flex items-center gap-2 text-sm font-bold">
                <span className="text-ink-2">{t("replies.form.dm")}</span>
                <span
                  className={`num ms-auto text-xs font-normal ${left < 0 ? "text-danger" : "text-muted"}`}
                  data-testid="autoreply-dm-left"
                >
                  {t(left < 0 ? "replies.lettersOver" : "replies.lettersLeft", {
                    n: Math.trunc(Math.abs(left) / 2),
                  })}
                </span>
              </span>
              <textarea
                className="px-input min-h-24"
                dir="auto"
                value={draft.dmText}
                onChange={(e) => patch({ dmText: e.target.value })}
                data-testid="autoreply-dm"
              />
            </label>
            <span className="text-ink-2 text-sm font-bold">{t("replies.form.buttons")}</span>
            {draft.buttons.map((b, i) => (
              <div key={i} className="flex flex-wrap items-center gap-1.5" data-testid="autoreply-button">
                <input
                  type="text"
                  className="px-input min-w-28 flex-1"
                  maxLength={BUTTON_TITLE_MAX}
                  placeholder={t("replies.form.buttonTitle")}
                  aria-label={t("replies.form.buttonTitle")}
                  value={b.title}
                  onChange={(e) =>
                    patch({
                      buttons: draft.buttons.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)),
                    })
                  }
                  data-testid={`autoreply-button-title-${i}`}
                />
                <input
                  type="url"
                  inputMode="url"
                  dir="ltr"
                  className="px-input min-w-40 flex-[2]"
                  placeholder="https://…"
                  aria-label={t("replies.form.buttonUrl")}
                  value={b.url}
                  onChange={(e) =>
                    patch({
                      buttons: draft.buttons.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)),
                    })
                  }
                  data-testid={`autoreply-button-url-${i}`}
                />
                <button
                  type="button"
                  className="px-btn px-btn-ghost px-btn-sm"
                  aria-label={t("replies.delete")}
                  onClick={() => patch({ buttons: draft.buttons.filter((_, j) => j !== i) })}
                  data-testid={`autoreply-button-remove-${i}`}
                >
                  ✕
                </button>
              </div>
            ))}
            {buttonsLeft > 0 && (
              <button
                type="button"
                className="px-btn px-btn-ghost px-btn-sm self-start"
                onClick={() => patch({ buttons: [...draft.buttons, { title: "", url: "" }] })}
                data-testid="autoreply-add-button"
              >
                {t("replies.form.addButton")}
              </button>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                role="switch"
                checked={draft.followButton}
                disabled={!draft.followButton && buttonsLeft <= 0}
                onChange={(e) => patch({ followButton: e.target.checked })}
                data-testid="autoreply-follow"
              />
              {t("replies.form.follow")}
            </label>
            <span className="text-muted text-xs">{t("replies.form.dmHint")}</span>
          </section>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              role="switch"
              checked={draft.enabled}
              onChange={(e) => patch({ enabled: e.target.checked })}
              data-testid="autoreply-enabled"
            />
            {t("replies.form.enabled")}
          </label>
        </div>

        {/* The preview: beside the form on wide screens, behind a button on phones */}
        <div className="hidden self-start lg:sticky lg:top-4 lg:block">{preview}</div>
        <details className="px-card lg:hidden">
          <summary className="cursor-pointer text-sm font-bold" data-testid="autoreply-preview-open">
            {t("replies.preview.open")}
          </summary>
          <div className="mt-2">{preview}</div>
        </details>
      </div>
    </form>
  );
}
```

- [ ] **Step 6: Use the editor, and remove the v1 builder**

1. In `AutoRepliesScreen.tsx`, replace the `AutoReplyForm` import and element with:
   ```tsx
   import RuleEditor from "./replies/RuleEditor";
   ```
   ```tsx
   <RuleEditor
     key={editing.rule.id}
     value={editing.rule}
     posts={posts}
     status={status}
     origin={doc?.origin}
     username={username}
     busy={busy}
     onSave={(a) => void saveRule(a)}
     onCancel={() => setEditing(null)}
   />
   ```
2. Delete `components/social/replies/AutoReplyForm.tsx`.
3. In `lib/replies.ts` delete `dmPreview`; in `lib/replies.test.ts` delete its import and the "renders the DM the way
   the Worker sends it" test (rename the describe to `"ctr / replyInput / newAutoReply"`).
4. `grep -rn "replies\.form\.\(title\|match\|post\b\|preview\)" components lib app` — delete from both
   `messages/replies.*.json` the keys nothing references any more (typecheck fails if one is still used).

- [ ] **Step 7: Run everything for the dashboard**

Run: `pnpm.cmd exec vitest run lib/ components/ messages/` then `pnpm.cmd typecheck`, `pnpm.cmd lint`,
`pnpm.cmd e2e e2e/autoreplies.spec.ts`
Expected: all PASS on phone and desktop; no sideways scroll.

- [ ] **Step 8: Commit**

```bash
git add -A components/social lib/replies.ts lib/replies.test.ts messages/ e2e/autoreplies.spec.ts
git commit -m "Auto replies v2 editor: trigger cards, post grid, keyword chips, public replies, buttons, phone preview" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Docs, all the gates, and the owner's steps

**Files:**
- Modify: `planning/build-plan.md` (a row after 5.9)
- Modify: `planning/tools/14-auto-replies-v2.md` (status line)
- Modify: `planning/tools/10-auto-replies.md` ("Owner's part" points at v2)
- Modify: `workers/scout/README.md` (the Auto-replies section: v2 routes, the DM poll, the trigger)

- [ ] **Step 1: Docs**

1. `planning/build-plan.md`, after row 5.9, add:
   ```markdown
   | 5.10 | **Auto replies v2** (round 34, our own Smart Reply): comment rules with button DMs and a «تابعني» follow invite (no follow gate), DM and story-reply keyword answers, a default reply (once a day per person), quiet while the owner chats by hand, pause all, every-minute polling with a KV write guard, Beacons-style table and editor with a phone preview | ✅ `workers/scout/src/social/replyCore.ts`, `inbox.ts`, `replies.ts`, `components/social/replies/`, `e2e/autoreplies.spec.ts`; spec `tools/14-auto-replies-v2.md` |
   ```
2. `planning/tools/14-auto-replies-v2.md`: under the title, add `**Status:** built (round 34); goes live after the
   Live test (step 0).`
3. `planning/tools/10-auto-replies.md`, at the top of "Owner's part (once)": "Round 34: the Live test and the steps
   are in `14-auto-replies-v2.md` → Step 0."
4. `workers/scout/README.md`, Auto-replies section: list `POST /social/replies/settings { paused?, defaultReply? }`,
   the v2 fields of `POST /social/replies` (`trigger`, `publicReplies`, `followButton`), the DM poll
   (`GET /{IG_ID}/conversations`, the Send API with button templates), and the `* * * * *` trigger with the write
   guard (300 / 600 a UTC day).

- [ ] **Step 2: All the gates**

Run, in order: `pnpm.cmd lint`, `pnpm.cmd typecheck`, `pnpm.cmd test`, `pnpm.cmd build`, `pnpm.cmd e2e`
Expected: every one green (e2e: the previous 243 + the new auto-reply tests pass, skips unchanged).

- [ ] **Step 3: Commit**

```bash
git add planning/build-plan.md planning/tools/14-auto-replies-v2.md planning/tools/10-auto-replies.md workers/scout/README.md
git commit -m "Record auto replies v2 in the plans and the Worker README" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## After the build (owner + Claude, not part of any task)

1. PR to `main`; the owner merges; Actions deploys the Worker (now `* * * * *`) and the dashboard.
2. The Live test (spec step 0), then the real test: a friend comments «لت», DMs «كاميرا», replies to a story, sends a
   plain DM. Check in the log that the Send API's message ids match the Conversations API's.
3. The paperwork for instant mode (spec "Paperwork"), then its own round.
