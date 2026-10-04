import { buildLayout, matBars } from '../../report/layoutGeom';
import { slabLayout } from '../slabLayoutTool';
import { RawValues, rowValue, runTool } from '../run';
import { ALL_TOOLS } from '../index';

const cutList = ALL_TOOLS.find((t) => t.id === 'cut-list')!;
import type { EdgeKind } from '../types';

// A 7' wide L walk, walked clockwise from the top left:
//   1) 14' across the top (formed), turn right, 3' radius corner
//   2) 14' down the outside (formed), turn right
//   3)  7' across the end (existing slab + dowels), turn right
//   4)  7' up the inside (formed), turn LEFT (inside corner)
//   5)  7' back toward the door (formed), turn right
//   6)  7' at the door (house), turn right, back to the start
const walk: [number, 'R' | 'L', number, EdgeKind][] = [
  [14, 'R', 3, 'form'],
  [14, 'R', 0, 'form'],
  [7, 'R', 0, 'slabDowels'],
  [7, 'L', 0, 'form'],
  [7, 'R', 0, 'form'],
  [7, 'R', 0, 'house'],
];

test('the walk closes up', () => {
  const L = buildLayout(walk.map(([length, turn, radius, edge]) => ({ length, turn, radius, edge })));
  expect(L.closed).toBe(true);
});

test('area: 14 × 14 − 7 × 7 = 147, less the 3\' radius corner = 145.07', () => {
  expect(rowValue(runTool(slabLayout, { sides: walk }), 'Slab area')).toBe('145.1 sq ft');
});

test('forms: 11 + 11 + 7 + 7 straight + 4.71 ft of curve; the house and existing slab sides get none', () => {
  const r = runTool(slabLayout, { sides: walk });
  expect(rowValue(r, 'Forms')).toBe('40.7 ft');
  if (r.status === 'ok') expect(r.result.rows.find((x) => x.label === 'Forms')!.note).toBe('4.7 ft curved (bender board) · 7 ft against the house · 7 ft against existing slab');
});

test('thickened edge 12" × 16" on the formed sides', () => {
  // centerline: 11 + 11 + 7 + 7 + curve π/2 × (3 − 0.5) = 3.93 + inside corner +1 = 40.93 ft × 1 × 1 = 40.93 cu ft
  const r = runTool(slabLayout, { sides: walk, footing: true });
  expect(rowValue(r, 'Thickened edge')).toBe('1.52 cu yd');
});

test('dowels into the existing slab: 7 ft, 6" in from each end, every 24" = 4', () => {
  expect(rowValue(runTool(slabLayout, { sides: walk }), 'Dowels')).toBe(`4 × 1' 6"`);
});

test('slab bars are cut to the L: none longer than the outside leg, and short ones in the notch', () => {
  const L = buildLayout(walk.map(([length, turn, radius, edge]) => ({ length, turn, radius, edge })));
  const segs = matBars(L, 0.25, 1.5, () => false);
  const lens = segs.map((s) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y));
  expect(Math.max(...lens)).toBeLessThanOrEqual(13.5 + 1e-6);
  expect(lens.some((l) => l < 7)).toBe(true);
  const r = runTool(slabLayout, { sides: walk, footing: true, slabRebar: true, footBars: true });
  expect(rowValue(r, '#4 sticks')).toMatch(/^\d+ × 20'$/);
  if (r.status === 'ok') expect(r.result.rows.find((x) => x.label === 'Footing bars')!.note).toContain('bent around 1 curve');
});

test('sides that don\'t meet, wrong turns, or rounding next to the house are refused', () => {
  const short = walk.map((s, i) => (i === 0 ? ([13, 'R', 3, 'form'] as typeof s) : s));
  const r = runTool(slabLayout, { sides: short });
  expect(r.status === 'invalid' && r.message).toMatch(/don’t meet up/);
  const turns = walk.map((s, i) => (i === 3 ? ([7, 'R', 0, 'form'] as typeof s) : s));
  expect(runTool(slabLayout, { sides: turns }).status).toBe('invalid');
  const houseRound = walk.map((s, i) => (i === 4 ? ([7, 'R', 2, 'form'] as typeof s) : s));
  expect(runTool(slabLayout, { sides: houseRound }).status).toBe('invalid');
});

test('sends every piece to the Rebar Cut List, which comes up with the same weight', () => {
  const r = runTool(slabLayout, { sides: walk, footing: true, slabRebar: true, footBars: true });
  expect(r.status).toBe('ok');
  if (r.status !== 'ok') return;
  const send = r.result.send!;
  expect(send.toolId).toBe('cut-list');
  const cut = runTool(cutList, send.raw as RawValues);
  expect(cut.status).toBe('ok');
  // Pieces are rounded up to the next ½", so the weight can only come out the same or a hair more.
  const lbs = (v: string | undefined) => Number(v!.replace(/[^\d.]/g, ''));
  const own = lbs(rowValue(r, 'Rebar weight'));
  const listed = lbs(rowValue(cut, 'Weight'));
  expect(listed).toBeGreaterThanOrEqual(own);
  expect(listed - own).toBeLessThan(own * 0.02);
});

test('no rebar or dowels, nothing to send', () => {
  const noDowels = walk.map(([l, t, r, e]): [number, 'R' | 'L', number, EdgeKind] => [l, t, r, e === 'slabDowels' ? 'slab' : e]);
  const r = runTool(slabLayout, { sides: noDowels });
  expect(r.status).toBe('ok');
  if (r.status === 'ok') expect(r.result.send).toBeUndefined();
});
