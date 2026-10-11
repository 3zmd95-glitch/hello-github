import { z } from "zod";
import { canonicalDiscoverVisualUrl } from "./discoverVisual";
import type { EditFormat } from "./editFormats";
import {
  FormatVerificationTargetSchema,
  formatVerificationTarget,
  type FormatVerificationTarget,
} from "./formatVerification";

export const FORMAT_QUEUE_MAX = 48;
export const FORMAT_QUEUE_ACTION_MAX = 6;
export const FORMAT_QUEUE_MAX_BYTES = 128 * 1024;

const TargetSchema = FormatVerificationTargetSchema.refine(
  (target) => !!target.audio || !!target.namedFormat,
).transform((target) => ({
  ...target,
  ...(target.audio?.url
    ? {
        audio: {
          ...target.audio,
          url: `https://www.instagram.com/reels/audio/${new URL(target.audio.url).pathname.split("/").filter(Boolean).at(-1)}/`,
        },
      }
    : {}),
}));

/** A lead contains no source claims, review result or personal preference. */
export const FormatQueueEntrySchema = z.strictObject({
  target: TargetSchema,
  url: z
    .string()
    .max(1000)
    .refine((url) => canonicalDiscoverVisualUrl(url) !== null)
    .transform((url) => canonicalDiscoverVisualUrl(url)!),
  addedAt: z.string().datetime(),
});
export type FormatQueueEntry = z.infer<typeof FormatQueueEntrySchema>;

const targetKey = (target: FormatVerificationTarget) => JSON.stringify(target);

/** Stable identity includes the entire normalized snapshot, not just its format key. */
export function formatTargetId(target: FormatVerificationTarget): string | null {
  const parsed = TargetSchema.safeParse(target);
  return parsed.success ? targetKey(parsed.data) : null;
}

export type FormatQueueOption = {
  id: string;
  format: EditFormat;
  target: FormatVerificationTarget;
  historical: boolean;
};

/** Inspector-only options: queued targets remain accessible when live formats change or disappear.
 * Historical adapters carry no observed source/format evidence and must not become discovery cards. */
export function formatQueueOptions(
  formats: readonly EditFormat[],
  records: readonly FormatQueueEntry[],
  now = new Date(),
): FormatQueueOption[] {
  const options: FormatQueueOption[] = [];
  const seen = new Set<string>();
  for (const format of formats) {
    const parsed = TargetSchema.safeParse(formatVerificationTarget(format));
    if (!parsed.success) continue;
    const id = targetKey(parsed.data);
    if (seen.has(id)) continue;
    seen.add(id);
    options.push({ id, format, target: parsed.data, historical: false });
  }
  for (const entry of readQueue(records, now)) {
    const id = targetKey(entry.target);
    if (seen.has(id)) continue;
    seen.add(id);
    options.push({
      id,
      target: entry.target,
      historical: true,
      format: {
        ...entry.target,
        firstSeen: entry.addedAt,
        lastChecked: entry.addedAt,
        evidence: {
          state: "candidate",
          creators7d: 0,
          posts7d: 0,
          scope: "reviewed-references",
        },
        samples: [
          {
            url: entry.url,
            title: entry.target.name.en.slice(0, 300),
            platform: "ig",
            observedAt: entry.addedAt,
          },
        ],
      },
    });
  }
  return options;
}

const identity = (entry: FormatQueueEntry) => `${targetKey(entry.target)}\n${entry.url}`;
function bytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Infinity;
  }
}

function readQueue(value: unknown, now: Date): FormatQueueEntry[] {
  if (!Array.isArray(value) || !Number.isFinite(now.getTime())) return [];
  const unique = new Map<string, FormatQueueEntry>();
  for (const raw of value.slice(0, FORMAT_QUEUE_MAX * 4)) {
    if (bytes(raw) > FORMAT_QUEUE_MAX_BYTES) continue;
    const parsed = FormatQueueEntrySchema.safeParse(raw);
    if (!parsed.success || Date.parse(parsed.data.addedAt) > now.getTime()) continue;
    const entry = parsed.data;
    const previous = unique.get(identity(entry));
    if (!previous || Date.parse(entry.addedAt) < Date.parse(previous.addedAt))
      unique.set(identity(entry), entry);
  }
  let size = 2;
  let count = 0;
  return [...unique.values()]
    .sort((a, b) => Date.parse(a.addedAt) - Date.parse(b.addedAt))
    .filter((entry) => {
      const addition = bytes(entry) + 1;
      if (count >= FORMAT_QUEUE_MAX || size + addition > FORMAT_QUEUE_MAX_BYTES) return false;
      count++;
      size += addition;
      return true;
    });
}

/** Old backups default empty; malformed, future and verdict-bearing rows cannot enter the queue. */
export const FormatQueueSchema = z
  .unknown()
  .default([])
  .transform((value) => readQueue(value, new Date()));

export function selectFormatCandidates(
  records: readonly FormatQueueEntry[],
  target: FormatVerificationTarget,
  now = new Date(),
): FormatQueueEntry[] {
  const parsed = TargetSchema.safeParse(target);
  if (!parsed.success) return [];
  const key = targetKey(parsed.data);
  return readQueue(records, now).filter((entry) => targetKey(entry.target) === key);
}

/** Preserve existing leads and their original dates; a full queue does not evict another target. */
export function addFormatCandidates(
  current: readonly FormatQueueEntry[],
  target: FormatVerificationTarget,
  urls: readonly string[],
  now = new Date(),
): readonly FormatQueueEntry[] {
  if (
    !Number.isFinite(now.getTime()) ||
    !Array.isArray(urls) ||
    bytes({ target, urls }) > FORMAT_QUEUE_MAX_BYTES
  )
    return current;
  const parsed = TargetSchema.safeParse(target);
  if (!parsed.success) return current;
  const next = readQueue(current, now);
  const seen = new Set(next.map(identity));
  let size = bytes(next);
  let added = 0;
  for (const url of urls.slice(0, FORMAT_QUEUE_MAX * 4)) {
    if (added >= FORMAT_QUEUE_ACTION_MAX || next.length >= FORMAT_QUEUE_MAX) break;
    const entry = FormatQueueEntrySchema.safeParse({
      target: parsed.data,
      url,
      addedAt: now.toISOString(),
    });
    if (!entry.success || seen.has(identity(entry.data))) continue;
    const addition = bytes(entry.data) + 1;
    if (size + addition > FORMAT_QUEUE_MAX_BYTES) continue;
    next.push(entry.data);
    seen.add(identity(entry.data));
    size += addition;
    added++;
  }
  return added ? next : current;
}

export function removeFormatCandidate(
  current: readonly FormatQueueEntry[],
  target: FormatVerificationTarget,
  url: string,
): readonly FormatQueueEntry[] {
  const parsed = TargetSchema.safeParse(target);
  const canonical = canonicalDiscoverVisualUrl(url);
  if (!parsed.success || !canonical) return current;
  const key = targetKey(parsed.data);
  const next = current.filter(
    (entry) => entry.url !== canonical || targetKey(entry.target) !== key,
  );
  return next.length === current.length ? current : next;
}
