"use client";

import type { AutoPost } from "@/lib/domain";
import { useT } from "@/lib/i18n";

/** Ordered HTTPS photo sources are kept verbatim; share-page conversion is unsuitable for photos. */
export default function TikTokPhotoEditor({
  auto,
  save,
}: {
  auto: AutoPost;
  save: (patch: Partial<AutoPost>) => void;
}) {
  const { t } = useT();
  const move = (index: number, step: number) => {
    const photos = [...auto.photoUrls];
    [photos[index], photos[index + step]] = [photos[index + step], photos[index]];
    const cover =
      auto.photoCoverIndex === index
        ? index + step
        : auto.photoCoverIndex === index + step
          ? index
          : auto.photoCoverIndex;
    save({ photoUrls: photos, photoCoverIndex: cover });
  };
  return (
    <section className="flex flex-col gap-3" data-testid="autopost-photo-editor">
      <p className="text-muted text-xs">{t("publish.photo.hint")}</p>
      <label className="flex flex-col gap-1 text-xs">
        {t("publish.photo.title")}
        <input
          className="px-input"
          maxLength={90}
          value={auto.photoTitle}
          onChange={(e) => save({ photoTitle: e.target.value })}
          data-testid="autopost-photo-title"
        />
      </label>
      <ol className="flex flex-col gap-2">
        {auto.photoUrls.map((url, index) => (
          <li key={index} className="px-inset flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-xs">
              {t("publish.photo.url", { n: index + 1 })}
              <input
                type="url"
                dir="ltr"
                className="px-input"
                value={url}
                onChange={(e) =>
                  save({
                    photoUrls: auto.photoUrls.map((old, n) => (n === index ? e.target.value : old)),
                  })
                }
                data-testid={`autopost-photo-${index}`}
              />
            </label>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="tiktok-photo-cover"
                  checked={auto.photoCoverIndex === index}
                  onChange={() => save({ photoCoverIndex: index })}
                />
                {t("publish.photo.cover")}
              </label>
              <button
                className="px-btn px-btn-sm"
                type="button"
                disabled={index === 0}
                onClick={() => move(index, -1)}
                aria-label={t("publish.photo.up", { n: index + 1 })}
              >
                ↑
              </button>
              <button
                className="px-btn px-btn-sm"
                type="button"
                disabled={index === auto.photoUrls.length - 1}
                onClick={() => move(index, 1)}
                aria-label={t("publish.photo.down", { n: index + 1 })}
              >
                ↓
              </button>
              <button
                className="px-btn px-btn-sm ms-auto"
                type="button"
                onClick={() =>
                  save({
                    photoUrls: auto.photoUrls.filter((_, n) => n !== index),
                    photoCoverIndex:
                      auto.photoCoverIndex === index
                        ? 0
                        : auto.photoCoverIndex > index
                          ? auto.photoCoverIndex - 1
                          : auto.photoCoverIndex,
                  })
                }
              >
                {t("publish.photo.remove")}
              </button>
            </div>
            {url.startsWith("https://") && (
              <a href={url} target="_blank" rel="noopener noreferrer" className="self-start">
                {/* eslint-disable-next-line @next/next/no-img-element -- Preview user-supplied URLs without an image optimization server. */}
                <img
                  src={url}
                  alt={t("publish.photo.preview", { n: index + 1 })}
                  className="max-h-56 max-w-full rounded object-contain"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              </a>
            )}
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="px-btn px-btn-sm self-start"
        disabled={auto.photoUrls.length >= 35}
        onClick={() => save({ photoUrls: [...auto.photoUrls, ""] })}
        data-testid="autopost-photo-add"
      >
        {t("publish.photo.add", { n: auto.photoUrls.length })}
      </button>
      {auto.tiktokMode === "direct" && (
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={auto.tiktokAutoAddMusic}
            onChange={(e) => save({ tiktokAutoAddMusic: e.target.checked })}
          />
          {t("publish.photo.autoMusic")}
        </label>
      )}
      <p className="text-muted text-xs">{t("publish.photo.description")}</p>
    </section>
  );
}
