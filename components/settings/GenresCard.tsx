"use client";

import { useId, useState, type FormEvent } from "react";
import { CUSTOM_GENRE_EMOJI, GENRES, isGenreNameTaken } from "@/lib/genres";
import { useT } from "@/lib/i18n";
import { useStore } from "@/store";
import Card from "./Card";

/** Longest name and search words the form takes: a chip label and a search query, not a paragraph. */
const NAME_MAX = 40;
const QUERY_MAX = 80;

/**
 * 🎬 Edit genres (round 31): the built-in genres as read-only chips, the owner's own genres each with a ✕, and
 * the form that adds one (a name plus the search words, used for both languages). Discover and the skill
 * Research panel offer the built-in genres and then the owner's (lib/genres allGenres). The Trend Radar's
 * rows carry only built-in genre ids: the Worker's daily scan searches the bundled list, and the owner's
 * genres never leave this browser. A name that exists already (normalized; custom or built in) is
 * marked on the input, a sentence under the form says so (`genre-exists`), and adding it does nothing.
 */
export default function GenresCard() {
  const { t, L } = useT();
  const custom = useStore((s) => s.customGenres);
  const addCustomGenre = useStore((s) => s.addCustomGenre);
  const removeCustomGenre = useStore((s) => s.removeCustomGenre);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const existsId = useId();

  const ready = Boolean(name.trim() && query.trim());
  const taken = Boolean(name.trim()) && isGenreNameTaken(name, custom);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready || taken) return;
    addCustomGenre(name, query);
    setName("");
    setQuery("");
  };

  return (
    <Card id="genres" title={t("genres.settingsTitle")} note={t("genres.settingsSub")}>
      <div className="flex flex-col gap-1.5">
        <h3 className="text-ink-2 text-xs font-semibold">{t("genres.builtin")}</h3>
        <ul className="flex flex-wrap gap-1.5" data-testid="genres-builtin">
          {GENRES.map((g) => (
            <li key={g.id} className="px-chip" data-testid="genre-builtin" data-genre={g.id}>
              <span aria-hidden>{g.emoji}</span>
              {L(g.name)}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-ink-2 text-xs font-semibold">{t("genres.custom")}</h3>
        {custom.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" data-testid="genres-custom">
            {custom.map((g) => (
              <li
                key={g.id}
                className="px-chip max-w-full gap-1.5 py-0.5 pe-0.5"
                title={g.query}
                data-testid={`settings-genre-${g.id}`}
              >
                <span aria-hidden>{CUSTOM_GENRE_EMOJI}</span>
                <span className="min-w-0 truncate" dir="auto">
                  {g.name}
                </span>
                <span className="text-muted min-w-0 truncate font-normal" dir="auto">
                  {g.query}
                </span>
                <button
                  type="button"
                  className="bg-panel-2 text-ink-2 hover:text-danger grid size-7 shrink-0 place-items-center rounded-[2px] leading-none"
                  onClick={() => removeCustomGenre(g.id)}
                  aria-label={`${t("genres.remove")}: ${g.name}`}
                  title={t("genres.remove")}
                  data-testid="genre-remove"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        <form className="flex flex-wrap gap-2" onSubmit={submit} data-testid="genre-add-form">
          <input
            type="text"
            className={`px-input min-w-[140px] flex-1 ${taken ? "border-danger" : ""}`}
            value={name}
            maxLength={NAME_MAX}
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
            placeholder={t("genres.addName")}
            aria-label={t("genres.addName")}
            aria-invalid={taken || undefined}
            aria-describedby={taken ? existsId : undefined}
            data-testid="genre-add-name"
          />
          <input
            type="text"
            className="px-input min-w-[180px] flex-[2]"
            value={query}
            maxLength={QUERY_MAX}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("genres.addQuery")}
            aria-label={t("genres.addQuery")}
            data-testid="genre-add-query"
          />
          <button
            type="submit"
            className="px-btn shrink-0"
            disabled={!ready}
            data-testid="genre-add"
          >
            {t("genres.add")}
          </button>
        </form>
        {taken && (
          <p id={existsId} role="status" className="text-danger text-xs" data-testid="genre-exists">
            {t("genres.exists")}
          </p>
        )}
      </div>
    </Card>
  );
}
