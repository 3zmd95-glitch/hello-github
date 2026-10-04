/**
 * Discover v2 step 3: sections, off-topic and creators (planning/tools/13-discover-search-v2.md). Word rules,
 * a card is a Tutorial only when its text suggests teaching; it is off-topic when it mentions none of
 * the topic's words, or (a dictionary entry with `specific: false`) no editing word and no tutorial word either.
 * Topic and editing words compare whole words in the Discover matching form (`normalizeTerm`), the form
 * `SearchPlan.topicWords` is in. Selected genre and AI concept groups also require matching evidence.
 */

import type { Profile, ScoutResult } from "../normalize";
import { hasArabic } from "../trends/normalize";
import { normalizeTerm } from "./terms";
import { mentions } from "./relevance";
import type { Creator, DiscoverItem, PlannedQuery, SearchPlan } from "./types";

/**
 * Tutorial words, tested on the raw text. The Arabic ones are whole words that may carry a prefix (و ف ب ل ال بال
 * وال لل): "بطريقه" and "الشرح" count, "مدرسه" (school) and "كيفك" (how are you) do not.
 */
export const TUTORIAL_RE =
  /\b(?:tutorial|tutorials|how to|how-to|guide|step by step|explained|breakdown|learn|lesson)\b|(?<!\p{L})(?:و|ف|ب|ل|ال|بال|وال|لل)?(?:شرح|طريقة|طريقه|كيف|تعلم|درس|خطوات|تعليم)(?!\p{L})/iu;

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
    const tutorial = TUTORIAL_RE.test(raw);
    const section = tutorial ? "tutorial" : "example";
    // A vague word ("flash") needs editing context: an editing word, or a tutorial word.
    const onTopic =
      (plan.topicWords.length === 0 ||
        (plan.topicWords.some((w) => mentions(text, w)) &&
          (!plan.needsEditingWord || tutorial || EDITING_FORMS.some((w) => mentions(text, w))))) &&
      (plan.requiredGroups ?? []).every((group) => group.some((w) => mentions(text, w)));
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
    // The channel page tells two YouTube channels with one name apart; cards without one (and profile pages) key
    // by handle.
    const key = `${item.platform}:${(item.profile ?? item.handle).toLowerCase()}`;
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
