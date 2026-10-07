"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { dayKeyToDate, formatDayShort } from "@/components/planner/weekLabel";
import { useInView } from "@/components/ui/ios/useInView";
import { useT } from "@/lib/i18n";
import { prefersReducedMotion } from "@/lib/motion";
import { addDays, daysBetween, TIME_ZONE } from "@/lib/streak";
import { fmtCount, fmtTick } from "./format";

export interface ChartPoint {
  day: string;
  value: number;
}

export interface ChartSeries {
  id: string;
  /** Legend / tooltip name. */
  label: string;
  /** 1–2 letter end label that rides the line when several series share the chart. */
  short: string;
  /** Any CSS color, a token too (`var(--pc-tiktok)`): it is applied through `style`. */
  color: string;
  points: readonly ChartPoint[];
}

const PAD_TOP = 10;
const PAD_BOTTOM = 22;
const PAD_LEFT = 6;
/** Room for the end labels (several series) or just the end dot (one). */
const PAD_RIGHT = 34;
const PAD_RIGHT_ONE = 12;
const MINI_HEIGHT = 70;
const MINI_PAD = 8;
/** The scrub tooltip stays this far from the chart's sides: 60px from the card's edges (16px padding). */
const TIP_MARGIN = 44;
/** A scrub chart keeps this band above the plot for its tooltip, so the tooltip never covers the line. */
const TIP_BAND = 50;
/** The scrub marker and tooltip linger this long after the finger lifts (mockup). */
const HIDE_MS = 900;
/** A finger has to travel this far (px) before it counts as a sideways scrub or a vertical scroll. */
const SLOP = 6;

/**
 * Container width via ResizeObserver. The first measure runs before paint (a layout effect), so a chart never shows
 * one frame at the 320px fallback width.
 */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(320);
  useLayoutEffect(() => {
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

const f1 = (n: number) => n.toFixed(1);
const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);

/**
 * A smooth line through every point (monotone cubic, Steffen's method, as d3's curveMonotoneX): it never overshoots
 * a peak or dips below a flat stretch, and it passes through the data, so the scrub dot always sits on the line.
 * Points are ordered by x; one point gives a bare `M`, two a straight segment.
 */
export function smoothPath(xy: readonly (readonly [number, number])[]): string {
  const n = xy.length;
  if (n === 0) return "";
  const d = `M${f1(xy[0][0])} ${f1(xy[0][1])}`;
  if (n === 1) return d;
  if (n === 2) return `${d} L${f1(xy[1][0])} ${f1(xy[1][1])}`;
  const h = xy.slice(1).map(([x], i) => x - xy[i][0]);
  const s = xy.slice(1).map(([, y], i) => (y - xy[i][1]) / (h[i] || 1));
  const m = xy.map((_, i) => {
    if (i === 0 || i === n - 1) return 0;
    const p = (s[i - 1] * h[i] + s[i] * h[i - 1]) / (h[i - 1] + h[i] || 1);
    return (
      (sign(s[i - 1]) + sign(s[i])) *
      Math.min(Math.abs(s[i - 1]), Math.abs(s[i]), 0.5 * Math.abs(p))
    );
  });
  m[0] = (3 * s[0] - m[1]) / 2;
  m[n - 1] = (3 * s[n - 2] - m[n - 2]) / 2;
  let out = d;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = xy[i];
    const [x1, y1] = xy[i + 1];
    const t = h[i] / 3;
    out += ` C${f1(x0 + t)} ${f1(y0 + m[i] * t)} ${f1(x1 - t)} ${f1(y1 - m[i + 1] * t)} ${f1(x1)} ${f1(y1)}`;
  }
  return out;
}

/** Index of the x closest to `x` (the first one on a tie); -1 for no points. */
export function nearestIndex(xs: readonly number[], x: number): number {
  let best = -1;
  let bestD = Infinity;
  xs.forEach((px, i) => {
    const d = Math.abs(px - x);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** The tooltip's center, kept `margin` from both sides of a `width` wide box. */
export function clampTip(x: number, width: number, margin = TIP_MARGIN): number {
  return Math.max(margin, Math.min(width - margin, x));
}

/** Back to a plain, fully drawn line. */
function settleLine(ln: SVGPathElement) {
  ln.style.strokeDasharray = "";
  ln.style.strokeDashoffset = "";
  ln.style.transition = "";
}

/**
 * The growth line chart in pure SVG, drawn at the box's pixel width (text never scales). Each series is a smooth
 * line in its color; one series also gets a gradient area. On mount (and when the series change) the line draws
 * itself once the chart is on screen: 1.3s, then the area fades in (+0.5s) and the end dot pops (+1.1s); reduced
 * motion or `animate={false}` shows it drawn. `scrub`: a sideways finger (or the mouse) over the chart moves a dashed
 * marker and a ring dot along the first series, with a glass tooltip (value + date) that lingers 900ms after release;
 * a vertical swipe still scrolls the page.
 * `mini`: the 70px sparkline (no grid, ticks, labels or table). A table view under the full chart keeps the numbers
 * readable without a pointer. Zero or one data point never draws NaN (a single point is the end dot alone).
 */
export default function LineChart({
  series,
  today,
  days = 90,
  height = 170,
  title,
  testId,
  className = "",
  scrub = false,
  mini = false,
  animate = true,
  start = true,
}: {
  series: readonly ChartSeries[];
  today: string;
  days?: number;
  /** The plot with its axes; a scrub chart adds the tooltip band above it. */
  height?: number;
  /** Accessible name of the figure; without one (the mini sparkline) the chart is decorative. */
  title?: string;
  testId?: string;
  className?: string;
  scrub?: boolean;
  mini?: boolean;
  /** Draw the line in (else it shows drawn). */
  animate?: boolean;
  /** Hold the draw until true (the calling card has finished its entrance); the chart also waits to be seen. */
  start?: boolean;
}) {
  const { t, lang } = useT();
  const { ref, width } = useWidth<HTMLDivElement>();
  const seen = useInView(ref);
  const svgRef = useRef<SVGSVGElement>(null);
  const markRef = useRef<SVGLineElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef(0);
  /** The finger on a scrub chart: where it went down and, once it has moved far enough, which way it goes. */
  const touch = useRef<{ id: number; x0: number; y0: number; axis: "x" | "y" | null } | null>(null);
  const gradient = `an-g${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  const withData = useMemo(
    () =>
      series
        .filter((s) => s.points.length > 0)
        .map((s) => ({ ...s, points: [...s.points].sort((a, b) => a.day.localeCompare(b.day)) })),
    [series],
  );
  const band = scrub && !mini ? TIP_BAND : 0;
  const h = mini ? MINI_HEIGHT : height + band;
  const padL = mini ? MINI_PAD : PAD_LEFT;
  const padR = mini ? MINI_PAD : withData.length > 1 ? PAD_RIGHT : PAD_RIGHT_ONE;
  const padT = mini ? MINI_PAD : PAD_TOP + band;
  const padB = mini ? MINI_PAD : PAD_BOTTOM;
  const plotW = Math.max(40, width - padL - padR);
  const plotH = Math.max(40, h - padT - padB);
  const base = padT + plotH;

  // Time runs left to right over the last `days` days; the sparkline spans its own first…last day and value range.
  const allDays = [...new Set(withData.flatMap((s) => s.points.map((p) => p.day)))].sort();
  const allValues = withData.flatMap((s) => s.points.map((p) => p.value));
  const from = mini ? (allDays[0] ?? today) : addDays(today, -days);
  const span = mini ? Math.max(1, daysBetween(from, allDays.at(-1) ?? from)) : days;
  const { ticks, lo, hi } = mini
    ? { ticks: [], lo: Math.min(...allValues), hi: Math.max(...allValues) }
    : niceTicks(Math.min(...allValues), Math.max(...allValues));
  const x = (day: string) =>
    padL + (Math.min(span, Math.max(0, daysBetween(from, day))) / span) * plotW;
  const y = (v: number) => base - ((v - lo) / (hi - lo || 1)) * plotH;

  const lines = withData.map((s) => {
    const xy = s.points.map((p): [number, number] => [x(p.day), y(p.value)]);
    const d = smoothPath(xy);
    const end = xy[xy.length - 1];
    const area =
      withData.length === 1 && xy.length > 1
        ? `${d} L${f1(end[0])} ${f1(base)} L${f1(xy[0][0])} ${f1(base)} Z`
        : null;
    return { s, xy, d, end, area };
  });

  // End labels (several series only): nudge colliding ones apart (min 11px) so converging lines still read.
  const labelY = new Map<string, number>();
  if (lines.length > 1) {
    const ends = lines.map((l) => ({ id: l.s.id, y: l.end[1] })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++)
      if (ends[i].y - ends[i - 1].y < 11) ends[i].y = ends[i - 1].y + 11;
    for (const e of ends) labelY.set(e.id, e.y);
  }

  /* ---- Draw-on ---- */
  const draw = animate && !prefersReducedMotion();
  // New numbers draw again; a resize (same numbers, new geometry) does not.
  const drawKey = withData
    .map((s) => `${s.id}:${s.points.length}:${s.points.at(-1)?.day}:${s.points.at(-1)?.value}`)
    .join("|");
  const geometry = lines.map((l) => l.d).join("|");
  /** The drawKey whose draw has begun: it plays to the end on its own. */
  const drawing = useRef<string | null>(null);

  // Hidden before the first paint, so the drawn line never flashes; measured again while it still waits (the width
  // arrives after mount). The cleanup shows a waiting line again: if `draw` turns false meanwhile (reduced motion
  // switched on), nothing else would.
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!draw || !svg || drawing.current === drawKey) return;
    const paths = [...svg.querySelectorAll<SVGPathElement>(".an-chart-ln")];
    for (const ln of paths) {
      const length = ln.getTotalLength();
      ln.style.transition = "none";
      ln.style.strokeDasharray = `${length}`;
      ln.style.strokeDashoffset = `${length}`;
    }
    svg.dataset.drawn = "false";
    return () => {
      if (drawing.current === drawKey) return;
      paths.forEach(settleLine);
      delete svg.dataset.drawn;
    };
  }, [draw, drawKey, geometry]);

  const go = draw && start && seen;
  useEffect(() => {
    const svg = svgRef.current;
    if (!go || !svg || drawing.current === drawKey) return;
    const paths = [...svg.querySelectorAll<SVGPathElement>(".an-chart-ln")];
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        // Begun only now: until this frame the waiting line is still the layout effect's to show again.
        drawing.current = drawKey;
        for (const ln of paths) {
          ln.style.transition = "stroke-dashoffset 1.3s var(--out)";
          ln.style.strokeDashoffset = "0";
        }
        svg.dataset.drawn = "true";
      });
    });
    // Drawn: drop the dash, so a longer line later (a resize) never ends in the dash gap.
    const settle = (e: TransitionEvent) => {
      if (e.propertyName === "stroke-dashoffset") settleLine(e.target as SVGPathElement);
    };
    for (const ln of paths) ln.addEventListener("transitionend", settle);
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
      for (const ln of paths) ln.removeEventListener("transitionend", settle);
      // Stopped mid-draw (reduced motion switched on, a teardown): show it drawn, never stuck dashed or hidden. New
      // numbers have already hidden it again for their own draw (data-drawn "false"): that one stays.
      if (drawing.current === drawKey && svg.dataset.drawn !== "false") {
        paths.forEach(settleLine);
        delete svg.dataset.drawn;
      }
    };
  }, [go, drawKey]);

  /* ---- Scrub ---- */
  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(lang === "ar" ? "ar-u-ca-gregory-nu-latn" : "en-GB", {
        day: "numeric",
        month: "long",
        timeZone: TIME_ZONE,
      }),
    [lang],
  );
  useEffect(() => () => window.clearTimeout(hideTimer.current), []);
  const track = lines[0];
  const scrubAt = (clientX: number) => {
    const svg = svgRef.current;
    const tip = tipRef.current;
    const mark = markRef.current;
    const ring = ringRef.current;
    if (!track || !svg || !tip || !mark || !ring) return;
    const i = nearestIndex(
      track.xy.map(([px]) => px),
      clientX - svg.getBoundingClientRect().left,
    );
    const [px, py] = track.xy[i];
    const point = track.s.points[i];
    mark.setAttribute("x1", f1(px));
    mark.setAttribute("x2", f1(px));
    ring.setAttribute("cx", f1(px));
    ring.setAttribute("cy", f1(py));
    tip.firstElementChild!.textContent = point.value.toLocaleString("en-US");
    tip.lastElementChild!.textContent =
      point.day === today ? t("growth.chart.today") : dateFmt.format(dayKeyToDate(point.day));
    tip.style.left = `${clampTip(px, width)}px`;
    tip.dataset.on = "true";
    svg.dataset.scrubbing = "true";
    window.clearTimeout(hideTimer.current);
  };
  const release = () => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      delete tipRef.current?.dataset.on;
      delete svgRef.current?.dataset.scrubbing;
    }, HIDE_MS);
  };
  // The chart never traps the page scroll (touch-action: pan-y): a finger scrubs only once it has moved sideways
  // (past SLOP, more across than down); a vertical swipe scrolls and the browser cancels the pointer; a tap shows the
  // day under the finger. The mouse scrubs on hover.
  const scrubHandlers = scrub
    ? {
        onPointerDown: (e: PointerEvent<SVGSVGElement>) => {
          if (e.pointerType !== "mouse") {
            // First finger only; capture so a pen released off the chart still ends the gesture (a browser pan
            // cancels the pointer and drops the capture).
            if (!e.isPrimary) return;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            touch.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, axis: null };
            return;
          }
          // Keep following a pressed mouse that slides off the chart.
          e.currentTarget.setPointerCapture?.(e.pointerId);
          scrubAt(e.clientX);
        },
        onPointerMove: (e: PointerEvent<SVGSVGElement>) => {
          if (e.pointerType === "mouse") return scrubAt(e.clientX);
          const g = touch.current;
          if (!g || g.id !== e.pointerId) return;
          if (g.axis === null) {
            const dx = Math.abs(e.clientX - g.x0);
            const dy = Math.abs(e.clientY - g.y0);
            if (Math.max(dx, dy) <= SLOP) return;
            g.axis = dx > dy ? "x" : "y";
          }
          if (g.axis === "x") scrubAt(e.clientX);
        },
        onPointerUp: (e: PointerEvent<SVGSVGElement>) => {
          const g = touch.current;
          touch.current = null;
          if (g?.id === e.pointerId && g.axis === null) scrubAt(e.clientX);
          release();
        },
        onPointerCancel: () => {
          touch.current = null;
          release();
        },
        onPointerLeave: release,
      }
    : {};

  const xLabels = [addDays(today, -days), addDays(today, -Math.round(days / 2)), today];

  return (
    <div className={`an-chart flex flex-col gap-2 ${className}`} data-testid={testId}>
      <div ref={ref} className="relative w-full" style={{ height: h }} dir="ltr">
        {withData.length === 0 ? (
          <p className="text-muted absolute inset-0 grid place-items-center text-sm">
            {t("growth.chart.empty")}
          </p>
        ) : (
          <svg
            ref={svgRef}
            {...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true })}
            width={width}
            height={h}
            viewBox={`0 0 ${width} ${h}`}
            className="block overflow-visible"
            data-scrub={scrub || undefined}
            {...scrubHandlers}
          >
            {!mini && (
              <>
                {/* Gridlines with tick labels: hairline, solid, recessive. */}
                {ticks.map((v) => (
                  <g key={v}>
                    <line
                      x1={padL}
                      x2={padL + plotW}
                      y1={y(v)}
                      y2={y(v)}
                      className="an-chart-grid"
                    />
                    <text x={padL} y={y(v) - 3} className="an-chart-tick num">
                      {fmtTick(v)}
                    </text>
                  </g>
                ))}
                {/* X labels: start, middle, today. */}
                {xLabels.map((d, i) => (
                  <text
                    key={d}
                    x={x(d)}
                    y={h - 6}
                    textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
                    className="an-chart-tick"
                  >
                    {formatDayShort(d, lang)}
                  </text>
                ))}
              </>
            )}
            {lines.map(({ s, xy, d, end, area }) => (
              <g key={s.id} data-series={s.id}>
                {area && (
                  <>
                    <defs>
                      <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" style={{ stopColor: s.color, stopOpacity: 0.3 }} />
                        <stop offset="1" style={{ stopColor: s.color, stopOpacity: 0 }} />
                      </linearGradient>
                    </defs>
                    <path className="an-chart-ar" d={area} fill={`url(#${gradient})`} />
                  </>
                )}
                {xy.length > 1 && (
                  <path className="an-chart-ln" d={d} style={{ stroke: s.color }} />
                )}
                <circle
                  className="an-chart-dot"
                  cx={end[0]}
                  cy={end[1]}
                  r={mini ? 4 : 4.5}
                  style={{ fill: s.color }}
                />
                {lines.length > 1 && (
                  <text
                    x={end[0] + 8}
                    y={(labelY.get(s.id) ?? end[1]) + 4}
                    className="an-chart-end"
                  >
                    {s.short}
                  </text>
                )}
              </g>
            ))}
            {scrub && (
              <>
                <line ref={markRef} className="an-mk" y1={band} y2={base} />
                {/* The ring wears the tracked line's color (the mockup's line and ring are both accent). */}
                <circle ref={ringRef} className="an-mkd" r={5} style={{ stroke: track?.s.color }} />
              </>
            )}
          </svg>
        )}
        {scrub && withData.length > 0 && (
          <div ref={tipRef} className="an-tip glass" aria-hidden>
            <b className="num" />
            <small />
          </div>
        )}
      </div>

      {!mini && allDays.length > 0 && (
        <details className="an-chart-table text-xs">
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
