import { z } from "zod";
import { RefSchema } from "./domain";
import { canonicalRefUrl, refFromItem, type ResearchItem } from "./research";

export const INSPIRATION_NOTE_MAX = 1200;
export const InspirationStageSchema = z.enum(["saved", "trying", "tried"]);
export type InspirationStage = z.infer<typeof InspirationStageSchema>;

/** Personal observations, never generated claims about what a video contains. */
export const InspirationSchema = z.object({
  ref: RefSchema,
  note: z.string().max(INSPIRATION_NOTE_MAX).default(""),
  stage: InspirationStageSchema.default("saved"),
  savedAt: z.string().datetime(),
});
export type Inspiration = z.infer<typeof InspirationSchema>;

export function inspirationKey(ref: Pick<ResearchItem, "platform" | "url">): string {
  return canonicalRefUrl(ref.platform, ref.url);
}

/** One post, even when it was found on two category pages or shared with tracking parameters. */
export function saveInspiration(
  entries: readonly Inspiration[],
  item: ResearchItem,
  now = new Date(),
): Inspiration[] {
  const key = inspirationKey(item);
  if (entries.some((entry) => inspirationKey(entry.ref) === key)) return [...entries];
  const ref = refFromItem(item);
  return [
    InspirationSchema.parse({
      ref: { ...ref, url: key },
      note: "",
      stage: "saved",
      savedAt: now.toISOString(),
    }),
    ...entries,
  ];
}

/** Invalid new entries must not prevent an otherwise valid older dashboard backup from loading. */
export const InspirationsSchema = z
  .array(z.unknown())
  .default([])
  .transform((entries) => {
    const seen = new Set<string>();
    return entries.flatMap((entry) => {
      const parsed = InspirationSchema.safeParse(entry);
      if (!parsed.success) return [];
      const key = inspirationKey(parsed.data.ref);
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ ...parsed.data, ref: { ...parsed.data.ref, url: key } }];
    });
  });
