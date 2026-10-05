jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import type { Job } from '../../lib/jobs';
import { DEFAULT_SETTINGS } from '../../lib/settings';
import { ALL_TOOLS } from '../../tools';
import { defaultRaw, RawValues } from '../../tools/run';
import { suggestLines } from '../billing';
import { findFoundation } from '../foundation';
import { figureItems, jobTotals } from '../report';

const raw = (id: string, patch: RawValues): RawValues => ({ ...defaultRaw(ALL_TOOLS.find((t) => t.id === id)!), ...patch });
const len = (ft: string, inch = '') => ({ ft, in: inch });
const item = (id: string, toolId: string, r: RawValues) => ({ id, toolId, title: toolId, label: '', at: 0, raw: r });

// 30 × 40 basement: 8" walls, 4' + 4' panels (8' tall), footings under them, 4" slab measured to the outside.
const basement: Job = {
  id: 'b',
  name: 'Basement',
  address: '',
  notes: '',
  createdAt: 0,
  items: [
    item('w', 'wall-forms', raw('wall-forms', { walls: [30, 40, 30, 40].map((l) => ({ length: len(String(l)), ends: 'oo' })) as never, height1: len('4'), height2: len('4') })),
    item('f', 'footings', raw('footings', { shape: 'run', length: len('137', '4'), width: len('', '20'), depth: len('', '10') })),
    item('s', 'slab', raw('slab', { areas: [{ length: len('40'), width: len('30') }] as never })),
  ],
  together: { ids: ['w', 'f', 's'], slabDropIn: '' },
};

test('walls, footings and slab are seen as one basement', () => {
  const f = findFoundation(figureItems(basement))!;
  expect(f.kind).toBe('Basement');
  expect(f.footings.map((x) => x.item.id)).toEqual(['f']);
  expect(f.slab?.item.id).toBe('s');
  expect(f.slabAtOutside).toBe(true);
  // Inside: (30 − 16") × (40 − 16") = 28.667 × 38.667 = 1,108.4 sq ft
  expect(Math.round(f.insideArea * 10) / 10).toBe(1108.4);
});

test('the slab is ordered for inside the walls', () => {
  // Measured: 1,200 × 4" = 400 cu ft + 10% = 16.30 yd → 16.50. Inside: 369.5 cu ft + 10% = 15.05 yd → 15.25.
  const f = findFoundation(figureItems(basement))!;
  expect(f.slabOrder).toEqual({ asMeasured: 16.5, inside: 15.25 });
  const t = jobTotals(figureItems(basement), basement);
  // Footings: 137.33 × 20" × 10" = 190.7 cu ft + 10% = 7.77 yd → 8.00; slab 15.25 → 23.25 total
  expect(t.concreteOrderYd).toBe(23.25);
});

test('the bid groups it under Basement; the slab bids at the outside unless you pick inside', () => {
  const lines = suggestLines(figureItems(basement), DEFAULT_SETTINGS, basement);
  expect(lines[0].desc).toBe(`Basement: form and pour 8" × 8' 0" walls`);
  expect(lines[1].desc).toBe('Basement: footings under the walls, dig, form and pour');
  expect(lines[2]).toMatchObject({ desc: 'Basement: slab, pour and finish', qty: '1200' });
  const inside = suggestLines(figureItems(basement), DEFAULT_SETTINGS, { ...basement, slabBid: 'inside' });
  expect(inside[2]).toMatchObject({ desc: 'Basement: slab inside the walls, pour and finish', qty: '1108.4' });
});

test('short walls with a slab: stem wall and slab; walls alone are left alone', () => {
  const stem = { ...basement, items: basement.items.map((i) => (i.id === 'w' ? { ...i, raw: { ...i.raw, height1: len('2'), height2: len('') } } : i)) };
  expect(findFoundation(figureItems(stem))!.kind).toBe('Stem wall and slab');
  expect(findFoundation(figureItems({ ...basement, items: [basement.items[0]] }))).toBeNull();
});

test('nothing is grouped or changed until you check that they go together', () => {
  const open = { ...basement, together: undefined };
  const f = findFoundation(figureItems(open), open)!;
  expect(f.confirmed).toBe(false);
  expect(f.ids).toEqual(['w', 'f', 's']);
  expect(jobTotals(figureItems(open), open).concreteOrderYd).toBe(24.5); // 8.00 + 16.50, as entered
  expect(suggestLines(figureItems(open), DEFAULT_SETTINGS, open)[0].desc).toBe('Wall Forms (Aluminum): form and pour walls');
});

test('your job: 70 × 70 stem wall (Footings & Walls), footing at the house size, slab 8" down', () => {
  const stem: Job = {
    id: 'j',
    name: 'Stem wall',
    address: '',
    notes: '',
    createdAt: 0,
    items: [
      item('w', 'footings', raw('footings', { kind: 'wall', shape: 'rect', bLength: len('70'), bWidth: len('70'), depth: len('2'), width: len('', '8') })),
      item('f', 'footings', raw('footings', { kind: 'footing', shape: 'rect', bLength: len('70'), bWidth: len('70'), wallOn: '8', depth: len('', '10'), width: len('', '20') })),
      item('s', 'slab', raw('slab', { areas: [{ length: len('70'), width: len('70') }] as never })),
    ],
    together: { ids: ['w', 'f', 's'], slabDropIn: '8' },
  };
  const f = findFoundation(figureItems(stem), stem)!;
  expect(f.kind).toBe('Stem wall and slab');
  expect(f.confirmed).toBe(true);
  expect(f.footings.map((x) => x.item.id)).toEqual(['f']);
  expect(f.slabAtOutside).toBe(true);
  expect(f.slabDropIn).toBe(8);
  // Inside the 8" walls: 68.667 × 68.667 = 4,715.1 sq ft (not 4,900)
  expect(Math.round(f.insideArea * 10) / 10).toBe(4715.1);
});

describe('bill and crew sheet for the 70 × 70 stem wall', () => {
  const { buildBill } = require('../billing') as typeof import('../billing');
  const { buildReport } = require('../report') as typeof import('../report');
  const stem: Job = {
    id: 'j',
    name: 'Stem wall',
    address: '',
    notes: '',
    createdAt: 0,
    items: [
      item('w', 'footings', raw('footings', { kind: 'wall', shape: 'rect', bLength: len('70'), bWidth: len('70'), depth: len('2'), width: len('', '8'), bars: '1', lines: '2', vSpacing: '24' })),
      item('f', 'footings', raw('footings', { kind: 'footing', shape: 'rect', bLength: len('70'), bWidth: len('70'), wallOn: '8', depth: len('', '10'), width: len('', '20'), bars: '1', lines: '2' })),
      item('s', 'slab', raw('slab', { areas: [{ length: len('70'), width: len('70') }] as never, slabRebar: '1' })),
    ],
    together: { ids: ['w', 'f', 's'], slabDropIn: '8' },
  };
  const s = { ...DEFAULT_SETTINGS, prices: { ...DEFAULT_SETTINGS.prices, wallFt: '30', footingFt: '22', rebarLb: '1.1' } };

  test('every piece is on the bill: walls as walls, footings, slab, concrete, and rebar for each', () => {
    const lines = suggestLines(figureItems(stem), s, stem);
    const desc = lines.map((l) => l.desc);
    expect(lines[0]).toMatchObject({ desc: `Stem wall and slab: form and pour 8" × 2' 0" walls`, qty: '280', unit: 'ft', price: '30' });
    expect(lines[1]).toMatchObject({ desc: 'Stem wall and slab: footings under the walls, dig, form and pour', qty: '277.3', price: '22' });
    expect(desc).toContain('Stem wall and slab walls: rebar, cut, bent and tied');
    expect(desc).toContain('Stem wall and slab footings: rebar, cut, bent and tied');
    expect(desc).toContain('Stem wall and slab slab: rebar, cut, bent and tied');
    expect(lines.filter((l) => l.unit === 'lb').every((l) => Number(l.qty) > 0 && l.price === '1.1')).toBe(true);
    const bill = buildBill({ ...stem, lines: lines.map((l, i) => ({ ...l, id: String(i) })) }, s, figureItems(stem)).html;
    expect(bill).toContain('rebar, cut, bent and tied');
  });

  test('the crew sheet has the rebar schedule: verticals, bars along the walls and footings, slab bars, sticks to load', () => {
    const r = buildReport(stem, s, { crew: true });
    expect(r.html).toContain('Rebar schedule');
    expect(r.html).toContain('Stem wall and slab walls');
    expect(r.html).toContain('Verticals');
    expect(r.html).toContain('Bars along it');
    expect(r.html).toContain('Slab bars');
    expect(r.html).toMatch(/#4 20' sticks to load/);
    expect(r.text).toContain('REBAR');
  });

  test(`the slab steel is figured inside the walls (68' 8" × 68' 8"), not at the house size`, () => {
    const { rebarSchedule } = require('../report') as typeof import('../report');
    const slabRow = (job: Job) => rebarSchedule(figureItems(job), job).find((r) => r.what === 'Slab bars')!;
    const inside = Number(slabRow(stem).amount.replace(/[^\d.]/g, ''));
    const house = Number(slabRow({ ...stem, together: undefined }).amount.replace(/[^\d.]/g, ''));
    expect(inside).toBeLessThan(house);
    expect(slabRow(stem).note).toContain("sized for a 68' 8\" long");
  });
});

describe('daylight basement: walls that change height', () => {
  const day = (heights: Job['together']) => ({ ...basement, items: basement.items.map((i) => (i.id === 'w' ? { ...i, raw: { ...i.raw, wallRebar: '1' } } : i)), together: heights });
  // From corner A clockwise: the first two walls (30 + 40 = 70 ft) are 8 ft; the rest of the way (70 ft) is 4 ft.
  const heights = { ids: ['w', 'f', 's'], slabDropIn: '', heights: { runs: [{ length: len('70'), height: len('8') }], rest: len('4') } };

  test('it is a daylight basement, with the rest of the way filled in', () => {
    const f = findFoundation(figureItems(day(heights)), day(heights))!;
    expect(f.kind).toBe('Daylight basement');
    expect(f.runs).toEqual([
      { length: 70, height: 8 },
      { length: 70, height: 4 },
    ]);
    expect(f.runsOver).toBe(0);
  });

  test('wall concrete is figured run by run', () => {
    // Middle of the wall ÷ outside = (140 − 4 × 8") ÷ 140 = 0.98095.
    // (70 × 8 + 70 × 4) × 0.98095 × 8/12 = 549.3 cu ft = 20.35 yd (it was 29.0 yd at 8 ft all the way round)
    const { builtItems } = require('../report') as typeof import('../report');
    const wall = builtItems(figureItems(day(heights)), day(heights)).items.find((x) => x.item.id === 'w')!;
    const row = (l: string) => (wall.result.status === 'ok' ? wall.result.result.rows.find((r) => r.label === l) : undefined);
    expect(row('Concrete in the wall')?.value).toBe('20.35 cu yd');
    expect(row('Wall heights')?.note).toBe(`70' 0" at 8' 0", 70' 0" at 4' 0"`);
    expect(row('Vertical bars')).toBeDefined();
  });

  test('heights that run past the walls are caught', () => {
    const tooLong = { ...heights, heights: { runs: [{ length: len('150'), height: len('8') }], rest: len('4') } };
    expect(findFoundation(figureItems(day(tooLong)), day(tooLong))!.runsOver).toBe(10);
  });
});

describe('bid lines picked from what the job has', () => {
  const { bidOptions, lineFor, refreshLines } = require('../bidOptions') as typeof import('../bidOptions');
  const s = { ...DEFAULT_SETTINGS, prices: { ...DEFAULT_SETTINGS.prices, wallFt: '35', slabSqFt: '7' } };

  test('walls can be measured around the outside, along the middle, or by face; slab at the house size or inside', () => {
    const src = bidOptions(figureItems(basement), s, basement);
    const walls = src.find((x) => x.group === 'Walls')!;
    expect(walls.what).toBe('Basement walls: form and pour');
    expect(walls.measures.map((m) => m.id)).toEqual(['around', 'middle', 'face', 'concrete']);
    expect(walls.measures[0].qty).toBe(140);
    expect(Math.round(walls.measures[1].qty * 100) / 100).toBe(137.33);
    const slab = src.find((x) => x.group === 'Slabs')!;
    expect(slab.measures.map((m) => m.id)).toEqual(['house', 'inside', 'concrete']);
    expect(src.some((x) => x.src === 'concrete' && x.measures[0].id === 'ordered')).toBe(true);
    expect(src.filter((x) => x.what.endsWith('rebar, cut, bent and tied')).length).toBe(0); // no rebar on any piece in this job
    expect(src[src.length - 1].src).toBe('other');
  });

  test('picking fills the line from the job and the price book; picking inside uses the inside', () => {
    const src = bidOptions(figureItems(basement), s, basement);
    expect(lineFor(src.find((x) => x.group === 'Walls')!)).toMatchObject({ desc: 'Basement walls: form and pour', qty: '140', unit: 'ft', price: '35', measure: 'around' });
    expect(lineFor(src.find((x) => x.group === 'Slabs')!, 'inside')).toMatchObject({ qty: '1108.44', unit: 'sq ft', price: '7', measure: 'inside' });
  });

  test('lines tied to the job keep today’s number; your own numbers are left alone', () => {
    const src = bidOptions(figureItems(basement), s, basement);
    const walls = src.find((x) => x.group === 'Walls')!;
    const lines = [
      { id: '1', ...lineFor(walls), qty: '999' },
      { id: '2', desc: 'Haul off', qty: '1', unit: 'job', price: '300' },
      { id: '3', ...lineFor(walls), qty: '500', measure: undefined },
    ];
    const out = refreshLines(lines, src);
    expect(out[0].qty).toBe('140');
    expect(out[1]).toBe(lines[1]);
    expect(out[2].qty).toBe('500');
  });
});
