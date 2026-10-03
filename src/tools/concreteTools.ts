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
import { commas, commasTrim, cuYd, dec, ftIn, sqFt } from './format';
import { Field, Inputs, ResultRow, Tool } from './types';

const CUFT_PER_CUYD = 27;

// Every concrete tool ends with waste % and truck size.
const ORDER_FIELDS: Field[] = [
  { key: 'waste', label: 'Waste', kind: 'number', unit: '%', default: '10', optional: true },
  { key: 'truck', label: 'Truck size', kind: 'number', unit: 'yd', default: '10', optional: true },
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

export const CONCRETE_TOOLS: Tool[] = [slab, slabBeams, footings, piers, steps];
