// A foundation laid out the way you'd describe it: the house (outside length × width), add-ons that
// share a side of it, walls inside an add-on placed by their clear distance (face to face), and slabs
// dropped into the areas the walls close in, each its own pour. Turned into wall runs for wallGraph.
//
// Sizes are outside to outside for the house and add-ons; inside walls are placed face to face.

import { faceAt, Face, GraphResult, Pt, Run, solveGraph } from './wallGraph';

export type Side = 'top' | 'right' | 'bottom' | 'left';

export interface InsideWall {
  /** Clear distance from the face of what it's measured from, ft */
  clear: number;
  /** The add-on's side wall at the start of the shared side, the one at the end, or another inside wall (its index) */
  from: 'start' | 'end' | number;
}

export interface AddOnSpec {
  side: Side;
  /** Along the shared side, outside to outside, ft */
  width: number;
  /** Out from the house wall's outside face to the outside of the far wall, ft */
  depth: number;
  /** How far along the shared side it starts (from the side's first corner, clockwise), ft */
  from?: number;
  walls?: InsideWall[];
}

export type SlabSpot = { in: 'house' } | { in: 'addon'; addOn: number; bay: number };

export interface LayoutSpec {
  /** Outside: length along the top, width down the side, ft */
  house: { length: number; width: number };
  wall: { thick: number; height: number };
  /** Under every wall ("they follow it"); null = no footing */
  footing: { width: number; depth: number } | null;
  addOns: AddOnSpec[];
  slabs: { at: SlabSpot; thick: number }[];
}

export interface LayoutRun {
  name: string;
  measured: number;
  middle: number;
  footingMiddle: number;
}

export interface LayoutSlab {
  name: string;
  /** 1 = first pour, 2 = second ... in the order you added them */
  pour: number;
  face: Face;
  thick: number;
}

export interface Layout {
  spec: LayoutSpec;
  runs: LayoutRun[];
  graph: GraphResult;
  /** Bays in each add-on, left to right along the shared side: clear width × clear depth */
  bays: { w: number; h: number }[][];
  slabs: LayoutSlab[];
  totals: { measured: number; middle: number; footingMiddle: number; bends: number };
  /** Something that doesn't fit (inside walls too close, a slab that isn't in a closed area) */
  problems: string[];
}

const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];

/** Origin (the side's first corner, outside), direction along the side, and outward, for a house side. */
function frame(spec: LayoutSpec, side: Side) {
  const { length: L, width: W } = spec.house;
  const f = {
    top: { P: { x: 0, y: 0 }, dir: { x: 1, y: 0 } },
    right: { P: { x: L, y: 0 }, dir: { x: 0, y: 1 } },
    bottom: { P: { x: L, y: W }, dir: { x: -1, y: 0 } },
    left: { P: { x: 0, y: W }, dir: { x: 0, y: -1 } },
  }[side];
  const out = { x: f.dir.y, y: -f.dir.x };
  return (u: number, v: number): Pt => ({ x: f.P.x + f.dir.x * u + out.x * v, y: f.P.y + f.dir.y * u + out.y * v });
}

/** Where each inside wall's middle sits along the shared side (u), in order of the list. */
function insideAt(a: AddOnSpec, t: number): number[] {
  const from = a.from ?? 0;
  const out: number[] = [];
  (a.walls ?? []).forEach((w) => {
    if (w.from === 'start') out.push(from + t + w.clear + t / 2);
    else if (w.from === 'end') out.push(from + a.width - t - w.clear - t / 2);
    else {
      const base = out[w.from];
      // Measured from the face of another inside wall, on the far side of it from the start.
      out.push(base === undefined ? NaN : base + t / 2 + w.clear + t / 2);
    }
  });
  return out;
}

export function buildLayout(spec: LayoutSpec): Layout {
  const { length: L, width: W } = spec.house;
  const t = spec.wall.thick;
  const h = spec.wall.height;
  const problems: string[] = [];
  const run = (name: string, a: Pt, b: Pt, measured: number): Run => ({ id: name, name, a, b, measured, thick: t, height: h, footing: spec.footing });
  const m = t / 2;
  const runs: Run[] = [
    run('House top', { x: m, y: m }, { x: L - m, y: m }, L),
    run('House right', { x: L - m, y: m }, { x: L - m, y: W - m }, W),
    run('House bottom', { x: L - m, y: W - m }, { x: m, y: W - m }, L),
    run('House left', { x: m, y: W - m }, { x: m, y: m }, W),
  ];
  const seeds: Pt[][] = [];
  const bays: { w: number; h: number }[][] = [];
  spec.addOns.forEach((a, n) => {
    const at = frame(spec, a.side);
    const from = a.from ?? 0;
    const D = a.depth;
    const name = spec.addOns.length > 1 ? `Add-on ${n + 1}` : 'Add-on';
    runs.push(run(`${name} side`, at(from + m, -m), at(from + m, D - m), D));
    runs.push(run(`${name} far`, at(from + m, D - m), at(from + a.width - m, D - m), a.width));
    runs.push(run(`${name} side 2`, at(from + a.width - m, D - m), at(from + a.width - m, -m), D));
    const us = insideAt(a, t);
    us.forEach((u, k) => runs.push(run(`${name} inside ${k + 1}`, at(u, -m), at(u, D - m), D)));
    // Bays between the walls, by their faces, left to right.
    const faces = [from + t, ...[...us].sort((x, y) => x - y).flatMap((u) => [u - m, u + m]), from + a.width - t];
    const list: { w: number; h: number }[] = [];
    const spots: Pt[] = [];
    for (let i = 0; i < faces.length; i += 2) {
      const w = faces[i + 1] - faces[i];
      if (!(w > 0) || Number.isNaN(w)) problems.push(`${name}: the inside walls don't fit (check the clear distances).`);
      list.push({ w, h: D - t });
      spots.push(at((faces[i] + faces[i + 1]) / 2, (D - t) / 2));
    }
    bays.push(list);
    seeds.push(spots);
  });
  // Rename a single side-2 for reading: "Add-on side" twice reads fine on the list.
  runs.forEach((r) => (r.name = r.name.replace(/ side 2$/, ' side')));

  const graph = solveGraph(runs);
  const slabs: LayoutSlab[] = [];
  spec.slabs.forEach((s, i) => {
    const seed = s.at.in === 'house' ? { x: L / 2, y: W / 2 } : seeds[s.at.addOn]?.[s.at.bay];
    const k = seed ? faceAt(graph.faces, seed) : -1;
    if (k < 0) {
      problems.push('A slab is not inside a closed area.');
      return;
    }
    const name = s.at.in === 'house' ? 'House slab' : `${spec.addOns.length > 1 ? `Add-on ${s.at.addOn + 1}` : 'Add-on'} slab${bays[s.at.addOn].length > 1 ? `, ${bayName(s.at.bay, bays[s.at.addOn].length)}` : ''}`;
    slabs.push({ name, pour: i + 1, face: graph.faces[k], thick: s.thick });
  });
  const list: LayoutRun[] = graph.runs.map((r) => ({ name: r.run.name, measured: r.run.measured, middle: r.middle, footingMiddle: r.footingMiddle }));
  const sum = (f: (r: LayoutRun) => number) => list.reduce((s, r) => s + f(r), 0);
  return {
    spec,
    runs: list,
    graph,
    bays,
    slabs,
    totals: { measured: sum((r) => r.measured), middle: sum((r) => r.middle), footingMiddle: sum((r) => r.footingMiddle), bends: graph.corners + graph.tees },
    problems,
  };
}

/** "left bay", "middle bay", "right bay", or "bay 2" */
export function bayName(i: number, count: number): string {
  if (count === 2) return i === 0 ? 'first bay' : 'second bay';
  if (count === 3) return ['left bay', 'middle bay', 'right bay'][i];
  return `bay ${i + 1}`;
}

export { SIDES };
