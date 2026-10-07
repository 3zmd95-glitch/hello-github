"use client";

import { Clock, Ellipsis, Megaphone, MessageCircle, Pencil, Pin, Trash2 } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import Switch from "@/components/ui/ios/Switch";
import type { AutoReply, DefaultReply } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { ctr } from "@/lib/replies";

/**
 * The rules as iOS list rows (round 35; a Beacons table before): the keywords are the title, the DM a one-line
 * preview, and a footnote says what the rule answers with its sends, clicks and click rate. The text opens the
 * editor, the switch turns the rule on or off, the ⋯ menu edits or deletes. The default reply is always the last
 * row. Rows are `<li>`s for a `<ListGroup listAs="ul">`.
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
  /**
   * Which rule a row's controls belong to, in their screen-reader names ("أي بوست · لت"). The first keyword tells
   * apart rules with the same content, such as two "any post" rules.
   */
  const ruleName = (a: AutoReply) => [content(a), a.keywords[0]].filter(Boolean).join(" · ");
  const rate = (a: AutoReply) => {
    const r = ctr(a.stats.sends, a.stats.clicks);
    return r === null ? "–" : `${r}%`;
  };
  const icon = (a: AutoReply) =>
    a.thumbUrl ? (
      // eslint-disable-next-line @next/next/no-img-element -- Instagram CDN thumbnail, expires; no loader
      <img
        src={a.thumbUrl}
        alt=""
        className="h-[34px] w-[34px] flex-none rounded-[10px] object-cover"
      />
    ) : (
      <span className="ios-ic">
        {a.trigger === "message" ? (
          <MessageCircle size={20} strokeWidth={1.75} aria-hidden />
        ) : a.postId ? (
          <Pin size={20} strokeWidth={1.75} aria-hidden />
        ) : (
          <Megaphone size={20} strokeWidth={1.75} aria-hidden />
        )}
      </span>
    );
  const stat = (label: string, value: ReactNode, testId: string) => (
    <>
      {" · "}
      {label}{" "}
      <span className="num font-semibold" data-testid={testId}>
        {value}
      </span>
    </>
  );
  const editItem = (edit: () => void) => (
    <button type="button" disabled={busy} onClick={edit} data-testid="autoreply-edit">
      {t("replies.edit")}
      <Pencil size={17} strokeWidth={1.75} aria-hidden />
    </button>
  );

  return (
    <>
      {automations.map((a) => (
        <Row
          key={a.id}
          icon={icon(a)}
          title={a.keywords.map((k, i) => (
            <Fragment key={k}>
              {i > 0 && " · "}
              <span dir="auto" data-testid="autoreply-keyword">
                {k}
              </span>
            </Fragment>
          ))}
          preview={a.dmText}
          meta={
            <>
              <span dir="auto">{content(a)}</span>
              {stat(t("replies.table.sends"), a.stats.sends, "autoreply-sends")}
              {stat(t("replies.table.clicks"), a.stats.clicks, "autoreply-clicks")}
              {stat(t("replies.table.ctr"), rate(a), "autoreply-ctr")}
              {a.stats.lastError && (
                <span className="text-danger block" data-testid="autoreply-last-error">
                  {errorText(a.stats.lastError)}
                </span>
              )}
            </>
          }
          onOpen={() => onEdit(a)}
          toggle={
            <Switch
              checked={a.enabled}
              onChange={() => onToggle(a)}
              label={`${t("replies.form.enabled")} · ${ruleName(a)}`}
              disabled={busy}
              testId="autoreply-toggle"
            />
          }
          menu={
            <RowMenu label={`${t("replies.table.more")} · ${ruleName(a)}`}>
              {editItem(() => onEdit(a))}
              <button
                type="button"
                className="text-danger"
                disabled={busy}
                onClick={() => onDelete(a)}
                data-testid="autoreply-delete"
              >
                {t("replies.delete")}
                <Trash2 size={17} strokeWidth={1.75} aria-hidden />
              </button>
            </RowMenu>
          }
          data-testid="autoreply-row"
          data-id={a.id}
          data-enabled={a.enabled}
        />
      ))}
      <Row
        icon={
          <span className="ios-ic">
            <Clock size={20} strokeWidth={1.75} aria-hidden />
          </span>
        }
        title={t("replies.table.default")}
        preview={d?.text || "—"}
        meta={
          <>
            {t("replies.table.anyMessage")}
            {stat(t("replies.table.sends"), d?.stats.sends ?? 0, "autoreply-sends")}
          </>
        }
        onOpen={onEditDefault}
        toggle={
          <Switch
            checked={!!d?.enabled}
            onChange={onToggleDefault}
            label={t("replies.table.default")}
            disabled={busy}
            testId="autoreply-toggle"
          />
        }
        menu={
          <RowMenu label={`${t("replies.table.more")} · ${t("replies.table.default")}`}>
            {editItem(onEditDefault)}
          </RowMenu>
        }
        data-testid="autoreply-default-row"
        data-enabled={!!d?.enabled}
      />
    </>
  );
}

/** One rule row: the text is a button that opens the editor; the switch and the ⋯ menu sit beside it. */
function Row({
  icon,
  title,
  preview,
  meta,
  onOpen,
  toggle,
  menu,
  ...rest
}: {
  icon: ReactNode;
  title: ReactNode;
  preview: string;
  meta: ReactNode;
  onOpen: () => void;
  toggle: ReactNode;
  menu: ReactNode;
} & Omit<HTMLAttributes<HTMLLIElement>, "title">) {
  return (
    <li className="ios-row ar-rule" {...rest}>
      {icon}
      <button type="button" className="ios-tx ar-open text-start" onClick={onOpen}>
        <b>{title}</b>
        {/* The owner's own text: its own direction, cut at its end, aligned with the row. The bdi carries the
            direction, so the small keeps the row's and its end padding stays clear of the controls. */}
        <small>
          <bdi className="block truncate [text-align:-webkit-match-parent] [text-align:match-parent]">
            {preview}
          </bdi>
        </small>
        <small className="text-muted mt-0.5 text-xs">{meta}</small>
      </button>
      {/* Over the button's end: beside the title and preview; the footnote runs on under them. */}
      <span className="ar-ctl">
        {toggle}
        {menu}
      </span>
    </li>
  );
}

/**
 * The ⋯ menu, a `<details>` popover: picking an item closes it, and so does a tap elsewhere or Escape. A pick or Escape
 * first hands focus to the ⋯ button, so it does not drop to <body> with the hidden item (an editor sheet opened by the
 * pick gives focus back to that button when it closes).
 */
function RowMenu({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const el = ref.current;
      if (el && !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const shut = (el: HTMLDetailsElement) => {
    el.querySelector("summary")?.focus({ preventScroll: true });
    el.open = false;
  };
  return (
    <details
      ref={ref}
      className="ar-menu"
      onToggle={(e) => setOpen(e.currentTarget.open)}
      onClick={(e) => {
        if ((e.target as Element).closest(".ar-pop button")) shut(e.currentTarget);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && e.currentTarget.open) shut(e.currentTarget);
      }}
    >
      <summary aria-label={label} data-testid="autoreply-menu">
        <Ellipsis size={18} strokeWidth={2} aria-hidden />
      </summary>
      <div className="ar-pop">{children}</div>
    </details>
  );
}
