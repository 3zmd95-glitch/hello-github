/**
 * Comment text and keywords compared loosely: case, Arabic diacritics and tatweel, alef and yaa variants and
 * punctuation/emoji do not matter ("لَت!" matches "لت"). Same function in the dashboard (lib/replies.ts).
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
