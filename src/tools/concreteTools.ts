import {
  beamBelowSlabCuFt,
  belledPierCuFt,
  bellHeightFt,
  boxCuFt,
  columnCuFt,
  concreteResult,
  perimeterBeamCenterline,
  squareColumnCuFt,
  stepsCuFt,
  truckLoads,
} from '../lib/concrete';
import { BARS, beamBars, countAlong, getBar, lapIn, LB_PER_TON, sticksToCut, weightLb } from '../lib/rebar';
import { commas, commasTrim, cuYd, dec, ftIn, inches, lb, money, sqFt, tons } from './format';
import { Field, Inputs, ResultRow, Tool, WallRow } from './types';
import { cornersAfter } from '../report/geometry';
import { addonLayout } from './addon';

import { concreteRows, CUFT_PER_CUYD, ORDER_FIELDS, tooBig } from './concreteShared';
import { slabLayout } from './slabLayoutTool';
import { slab } from './slabTool';

const barSizeChoice = (key: string, label: string, def: string, showIf: string[]): Field => ({
  key,
  label,
  kind: 'choice',
  options: BARS.filter((b) => b.size >= 3 && b.size <= 6).map((b) => ({ value: String(b.size), label: `#${b.size}` })),
  default: def,
  showIf,
});
const stickField = (showIf: string[]): Field => ({
  key: 'stockLength',
  label: 'Stick length',
  kind: 'choice',
  options: [20, 30, 40, 60].map((v) => ({ value: String(v), label: `${v}'` })),
  default: '20',
  showIf,
});
const lapField = (showIf: string[]): Field => ({ key: 'lap', label: 'Lap', kind: 'number', unit: 'in', optional: true, help: 'Blank = 20" on #4, 25" on #5, 30" on #6', showIf });
const COVER_FT = 3 / 12;

/** Sticks by bar size and weight, the way every rebar answer ends. */
function steelRows(sticks: Map<number, number>, totalLb: number, stockFt: number): ResultRow[] {
  return [
    ...[...sticks].sort((a, b) => a[0] - b[0]).map(([size, k]): ResultRow => ({ label: `#${size} sticks`, value: `${commas(k)} × ${stockFt}'` })),
    { label: 'Rebar weight', value: lb(totalLb), note: tons(totalLb / LB_PER_TON) },
  ];
}

/** Footings & Walls measured around a building: outside length, the middle-of-the-wall run, and corners. */
export function footingRun(inp: Inputs): { error?: string; outsideFt: number; centerFt: number; corners: number; ends: boolean; tees?: number; addon?: string } {
  // A wall's outside is the house. A footing is entered at the house size and runs centered under the
  // wall on it, so its run follows the middle of that wall, a few inches in from the house edge.
  const footing = inp.choice('kind') === 'footing';
  const t = footing ? inp.num('wallOn') / 12 : inp.len('width');
  const shape = inp.choice('shape');
  if (shape === 'rect') {
    const L = inp.len('bLength');
    const W = inp.len('bWidth');
    if (L <= 0 || W <= 0) return { error: 'Building length and width must be more than 0.', outsideFt: 0, centerFt: 0, corners: 0, ends: false };
    if (2 * Math.max(t, inp.len('width')) >= Math.min(L, W)) return { error: 'The thickness is too much for that building.', outsideFt: 0, centerFt: 0, corners: 0, ends: false };
    // Measured on the outside; the middle of the wall is a thickness shorter at each of the 4 corners.
    return { outsideFt: 2 * (L + W), centerFt: 2 * (L + W) - 4 * t, corners: 4, ends: false };
  }
  if (shape === 'odd') {
    const walls = inp.walls('walls');
    if (!walls.length) return { error: 'Add the walls.', outsideFt: 0, centerFt: 0, corners: 0, ends: false };
    const outsideFt = walls.reduce((s, w) => s + w.length, 0);
    const oc = Math.ceil(walls.reduce((s, w) => s + (w.ends === 'oo' ? 2 : w.ends === 'oi' ? 1 : 0), 0) / 2);
    const ic = Math.ceil(walls.reduce((s, w) => s + (w.ends === 'ii' ? 2 : w.ends === 'oi' ? 1 : 0), 0) / 2);
    // Each outside corner takes a thickness off the middle-of-the-wall run, each inside corner adds one.
    return { outsideFt, centerFt: outsideFt - (oc - ic) * t, corners: oc + ic, ends: false };
  }
  if (shape === 'addon') {
    const k = inp.has('inWalls') ? inp.count('inWalls') : 0;
    const W = inp.len('aWidth');
    const D = inp.len('aDepth');
    const a = addonLayout({ width: W, depth: D, t, w: inp.len('width'), inside: k, inFrom: inp.len('inFrom') });
    if ('error' in a) return { error: a.error, outsideFt: 0, centerFt: 0, corners: 0, ends: false };
    const addon = `${ftIn(D)} + ${ftIn(W)} + ${ftIn(D)} outside${k ? `, plus ${k} inside × ${ftIn(D)}` : ''}`;
    return { outsideFt: a.asMeasuredFt, centerFt: a.centerFt, corners: a.corners, tees: a.tees, ends: false, addon };
  }
  if (inp.len('length') <= 0) return { error: 'Length must be more than 0.', outsideFt: 0, centerFt: 0, corners: 0, ends: true };
  if (inp.count('qty') < 1) return { error: 'How many must be at least 1.', outsideFt: 0, centerFt: 0, corners: 0, ends: true };
  const run = inp.len('length') * inp.count('qty');
  return { outsideFt: run, centerFt: run, corners: inp.has('corners') ? inp.count('corners') : 0, ends: true };
}

const footings: Tool = {
  id: 'footings',
  title: 'Footings & Walls',
  blurb: 'Around a building or a straight run, with the rebar',
  fields: [
    {
      key: 'kind',
      label: 'It’s a',
      kind: 'choice',
      options: [
        { value: 'footing', label: 'Footing' },
        { value: 'wall', label: 'Wall / mono edge' },
      ],
      default: 'footing',
    },
    {
      key: 'shape',
      label: 'Shape',
      kind: 'choice',
      options: [
        { value: 'rect', label: 'Square / rectangle' },
        { value: 'odd', label: 'Odd shape' },
        // New add-ons are built in the job's foundation layout; this stays so saved ones still open.
        { value: 'addon', label: 'Add-on (shares a wall)', legacy: true },
        { value: 'run', label: 'Straight run / pads' },
      ],
      default: 'rect',
    },
    { key: 'bLength', label: 'House length', kind: 'length', help: 'Outside of the wall (the house size)', showIf: ['shape=rect'] },
    { key: 'bWidth', label: 'House width', kind: 'length', help: 'Outside of the wall (the house size)', showIf: ['shape=rect'] },
    { key: 'walls', label: 'Walls', kind: 'walls', help: 'The house size: outside of the walls, one wall at a time.', showIf: ['shape=odd'] },
    { key: 'aWidth', label: 'Add-on width', kind: 'length', help: 'Along the wall it joins, outside to outside', showIf: ['shape=addon'] },
    { key: 'aDepth', label: 'Comes out', kind: 'length', help: 'From the outside of the existing wall to the outside of the far wall', showIf: ['shape=addon'] },
    {
      key: 'inWalls',
      label: 'Walls inside it',
      kind: 'count',
      optional: true,
      help: 'Running from the existing wall to the far wall, like walls for storage containers. Blank = none.',
      showIf: ['shape=addon'],
    },
    {
      key: 'inFrom',
      label: 'In from each side',
      kind: 'length',
      optional: true,
      help: 'Outside of the side wall to the middle of the first inside wall. Any more go evenly between. Blank = all evenly.',
      showIf: ['shape=addon'],
    },
    {
      key: 'side',
      label: 'Joins the main walls on the',
      kind: 'choice',
      options: [
        { value: 'ab', label: 'Top' },
        { value: 'bc', label: 'Right' },
        { value: 'cd', label: 'Bottom' },
        { value: 'da', label: 'Left' },
      ],
      default: 'ab',
      help: 'Side of the main plan, for the foundation drawing',
      showIf: ['shape=addon'],
    },
    {
      key: 'wallOn',
      label: 'Wall on it',
      kind: 'number',
      unit: 'in',
      default: '8',
      help: 'Thickness of the wall that sits centered on the footing',
      showIf: ['kind=footing'],
      showIfAny: ['shape=rect', 'shape=odd', 'shape=addon'],
    },
    { key: 'length', label: 'Length', kind: 'length', showIf: ['shape=run'] },
    { key: 'qty', label: 'How many', kind: 'count', default: '1', showIf: ['shape=run'] },
    { key: 'depth', label: 'Height (depth)', kind: 'length', help: 'Wall height, or footing thickness' },
    { key: 'width', label: 'Thickness (width)', kind: 'length', help: 'Wall thickness, or footing width' },
    { key: 'bars', label: 'Rebar', kind: 'toggle' },
    { key: 'lines', label: 'Bars along it', kind: 'count', default: '2', help: '2 #4 continuous = 2. More than 3 go half bottom, half top.', showIf: ['bars'] },
    barSizeChoice('barSize', 'Bar size', '4', ['bars']),
    { key: 'corners', label: 'Corners', kind: 'count', optional: true, help: 'An L-bar at each corner for every bar', showIf: ['bars', 'shape=run'] },
    { key: 'vSpacing', label: 'Verticals every', kind: 'number', unit: 'in', optional: true, help: 'Walls: bars standing up. Blank = none.', showIf: ['bars'] },
    stickField(['bars']),
    lapField(['bars']),
    ...ORDER_FIELDS,
  ],
  compute: (inp) => {
    const t = inp.len('width');
    const h = inp.len('depth');
    if (t <= 0 || h <= 0) return { error: 'Height and thickness must be more than 0.' };
    const run = footingRun(inp);
    if (run.error) return { error: run.error };
    const isFooting = inp.choice('kind') === 'footing';
    const warnings = [
      tooBig(isFooting ? 'Footing width' : 'Wall thickness', t, 4),
      tooBig(isFooting ? 'Footing thickness' : 'Wall height', h, isFooting ? 4 : 20),
      inp.choice('shape') === 'rect' ? tooBig('House length', inp.len('bLength'), 400) : null,
      inp.choice('shape') === 'rect' ? tooBig('House width', inp.len('bWidth'), 400) : null,
    ].filter((w): w is string => !!w);
    const rows: ResultRow[] = [];
    if (run.addon) {
      rows.push({ label: 'As measured', value: `${commasTrim(run.outsideFt, 1)} ft`, note: run.addon });
      rows.push({
        label: 'Along the middle',
        value: `${commasTrim(run.centerFt, 1)} ft`,
        note: `What the concrete and bars follow · ${run.corners} corners, ${run.tees} tees: each wall that meets another stops at its ${inp.choice('kind') === 'footing' ? 'edge' : 'face'}`,
      });
    } else if (!run.ends) {
      rows.push({ label: 'House, around the outside', value: `${commasTrim(run.outsideFt, 1)} ft` });
      rows.push({
        label: 'Along the middle',
        value: `${commasTrim(run.centerFt, 1)} ft`,
        note: `${inp.choice('kind') === 'footing' ? 'Centered under the wall, in from the house edge' : 'Middle of the wall'}: what the concrete and bars follow · ${run.corners} corners`,
      });
    }
    rows.push(...concreteRows(run.centerFt * t * h, inp));
    if (!inp.on('bars')) return { rows, warnings };

    const bar = getBar(inp.choice('barSize'));
    const stockFt = Number(inp.choice('stockLength')) || 20;
    const lapFt = (inp.has('lap') ? inp.num('lap') : lapIn(bar)) / 12;
    const lines = inp.count('lines');
    if (lines < 1) return { error: 'Enter at least 1 bar.' };
    if (2 * lapFt > stockFt) return { error: `A corner bar won’t fit in a ${stockFt}' stick.` };
    // Around a building the bars run all the way round; a straight run stops 3" short of each end.
    const barRun = run.ends && !run.corners ? Math.max(0, run.centerFt - 2 * COVER_FT) : run.centerFt;
    const bends = run.corners + (run.tees ?? 0);
    const r = beamBars(barRun, lines, bar, stockFt, lapFt, bends);
    rows.push({
      label: 'Bars along it',
      value: `${commasTrim(r.totalFt, 1)} ft`,
      note: `${lines} #${bar.size} · ${commas(r.laps)} laps${bends ? ` · ${commas(r.cornerBars)} ${run.tees ? 'corner and tee' : 'corner'} L-bars ${ftIn(r.cornerBarFt)}` : ''}`,
    });
    let sticks = r.sticks;
    let totalLb = r.lb;
    if (inp.has('vSpacing')) {
      const s = inp.num('vSpacing');
      if (s <= 0) return { error: 'Verticals spacing must be more than 0.' };
      const len = h - COVER_FT;
      if (len <= 0) return { error: 'It’s too short for verticals.' };
      if (len > stockFt) return { error: `A vertical won’t fit in a ${stockFt}' stick.` };
      const count = countAlong(Math.max(0, run.centerFt * 12 - (run.ends ? 6 : 0)), s) + (run.ends ? 0 : run.corners);
      sticks += sticksToCut([{ lengthFt: len, count }], stockFt);
      totalLb += weightLb(bar, count * len);
      rows.push({ label: 'Verticals', value: `${commas(count)} × ${ftIn(len)}`, note: `#${bar.size} every ${dec(s)}", 3" from the top${run.ends ? '' : ', one at each corner'}` });
    }
    rows.push(...steelRows(new Map([[bar.size, sticks]]), totalLb, stockFt));
    return { rows, warnings };
  },
};

const piers: Tool = {
  id: 'piers',
  title: 'Piers & Columns',
  blurb: 'Round piers (straight or belled), square columns',
  fields: [
    {
      key: 'shape',
      label: 'Shape',
      kind: 'choice',
      options: [
        { value: 'round', label: 'Round' },
        { value: 'square', label: 'Square' },
      ],
      default: 'round',
    },
    { key: 'size', label: 'Diameter (side if square)', kind: 'length' },
    { key: 'height', label: 'Depth / height', kind: 'length' },
    { key: 'qty', label: 'How many', kind: 'count', default: '1' },
    { key: 'bellDia', label: 'Bell diameter', kind: 'length', optional: true, help: 'Belled piers only' },
    { key: 'bellHt', label: 'Bell height', kind: 'length', optional: true, help: 'Sloped part. Blank = standard 60° bell.' },
    { key: 'toe', label: 'Toe height', kind: 'length', optional: true, help: 'Straight part at the bottom' },
    ...ORDER_FIELDS,
  ],
  compute: (inp) => {
    const d = inp.len('size');
    const h = inp.len('height');
    const qty = inp.count('qty');
    if (d <= 0 || h <= 0) return { error: 'Diameter and depth must be more than 0.' };
    if (qty < 1) return { error: 'How many must be at least 1.' };
    const rows: ResultRow[] = [];
    let each: number;
    if (inp.choice('shape') === 'square') {
      if (inp.has('bellDia')) return { error: 'Bells are for round piers. Clear the bell diameter or pick Round.' };
      each = squareColumnCuFt(d, h, 1);
    } else if (inp.has('bellDia')) {
      const D = inp.len('bellDia');
      if (D <= d) return { error: 'The bell must be wider than the shaft.' };
      const bellHt = inp.has('bellHt') ? inp.len('bellHt') : bellHeightFt(d, D);
      const toe = inp.len('toe');
      if (bellHt + toe > h) return { error: 'The bell and toe are taller than the whole pier.' };
      each = belledPierCuFt(d, h, D, bellHt, toe);
      rows.push({ label: 'Bell height used', value: ftIn(bellHt), note: inp.has('bellHt') ? undefined : '60° bell' });
    } else {
      each = columnCuFt(d, h, 1);
    }
    rows.push({ label: 'Each pier', value: `${dec(each, 2)} cu ft`, note: cuYd(each / CUFT_PER_CUYD) });
    const warnings = [tooBig('Diameter', d, 6), tooBig('Depth', h, 100)].filter((w): w is string => !!w);
    return { rows: [...rows, ...concreteRows(each * qty, inp)], warnings };
  },
  notes: ['Drilled holes are rarely perfect. Many crews use more waste on piers.'],
};

const steps: Tool = {
  id: 'steps',
  title: 'Steps',
  blurb: 'Solid steps, optional landing at the top',
  fields: [
    { key: 'steps', label: 'Number of steps', kind: 'count' },
    { key: 'rise', label: 'Rise (each step)', kind: 'length' },
    { key: 'run', label: 'Run (each step)', kind: 'length' },
    { key: 'width', label: 'Width', kind: 'length' },
    { key: 'landing', label: 'Landing depth', kind: 'length', optional: true, help: 'Landing at the top' },
    ...ORDER_FIELDS,
  ],
  compute: (inp) => {
    const n = inp.count('steps');
    if (n < 1) return { error: 'Enter at least 1 step.' };
    if (inp.len('rise') <= 0 || inp.len('run') <= 0 || inp.len('width') <= 0) return { error: 'Rise, run and width must be more than 0.' };
    const stairs = stepsCuFt(n, inp.len('rise'), inp.len('run'), inp.len('width'));
    const landing = inp.len('landing') * inp.len('width') * n * inp.len('rise');
    const warnings = [tooBig('Rise', inp.len('rise'), 1), tooBig('Run', inp.len('run'), 4)].filter((w): w is string => !!w);
    return { rows: concreteRows(stairs + landing, inp), warnings };
  },
};

// Nominal board widths (in) → actual width. Form rows are figured by nominal width, the way crews stack them.
const FORM_BOARDS = [
  { value: '4', label: '2x4' },
  { value: '6', label: '2x6' },
  { value: '8', label: '2x8' },
  { value: '10', label: '2x10' },
  { value: '12', label: '2x12' },
];

const forms: Tool = {
  id: 'forms',
  title: 'Forms & Stakes',
  blurb: 'Form boards and stakes around a slab',
  fields: [
    { key: 'length', label: 'Slab length', kind: 'length', optional: true },
    { key: 'width', label: 'Slab width', kind: 'length', optional: true },
    { key: 'formLF', label: 'Or total form length', kind: 'number', unit: 'ft', optional: true, help: 'For odd shapes. Used instead of length and width.' },
    { key: 'height', label: 'Form height', kind: 'length', default: { in: '4' } },
    { key: 'board', label: 'Board size', kind: 'choice', options: FORM_BOARDS, default: '4' },
    {
      key: 'topBoard',
      label: 'Board on top',
      kind: 'choice',
      options: [{ value: '', label: 'None' }, ...FORM_BOARDS],
      default: '',
      help: 'Like a 2x4 on a 2x12 to keep the top straight',
    },
    { key: 'boardLength', label: 'Board length', kind: 'choice', options: [12, 16, 20].map((n) => ({ value: String(n), label: `${n}'` })), default: '16' },
    { key: 'stakeSpacing', label: 'Stakes every', kind: 'number', unit: 'ft', default: '4' },
  ],
  compute: (inp) => {
    const spacing = inp.num('stakeSpacing');
    if (spacing <= 0) return { error: 'Stake spacing must be more than 0.' };
    let sides: number[];
    if (inp.has('formLF')) {
      if (inp.num('formLF') <= 0) return { error: 'Form length must be more than 0.' };
      sides = [inp.num('formLF')];
    } else {
      if (!inp.has('length') || !inp.has('width')) return { error: 'Enter the slab length and width, or the total form length.' };
      const L = inp.len('length');
      const W = inp.len('width');
      if (L <= 0 || W <= 0) return { error: 'Length and width must be more than 0.' };
      sides = [L, W, L, W];
    }
    const heightIn = inp.len('height') * 12;
    if (heightIn <= 0) return { error: 'Form height must be more than 0.' };

    const lf = sides.reduce((a, b) => a + b, 0);
    const boardFt = Number(inp.choice('boardLength'));
    const nominal = Number(inp.choice('board'));
    const label = FORM_BOARDS.find((b) => b.value === inp.choice('board'))!.label;
    const topNominal = Number(inp.choice('topBoard')) || 0;
    const topLabel = FORM_BOARDS.find((b) => b.value === inp.choice('topBoard'))?.label;
    // The top board sits on the stack; the main boards fill the rest of the height (at least one row).
    const rows = Math.max(1, Math.ceil((heightIn - topNominal) / nominal - 1e-9));
    const boards = Math.ceil((lf * rows) / boardFt - 1e-9);
    const topBoards = topNominal ? Math.ceil(lf / boardFt - 1e-9) : 0;
    const stackIn = rows * nominal + topNominal;
    const warnings: string[] = [];
    if (topNominal && stackIn > heightIn + 1e-9) {
      warnings.push(`Those boards stack to ${dec(stackIn)}", taller than the ${dec(heightIn)}" form. Set the form height to match, or pick smaller boards.`);
    }
    // A stake at each end/corner of every side, then no farther apart than the spacing.
    const stakes = sides.reduce((sum, s) => sum + Math.ceil(s / spacing - 1e-9) + 1, 0);

    const result: ResultRow[] = [{ label: 'Form length', value: `${commasTrim(lf, 1)} ft` }];
    if (rows > 1 || topNominal) {
      result.push({ label: 'Rows of boards', value: `${rows + (topNominal ? 1 : 0)} high`, note: topLabel ? `${rows} × ${label} + ${topLabel} on top` : undefined });
    }
    result.push({ label: 'Boards', value: `${commas(boards)} × ${boardFt}' ${label}`, big: true });
    if (topNominal) result.push({ label: 'Top boards', value: `${commas(topBoards)} × ${boardFt}' ${topLabel}`, big: true });
    result.push({ label: 'Stakes', value: commas(stakes), big: true, note: `At every corner and every ${dec(spacing, 1)}'` });
    return { rows: result, warnings };
  },
};

// ---------------------------------------------------------------------------------------------
// Aluminum wall forms (Advance Concrete Form panels: 24" wide, 1"×1" outside and 4"×4" inside corners).
// Checked against a real crew layout on an 8" wall, wall by wall. At each end of a wall:
//   outside corner: outside face runs to the corner and gets a 1' piece; inside face stops t + 4" short (1' on 8")
//   inside corner:  both faces stop 4" short (the 4×4 inside corner)
// The rest of each face is 2' panels, then fillers.

const OC_PIECE_IN = 12; // the 1' piece on the outside face at an outside corner
const INSIDE_CORNER_IN = 4; // the 4×4 inside corner
/** What this crew carries; the person lists theirs (and how many) on the screen. Advance sells 4"–23". */
const CREW_FILLERS_IN = [14, 12, 8, 6];
const MAX_FILLERS_PER_SPOT = 6;

/** How many of each filler are left; Infinity = plenty. */
export type FillerStock = Map<number, number>;

const plenty = (sizes: number[]): FillerStock => new Map(sizes.map((s) => [s, Infinity]));

/**
 * Fewest fillers that add up to exactly this many inches, using only what's in stock
 * (ties: the set whose smallest piece is biggest). Null if it can't be done.
 */
export function fillerSet(inches: number, stock: FillerStock = plenty(CREW_FILLERS_IN)): number[] | null {
  if (inches === 0) return [];
  if (inches < 0) return null;
  const sizes = [...stock.keys()].filter((s) => s > 0 && (stock.get(s) ?? 0) > 0).sort((x, y) => y - x);
  let best: number[] | null = null;
  const better = (cand: number[]) =>
    !best || cand.length < best.length || (cand.length === best.length && cand[cand.length - 1] > best[best.length - 1]);
  const search = (left: number, from: number, picked: number[]) => {
    if (left === 0) {
      if (better(picked)) best = [...picked];
      return;
    }
    if (picked.length >= MAX_FILLERS_PER_SPOT || (best && picked.length + 1 > best.length)) return;
    for (let i = from; i < sizes.length; i++) {
      const s = sizes[i];
      const used = picked.filter((p) => p === s).length;
      if (s > left || used >= (stock.get(s) ?? 0)) continue;
      picked.push(s);
      search(left - s, i, picked);
      picked.pop();
    }
  };
  search(inches, 0, []);
  return best;
}

export interface FaceLayout {
  panels: number;
  fillers: number[];
  woodIn: number;
}

/** One face of one wall: panels, then fillers, then a wood strip for any odd inch. Runs are rounded to the inch. */
export function layoutFace(runIn: number, panelIn: number, stock: FillerStock = plenty(CREW_FILLERS_IN)): FaceLayout {
  const run = Math.max(0, Math.round(runIn));
  const n = Math.floor(run / panelIn);
  const r = run - n * panelIn;
  for (const wood of [0, 1]) {
    // Leftover too small for the fillers? Trade a panel or two for fillers.
    for (let k = 0; k <= Math.min(2, n); k++) {
      const set = fillerSet(r - wood + k * panelIn, stock);
      if (set) return { panels: n - k, fillers: set, woodIn: wood };
    }
  }
  return { panels: n, fillers: [], woodIn: r };
}

/** "9'4"" / "5'4"" / "8'" */
const heightText = (inch: number) => (inch % 12 ? `${Math.floor(inch / 12)}'${inch % 12}"` : `${inch / 12}'`);
/** 12 → 1'   8 → 8" */
const fillerText = (inch: number) => (inch === 12 ? `1'` : `${dec(inch)}"`);

/** Ties in each vertical joint: one every 16" up the wall (Advance 6-bar spacing), at least 2. */
const TIE_SPACING_IN = 16;
export const tiesPerJoint = (wallIn: number) => Math.max(2, Math.round(wallIn / TIE_SPACING_IN));

/** "1' + 34 × 2' + 1'" */
function describeFace(lead: number[], face: FaceLayout, trail: number[], panelText: string): string {
  const parts = [
    ...lead.map(fillerText),
    ...(face.panels ? [`${face.panels} × ${panelText}`] : []),
    ...face.fillers.map(fillerText),
    ...(face.woodIn ? [`${face.woodIn}" wood`] : []),
    ...trail.map(fillerText),
  ];
  return parts.join(' + ') || 'nothing';
}

/** "need 192, have 150: short 42" style note for the load list. */
function haveNote(need: number, have: number | null | undefined, each: string): { note?: string; short: number } {
  if (have === null || have === undefined || have === Infinity) return { note: each ? each.trim() : undefined, short: 0 };
  const short = Math.max(0, need - have);
  return { note: short ? `Short ${commas(short)}${each}. You have ${commas(have)}.` : `You have ${commas(have)}${each}`, short };
}

// ---- Walls whose height changes around the house (daylight basement) ----
// The panel and filler layout along each wall stays the same; each column is stacked only as tall as
// the wall where it stands. Where a column straddles a height change it takes the taller height.

/** Rows of the panel setup a column uses: index 0 = Panel height, 1 = Stacked on top. */
type Stack = number[];

/** The shortest stack of your panel heights that reaches this height (fewest pieces on a tie). */
export function stackFor(heightIn: number, heightsIn: number[]): { stack: Stack; short: boolean } {
  const options: Stack[] = heightsIn.length > 1 ? [[0], [1], [0, 1]] : [[0]];
  const tall = (s: Stack) => s.reduce((sum, r) => sum + heightsIn[r], 0);
  const fits = options.filter((s) => tall(s) >= heightIn - 0.5).sort((a, b) => tall(a) - tall(b) || a.length - b.length);
  return fits.length ? { stack: fits[0], short: false } : { stack: heightsIn.map((_, i) => i), short: true };
}

export interface SteppedForms {
  /** Panels by setup row (0 = Panel height, 1 = Stacked on top) */
  panelsByRow: number[];
  /** Panel columns by how tall they stand (in) */
  columnsByHeight: Map<number, { columns: number; stack: Stack }>;
  /** Filler pieces: size → count by setup row */
  fillers: Map<number, number[]>;
  cornersByRow: number[];
  woodPieces: number;
  ties: number;
  /** A line for each wall's note (empty if it's all at the full height) */
  wallNotes: string[];
  /** Wall heights taller than your panels reach, in */
  tooTall: number[];
  heightsIn: number[];
}

export function steppedForms(
  walls: WallRow[],
  laid: { oc: number; out: FaceLayout; inside: FaceLayout }[],
  t: number,
  panelIn: number,
  heightsIn: number[],
  runs: { length: number; height: number }[],
): SteppedForms {
  // Runs along the outside, inches from corner A.
  const spans: { from: number; to: number; heightIn: number }[] = [];
  let at = 0;
  for (const r of runs) {
    spans.push({ from: at, to: at + r.length * 12, heightIn: Math.round(r.height * 12) });
    at += r.length * 12;
  }
  const fullIn = heightsIn.reduce((x, y) => x + y, 0);
  // Corner A is both the start and the end of the walk, so look past it both ways.
  const heightOver = (a: number, b: number) => {
    let h = 0;
    for (const shift of [-at, 0, at])
      for (const s of spans) if (s.to + shift > a + 0.01 && s.from + shift < b - 0.01) h = Math.max(h, s.heightIn);
    return h || fullIn;
  };
  const tooTall = new Set<number>();
  const stackAt = (a: number, b: number) => {
    const h = heightOver(a, b);
    const s = stackFor(h, heightsIn);
    if (s.short) tooTall.add(h);
    return s.stack;
  };
  const tallOf = (s: Stack) => s.reduce((sum, r) => sum + heightsIn[r], 0);

  const panelsByRow = heightsIn.map(() => 0);
  const cornersByRow = heightsIn.map(() => 0);
  const fillers = new Map<number, number[]>();
  const columnsByHeight = new Map<number, { columns: number; stack: Stack }>();
  let woodPieces = 0;
  let ties = 0;

  // Which end of each wall is the outside corner ('oi' walls can go either way round).
  const after = cornersAfter(walls.map((w) => w.ends));
  const n = walls.length;
  const wallNotes: string[] = [];
  let start = 0;
  for (const [i, w] of walls.entries()) {
    const L = w.length * 12;
    const { oc, out, inside } = laid[i];
    const startO = after ? after[(i - 1 + n) % n] === 'o' : w.ends !== 'ii';
    const wallCols = new Map<number, number>();
    // One face, piece by piece from the start of the wall.
    const face = (from: number, f: FaceLayout, lead: number[], trail: number[], outside: boolean) => {
      let x = from;
      if (outside) ties += tiesPerJoint(tallOf(stackAt(start + x, start + x + 1)));
      const piece = (width: number, kind: 'panel' | 'filler' | 'wood') => {
        const s = stackAt(start + x, start + x + width);
        if (kind === 'panel') {
          s.forEach((r) => panelsByRow[r]++);
          const h = tallOf(s);
          const c = columnsByHeight.get(h) ?? { columns: 0, stack: s };
          c.columns++;
          columnsByHeight.set(h, c);
          wallCols.set(h, (wallCols.get(h) ?? 0) + 1);
        } else if (kind === 'filler') {
          const byRow = fillers.get(width) ?? heightsIn.map(() => 0);
          s.forEach((r) => byRow[r]++);
          fillers.set(width, byRow);
        } else woodPieces += s.length;
        if (outside && kind !== 'wood') ties += tiesPerJoint(tallOf(s));
        x += width;
      };
      lead.forEach((p) => piece(p, 'filler'));
      for (let k = 0; k < f.panels; k++) piece(panelIn, 'panel');
      f.fillers.forEach((p) => piece(p, 'filler'));
      if (f.woodIn) piece(f.woodIn, 'wood');
      trail.forEach((p) => piece(p, 'filler'));
    };
    const lead = startO && oc ? [OC_PIECE_IN] : [];
    const trail = Array<number>(oc - lead.length).fill(OC_PIECE_IN);
    face(startO ? 0 : INSIDE_CORNER_IN, out, lead, trail, true);
    face(startO ? t + INSIDE_CORNER_IN : INSIDE_CORNER_IN, inside, [], [], false);
    // The corner at the end of this wall stands as tall as the taller wall on either side of it.
    stackAt(start + L - 1, start + L + 1).forEach((r) => cornersByRow[r]++);
    const hs = [...wallCols.entries()].sort((a, b) => b[0] - a[0]);
    wallNotes.push(hs.some(([h]) => h !== fullIn) ? `Columns: ${hs.map(([h, c]) => `${c} at ${heightText(h)}`).join(', ')}` : '');
    start += L;
  }
  return { panelsByRow, columnsByHeight, fillers, cornersByRow, woodPieces, ties, wallNotes, tooTall: [...tooTall], heightsIn };
}

/** "12 × 4' + 6 × 4'" by setup row (rows with none left out). */
const byRowText = (byRow: number[], heightsIn: number[]) =>
  byRow
    .map((k, r) => (k ? `${commas(k)} × ${heightText(heightsIn[r])}` : ''))
    .filter(Boolean)
    .join(' + ');

/** Load-list rows for walls that change height: panels, fillers and corners counted piece by piece. */
export function steppedRows(
  s: SteppedForms,
  o: {
    panelText: string;
    pieces: number;
    panelsOwned: number | null;
    cornersOwned: number | null;
    owned: FillerStock;
    ocCorners: number;
    icCorners: number;
    shortages: string[];
  },
): ResultRow[] {
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const each = o.pieces > 1 ? ' of each height' : '';
  // What you own is "of each height": check each setup row on its own.
  const shortOf = (byRow: number[], have: number | null | undefined) =>
    have === null || have === undefined || have === Infinity ? 0 : Math.max(0, ...byRow.map((k) => k - have));
  const haveText = (byRow: number[], have: number | null | undefined) => {
    if (have === null || have === undefined || have === Infinity) return '';
    const short = shortOf(byRow, have);
    return short ? `Short ${commas(short)}${each}. You have ${commas(have)}.` : `You have ${commas(have)}${each}`;
  };
  const heights = [...s.columnsByHeight.entries()].sort((a, b) => b[0] - a[0]);
  const rows: ResultRow[] = [
    { label: 'Wall height', value: heights.map(([h]) => heightText(h)).join(' / '), note: 'Changes around the house: each column is only as tall as the wall where it stands' },
  ];
  const panelShort = shortOf(s.panelsByRow, o.panelsOwned);
  if (panelShort) o.shortages.push(`${commas(panelShort)} panels`);
  rows.push({
    label: `${o.panelText} panels`,
    value: commas(sum(s.panelsByRow)),
    big: true,
    note: [
      byRowText(s.panelsByRow, s.heightsIn),
      heights
        .map(([h, c]) => `${commas(c.columns)} columns at ${heightText(h)}${o.pieces > 1 ? ` (${c.stack.map((r) => heightText(s.heightsIn[r])).join(' + ')})` : ''}`)
        .join(' · '),
      haveText(s.panelsByRow, o.panelsOwned),
    ]
      .filter(Boolean)
      .join('\n'),
  });
  const fillers = [...s.fillers.entries()].sort((a, b) => b[0] - a[0]);
  rows.push({ label: 'Fillers', value: commas(sum(fillers.flatMap(([, r]) => r))), big: true, note: 'by height' });
  for (const [size, byRow] of fillers) {
    const short = shortOf(byRow, o.owned.get(size));
    if (short) o.shortages.push(`${commas(short)} × ${fillerText(size)}`);
    rows.push({
      label: `${fillerText(size)} fillers`,
      value: commas(sum(byRow)),
      note: [byRowText(byRow, s.heightsIn), haveText(byRow, o.owned.get(size))].filter(Boolean).join('\n'),
    });
  }
  const cornerShort = shortOf(s.cornersByRow, o.cornersOwned);
  if (cornerShort) o.shortages.push(`${commas(cornerShort)} inside corners`);
  rows.push({
    label: 'Inside corners (4×4)',
    value: commas(sum(s.cornersByRow)),
    note: [byRowText(s.cornersByRow, s.heightsIn), `${o.ocCorners} outside + ${o.icCorners} inside corners on the foundation`, haveText(s.cornersByRow, o.cornersOwned)]
      .filter(Boolean)
      .join('\n'),
  });
  if (s.woodPieces) rows.push({ label: 'Wood strips', value: commas(s.woodPieces), note: '1" where a face comes out to an odd inch' });
  rows.push({ label: 'Ties', value: `about ${commas(s.ties)}`, note: 'One every 16" up each joint, fewer where the wall is shorter' });
  return rows;
}

const wallForms: Tool = {
  id: 'wall-forms',
  title: 'Wall Forms (Aluminum)',
  blurb: 'Panels, fillers and corners, wall by wall, with a load list',
  fields: [
    { key: 'walls', label: 'Walls', kind: 'walls', help: 'Measure on the outside. Go around the foundation one wall at a time.' },
    { key: 'thick', label: 'Wall thickness', kind: 'number', unit: 'in', default: '8' },
    { key: 'height1', label: 'Panel height', kind: 'length', default: { ft: '4' } },
    {
      key: 'height2',
      label: 'Stacked on top',
      kind: 'length',
      optional: true,
      help: `Second row, like 4' + 4' or 5' + 3'. Staggered counts the same. Blank = one row.`,
    },
    { key: 'panel', label: 'Panel width', kind: 'number', unit: 'in', default: '24' },
    {
      key: 'fillers',
      label: 'Fillers you own',
      kind: 'stock',
      defaultSizes: CREW_FILLERS_IN.map(String),
      help: 'Leave "how many" blank if you have plenty. Clear keeps this list.',
      sticky: true,
    },
    { key: 'panelsOwned', label: 'Panels you own', kind: 'count', optional: true, sticky: true, help: 'Of each height. Blank = plenty.' },
    { key: 'wallRebar', label: 'Rebar in the wall', kind: 'toggle' },
    barSizeChoice('hBarSize', 'Horizontal bars', '4', ['wallRebar']),
    { key: 'hSpacing', label: 'Horizontal every', kind: 'number', unit: 'in', default: '24', help: 'Up the wall', showIf: ['wallRebar'] },
    barSizeChoice('vBarSize', 'Vertical bars', '4', ['wallRebar']),
    { key: 'vSpacing', label: 'Vertical every', kind: 'number', unit: 'in', default: '24', help: 'Along the wall', showIf: ['wallRebar'] },
    stickField(['wallRebar']),
    lapField(['wallRebar']),
    { key: 'cornersOwned', label: 'Inside corners you own', kind: 'count', optional: true, sticky: true, help: 'Of each height. Blank = plenty.' },
  ],
  compute: (inp, ctx) => {
    const walls = inp.walls('walls');
    const t = inp.num('thick');
    const panelIn = inp.num('panel');
    const heightsIn = [inp.len('height1'), ...(inp.has('height2') ? [inp.len('height2')] : [])].map((ft) => Math.round(ft * 12));
    if (heightsIn.some((h) => h <= 0)) return { error: 'Panel height must be more than 0.' };
    const wallIn = heightsIn.reduce((x, y) => x + y, 0);
    const ties = tiesPerJoint(wallIn);
    if (t <= 0) return { error: 'Wall thickness must be more than 0.' };
    if (panelIn < 4) return { error: 'Panel width must be at least 4".' };

    // What's left on the trailer, per height. A filler used in a stacked column takes one of each height,
    // so stock is "of each height" too.
    const owned = new Map<number, number>();
    for (const row of inp.stock('fillers')) owned.set(row.size, (owned.get(row.size) ?? 0) + (row.qty ?? Infinity));
    const left: FillerStock = new Map(owned);
    const take = (list: number[]) => list.forEach((f) => left.set(f, (left.get(f) ?? 0) - 1));

    // Lay out one face with what's left; if nothing fits, lay it out as if you had plenty (and come up short).
    const lay = (runIn: number): FaceLayout => {
      const withStock = layoutFace(runIn, panelIn, left);
      const fits = withStock.fillers.length > 0 || withStock.woodIn === 0 || runIn < 1;
      const face = fits ? withStock : layoutFace(runIn, panelIn, plenty([...owned.keys()]));
      take(face.fillers);
      return face;
    };

    const pieces = heightsIn.length;
    const panelText = `${dec(panelIn / 12)}'`;
    let panels = 0;
    let woodStrips = 0;
    let joints = 0;
    let ocEnds = 0;
    let icEnds = 0;
    const used = new Map<number, number>();
    const count = (list: number[]) => list.forEach((f) => used.set(f, (used.get(f) ?? 0) + 1));

    const wallRows: ResultRow[] = [];
    const laid: { oc: number; out: FaceLayout; inside: FaceLayout }[] = [];
    for (const [i, w] of walls.entries()) {
      const L = w.length * 12;
      const oc = w.ends === 'oo' ? 2 : w.ends === 'oi' ? 1 : 0;
      const ic = 2 - oc;
      ocEnds += oc;
      icEnds += ic;
      const outMiddle = L - ic * INSIDE_CORNER_IN - oc * OC_PIECE_IN;
      const inRun = L - oc * (t + INSIDE_CORNER_IN) - ic * INSIDE_CORNER_IN;
      if (outMiddle < 0 || inRun < 0) return { error: `Wall ${i + 1} is too short for its corners.` };
      const ocPieces = Array<number>(oc).fill(OC_PIECE_IN);
      take(ocPieces);
      const out = lay(outMiddle);
      const inside = lay(inRun);
      panels += out.panels + inside.panels;
      count([...ocPieces, ...out.fillers, ...inside.fillers]);
      laid.push({ oc, out, inside });
      woodStrips += (out.woodIn ? 1 : 0) + (inside.woodIn ? 1 : 0);
      joints += out.panels + out.fillers.length + oc + 1;
      wallRows.push({
        label: `Wall ${i + 1}: ${ftIn(w.length)}`,
        value: `${out.panels + inside.panels} panels`,
        note: `Out: ${describeFace(ocPieces.slice(0, 1), out, ocPieces.slice(1), panelText)}\nIn: ${describeFace([], inside, [], panelText)}`,
      });
    }

    const each = pieces > 1 ? ' of each height' : '';
    const ocCorners = Math.ceil(ocEnds / 2);
    const icCorners = Math.ceil(icEnds / 2);
    const corners = ocCorners + icCorners;
    const shortages: string[] = [];

    // Walls that change height around the house (daylight basement): count column by column.
    const stepped = ctx?.heightRuns?.length ? steppedForms(walls, laid, t, panelIn, heightsIn, ctx.heightRuns) : null;

    // ---- Load list ----
    let rows: ResultRow[];
    if (stepped) {
      rows = steppedRows(stepped, {
        panelText,
        pieces,
        panelsOwned: inp.has('panelsOwned') ? inp.count('panelsOwned') : null,
        cornersOwned: inp.has('cornersOwned') ? inp.count('cornersOwned') : null,
        owned,
        ocCorners,
        icCorners,
        shortages,
      });
      stepped.wallNotes.forEach((line, i) => {
        if (line) wallRows[i] = { ...wallRows[i], note: `${wallRows[i].note}\n${line}` };
      });
    } else {
      const panelHave = haveNote(panels, inp.has('panelsOwned') ? inp.count('panelsOwned') : null, each);
      if (panelHave.short) shortages.push(`${commas(panelHave.short)} panels`);
      rows = [
        { label: 'Wall height', value: heightText(wallIn) },
        {
          label: `${panelText} panels`,
          value: commas(panels * pieces),
          big: true,
          note: [pieces > 1 ? heightsIn.map((h) => `${commas(panels)} × ${heightText(h)}`).join(' + ') : '', inp.has('panelsOwned') ? panelHave.note ?? '' : '']
            .filter(Boolean)
            .join('\n') || undefined,
        },
        { label: 'Fillers', value: commas([...used.values()].reduce((s, n) => s + n, 0) * pieces), big: true, note: each ? each.trim() : undefined },
      ];
      for (const [size, n] of [...used.entries()].sort((x, y) => y[0] - x[0])) {
        const have = haveNote(n, owned.get(size), each);
        if (have.short) shortages.push(`${commas(have.short)} × ${fillerText(size)}`);
        rows.push({ label: `${fillerText(size)} fillers`, value: commas(n * pieces), note: have.note });
      }
      const cornerHave = haveNote(corners, inp.has('cornersOwned') ? inp.count('cornersOwned') : null, each);
      if (cornerHave.short) shortages.push(`${commas(cornerHave.short)} inside corners`);
      rows.push({
        label: 'Inside corners (4×4)',
        value: commas(corners * pieces),
        note: [`${ocCorners} outside + ${icCorners} inside corners on the foundation`, cornerHave.note ?? ''].filter(Boolean).join('\n'),
      });
      if (woodStrips) rows.push({ label: 'Wood strips', value: commas(woodStrips * pieces), note: '1" where a face comes out to an odd inch' });
      rows.push({ label: 'Ties', value: `about ${commas(joints * ties)}`, note: `${ties} per joint (one every 16")` });
    }
    // Concrete: each outside corner shortens the centerline by the thickness, each inside corner adds it.
    const centerFt = walls.reduce((sum, w) => sum + w.length, 0) - ((ocCorners - icCorners) * t) / 12;
    const heightFt = wallIn / 12;
    rows.push({ label: 'Concrete in the wall', value: cuYd((centerFt * (t / 12) * heightFt) / CUFT_PER_CUYD), note: 'No waste added' });

    // ---- Rebar in the wall: horizontals around the foundation (lapped, L-bars at corners), verticals along it ----
    if (inp.on('wallRebar')) {
      const stockFt = Number(inp.choice('stockLength')) || 20;
      const hBar = getBar(inp.choice('hBarSize'));
      const vBar = getBar(inp.choice('vBarSize'));
      const hs = inp.num('hSpacing');
      const vs = inp.num('vSpacing');
      if (hs <= 0 || vs <= 0) return { error: 'Rebar spacing must be more than 0.' };
      const lapFor = (b: typeof hBar) => (inp.has('lap') ? inp.num('lap') : lapIn(b)) / 12;
      if (2 * lapFor(hBar) > stockFt) return { error: `A corner bar won’t fit in a ${stockFt}' stick.` };
      const lines = countAlong(Math.max(0, wallIn - 6), hs);
      const h = beamBars(centerFt, lines, hBar, stockFt, lapFor(hBar), ocCorners + icCorners);
      const vLen = heightFt - COVER_FT;
      if (vLen > stockFt) return { error: `A vertical won’t fit in a ${stockFt}' stick.` };
      const vCount = countAlong(Math.max(0, centerFt * 12), vs) + ocCorners + icCorners;
      const sticks = new Map<number, number>();
      sticks.set(hBar.size, h.sticks);
      sticks.set(vBar.size, (sticks.get(vBar.size) ?? 0) + sticksToCut([{ lengthFt: vLen, count: vCount }], stockFt));
      rows.push({
        label: 'Horizontal bars',
        value: `${commasTrim(h.totalFt, 1)} ft`,
        note: `${lines} rows of #${hBar.size}, ${dec(hs)}" apart · ${commas(h.laps)} laps · ${commas(h.cornerBars)} corner L-bars ${ftIn(h.cornerBarFt)}`,
      });
      rows.push({ label: 'Vertical bars', value: `${commas(vCount)} × ${ftIn(vLen)}`, note: `#${vBar.size} every ${dec(vs)}", one at each corner · tie to the footing dowels` });
      rows.push(...steelRows(sticks, h.lb + weightLb(vBar, vCount * vLen), stockFt));
    }

    const warnings: string[] = [];
    if (shortages.length) warnings.push(`Short${each}: ${shortages.join(', ')}.`);
    if (stepped?.tooTall.length) warnings.push(`Your panels don't reach ${stepped.tooTall.map(heightText).join(' / ')}. Counted at your full setup there.`);
    if (walls.length >= 4 && ocCorners - icCorners !== 4) {
      warnings.push('Check the corners: a closed foundation has 4 more outside corners than inside corners.');
    }
    return { rows: [...rows, ...wallRows], warnings };
  },
  notes: ['Both sides of the wall. Lengths are rounded to the nearest inch.'],
};

export const CONCRETE_TOOLS: Tool[] = [slab, slabLayout, footings, piers, steps, forms, wallForms];
