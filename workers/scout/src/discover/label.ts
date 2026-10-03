/**
 * Discover v2 step 3: sections, off-topic and creators (planning/tools/13-discover-search-v2.md). Word rules,
 * no AI: a card is a Tutorial when it says so, else its query's intent; it is off-topic when it mentions none of
 * the topic's words, or (a dictionary entry with `specific: false`) no editing word either. Both checks compare
 * whole words in the Discover matching form (`normalizeTerm`), the form `SearchPlan.topicWords` is in. With an
 * Anthropic key this is the step that would call Claude instead.
 */

import type { Profile, ScoutResult } from "../normalize";
import { hasArabic } from "../trends/normalize";
import { normalizeTerm } from "./terms";
import type { Creator, DiscoverItem, PlannedQuery, SearchPlan } from "./types";

export const TUTORIAL_RE =
  /\b(?:tutorial|tutorials|how to|how-to|guide|step by step|explained|breakdown|learn|lesson)\b|شرح|طريقة|كيف|تعلم|درس|خطوات|تعليم/i;

/** Editing words: they make a vague word an editing topic. */
const EDITING_WORDS = [
  "edit",
  "edits",
  "editing",
  "editor",
  "transition",
  "transitions",
  "effect",
  "effects",
  "capcut",
  "davinci",
  "premiere",
  "after effects",
  "final cut",
  "cut",
  "vfx",
  "مونتاج",
  "ايديت",
  "تاثير",
  "انتقال",
  "كاب كت",
  "دافنشي",
  "مونتير",
  "فاينل كت",
];

/** The editing words in matching form, once: "edits" and "edit" meet, "تأثير" matches "تاثير". */
const EDITING_FORMS = [...new Set(EDITING_WORDS.map(normalizeTerm))];

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
    const text = normalizeTerm(raw);
    const section = TUTORIAL_RE.test(raw) || query.intent === "tutorials" ? "tutorial" : "example";
    const onTopic =
      plan.topicWords.length === 0 ||
      (plan.topicWords.some((w) => mentions(text, w)) &&
        (!plan.needsEditingWord || EDITING_FORMS.some((w) => mentions(text, w))));
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
  const ranked = [...byKey.values()].sort(
    (a, b) => b.count - a.count || (b.views ?? 0) - (a.views ?? 0),
  );
  for (const p of profiles) {
    const key = `${p.platform}:${p.handle.toLowerCase()}`;
    if (byKey.has(key)) continue;
    const c: Creator = { platform: p.platform, handle: p.handle, url: p.url, count: 0 };
    byKey.set(key, c);
    ranked.push(c);
  }
  return ranked.slice(0, max);
}
