/**
 * Trending effects, step 2 (planning/tools/18-trending-effects.md): candidate effect names from TikTok / Instagram post
 * text — dictionary effects, "___ effect / transition / trick / filter" phrases, Title-Case "___ Trend / Edit" names and
 * hashtags — with distinct creators counted as short hashes (no handle is stored).
 */

import { mentions } from "../discover/relevance";
import { normalizeTerm, TERMS, type EditTerm } from "../discover/terms";
import type { Candidate, EffectPlatform, EffectPost } from "./types";

/** Words that are never part of a name: walking back from the suffix, the first one ends the name. */
const GENERIC = new Set(
  (
    "viral new latest trending trend trends best easy simple cool video videos edit edits editing capcut tiktok " +
    "instagram ig reel reels the this that these a an my your our how to do make made making with and of for in on " +
    "popular most top full quick free template templates tutorial tutorials effect effects transition transitions " +
    "filter filters trick tricks style sound special visual aesthetic cinematic smooth fun crazy insane fyp foryou " +
    "foryoupage part one day today week 2026 ai"
  ).split(" "),
);

/** Whole names that are not editing effects. */
const BLOCK = new Set([
  "sound effect",
  "special effect",
  "visual effect",
  "butterfly effect",
  "domino effect",
  "side effect",
  "placebo effect",
  "mandela effect",
  "greenhouse effect",
  "ripple effect",
  "halo effect",
]);

/**
 * Dictionary entries about editing, with their phrases and labels in matching form (worked out once at load). Audio
 * and photo entries are left out, and so is the catch-all "transitions" entry: a bare "transition" is a generic word.
 * `textForms` are what a post's text has to mention: an entry that is not `specific` ("flash", "zoom" also mean other
 * things) needs one of its longer phrases there.
 */
const EDIT_TERMS = TERMS.filter((t) => t.kind !== "audio" && t.kind !== "photo" && !t.generic).map(
  (term) => {
    const forms = [...term.match.en, ...term.match.ar, term.label.en, term.label.ar].map(
      normalizeTerm,
    );
    return { term, forms, textForms: term.specific ? forms : forms.filter((f) => f.includes(" ")) };
  },
);

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Lookup 1, the post text: every dictionary effect it mentions anywhere (whole words). */
function dictionaryHits(text: string): EditTerm[] {
  const form = normalizeTerm(text);
  return EDIT_TERMS.filter((e) => e.textForms.some((w) => mentions(form, w))).map((e) => e.term);
}

/** Lookup 2, a candidate name: a dictionary effect only when the whole name equals one of its phrases ("flash" alone
 * must not swallow "flash clone edit"). */
function dictionaryName(name: string): EditTerm | undefined {
  const form = normalizeTerm(name);
  return EDIT_TERMS.find((e) => e.forms.includes(form))?.term;
}

/** A name from the words right before the suffix, back to the first generic word ("glitch and zoom transition" →
 * "zoom transition"); none when no word is left or the name is blocked. */
function named(words: readonly string[], suffix: string): string | undefined {
  const clean = words.map((w) => w.toLowerCase().replace(/[^a-z0-9'-]/g, ""));
  let start = clean.length;
  while (start > 0 && !GENERIC.has(clean[start - 1])) start--;
  const name = [...clean.slice(start), suffix.toLowerCase()].join(" ");
  return start < clean.length && !BLOCK.has(name) ? name : undefined;
}

export function candidatesOf(text: string): { key: string; name: string; termId?: string }[] {
  const out = new Map<string, { key: string; name: string; termId?: string }>();
  const addTerm = (t: EditTerm) => out.set(t.id, { key: t.id, name: t.label.en, termId: t.id });
  const add = (name: string | undefined) => {
    if (!name) return;
    const term = dictionaryName(name);
    if (term) addTerm(term);
    else out.set(slug(name), { key: slug(name), name });
  };
  // Dictionary effects anywhere in the text.
  dictionaryHits(text).forEach(addTerm);
  // "ghost trail effect", "zoom transition": up to 3 whole words before the nearest suffix (lower or mixed case).
  for (const m of text.matchAll(
    /\b((?:[A-Za-z][A-Za-z'-]*\s+){1,3}?)(effect|transition|trick|filter)s?\b/gi,
  ))
    add(named(m[1].trim().split(/\s+/), m[2]));
  // Title-Case named trends: "CapCut Reverse Trend", "Swagger Trend", "Flash Clone Edit". The nearest suffix wins:
  // "First Month Edit Trend" → "first month edit".
  for (const m of text.matchAll(/\b((?:[A-Z][\w'-]*\s+){1,3}?)(Trend|Edit)\b/g))
    add(named(m[1].trim().split(/\s+/), m[2]));
  // Hashtags: #cloneeffect → "clone effect", #reversetrend → "reverse trend", #glitcheffects → "glitch effect".
  for (const m of text.matchAll(/#([a-z0-9]{3,30}?)(effect|transition|trick|trend|filter)s?\b/gi))
    add(named([m[1]], m[2]));
  return [...out.values()];
}

export async function creatorId(platform: EffectPlatform, handleOrUrl: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${platform}:${handleOrUrl.toLowerCase()}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest.slice(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function extractCandidates(
  posts: readonly EffectPost[],
): Promise<Map<string, Candidate>> {
  const found = new Map<string, Candidate>();
  const seen = new Set<string>();
  for (const post of posts) {
    if (seen.has(post.url)) continue; // two family searches can return the same post: count it once
    seen.add(post.url);
    const id = await creatorId(post.platform, post.handle || post.url);
    for (const c of candidatesOf(`${post.title} ${post.snippet}`)) {
      const cand: Candidate = found.get(c.key) ?? {
        ...c,
        ids: new Set<string>(),
        posts: 0,
        platforms: new Set<EffectPlatform>(),
        samples: [],
      };
      cand.ids.add(id);
      cand.posts += 1;
      cand.platforms.add(post.platform);
      if (cand.samples.length < 2)
        cand.samples.push({ url: post.url, title: post.title.slice(0, 120) });
      found.set(c.key, cand);
    }
  }
  return found;
}
