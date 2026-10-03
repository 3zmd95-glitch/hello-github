/**
 * Discover v2 step 1: what to search (planning/tools/13-discover-search-v2.md, "The pipeline"). A dictionary
 * entry gives the queries; an unknown topic gets "<topic> edit" / "<topic> tutorial" / "شرح <topic>". TikTok and
 * Instagram ask examples en, tutorials en and tutorials ar (the Arabic examples query is the Arabic retry);
 * YouTube asks the same three without retries (a retry there costs a `search.list` call). With an Anthropic key
 * this is the step that would call Claude instead. Queries keep the typed words; `topicKey` and `topicWords` are
 * in the Discover matching form (`normalizeTerm`).
 */

import { PLATFORMS, type Platform } from "../normalize";
import { hasArabic } from "../trends/normalize";
import { matchTerms, normalizeTerm, TERMS, type EditTerm, type Lang } from "./terms";
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
  /** What the English retries ask about: the English label plus the extra typed words, else the typed words. */
  name: string;
}

function termWords(term: EditTerm, rest: string): Words {
  return {
    examples: {
      en: join(term.queries.examples.en, rest),
      ar: join(term.queries.examples.ar, rest),
    },
    tutorials: {
      en: join(term.queries.tutorials.en, rest),
      ar: join(term.queries.tutorials.ar, rest),
    },
    name: join(term.label.en, rest),
  };
}

function unknownWords(topic: string): Words {
  return {
    examples: { en: join(topic, "edit"), ar: join("ايديت", topic) },
    tutorials: { en: join(topic, "tutorial"), ar: join("شرح", topic) },
    name: topic,
  };
}

function plannedQueries(platforms: Platform[], w: Words, req: DiscoverRequest): PlannedQuery[] {
  const genre = req.genreQuery ?? {};
  const ex = (l: Lang) => join(w.examples[l], genre[l]);
  const tut = (l: Lang) => join(w.tutorials[l], req.program);
  const key = (s: string) => s.toLowerCase();
  // [intent, lang, q, retryQ]: a retry asks new words, the plain name (no genre or program) with "video" or
  // "how to", and in Arabic the examples query.
  const all: [Intent, Lang, string, string][] = [
    ["examples", "en", ex("en"), join(w.name, "video")],
    ["tutorials", "en", tut("en"), join("how to", w.name)],
    ["tutorials", "ar", tut("ar"), ex("ar")],
  ];
  // Each query once.
  const list = all.filter(([, , q], i) => q && all.findIndex((a) => key(a[2]) === key(q)) === i);
  const out: PlannedQuery[] = [];
  for (const platform of platforms) {
    // Words already asked on this platform: a retry repeating them would be the same call.
    const asked = new Set(list.map(([, , q]) => key(q)));
    for (const [intent, lang, q, retryQ] of list) {
      const retry = platform !== "yt" && !asked.has(key(retryQ));
      if (retry) asked.add(key(retryQ));
      out.push({
        id: `${platform}-${intent}-${lang}`,
        platform,
        lang,
        intent,
        q,
        ...(retry ? { retryQ } : {}),
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
  // A generic catch-all ("transitions") is not another meaning of what was typed.
  const others = [m.best, ...m.others].filter(
    (t): t is EditTerm => !!t && t !== term && !t.generic,
  );

  if (req.exact) {
    const lang: Lang = hasArabic(topic) ? "ar" : "en";
    return {
      topic,
      topicKey: normalizeTerm(topic),
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
    ? [...term.match.en, ...term.match.ar, term.label.en, term.label.ar]
    : m.rest.length
      ? m.rest
      : [topic];
  return {
    topic,
    topicKey: term ? term.id : normalizeTerm(rest || topic),
    ...(term ? { termId: term.id } : {}),
    exact: false,
    understood: {
      ...(term ? { termId: term.id } : {}),
      label: term ? { en: term.label.en, ar: term.label.ar } : { ar: topic, en: topic },
      exact: false,
    },
    alternatives: [...others.map(termAlternative), { exact: true }],
    topicWords: [...new Set(topicWords.map(normalizeTerm))].filter(Boolean),
    needsEditingWord: term ? !term.specific : false,
    queries: plannedQueries(platforms, words, req),
  };
}
