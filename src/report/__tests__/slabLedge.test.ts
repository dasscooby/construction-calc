jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import type { Job } from '../../lib/jobs';
import { blankLayout } from '../../lib/layoutEdit';
import { buildLayout, LayoutSpec } from '../foundationLayout';
import { LAYOUT_TOOL_ID, LayoutRaw } from '../layoutItems';
import { figureItems } from '../report';
import { grow, ledgeOf } from '../slabLedge';

// Test 4 (the real job): 70 × 70 house, a 70 × 40 add-on off the back with 10' bays each side, 8" × 44" walls, 4" slabs.
const spec = (ledgeIn?: number, slabDropIn?: number): LayoutSpec => ({
  house: { length: 70, width: 70 },
  wall: { thick: 8 / 12, height: 44 / 12 },
  footing: { width: 16 / 12, depth: 10 / 12 },
  addOns: [{ side: 'top', width: 70, depth: 40, bays: [10, null, 10] }],
  slabs: [{ at: { in: 'main' }, thick: 4 / 12 }, { at: { in: 'addon', addOn: 0, bay: 1 }, thick: 4 / 12 }],
  ...(ledgeIn !== undefined ? { ledgeIn } : {}),
  ...(slabDropIn !== undefined ? { slabDropIn } : {}),
});
const job = (s: LayoutSpec): Job => ({
  id: 'j',
  name: 'Test 4',
  address: '',
  notes: '',
  createdAt: 0,
  items: [{ id: 'L', toolId: LAYOUT_TOOL_ID, title: 'Foundation layout', label: '', raw: { layout: s, wall: { bars: '1', lines: '2', barSize: '4', vSpacing: '24' }, footing: { bars: '1', lines: '2', barSize: '4' } } as LayoutRaw as never, at: 0 }],
});
const row = (j: Job, id: string, label: string) => {
  const f = figureItems(j).find((x) => x.item.id === id)!;
  if (f.result.status !== 'ok') throw new Error(id);
  return f.result.result.rows.find((r) => r.label === label);
};
const cuFt = (j: Job, id: string) => Number(row(j, id, 'Before waste')!.note!.replace(/[^\d.]/g, ''));

describe('the slab ledge', () => {
  test('grows an outline by the ledge, corners and all', () => {
    const g = grow([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }], 1);
    expect(g).toEqual([{ x: -1, y: -1 }, { x: 11, y: -1 }, { x: 11, y: 6 }, { x: -1, y: 6 }]);
    // An L: grows by perimeter × e + 4e² (four more outside corners than inside ones).
    const L = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 }];
    const a = (p: { x: number; y: number }[]) => Math.abs(p.reduce((s, q, i) => s + q.x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * q.y, 0) / 2);
    expect(a(grow(L, 0.5)) - a(L)).toBeCloseTo(40 * 0.5 + 4 * 0.25, 9);
  });

  test('Test 4 by hand: 2" ledge, slab top flush with the wall top, 4" tall notches', () => {
    const lg = ledgeOf(buildLayout(spec(2)))!;
    const e = 2 / 12;
    const main = { P: 2 * (68 + 8 / 12 + 68 + 8 / 12) }; // 68'-8" × 68'-8" clear: 274'-8"
    const bay = { P: 2 * (47 + 4 / 12 + 39 + 4 / 12) }; // 47'-4" × 39'-4" clear
    expect(lg.slabs.map((x) => x.perimeter)).toEqual([expect.closeTo(main.P, 6), expect.closeTo(bay.P, 6)]);
    expect(lg.slabs[0].strip).toBeCloseTo(main.P * e + 4 * e * e, 6); // 45.89 sq ft
    expect(lg.slabs[1].strip).toBeCloseTo(bay.P * e + 4 * e * e, 6); // 29.00 sq ft
    expect(lg.slabs.every((x) => Math.abs(x.notchH - 4 / 12) < 1e-9)).toBe(true);
    expect(lg.length).toBeCloseTo(448, 6); // 274'-8" + 173'-4"
    expect(lg.wallLessCuFt).toBeCloseTo((45.8889 + 29.0) / 3, 3); // 24.96 cu ft (448' × 2" × 4" + the corners)
  });

  test('Test 4 takeoff: before and after', () => {
    const before = job(spec());
    const after = job(spec(2));
    const wallsLess = cuFt(before, 'L:walls') - cuFt(after, 'L:walls');
    const slab1More = cuFt(after, 'L:slab1') - cuFt(before, 'L:slab1');
    const slab2More = cuFt(after, 'L:slab2') - cuFt(before, 'L:slab2');
    expect(Math.abs(wallsLess - 24.96)).toBeLessThan(0.15); // rows are to 0.1 cu ft
    expect(Math.abs(slab1More - 45.8889 / 3)).toBeLessThan(0.15); // 12.0 cu ft
    expect(Math.abs(slab2More - 29.0 / 3)).toBeLessThan(0.15); // 9.7 cu ft
    expect(row(after, 'L:walls', 'Slab ledge')).toMatchObject({ value: '−25 cu ft' });
    expect(row(after, 'L:slab1', 'On the ledge')!.note).toBe(`Clear 68' 8" × 68' 8" at the top; poured 69' 0" × 69' 0"`);
    expect(row(after, 'L:forms', 'Slab ledge blockout')).toMatchObject({ value: '448 ft' });
    // Before-and-after orders, for the report.
    const order = (j: Job, id: string) => row(j, id, 'Order')!.value;
    console.log(
      ['walls', 'slab1', 'slab2'].map((k) => `${k}: ${cuFt(before, `L:${k}`)} → ${cuFt(after, `L:${k}`)} cu ft · order ${order(before, `L:${k}`)} → ${order(after, `L:${k}`)}`).join('\n'),
    );
  });

  test('a slab set down in the wall: the notch runs from its bottom to the top of the wall', () => {
    const lg = ledgeOf(buildLayout(spec(2, 4)))!;
    expect(lg.slabs[0].notchH).toBeCloseTo(8 / 12, 9);
  });

  test('no ledge on layouts saved before ledges, or on a slab sitting on the footing', () => {
    expect(ledgeOf(buildLayout(spec()))).toBeNull();
    const basement = { ...spec(2), wall: { thick: 8 / 12, height: 8 } };
    expect(ledgeOf(buildLayout(basement))).toBeNull();
    expect(blankLayout().ledgeIn).toBe(2);
  });
});
