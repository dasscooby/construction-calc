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
import { Field, Inputs, ResultRow, Tool } from './types';

import { concreteRows, CUFT_PER_CUYD, ORDER_FIELDS } from './concreteShared';
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

const footings: Tool = {
  id: 'footings',
  title: 'Footings & Walls',
  blurb: 'Footings, pads, stem walls, with the rebar',
  fields: [
    { key: 'length', label: 'Length', kind: 'length' },
    { key: 'width', label: 'Width (wall thickness)', kind: 'length' },
    { key: 'depth', label: 'Depth (wall height)', kind: 'length' },
    { key: 'qty', label: 'How many', kind: 'count', default: '1' },
    { key: 'bars', label: 'Rebar', kind: 'toggle' },
    { key: 'lines', label: 'Bars along it', kind: 'count', default: '2', help: '2 #4 continuous = 2. More than 3 go half bottom, half top.', showIf: ['bars'] },
    barSizeChoice('barSize', 'Bar size', '4', ['bars']),
    { key: 'corners', label: 'Corners', kind: 'count', optional: true, help: 'If it goes around a building: an L-bar at each corner for every bar', showIf: ['bars'] },
    { key: 'vSpacing', label: 'Verticals every', kind: 'number', unit: 'in', optional: true, help: 'Stem walls: bars standing up. Blank = none.', showIf: ['bars'] },
    stickField(['bars']),
    lapField(['bars']),
    ...ORDER_FIELDS,
  ],
  compute: (inp) => {
    const rows = concreteRows(boxCuFt(inp.len('length'), inp.len('width'), inp.len('depth')) * inp.count('qty'), inp);
    if (!inp.on('bars')) return { rows };
    const bar = getBar(inp.choice('barSize'));
    const stockFt = Number(inp.choice('stockLength')) || 20;
    const lapFt = (inp.has('lap') ? inp.num('lap') : lapIn(bar)) / 12;
    const lines = inp.count('lines');
    const runFt = inp.len('length') * inp.count('qty');
    const depthFt = inp.len('depth');
    if (lines < 1) return { error: 'Enter at least 1 bar.' };
    if (2 * lapFt > stockFt) return { error: `A corner bar won’t fit in a ${stockFt}' stick.` };
    const corners = inp.has('corners') ? inp.count('corners') : 0;
    // Around a building the bars run all the way round; a straight run stops 3" short of each end.
    const r = beamBars(corners ? runFt : Math.max(0, runFt - 2 * COVER_FT), lines, bar, stockFt, lapFt, corners);
    rows.push({
      label: 'Bars along it',
      value: `${commasTrim(r.totalFt, 1)} ft`,
      note: `${lines} #${bar.size} · ${commas(r.laps)} laps${corners ? ` · ${commas(r.cornerBars)} corner L-bars ${ftIn(r.cornerBarFt)}` : ''}`,
    });
    let sticks = r.sticks;
    let totalLb = r.lb;
    if (inp.has('vSpacing')) {
      const s = inp.num('vSpacing');
      if (s <= 0) return { error: 'Verticals spacing must be more than 0.' };
      const len = depthFt - COVER_FT;
      if (len <= 0) return { error: 'The wall is too short for verticals.' };
      if (len > stockFt) return { error: `A vertical won’t fit in a ${stockFt}' stick.` };
      const count = countAlong(Math.max(0, runFt * 12 - 6), s);
      sticks += sticksToCut([{ lengthFt: len, count }], stockFt);
      totalLb += weightLb(bar, count * len);
      rows.push({ label: 'Verticals', value: `${commas(count)} × ${ftIn(len)}`, note: `#${bar.size} every ${dec(s)}", 3" from the top` });
    }
    rows.push(...steelRows(new Map([[bar.size, sticks]]), totalLb, stockFt));
    return { rows };
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
    return { rows: [...rows, ...concreteRows(each * qty, inp)] };
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
    const stairs = stepsCuFt(n, inp.len('rise'), inp.len('run'), inp.len('width'));
    const landing = inp.len('landing') * inp.len('width') * n * inp.len('rise');
    return { rows: concreteRows(stairs + landing, inp) };
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
  compute: (inp) => {
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

    // ---- Load list ----
    const panelHave = haveNote(panels, inp.has('panelsOwned') ? inp.count('panelsOwned') : null, each);
    if (panelHave.short) shortages.push(`${commas(panelHave.short)} panels`);
    const rows: ResultRow[] = [
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
    if (walls.length >= 4 && ocCorners - icCorners !== 4) {
      warnings.push('Check the corners: a closed foundation has 4 more outside corners than inside corners.');
    }
    return { rows: [...rows, ...wallRows], warnings };
  },
  notes: ['Both sides of the wall. Lengths are rounded to the nearest inch.'],
};

export const CONCRETE_TOOLS: Tool[] = [slab, slabLayout, footings, piers, steps, forms, wallForms];
