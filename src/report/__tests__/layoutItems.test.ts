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
  addOns: [{ side: 'top', width: 70, depth: 40, bays: [10, null, 10] }],
  slabs: [{ at: { in: 'main' }, thick: 4 / 12 }, { at: { in: 'addon', addOn: 0, bay: 1 }, thick: 4 / 12 }],
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
    ['L:slab1', 'slab', 'Slab 1: Main slab'],
    ['L:slab2', 'slab', 'Slab 2: Add-on slab, middle bay'],
  ]);
});

test('your job: run list, yards and L-bars', () => {
  expect(row('L:walls', 'As measured')?.value).toBe('510 ft');
  expect(row('L:walls', 'As measured')?.note).toBe("Main 4 @ 70' = 280' · Add-on 4 @ 40' + 1 @ 70' = 230'");
  expect(row('L:walls', 'Along the middle')?.value).toBe('504.7 ft');
  expect(row('L:walls', 'Along the middle')?.note).toContain('4 corners, 6 tees');
  // 504' 8" × 4' × 8" = 49.84 yd; + 10% waste = 54.83.
  expect(row('L:walls', 'Cubic yards')?.value).toBe('54.83');
  // Footing 502' 8" × 16" × 10" = 20.68 yd; + 10% = 22.75.
  expect(row('L:footings', 'Along the middle')?.value).toBe('502.7 ft');
  expect(row('L:footings', 'Cubic yards')?.value).toBe('22.75');
  // An L-bar for each of the 2 bars at every one of the 10 corners and tees.
  expect(row('L:footings', 'Bars along it')?.note).toContain('20 corner L-bars');
  // Main slab inside the walls: 68' 8" square; middle bay 47' 4" × 39' 4" = 1,861.8 sq ft.
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
  expect(lines).toContain('Slab 1: Main slab: form, pour and finish | 4715.1 sq ft');
  expect(lines).toContain('Slab 2: Add-on slab, middle bay: form, pour and finish | 1861.8 sq ft');
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

describe('drawings of a layout', () => {
  const { layoutItemDrawings, jobDrawings } = require('../report') as typeof import('../report');
  const { buildLayout, bayName } = require('../foundationLayout') as typeof import('../foundationLayout');
  const { hitLayout, planFrame } = require('../layoutPlanDraw') as typeof import('../layoutPlanDraw');

  test('the plan labels every run, the bays face to face, and each pour', () => {
    const d = layoutItemDrawings(job, figureItems(job), 'Gaitan Concrete')!;
    for (const t of [`MAIN BACK B–C 70'-0"`, `ADD-ON FAR 70'-0"`, `ADD-ON SIDE 40'-0"`, `ADD-ON INSIDE 1 40'-0"`, `ADD-ON INSIDE 2 40'-0"`]) expect(d.plan).toContain(t);
    expect(d.plan).toContain(`47'-4"`);
    expect(d.plan).toContain('BAYS, CLEAR (FACE TO FACE)');
    expect(d.plan).toContain('4" SLAB 2');
    expect(d.plan).toContain(`SLAB 2: ADD-ON SLAB, MIDDLE BAY, 4" · 47'-4" × 39'-4" CLEAR · 1,862 SQ FT · 25.5 YD`);
    expect(d.iso).toContain('<polygon');
    expect(d.section).toContain('TYPICAL SECTION');
    // The crew sheet and the bid use it.
    expect(jobDrawings(job, figureItems(job))?.plan).toBe(layoutItemDrawings(job, figureItems(job))?.plan);
  });

  test('a tap finds the run or the bay under it, and lights it up', () => {
    const l = buildLayout(spec);
    const f = planFrame(l);
    const inside1 = l.runs.findIndex((r) => r.name === 'Add-on inside 1');
    const r = l.graph.runs[inside1].run;
    const at = (x: number, y: number) => hitLayout(l, Number(f.X(x)), Number(f.Y(y)));
    expect(at((r.a.x + r.b.x) / 2, (r.a.y + r.b.y) / 2)).toEqual({ run: inside1 });
    const mid = l.graph.faces.indexOf(l.slabs[1].face);
    expect(at(35, -20)).toEqual({ face: mid }); // middle of the middle bay
    expect(at(35, 35).face).toBe(l.graph.faces.indexOf(l.slabs[0].face));
    expect(layoutItemDrawings(job, figureItems(job), '', { face: mid })!.plan).toContain('fill-opacity="0.22"');
    expect(layoutItemDrawings(job, figureItems(job), '', { run: inside1 })!.plan).toContain('fill-opacity="0.75"');
  });

  test('bays are named the way the plan reads, for the side the add-on is on', () => {
    expect([0, 1, 2].map((i) => bayName(i, 3, { side: 'top' }))).toEqual(['left bay', 'middle bay', 'right bay']);
    expect([0, 1, 2].map((i) => bayName(i, 3, { side: 'right' }))).toEqual(['top bay', 'middle bay', 'bottom bay']);
  });
});
