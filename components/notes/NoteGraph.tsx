"use client";

import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { useMemo, useState } from "react";
import { getProgram, getSkill, programs, skills } from "@/data";
import { useT } from "@/lib/i18n";
import { noteGraph, notesHash, type GraphLink, type GraphNode } from "@/lib/notes";
import { useStore } from "@/store";

type SimNode = GraphNode & SimulationNodeDatum;
type SimLink = SimulationLinkDatum<SimNode> & { kind: GraphLink["kind"] };

const TICKS = 300;
const PAD = 70;
/** Smallest drawing area: a handful of notes stays at a readable size instead of being blown up. */
const MIN_W = 640;
const MIN_H = 420;

/**
 * Settle the graph once (no animation): d3-force's start positions are a fixed spiral and its jiggle is seeded, so
 * the same notes always give the same picture. Islands pull their skills close; note links pull harder across.
 */
function layout(nodes: GraphNode[], links: GraphLink[]) {
  const sim: SimNode[] = nodes.map((n) => ({ ...n }));
  const simLinks: SimLink[] = links.map((l) => ({ ...l }));
  forceSimulation(sim)
    .force(
      "link",
      forceLink<SimNode, SimLink>(simLinks)
        .id((d) => d.id)
        .distance((l) => (l.kind === "island" ? 60 : 150))
        .strength((l) => (l.kind === "island" ? 0.8 : 0.15)),
    )
    .force(
      "charge",
      forceManyBody<SimNode>().strength((d) => (d.kind === "island" ? -420 : -120)),
    )
    .force(
      "collide",
      // Room for the label under each node too.
      forceCollide<SimNode>((d) => (d.kind === "island" ? 40 : d.hasNote ? 30 : 14)),
    )
    .force("x", forceX(0).strength(0.04))
    .force("y", forceY(0).strength(0.06))
    .stop()
    .tick(TICKS);
  const xs = sim.map((n) => n.x ?? 0);
  const ys = sim.map((n) => n.y ?? 0);
  const x0 = Math.min(...xs) - PAD;
  const y0 = Math.min(...ys) - PAD;
  const w = Math.max(Math.max(...xs) + PAD - x0, MIN_W);
  const h = Math.max(Math.max(...ys) + PAD - y0, MIN_H);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const at = new Map(sim.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
  return { at, viewBox: `${cx - w / 2} ${cy - h / 2} ${w} ${h}` };
}

/**
 * 🕸️ Obsidian-style graph of the notes, anchored on the map: squares are islands (programs, in their map color),
 * dots are skills (filled = has a note, hollow = linked to but not written yet), dashed lines tie a skill to its
 * island, gold lines are `[[links]]` between notes. Hover or focus a node to light up its neighbours; a skill dot
 * is a `#skill=<id>` link, so tapping it opens that note.
 */
export default function NoteGraph({ allSkills }: { allSkills: boolean }) {
  const { t, L } = useT();
  const notes = useStore((s) => s.notes);
  const [focus, setFocus] = useState<string | null>(null);

  const graph = useMemo(
    () => noteGraph(notes, skills, programs, { allSkills }),
    [notes, allSkills],
  );
  const { at, viewBox } = useMemo(() => layout(graph.nodes, graph.links), [graph]);
  const near = useMemo(() => {
    if (!focus) return null;
    const set = new Set([focus]);
    for (const l of graph.links) {
      if (l.source === focus) set.add(l.target);
      if (l.target === focus) set.add(l.source);
    }
    return set;
  }, [focus, graph.links]);

  const noteLinks = graph.links.filter((l) => l.kind === "note").length;
  const skillCount = graph.nodes.filter((n) => n.kind === "skill").length;

  if (graph.nodes.length === 0)
    return (
      <p className="px-inset text-ink-2 text-sm" data-testid="note-graph-empty">
        {t("notes.graphEmpty")}
      </p>
    );

  return (
    <svg
      viewBox={viewBox}
      className="note-graph"
      role="group"
      aria-label={t("notes.graphLabel", { n: skillCount, l: noteLinks })}
      data-focus={focus ? "" : undefined}
      data-testid="note-graph"
    >
      <g>
        {graph.links.map((l) => {
          const a = at.get(l.source)!;
          const b = at.get(l.target)!;
          const lit =
            !!near &&
            near.has(l.source) &&
            near.has(l.target) &&
            (l.source === focus || l.target === focus);
          return (
            <line
              key={`${l.source}-${l.target}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className="g-edge"
              data-kind={l.kind}
              data-near={lit ? "" : undefined}
              data-testid={l.kind === "note" ? "note-graph-link" : undefined}
            />
          );
        })}
      </g>
      <g>
        {graph.nodes.map((n) => {
          const p = at.get(n.id)!;
          const program = getProgram(n.programId);
          const color = program?.color ?? "#8397ad";
          const common = {
            className: `g-node ${n.kind === "island" ? "g-island" : ""}`,
            transform: `translate(${p.x} ${p.y})`,
            "data-near": near?.has(n.id) ? "" : undefined,
            onMouseEnter: () => setFocus(n.id),
            onMouseLeave: () => setFocus(null),
            onFocus: () => setFocus(n.id),
            onBlur: () => setFocus(null),
          };
          if (n.kind === "island") {
            const name = program ? L(program.name) : n.programId;
            return (
              <g
                key={n.id}
                {...common}
                tabIndex={0}
                role="img"
                aria-label={t("notes.graphIsland", { name })}
                data-testid="note-graph-island"
                data-program={n.programId}
              >
                <rect
                  x={-14}
                  y={-14}
                  width={28}
                  height={28}
                  rx={3}
                  fill={color}
                  stroke="var(--edge)"
                  strokeWidth={3}
                  className="g-dot"
                />
                <text textAnchor="middle" dominantBaseline="central" fontSize={15}>
                  {program?.icon}
                </text>
                <text y={28} textAnchor="middle" className="g-label">
                  {name}
                </text>
              </g>
            );
          }
          const skill = getSkill(n.id);
          const name = skill ? L(skill.name) : n.id;
          const showLabel = n.hasNote || near?.has(n.id);
          return (
            <a
              key={n.id}
              href={notesHash(n.id)}
              {...common}
              aria-label={t(n.hasNote ? "notes.graphNodeNote" : "notes.graphNodeEmpty", { name })}
              data-testid="note-graph-node"
              data-skill={n.id}
              data-has-note={n.hasNote ? "1" : "0"}
            >
              <circle
                r={n.hasNote ? 8 : 6}
                fill={n.hasNote ? color : "var(--panel)"}
                stroke={n.hasNote ? "var(--edge)" : color}
                strokeWidth={n.hasNote ? 2.5 : 2}
                className="g-dot"
              />
              {showLabel && (
                <text y={20} textAnchor="middle" className="g-label">
                  {name.length > 22 ? `${name.slice(0, 21)}…` : name}
                </text>
              )}
            </a>
          );
        })}
      </g>
    </svg>
  );
}
