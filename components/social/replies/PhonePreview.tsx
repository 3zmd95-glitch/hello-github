"use client";

import { Megaphone, Pin } from "lucide-react";
import { useState } from "react";
import Segmented from "@/components/ui/ios/Segmented";
import type { AutoReply } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { messageButtons } from "@/lib/replies";

type Tab = "post" | "comments" | "dm";

/**
 * What people get, on a phone-shaped card (Beacons style): the post, the comment with the public reply under it,
 * and the DM with its buttons. Message rules show the DM only. Buttons are shown by title, as Instagram does.
 */
export default function PhonePreview({
  rule,
  origin,
  username,
}: {
  rule: AutoReply;
  origin?: string;
  username?: string;
}) {
  const { t } = useT();
  const tabs: readonly Tab[] = rule.trigger === "message" ? ["dm"] : ["post", "comments", "dm"];
  const [tab, setTab] = useState<Tab>("dm");
  const shown = tabs.includes(tab) ? tab : "dm";
  const handle = username ?? "3z.prod";
  const word = rule.keywords[0] ?? "لت";
  const pub = rule.publicReplies.find((r) => r.trim())?.replace(/\{username\}/g, "@fan") ?? "";
  const buttons = messageButtons(rule, origin, handle);

  return (
    <div className="flex flex-col items-center gap-2.5" data-testid="autoreply-preview">
      <div className="border-hair bg-panel-2 flex min-h-80 w-full max-w-72 flex-col gap-2 rounded-[28px] border p-3">
        <div className="border-hair flex items-center gap-2 border-b pb-2 text-xs">
          <span
            aria-hidden
            className="bg-fill grid h-7 w-7 place-items-center rounded-full font-bold"
          >
            {handle.slice(0, 1).toUpperCase()}
          </span>
          <b dir="ltr">{handle}</b>
        </div>
        {shown === "post" &&
          (rule.thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Instagram CDN thumbnail, expires; no loader
            <img
              src={rule.thumbUrl}
              alt=""
              className="aspect-square w-full rounded-[14px] object-cover"
            />
          ) : (
            <div className="bg-panel text-muted grid aspect-square place-items-center rounded-[14px]">
              {rule.postId ? (
                <Pin size={32} strokeWidth={1.5} aria-hidden />
              ) : (
                <Megaphone size={32} strokeWidth={1.5} aria-hidden />
              )}
            </div>
          ))}
        {shown === "post" && (
          <p className="text-xs">
            {rule.title ?? t(rule.postId ? "replies.table.post" : "replies.form.anyPost")}
          </p>
        )}
        {shown === "comments" && (
          <div className="flex flex-col gap-2 text-xs" data-testid="autoreply-preview-comments">
            <p>
              <b dir="ltr">@fan</b> <span dir="auto">{word}</span>
            </p>
            {pub ? (
              <p className="ms-4">
                <b dir="ltr">@{handle}</b> <span dir="auto">{pub}</span>
              </p>
            ) : (
              <p className="text-muted ms-4">{t("replies.preview.noPublic")}</p>
            )}
          </div>
        )}
        {shown === "dm" && (
          <div
            className="bg-panel max-w-[85%] self-start rounded-[18px] p-2.5 text-xs shadow-[var(--shadow-sm)]"
            data-testid="autoreply-preview-dm"
          >
            <p className="break-words whitespace-pre-wrap" dir="auto">
              {rule.dmText.trim() || "…"}
            </p>
            {buttons.map((b, i) => (
              <span
                key={i}
                className="border-hair mt-1.5 block rounded-[10px] border p-1.5 text-center font-semibold"
                data-testid="autoreply-preview-button"
              >
                {b.title}
              </span>
            ))}
          </div>
        )}
      </div>
      {tabs.length > 1 && (
        <Segmented
          className="w-full max-w-72"
          label={t("replies.form.preview")}
          value={shown}
          onChange={setTab}
          options={tabs.map((k) => ({
            value: k,
            label: t(`replies.preview.${k}`),
            testId: `autoreply-preview-tab-${k}`,
          }))}
        />
      )}
    </div>
  );
}
