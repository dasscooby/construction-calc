// A foundation laid out the way you'd describe it: the main house (outside length × width), add-ons that
// build off one of its walls, walls inside an add-on given as the bays between them (clear, wall face to
// wall face, with one "the rest" bay), and slabs dropped into the areas the walls close in, each in a pour.
// Turned into wall runs for wallGraph.
//
// Corners of the main house are lettered clockwise from the front left: A front left, B back left,
// C back right, D front right. On the plan the back is up.

import { FaceLine, PieceSpec, PlacedPiece, placePieces } from './layoutPieces';
import type { LayoutRebar } from './layoutRebar';
import { faceAt, Face, GraphResult, Pt, Run, solveGraph } from './wallGraph';

/** Side of the main house, on the plan: top = back (B–C), right = C–D, bottom = front (D–A), left = A–B. */
export type Side = 'top' | 'right' | 'bottom' | 'left';

export const SIDE_NAME: Record<Side, string> = { left: 'left A–B', top: 'back B–C', right: 'right C–D', bottom: 'front D–A' };

export interface AddOnSpec {
  /** The main wall it builds off */
  side: Side;
  /** Along that wall, outside to outside, ft */
  width: number;
  /** Out from that wall's outside face to the outside of the far wall, ft */
  depth: number;
  /** Where it starts along that wall, from the wall's first corner going clockwise (outside), ft */
  from?: number;
  /** Walls inside it run out from the main wall to the far wall ('out', front to back), or across ('across', side to side) */
  inside?: 'out' | 'across';
  /** The bays between them, in order, clear (wall face to wall face); null = the rest. n bays = n − 1 inside walls */
  bays?: (number | null)[];
}

export type SlabSpot = { in: 'main' } | { in: 'addon'; addOn: number; bay: number };

export interface SlabSpec {
  at: SlabSpot;
  thick: number;
  /** Poured with another slab (its pour number); blank = its own pour */
  pour?: number;
}

export interface LayoutSpec {
  /** Outside: length along the back and front, width along the sides, ft */
  house: { length: number; width: number };
  /** Already there, not in this bid: its walls aren't priced, add-ons tie into it */
  existing?: boolean;
  wall: { thick: number; height: number };
  /** Under every wall ("they follow it"); null = no footing */
  footing: { width: number; depth: number } | null;
  addOns: AddOnSpec[];
  slabs: SlabSpec[];
  /** Top of slab below the top of the wall, in (blank: a basement slab sits on the footing, a stem wall slab at the top) */
  slabDropIn?: number;
  /** Slab ledge: the wall cut back this much (in) from the bottom of the slab to the top of the wall where a slab
   *  meets it, so the slab runs over onto it. Blank or 0 = none (layouts saved before ledges). */
  ledgeIn?: number;
  /** What's in a bay with no slab ("container pad", "gravel"), by "addOn:bay" */
  bayLabels?: Record<string, string>;
  /** Steps and pads outside the walls, each its own pour */
  pieces?: PieceSpec[];
  /** The rebar and anchor bolts, as set (none until you add them; layouts saved before this have none) */
  rebar?: LayoutRebar;
  /** "No rebar yet" put away on purpose */
  rebarWarnOff?: boolean;
}

export type EndText = string;

export interface LayoutRun {
  name: string;
  /** "Main", "Add-on", "Add-on 2" */
  group: string;
  measured: number;
  middle: number;
  footingMiddle: number;
  /** Already there, not in the bid */
  existing: boolean;
  /** An add-on builds off it */
  shared: boolean;
  /** How each end meets: "corner", "tee into Main back B–C", "straight on" */
  ends: [EndText, EndText];
}

export interface LayoutSlab {
  name: string;
  /** Pour number for this slab: 1 = the first slab pour */
  pour: number;
  /** Index in spec.slabs */
  index: number;
  face: Face;
  thick: number;
  at: SlabSpot;
}

export interface BayGeom {
  /** Wall faces along the axis, in pairs (bay i from marks[2i] to marks[2i+1]) */
  marks: number[];
  /** 'u' = along the main wall, 'v' = out from it */
  axis: 'u' | 'v';
}

export interface Layout {
  spec: LayoutSpec;
  runs: LayoutRun[];
  graph: GraphResult;
  /** Bays in each add-on, in order: clear width × clear depth (as the plan reads: across × out) */
  bays: { w: number; h: number; given: boolean }[][];
  /** Each add-on in plan */
  addOnGeom: { bays: BayGeom; from: number; width: number; depth: number; at: (u: number, v: number) => Pt; dir: Pt; out: Pt; seeds: Pt[] }[];
  slabs: LayoutSlab[];
  /** Pours in order: footings, walls, then each slab pour */
  pours: string[];
  /** In the bid (existing walls left out) */
  totals: { measured: number; middle: number; footingMiddle: number; bends: number; corners: number; tees: number };
  /** Something that doesn't fit (bays too wide, a slab that isn't in a closed area) */
  problems: string[];
  /** The outside wall faces steps and pads can go on */
  faceLines: FaceLine[];
  /** Steps and pads, placed */
  pieces: PlacedPiece[];
}

/** Origin (the side's first corner, outside), direction along the side, and outward, for a main wall. */
export function frame(spec: LayoutSpec, side: Side) {
  const { length: L, width: W } = spec.house;
  const f = {
    top: { P: { x: 0, y: 0 }, dir: { x: 1, y: 0 } },
    right: { P: { x: L, y: 0 }, dir: { x: 0, y: 1 } },
    bottom: { P: { x: L, y: W }, dir: { x: -1, y: 0 } },
    left: { P: { x: 0, y: W }, dir: { x: 0, y: -1 } },
  }[side];
  const out = { x: f.dir.y, y: -f.dir.x };
  const at = (u: number, v: number): Pt => ({ x: f.P.x + f.dir.x * u + out.x * v, y: f.P.y + f.dir.y * u + out.y * v });
  return { at, dir: f.dir, out };
}

/** Length of the main wall on a side. */
export const sideLength = (spec: LayoutSpec, side: Side) => (side === 'top' || side === 'bottom' ? spec.house.length : spec.house.width);

/**
 * Bays filled in: the one(s) left blank share what's left. Clear room = across the add-on between its
 * side walls (inside walls running out) or from the main wall's face to the far wall's face (across).
 */
export function fillBays(a: AddOnSpec, t: number): { widths: number[]; given: boolean[]; room: number; over: number } {
  const bays = a.bays && a.bays.length ? a.bays : [null];
  const room = (a.inside === 'across' ? a.depth - t : a.width - 2 * t) - (bays.length - 1) * t;
  const known = bays.reduce<number>((s, b) => s + (b ?? 0), 0);
  const blanks = bays.filter((b) => b === null).length;
  const rest = blanks ? (room - known) / blanks : 0;
  // With a "rest" bay anything up to the room fits; without one the bays must add up to the room exactly.
  const over = blanks ? Math.max(0, known - room) : Math.abs(known - room) > 1 / 96 ? known - room : 0;
  return { widths: bays.map((b) => (b === null ? rest : b)), given: bays.map((b) => b !== null), room, over };
}

export function buildLayout(spec: LayoutSpec): Layout {
  const { length: L, width: W } = spec.house;
  const t = spec.wall.thick;
  const h = spec.wall.height;
  const m = t / 2;
  const problems: string[] = [];
  const existing = new Set<Run>();
  const group = new Map<Run, string>();
  const run = (g: string, name: string, a: Pt, b: Pt, measured: number): Run => {
    const r: Run = { id: name, name, a, b, measured, thick: t, height: h, footing: spec.footing };
    group.set(r, g);
    return r;
  };
  // Main, clockwise from A (front left): left A–B, back B–C, right C–D, front D–A.
  const main = {
    left: run('Main', 'Main left A–B', { x: m, y: W - m }, { x: m, y: m }, W),
    top: run('Main', 'Main back B–C', { x: m, y: m }, { x: L - m, y: m }, L),
    right: run('Main', 'Main right C–D', { x: L - m, y: m }, { x: L - m, y: W - m }, W),
    bottom: run('Main', 'Main front D–A', { x: L - m, y: W - m }, { x: m, y: W - m }, L),
  };
  const runs: Run[] = [main.left, main.top, main.right, main.bottom];
  if (spec.existing) runs.forEach((r) => existing.add(r));
  const shared = new Set<Run>();
  const bays: Layout['bays'] = [];
  const addOnGeom: Layout['addOnGeom'] = [];
  spec.addOns.forEach((a, n) => {
    const fr = frame(spec, a.side);
    const at = fr.at;
    const from = a.from ?? 0;
    const D = a.depth;
    const Wd = a.width;
    const g = spec.addOns.length > 1 ? `Add-on ${n + 1}` : 'Add-on';
    shared.add(main[a.side]);
    if (from < -1e-6 || from + Wd > sideLength(spec, a.side) + 1e-6) problems.push(`${g} runs past the end of the main ${SIDE_NAME[a.side]} wall.`);
    runs.push(run(g, `${g} side`, at(from + m, -m), at(from + m, D - m), D));
    runs.push(run(g, `${g} far`, at(from + m, D - m), at(from + Wd - m, D - m), Wd));
    runs.push(run(g, `${g} side`, at(from + Wd - m, D - m), at(from + Wd - m, -m), D));
    const fill = fillBays(a, t);
    if (fill.widths.some((w) => w <= 0) || fill.over > 0) problems.push(`${g}: the bays add up to more than fits. Clear room is ${fmt(fill.room)}.`);
    else if (fill.over < 0) problems.push(`${g}: the bays come to ${fmt(fill.room + fill.over)}, but the clear room is ${fmt(fill.room)}. Leave one blank for the rest.`);
    const across = a.inside === 'across';
    // Wall faces along the axis, from the first face to the last.
    const start = across ? 0 : from + t;
    const marks: number[] = [start];
    let cur = start;
    fill.widths.forEach((w, i) => {
      cur += w;
      marks.push(cur);
      if (i < fill.widths.length - 1) {
        const c = cur + m;
        if (across) runs.push(run(g, `${g} inside ${i + 1}`, at(from + m, c), at(from + Wd - m, c), Wd));
        else runs.push(run(g, `${g} inside ${i + 1}`, at(c, -m), at(c, D - m), D));
        cur += t;
        marks.push(cur);
      }
    });
    const list = fill.widths.map((w, i) => (across ? { w: Wd - 2 * t, h: w, given: fill.given[i] } : { w, h: D - t, given: fill.given[i] }));
    const seeds = fill.widths.map((_, i) => {
      const mid = (marks[2 * i] + marks[2 * i + 1]) / 2;
      return across ? at(from + Wd / 2, mid) : at(mid, (D - t) / 2);
    });
    bays.push(list);
    addOnGeom.push({ bays: { marks, axis: across ? 'v' : 'u' }, from, width: Wd, depth: D, at, dir: fr.dir, out: fr.out, seeds });
  });

  const graph = solveGraph(runs);
  // Slabs, and which pour each is in.
  const slabs: LayoutSlab[] = [];
  const pourOf = new Map<number, number>(); // slab index → pour number
  // Slab 1 is always the main slab (the house); slabs in add-ons are numbered from 2 in the order added.
  let nextAddOn = 2;
  const order = spec.slabs.map((s, i) => ({ s, i })).sort((a, b) => (a.s.at.in === 'main' ? 0 : 1) - (b.s.at.in === 'main' ? 0 : 1) || a.i - b.i);
  order.forEach(({ s, i }) => {
    const seed = s.at.in === 'main' ? { x: L / 2, y: W / 2 } : addOnGeom[s.at.addOn]?.seeds[s.at.bay];
    const k = seed ? faceAt(graph.faces, seed) : -1;
    if (k < 0) {
      problems.push('A slab is not inside a closed area.');
      return;
    }
    const pour = s.at.in === 'main' ? 1 : s.pour && [...pourOf.values()].includes(s.pour) ? s.pour : nextAddOn++;
    pourOf.set(i, pour);
    const name = s.at.in === 'main' ? 'Main slab' : `${spec.addOns.length > 1 ? `Add-on ${s.at.addOn + 1}` : 'Add-on'} slab${bays[s.at.addOn].length > 1 ? `, ${bayName(s.at.bay, bays[s.at.addOn].length, spec.addOns[s.at.addOn])}` : ''}`;
    slabs.push({ name, pour, index: i, face: graph.faces[k], thick: s.thick, at: s.at });
  });

  // The run list, and how each end meets.
  const list: LayoutRun[] = graph.runs.map((r) => ({
    name: r.run.name,
    group: group.get(r.run) ?? '',
    measured: r.run.measured,
    middle: r.middle,
    footingMiddle: r.footingMiddle,
    existing: existing.has(r.run),
    shared: shared.has(r.run),
    ends: r.ends.map((kind, e) => {
      const host = r.hosts[e];
      if (kind === 'corner') return 'corner';
      if (kind === 'tee' && host) return `tee into ${host.name}${existing.has(host) ? ' (existing: dowels)' : ''}`;
      return 'straight on';
    }) as [EndText, EndText],
  }));
  // In the bid: everything but existing walls. Bends: corners between two new walls, a corner against an
  // existing wall, and every tee end of a new wall.
  const newRuns = graph.runs.filter((r) => !existing.has(r.run));
  let corners2 = 0;
  let tees = 0;
  for (const r of newRuns) {
    r.ends.forEach((kind, e) => {
      if (kind === 'tee') tees++;
      if (kind === 'corner') corners2 += r.hosts[e] && existing.has(r.hosts[e]!) ? 2 : 1;
    });
  }
  const corners = Math.round(corners2 / 2);
  const sum = (f: (r: LayoutRun) => number) => list.filter((r) => !r.existing).reduce((s, r) => s + f(r), 0);
  // Outside wall faces, for steps and pads: each main wall, and each add-on's two sides and far wall.
  const word = (v: Pt) => (Math.abs(v.x) > Math.abs(v.y) ? (v.x > 0 ? 'right' : 'left') : v.y > 0 ? 'front' : 'back');
  const faceLines: FaceLine[] = (['left', 'top', 'right', 'bottom'] as Side[]).map((side) => {
    const fr = frame(spec, side);
    return { ref: { main: side }, name: `Main ${SIDE_NAME[side]}`, from: `corner ${SIDE_NAME[side].slice(-3, -2)}`, p0: fr.at(0, 0), u: fr.dir, o: fr.out, length: sideLength(spec, side) };
  });
  addOnGeom.forEach((g, i) => {
    const gname = spec.addOns.length > 1 ? `Add-on ${i + 1}` : 'Add-on';
    const neg = { x: -g.dir.x, y: -g.dir.y };
    faceLines.push({ ref: { addOn: i, wall: 'side1' }, name: `${gname} ${word(neg)} wall`, from: 'the house', p0: g.at(g.from, 0), u: g.out, o: neg, length: g.depth });
    faceLines.push({ ref: { addOn: i, wall: 'far' }, name: `${gname} far wall`, from: `its ${word(neg)} end`, p0: g.at(g.from, g.depth), u: g.dir, o: g.out, length: g.width });
    faceLines.push({ ref: { addOn: i, wall: 'side2' }, name: `${gname} ${word(g.dir)} wall`, from: 'the house', p0: g.at(g.from + g.width, 0), u: g.out, o: g.dir, length: g.depth });
  });
  const pieces = placePieces(spec.pieces ?? [], faceLines, graph.outside);
  for (const pc of pieces) if (pc.problem) problems.push(pc.problem);
  const pours = [
    ...(spec.footing ? ['Footings'] : []),
    'Walls',
    ...[...new Set(slabs.map((s) => s.pour))].sort((a, b) => a - b).map((p) => `Slab ${p}: ${slabs.filter((s) => s.pour === p).map((s) => s.name).join(' + ')}`),
    ...pieces.filter((pc) => pc.layers.length).map((pc) => pc.name),
  ];
  return {
    spec,
    runs: list,
    graph,
    bays,
    addOnGeom,
    slabs,
    pours,
    totals: { measured: sum((r) => r.measured), middle: sum((r) => r.middle), footingMiddle: sum((r) => r.footingMiddle), bends: corners + tees, corners, tees },
    problems,
    faceLines,
    pieces,
  };
}

const fmt = (ft: number) => {
  const whole = Math.floor(ft + 1e-9);
  const inch = Math.round((ft - whole) * 12);
  return inch === 12 ? `${whole + 1}'` : `${whole}'${inch ? ` ${inch}"` : ''}`;
};

/** "left bay", "middle bay", "right bay" (as the plan reads, for the side the add-on is on), or "bay 2" */
export function bayName(i: number, count: number, a: Pick<AddOnSpec, 'side' | 'inside'> = { side: 'top' }): string {
  // Bays run along the main wall going clockwise (left to right on the back, top to bottom on the right,
  // right to left on the front, bottom to top on the left), or out from it (nearest first).
  const along = { top: ['left', 'right'], right: ['top', 'bottom'], bottom: ['right', 'left'], left: ['bottom', 'top'] }[a.side];
  const out = { top: ['bottom', 'top'], right: ['left', 'right'], bottom: ['top', 'bottom'], left: ['right', 'left'] }[a.side];
  const ends = a.inside === 'across' ? out : along;
  if (count === 2) return `${i === 0 ? ends[0] : ends[1]} bay`;
  if (count === 3) return [`${ends[0]} bay`, 'middle bay', `${ends[1]} bay`][i];
  return `bay ${i + 1}`;
}
