/**
 * Trending effects, step 2 (planning/tools/18-trending-effects.md): candidate effect names from TikTok / Instagram post
 * text — dictionary effects, "___ effect / transition / trick / filter / trend / edit trend" phrases, Title-Case
 * "___ Edit" names and hashtags — with distinct creators counted as short hashes (no handle is stored). Category scans
 * pass camera suffixes and their own generic words (planning/tools/19-category-trends.md §2).
 */

import { mentions } from "../discover/relevance";
import { normalizeTerm, TERMS, type EditTerm } from "../discover/terms";
import { daysBetween } from "./score";
import { HISTORY_DAYS, type Candidate, type EffectPlatform, type EffectPost } from "./types";

/** Words that are never part of a name: walking back from the suffix, the first one ends the name. */
const GENERIC = new Set(
  (
    "viral new latest trending trend trends best easy simple cool video videos edit edits editing capcut tiktok " +
    "instagram ig reel reels the this that these a an my your our how to do make made making with and of for in on " +
    "popular most top full quick free template templates tutorial tutorials effect effects transition transitions " +
    "filter filters trick tricks style sound special visual aesthetic cinematic smooth fun crazy insane fyp foryou " +
    "foryoupage part one day today week ai dance challenge " +
    // Lowercase-"trend" junk ("hottest trend", "her trend", "pov trend").
    "hottest biggest favorite favourite current next big year her his their it let pov"
  ).split(" "),
);
/** A year ("2027 trend") is generic too. */
const isGeneric = (word: string) => GENERIC.has(word) || /^(19|20)\d\d$/.test(word);

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

/** Any Arabic-script letter (U+0600–U+06FF); category lessons keep an Arabic text only with one. */
export const ARABIC = /[؀-ۿ]/;

/** Dictionary entries about editing (audio and photo entries are left out), phrases and labels in matching form, and
 * each multi-word English one written as one hashtag word ("gif sticker" → "gifsticker"). */
const EDIT_TERMS = TERMS.filter((t) => t.kind !== "audio" && t.kind !== "photo").map((term) => {
  const forms = [...term.match.en, ...term.match.ar, term.label.en, term.label.ar].map(
    normalizeTerm,
  );
  const joined = forms
    .filter((f) => f.includes(" ") && !ARABIC.test(f))
    .map((f) => f.replace(/ /g, ""));
  return { term, forms, joined };
});

/**
 * Lookup 1's index, built once at load: what a post's text has to mention.
 * - The catch-all "transitions" entry is left out: a bare "transition" is a generic word.
 * - An entry that is not `specific` ("flash", "zoom" also mean other things) needs one of its longer phrases.
 * - A multi-word English phrase also counts written as one hashtag (#cloneyourself, #greenscreen).
 * Latin-script forms are looked up by the post's word n-grams; Arabic forms keep the prefix-aware `mentions`.
 */
const LATIN = new Map<string, EditTerm[]>();
const ARABIC_FORMS: { form: string; term: EditTerm }[] = [];
for (const { term, forms, joined } of EDIT_TERMS) {
  if (term.generic) continue;
  const longer = forms.filter((f) => f.includes(" "));
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

/** Lookup 2, a candidate name: a dictionary entry only when the whole name equals one of its phrases, or the phrase
 * written as one hashtag word ("flash" alone must not swallow "flash clone edit"). */
function dictionaryName(name: string): EditTerm | undefined {
  const form = normalizeTerm(name);
  return EDIT_TERMS.find((e) => e.forms.includes(form) || e.joined.includes(form))?.term;
}

/** A name from the words right before the suffix, back to the first generic word ("glitch and zoom transition" →
 * "zoom transition"; a possessive "'s" and apostrophes are dropped first). A capitalised suffix starts the name at
 * the run's first capitalised word ("omg Swagger Trend" → "swagger trend"). None when no word is left, the name is
 * blocked or it is the After Effects software. */
function named(
  words: readonly string[],
  suffix: string,
  generic: (word: string) => boolean = isGeneric,
): string | undefined {
  const clean = words.map((w) =>
    w
      .toLowerCase()
      .replace(/['’]s$/, "")
      .replace(/[^a-z0-9-]/g, ""),
  );
  let start = clean.length;
  while (start > 0 && !generic(clean[start - 1])) start--;
  if (/^[A-Z]/.test(suffix)) {
    const capital = words.findIndex((w, i) => i >= start && /^[A-Z]/.test(w));
    if (capital >= 0) start = capital;
  }
  const name = [...clean.slice(start), suffix.toLowerCase()].join(" ");
  return start < clean.length && !BLOCK.has(name) && !/\bafter effect$/.test(name)
    ? name
    : undefined;
}

/** What a category scan adds to the rules (planning/tools/19-category-trends.md §2): camera words as more suffixes
 * ("rolling shot", "low angle") and the category's own words as generic ("car edit" is never a style). */
export interface ExtractExtra {
  /** Plain words only: they go into the RegExps unescaped. */
  suffixes?: readonly string[];
  generic?: ReadonlySet<string>;
}

const PATTERNS = new Map<string, { phrase: RegExp; hashtag: RegExp }>();

/** The suffix phrase and hashtag RegExps of a suffix list (none: Trending effects'), built once per list rather than
 * for every post. `matchAll` reads a copy, so one global RegExp serves every call. */
export function suffixPatterns(suffixes: readonly string[] = []): {
  phrase: RegExp;
  hashtag: RegExp;
} {
  const more = suffixes.map((s) => `|${s}`).join("");
  let p = PATTERNS.get(more);
  if (!p) {
    p = {
      phrase: new RegExp(
        String.raw`\b((?:[A-Za-z][\w'’-]*\s+){1,3}?)(edit(?=\s+trends?\b)|effect|transition|trick|filter|trend${more})s?\b`,
        "gi",
      ),
      hashtag: new RegExp(
        String.raw`#([a-z0-9]{3,30}?)(effect|transition|trick|trend|filter${more})s?\b`,
        "gi",
      ),
    };
    PATTERNS.set(more, p);
  }
  return p;
}

export function candidatesOf(
  text: string,
  extra: ExtractExtra = {},
): { key: string; name: string; termId?: string }[] {
  const generic = (w: string) => isGeneric(w) || !!extra.generic?.has(w);
  const { phrase, hashtag } = suffixPatterns(extra.suffixes);
  const plain = text.normalize("NFKC"); // styled letters ("𝐒𝐰𝐚𝐠𝐠𝐞𝐫") read as plain ones
  const out = new Map<string, { key: string; name: string; termId?: string }>();
  const addTerm = (t: EditTerm) => out.set(t.id, { key: t.id, name: t.label.en, termId: t.id });
  const add = (name: string | undefined) => {
    if (!name) return;
    // A dictionary phrase before the suffix word names that entry, with no new name beside it: "speed ramp trend" is
    // the speed ramp, "Clone Yourself Edit" and #cloneyourselftrend the clone effect.
    const term = dictionaryName(name) ?? dictionaryName(name.split(" ").slice(0, -1).join(" "));
    if (term) {
      if (!term.generic) addTerm(term); // a catch-all phrase ("seamless transition") names no trend
      return;
    }
    // A new name is keyed by its words in matching form, as dictionary lookups are, so "ghost frames trend" and
    // "ghost frame trend" are one effect; the name stays as written.
    const key = slug(normalizeTerm(name));
    out.set(key, { key, name });
  };
  // Dictionary effects anywhere in the text.
  dictionaryHits(plain).forEach(addTerm);
  // "ghost trail effect", "zoom transition", "reverse trend": up to 3 whole words before the nearest suffix, any case.
  // "first month edit trend" is named "first month edit", like the Title-Case form below.
  for (const m of plain.matchAll(phrase)) add(named(m[1].trim().split(/\s+/), m[2], generic));
  // Title-Case named edits: "Flash Clone Edit". A lowercase "edit" is too common to name anything.
  for (const m of plain.matchAll(/\b((?:[A-Z][\w'’-]*\s+){1,3}?)Edit\b/g))
    add(named(m[1].trim().split(/\s+/), "edit", generic));
  // Hashtags: #cloneeffect → "clone effect", #reversetrend → "reverse trend", #glitcheffects → "glitch effect".
  for (const m of plain.matchAll(hashtag)) add(named([m[1]], m[2], generic));
  return [...out.values()];
}

/** "@User" and "user" are one account. Never use a post URL as an account identity. */
export async function creatorId(platform: EffectPlatform, handleOrUrl: string): Promise<string> {
  const handle = handleOrUrl.trim().toLowerCase().replace(/^@/, "");
  const bytes = new TextEncoder().encode(`${platform}:${handle}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest.slice(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A scan's posts: kept (dated within 14 days), too old, and with no date (diagnostics' `posts`). */
export interface PostCounts {
  kept: number;
  old: number;
  undated: number;
}

/**
 * Candidates from the posts of the last 14 days at `today` (live, 2026-10-07: "this week" rested on scans of September
 * posts). A post with no date or identified account is skipped. Every account/post-day observation is retained;
 * `days` also records each account's latest date for candidate selection. Samples are the newest posts.
 */
export async function extractCandidates(
  posts: readonly EffectPost[],
  today: string,
  extra: ExtractExtra = {},
): Promise<{ cands: Map<string, Candidate>; posts: PostCounts }> {
  const counts: PostCounts = { kept: 0, old: 0, undated: 0 };
  const seen = new Set<string>();
  const dated: { post: EffectPost; at: number; day: string }[] = [];
  for (const post of posts) {
    if (seen.has(post.url)) continue; // two family searches can return the same post: count it once
    seen.add(post.url);
    const at = Date.parse(post.published ?? "");
    if (Number.isNaN(at)) {
      counts.undated++;
      continue;
    }
    const posted = new Date(at).toISOString().slice(0, 10);
    const day = posted > today ? today : posted;
    if (daysBetween(day, today) >= HISTORY_DAYS) {
      counts.old++;
      continue;
    }
    counts.kept++;
    dated.push({ post, at, day });
  }
  // Newest first: a creator's first post here is their latest, and the samples are the newest.
  dated.sort((a, b) => b.at - a.at);
  const found = new Map<string, Candidate>();
  for (const { post, day } of dated) {
    // A post with no identified account can still be a search result, but cannot establish independent adoption.
    const handle = post.handle.trim();
    if (!handle || /^https?:\/\//i.test(handle)) continue;
    const id = await creatorId(post.platform, handle);
    // " | " keeps a name from running from the title into the snippet.
    for (const c of candidatesOf(`${post.title} | ${post.snippet}`, extra)) {
      const cand: Candidate = found.get(c.key) ?? {
        ...c,
        days: new Map<string, string>(),
        observations: [],
        posts: 0,
        platforms: new Set<EffectPlatform>(),
        samples: [],
      };
      if (!cand.days.has(id)) cand.days.set(id, day);
      if (!cand.observations!.some((o) => o.id === id && o.day === day))
        cand.observations!.push({ id, day });
      cand.posts += 1;
      cand.platforms.add(post.platform);
      if (cand.samples.length < 2)
        cand.samples.push({
          url: post.url,
          title: post.title.slice(0, 120),
          published: post.published,
        });
      found.set(c.key, cand);
    }
  }
  return { cands: found, posts: counts };
}
