// The steel in a foundation layout, and its anchor bolts: what the crew bends and ties, figured from the
// real runs in the wall graph (each run's length along its middle, how each end meets), not from one
// long total.
//
//   Footing: continuous bars along each footing, an L-bar per bar at every corner and tee (two legs, each
//     a lap long), lapped where a run is longer than a stick or carries straight on into the next run.
//   Wall verticals: from a hook in the footing to 3" below the top of the wall, at the spacing along each
//     run, with one at every corner, tee, joint and end, plus an extra at each corner, tee and end.
//   Wall horizontals: rows up the wall (at a spacing like the Wall Forms tool, or one at the top and one at
//     mid-height), along each run, with L-bars at the corners and tees. Inside walls get their own bars.
//   Each slab: nothing, wire mesh, or a grid of bars both ways (3" in from the walls), with chairs.
//   Steps: a bar in each tread nose (bent to the curve on round steps), dowels into the wall.
//   Pads and landings: a grid or mesh; round ones get a bar round the curved edge.
//   Anchor bolts: along the top of each wall, one within the end distance of every corner, end and break
//     (where another wall tees in), none farther apart than the spacing, at least 2 per piece of plate.
//
// Every piece ends the way the rest of the app reads steel: "#4 sticks" (whole sticks, laps and bends
// included) and "Rebar weight".

import { anchorsPerWall, Bar, countAlong, getBar, LB_PER_TON, piecesToCover, planRun, sticksToCut, weightLb } from '../lib/rebar';
import { commas, commasTrim, dec, ftIn, inches, lb, tons } from '../tools/format';
import type { ResultRow } from '../tools/types';
import type { Layout, LayoutSpec, SlabSpot } from './foundationLayout';
import type { PlacedPiece } from './layoutPieces';
import type { Pt, RunResult } from './wallGraph';

export type SteelKind = 'none' | 'mesh' | 'grid';

/** Steel in a slab or pad. */
export interface SlabSteel {
  kind: SteelKind;
  /** Grid: bar size and spacing both ways */
  size: number;
  spacingIn: number;
  /** Chairs every this many feet each way (0 = none) */
  chairsFt: number;
}

/** Steel in a set of steps: a bar in each tread nose (size 0 = none), dowels into the wall (spacing 0 = none). */
export interface StepsSteel {
  noseSize: number;
  dowelSize: number;
  dowelSpacingIn: number;
  /** Into the wall, and into the steps, each, in */
  dowelIn: number;
}

/** One wall's own settings: its verticals' spacing (0 = none in this wall), bolts on or off. */
export interface WallSteel {
  vertSpacingIn?: number;
  bolts?: boolean;
}

/**
 * A layout's steel, as set. Nothing here is put in on its own: a layout has none until you tap "Add rebar
 * & bolts" (filled in with the usual and all changeable), and a slab, steps or pad has none until it's set.
 * Every piece can be set to none on purpose.
 */
export interface LayoutRebar {
  /** Stick length, ft */
  stockFt: number;
  /** Laps, in bar diameters (40 = 20" on a #4) */
  lapDia: number;
  /** Continuous bars in the footing (0 = none) */
  footing: { bars: number; size: number };
  /** Wall verticals (spacing 0 = none) */
  vert: { size: number; spacingIn: number };
  /** Wall horizontals: rows at a spacing up the wall, one at the top and one at mid-height, a count, or none */
  horiz: { size: number; rows: 'spacing' | 'topMid' | 'count' | 'none'; spacingIn: number; count: number };
  /** Inside walls' own verticals; null = the same as the outside walls */
  inside: { size: number; spacingIn: number } | null;
  /** Each wall's own, by run name */
  walls?: Record<string, WallSteel>;
  /** Each slab's steel, by where it is ("main", "a0b1"); a slab not here has none set yet */
  slabs: Record<string, SlabSteel>;
  /** Each step or pad's steel, by its number in the list; one not here has none set yet */
  pieces: Record<string, SlabSteel | StepsSteel>;
  /** Anchor bolts on top of the walls */
  bolts: { on: boolean; size: string; spacingFt: number; endIn: number };
}

export const DEFAULT_SLAB_STEEL: SlabSteel = { kind: 'grid', size: 4, spacingIn: 18, chairsFt: 3 };
export const DEFAULT_STEPS_STEEL: StepsSteel = { noseSize: 4, dowelSize: 4, dowelSpacingIn: 24, dowelIn: 12 };
export const NO_SLAB_STEEL: SlabSteel = { kind: 'none', size: 4, spacingIn: 18, chairsFt: 0 };
export const NO_STEPS_STEEL: StepsSteel = { noseSize: 0, dowelSize: 4, dowelSpacingIn: 0, dowelIn: 12 };

/** The usual: (2) #4 in the footing, #4 @ 24" both ways in the walls, #4 @ 18" in slabs and pads, 1/2" bolts at 6'. */
export function defaultRebar(): LayoutRebar {
  return {
    stockFt: 20,
    lapDia: 40,
    footing: { bars: 2, size: 4 },
    vert: { size: 4, spacingIn: 24 },
    horiz: { size: 4, rows: 'spacing', spacingIn: 24, count: 2 },
    inside: null,
    slabs: {},
    pieces: {},
    bolts: { on: true, size: '1/2" × 10" J-bolt', spacingFt: 6, endIn: 12 },
  };
}

/** Where a slab is, as a key: "main", or "a0b1" (add-on 1, bay 2). */
export const spotKey = (at: SlabSpot) => (at.in === 'main' ? 'main' : `a${at.addOn}b${at.bay}`);

type Raw = Record<string, unknown> | undefined;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const num = (v: unknown, d: number) => (str(v) !== '' && Number.isFinite(Number(str(v))) ? Number(str(v)) : d);

/** Old layouts (before the layout had its own rebar) kept bars in the Footings & Walls and Slab boxes. */
export interface OldBoxes {
  wall?: Raw;
  footing?: Raw;
  slab?: Raw;
}
export const oldBars = (old: OldBoxes) => ({
  wall: str(old.wall?.bars) === '1',
  footing: str(old.footing?.bars) === '1',
  slab: str(old.slab?.slabRebar) === '1',
});

/**
 * What "Add rebar & bolts" puts in: the usual, or what the old boxes had where they were set (bars, how
 * many, size, spacing, stick), and every slab, step and pad that has none set yet.
 */
export function withRebar(spec: LayoutSpec, old: OldBoxes = {}): LayoutSpec {
  const r: LayoutRebar = spec.rebar ? { ...spec.rebar, slabs: { ...spec.rebar.slabs }, pieces: { ...spec.rebar.pieces } } : defaultRebar();
  if (!spec.rebar) {
    const w = old.wall ?? {};
    const f = old.footing ?? {};
    const sl = old.slab ?? {};
    const was = oldBars(old);
    const stick = num(w.stockLength, num(f.stockLength, num(sl.stockLength, 0)));
    if ([20, 30, 40, 60].includes(stick)) r.stockFt = stick;
    if (was.footing) r.footing = { bars: Math.max(1, Math.round(num(f.lines, 2))), size: num(f.barSize, 4) };
    if (was.wall) {
      const size = num(w.barSize, 4);
      r.vert = { size, spacingIn: str(w.vSpacing) ? num(w.vSpacing, 24) : 0 };
      r.horiz = { size, rows: 'count', spacingIn: 24, count: Math.max(0, Math.round(num(w.lines, 2))) };
    }
    if (was.slab && str(sl.pickBars) === '1') {
      for (const s of spec.slabs) r.slabs[spotKey(s.at)] = { ...DEFAULT_SLAB_STEEL, size: num(sl.barSize, 4), spacingIn: num(sl.spacing, 18) };
    }
  }
  for (const s of spec.slabs) r.slabs[spotKey(s.at)] ??= { ...DEFAULT_SLAB_STEEL };
  (spec.pieces ?? []).forEach((p, i) => {
    r.pieces[String(i)] ??= p.kind === 'steps' ? { ...DEFAULT_STEPS_STEEL } : { ...DEFAULT_SLAB_STEEL };
  });
  return { ...spec, rebar: r, rebarWarnOff: undefined };
}

/** One slab's or piece's steel set to the usual (its own "Add rebar" tap). */
export function withPieceSteel(spec: LayoutSpec, what: { slab: SlabSpot } | { piece: number }): LayoutSpec {
  if (!spec.rebar) return withRebar(spec);
  const r = { ...spec.rebar, slabs: { ...spec.rebar.slabs }, pieces: { ...spec.rebar.pieces } };
  if ('slab' in what) r.slabs[spotKey(what.slab)] = { ...DEFAULT_SLAB_STEEL };
  else r.pieces[String(what.piece)] = spec.pieces?.[what.piece]?.kind === 'steps' ? { ...DEFAULT_STEPS_STEEL } : { ...DEFAULT_SLAB_STEEL };
  return { ...spec, rebar: r };
}

const slabWord = (l: Layout, s: Layout['slabs'][number]) => `Slab ${s.pour}${l.slabs.filter((x) => x.pour === s.pour).length > 1 ? ` (${s.name})` : ''}`;

/** What has no steel set yet (not what was set to none on purpose): "Walls and footing", "Slab 2", "Steps 1", "Anchor bolts". */
export function noSteelYet(l: Layout, old: OldBoxes = {}): string[] {
  const spec = l.spec;
  const r = spec.rebar;
  const out: string[] = [];
  const walls = l.runs.some((x) => !x.existing);
  if (!r) {
    const was = oldBars(old);
    if (walls && !was.wall && !(spec.footing && was.footing)) out.push(spec.footing ? 'Walls and footing' : 'Walls');
    else if (walls && !was.wall) out.push('Walls');
    else if (walls && spec.footing && !was.footing) out.push('Footing');
    if (!was.slab) for (const s of l.slabs) out.push(slabWord(l, s));
    l.pieces.forEach((p) => p.layers.length && out.push(p.name));
    if (walls) out.push('Anchor bolts');
    return out;
  }
  for (const s of l.slabs) if (!r.slabs[spotKey(s.at)]) out.push(slabWord(l, s));
  l.pieces.forEach((p, i) => p.layers.length && !r.pieces[String(i)] && out.push(p.name));
  return out;
}

/** The warning for a layout with pieces that have no steel set yet ("" when there's none, or it was dismissed). */
export function noSteelWarning(l: Layout, old: OldBoxes = {}): string {
  if (l.spec.rebarWarnOff) return '';
  const missing = noSteelYet(l, old);
  if (!missing.length) return '';
  const all = !l.spec.rebar && !Object.values(oldBars(old)).some(Boolean);
  return all ? 'No rebar yet · Add rebar & bolts' : `No rebar yet: ${missing.join(', ')}`;
}

// ---------------------------------------------------------------------------------------------
// Sticks: pieces cut from stock, and runs longer than a stick lapped.

class Steel {
  private cut = new Map<number, { lengthFt: number; count: number }[]>();
  private full = new Map<number, number>();
  private ft = new Map<number, number>();
  constructor(
    readonly stockFt: number,
    readonly lapFt: (bar: Bar) => number,
  ) {}
  /** `count` pieces this long (lapped if longer than a stick). */
  add(size: number, lengthFt: number, count: number) {
    if (!(lengthFt > 1e-6) || count <= 0) return;
    const bar = getBar(size);
    const lap = this.lapFt(bar);
    const run = lengthFt > this.stockFt ? planRun(lengthFt, this.stockFt, Math.min(lap, this.stockFt / 2)) : null;
    const tail = run ? run.tailFt : lengthFt;
    this.full.set(size, (this.full.get(size) ?? 0) + (run ? run.laps * count : 0));
    this.cut.set(size, [...(this.cut.get(size) ?? []), { lengthFt: tail, count }]);
    this.ft.set(size, (this.ft.get(size) ?? 0) + (run ? run.barFt : lengthFt) * count);
  }
  /** Laps in a run this long. */
  laps(size: number, lengthFt: number) {
    return lengthFt > this.stockFt ? planRun(lengthFt, this.stockFt, Math.min(this.lapFt(getBar(size)), this.stockFt / 2)).laps : 0;
  }
  /** Bar length with its laps. */
  barFt(size: number, lengthFt: number) {
    return lengthFt > this.stockFt ? planRun(lengthFt, this.stockFt, Math.min(this.lapFt(getBar(size)), this.stockFt / 2)).barFt : lengthFt;
  }
  get empty() {
    return this.ft.size === 0;
  }
  sticks(): Map<number, number> {
    const out = new Map<number, number>();
    for (const [size, groups] of [...this.cut].sort((a, b) => a[0] - b[0])) out.set(size, (this.full.get(size) ?? 0) + sticksToCut(groups, this.stockFt));
    return out;
  }
  lb(): number {
    return [...this.ft].reduce((t, [size, ft]) => t + weightLb(getBar(size), ft), 0);
  }
  /** "#4 sticks" for each size, and the weight. */
  rows(): ResultRow[] {
    const lbs = this.lb();
    return [
      ...[...this.sticks()].map(([size, k]): ResultRow => ({ label: `#${size} sticks`, value: `${commas(k)} × ${this.stockFt}'`, note: 'Laps and bends included' })),
      { label: 'Rebar weight', value: lb(Math.round(lbs)), note: tons(lbs / LB_PER_TON) },
    ];
  }
}

// ---------------------------------------------------------------------------------------------
// A layout's steel

export interface BoltRun {
  name: string;
  count: number;
  /** Where each bolt goes, on the middle of the wall (plan ft) */
  spots: Pt[];
}

export interface PieceSteel {
  rows: ResultRow[];
  sticks: Map<number, number>;
  lb: number;
}

export interface LayoutSteel {
  setup: LayoutRebar;
  footing: PieceSteel | null;
  walls: PieceSteel | null;
  /** By slab pour number */
  slabs: Map<number, PieceSteel>;
  /** By the piece's index in the layout's pieces */
  pieces: Map<number, PieceSteel>;
  bolts: { runs: BoltRun[]; total: number };
  /** For the drawings: vertical bar cut length and hook, ft; horizontal rows and their spacing */
  vertCutFt: number;
  hookFt: number;
  rows: number;
  rowSpacingIn: number;
}

const COVER = 3 / 12;
const piece = (st: Steel, rows: ResultRow[]): PieceSteel => ({ rows: [...rows, ...st.rows()], sticks: st.sticks(), lb: st.lb() });
const plural = (n: number, one: string, many = `${one}s`) => `${commas(n)} ${n === 1 ? one : many}`;
const unitOf = (a: Pt, b: Pt) => {
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
};

/** Rows of horizontal bars up a wall this tall (in). */
export function horizRows(h: LayoutRebar['horiz'], wallIn: number): number {
  if (h.rows === 'none') return 0;
  if (h.rows === 'topMid') return 2;
  if (h.rows === 'count') return Math.max(0, Math.round(h.count));
  return h.spacingIn > 0 ? countAlong(Math.max(0, wallIn - 6), h.spacingIn) : 0;
}

/** How each end of a run sits: shared with a new run (count it half from each side), or its own. */
function endShare(l: Layout, r: RunResult, e: 0 | 1, isNew: (x: RunResult['run']) => boolean): number {
  const host = r.hosts[e];
  return host && isNew(host) ? 0.5 : 1;
}

/** Bar lengths across a shape at a spacing, both ways, 3" in from its edges (each piece of a chord). */
export function gridBars(poly: Pt[], spacingIn: number, coverFt = COVER): { lengths: number[]; area: number } {
  const lengths: number[] = [];
  const area = Math.abs(poly.reduce((t, p, i) => t + p.x * poly[(i + 1) % poly.length].y - poly[(i + 1) % poly.length].x * p.y, 0) / 2);
  for (const axis of ['y', 'x'] as const) {
    const other = axis === 'y' ? 'x' : 'y';
    const vs = poly.map((p) => p[axis]);
    const lo = Math.min(...vs) + coverFt;
    const hi = Math.max(...vs) - coverFt;
    if (hi <= lo) continue;
    const k = countAlong((hi - lo) * 12, spacingIn);
    for (let i = 0; i < k; i++) {
      const at = k === 1 ? (lo + hi) / 2 : lo + ((hi - lo) * i) / (k - 1);
      const xs: number[] = [];
      for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
        const p = poly[a];
        const q = poly[b];
        if (p[axis] > at !== q[axis] > at) xs.push(p[other] + ((at - p[axis]) * (q[other] - p[other])) / (q[axis] - p[axis]));
      }
      xs.sort((u, v) => u - v);
      for (let j = 0; j + 1 < xs.length; j += 2) {
        const len = xs[j + 1] - xs[j] - 2 * coverFt;
        if (len > 1e-6) lengths.push(len);
      }
    }
  }
  return { lengths, area };
}

/** Mesh sheets (5' × 10', 6" overlap) to cover an area. */
export const meshSheets = (sqFt: number) => piecesToCover(sqFt, (5 - 0.5) * (10 - 0.5));

/** A slab or pad's steel into `st`; rows saying what it is. */
function slabSteel(st: Steel, poly: Pt[], ss: SlabSteel, what: 'Slab' | 'Pad', name = '', edge?: { lengthFt: number; size: number }): ResultRow[] {
  const rows: ResultRow[] = [];
  const pre = name ? `${name}: ` : '';
  if (ss.kind === 'none') return [{ label: `${what} steel`, value: 'None', note: `${pre}set to no steel` }];
  const g = gridBars(poly, ss.spacingIn);
  if (ss.kind === 'mesh') {
    rows.push({ label: 'Wire mesh', value: `${plural(meshSheets(g.area), 'sheet')}`, note: `${pre}5' × 10' sheets, 6" overlap, over ${commas(Math.round(g.area))} sq ft` });
  } else {
    let laps = 0;
    let ft = 0;
    for (const len of g.lengths) {
      st.add(ss.size, len, 1);
      laps += st.laps(ss.size, len);
      ft += st.barFt(ss.size, len);
    }
    rows.push({
      label: `${what} bars`,
      value: `${commasTrim(ft, 1)} ft`,
      note: `${pre}#${ss.size} @ ${dec(ss.spacingIn, 0)}" both ways, 3" in from the edges · ${plural(g.lengths.length, 'bar')}${laps ? ` · ${plural(laps, 'lap')}` : ''}`,
    });
    if (edge && edge.lengthFt > 0) {
      st.add(edge.size, edge.lengthFt, 1);
      rows.push({ label: 'Edge bar', value: `${commasTrim(st.barFt(edge.size, edge.lengthFt), 1)} ft`, note: `1 #${edge.size} round the curved edge, 3" in, bent to the curve` });
    }
  }
  if (ss.chairsFt > 0) rows.push({ label: 'Chairs', value: commas(Math.ceil(g.area / (ss.chairsFt * ss.chairsFt))), note: `${pre}About one every ${dec(ss.chairsFt, 0)}' each way` });
  return rows;
}

/** Bolt spots along one run: the plate from end to end, broken where other walls tee in. */
function boltRun(l: Layout, i: number, spacingFt: number, endFt: number): BoltRun {
  const r = l.graph.runs[i];
  const d = unitOf(r.run.a, r.run.b);
  const full = Math.hypot(r.run.b.x - r.run.a.x, r.run.b.y - r.run.a.y);
  const half = r.run.thick / 2;
  // The plate's ends along the middle line: out to the outside corner, or back to the face it tees into.
  const ext = (k: 0 | 1) => (r.ends[k] === 'corner' ? half : -r.trim[k]);
  const start = -ext(0);
  const stop = full + ext(1);
  // Breaks: where another wall tees into this one (its thickness).
  const breaks: [number, number][] = [];
  l.graph.runs.forEach((o, j) => {
    if (j === i) return;
    o.ends.forEach((kind, e) => {
      if (kind !== 'tee' || o.hosts[e] !== r.run) return;
      const p = e === 0 ? o.run.a : o.run.b;
      const t = (p.x - r.run.a.x) * d.x + (p.y - r.run.a.y) * d.y;
      if (t > start && t < stop) breaks.push([t - o.run.thick / 2, t + o.run.thick / 2]);
    });
  });
  breaks.sort((a, b) => a[0] - b[0]);
  const segs: [number, number][] = [];
  let at = start;
  for (const [b0, b1] of breaks) {
    if (b0 > at + 1e-6) segs.push([at, b0]);
    at = Math.max(at, b1);
  }
  if (stop > at + 1e-6) segs.push([at, stop]);
  const spots: Pt[] = [];
  for (const [a, b] of segs) {
    const len = b - a;
    const k = anchorsPerWall(len, spacingFt, endFt);
    const e = Math.min(endFt, len / 3);
    for (let q = 0; q < k; q++) {
      const t = k === 1 ? (a + b) / 2 : a + e + ((len - 2 * e) * q) / (k - 1);
      spots.push({ x: r.run.a.x + d.x * t, y: r.run.a.y + d.y * t });
    }
  }
  return { name: r.run.name, count: spots.length, spots };
}

/** Length round the curved part of a round piece, 3" in (half, full or quarter round of diameter d). */
const curveFt = (shape: string, d: number) => {
  const r = Math.max(0, d / 2 - COVER);
  return shape === 'full' ? 2 * Math.PI * r : shape === 'half' ? Math.PI * r : shape === 'quarter' ? (Math.PI * r) / 2 : 0;
};

export function layoutSteel(l: Layout, setup: LayoutRebar): LayoutSteel {
  const spec = l.spec;
  const lapFt = (bar: Bar) => (bar.diaIn * setup.lapDia) / 12;
  const newIdx = l.graph.runs.map((_, i) => i).filter((i) => !l.runs[i].existing);
  const existing = new Set(l.graph.runs.filter((_, i) => l.runs[i].existing).map((r) => r.run));
  const isNew = (run: RunResult['run']) => !existing.has(run);
  const inside = (i: number) => /inside/i.test(l.graph.runs[i].run.name);
  const wallIn = spec.wall.height * 12;

  // ---- Footing ----
  let footing: PieceSteel | null = null;
  const fb = setup.footing;
  if (spec.footing && fb.bars > 0 && newIdx.length) {
    const st = new Steel(setup.stockFt, lapFt);
    const bar = getBar(fb.size);
    const lap = lapFt(bar);
    let ft = 0;
    let laps = 0;
    let bends = 0;
    for (const i of newIdx) {
      const r = l.graph.runs[i];
      if (!(r.footingMiddle > 0)) continue;
      // Free ends stop 3" short; a run that carries straight on laps into the next one.
      const len = r.footingMiddle + r.ends.reduce((t, k) => t + (k === 'free' ? -COVER : k === 'through' ? lap / 2 : 0), 0);
      st.add(fb.size, len, fb.bars);
      ft += st.barFt(fb.size, len) * fb.bars;
      laps += (st.laps(fb.size, len) + r.ends.filter((k) => k === 'through').length / 2) * fb.bars;
      bends += r.ends.reduce((t, k, e) => t + (k === 'corner' ? endShare(l, r, e as 0 | 1, isNew) : k === 'tee' ? 1 : 0), 0);
    }
    const lBars = Math.round(bends) * fb.bars;
    st.add(fb.size, 2 * lap, lBars);
    ft += lBars * 2 * lap;
    footing = piece(st, [
      {
        label: 'Footing bars',
        value: `${commasTrim(ft, 1)} ft`,
        note: `(${fb.bars}) #${fb.size} continuous along every footing · ${plural(lBars, 'corner and tee L-bar')} ${ftIn(2 * lap)} (${inches(lap * 12)} legs) · ${plural(Math.round(laps), 'lap')} of ${inches(lap * 12)} (${setup.lapDia} bar diameters)`,
      },
    ]);
  }

  if (!footing && spec.footing && fb.bars <= 0 && newIdx.length) footing = { rows: [{ label: 'Footing steel', value: 'None', note: 'Set to no bars' }], sticks: new Map(), lb: 0 };

  // ---- Walls: verticals, horizontals, bolts ----
  let walls: PieceSteel | null = null;
  const vBar = getBar(setup.vert.size);
  // Hooked in the footing (12 bar diameters, kept 3" off the footing's sides), 3" off its bottom.
  const hookFt = spec.footing ? Math.min(12 * vBar.diaIn, (spec.footing.width * 12) / 2 - 3) / 12 : 0;
  const vertCutFt = spec.footing ? hookFt + spec.footing.depth - COVER + spec.wall.height - COVER : spec.wall.height - 2 * COVER;
  const rows = horizRows(setup.horiz, wallIn);
  const rowSpacingIn = setup.horiz.rows === 'topMid' ? (wallIn - 3) / 2 : rows > 1 ? (wallIn - 6) / (rows - 1) : 0;
  const bolts: BoltRun[] = setup.bolts.on && setup.bolts.spacingFt > 0 ? newIdx.filter((i) => setup.walls?.[l.graph.runs[i].run.name]?.bolts !== false).map((i) => boltRun(l, i, setup.bolts.spacingFt, setup.bolts.endIn / 12)) : [];
  const boltTotal = bolts.reduce((t, b) => t + b.count, 0);
  if (newIdx.length) {
    const st = new Steel(setup.stockFt, lapFt);
    const out: ResultRow[] = [];
    for (const group of ['outside', 'inside'] as const) {
      const idx = newIdx.filter((i) => inside(i) === (group === 'inside'));
      if (!idx.length) continue;
      const vs = group === 'inside' && setup.inside ? setup.inside : setup.vert;
      const pre = group === 'inside' ? 'Inside walls: ' : '';
      // Verticals: the field bars between each run's ends, a bar at every corner, tee, joint and end,
      // and an extra at each corner, tee and end.
      // A wall can have its own spacing, or none.
      const spacing = (i: number) => setup.walls?.[l.graph.runs[i].run.name]?.vertSpacingIn ?? vs.spacingIn;
      const vIdx = idx.filter((i) => spacing(i) > 0);
      if (vIdx.length) {
        let field = 0;
        let atJoints = 0;
        const kinds = { corner: 0, tee: 0, end: 0 };
        const own = vIdx.filter((i) => spacing(i) !== vs.spacingIn);
        for (const i of vIdx) {
          const r = l.graph.runs[i];
          field += Math.max(0, countAlong(r.middle * 12, spacing(i)) - 2);
          r.ends.forEach((k, e) => {
            const share = endShare(l, r, e as 0 | 1, isNew);
            if (k === 'corner') {
              atJoints += 2 * share;
              kinds.corner += share;
            } else if (k === 'tee') {
              atJoints += 2;
              kinds.tee += 1;
            } else if (k === 'through') atJoints += share;
            else {
              atJoints += 2;
              kinds.end += 1;
            }
          });
        }
        const count = field + Math.round(atJoints);
        if (vertCutFt > setup.stockFt) throw new Error(`A vertical won't fit in a ${setup.stockFt}' stick.`);
        st.add(vs.size, vertCutFt, count);
        const extras = [kinds.corner && plural(Math.round(kinds.corner), 'corner'), kinds.tee && plural(kinds.tee, 'tee'), kinds.end && plural(kinds.end, 'end')].filter(Boolean).join(', ');
        out.push({
          label: `${pre}Vertical bars`,
          value: `${commas(count)} × ${ftIn(vertCutFt)}`,
          note: `#${vs.size} @ ${dec(vs.spacingIn, 0)}" on center${own.length ? ` (${own.map((i) => `${l.graph.runs[i].run.name} @ ${dec(spacing(i), 0)}"`).join(', ')})` : ''}${vIdx.length < idx.length ? ` · none in ${idx.filter((i) => !vIdx.includes(i)).map((i) => l.graph.runs[i].run.name).join(', ')}` : ''}${spec.footing ? `, ${inches(hookFt * 12)} hook in the footing` : ''} to 3" below the top · 2 at each ${extras ? `of the ${extras}` : 'corner'}`,
        });
      }
      // Horizontals: each row along each run, L-bars at corners and tees.
      if (rows > 0) {
        const hb = setup.horiz.size;
        const lap = lapFt(getBar(hb));
        let ft = 0;
        let laps = 0;
        let bends = 0;
        for (const i of idx) {
          const r = l.graph.runs[i];
          const len = r.middle + r.ends.reduce((t, k) => t + (k === 'free' ? -COVER : k === 'through' ? lap / 2 : 0), 0);
          st.add(hb, len, rows);
          ft += st.barFt(hb, len) * rows;
          laps += (st.laps(hb, len) + r.ends.filter((k) => k === 'through').length / 2) * rows;
          bends += r.ends.reduce((t, k, e) => t + (k === 'corner' ? endShare(l, r, e as 0 | 1, isNew) : k === 'tee' ? 1 : 0), 0);
        }
        const lBars = Math.round(bends) * rows;
        st.add(hb, 2 * lap, lBars);
        ft += lBars * 2 * lap;
        const how = setup.horiz.rows === 'topMid' ? 'one at the top, one at mid-height' : setup.horiz.rows === 'spacing' ? `${dec(setup.horiz.spacingIn, 0)}" apart up the wall` : 'up the wall';
        out.push({
          label: `${pre}Horizontal bars`,
          value: `${commasTrim(ft, 1)} ft`,
          note: `${plural(rows, 'row')} of #${hb}, ${how} · ${plural(lBars, 'corner and tee L-bar')} ${ftIn(2 * lap)} · ${plural(Math.round(laps), 'lap')} of ${inches(lap * 12)}`,
        });
      }
    }
    if (boltTotal) {
      out.push({
        label: 'Anchor bolts',
        value: commas(boltTotal),
        note: `${setup.bolts.size} with nut and washer · ${dec(setup.bolts.spacingFt, 1).replace(/\.0$/, '')}' on center max, within ${dec(setup.bolts.endIn, 0)}" of every corner, end and break · ${bolts.map((b) => `${b.name} ${b.count}`).join(', ')}`,
      });
    }
    if (!out.length) out.push({ label: 'Wall steel', value: 'None', note: 'Set to no bars and no bolts' });
    walls = st.empty ? { rows: out, sticks: new Map(), lb: 0 } : piece(st, out);
  }

  // ---- Slabs ----
  const slabs = new Map<number, PieceSteel>();
  for (const pour of [...new Set(l.slabs.map((x) => x.pour))]) {
    const these = l.slabs.filter((x) => x.pour === pour);
    const st = new Steel(setup.stockFt, lapFt);
    const out: ResultRow[] = [];
    for (const sl of these) {
      const ss = setup.slabs[spotKey(sl.at)];
      if (!ss) continue;
      out.push(...slabSteel(st, sl.face.clear, ss, 'Slab', these.length > 1 ? sl.name : ''));
    }
    if (out.length) slabs.set(pour, st.empty ? { rows: out, sticks: new Map(), lb: 0 } : piece(st, out));
  }

  // ---- Steps and pads ----
  const pieces = new Map<number, PieceSteel>();
  l.pieces.forEach((pc: PlacedPiece, i) => {
    if (!pc.layers.length) return;
    const ps = pc.spec;
    const st = new Steel(setup.stockFt, lapFt);
    const out: ResultRow[] = [];
    const set = setup.pieces[String(i)];
    if (!set) return;
    if (ps.kind === 'steps') {
      const sp = 'noseSize' in set ? set : DEFAULT_STEPS_STEEL;
      if (!sp.noseSize && !(sp.dowelSpacingIn > 0)) out.push({ label: 'Steps steel', value: 'None' });
      const n = pc.layers.length;
      if (sp.noseSize > 0) {
        // One bar in each tread nose, 3" in from each end; bent to the curve on round steps.
        const tread = ps.tread ?? 1;
        const lens = Array.from({ length: n }, (_, k) => (ps.shape === 'square' ? (ps.width ?? 0) - 2 * COVER : curveFt(ps.shape, (ps.diameter ?? 0) - 2 * k * tread)));
        lens.forEach((len) => st.add(sp.noseSize, len, 1));
        out.push({
          label: 'Nose bars',
          value: `${n} × ${lens.length > 1 && Math.abs(lens[0] - lens[n - 1]) > 0.01 ? `${ftIn(lens[n - 1])} to ${ftIn(lens[0])}` : ftIn(lens[0])}`,
          note: `#${sp.noseSize} in each tread nose${ps.shape === 'square' ? '' : ', bent to the curve'}`,
        });
      }
      if (sp.dowelSpacingIn > 0 && sp.dowelSize > 0) {
        // Along where it meets the wall: a square step's width, a half round's diameter, a quarter
        // round's two straight sides; a full round only touches it (2 dowels).
        const d = ps.diameter ?? 0;
        const along = ps.shape === 'square' ? (ps.width ?? 0) : ps.shape === 'half' ? d : ps.shape === 'quarter' ? d : 0;
        const k = ps.shape === 'full' ? 2 : ps.shape === 'quarter' ? 2 * Math.max(2, countAlong(Math.max(0, d / 2 - 2 * COVER) * 12, sp.dowelSpacingIn)) : Math.max(2, countAlong(Math.max(0, along - 2 * COVER) * 12, sp.dowelSpacingIn));
        const len = (2 * sp.dowelIn) / 12;
        st.add(sp.dowelSize, len, k);
        out.push({ label: 'Dowels', value: `${k} × ${ftIn(len)}`, note: `#${sp.dowelSize} @ ${dec(sp.dowelSpacingIn, 0)}" into the wall, drilled and epoxied ${inches(sp.dowelIn)}, ${inches(sp.dowelIn)} into the steps` });
      }
    } else {
      const poly = pc.layers[0].poly;
      const pad = 'kind' in set ? set : DEFAULT_SLAB_STEEL;
      const edge = ps.shape === 'square' ? undefined : { lengthFt: curveFt(ps.shape, ps.diameter ?? 0), size: Math.max(4, pad.size) };
      out.push(...slabSteel(st, poly, pad, 'Pad', '', edge));
    }
    if (out.length) pieces.set(i, st.empty ? { rows: out, sticks: new Map(), lb: 0 } : piece(st, out));
  });

  return { setup, footing, walls, slabs, pieces, bolts: { runs: bolts, total: boltTotal }, vertCutFt, hookFt, rows, rowSpacingIn };
}

/** A step or pad taken out: the ones after it move up one, and so does their steel. */
export function dropPieceSteel(spec: LayoutSpec, index: number): LayoutSpec {
  const pieces = (spec.pieces ?? []).filter((_, k) => k !== index);
  if (!spec.rebar) return { ...spec, pieces };
  const old = spec.rebar.pieces;
  const next: LayoutRebar['pieces'] = {};
  for (const [k, v] of Object.entries(old)) {
    const i = Number(k);
    if (i < index) next[k] = v;
    else if (i > index) next[String(i - 1)] = v;
  }
  return { ...spec, pieces, rebar: { ...spec.rebar, pieces: next } };
}
