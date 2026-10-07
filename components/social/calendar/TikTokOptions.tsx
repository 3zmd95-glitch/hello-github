"use client";

import { useEffect, useState } from "react";
import { TIKTOK_PRIVACY, type AutoPost } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { PlatformGlyph } from "@/lib/platformIcons";
import { tiktokCreatorInfo, type TikTokCapabilities } from "@/lib/publish";
import { scoutConfig } from "@/lib/scoutClient";
import { useStore } from "@/store";

/** TikTok requires creator-specific privacy choices and explicit review before a direct post. */
export default function TikTokOptions({
  auto,
  save,
}: {
  auto: AutoPost;
  save: (patch: Partial<AutoPost>) => void;
}) {
  const { t } = useT();
  const keys = useStore((s) => s.settings.apiKeys);
  const [loaded, setLoaded] = useState<{ key: string; caps: TikTokCapabilities | null } | null>(
    null,
  );
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([keys.scoutUrl, keys.scoutToken, attempt]);
  useEffect(() => {
    let active = true;
    void tiktokCreatorInfo(scoutConfig(keys.scoutUrl, keys.scoutToken)).then((r) => {
      if (active) setLoaded({ key, caps: r.ok ? r : null });
    });
    return () => {
      active = false;
    };
  }, [key, keys.scoutUrl, keys.scoutToken]);
  const caps = loaded?.key === key ? loaded.caps : null;
  const creator = caps?.creator;
  const direct = auto.tiktokMode === "direct";

  return (
    <section className="px-inset flex flex-col gap-3" data-testid="autopost-tiktok">
      <h3 className="flex items-center gap-1.5 text-sm font-bold">
        <PlatformGlyph platform="tiktok" size={14} className="shrink-0" />
        {t("publish.tt.title")}
      </h3>
      <p className="text-ink-2 text-sm">{t("publish.tt.personal")}</p>
      <select
        className="px-input"
        aria-label={t("publish.tt.mode")}
        value={auto.tiktokMode}
        onChange={(e) => save({ tiktokMode: e.target.value as AutoPost["tiktokMode"] })}
        data-testid="autopost-tt-mode"
      >
        <option value="inbox">{t("publish.tt.mode.inbox")}</option>
        <option value="direct">{t("publish.tt.mode.direct")}</option>
      </select>
      <p className="text-muted text-xs">
        {t(direct ? "publish.tt.directNote" : "publish.tt.inboxNote")}
      </p>
      {caps && (
        <p className="text-muted text-xs" data-testid="autopost-tt-capabilities">
          {t("publish.tt.capabilities", {
            upload: t(caps.canUpload ? "publish.tt.available" : "publish.tt.unavailable"),
            direct: t(caps.canDirectPost ? "publish.tt.available" : "publish.tt.unavailable"),
          })}
        </p>
      )}
      {direct && (
        <>
          {!creator ? (
            <div className="flex flex-col items-start gap-2" role="status">
              <p className="text-danger text-xs">
                {t(loaded?.key === key ? "publish.problem.tiktokCreator" : "publish.tt.loading")}
              </p>
              <button
                className="px-btn px-btn-sm"
                type="button"
                onClick={() => setAttempt((n) => n + 1)}
              >
                {t("publish.hub.refresh")}
              </button>
            </div>
          ) : (
            <>
              <p className="text-sm font-bold" data-testid="autopost-tt-creator">
                {t("publish.tt.postingAs", { name: creator.nickname, username: creator.username })}
              </p>
              <label className="flex flex-col gap-1 text-xs">
                {t("publish.privacy")}
                <select
                  className="px-input"
                  value={auto.tiktokPrivacy}
                  onChange={(e) =>
                    save({ tiktokPrivacy: e.target.value as AutoPost["tiktokPrivacy"] })
                  }
                  data-testid="autopost-tt-privacy"
                >
                  <option value="">{t("publish.tt.choosePrivacy")}</option>
                  {creator.privacyLevels
                    .filter((v): v is (typeof TIKTOK_PRIVACY)[number] =>
                      TIKTOK_PRIVACY.includes(v as (typeof TIKTOK_PRIVACY)[number]),
                    )
                    .map((v) => (
                      <option
                        key={v}
                        value={v}
                        disabled={v === "SELF_ONLY" && auto.tiktokBrandContent}
                      >
                        {t(`publish.tt.privacy.${v}`)}
                      </option>
                    ))}
                </select>
              </label>
              {auto.mediaKind === "video" && (
                <label className="flex flex-col gap-1 text-xs">
                  {t("publish.tt.duration", { max: creator.maxVideoDurationSeconds })}
                  <input
                    className="px-input"
                    type="number"
                    min="0.1"
                    step="0.1"
                    max={creator.maxVideoDurationSeconds}
                    value={auto.durationSeconds ?? ""}
                    onChange={(e) =>
                      save({
                        durationSeconds:
                          Number(e.target.value) > 0 ? Number(e.target.value) : undefined,
                      })
                    }
                    data-testid="autopost-tt-duration"
                  />
                </label>
              )}
              <fieldset className="flex flex-col gap-1.5 text-xs">
                <legend className="mb-1 font-bold">{t("publish.tt.interactions")}</legend>
                {(
                  [
                    ["tiktokAllowComment", "comment", creator.commentDisabled],
                    ["tiktokAllowDuet", "duet", creator.duetDisabled || auto.mediaKind === "photo"],
                    [
                      "tiktokAllowStitch",
                      "stitch",
                      creator.stitchDisabled || auto.mediaKind === "photo",
                    ],
                  ] as const
                )
                  .filter(([, label]) => auto.mediaKind !== "photo" || label === "comment")
                  .map(([field, label, disabled]) => (
                    <label key={field} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!disabled && auto[field]}
                        disabled={disabled}
                        onChange={(e) => save({ [field]: e.target.checked })}
                      />
                      {t(`publish.tt.${label}`)}
                      {disabled ? ` · ${t("publish.tt.disabledByCreator")}` : ""}
                    </label>
                  ))}
              </fieldset>
            </>
          )}
          <fieldset className="flex flex-col gap-1.5 text-xs">
            <legend className="mb-1 font-bold">{t("publish.tt.disclosure")}</legend>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={auto.tiktokBrandOrganic}
                onChange={(e) => save({ tiktokBrandOrganic: e.target.checked })}
              />
              {t("publish.tt.ownBrand")}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={auto.tiktokBrandContent}
                onChange={(e) =>
                  save({
                    tiktokBrandContent: e.target.checked,
                    ...(e.target.checked && auto.tiktokPrivacy === "SELF_ONLY"
                      ? { tiktokPrivacy: "" as const }
                      : {}),
                  })
                }
              />
              {t("publish.tt.branded")}
            </label>
            {(auto.tiktokBrandOrganic || auto.tiktokBrandContent) && (
              <p className="text-muted">
                {t(
                  auto.tiktokBrandContent ? "publish.tt.paidPartnership" : "publish.tt.promotional",
                )}
              </p>
            )}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={auto.tiktokIsAigc}
                onChange={(e) => save({ tiktokIsAigc: e.target.checked })}
              />
              {t("publish.tt.aigc")}
            </label>
          </fieldset>
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={auto.tiktokConsent}
              onChange={(e) => save({ tiktokConsent: e.target.checked })}
              data-testid="autopost-tt-consent"
            />
            <span>
              {t("publish.tt.consent")}{" "}
              <a
                className="px-link"
                href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("publish.tt.musicTerms")}
              </a>
              {auto.tiktokBrandContent && (
                <>
                  {" "}
                  ·{" "}
                  <a
                    className="px-link"
                    href="https://www.tiktok.com/legal/page/global/bc-policy/en"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("publish.tt.brandedTerms")}
                  </a>
                </>
              )}
            </span>
          </label>
        </>
      )}
    </section>
  );
}
