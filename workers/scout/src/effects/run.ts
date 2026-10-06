/**
 * Trending effects, the daily run (planning/tools/18-trending-effects.md §1): 6 families × 3 searches → candidates →
 * one AI cleanup → the 7-day history → a YouTube check of the top 6 → one KV write (plus the day's attempt count). It
 * runs at most once per UTC day unless forced or that day's run failed, at most 3 spending runs a UTC day without
 * force, and never throws: a day that fails keeps the previous chips.
 */

import { TERMS } from "../discover/terms";
import { utcDay } from "../trends/kv";
import { cleanWithAi, type AiVerdict } from "./ai";
import { extractCandidates } from "./extract";
import { FAMILY_QUERIES, familiesForDay, QUERIES_PER_DAY } from "./families";
import { readEffects, writeEffects } from "./kv";
import { creatorsBetween, daysBetween, mergeHistory, scoreEffects, setViews } from "./score";
import {
  searchFamilies,
  youtubeCheck,
  YT_EFFECTS,
  type EffectsEnv,
  type FamilyStats,
} from "./sources";
import {
  IDS_PER_DAY,
  type Candidate,
  type EffectMeta,
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

type History = Record<string, HistoryEntry[]>;
/** What the AI did today, as counts: verdicts it gave, how many were on dictionary effects, the new names it
 * approved, dropped or merged into another, and why the verdicts it could not use failed ("what.en:too_small"). */
type AiCounts = {
  judged: number;
  dictionary: number;
  approved: number;
  dropped: number;
  merged: number;
  rejects: Record<string, number>;
};
/** For the run's log line, to tune the job at the live check: counts and our own dictionary ids, no names. */
type Memory = {
  keys: number;
  protected: number;
  trimmed: number;
  ai: AiCounts;
  /** Today's creators of each dictionary effect seen today. */
  dictionary: Record<string, number>;
};
type Meta = Record<string, EffectMeta>;

/** A day that could not run: the previous chips, history and update time stay, with today's date and why. */
function failed(prev: EffectsDoc | null, today: string, now: Date, notes: string[]): EffectsDoc {
  return {
    ...(prev ?? { items: [], meta: {}, history: {} }),
    ranOn: today,
    updatedAt: prev?.updatedAt ?? now.toISOString(),
    status: "failed",
    notes,
  };
}

const noted = (doc: EffectsDoc, note: string): EffectsDoc => ({
  ...doc,
  notes: [...new Set([...(doc.notes ?? []), note])],
});

/** Counts a spending run against the day's cap: false at the cap. undefined when the counter can't be read or
 * written: a counter KV can't keep never stops a run (fail-open). */
async function countAttempt(env: EffectsEnv, today: string): Promise<boolean | undefined> {
  const key = `effects:attempts:${today}`;
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
 * dropped.
 */
function applyVerdicts(
  cands: Map<string, Candidate>,
  verdicts: Map<string, AiVerdict>,
  history: History,
  meta: Meta,
): { merged: number; dropped: number } {
  const counts = { merged: 0, dropped: 0 };
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
      c.ids.forEach((id) => into.ids.add(id));
      c.platforms.forEach((p) => into.platforms.add(p));
      into.posts += c.posts;
      for (const s of c.samples)
        if (into.samples.length < 2 && !into.samples.some((x) => x.url === s.url))
          into.samples.push(s);
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
 * dictionary effect always keeps the dictionary's own labels (curated Hijazi Arabic), never the AI's name. */
function metaOf(c: Candidate, v: AiVerdict | undefined, old: EffectMeta | undefined): EffectMeta {
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
    samples: c.samples,
  };
}

type RunOptions = {
  fetch?: typeof fetch;
  now?: Date;
  force?: boolean;
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
      c.ids.forEach((id) => week.add(id));
      return { c, week: week.size, checked: prev?.meta[c.key]?.checked ? 1 : 0 };
    })
    .sort((a, b) => b.week - a.week || a.checked - b.checked)
    .slice(0, AI_CANDIDATES)
    .map((r) => r.c);
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
  // owner's two reels (the clone effect, GIF stickers); then the day's rotation.
  const queries = Object.keys(prev?.history ?? {}).length
    ? familiesForDay(today)
    : FAMILY_QUERIES.slice(0, QUERIES_PER_DAY);
  const { posts, credits, errors, families, tight } = await searchFamilies(
    env,
    doFetch,
    queries,
    opts.timeoutMs,
  );
  const notes = new Set(errors);
  // Tavily's month nearly spent: a smaller scan, and the list says so.
  if (tight) notes.add("tavily_budget");
  if (!posts.length && errors.length)
    return { doc: failed(prev, today, now, [...notes]), credits, families };

  const cands = await extractCandidates(posts);
  const top = forAi(cands, prev, today);
  const reply = top.length
    ? await cleanWithAi(
        env,
        top.map((c) => ({ key: c.key, name: c.name, samples: c.samples.map((s) => s.title) })),
        opts.aiTimeoutMs,
      )
    : { verdicts: [], rejects: {} };
  // The AI judged (or had nothing to judge). Otherwise: no answer, or no usable verdict in it.
  const judged = !top.length || !!reply?.verdicts.length;
  if (!judged) notes.add(reply ? "ai_empty" : "ai_fallback");
  const byKey = new Map((reply?.verdicts ?? []).map((v) => [v.key, v]));
  const history: History = { ...prev?.history };
  const meta: Meta = { ...prev?.meta };
  const { merged: spellings, dropped } = applyVerdicts(cands, byKey, history, meta);
  const ai: AiCounts = {
    judged: byKey.size,
    dictionary: [...byKey.keys()].filter((k) => cands.get(k)?.termId).length,
    approved: [...cands.values()].filter((c) => !c.termId && byKey.get(c.key)?.keep).length,
    dropped,
    merged: spellings,
    rejects: reply?.rejects ?? {},
  };
  const dictionary = Object.fromEntries(
    [...cands.values()].flatMap((c) => (c.termId ? [[c.termId, c.ids.size]] : [])),
  );
  for (const [key, c] of cands) meta[key] = metaOf(c, byKey.get(key), meta[key]);
  // At the memory's cap, dictionary names stay first, and approved names while seen this week: an older one has no
  // creators in the 7-day window, so it cannot show and competes like any other name.
  const seenThisWeek = (k: string) =>
    cands.has(k) || (history[k] ?? []).some((e) => daysBetween(e.day, today) <= 6);
  const kept = new Set(
    Object.keys(meta).filter((k) => meta[k].termId || (meta[k].checked && seenThisWeek(k))),
  );
  const cut: string[] = [];
  const merged = mergeHistory(history, today, cands, kept, cut);
  for (const key of Object.keys(meta)) if (!merged[key]) delete meta[key];

  // Chips: dictionary effects, plus names the AI approved, today or on an earlier day. A new name it has never
  // judged waits for a day it does, so junk never shows unjudged.
  const shown = Object.fromEntries(Object.entries(meta).filter(([, m]) => m.termId || m.checked));
  // YouTube checks the top 6 of the names mentioned today: their views are kept on today's history entry.
  const mentioned = Object.fromEntries(Object.entries(shown).filter(([k]) => cands.has(k)));
  const top6 = scoreEffects(merged, mentioned, today, {}).slice(0, YT_EFFECTS);
  // The name as the rules read it today (a dictionary effect's label): never the AI's renaming, nor the stemmed key,
  // so views7d compares like with like.
  const youtube = await youtubeCheck(
    env,
    doFetch,
    top6.map((i) => ({ key: i.key, en: cands.get(i.key)?.name ?? i.name.en })),
    now,
    opts.timeoutMs,
  );
  setViews(
    merged,
    today,
    Object.fromEntries(Object.entries(youtube.results).map(([k, r]) => [k, r.views7d])),
  );
  youtube.errors.forEach((e) => notes.add(e));
  const items = scoreEffects(merged, shown, today, youtube.results);
  return {
    credits,
    families,
    memory: {
      keys: Object.keys(merged).length,
      protected: kept.size,
      trimmed: cut.length,
      ai,
      dictionary,
    },
    doc: {
      ranOn: today,
      updatedAt: now.toISOString(),
      status: notes.size ? "partial" : "ok",
      ...(notes.size ? { notes: [...notes] } : {}),
      items,
      meta,
      history: merged,
    },
  };
}

export async function runEffects(env: EffectsEnv, opts: RunOptions = {}): Promise<EffectsDoc> {
  const now = opts.now ?? new Date();
  const today = utcDay(now);
  // undefined: KV could not be read, so nothing is spent or written over a history this run never saw.
  const prev = await readEffects(env).catch(() => undefined);
  // Once a day, unless forced; a day whose run failed may run again (the dashboard's retry), a good day may not.
  if (prev && !opts.force && prev.ranOn === today && prev.status !== "failed") return prev;
  // A run that would spend counts itself against the day's cap before its first search; force skips the cap.
  const attempt = prev === undefined || opts.force ? true : await countAttempt(env, today);
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
  console.log(
    JSON.stringify({
      effects: {
        status: doc.status,
        items: doc.items.length,
        credits,
        notes: doc.notes,
        error,
        families,
        ...memory,
      },
    }),
  );
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
