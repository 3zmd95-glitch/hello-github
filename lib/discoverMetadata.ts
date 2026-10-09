import {
  categoryCreativeEvidence,
  type CategoryCreativeEvidence,
} from "../workers/scout/src/categories/quality";
import type { DiscoverItem } from "./discover";

/** Preserve the native title boundary when older official YouTube evidence joined it with a space.
 * An unrelated indexed title must never be prepended to an authentic source caption. */
export function discoverSourceCaption(item: DiscoverItem): string {
  const caption = item.evidence?.caption?.trim() ?? "";
  const title = item.title.trim();
  return item.platform === "yt" &&
    item.evidence?.source === "youtube-api" &&
    title &&
    caption.startsWith(`${title} `)
    ? `${title}\n${caption.slice(title.length).trimStart()}`
    : caption;
}

export const DISCOVER_METADATA_MAX_ENTRIES = 500;
export const DISCOVER_METADATA_MAX_CHARS = 1_000_000;
const cache = new Map<string, CategoryCreativeEvidence>();
let chars = 0;

/** Only exact caption/category analysis is cached. Counts, dates, votes and ranking always recompute. */
export function discoverCreativeEvidence(genreId: string, text: string): CategoryCreativeEvidence {
  const key = JSON.stringify([genreId, text]);
  let result = cache.get(key);
  if (result) {
    cache.delete(key);
    cache.set(key, result);
  } else {
    result = categoryCreativeEvidence(genreId, text);
    if (key.length <= DISCOVER_METADATA_MAX_CHARS) {
      while (
        cache.size &&
        (cache.size >= DISCOVER_METADATA_MAX_ENTRIES ||
          chars + key.length > DISCOVER_METADATA_MAX_CHARS)
      ) {
        const oldest = cache.keys().next().value!;
        chars -= oldest.length;
        cache.delete(oldest);
      }
      cache.set(key, result);
      chars += key.length;
    }
  }
  // Consumers may build mutable UI evidence from these arrays; keep cached analysis isolated.
  return {
    ...result,
    subjects: [...result.subjects],
    techniques: [...result.techniques],
    namedTechniques: [...result.namedTechniques],
  };
}

/** Ephemeral diagnostics/reset; no text, personal signals or credentials leave the cache. */
export function discoverMetadataCacheSize(): { entries: number; chars: number } {
  return { entries: cache.size, chars };
}
export function resetDiscoverMetadataCache(): void {
  cache.clear();
  chars = 0;
}
