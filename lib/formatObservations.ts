import { z } from "zod";
import { canonicalDiscoverVisualUrl } from "./discoverVisual";
import {
  assessFormatSource,
  FormatVerificationResponseSchema,
  FormatVerificationTargetSchema,
  InstagramSourceSchema,
  type FormatVerificationTarget,
  type InstagramSource,
} from "./formatVerification";
import { postedAt } from "../workers/scout/src/postDate";

export const FORMAT_OBSERVATIONS_MAX = 48;
export const FORMAT_OBSERVATIONS_MAX_BYTES = 400 * 1024;
const DAY = 86_400_000;
const FRESH_MS = 3 * DAY;
const InspectionSchema = FormatVerificationResponseSchema.extend({
  model: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/),
  effort: z
    .string()
    .min(1)
    .max(24)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
    .optional(),
});
const InputSchema = z.object({
  target: FormatVerificationTargetSchema,
  source: InstagramSourceSchema,
  inspection: InspectionSchema.optional(),
});
export type FormatObservationInput = z.infer<typeof InputSchema>;

const canonicalAudio = (url: string) =>
  `https://www.instagram.com/reels/audio/${new URL(url).pathname.split("/").filter(Boolean).at(-1)}/`;
function sourceSnapshot(source: InstagramSource): InstagramSource {
  return {
    ...source,
    url: canonicalDiscoverVisualUrl(source.url)!,
    ...(source.audio
      ? {
          audio: {
            ...source.audio,
            ...(source.audio.url ? { url: canonicalAudio(source.audio.url) } : {}),
          },
        }
      : {}),
  };
}
function targetSnapshot(target: FormatVerificationTarget): FormatVerificationTarget {
  return {
    ...target,
    ...(target.audio
      ? {
          audio: {
            ...target.audio,
            ...(target.audio.url ? { url: canonicalAudio(target.audio.url) } : {}),
          },
        }
      : {}),
  };
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Each row binds a complete target snapshot to one canonical post and its original evidence.
 * The local check time can date an unavailable attempt without inventing a source observation. */
export const FormatObservationSchema = InputSchema.extend({
  version: z.literal(1),
  url: z
    .string()
    .max(1000)
    .refine((url) => canonicalDiscoverVisualUrl(url) !== null),
  checkedAt: z.string().datetime(),
})
  .transform((row) => ({
    ...row,
    url: canonicalDiscoverVisualUrl(row.url)!,
    target: targetSnapshot(row.target),
    source: sourceSnapshot(row.source),
    ...(row.inspection
      ? {
          inspection: {
            ...row.inspection,
            verification: {
              ...row.inspection.verification,
              url: canonicalDiscoverVisualUrl(row.inspection.verification.url)!,
              source: sourceSnapshot(row.inspection.verification.source),
            },
          },
        }
      : {}),
  }))
  .superRefine((row, ctx) => {
    const fail = () => ctx.addIssue({ code: "custom", message: "Unbound format observation" });
    const checked = Date.parse(row.checkedAt);
    const observed = row.source.observedAt ? Date.parse(row.source.observedAt) : undefined;
    if (
      row.url !== row.source.url ||
      (!row.target.audio && !row.target.namedFormat) ||
      (row.source.status === "available" && observed === undefined) ||
      (observed !== undefined && observed > checked)
    )
      fail();
    if (!row.inspection) return;
    const verification = row.inspection.verification;
    const inspected = Date.parse(verification.checkedAt);
    if (
      row.source.status !== "available" ||
      verification.formatKey !== row.target.key ||
      verification.url !== row.url ||
      !same(verification.source, row.source) ||
      inspected > checked ||
      (observed !== undefined && observed > inspected) ||
      (verification.framesObservedAt && Date.parse(verification.framesObservedAt) > inspected) ||
      verification.audio !== assessFormatSource(row.target, row.source).audio
    )
      fail();
  });
export type FormatObservation = z.infer<typeof FormatObservationSchema>;
export type SelectedFormatObservation = FormatObservation & {
  published?: string;
  audio: "match" | "unknown" | "mismatch";
};

const revision = (row: FormatObservation) => Date.parse(row.source.observedAt ?? row.checkedAt);
const identity = (row: FormatObservation) => `${row.target.key}\n${row.url}`;
const size = (value: unknown) => {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Infinity;
  }
};
function validAt(row: FormatObservation, now: Date): boolean {
  return Date.parse(row.checkedAt) <= now.getTime();
}
function bounded(rows: FormatObservation[]): FormatObservation[] {
  const seen = new Set<string>();
  let bytes = 2;
  return rows
    .sort((a, b) => revision(b) - revision(a) || Date.parse(b.checkedAt) - Date.parse(a.checkedAt))
    .filter((row) => {
      const key = identity(row);
      if (seen.has(key)) return false;
      seen.add(key);
      const addition = size(row) + 1;
      if (seen.size > FORMAT_OBSERVATIONS_MAX || bytes + addition > FORMAT_OBSERVATIONS_MAX_BYTES)
        return false;
      bytes += addition;
      return true;
    });
}
function readRows(value: unknown, now: Date): FormatObservation[] {
  if (!Array.isArray(value)) return [];
  return bounded(
    value.slice(0, FORMAT_OBSERVATIONS_MAX * 4).flatMap((raw) => {
      if (size(raw) > FORMAT_OBSERVATIONS_MAX_BYTES) return [];
      const parsed = FormatObservationSchema.safeParse(raw);
      return parsed.success && validAt(parsed.data, now) ? [parsed.data] : [];
    }),
  );
}
/** Invalid imports cannot supply counts, secrets or arbitrary media URLs; old backups default empty. */
export const FormatObservationsSchema = z
  .unknown()
  .default([])
  .transform((value) => readRows(value, new Date()));

/** New source-only evidence replaces an older inspection honestly. An identical cached source
 * does not renew a check or erase its exactly bound inspection. */
export function upsertFormatObservation(
  current: readonly FormatObservation[],
  input: unknown,
  now = new Date(),
): readonly FormatObservation[] {
  if (!Number.isFinite(now.getTime()) || size(input) > FORMAT_OBSERVATIONS_MAX_BYTES)
    return current;
  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) return current;
  const candidate = FormatObservationSchema.safeParse({
    ...parsed.data,
    version: 1,
    url: parsed.data.source.url,
    checkedAt: now.toISOString(),
  });
  if (!candidate.success || !validAt(candidate.data, now)) return current;
  const row = candidate.data;
  const old = current.find((entry) => identity(entry) === identity(row));
  if (old) {
    if (revision(row) < revision(old)) return current;
    if (same(old.target, row.target) && same(old.source, row.source)) {
      if (!row.inspection || same(old.inspection, row.inspection)) return current;
      if (
        old.inspection &&
        Date.parse(row.inspection.verification.checkedAt) <
          Date.parse(old.inspection.verification.checkedAt)
      )
        return current;
    }
  }
  const next = bounded([row, ...current.filter((entry) => identity(entry) !== identity(row))]);
  return next.includes(row) ? next : current;
}

/** Only the saved target snapshot can use a verdict. A newer contradictory source observation
 * for the same post also invalidates older rows checked against other targets. */
export function selectFormatObservations(
  records: readonly FormatObservation[],
  target: FormatVerificationTarget,
  now = new Date(),
): SelectedFormatObservation[] {
  const parsed = FormatVerificationTargetSchema.safeParse(target);
  if (!parsed.success || !Number.isFinite(now.getTime())) return [];
  const expected = targetSnapshot(parsed.data);
  const rows = readRows(records, now);
  const sourceIdentity = (source: InstagramSource) => ({
    status: source.status,
    description: source.description,
    author: source.author,
    audio: source.audio,
  });
  return rows
    .filter(
      (row) =>
        same(row.target, expected) &&
        !rows.some(
          (other) =>
            other.url === row.url &&
            revision(other) > revision(row) &&
            !same(sourceIdentity(other.source), sourceIdentity(row.source)),
        ),
    )
    .map((row) => {
      const published = row.source.observedAt
        ? postedAt(row.url, new Date(row.source.observedAt))
        : undefined;
      return {
        ...row,
        ...(published && Date.parse(published) <= Date.parse(row.source.observedAt!)
          ? { published }
          : {}),
        audio: assessFormatSource(row.target, row.source).audio,
      };
    });
}

/** These are local observations, never platform adoption or growth. Only the creator count has
 * a recent-publication/fresh-evidence window; historical checks remain useful and visibly dated. */
export function summarizeFormatObservations(
  records: readonly FormatObservation[],
  target: FormatVerificationTarget,
  now = new Date(),
): { checkedPosts: number; audioMatches: number; sampledMatches: number; recentCreators: number } {
  const rows = selectFormatObservations(records, target, now);
  const sampled = (row: SelectedFormatObservation) =>
    row.source.status === "available" &&
    row.inspection?.verification.basis === "source-frames-and-metadata" &&
    row.inspection.verification.visual === "match";
  const fresh = (time: string | null | undefined) =>
    !!time && now.getTime() - Date.parse(time) >= 0 && now.getTime() - Date.parse(time) <= FRESH_MS;
  const creators = new Set(
    rows.flatMap((row) => {
      const author = row.source.author.trim().replace(/^@/, "").toLowerCase();
      const verification = row.inspection?.verification;
      return sampled(row) &&
        (!row.target.audio || row.audio === "match") &&
        row.published &&
        now.getTime() - Date.parse(row.published) >= 0 &&
        now.getTime() - Date.parse(row.published) < 7 * DAY &&
        fresh(row.source.observedAt) &&
        fresh(verification?.checkedAt) &&
        fresh(verification?.framesObservedAt) &&
        /^[a-z0-9_][a-z0-9_.]{0,29}$/i.test(author) &&
        !/^(?:unknown|anonymous|instagram|user|none|nobody)$/i.test(author)
        ? [author]
        : [];
    }),
  );
  return {
    checkedPosts: rows.length,
    audioMatches: rows.filter((row) => row.audio === "match").length,
    sampledMatches: rows.filter(sampled).length,
    recentCreators: creators.size,
  };
}
