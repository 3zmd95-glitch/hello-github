"use client";

import type { Lang } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { hashtagSlug, searchLinks, type Topic } from "@/lib/research";

/**
 * The three research platform buttons (YouTube · TikTok · Instagram) plus a small AR/EN toggle for the
 * query language, and the Instagram hashtag page underneath (EN-derived slug, so it doesn't move with
 * the toggle). Shared by the skill sheet's Research panel and the Discover screen.
 */
export default function PlatformLinks({
  topic,
  programHint,
  lang,
  onLangChange,
}: {
  topic: Topic;
  programHint?: string;
  lang: Lang;
  onLangChange: (lang: Lang) => void;
}) {
  const { t } = useT();
  const links = searchLinks(topic, programHint);
  const platforms = [
    { key: "yt" as const, icon: "▶️", label: "YouTube", href: links.yt[lang] },
    { key: "tt" as const, icon: "🎵", label: "TikTok", href: links.tt[lang] },
    { key: "ig" as const, icon: "📸", label: "Instagram", href: links.igKeyword[lang] },
  ];
  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        aria-label={t("research.lang")}
        className="border-edge bg-edge flex w-fit gap-[2px] rounded-[2px] border-2"
      >
        {(["ar", "en"] as const).map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={lang === l}
            onClick={() => onLangChange(l)}
            className={`num px-2.5 py-1 text-xs font-bold ${l === lang ? "bg-gold text-gold-ink" : "bg-panel-2 text-ink-2"}`}
            data-testid={`research-lang-${l}`}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {platforms.map((p) => (
          <a
            key={p.key}
            href={p.href}
            target="_blank"
            rel="noopener noreferrer"
            className="px-btn px-btn-ghost px-btn-sm no-underline"
            data-testid={`research-link-${p.key}`}
          >
            {p.icon} {p.label}
          </a>
        ))}
      </div>
      <a
        href={links.igHashtag}
        target="_blank"
        rel="noopener noreferrer"
        className="px-link w-fit text-xs"
        data-testid="research-link-ig-hashtag"
      >
        #{hashtagSlug(topic.en)}
      </a>
    </div>
  );
}
