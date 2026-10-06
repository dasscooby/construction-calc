jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import type { Job } from '../../lib/jobs';
import { DEFAULT_SETTINGS } from '../../lib/settings';
import { bidOptions } from '../bidOptions';
import { suggestLines } from '../billing';
import type { LayoutSpec } from '../foundationLayout';
import { LAYOUT_TOOL_ID, LayoutRaw, rectsOf } from '../layoutItems';
import { figureItems, jobTotals, rebarSchedule } from '../report';

const t = 8 / 12;
const spec: LayoutSpec = {
  house: { length: 70, width: 70 },
  wall: { thick: t, height: 4 },
  footing: { width: 16 / 12, depth: 10 / 12 },
  addOns: [{ side: 'top', width: 70, depth: 40, walls: [{ clear: 10, from: 'start' }, { clear: 10, from: 'end' }] }],
  slabs: [{ at: { in: 'house' }, thick: 4 / 12 }, { at: { in: 'addon', addOn: 0, bay: 1 }, thick: 4 / 12 }],
};
const layoutRaw: LayoutRaw = { layout: spec, wall: { bars: '1', lines: '2', barSize: '4', vSpacing: '24' }, footing: { bars: '1', lines: '2', barSize: '4' } };
const job: Job = {
  id: 'j',
  name: 'Stem wall + container add-on',
  address: '',
  notes: '',
  createdAt: 0,
  items: [{ id: 'L', toolId: LAYOUT_TOOL_ID, title: 'Foundation layout', label: '', raw: layoutRaw as never, at: 0 }],
};
const row = (id: string, label: string) => {
  const f = figureItems(job).find((x) => x.item.id === id)!;
  if (f.result.status !== 'ok') throw new Error(`${id}: ${f.result.status}`);
  return f.result.result.rows.find((r) => r.label === label);
};

test('one layout becomes walls, footings and a slab for each pour', () => {
  expect(figureItems(job).map((f) => [f.item.id, f.tool.id, f.item.label])).toEqual([
    ['L:walls', 'footings', 'Walls'],
    ['L:footings', 'footings', 'Footings'],
    ['L:slab1', 'slab', 'House slab, pour 1'],
    ['L:slab2', 'slab', 'Add-on slab, middle bay, pour 2'],
  ]);
});

test('your job: run list, yards and L-bars', () => {
  expect(row('L:walls', 'As measured')?.value).toBe('510 ft');
  expect(row('L:walls', 'As measured')?.note).toContain("Add-on side 40' · Add-on far 70' · Add-on side 40' · Add-on inside 1 40' · Add-on inside 2 40'");
  expect(row('L:walls', 'Along the middle')?.value).toBe('504.7 ft');
  expect(row('L:walls', 'Along the middle')?.note).toContain('6 corners, 6 tees');
  // 504' 8" × 4' × 8" = 49.84 yd; + 10% waste = 54.83.
  expect(row('L:walls', 'Cubic yards')?.value).toBe('54.83');
  // Footing 502' 8" × 16" × 10" = 20.68 yd; + 10% = 22.75.
  expect(row('L:footings', 'Along the middle')?.value).toBe('502.7 ft');
  expect(row('L:footings', 'Cubic yards')?.value).toBe('22.75');
  // An L-bar for each of the 2 bars at every one of the 12 corners and tees.
  expect(row('L:footings', 'Bars along it')?.note).toContain('24 corner L-bars');
  // House slab inside the walls: 68' 8" square; middle bay 47' 4" × 39' 4" = 1,861.8 sq ft.
  expect(row('L:slab1', 'Slab area')?.value).toBe('4,715.1 sq ft');
  expect(row('L:slab2', 'Slab area')?.value).toBe('1,861.8 sq ft');
  expect(row('L:slab2', 'Pour')?.note).toBe(`Inside the walls: 47' 4" × 39' 4"`);
  expect(row('L:slab1', 'Order')?.value).toBe('64.25 yd');
  expect(row('L:slab2', 'Order')?.value).toBe('25.50 yd');
  expect(jobTotals(figureItems(job), job).concreteOrderYd).toBe(55 + 23 + 64.25 + 25.5);
});

test('bill, bid and rebar schedule read it like any other walls, footings and slabs', () => {
  const fi = figureItems(job);
  const lines = suggestLines(fi, DEFAULT_SETTINGS, job).map((l) => `${l.desc} | ${l.qty} ${l.unit}`);
  expect(lines).toContain('Walls: form and pour walls | 510 ft');
  expect(lines).toContain('Footings: dig, form and pour | 502.7 ft');
  expect(lines).toContain('House slab, pour 1: form, pour and finish | 4715.1 sq ft');
  expect(lines).toContain('Add-on slab, middle bay, pour 2: form, pour and finish | 1861.8 sq ft');
  const walls = bidOptions(fi, DEFAULT_SETTINGS, job).find((s) => s.src === 'item:L:walls')!;
  expect(walls.measures.slice(0, 2).map((m) => m.qty)).toEqual([510, 504.7]);
  expect(rebarSchedule(fi, job).length).toBeGreaterThan(0);
});

test('an L-shaped area is cut into rectangles for the slab', () => {
  const L = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 5 },
    { x: 4, y: 5 },
    { x: 4, y: 12 },
    { x: 0, y: 12 },
  ];
  expect(rectsOf(L)).toEqual([
    { w: 10, h: 5 },
    { w: 4, h: 7 },
  ]);
});
