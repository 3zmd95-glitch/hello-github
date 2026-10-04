import { z } from "zod";

const inputText = (max: number) => z.string().trim().max(max);
const outputText = (max: number) => z.string().trim().min(1).max(max);
const shotTypes = [
  "hook",
  "talking",
  "broll",
  "screen",
  "closeup",
  "wide",
  "text",
  "other",
] as const;

export const CreatorRequestSchema = z.strictObject({
  brief: inputText(1200).min(1),
  title: inputText(200),
  platform: z.enum(["tiktok", "instagram", "youtube", "threads", "x", "snapchat"]),
  language: z.enum(["ar", "en"]),
  tone: z.enum(["friendly", "educational", "cinematic"]),
  durationSeconds: z.number().int().min(10).max(180),
  script: z.strictObject({
    hook: inputText(1200),
    beats: z.tuple([inputText(1600), inputText(1600), inputText(1600)]),
    cta: inputText(1200),
  }),
});
export type CreatorRequest = z.infer<typeof CreatorRequestSchema>;

export const CreatorDraftSchema = z.strictObject({
  hook: outputText(400),
  beats: z.tuple([outputText(900), outputText(900), outputText(900)]),
  cta: outputText(400),
  caption: outputText(1600),
  hashtags: z.array(z.string().regex(/^#[\p{L}\p{N}][\p{L}\p{N}\p{M}_]{0,49}$/u)).max(8),
  shots: z
    .array(z.strictObject({ type: z.enum(shotTypes), text: outputText(400) }))
    .min(3)
    .max(10),
});
export type CreatorDraft = z.infer<typeof CreatorDraftSchema>;
