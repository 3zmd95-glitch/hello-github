/**
 * Trending effects, step 2 (planning/tools/18-trending-effects.md): candidate effect names from TikTok / Instagram post
 * text — dictionary effects, "___ effect / transition / trick / filter / trend / edit trend" phrases, Title-Case
 * "___ Edit" names and hashtags — with distinct creators counted as short hashes (no handle is stored).
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
    "foryoupage part one day today week 2026 ai dance challenge " +
    // Lowercase-"trend" junk ("hottest trend", "her trend", "pov trend").
    "hottest biggest favorite favourite current next big year her his their it let pov"
  ).split(" "),
);

/** Whole names that are not editing effects ("sound", "special" and "visual" are generic, so those never form;
 * any name ending in "after effect" is the software, see `named`). */
const BLOCK = new Set([
  "butterfly effect",
  "domino effect",
  "side effect",
  "placebo effect",
  "mandela effect",
  "greenhouse effect",
  "ripple effect",
  "halo effect",
]);

const ARABIC = /[؀-ۿ]/;

/** Dictionary entries about editing (audio and photo entries are left out), phrases and labels in matching form. */
const EDIT_TERMS = TERMS.filter((t) => t.kind !== "audio" && t.kind !== "photo").map((term) => ({
  term,
  forms: [...term.match.en, ...term.match.ar, term.label.en, term.label.ar].map(normalizeTerm),
}));

/**
 * Lookup 1's index, built once at load: what a post's text has to mention.
 * - The catch-all "transitions" entry is left out: a bare "transition" is a generic word.
 * - An entry that is not `specific` ("flash", "zoom" also mean other things) needs one of its longer phrases.
 * - A multi-word English phrase also counts written as one hashtag (#cloneyourself, #greenscreen).
 * Latin-script forms are looked up by the post's word n-grams; Arabic forms keep the prefix-aware `mentions`.
 */
const LATIN = new Map<string, EditTerm[]>();
const ARABIC_FORMS: { form: string; term: EditTerm }[] = [];
for (const { term, forms } of EDIT_TERMS) {
  if (term.generic) continue;
  const longer = forms.filter((f) => f.includes(" "));
  const joined = longer.filter((f) => !ARABIC.test(f)).map((f) => f.replace(/ /g, ""));
  for (const form of new Set([...(term.specific ? forms : longer), ...joined])) {
    if (ARABIC.test(form)) ARABIC_FORMS.push({ form, term });
    else if (form) LATIN.set(form, [...(LATIN.get(form) ?? []), term]);
  }
}
/** Every leading run of words of a Latin form ("clone", "clone yourself"): an n-gram grows only while it is one. */
const PREFIXES = new Set(
  [...LATIN.keys()].flatMap((f) => f.split(" ").map((_, i, ws) => ws.slice(0, i + 1).join(" "))),
);

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Lookup 1, the post text: every dictionary effect it mentions anywhere (whole words), in file order. */
function dictionaryHits(text: string): EditTerm[] {
  const form = normalizeTerm(text);
  const words = form.split(" ");
  const hits = new Set<EditTerm>();
  for (let i = 0; i < words.length; i++) {
    let gram = words[i];
    for (let j = i + 1; PREFIXES.has(gram); j++) {
      for (const term of LATIN.get(gram) ?? []) hits.add(term);
      if (j === words.length) break;
      gram += ` ${words[j]}`;
    }
  }
  if (ARABIC.test(form))
    for (const { form: phrase, term } of ARABIC_FORMS) if (mentions(form, phrase)) hits.add(term);
  return EDIT_TERMS.map((e) => e.term).filter((t) => hits.has(t));
}

/** Lookup 2, a candidate name: a dictionary entry only when the whole name equals one of its phrases ("flash" alone
 * must not swallow "flash clone edit"). */
function dictionaryName(name: string): EditTerm | undefined {
  const form = normalizeTerm(name);
  return EDIT_TERMS.find((e) => e.forms.includes(form))?.term;
}

/** A name from the words right before the suffix, back to the first generic word ("glitch and zoom transition" →
 * "zoom transition"; a possessive "'s" and apostrophes are dropped first). A capitalised suffix starts the name at
 * the run's first capitalised word ("omg Swagger Trend" → "swagger trend"). None when no word is left, the name is
 * blocked or it is the After Effects software. */
function named(words: readonly string[], suffix: string): string | undefined {
  const clean = words.map((w) =>
    w
      .toLowerCase()
      .replace(/['’]s$/, "")
      .replace(/[^a-z0-9-]/g, ""),
  );
  let start = clean.length;
  while (start > 0 && !GENERIC.has(clean[start - 1])) start--;
  if (/^[A-Z]/.test(suffix)) {
    const capital = words.findIndex((w, i) => i >= start && /^[A-Z]/.test(w));
    if (capital >= 0) start = capital;
  }
  const name = [...clean.slice(start), suffix.toLowerCase()].join(" ");
  return start < clean.length && !BLOCK.has(name) && !/\bafter effect$/.test(name)
    ? name
    : undefined;
}

export function candidatesOf(text: string): { key: string; name: string; termId?: string }[] {
  const plain = text.normalize("NFKC"); // styled letters ("𝐒𝐰𝐚𝐠𝐠𝐞𝐫") read as plain ones
  const out = new Map<string, { key: string; name: string; termId?: string }>();
  const addTerm = (t: EditTerm) => out.set(t.id, { key: t.id, name: t.label.en, termId: t.id });
  const add = (name: string | undefined) => {
    if (!name) return;
    // "speed ramp trend" is the speed ramp: a dictionary phrase before "trend" names that entry.
    const term =
      dictionaryName(name) ??
      (name.endsWith(" trend") ? dictionaryName(name.slice(0, -" trend".length)) : undefined);
    if (!term) out.set(slug(name), { key: slug(name), name });
    else if (!term.generic) addTerm(term); // a catch-all phrase ("seamless transition") names no trend
  };
  // Dictionary effects anywhere in the text.
  dictionaryHits(plain).forEach(addTerm);
  // "ghost trail effect", "zoom transition", "reverse trend": up to 3 whole words before the nearest suffix, any case.
  // "first month edit trend" is named "first month edit", like the Title-Case form below.
  for (const m of plain.matchAll(
    /\b((?:[A-Za-z][\w'’-]*\s+){1,3}?)(edit(?=\s+trends?\b)|effect|transition|trick|filter|trend)s?\b/gi,
  ))
    add(named(m[1].trim().split(/\s+/), m[2]));
  // Title-Case named edits: "Flash Clone Edit". A lowercase "edit" is too common to name anything.
  for (const m of plain.matchAll(/\b((?:[A-Z][\w'’-]*\s+){1,3}?)Edit\b/g))
    add(named(m[1].trim().split(/\s+/), "edit"));
  // Hashtags: #cloneeffect → "clone effect", #reversetrend → "reverse trend", #glitcheffects → "glitch effect".
  for (const m of plain.matchAll(/#([a-z0-9]{3,30}?)(effect|transition|trick|trend|filter)s?\b/gi))
    add(named([m[1]], m[2]));
  return [...out.values()];
}

/** "@User" and "user" are one creator. An Instagram card often has no handle: its post URL is the id then. */
export async function creatorId(platform: EffectPlatform, handleOrUrl: string): Promise<string> {
  const handle = handleOrUrl.trim().toLowerCase().replace(/^@/, "");
  const bytes = new TextEncoder().encode(`${platform}:${handle}`);
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
    // " | " keeps a name from running from the title into the snippet.
    for (const c of candidatesOf(`${post.title} | ${post.snippet}`)) {
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
