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
    item('f', 'footings', raw('footings', { length: len('137', '4'), width: len('', '20'), depth: len('', '10') })),
    item('s', 'slab', raw('slab', { areas: [{ length: len('40'), width: len('30') }] as never })),
  ],
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
  const t = jobTotals(figureItems(basement));
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
