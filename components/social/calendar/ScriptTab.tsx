"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import type { Post, Script } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { PLATFORM_META, scriptSeconds, scriptWords, suggestStage } from "@/lib/social";
import { useStore } from "@/store";
import CreatorAssistant from "./CreatorAssistant";

/**
 * Hook / 3 beats / CTA, saved on every change. The first words written while the post is still an "idea"
 * move it to "script" (suggestStage), in the same store write.
 */
export default function ScriptTab({ post }: { post: Post }) {
  const { t, L } = useT();
  const updatePost = useStore((s) => s.updatePost);
  const [bumped, setBumped] = useState(false);
  const meta = PLATFORM_META[post.platform];
  const seconds = scriptSeconds(post.script);
  const words = scriptWords(post.script);

  const save = (patch: Partial<Script>) => {
    const script: Script = { ...post.script, ...patch };
    const bump = post.stage === "idea" && suggestStage({ ...post, script }) === "script";
    updatePost(post.id, { script, ...(bump ? { stage: "script" } : {}) });
    if (bump) setBumped(true);
  };
  const setBeat = (i: 0 | 1 | 2, value: string) => {
    const beats: Script["beats"] = [...post.script.beats];
    beats[i] = value;
    save({ beats });
  };

  return (
    <div className="flex flex-col gap-3" data-testid="post-script">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <b className="num text-accent" data-testid="script-length" data-seconds={seconds}>
          {t("calendar.script.length", { s: seconds, w: words })}
        </b>
        <span className="text-muted">
          {t("calendar.script.ideal", { platform: L(meta.name), len: L(meta.idealLength) })}
        </span>
      </div>

      <Field
        id="script-hook"
        label={t("calendar.script.hook")}
        placeholder={t("calendar.script.hookPh")}
        value={post.script.hook}
        onChange={(v) => save({ hook: v })}
      />
      {([0, 1, 2] as const).map((i) => (
        <Field
          key={i}
          id={`script-beat-${i + 1}`}
          label={t("calendar.script.beat", { n: i + 1 })}
          placeholder={t("calendar.script.beatPh")}
          value={post.script.beats[i]}
          onChange={(v) => setBeat(i, v)}
        />
      ))}
      <Field
        id="script-cta"
        label={t("calendar.script.cta")}
        placeholder={t("calendar.script.ctaPh")}
        value={post.script.cta}
        onChange={(v) => save({ cta: v })}
      />

      {bumped && (
        <p className="text-tint flex items-center gap-1 text-xs" data-testid="script-bumped">
          <Check size={14} strokeWidth={2} className="shrink-0" aria-hidden />
          {t("calendar.script.autoBump")}
        </p>
      )}
      <CreatorAssistant key={post.id} post={post} />
    </div>
  );
}

function Field({
  id,
  label,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm" htmlFor={id}>
      <span className="text-ink-2 font-bold">{label}</span>
      <textarea
        id={id}
        rows={2}
        className="px-input cal-textarea"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={id}
      />
    </label>
  );
}
