jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import type { Job } from '../../lib/jobs';
import { DEFAULT_SETTINGS } from '../../lib/settings';
import { ALL_TOOLS } from '../../tools';
import { addonLayout, insidePositions } from '../../tools/addon';
import { defaultRaw, RawValues } from '../../tools/run';
import { bidOptions } from '../bidOptions';
import { suggestLines } from '../billing';
import { findFoundation, foundationLines, pourCount } from '../foundation';
import { figureItems, foundationDrawings, jobTotals, pieceName } from '../report';

const raw = (id: string, patch: RawValues): RawValues => ({ ...defaultRaw(ALL_TOOLS.find((t) => t.id === id)!), ...patch });
const len = (ft: string, inch = '') => ({ ft, in: inch });
const item = (id: string, toolId: string, r: RawValues) => ({ id, toolId, title: toolId, label: '', at: 0, raw: r });
const rowOf = (items: ReturnType<typeof figureItems>, id: string, label: string) => {
  const f = items.find((x) => x.item.id === id)!;
  if (f.result.status !== 'ok') throw new Error(`${id}: ${f.result.status} ${'message' in f.result ? f.result.message : ''}`);
  return f.result.result.rows.find((r) => r.label === label);
};

// Your job: the 70' × 70' stem wall (8" × 4', 16" × 10" footing, 4" slab), plus a 70' wide add-on that comes
// out 40' off one side, with 2 container walls 10' in from each side, and a 50' × 40' slab poured on its own.
const addonRaw = { shape: 'addon', aWidth: len('70'), aDepth: len('40'), inWalls: '2', inFrom: len('10'), side: 'ab' };
const items = [
  item('w', 'footings', raw('footings', { kind: 'wall', shape: 'rect', bLength: len('70'), bWidth: len('70'), depth: len('4'), width: len('', '8') })),
  item('f', 'footings', raw('footings', { kind: 'footing', shape: 'rect', bLength: len('70'), bWidth: len('70'), depth: len('', '10'), width: len('', '16'), wallOn: '8' })),
  item('s', 'slab', raw('slab', { areas: [{ length: len('70'), width: len('70') }] as never })),
  item('aw', 'footings', raw('footings', { kind: 'wall', ...addonRaw, depth: len('4'), width: len('', '8') })),
  item('af', 'footings', raw('footings', { kind: 'footing', ...addonRaw, depth: len('', '10'), width: len('', '16'), wallOn: '8' })),
  item('s2', 'slab', raw('slab', { areas: [{ length: len('50'), width: len('40') }] as never })),
];
const job: Job = { id: 'j', name: 'Stem wall + container add-on', address: '', notes: '', createdAt: 0, items, together: { ids: ['w', 'f', 's', 'aw', 'af', 's2'], slabDropIn: '8' } };

test('inside walls: first and last in from each side, the rest evenly between', () => {
  expect(insidePositions(70, 2, 10)).toEqual([10, 60]);
  expect(insidePositions(70, 3, 10)).toEqual([10, 35, 60]);
  expect(insidePositions(60, 2, 0)).toEqual([20, 40]);
  expect(insidePositions(70, 0, 10)).toEqual([]);
});

test('add-on walls: sides and inside walls stop at the wall they tee into', () => {
  // 8" walls: sides 40' − 4" each, far wall 70' − 8", inside walls 40' − 8" each.
  const a = addonLayout({ width: 70, depth: 40, t: 8 / 12, w: 8 / 12, inside: 2, inFrom: 10 });
  if ('error' in a) throw new Error(a.error);
  expect(a.asMeasuredFt).toBe(230); // 40 + 70 + 40 + 2 × 40, the way you'd measure it
  expect(Math.round(a.centerFt * 100) / 100).toBe(227.33); // 2 × 39.667 + 69.333 + 2 × 39.333
  expect(a.corners).toBe(2);
  expect(a.tees).toBe(6);
  // Bays between the inside faces: 9' 0" / 49' 4" / 9' 0"
  expect(a.bays.map((b) => Math.round((b.u1 - b.u0) * 1000) / 1000)).toEqual([9, 49.333, 9]);
  // Footing (16" under an 8" wall): it stops at the edge of the footing it meets.
  const f = addonLayout({ width: 70, depth: 40, t: 8 / 12, w: 16 / 12, inside: 2, inFrom: 10 });
  if ('error' in f) throw new Error(f.error);
  expect(Math.round(f.centerFt * 100) / 100).toBe(225.33); // 2 × 39.333 + 69.333 + 2 × 38.667
});

test('add-on numbers on the tool', () => {
  const fi = figureItems(job);
  expect(rowOf(fi, 'aw', 'As measured')?.value).toBe('230 ft');
  expect(rowOf(fi, 'aw', 'Along the middle')?.value).toBe('227.3 ft');
  expect(rowOf(fi, 'aw', 'Along the middle')?.note).toContain('2 corners, 6 tees');
  expect(rowOf(fi, 'af', 'Along the middle')?.value).toBe('225.3 ft');
});

test('your job is seen as one foundation: stem wall and slab, an add-on and a second pour', () => {
  const fi = figureItems(job);
  const f = findFoundation(fi, job)!;
  expect(f.kind).toBe('Stem wall and slab');
  expect(f.addOns.map((a) => [a.item.item.id, a.kind, a.side])).toEqual([
    ['aw', 'wall', 0],
    ['af', 'footing', 0],
  ]);
  expect(f.pours.map((p) => p.item.id)).toEqual(['s2']);
  expect(f.slab?.item.id).toBe('s');
  expect(f.confirmed).toBe(true);
  expect(pourCount(f)).toBe(4); // footings, walls, slab, second slab
  const lines = foundationLines(f, job);
  expect(lines.some((l) => l.startsWith('Add-on walls on the top: 70\' 0" wide, out 40\' 0", 2 walls inside'))).toBe(true);
  expect(lines.some((l) => l.startsWith('Slab, second pour: 2,000 sq ft'))).toBe(true);
  expect(pieceName(fi.find((x) => x.item.id === 's2')!, fi, job)).toBe('Stem wall and slab slab, second pour');
});

test('bill: walls and footings for the add-on, the second pour, and a pump for each pour', () => {
  const fi = figureItems(job);
  const lines = suggestLines(fi, DEFAULT_SETTINGS, { ...job, order: { place: 'pump' } as never });
  const desc = lines.map((l) => `${l.desc} | ${l.qty} ${l.unit}`);
  expect(desc).toContain('Stem wall and slab add-on: form and pour 8" × 4\' 0" walls | 230 ft');
  expect(desc).toContain('Stem wall and slab add-on: footings under the walls, dig, form and pour | 225.3 ft');
  expect(desc).toContain('Stem wall and slab, second pour: form, pour and finish | 2000 sq ft');
  expect(desc).toContain('Pump truck | 4 pour');
  const pump = bidOptions(fi, DEFAULT_SETTINGS, job).find((s) => s.src === 'pump')!;
  expect(pump.measures.map((m) => m.label)).toEqual(['One pour', 'Each pour (4: footings, walls, slab, second pour)']);
});

test('the foundation plan and 3D show the add-on and the second pour', () => {
  const d = foundationDrawings(job, figureItems(job))!;
  expect(d.plan).toContain('2ND POUR');
  expect(d.plan).toContain("40'-0\"");
  expect(d.iso).toBeDefined();
});

test('your numbers next to the app (all with 10% waste)', () => {
  const fi = figureItems(job);
  // Walls: (277' 4" + 227' 4") along the middle × 4' × 8" = 49.84 yd; + 10% = 54.83 (you had 51 at 510').
  expect(rowOf(fi, 'w', 'Cubic yards')?.value).toBe('30.13');
  expect(rowOf(fi, 'aw', 'Cubic yards')?.value).toBe('24.7');
  // Footings: (277' 4" + 225' 4") × 16" × 10" = 20.68 yd; + 10% = 22.75 (you had 22).
  expect(rowOf(fi, 'f', 'Cubic yards')?.value).toBe('12.55');
  expect(rowOf(fi, 'af', 'Cubic yards')?.value).toBe('10.2');
  // Second pour: 2,000 sq ft × 4" = 24.69 yd; + 10% = 27.16, ordered 27.25 (you had 25).
  expect(rowOf(fi, 's2', 'Order')?.value).toBe('27.25 yd');
  // Main slab ordered for inside the walls: 68' 8" × 68' 8" × 4" = 58.2 yd; + 10% = 64.25 ordered (you had 62).
  // Everything: 30.25 + 24.75 + 12.75 + 10.25 + 64.25 + 27.25.
  expect(jobTotals(fi, job).concreteOrderYd).toBe(169.5);
});
