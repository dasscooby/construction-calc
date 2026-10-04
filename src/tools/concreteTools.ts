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
import { commas, commasTrim, cuYd, dec, ftIn, inches, money, sqFt } from './format';
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

// Joint spacing: 2-1/2 × the slab thickness (inches) in feet, never over 15'.
// ACI 302.1R / PCA give 24–36 × the thickness; 30× is the middle of that range.
const JOINT_FT_PER_IN = 2.5;
const MAX_JOINT_FT = 15;
// Panels longer than 1-1/2 times their width tend to crack across the middle (ACI 302.1R).
const MAX_PANEL_RATIO = 1.5;

const controlJoints: Tool = {
  id: 'control-joints',
  title: 'Control Joints',
  blurb: 'Joint spacing, panels, feet of saw cut',
  fields: [
    { key: 'length', label: 'Slab length', kind: 'length' },
    { key: 'width', label: 'Slab width', kind: 'length' },
    { key: 'thick', label: 'Thickness', kind: 'length', default: { in: '4' } },
    { key: 'max', label: 'Max spacing', kind: 'number', unit: 'ft', optional: true, help: 'Blank = 10\' on 4", 12-1/2\' on 5", 15\' on 6"' },
  ],
  compute: (inp) => {
    const L = inp.len('length');
    const W = inp.len('width');
    const thickIn = inp.len('thick') * 12;
    if (L <= 0 || W <= 0) return { error: 'Length and width must be more than 0.' };
    if (thickIn <= 0) return { error: 'Thickness must be more than 0.' };
    const max = inp.has('max') ? inp.num('max') : Math.min(MAX_JOINT_FT, JOINT_FT_PER_IN * thickIn);
    if (max <= 0) return { error: 'Max spacing must be more than 0.' };

    const acrossLength = Math.ceil(L / max - 1e-9); // panels along the length
    const acrossWidth = Math.ceil(W / max - 1e-9);
    const sL = L / acrossLength;
    const sW = W / acrossWidth;
    const cutFt = (acrossLength - 1) * W + (acrossWidth - 1) * L;
    const warnings: string[] = [];
    if (Math.max(sL, sW) / Math.min(sL, sW) > MAX_PANEL_RATIO) {
      warnings.push('Panels are long and skinny (more than 1-1/2 to 1). Add a joint so they’re closer to square.');
    }
    if (inp.has('max') && inp.num('max') > JOINT_FT_PER_IN * thickIn + 1e-9) {
      warnings.push(`That’s farther apart than 2-1/2 × the thickness (${dec(JOINT_FT_PER_IN * thickIn, 1)}'). Expect random cracks.`);
    }
    return {
      rows: [
        { label: 'Joints along length', value: `every ${ftIn(sL)}`, big: true, note: `${acrossLength - 1} joints` },
        { label: 'Joints along width', value: `every ${ftIn(sW)}`, big: true, note: `${acrossWidth - 1} joints` },
        { label: 'Panels', value: commas(acrossLength * acrossWidth) },
        { label: 'Saw cut', value: `${commasTrim(cutFt, 1)} ft` },
        { label: 'Cut depth', value: inches(thickIn / 4, 8), note: '¼ of the thickness' },
      ],
      warnings,
    };
  },
  notes: ['Cut as soon as the saw won’t ravel the edges, within the same day.'],
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

export const CONCRETE_TOOLS: Tool[] = [slab, slabBeams, footings, piers, steps, controlJoints, forms];
