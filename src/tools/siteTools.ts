// Site tools: slope & fall, laser grade shots, digging, and fill / base rock.
// The math lives in src/lib/site.ts.

import {
  cutFill,
  dropOverRun,
  elevationFromRod,
  excavationBankCuYd,
  fillBase,
  heightOfInstrument,
  loadsNeeded,
  looseFromBank,
  rodReadingFor,
  slopeFromDrop,
  slopeFromInPerFt,
  slopeFromPercent,
  slopeInPerFt,
  slopePercent,
} from '../lib/site';
import { fixed } from '../lib/units';
import { commas, commasTrim, dec, ftIn, inches, pct, sqFt } from './format';
import { ResultRow, Tool } from './types';

/** Elevations and rod readings: decimal feet to the hundredth, like a grade rod. */
const elev = (ft: number) => `${fixed(ft, 2).replace('-', '−')} ft`;

const slope: Tool = {
  id: 'slope',
  title: 'Slope & Fall',
  blurb: 'Drop over a distance, or the slope from a drop',
  fields: [
    { key: 'run', label: 'Distance', kind: 'length' },
    { key: 'slope', label: 'Slope', kind: 'number', optional: true, help: 'Fill in slope OR drop. 1/4 = 1/4" per foot.' },
    {
      key: 'slopeUnit',
      label: 'Slope in',
      kind: 'choice',
      options: [
        { value: 'inft', label: 'inches per foot' },
        { value: 'pct', label: 'percent' },
      ],
      default: 'inft',
    },
    { key: 'drop', label: 'Drop', kind: 'length', optional: true },
  ],
  compute: (inp) => {
    const run = inp.len('run');
    if (run <= 0) return { error: 'The distance must be more than 0.' };
    const hasSlope = inp.has('slope');
    const hasDrop = inp.has('drop');
    if (hasSlope && hasDrop) return { error: 'Fill in the slope or the drop, not both.' };
    if (!hasSlope && !hasDrop) return { error: 'Fill in the slope or the drop.' };

    const s = hasSlope
      ? inp.choice('slopeUnit') === 'pct'
        ? slopeFromPercent(inp.num('slope'))
        : slopeFromInPerFt(inp.num('slope'))
      : slopeFromDrop(inp.len('drop'), run);
    const drop = hasSlope ? dropOverRun(run, s) : inp.len('drop');
    const rows: ResultRow[] = [
      { label: 'Drop', value: inches(drop * 12), big: true, note: ftIn(drop) },
      { label: 'Slope', value: `${inches(slopeInPerFt(s))} per ft`, big: true },
      { label: 'Percent', value: pct(slopePercent(s), 2) },
    ];
    return { rows };
  },
  notes: ['1/4" per foot is about 2%. Ramps: no steeper than 1" per foot.'],
};

const elevations: Tool = {
  id: 'elevations',
  title: 'Grade Rod (Laser)',
  blurb: 'Rod reading for grade, and cut or fill',
  fields: [
    { key: 'bm', label: 'Benchmark elevation', kind: 'number', unit: 'ft', default: '100', allowNegative: true },
    { key: 'bs', label: 'Rod on benchmark', kind: 'number', unit: 'ft', help: 'Rod reading in feet, like 4.62' },
    { key: 'target', label: 'Grade elevation', kind: 'number', unit: 'ft', allowNegative: true, help: 'Top of slab, top of forms, or bottom of footing' },
    { key: 'shot', label: 'Rod at a spot', kind: 'number', unit: 'ft', optional: true, help: 'To see cut or fill there' },
  ],
  compute: (inp) => {
    const hi = heightOfInstrument(inp.num('bm'), inp.num('bs'));
    const target = inp.num('target');
    const want = rodReadingFor(hi, target);
    const rows: ResultRow[] = [
      { label: 'Rod at grade', value: elev(want), big: true, note: `${ftIn(want)} on a feet-inch rod` },
      { label: 'Laser height (HI)', value: elev(hi) },
    ];
    const warnings: string[] = [];
    if (want < 0) warnings.push('Grade is above the laser. Set the laser higher.');
    if (inp.has('shot')) {
      const spot = elevationFromRod(hi, inp.num('shot'));
      const cf = cutFill(spot, target);
      rows.push({ label: 'Spot elevation', value: elev(spot) });
      if (Math.abs(cf) < 0.005) rows.push({ label: 'On grade', value: elev(0), big: true });
      else if (cf > 0) rows.push({ label: 'Cut', value: elev(cf), big: true, note: `${inches(cf * 12)} high` });
      else rows.push({ label: 'Fill', value: elev(-cf), big: true, note: `${inches(-cf * 12)} low` });
    }
    return { rows, warnings };
  },
  notes: ['The rod reads more where it’s low (fill) and less where it’s high (cut).'],
};

const excavation: Tool = {
  id: 'excavation',
  title: 'Excavation',
  blurb: 'Dirt to dig and haul, with truck loads',
  fields: [
    { key: 'length', label: 'Length', kind: 'length' },
    { key: 'width', label: 'Width', kind: 'length' },
    { key: 'depth', label: 'Depth', kind: 'length' },
    { key: 'qty', label: 'How many', kind: 'count', default: '1' },
    { key: 'overDig', label: 'Over-dig each side', kind: 'number', unit: 'in', optional: true, help: 'Working room around forms' },
    { key: 'swell', label: 'Swell', kind: 'number', unit: '%', default: '25', help: 'Dirt fluffs up when dug' },
    { key: 'truck', label: 'Truck size', kind: 'number', unit: 'yd', default: '10', optional: true },
  ],
  compute: (inp) => {
    const overDigFt = inp.num('overDig') / 12;
    if (inp.len('length') <= 0 || inp.len('width') <= 0 || inp.len('depth') <= 0) return { error: 'Length, width and depth must be more than 0.' };
    if (inp.count('qty') < 1) return { error: 'How many must be at least 1.' };
    const bank = excavationBankCuYd(inp.len('length'), inp.len('width'), inp.len('depth'), inp.count('qty'), overDigFt);
    const loose = looseFromBank(bank, inp.num('swell'));
    const rows: ResultRow[] = [];
    if (overDigFt > 0) {
      rows.push({ label: 'Dig size', value: `${ftIn(inp.len('length') + 2 * overDigFt)} × ${ftIn(inp.len('width') + 2 * overDigFt)}` });
    }
    rows.push(
      { label: 'In the ground', value: `${dec(bank, 2)} cu yd`, big: true, note: `${commasTrim(bank * 27, 1)} cu ft` },
      { label: 'Loose (to haul)', value: `${dec(loose, 2)} cu yd`, big: true, note: `With ${dec(inp.num('swell'), 1)}% swell` },
    );
    const truck = inp.num('truck');
    if (truck > 0) rows.push({ label: 'Truck loads', value: commas(loadsNeeded(loose, truck)) });
    return { rows };
  },
  notes: ['Swell: sand 10–15%, dirt 20–30%, clay 30–40%.'],
};

const fillBaseTool: Tool = {
  id: 'fill-base',
  title: 'Fill & Base Rock',
  blurb: 'Rock, sand or fill to order: yards, tons, loads',
  fields: [
    { key: 'areas', label: 'Area', kind: 'areas', help: 'Add more areas for odd shapes' },
    { key: 'depth', label: 'Compacted depth', kind: 'length', default: { in: '4' } },
    { key: 'allowance', label: 'Extra for compaction', kind: 'number', unit: '%', default: '20' },
    { key: 'density', label: 'Tons per yard', kind: 'number', unit: 'tons', default: '1.4', help: 'Ask your supplier' },
    { key: 'truckTons', label: 'Truck size', kind: 'number', unit: 'tons', default: '15', optional: true },
  ],
  compute: (inp) => {
    const area = inp.areas('areas').reduce((sum, r) => sum + r.length * r.width, 0);
    if (inp.len('depth') <= 0) return { error: 'Compacted depth must be more than 0.' };
    if (inp.num('density') <= 0) return { error: 'Tons per yard must be more than 0. Ask your supplier (rock is about 1.4).' };
    const r = fillBase(area, inp.len('depth'), inp.num('allowance'), inp.num('density'));
    const rows: ResultRow[] = [
      { label: 'Area', value: sqFt(area) },
      { label: 'Compacted', value: `${dec(r.compactedCuYd, 2)} cu yd` },
      { label: 'Order (loose)', value: `${dec(r.looseCuYd, 2)} cu yd`, big: true, note: `With ${dec(inp.num('allowance'), 1)}% extra for compaction` },
      { label: 'Tons', value: `${dec(r.tons, 1)} tons`, big: true, note: `At ${dec(inp.num('density'), 2)} tons per yard` },
    ];
    const truck = inp.num('truckTons');
    if (truck > 0) rows.push({ label: 'Truck loads', value: commas(loadsNeeded(r.tons, truck)) });
    return { rows };
  },
  notes: ['Rock and gravel run about 1.4–1.5 tons per yard, sand about 1.3–1.4.'],
};

export const SITE_TOOLS: Tool[] = [slope, elevations, excavation, fillBaseTool];
