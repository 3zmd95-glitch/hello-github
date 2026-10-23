"use client";

import {
  CloudConnect,
  useCloudReads,
  useCloudText,
  useCloudView,
} from "@/components/social/workflows/WorkflowCloud";
import { JOURNAL_CAPACITY } from "@/lib/cloudWorkflowJournal";
import { CLOUD_RUNS_MAX, PROOF_CAPACITY, TOMBSTONES_MAX } from "@/lib/cloudWorkflowReconciliation";
import { REGISTRATION_CAPACITY } from "@/lib/cloudWorkflowRegistration";
import type { Gear } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { saveStatus, useStore } from "@/store";
import pkg from "@/package.json";
import { BODY_BYTES_MAX, CONTEXT_BYTES_MAX } from "@/workers/scout/src/social/workflowProtocol";
import ApiKeysCard from "./ApiKeysCard";
import AvatarCard from "./AvatarCard";
import Card from "./Card";
import DataCard from "./DataCard";
import GenresCard from "./GenresCard";

const GEAR_OPTIONS: readonly Exclude<Gear, "any">[] = [
  "phone",
  "lights",
  "camera",
  "gimbal",
  "mic",
];
const GEAR_ICON: Record<Exclude<Gear, "any">, string> = {
  phone: "📱",
  lights: "💡",
  camera: "📷",
  gimbal: "🎥",
  mic: "🎙️",
};

/**
 * The Worker's draft text bound, in UTF-16 units. Not exported by the pinned protocol/snapshot modules (DT-7C-3C
 * record); a Settings test reads the Worker source and fails if this number ever drifts from it.
 */
export const OUTPUT_TEXT_MAX = 4_000;

export default function SettingsScreen() {
  const { t } = useT();
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  /** DT-7C-2A-R1: the latest ordinary save was refused (unreadable storage) or not kept; nothing was overwritten. */
  const saveFailed = saveStatus((s) => s.failed);

  const toggleGear = (g: Gear) => {
    const has = settings.gear.includes(g);
    setSettings({ gear: has ? settings.gear.filter((x) => x !== g) : [...settings.gear, g] });
  };

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl">{t("settings.title")}</h1>
        <p className="text-ink-2 text-sm">{t("settings.sub")}</p>
        {saveFailed && (
          <p role="alert" data-testid="save-failed" className="text-danger text-sm font-semibold">
            {t("settings.saveFailed")}
          </p>
        )}
      </header>

      <AvatarCard />

      <Card title={t("settings.lang")}>
        <Segmented
          name="lang"
          value={settings.lang}
          options={[
            { value: "ar", label: "العربي" },
            { value: "en", label: "English" },
          ]}
          onChange={(lang) => setSettings({ lang })}
        />
      </Card>

      <Card title={t("settings.sound")} note={t("settings.soundDesc")}>
        <Segmented
          name="sound"
          value={settings.sound ? "on" : "off"}
          options={[
            { value: "on", label: `🔊 ${t("settings.on")}` },
            { value: "off", label: `🔇 ${t("settings.off")}` },
          ]}
          onChange={(v) => setSettings({ sound: v === "on" })}
        />
      </Card>

      <Card title={t("settings.reminder")} note={t("settings.reminderNote")}>
        <input
          type="time"
          className="px-input num max-w-[160px]"
          value={settings.reminderTime}
          aria-label={t("settings.reminder")}
          onChange={(e) => {
            if (/^([01]\d|2[0-3]):[0-5]\d$/.test(e.target.value))
              setSettings({ reminderTime: e.target.value });
          }}
        />
      </Card>

      <Card title={t("settings.gear")} note={t("settings.gearNote")}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="gear-list">
          {GEAR_OPTIONS.map((g) => {
            const on = settings.gear.includes(g);
            return (
              <label
                key={g}
                className={`px-inset flex items-center gap-2 ${on ? "border-accent" : ""}`}
                data-testid={`gear-${g}`}
              >
                <input
                  type="checkbox"
                  className="size-5 accent-[var(--accent)]"
                  checked={on}
                  onChange={() => toggleGear(g)}
                />
                <span aria-hidden>{GEAR_ICON[g]}</span>
                <span className="font-semibold">{t(`gear.${g}`)}</span>
              </label>
            );
          })}
        </div>
      </Card>

      <GenresCard />

      <ApiKeysCard />

      <CloudWorkflowsCard />

      <Card title={t("settings.davinci")}>
        <Segmented
          name="davinci"
          value={settings.davinciEdition}
          options={[
            { value: "studio", label: t("settings.studio") },
            { value: "free", label: t("settings.free") },
          ]}
          onChange={(davinciEdition) => setSettings({ davinciEdition })}
        />
      </Card>

      <DataCard />

      <p className="text-muted text-center text-xs">
        {t("app.name")} · <span className="num">{t("settings.version", { v: pkg.version })}</span>
      </p>
    </>
  );
}

/**
 * Cloud workflows (packet DT-7C-3C): the Worker line (origin, never the token), an explicit Check connection (one
 * handshake per click, nothing on mount), the stored-record counts against their limits, and the size limits. Reads
 * only; nothing here sends anything or switches the cloud on.
 */
function CloudWorkflowsCard() {
  const { t, reason } = useCloudText();
  const view = useCloudView();
  // Inert on the server and during hydration, the stored records right after (see useCloudReads).
  const { counts } = useCloudReads();
  const rows = [
    ["registrations", counts.registrations, REGISTRATION_CAPACITY],
    ["proofs", counts.proofs, PROOF_CAPACITY],
    ["tombstones", counts.tombstones, TOMBSTONES_MAX],
    ["runs", counts.runs, CLOUD_RUNS_MAX],
    ["journal", counts.journal, JOURNAL_CAPACITY],
  ] as const;
  const cfg = view.configured;
  return (
    <Card id="cloud-workflows" title={t("settings.cloud.title")} note={t("settings.cloud.note")}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1" data-testid="settings-cloud-connection">
          {cfg.ok ? (
            <CloudConnect view={view} />
          ) : (
            <p
              className="text-ink-2 text-sm"
              data-testid="settings-cloud-config"
              data-state={cfg.reason}
            >
              {cfg.reason === "none"
                ? t("settings.cloud.none")
                : t("workflows.cloud.connect.bad", { reason: reason(cfg.reason) })}
            </p>
          )}
          {view.authority && view.handshake === "ok" && (
            <p className="text-ink-2 text-xs" data-testid="settings-cloud-owner">
              {t("settings.cloud.owner", { owner: view.authority.ownerKey })}
            </p>
          )}
        </div>
        <dl className="flex flex-col gap-1 text-sm" data-testid="settings-cloud-counts">
          {rows.map(([k, n, max]) => (
            <div
              key={k}
              className="flex flex-wrap justify-between gap-2"
              data-testid={`settings-cloud-count-${k}`}
            >
              <dt>{t(`settings.cloud.count.${k}`)}</dt>
              <dd className="num" dir="ltr" data-value={n ?? "unreadable"}>
                {n === null ? t("settings.cloud.unreadable") : t("settings.cloud.of", { n, max })}
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-muted text-xs" data-testid="settings-cloud-limits">
          {t("settings.cloud.limits", {
            output: OUTPUT_TEXT_MAX,
            context: CONTEXT_BYTES_MAX / 1024,
            body: BODY_BYTES_MAX / 1024,
          })}
        </p>
      </div>
    </Card>
  );
}

function Segmented<V extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: V;
  options: { value: V; label: string }[];
  onChange: (v: V) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={name}
      className="border-edge bg-edge flex w-fit max-w-full flex-wrap gap-[2px] rounded-[2px] border-2"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`px-4 py-1.5 text-sm font-bold ${value === o.value ? "bg-gold text-gold-ink" : "bg-panel-2 text-ink-2"}`}
          data-testid={`${name}-${o.value}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
