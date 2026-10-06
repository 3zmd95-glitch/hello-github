/**
 * Trending effects, the daily run (planning/tools/18-trending-effects.md §1): 6 family searches → candidates → one AI
 * cleanup → the 7-day history → a YouTube check of the top 6 → one KV write. It runs at most once per UTC day unless
 * forced and never throws: a day that fails keeps the previous chips.
 */

import { TERMS } from "../discover/terms";
import { utcDay } from "../trends/kv";
import { cleanWithAi, type AiVerdict } from "./ai";
import { extractCandidates } from "./extract";
import { familiesForDay } from "./families";
import { readEffects, writeEffects } from "./kv";
import { mergeHistory, scoreEffects, setViews } from "./score";
import { searchFamilies, youtubeCheck, YT_EFFECTS, type EffectsEnv } from "./sources";
import {
  IDS_PER_DAY,
  type Candidate,
  type EffectMeta,
  type EffectsDoc,
  type HistoryEntry,
} from "./types";

/** Candidates the AI sees, the most creators first. */
const AI_CANDIDATES = 25;
const ARABIC_LABEL = new Map(TERMS.map((t) => [t.id, t.label.ar]));

type History = Record<string, HistoryEntry[]>;
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

/** Moves a merged spelling's days into its effect, day by day (new objects: the previous document stays as it was). */
function fold(history: History, from: string, to: string): void {
  const days = new Map((history[to] ?? []).map((e) => [e.day, e]));
  for (const e of history[from] ?? []) {
    const same = days.get(e.day);
    const ids = same ? [...new Set([...same.ids, ...e.ids])].slice(0, IDS_PER_DAY) : e.ids;
    days.set(e.day, { day: e.day, ids });
  }
  history[to] = [...days.values()];
  delete history[from];
}

/**
 * The AI's verdicts. `sameAs` merges a spelling into the kept effect it names, following chains (a loop merges
 * nothing); otherwise `keep: false` drops the name. A dictionary effect is never merged away or dropped. A merged or
 * dropped name's earlier days follow it, so it never shows on its own again.
 */
function applyVerdicts(
  cands: Map<string, Candidate>,
  verdicts: Map<string, AiVerdict>,
  history: History,
  meta: Meta,
): void {
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
    } else if (kept(key)) continue;
    else delete history[key];
    cands.delete(key);
    delete meta[key];
  }
}

/** Today's figures, with the AI's name and line when it judged the key today, else the ones it was given before. A
 * dictionary effect keeps its own English label (and, without the AI, its Arabic one). */
function metaOf(c: Candidate, v: AiVerdict | undefined, old: EffectMeta | undefined): EffectMeta {
  const ar = c.termId ? ARABIC_LABEL.get(c.termId) : undefined;
  const name = v
    ? { en: c.termId ? c.name : v.name.en, ar: v.name.ar }
    : (old?.name ?? { en: c.name, ...(ar ? { ar } : {}) });
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

async function scan(
  env: EffectsEnv,
  doFetch: typeof fetch,
  prev: EffectsDoc | null,
  now: Date,
  today: string,
  timeoutMs: number | undefined,
): Promise<{ doc: EffectsDoc; credits: number }> {
  const { posts, credits, errors } = await searchFamilies(
    env,
    doFetch,
    familiesForDay(today),
    timeoutMs,
  );
  const notes = new Set(errors);
  if (!posts.length && notes.size) return { doc: failed(prev, today, now, [...notes]), credits };

  const cands = await extractCandidates(posts);
  const top = [...cands.values()].sort((a, b) => b.ids.size - a.ids.size).slice(0, AI_CANDIDATES);
  const verdicts = top.length
    ? await cleanWithAi(
        env,
        top.map((c) => ({ key: c.key, name: c.name, samples: c.samples.map((s) => s.title) })),
        timeoutMs,
      )
    : [];
  if (!verdicts) notes.add("ai_fallback");
  const byKey = new Map((verdicts ?? []).map((v) => [v.key, v]));
  const history: History = { ...prev?.history };
  const meta: Meta = { ...prev?.meta };
  applyVerdicts(cands, byKey, history, meta);
  for (const [key, c] of cands) meta[key] = metaOf(c, byKey.get(key), meta[key]);
  const merged = mergeHistory(history, today, cands);
  for (const key of Object.keys(meta)) if (!merged[key]) delete meta[key];

  // Chips: dictionary effects, plus names the AI kept — none of those on a day the AI failed (unchecked junk waits).
  const shown = Object.fromEntries(
    Object.entries(meta).filter(([, m]) => m.termId || (verdicts && m.checked)),
  );
  const top6 = scoreEffects(merged, shown, today, {}).slice(0, YT_EFFECTS);
  const youtube = await youtubeCheck(
    env,
    doFetch,
    top6.map((i) => ({ key: i.key, en: i.name.en })),
    now,
    timeoutMs,
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

export async function runEffects(
  env: EffectsEnv,
  opts: { fetch?: typeof fetch; now?: Date; force?: boolean; timeoutMs?: number } = {},
): Promise<EffectsDoc> {
  const now = opts.now ?? new Date();
  const today = utcDay(now);
  // undefined: KV could not be read, so nothing is written over a history this run never saw.
  const prev = await readEffects(env).catch(() => undefined);
  if (prev && !opts.force && prev.ranOn === today) return prev;
  let doc = failed(null, today, now, ["kv"]);
  let credits = 0;
  if (prev !== undefined) {
    try {
      ({ doc, credits } = await scan(env, opts.fetch ?? fetch, prev, now, today, opts.timeoutMs));
    } catch {
      doc = failed(prev, today, now, ["error"]);
    }
  }
  console.log(
    JSON.stringify({
      effects: { status: doc.status, items: doc.items.length, credits, notes: doc.notes },
    }),
  );
  if (prev !== undefined)
    await writeEffects(env, doc).catch(() =>
      console.error(JSON.stringify({ effects: { write: "failed" } })),
    );
  return doc;
}
