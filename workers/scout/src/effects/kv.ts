/** Trending effects, storage (planning/tools/18-trending-effects.md §3): one document, no TTL, one write per run. */

import type { EffectsEnv } from "./sources";
import type { EffectsDoc } from "./types";

export const EFFECTS_KEY = "effects:trending";

const isRecord = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);

/** The stored document; null when there is none, it is corrupt or KV is not bound. A KV error throws: the run must not
 * overwrite a history it could not read. A category's document is read the same way, by its own key
 * (planning/tools/19-category-trends.md §2). */
export async function readEffects<T extends EffectsDoc = EffectsDoc>(
  env: EffectsEnv,
  key = EFFECTS_KEY,
): Promise<T | null> {
  if (!env.SOCIAL_KV) return null;
  const text = await env.SOCIAL_KV.get(key, "text");
  if (!text) return null;
  try {
    const doc = JSON.parse(text) as unknown;
    return isRecord(doc) &&
      typeof doc.ranOn === "string" &&
      Array.isArray(doc.items) &&
      isRecord(doc.history) &&
      isRecord(doc.meta)
      ? (doc as unknown as T)
      : null;
  } catch {
    return null;
  }
}

export async function writeEffects(
  env: EffectsEnv,
  doc: EffectsDoc,
  key = EFFECTS_KEY,
): Promise<void> {
  await env.SOCIAL_KV?.put(key, JSON.stringify(doc));
}
