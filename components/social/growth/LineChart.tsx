"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { formatDayShort } from "@/components/planner/weekLabel";
import { useT } from "@/lib/i18n";
import { addDays, daysBetween } from "@/lib/streak";
import { fmtCount, fmtTick } from "./format";

export interface ChartPoint {
  day: string;
  value: number;
}

export interface ChartSeries {
  id: string;
  /** Legend / tooltip name. */
  label: string;
  /** 1–2 letter end label that rides the line, so identity never rests on color alone. */
  short: string;
  color: string;
  points: readonly ChartPoint[];
}

const PAD_TOP = 10;
const PAD_BOTTOM = 22;
const PAD_LEFT = 6;
const PAD_RIGHT = 34;

/** Container width via ResizeObserver; a sensible phone width until the first measurement. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(320);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(120, Math.round(el.getBoundingClientRect().width)));
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

/** Three "nice" ticks spanning [min, max] (never NaN, never collapsed). */
function niceTicks(min: number, max: number): { ticks: number[]; lo: number; hi: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { ticks: [0, 1, 2], lo: 0, hi: 2 };
  let span = max - min;
  if (span <= 0) {
    span = Math.max(1, Math.abs(max) * 0.1);
    min -= span / 2;
    max += span / 2;
  }
  const rawStep = (max - min) / 2;
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const norm = rawStep / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.max(0, Math.floor(min / step) * step);
  let hi = Math.ceil(max / step) * step;
  if (hi <= lo) hi = lo + step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 1000 && ticks.length < 6; v += step) ticks.push(v);
  return { ticks, lo, hi };
}

/**
 * A 90-day line chart in pure SVG: one 2px line per series in its brand color, ≥ 8px end markers with a
 * surface ring, hairline solid gridlines, an end label per line, a crosshair + tooltip on hover, and a table
 * view under the plot. Survives zero or one data point without NaN (a single point draws as a marker).
 */
export default function LineChart({
  series,
  today,
  days = 90,
  height = 170,
  title,
  testId,
  className = "",
}: {
  series: readonly ChartSeries[];
  today: string;
  days?: number;
  height?: number;
  /** Accessible name of the figure. */
  title: string;
  testId?: string;
  className?: string;
}) {
  const { t, lang } = useT();
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);

  const from = addDays(today, -days);
  const plotW = Math.max(40, width - PAD_LEFT - PAD_RIGHT);
  const plotH = Math.max(40, height - PAD_TOP - PAD_BOTTOM);

  const withData = series.filter((s) => s.points.length > 0);
  const allValues = withData.flatMap((s) => s.points.map((p) => p.value));
  const { ticks, lo, hi } = niceTicks(Math.min(...allValues), Math.max(...allValues));

  const x = (day: string) =>
    PAD_LEFT + (Math.min(days, Math.max(0, daysBetween(from, day))) / days) * plotW;
  const y = (v: number) => PAD_TOP + plotH - ((v - lo) / (hi - lo || 1)) * plotH;

  const allDays = [...new Set(withData.flatMap((s) => s.points.map((p) => p.day)))].sort();

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (allDays.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = allDays[0];
    let bestD = Infinity;
    for (const d of allDays) {
      const dist = Math.abs(x(d) - px);
      if (dist < bestD) {
        bestD = dist;
        best = d;
      }
    }
    setHover(best);
  };

  const hoverRows = hover
    ? withData
        .map((s) => ({ s, p: s.points.find((p) => p.day === hover) }))
        .filter((r): r is { s: ChartSeries; p: ChartPoint } => r.p !== undefined)
    : [];
  const tipLeft = hover ? Math.min(Math.max(0, x(hover) - 70), Math.max(0, width - 150)) : 0;

  const xLabels = [from, addDays(from, Math.round(days / 2)), today];

  // End labels: nudge colliding ones apart (min 11px) so converging lines still read.
  const labelY = new Map<string, number>();
  const ends = withData
    .map((s) => {
      const last = [...s.points].sort((a, b) => a.day.localeCompare(b.day)).at(-1);
      return { id: s.id, y: last ? y(last.value) : 0 };
    })
    .sort((a, b) => a.y - b.y);
  for (let i = 0; i < ends.length; i++) {
    if (i > 0 && ends[i].y - ends[i - 1].y < 11) ends[i].y = ends[i - 1].y + 11;
  }
  for (const e of ends) labelY.set(e.id, e.y);

  return (
    <div className={`gr-chart flex flex-col gap-2 ${className}`} data-testid={testId} dir="ltr">
      <div ref={ref} className="relative w-full" style={{ height }}>
        {withData.length === 0 ? (
          <p className="text-muted absolute inset-0 grid place-items-center text-sm">
            {t("growth.chart.empty")}
          </p>
        ) : (
          <svg
            role="img"
            aria-label={title}
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className="block overflow-visible"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          >
            {/* Gridlines with tick labels: hairline, solid, recessive. */}
            {ticks.map((v) => (
              <g key={v}>
                <line x1={PAD_LEFT} x2={PAD_LEFT + plotW} y1={y(v)} y2={y(v)} className="gr-grid" />
                <text x={PAD_LEFT} y={y(v) - 3} className="gr-tick num">
                  {fmtTick(v)}
                </text>
              </g>
            ))}
            {/* X labels: start, middle, today. */}
            {xLabels.map((d, i) => (
              <text
                key={d}
                x={x(d)}
                y={height - 6}
                textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
                className="gr-tick"
              >
                {formatDayShort(d, lang)}
              </text>
            ))}
            {/* Crosshair. */}
            {hover && (
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD_TOP}
                y2={PAD_TOP + plotH}
                className="gr-cross"
              />
            )}
            {withData.map((s) => {
              const pts = [...s.points].sort((a, b) => a.day.localeCompare(b.day));
              const d = pts
                .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.day)},${y(p.value)}`)
                .join(" ");
              const last = pts[pts.length - 1];
              const area =
                withData.length === 1 && pts.length > 1
                  ? `${d} L${x(last.day)},${PAD_TOP + plotH} L${x(pts[0].day)},${PAD_TOP + plotH} Z`
                  : null;
              const showAll = pts.length <= 14;
              return (
                <g key={s.id} data-series={s.id}>
                  {area && <path d={area} fill={s.color} opacity={0.1} />}
                  {pts.length > 1 && (
                    <path
                      d={d}
                      fill="none"
                      stroke={s.color}
                      strokeWidth={2}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  )}
                  {pts.map((p) =>
                    showAll || p === last || p.day === hover ? (
                      <circle
                        key={p.day}
                        cx={x(p.day)}
                        cy={y(p.value)}
                        r={p.day === hover ? 5 : 4}
                        fill={s.color}
                        className="gr-marker"
                      />
                    ) : null,
                  )}
                  <text
                    x={x(last.day) + 8}
                    y={(labelY.get(s.id) ?? y(last.value)) + 4}
                    className="gr-endlabel"
                  >
                    {s.short}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
        {hover && hoverRows.length > 0 && (
          <div
            className="gr-tooltip px-inset pointer-events-none absolute top-0 flex flex-col gap-0.5 text-xs"
            style={{ left: tipLeft }}
            role="status"
          >
            <b className="text-ink-2">{formatDayShort(hover, lang)}</b>
            {hoverRows.map(({ s, p }) => (
              <span key={s.id} className="flex items-center gap-1.5">
                <i className="px-pip" style={{ background: s.color }} aria-hidden />
                <span className="text-ink-2">{s.label}</span>
                <b className="num ms-auto">{fmtCount(p.value)}</b>
              </span>
            ))}
          </div>
        )}
      </div>

      {allDays.length > 0 && (
        <details className="gr-table-view text-xs">
          <summary className="text-muted cursor-pointer">{t("growth.chart.table")}</summary>
          <div className="overflow-x-auto">
            <table className="num mt-1 w-full">
              <thead>
                <tr>
                  <th className="text-muted text-start font-normal">{t("growth.col.day")}</th>
                  {withData.map((s) => (
                    <th key={s.id} className="text-muted text-end font-normal">
                      {s.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allDays.map((d) => (
                  <tr key={d}>
                    <td className="text-start">{d}</td>
                    {withData.map((s) => {
                      const p = s.points.find((q) => q.day === d);
                      return (
                        <td key={s.id} className="text-end">
                          {p ? fmtCount(p.value) : "–"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

/** A legend row for ≥ 2 series (a single series is named by the chart's heading). */
export function ChartLegend({ series }: { series: readonly ChartSeries[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-hidden>
      {series.map((s) => (
        <li key={s.id} className="text-ink-2 flex items-center gap-1.5">
          <i className="gr-key" style={{ background: s.color }} />
          {s.label}
          <span className="text-muted">({s.short})</span>
        </li>
      ))}
    </ul>
  );
}
