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
import { commas, commasTrim, cuYd, dec, ftIn, money, sqFt } from './format';
import { Field, Inputs, ResultRow, Tool } from './types';

const CUFT_PER_CUYD = 27;

// Every concrete tool ends with waste %, truck size and price.
const ORDER_FIELDS: Field[] = [
  { key: 'waste', label: 'Waste', kind: 'number', unit: '%', default: '10', optional: true },
  { key: 'truck', label: 'Truck size', kind: 'number', unit: 'yd', default: '10', optional: true },
  { key: 'price', label: 'Price per yard', kind: 'number', unit: '$/yd', optional: true },
];

/** The standard answer block: yards with waste, order amount, trucks, bags, and the before-waste number. */
function concreteRows(baseCuFt: number, inp: Inputs, bags = true): ResultRow[] {
  const waste = inp.num('waste');
  const r = concreteResult(baseCuFt, waste);
  const rows: ResultRow[] = [
    { label: 'Cubic yards', value: dec(r.cuYd, 2), big: true, note: `With ${dec(waste, 1)}% waste` },
    { label: 'Cubic feet', value: commasTrim(r.cuFt, 1) },
    { label: 'Order', value: `${r.orderCuYd.toFixed(2)} yd`, big: true, note: 'Rounded up to the next ¼ yard' },
  ];
  if (inp.num('price') > 0) {
    rows.push({ label: 'Concrete cost', value: money(r.orderCuYd * inp.num('price')), note: `${r.orderCuYd.toFixed(2)} yd × ${money(inp.num('price'))}` });
  }
  const truck = inp.num('truck');
  if (truck > 0 && r.orderCuYd > 0) {
    const t = truckLoads(r.orderCuYd, truck);
    rows.push({
      label: 'Trucks',
      value: t.trucks === 1 ? '1 truck' : `${t.trucks} trucks`,
      note: t.trucks === 1 ? `${dec(r.orderCuYd)} yd` : `${t.trucks - 1} full (${dec(truck)} yd) + last load ${dec(t.lastLoad)} yd`,
    });
  }
  if (bags) {
    for (const b of r.bags.slice().reverse()) rows.push({ label: `${b.lb} lb bags`, value: commas(b.count) });
  }
  rows.push({ label: 'Before waste', value: `${dec(r.baseCuYd, 2)} cu yd`, note: `${commasTrim(r.baseCuFt, 1)} cu ft` });
  return rows;
}

const slab: Tool = {
  id: 'slab',
  title: 'Slab',
  blurb: 'Length × width × thickness',
  fields: [
    { key: 'areas', label: 'Slab size', kind: 'areas', help: 'Add more areas for L-shaped slabs' },
    { key: 'thick', label: 'Thickness', kind: 'length', default: { in: '4' } },
    ...ORDER_FIELDS,
  ],
  compute: (inp) => {
    const area = inp.areas('areas').reduce((sum, r) => sum + r.length * r.width, 0);
    return { rows: [{ label: 'Slab area', value: sqFt(area) }, ...concreteRows(area * inp.len('thick'), inp)] };
  },
};

const slabBeams: Tool = {
  id: 'slab-beams',
  title: 'Slab + Beams',
  blurb: 'Slab and its beams poured together (monolithic)',
  fields: [
    { key: 'areas', label: 'Slab size', kind: 'areas', help: 'Add more areas for L-shaped slabs' },
    { key: 'thick', label: 'Slab thickness', kind: 'length', default: { in: '4' } },
    { key: 'perim', label: 'Perimeter beam length', kind: 'number', unit: 'ft', optional: true, help: 'Distance around the outside. Blank = figured for you.' },
    { key: 'pWidth', label: 'Perimeter beam width', kind: 'length', default: { in: '12' } },
    { key: 'pDepth', label: 'Perimeter beam depth', kind: 'length', default: { in: '24' }, help: 'Top of slab to bottom of beam' },
    { key: 'interior', label: 'Interior beams, total length', kind: 'number', unit: 'ft', optional: true },
    { key: 'iWidth', label: 'Interior beam width', kind: 'length', default: { in: '12' } },
    { key: 'iDepth', label: 'Interior beam depth', kind: 'length', default: { in: '24' }, help: 'Top of slab to bottom of beam' },
    ...ORDER_FIELDS,
  ],
  compute: (inp) => {
    const rects = inp.areas('areas');
    const area = rects.reduce((sum, r) => sum + r.length * r.width, 0);
    const t = inp.len('thick');
    let perim = inp.num('perim');
    if (!inp.has('perim')) {
      if (rects.length > 1) return { error: 'Enter the perimeter beam length (it can’t be figured from several areas).' };
      perim = 2 * (rects[0].length + rects[0].width);
    }
    const pWidth = inp.len('pWidth');
    const centerline = perimeterBeamCenterline(perim, pWidth);
    if (centerline < 0) return { error: 'The perimeter is too short for that beam width.' };
    const slabCuFt = area * t;
    const perimCuFt = beamBelowSlabCuFt(centerline, pWidth, inp.len('pDepth'), t);
    const intCuFt = beamBelowSlabCuFt(inp.num('interior'), inp.len('iWidth'), inp.len('iDepth'), t);
    const warnings: string[] = [];
    if (inp.len('pDepth') <= t || (inp.has('interior') && inp.len('iDepth') <= t)) {
      warnings.push('A beam isn’t deeper than the slab. Measure beam depth from the top of the slab.');
    }
    return {
      rows: [
        { label: 'Slab area', value: sqFt(area) },
        { label: 'Slab', value: cuYd(slabCuFt / CUFT_PER_CUYD) },
        { label: 'Perimeter beam', value: cuYd(perimCuFt / CUFT_PER_CUYD), note: `${dec(perim, 1)} ft around` },
        { label: 'Interior beams', value: cuYd(intCuFt / CUFT_PER_CUYD) },
        ...concreteRows(slabCuFt + perimCuFt + intCuFt, inp, false),
      ],
      warnings,
    };
  },
  notes: ['Beams only add the part below the slab. Corners aren’t counted twice.'],
};

const footings: Tool = {
  id: 'footings',
  title: 'Footings & Walls',
  blurb: 'Footings, pads, stem walls',
  fields: [
    { key: 'length', label: 'Length', kind: 'length' },
    { key: 'width', label: 'Width (wall thickness)', kind: 'length' },
    { key: 'depth', label: 'Depth (wall height)', kind: 'length' },
    { key: 'qty', label: 'How many', kind: 'count', default: '1' },
    ...ORDER_FIELDS,
  ],
  compute: (inp) => ({
    rows: concreteRows(boxCuFt(inp.len('length'), inp.len('width'), inp.len('depth')) * inp.count('qty'), inp),
  }),
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
    const nominal = Number(inp.choice('board'));
    const label = FORM_BOARDS.find((b) => b.value === inp.choice('board'))!.label;
    const rows = Math.ceil(heightIn / nominal - 1e-9);
    const boardFt = Number(inp.choice('boardLength'));
    const boards = Math.ceil((lf * rows) / boardFt - 1e-9);
    // A stake at each end/corner of every side, then no farther apart than the spacing.
    const stakes = sides.reduce((sum, s) => sum + Math.ceil(s / spacing - 1e-9) + 1, 0);

    const result: ResultRow[] = [{ label: 'Form length', value: `${commasTrim(lf, 1)} ft` }];
    if (rows > 1) result.push({ label: 'Rows of boards', value: `${rows} high` });
    result.push(
      { label: 'Boards', value: `${commas(boards)} × ${boardFt}' ${label}`, big: true },
      { label: 'Stakes', value: commas(stakes), big: true, note: `At every corner and every ${dec(spacing, 1)}'` },
    );
    return { rows: result };
  },
};

// ---------------------------------------------------------------------------------------------
// Aluminum wall forms, sized to the Advance Concrete Form systems (advanceconcreteform.com):
// 24" panels, fillers in 1" steps from 4" to 24", 1"×1" outside corners, 4"×4" inside corners.
// 6-bar system ties are 16" o.c. (8' panel = 6 ties per joint); 4-bar 8' panel has 4.

const OUTSIDE_CORNER_IN = 1; // each leg of the 1×1 outside corner
const INSIDE_CORNER_IN = 4; // each leg of the 4×4 inside corner
const MIN_FILLER_IN = 4;

/** Panel heights stacked in every column, and ties in each vertical joint. */
const WALL_STACKS: Record<string, { label: string; heightsIn: number[]; ties: number }> = {
  stagger8: { label: '5\'4" + 2\'8" staggered', heightsIn: [64, 32], ties: 6 },
  p8: { label: '8\'', heightsIn: [96], ties: 6 },
  p4x2: { label: '4\' + 4\'', heightsIn: [48, 48], ties: 6 },
  p94: { label: '9\'4"', heightsIn: [112], ties: 7 },
  p4: { label: '4\'', heightsIn: [48], ties: 3 },
  bar4_8: { label: '8\' 4-bar', heightsIn: [96], ties: 4 },
  bar5_9: { label: '9\' 5-bar', heightsIn: [108], ties: 5 },
};

/**
 * One straight run of forms between corners: full panels, then fillers for what's left.
 * Leftovers under 4" can't take a filler, so one panel is swapped for two fillers.
 */
export function layoutRun(runIn: number, panelIn: number): { panels: number; fillers: number[] } {
  const run = Math.round(runIn);
  let panels = Math.floor(run / panelIn);
  const left = run - panels * panelIn;
  if (left === 0) return { panels, fillers: [] };
  if (left >= MIN_FILLER_IN) return { panels, fillers: [left] };
  if (panels === 0) return { panels, fillers: [] }; // too short for any form: fill with wood
  panels -= 1;
  const total = panelIn + left;
  return { panels, fillers: [Math.ceil(total / 2), Math.floor(total / 2)] };
}

/** "9'4"" / "5'4"" / "8'" */
const heightText = (inch: number) => (inch % 12 ? `${Math.floor(inch / 12)}'${inch % 12}"` : `${inch / 12}'`);

const wallForms: Tool = {
  id: 'wall-forms',
  title: 'Wall Forms (Aluminum)',
  blurb: 'Panels, fillers, corners and ties for foundation walls',
  fields: [
    { key: 'length', label: 'Outside length', kind: 'length', optional: true },
    { key: 'width', label: 'Outside width', kind: 'length', optional: true },
    { key: 'perim', label: 'Or outside wall length', kind: 'number', unit: 'ft', optional: true, help: 'Other shapes: total around the outside' },
    { key: 'jogs', label: 'Inside corners', kind: 'count', optional: true, help: 'Other shapes only. An L-shape has 1.' },
    { key: 'thick', label: 'Wall thickness', kind: 'number', unit: 'in', default: '8' },
    {
      key: 'stack',
      label: 'Panels',
      kind: 'choice',
      options: Object.entries(WALL_STACKS).map(([value, s]) => ({ value, label: s.label })),
      default: 'p4',
    },
    { key: 'panel', label: 'Panel width', kind: 'number', unit: 'in', default: '24' },
  ],
  compute: (inp) => {
    const t = inp.num('thick');
    const panelIn = inp.num('panel');
    const stack = WALL_STACKS[inp.choice('stack')];
    if (t <= 0) return { error: 'Wall thickness must be more than 0.' };
    if (panelIn < MIN_FILLER_IN) return { error: 'Panel width must be at least 4".' };

    // Each run: its length in inches, and which corner sits at each end on that face.
    let runs: number[];
    let outsideCorners: number;
    let insideCorners: number;
    let perimFt: number;
    let exact = true;
    if (inp.has('perim')) {
      perimFt = inp.num('perim');
      const jogs = inp.count('jogs');
      outsideCorners = 4 + jogs;
      insideCorners = jogs;
      // Outside face: 1×1 corners at the building's outside corners, 4×4 at its inside corners.
      // Inside face: the other way around. The inside face is 8 × the thickness shorter.
      const outFace = perimFt * 12 - 2 * OUTSIDE_CORNER_IN * outsideCorners - 2 * INSIDE_CORNER_IN * insideCorners;
      const inFace = perimFt * 12 - 8 * t - 2 * INSIDE_CORNER_IN * outsideCorners - 2 * OUTSIDE_CORNER_IN * insideCorners;
      if (inFace <= 0) return { error: 'The wall is too short for that many corners.' };
      runs = [outFace, inFace];
      exact = false;
    } else {
      if (!inp.has('length') || !inp.has('width')) return { error: 'Enter the outside length and width, or the outside wall length.' };
      const L = inp.len('length') * 12;
      const W = inp.len('width') * 12;
      perimFt = (2 * (L + W)) / 12;
      outsideCorners = 4;
      insideCorners = 4;
      const outRun = (s: number) => s - 2 * OUTSIDE_CORNER_IN;
      const inRun = (s: number) => s - 2 * t - 2 * INSIDE_CORNER_IN;
      if (inRun(L) <= 0 || inRun(W) <= 0) return { error: 'The foundation is too small for that wall thickness.' };
      runs = [outRun(L), outRun(W), outRun(L), outRun(W), inRun(L), inRun(W), inRun(L), inRun(W)];
    }

    let columns = 0;
    let outsideJoints = 0;
    const fillers = new Map<number, number>();
    runs.forEach((run, i) => {
      const lay = layoutRun(run, panelIn);
      const cols = lay.panels + lay.fillers.length;
      columns += lay.panels;
      for (const f of lay.fillers) fillers.set(f, (fillers.get(f) ?? 0) + 1);
      if (exact ? i < 4 : i === 0) outsideJoints += cols + (exact ? 1 : 0);
    });
    if (!exact) {
      // Odd shapes: no per-wall layout, so allow one filler (about 12" on average) per wall on each face.
      const walls = outsideCorners + insideCorners;
      const avgFillerIn = 12;
      columns = Math.max(0, Math.floor((runs[0] + runs[1] - 2 * walls * avgFillerIn) / panelIn));
      fillers.clear();
      outsideJoints = Math.floor((runs[0] - walls * avgFillerIn) / panelIn) + 2 * walls;
    }

    const pieces = stack.heightsIn.length;
    const each = pieces > 1 ? ' of each height' : '';
    const rows: ResultRow[] = [
      { label: 'Wall height', value: heightText(stack.heightsIn.reduce((a, b) => a + b, 0)) },
      { label: `${dec(panelIn)}" panels`, value: commas(columns * pieces), big: true, note: stack.heightsIn.map((h) => `${commas(columns)} × ${heightText(h)}`).join(' + ') },
    ];
    if (exact) {
      const list = [...fillers.entries()].sort((a, b) => b[0] - a[0]);
      rows.push({
        label: 'Fillers',
        value: list.length ? commas(list.reduce((s, [, n]) => s + n, 0) * pieces) : 'none',
        big: true,
        note: list.length ? list.map(([w, n]) => `${n} × ${w}"`).join(', ') + each : undefined,
      });
    } else {
      rows.push({ label: 'Fillers', value: `about ${commas(2 * (outsideCorners + insideCorners) * pieces)}`, big: true, note: 'About 1 per wall on each side' + each });
    }
    rows.push(
      { label: 'Outside corners (1×1)', value: commas(outsideCorners * pieces), note: pieces > 1 ? `${outsideCorners} of each height` : undefined },
      { label: 'Inside corners (4×4)', value: commas(insideCorners * pieces), note: pieces > 1 ? `${insideCorners} of each height` : undefined },
      { label: 'Ties', value: `about ${commas(outsideJoints * stack.ties)}`, note: `${stack.ties} per joint` },
    );
    // Concrete: centerline length × thickness × height. Centerline = outside perimeter − 4 × thickness.
    const heightFt = stack.heightsIn.reduce((a, b) => a + b, 0) / 12;
    const cuFtWall = (perimFt - (4 * t) / 12) * (t / 12) * heightFt;
    rows.push({ label: 'Concrete in the wall', value: cuYd(cuFtWall / CUFT_PER_CUYD), note: 'No waste added' });
    return { rows };
  },
  notes: ['Both sides of the wall. Runs are rounded to the nearest inch; make up any fraction with wood.'],
};

export const CONCRETE_TOOLS: Tool[] = [slab, slabBeams, footings, piers, steps, forms, wallForms];
