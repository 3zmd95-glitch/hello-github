"use client";

import type { AutoReply, DefaultReply } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { ctr, FOLLOW_TITLE } from "@/lib/replies";

/**
 * The rules, Beacons style: a table on wide screens and cards below that. The table starts at xl (1280 px), where the
 * page beside the sidebar reaches its full width; narrower, its nine columns run into each other. Both are rendered
 * (CSS hides one) and share test ids, so tests select the visible one. Columns: content, message, keywords,
 * destination, sends, clicks, click rate, on/off and a ⋯ menu. The default reply is always the last row.
 */
export default function RulesTable({
  automations,
  defaultReply,
  busy,
  errorText,
  onToggle,
  onEdit,
  onDelete,
  onToggleDefault,
  onEditDefault,
}: {
  automations: readonly AutoReply[];
  defaultReply: DefaultReply | undefined;
  busy: boolean;
  errorText: (code: string | undefined) => string;
  onToggle: (a: AutoReply) => void;
  onEdit: (a: AutoReply) => void;
  onDelete: (a: AutoReply) => void;
  onToggleDefault: () => void;
  onEditDefault: () => void;
}) {
  const { t } = useT();
  const d = defaultReply;

  const content = (a: AutoReply) =>
    a.trigger === "message"
      ? t("replies.table.messages")
      : a.postId
        ? (a.title ?? t("replies.table.post"))
        : t("replies.form.anyPost");
  const destination = (a: AutoReply) =>
    a.buttons[0]?.title ?? (a.followButton ? FOLLOW_TITLE : "—");
  const rate = (a: AutoReply) => {
    const r = ctr(a.stats.sends, a.stats.clicks);
    return r === null ? "–" : `${r}%`;
  };
  const thumb = (a: AutoReply) =>
    a.thumbUrl ? (
      // eslint-disable-next-line @next/next/no-img-element -- Instagram CDN thumbnail, expires; no loader
      <img src={a.thumbUrl} alt="" className="h-9 w-9 flex-none rounded object-cover" />
    ) : (
      <span aria-hidden className="w-9 flex-none text-center text-lg">
        {a.trigger === "message" ? "💬" : a.postId ? "📌" : "📣"}
      </span>
    );
  const toggle = (checked: boolean, onChange: () => void, label: string) => (
    <input
      type="checkbox"
      role="switch"
      aria-label={label}
      checked={checked}
      disabled={busy}
      onChange={onChange}
      data-testid="autoreply-toggle"
    />
  );
  const menu = (edit: () => void, remove?: () => void) => (
    <details className="relative">
      <summary
        className="px-btn px-btn-ghost px-btn-sm cursor-pointer list-none"
        aria-label={t("replies.table.more")}
        data-testid="autoreply-menu"
      >
        ⋯
      </summary>
      <div className="px-card absolute end-0 z-10 mt-1 flex min-w-24 flex-col gap-1 p-1">
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm"
          disabled={busy}
          onClick={edit}
          data-testid="autoreply-edit"
        >
          {t("replies.edit")}
        </button>
        {remove && (
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            disabled={busy}
            onClick={remove}
            data-testid="autoreply-delete"
          >
            {t("replies.delete")}
          </button>
        )}
      </div>
    </details>
  );
  const chips = (a: AutoReply) => (
    <div className="flex flex-wrap gap-1">
      {a.keywords.map((k) => (
        <span key={k} className="px-chip text-xs" data-testid="autoreply-keyword">
          {k}
        </span>
      ))}
    </div>
  );
  const lastError = (a: AutoReply) =>
    a.stats.lastError ? (
      <span className="text-danger block text-xs" data-testid="autoreply-last-error">
        {errorText(a.stats.lastError)}
      </span>
    ) : null;

  return (
    <>
      <table className="hidden w-full table-fixed text-sm xl:table" data-testid="autoreplies-table">
        <thead className="text-muted text-xs">
          <tr>
            <th className="w-[22%] p-2 text-start font-normal">{t("replies.table.content")}</th>
            <th className="w-[24%] p-2 text-start font-normal">{t("replies.table.message")}</th>
            <th className="p-2 text-start font-normal">{t("replies.table.keywords")}</th>
            <th className="p-2 text-start font-normal">{t("replies.table.destination")}</th>
            <th className="w-16 p-2 text-start font-normal">{t("replies.table.sends")}</th>
            <th className="w-16 p-2 text-start font-normal">{t("replies.table.clicks")}</th>
            <th className="w-16 p-2 text-start font-normal">{t("replies.table.ctr")}</th>
            <th className="w-14 p-2 text-start font-normal">{t("replies.table.active")}</th>
            <th className="w-12 p-2">
              <span className="sr-only">{t("replies.table.more")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {automations.map((a) => (
            <tr
              key={a.id}
              className="border-edge border-t align-middle"
              data-testid="autoreply-row"
              data-id={a.id}
              data-enabled={a.enabled}
            >
              <td className="p-2">
                <div className="flex min-w-0 items-center gap-2">
                  {thumb(a)}
                  <span className="truncate" dir="auto">
                    {content(a)}
                  </span>
                </div>
              </td>
              <td className="p-2">
                <span className="block truncate" dir="auto">
                  {a.dmText}
                </span>
                {lastError(a)}
              </td>
              <td className="p-2">{chips(a)}</td>
              <td className="truncate p-2">{destination(a)}</td>
              <td className="p-2" data-testid="autoreply-sends">
                <span className="num">{a.stats.sends}</span>
              </td>
              <td className="p-2" data-testid="autoreply-clicks">
                <span className="num">{a.stats.clicks}</span>
              </td>
              <td className="p-2" data-testid="autoreply-ctr">
                <span className="num">{rate(a)}</span>
              </td>
              <td className="p-2">
                {toggle(a.enabled, () => onToggle(a), t("replies.form.enabled"))}
              </td>
              <td className="p-2">
                {menu(
                  () => onEdit(a),
                  () => onDelete(a),
                )}
              </td>
            </tr>
          ))}
          <tr
            className="border-edge border-t align-middle"
            data-testid="autoreply-default-row"
            data-enabled={!!d?.enabled}
          >
            <td className="p-2">
              <div className="flex items-center gap-2">
                <span aria-hidden className="w-9 flex-none text-center text-lg">
                  🕒
                </span>
                <span className="truncate">{t("replies.table.default")}</span>
              </div>
            </td>
            <td className="truncate p-2" dir="auto">
              {d?.text || "—"}
            </td>
            <td className="text-muted p-2 text-xs">{t("replies.table.anyMessage")}</td>
            <td className="text-muted p-2">—</td>
            <td className="p-2" data-testid="autoreply-sends">
              <span className="num">{d?.stats.sends ?? 0}</span>
            </td>
            <td className="text-muted p-2">—</td>
            <td className="text-muted p-2">—</td>
            <td className="p-2">
              {toggle(!!d?.enabled, onToggleDefault, t("replies.table.default"))}
            </td>
            <td className="p-2">{menu(onEditDefault)}</td>
          </tr>
        </tbody>
      </table>

      <ul className="flex flex-col gap-2 xl:hidden" data-testid="autoreplies-cards">
        {automations.map((a) => (
          <li
            key={a.id}
            className="px-inset flex flex-col gap-1.5"
            data-testid="autoreply-row"
            data-id={a.id}
            data-enabled={a.enabled}
          >
            <div className="flex items-center gap-2">
              {thumb(a)}
              <b className="min-w-0 flex-1 truncate text-sm" dir="auto">
                {content(a)}
              </b>
              {toggle(a.enabled, () => onToggle(a), t("replies.form.enabled"))}
              {menu(
                () => onEdit(a),
                () => onDelete(a),
              )}
            </div>
            <p className="text-ink-2 truncate text-xs" dir="auto">
              {a.dmText}
            </p>
            {chips(a)}
            <div className="text-muted flex flex-wrap items-center gap-3 text-xs">
              <span>
                {t("replies.table.sends")}{" "}
                <b className="num" data-testid="autoreply-sends">
                  {a.stats.sends}
                </b>
              </span>
              <span>
                {t("replies.table.clicks")}{" "}
                <b className="num" data-testid="autoreply-clicks">
                  {a.stats.clicks}
                </b>
              </span>
              <span>
                {t("replies.table.ctr")}{" "}
                <b className="num" data-testid="autoreply-ctr">
                  {rate(a)}
                </b>
              </span>
              {lastError(a)}
            </div>
          </li>
        ))}
        <li
          className="px-inset flex flex-col gap-1.5"
          data-testid="autoreply-default-row"
          data-enabled={!!d?.enabled}
        >
          <div className="flex items-center gap-2">
            <span aria-hidden className="w-9 flex-none text-center text-lg">
              🕒
            </span>
            <b className="min-w-0 flex-1 truncate text-sm">{t("replies.table.default")}</b>
            {toggle(!!d?.enabled, onToggleDefault, t("replies.table.default"))}
            {menu(onEditDefault)}
          </div>
          <p className="text-ink-2 truncate text-xs" dir="auto">
            {d?.text || "—"}
          </p>
          <div className="text-muted text-xs">
            {t("replies.table.sends")}{" "}
            <b className="num" data-testid="autoreply-sends">
              {d?.stats.sends ?? 0}
            </b>
          </div>
        </li>
      </ul>
    </>
  );
}
