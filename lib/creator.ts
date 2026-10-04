import type { Lang, Post, Script } from "./domain";
import type { ScoutConfig } from "./scoutClient";
import {
  CreatorDraftSchema,
  CreatorRequestSchema,
  type CreatorDraft,
  type CreatorRequest,
} from "../workers/scout/src/creator/schema";

export type { CreatorDraft, CreatorRequest };
export type CreatorFailure =
  "unconfigured" | "auth" | "network" | "bad_request" | "ai_limit" | "ai_unavailable";

export async function requestCreatorDraft(
  config: ScoutConfig | null,
  input: CreatorRequest,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; draft: CreatorDraft } | { ok: false; error: CreatorFailure }> {
  if (!config) return { ok: false, error: "unconfigured" };
  const parsed = CreatorRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "bad_request" };
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, 35_000);
  try {
    const response = await fetchImpl(`${config.url}/creator/draft`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
      signal: controller.signal,
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return { ok: false, error: "auth" };
      if (response.status === 429) return { ok: false, error: "ai_limit" };
      if (response.status === 400) return { ok: false, error: "bad_request" };
      return { ok: false, error: "ai_unavailable" };
    }
    const body: unknown = await response.json();
    const draft = CreatorDraftSchema.safeParse((body as { draft?: unknown })?.draft);
    return draft.success ? { ok: true, draft: draft.data } : { ok: false, error: "ai_unavailable" };
  } catch {
    return { ok: false, error: "network" };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

/** Snapshot only editable source/target fields; unrelated scheduling changes don't block apply. */
export function creatorSnapshot(post: Post): string {
  return JSON.stringify({
    id: post.id,
    title: post.title,
    platform: post.platform,
    hook: post.hook,
    script: post.script,
    caption: post.caption,
    hashtags: post.hashtags,
    shots: post.shots,
  });
}

export function creatorPatch(
  current: Post | undefined,
  snapshot: string,
  draft: CreatorDraft,
  fields: { script: boolean; caption: boolean; shots: boolean },
  makeId: () => string = () => crypto.randomUUID(),
): Partial<Post> | null {
  if (!current || creatorSnapshot(current) !== snapshot) return null;
  const patch: Partial<Post> = {};
  if (fields.script) {
    patch.hook = draft.hook;
    patch.script = { hook: draft.hook, beats: [...draft.beats], cta: draft.cta };
    if (current.stage === "idea") patch.stage = "script";
  }
  if (fields.caption) {
    patch.caption = draft.caption;
    patch.hashtags = [...draft.hashtags];
  }
  if (fields.shots)
    patch.shots = draft.shots.map((shot) => ({ ...shot, id: makeId(), done: false }));
  return patch;
}

export function scriptText(script: Script): string {
  return [script.hook, ...script.beats, script.cta]
    .map((text) => text.trim())
    .filter(Boolean)
    .join("\n\n");
}

export type ProductionContent = Pick<
  Post,
  "title" | "platform" | "script" | "caption" | "hashtags"
> & {
  shots: ReadonlyArray<Pick<Post["shots"][number], "type" | "text">>;
};
export function productionPack(post: ProductionContent, lang: Lang): string {
  const labels =
    lang === "ar"
      ? [
          "ملف الإنتاج",
          "المنصة",
          "السكريبت",
          "الكابشن",
          "الهاشتاقات المقترحة",
          "قائمة اللقطات",
          "راجع المعلومات والحقوق قبل النشر. أضف الصوت الذي تختاره داخل تيك توك.",
        ]
      : [
          "Production pack",
          "Platform",
          "Script",
          "Caption",
          "Suggested hashtags",
          "Shot list",
          "Review facts and rights before publishing. Add your chosen sound inside TikTok.",
        ];
  return `${labels[0]}: ${post.title}\n${labels[1]}: ${post.platform}\n\n${labels[2]}\n${scriptText(post.script)}\n\n${labels[3]}\n${post.caption}\n\n${labels[4]}\n${post.hashtags.join(" ")}\n\n${labels[5]}\n${post.shots.map((shot, i) => `${i + 1}. [${shot.type}] ${shot.text}`).join("\n")}\n\n${labels[6]}\n`;
}

export interface SubtitleCue {
  startMs: number;
  endMs: number;
  text: string;
}
/** Timing is an estimate from word lengths, never transcription or audio alignment. */
export function estimatedSubtitleCues(text: string, durationSeconds: number): SubtitleCue[] {
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds < 1 ||
    durationSeconds > 3600 ||
    text.length > 20_000
  ) {
    throw new Error("invalid_subtitle_input");
  }
  const words = text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  if (!words.length) return [];
  const segments: string[] = [];
  let line: string[] = [];
  for (const word of words) {
    line.push(word);
    if (line.length >= 7 || line.join(" ").length >= 42 || /[.!?؟،]$/u.test(word)) {
      segments.push(line.join(" "));
      line = [];
    }
  }
  if (line.length) segments.push(line.join(" "));
  const weights = segments.map((segment) => segment.split(/\s+/u).length);
  const total = weights.reduce((a, b) => a + b, 0);
  const durationMs = Math.round(durationSeconds * 1000);
  if (segments.length > durationMs) throw new Error("invalid_subtitle_input");
  let elapsed = 0;
  let used = 0;
  return segments.map((segment, i) => {
    used += weights[i];
    const endMs =
      i === segments.length - 1
        ? durationMs
        : Math.max(
            elapsed + 1,
            Math.min(
              durationMs - (segments.length - i - 1),
              Math.round((durationMs * used) / total),
            ),
          );
    const cue = { startMs: elapsed, endMs, text: segment };
    elapsed = endMs;
    return cue;
  });
}

function timestamp(ms: number, format: "srt" | "vtt"): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor(ms / 60_000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  const pad = (value: number, n = 2) => String(value).padStart(n, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}${format === "srt" ? "," : "."}${pad(ms % 1000, 3)}`;
}

export function subtitleFile(text: string, durationSeconds: number, format: "srt" | "vtt"): string {
  const cues = estimatedSubtitleCues(text, durationSeconds);
  const body = cues
    .map(
      (cue, i) =>
        `${i + 1}\n${timestamp(cue.startMs, format)} --> ${timestamp(cue.endMs, format)}\n${cue.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}\n`,
    )
    .join("\n");
  return `${format === "vtt" ? "WEBVTT\n\n" : ""}${body}`;
}

export function downloadCreatorFile(
  name: string,
  content: string,
  mime = "text/plain;charset=utf-8",
): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
