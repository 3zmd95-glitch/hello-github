"use client";

import { useState } from "react";
import PlatformLinks from "@/components/research/PlatformLinks";
import ScoutResults from "@/components/research/ScoutResults";
import SkillPicker from "@/components/research/SkillPicker";
import YoutubeResults from "@/components/research/YoutubeResults";
import { programs } from "@/data";
import type { Lang, Ref } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { youtubeQuery } from "@/lib/research";
import { useStore } from "@/store";

/**
 * Discover (Scout v0, build plan 1.13): a topic field, an optional program picker, the same platform
 * search links and in-app YouTube results as the skill sheet, TikTok · Instagram results from the Scout
 * Worker (1.14), and "attach to skill" on any result.
 */
export default function DiscoverScreen() {
  const { t, L, lang } = useT();
  const [input, setInput] = useState("");
  const [topic, setTopic] = useState("");
  const [programId, setProgramId] = useState("");
  const [queryLang, setQueryLang] = useState<Lang>(lang);
  const [attachTarget, setAttachTarget] = useState<Ref | null>(null);
  const [attachedUrls, setAttachedUrls] = useState<ReadonlySet<string>>(new Set());

  const recentTopics = useStore((s) => s.recentTopics);
  const addRecentTopic = useStore((s) => s.addRecentTopic);
  const addRef = useStore((s) => s.addRef);

  const commit = (text = input) => {
    const trimmed = text.trim();
    setTopic(trimmed);
    if (trimmed) addRecentTopic(trimmed);
  };

  const topicObj = { ar: topic, en: topic };
  const programHint = programId || undefined;
  const query = topic ? youtubeQuery(topicObj, queryLang, programHint) : "";

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl">{t("discover.title")}</h1>
        <p className="text-ink-2 text-sm">{t("discover.sub")}</p>
      </header>

      <section className="px-card flex flex-col gap-3">
        <input
          type="text"
          className="px-input"
          placeholder={t("discover.topicPh")}
          aria-label={t("discover.title")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onBlur={() => commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          data-testid="discover-topic"
        />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink-2">{t("discover.program")}</span>
          <select
            className="px-input"
            value={programId}
            onChange={(e) => setProgramId(e.target.value)}
            data-testid="discover-program"
          >
            <option value="">{t("discover.programNone")}</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.icon} {L(p.name)}
              </option>
            ))}
          </select>
        </label>

        {recentTopics.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-muted text-xs">{t("discover.recent")}</span>
            <div className="flex flex-wrap gap-2">
              {recentTopics.map((rt) => (
                <button
                  key={rt}
                  type="button"
                  className="px-chip"
                  onClick={() => {
                    setInput(rt);
                    commit(rt);
                  }}
                  data-testid="discover-recent-topic"
                >
                  {rt}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {topic && (
        <section className="px-card flex flex-col gap-3" data-testid="discover-results">
          <PlatformLinks
            topic={topicObj}
            programHint={programHint}
            lang={queryLang}
            onLangChange={setQueryLang}
          />
          <div className="flex flex-col gap-2">
            <h3 className="text-base">{t("research.scoutTitle")}</h3>
            <ScoutResults
              query={query}
              lang={queryLang}
              renderAction={(result) => {
                const attached = attachedUrls.has(result.url);
                return (
                  <button
                    type="button"
                    className="px-btn px-btn-ghost px-btn-sm mt-1"
                    disabled={attached}
                    onClick={() =>
                      setAttachTarget({
                        platform: result.platform,
                        handle: result.handle,
                        title: result.title,
                        url: result.url,
                        ...(result.thumb ? { thumb: result.thumb } : {}),
                      })
                    }
                    data-testid="scout-attach"
                  >
                    {attached ? t("discover.attached") : t("discover.attach")}
                  </button>
                );
              }}
            />
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-base">{t("research.ytResults")}</h3>
            <YoutubeResults
              query={query}
              lang={queryLang}
              renderAction={(video) => {
                const attached = attachedUrls.has(video.url);
                return (
                  <button
                    type="button"
                    className="px-btn px-btn-ghost px-btn-sm mt-1"
                    disabled={attached}
                    onClick={() =>
                      setAttachTarget({
                        platform: "yt",
                        handle: video.channel,
                        title: video.title,
                        url: video.url,
                        ...(video.thumb ? { thumb: video.thumb } : {}),
                      })
                    }
                    data-testid="discover-attach"
                  >
                    {attached ? t("discover.attached") : t("discover.attach")}
                  </button>
                );
              }}
            />
          </div>
        </section>
      )}

      {attachTarget && (
        <SkillPicker
          onClose={() => setAttachTarget(null)}
          onPick={(skillId) => {
            addRef(skillId, attachTarget);
            setAttachedUrls((s) => new Set(s).add(attachTarget.url));
            setAttachTarget(null);
          }}
        />
      )}
    </>
  );
}
