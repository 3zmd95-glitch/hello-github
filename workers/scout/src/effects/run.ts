/**
 * Trending effects, the daily run (planning/tools/18-trending-effects.md §1): 6 families × 3 searches → candidates →
 * one AI cleanup → the 7-day account history → one KV write (plus the day's attempt count). No YouTube popularity
 * check: changing search samples cannot measure growth. It
 * runs at most once per UTC day unless forced or that day's run failed, at most 3 spending runs a UTC day without
 * force, and never throws: a day that fails keeps the previous chips.
 */

import { TERMS } from "../discover/terms";
import { utcDay } from "../trends/kv";
import { cleanWithAi, type AiVerdict } from "./ai";
import { extractCandidates, type ExtractExtra, type PostCounts } from "./extract";
import { daySlot, familiesForSlot, SLOTS } from "./families";
import { discoverFormats, focusedFormatQuery, FORMAT_VERSION } from "./formats";
import { readEffects, writeEffects } from "./kv";
import { creatorsBetween, daysBetween, mergeHistory, scoreEffects } from "./score";
import { searchFamilies, type EffectsEnv, type FamilyStats } from "./sources";
import {
  IDS_PER_DAY,
  EFFECTS_EVIDENCE_VERSION,
  type Candidate,
  type EffectMeta,
  type EffectPost,
  type EffectSample,
  type EffectsDoc,
  type HistoryEntry,
} from "./types";

/** Candidates the AI sees, the most creators this week first. */
const AI_CANDIDATES = 25;
const ARABIC_LABEL = new Map(TERMS.map((t) => [t.id, t.label.ar]));
/** Spending runs a UTC day without `force`, the 05:35 run included: a run lost before its write (the CPU limit, a
 * dropped request past waitUntil's 30 s) leaves the day open, and each retry would spend its credits again. */
const MAX_ATTEMPTS = 3;
const ATTEMPTS_TTL_S = 172_800;

export type History = Record<string, HistoryEntry[]>;
/** What the AI did today, as counts: verdicts it gave, how many were on dictionary effects, the new names it
 * approved, dropped or merged into another, and why the verdicts it could not use failed ("what.en:too_small"). */
type AiCounts = {
  judged: number;
  dictionary: number;
  approved: number;
  dropped: number;
  merged: number;
  rejects: Record<string, number>;
  /** A category's cleanup (gpt-oss-120b first): the model that answered each batch, "none" when neither did. */
  models?: string[];
};

/** Keep dated evidence across scans and merged spellings before applying the two-link limit. */
const newestSamples = (samples: readonly EffectSample[]): EffectSample[] =>
  samples
    .filter((s) => Number.isFinite(Date.parse(s.published ?? "")))
    .sort((a, b) => Date.parse(b.published!) - Date.parse(a.published!))
    .filter((s, i, all) => all.findIndex((p) => p.url === s.url) === i)
    .slice(0, 2);
/** For the run's log line, to tune the job at the live check: counts and our own dictionary ids, no names. */
export type Memory = {
  keys: number;
  protected: number;
  trimmed: number;
  ai: AiCounts;
  /** Today's creators of each dictionary effect seen today. */
  dictionary: Record<string, number>;
  /** Today's posts: dated within 14 days (kept), older, and with no date. */
  posts: PostCounts;
};
export type Meta = Record<string, EffectMeta>;

/** A day that could not run: the previous page, history and update time stay, with today's date and why. */
export function failed<T extends EffectsDoc = EffectsDoc>(
  prev: T | null,
  today: string,
  now: Date,
  notes: string[],
): T {
  return {
    ...(prev ?? { items: [], meta: {}, history: {} }),
    ranOn: today,
    updatedAt: prev?.updatedAt ?? now.toISOString(),
    status: "failed",
    notes,
  } as T;
}

export const noted = <T extends EffectsDoc>(doc: T, note: string): T => ({
  ...doc,
  notes: [...new Set([...(doc.notes ?? []), note])],
});

/** Counts a spending run against the day's cap, kept under `key` (the day's counter): false at the cap. undefined
 * when the counter can't be read or written: a counter KV can't keep never stops a run (fail-open). */
export async function countAttempt(env: EffectsEnv, key: string): Promise<boolean | undefined> {
  try {
    const used = Number(await env.SOCIAL_KV?.get(key)) || 0;
    if (used >= MAX_ATTEMPTS) return false;
    await env.SOCIAL_KV?.put(key, String(used + 1), { expirationTtl: ATTEMPTS_TTL_S });
    return true;
  } catch {
    return undefined;
  }
}

/** Moves a merged spelling's days into its effect, day by day (new objects: the previous document stays as it was).
 * The effect keeps its own YouTube views; the spelling's were for another query. */
function fold(history: History, from: string, to: string): void {
  const days = new Map((history[to] ?? []).map((e) => [e.day, e]));
  for (const e of history[from] ?? []) {
    const same = days.get(e.day);
    const ids = same ? [...new Set([...same.ids, ...e.ids])].slice(0, IDS_PER_DAY) : e.ids;
    days.set(e.day, { ...same, day: e.day, ids });
  }
  history[to] = [...days.values()];
  delete history[from];
}

/**
 * The AI's verdicts. `sameAs` merges a spelling into the kept effect it names, following chains (a loop merges
 * nothing); otherwise `keep: false` drops the name. A dictionary effect is never merged away or dropped. A merged or
 * dropped name's earlier days follow it, so it never shows on its own again. Returns how many names it merged and
 * dropped, and for each effect that took a spelling the spelling's first-seen day (the earliest of them).
 */
function applyVerdicts(
  cands: Map<string, Candidate>,
  verdicts: Map<string, AiVerdict>,
  history: History,
  meta: Meta,
): { merged: number; dropped: number; firstSeen: Map<string, string> } {
  const counts = { merged: 0, dropped: 0, firstSeen: new Map<string, string>() };
  const next = (key: string) => {
    const to = verdicts.get(key)?.sameAs;
    return to && to !== key && !cands.get(key)?.termId && cands.has(to) ? to : undefined;
  };
  const kept = (key: string) => !!cands.get(key)?.termId || verdicts.get(key)?.keep !== false;
  const rootOf = (key: string) => {
    const seen = new Set([key]);
    let at = key;
    for (let to = next(at); to; to = next(at)) {
      if (seen.has(to)) return undefined;
      seen.add((at = to));
    }
    return at;
  };
  for (const [key, root] of [...cands.keys()].map((k) => [k, rootOf(k)] as const)) {
    const c = cands.get(key)!;
    if (root && root !== key && kept(root)) {
      const into = cands.get(root)!;
      // A creator keeps their latest post day.
      c.days.forEach((day, id) => {
        const was = into.days.get(id);
        if (!was || was < day) into.days.set(id, day);
      });
      const observations = [
        ...(into.observations ?? [...into.days].map(([id, day]) => ({ id, day }))),
        ...(c.observations ?? [...c.days].map(([id, day]) => ({ id, day }))),
      ];
      into.observations = observations.filter(
        (o, i) => observations.findIndex((v) => v.id === o.id && v.day === o.day) === i,
      );
      c.platforms.forEach((p) => into.platforms.add(p));
      into.posts += c.posts;
      into.samples = newestSamples([...into.samples, ...c.samples]);
      // The effect was first seen when its earliest spelling was: a merge never makes it NEW again.
      const since = meta[key]?.firstSeen;
      const was = counts.firstSeen.get(root);
      if (since && (!was || since < was)) counts.firstSeen.set(root, since);
      fold(history, key, root);
      counts.merged++;
    } else if (kept(key)) continue;
    else {
      delete history[key];
      counts.dropped++;
    }
    cands.delete(key);
    delete meta[key];
  }
  return counts;
}

/** Today's figures, with the AI's name and line when it judged the key today, else the ones it was given before. A
 * dictionary effect always keeps the dictionary's own labels (curated Hijazi Arabic), never the AI's name. A new name is
 * first seen today, unless a spelling merged into it today was seen earlier (`merged`: that day). */
function metaOf(
  c: Candidate,
  v: AiVerdict | undefined,
  old: EffectMeta | undefined,
  today: string,
  merged?: string,
): EffectMeta {
  const seen = old?.firstSeen ?? today;
  const ar = c.termId ? ARABIC_LABEL.get(c.termId) : undefined;
  const name = c.termId
    ? { en: c.name, ...(ar ? { ar } : {}) }
    : (v?.name ?? old?.name ?? { en: c.name });
  const what = v?.what ?? old?.what;
  return {
    name,
    ...(what ? { what } : {}),
    ...(c.termId ? { termId: c.termId } : {}),
    checked: v ? v.keep : (old?.checked ?? false),
    platforms: [...c.platforms].sort(),
    posts: c.posts,
    samples: newestSamples([...c.samples, ...(old?.samples ?? [])]),
    firstSeen: merged && merged < seen ? merged : seen,
  };
}

/** The oldest day of a name's history, if it has one. */
const firstDay = (entries: readonly HistoryEntry[] | undefined) =>
  entries?.reduce<string | undefined>((d, e) => (!d || e.day < d ? e.day : d), undefined);

type RunOptions = {
  fetch?: typeof fetch;
  now?: Date;
  force?: boolean;
  /** A manual scan may upgrade today's older technique-only result; cron does not spend again just for migration. */
  upgradeFormats?: boolean;
  /** Each Tavily and YouTube call (default 12 s). */
  timeoutMs?: number;
  /** The AI call, apart, so a short search limit never cuts it (default 60 s). */
  aiTimeoutMs?: number;
};

/** The AI's slots go to the most creators this week (history plus today), so a name that builds slowly across the
 * 3-day rotation still gets judged; on a tie, names the AI never approved go first. A dictionary effect takes a slot
 * only until it has its line (usually its first day): its names are the dictionary's own. */
function forAi(cands: Map<string, Candidate>, prev: EffectsDoc | null, today: string): Candidate[] {
  return [...cands.values()]
    .filter((c) => !(c.termId && prev?.meta[c.key]?.what))
    .map((c) => {
      const week = creatorsBetween(prev?.history[c.key] ?? [], today, 1, 6);
      // Today's creators who posted this week (a post 7–13 days old is remembered, not this week's).
      c.days.forEach((day, id) => {
        if (daysBetween(day, today) <= 6) week.add(id);
      });
      return { c, week: week.size, checked: prev?.meta[c.key]?.checked ? 1 : 0 };
    })
    .sort((a, b) => b.week - a.week || a.checked - b.checked)
    .slice(0, AI_CANDIDATES)
    .map((r) => r.c);
}

/**
 * Today's posts into the memory (planning/tools/18-trending-effects.md §1 steps 2–4; shared with category scans,
 * planning/tools/19-category-trends.md §2): the rule candidates, the AI's cleanup in batches of 9, each key's meta and
 * the 7-day history. Notes "ai_fallback" / "ai_empty" / "ai_partial" go into `notes`. A category passes its camera
 * words and own generic words, its context line for the AI, the model its cleanup asks first and its smaller memory.
 */
export async function rememberPosts(
  env: EffectsEnv,
  prev: EffectsDoc | null,
  today: string,
  posts: readonly EffectPost[],
  notes: Set<string>,
  opts: {
    aiTimeoutMs?: number;
    extract?: ExtractExtra;
    aiContext?: string;
    aiModel?: string;
    maxKeys?: number;
  } = {},
): Promise<{
  cands: Map<string, Candidate>;
  history: History;
  meta: Meta;
  shown: Meta;
  memory: Memory;
}> {
  const { cands, posts: counts } = await extractCandidates(posts, today, opts.extract);
  const top = forAi(cands, prev, today);
  const reply: Awaited<ReturnType<typeof cleanWithAi>> = top.length
    ? await cleanWithAi(
        env,
        top.map((c) => ({ key: c.key, name: c.name, samples: c.samples.map((s) => s.title) })),
        opts.aiTimeoutMs,
        opts.aiContext,
        opts.aiModel,
      )
    : { verdicts: [], rejects: {}, failed: 0 };
  // The AI judged (or had nothing to judge). Otherwise: no answer, or no usable verdict in it.
  const judged = !top.length || !!reply?.verdicts.length;
  if (!judged) notes.add(reply ? "ai_empty" : "ai_fallback");
  // Some batches answered, some not (slow or down): their names wait for another day.
  else if (reply?.failed) notes.add("ai_partial");
  const byKey = new Map((reply?.verdicts ?? []).map((v) => [v.key, v]));
  const history: History = { ...prev?.history };
  const meta: Meta = { ...prev?.meta };
  // Older memories counted unidentified post URLs as accounts, or filed creators under the scan day. Their
  // identities go once when evidenceVersion changes. Each old day stays empty with its legacy YouTube values, so
  // a name this run does not find keeps its meta (approval, name, line) and the day it was first seen.
  if (
    prev?.evidenceVersion !== EFFECTS_EVIDENCE_VERSION ||
    Object.values(meta).some((m) => !m.firstSeen)
  ) {
    for (const [key, m] of Object.entries(meta))
      meta[key] = { ...m, firstSeen: m.firstSeen ?? firstDay(history[key]) ?? today };
    for (const [key, entries] of Object.entries(history))
      history[key] = entries.map(({ day, views7d }) => ({
        day,
        ids: [],
        ...(views7d !== undefined ? { views7d } : {}),
      }));
  }
  const { merged: spellings, dropped, firstSeen } = applyVerdicts(cands, byKey, history, meta);
  const ai: AiCounts = {
    judged: byKey.size,
    dictionary: [...byKey.keys()].filter((k) => cands.get(k)?.termId).length,
    approved: [...cands.values()].filter((c) => !c.termId && byKey.get(c.key)?.keep).length,
    dropped,
    merged: spellings,
    rejects: reply?.rejects ?? {},
    ...(reply?.models ? { models: reply.models } : {}),
  };
  const dictionary = Object.fromEntries(
    [...cands.values()].flatMap((c) => (c.termId ? [[c.termId, c.days.size]] : [])),
  );
  for (const [key, c] of cands)
    meta[key] = metaOf(c, byKey.get(key), meta[key], today, firstSeen.get(key));
  // At the memory's cap, dictionary names stay first, and approved names while seen this week: an older one has no
  // creators in the 7-day window, so it cannot show and competes like any other name.
  const seenThisWeek = (k: string) =>
    cands.has(k) || (history[k] ?? []).some((e) => daysBetween(e.day, today) <= 6);
  const kept = new Set(
    Object.keys(meta).filter((k) => meta[k].termId || (meta[k].checked && seenThisWeek(k))),
  );
  const cut: string[] = [];
  const merged = mergeHistory(history, today, cands, kept, cut, opts.maxKeys);
  for (const key of Object.keys(meta)) if (!merged[key]) delete meta[key];

  // Chips: dictionary effects, plus names the AI approved, today or on an earlier day. A new name it has never
  // judged waits for a day it does, so junk never shows unjudged.
  const shown = Object.fromEntries(Object.entries(meta).filter(([, m]) => m.termId || m.checked));
  return {
    cands,
    history: merged,
    meta,
    shown,
    memory: {
      keys: Object.keys(merged).length,
      protected: kept.size,
      trimmed: cut.length,
      ai,
      dictionary,
      posts: counts,
    },
  };
}

async function scan(
  env: EffectsEnv,
  doFetch: typeof fetch,
  prev: EffectsDoc | null,
  now: Date,
  today: string,
  opts: RunOptions,
): Promise<{ doc: EffectsDoc; credits: number; families: FamilyStats[]; memory?: Memory }> {
  // The first scan (no memory yet: no document, or every run so far failed) searches families 1–6, which hold the
  // owner's two reels (the clone effect, GIF stickers). A day's first run searches the day's 6; another good run that
  // day (Scan again) the next 6, so each tap covers families not yet searched today.
  const slot = !Object.keys(prev?.history ?? {}).length
    ? 0
    : prev?.ranOn === today && prev.status !== "failed"
      ? ((prev.slot ?? daySlot(today)) + 1) % SLOTS
      : daySlot(today);
  const queries = familiesForSlot(slot);
  // Four technique families, one open format-discovery query, and one identity follow-up (or another broad
  // query before a format is known). Still exactly six queries / at most eighteen paid searches.
  const focused = focusedFormatQuery(prev, now, slot);
  if (focused) queries[queries.length - 1] = focused;
  const { posts, credits, errors, families, tight } = await searchFamilies(
    env,
    doFetch,
    queries,
    opts.timeoutMs,
    { now },
  );
  const notes = new Set(errors);
  // Tavily's month nearly spent: a smaller scan, and the list says so.
  if (tight) notes.add("tavily_budget");
  if (!posts.length && errors.length)
    return { doc: failed(prev, today, now, [...notes]), credits, families };

  const {
    history: merged,
    meta,
    shown,
    memory,
  } = await rememberPosts(env, prev, today, posts, notes, { aiTimeoutMs: opts.aiTimeoutMs });
  // Keep the raw posts: the generic extractor deliberately discards song identity. One independent bounded
  // extraction preserves the song + visual pattern instead of merging it into an evergreen technique.
  const { formatNote, ...formats } = await discoverFormats(
    env,
    prev,
    posts,
    now,
    opts.aiTimeoutMs,
    doFetch,
  );
  if (formatNote) notes.add(formatNote);
  // A changing YouTube search sample cannot establish growth. Save those quota calls for actual video searches.
  const items = scoreEffects(merged, shown, today, {});
  return {
    credits,
    families,
    memory,
    doc: {
      ...formats,
      evidenceVersion: EFFECTS_EVIDENCE_VERSION,
      ranOn: today,
      updatedAt: now.toISOString(),
      status: notes.size ? "partial" : "ok",
      ...(notes.size ? { notes: [...notes] } : {}),
      items,
      meta,
      history: merged,
      slot,
    },
  };
}

export async function runEffects(env: EffectsEnv, opts: RunOptions = {}): Promise<EffectsDoc> {
  const now = opts.now ?? new Date();
  const today = utcDay(now);
  // undefined: KV could not be read, so nothing is spent or written over a history this run never saw.
  const prev = await readEffects(env).catch(() => undefined);
  // Once a day, unless forced; a day whose run failed may run again (the dashboard's retry), a good day may not.
  if (
    prev &&
    !opts.force &&
    prev.ranOn === today &&
    prev.status !== "failed" &&
    !(opts.upgradeFormats && prev.formatVersion !== FORMAT_VERSION)
  )
    return prev;
  // A run that would spend counts itself against the day's cap before its first search; force skips the cap.
  const attempt =
    prev === undefined || opts.force ? true : await countAttempt(env, `effects:attempts:${today}`);
  let doc: EffectsDoc;
  let credits = 0;
  let families: FamilyStats[] | undefined;
  let memory: Memory | undefined;
  let error: string | undefined;
  if (prev === undefined) doc = failed(null, today, now, ["kv"]);
  // Over the cap: the stored list (or none yet) says why; nothing is spent or written.
  else if (attempt === false)
    doc = prev ? noted(prev, "attempts") : failed(null, today, now, ["attempts"]);
  else {
    try {
      ({ doc, credits, families, memory } = await scan(
        env,
        opts.fetch ?? fetch,
        prev,
        now,
        today,
        opts,
      ));
    } catch (e) {
      // A code error, not post text; clipped all the same.
      error = (e instanceof Error ? e.message : String(e)).slice(0, 200);
      doc = failed(prev, today, now, ["error"]);
    }
    if (attempt === undefined) doc = noted(doc, "attempts_kv");
  }
  const diagnostics = {
    status: doc.status,
    items: doc.items.length,
    credits,
    notes: doc.notes,
    error,
    families,
    ...memory,
  };
  console.log(JSON.stringify({ effects: diagnostics }));
  // The same counts kept with the list (never names or post text): Workers Logs dropped this line for several live
  // runs, so the live check reads it from KV. The GET answer leaves it out.
  if (attempt !== false) doc = { ...doc, diagnostics };
  if (prev !== undefined && attempt !== false) {
    try {
      await writeEffects(env, doc);
    } catch {
      console.error(JSON.stringify({ effects: { write: "failed" } }));
      doc = noted(doc, "kv"); // the answer says this list was not saved
    }
  }
  return doc;
}
