import { buildLayout, LayoutSpec } from '../foundationLayout';
import { solveGraph } from '../wallGraph';

const r2 = (n: number) => Math.round(n * 1000) / 1000;
const t = 8 / 12;

// Your job: 70' × 70' house, 8" × 4' walls on a 16" × 10" footing everywhere. A 70' × 40' add-on on the
// top side, sharing the house wall. Two container walls 10' clear from each outside side wall. Slab in the
// house (pour 1) and in the middle bay (pour 2).
const job: LayoutSpec = {
  house: { length: 70, width: 70 },
  wall: { thick: t, height: 4 },
  footing: { width: 16 / 12, depth: 10 / 12 },
  addOns: [{ side: 'top', width: 70, depth: 40, walls: [{ clear: 10, from: 'start' }, { clear: 10, from: 'end' }] }],
  slabs: [{ at: { in: 'house' }, thick: 4 / 12 }, { at: { in: 'addon', addOn: 0, bay: 1 }, thick: 4 / 12 }],
};

test('a plain rectangle: 4 corners, the middle 4 thicknesses short, one area', () => {
  const g = buildLayout({ ...job, addOns: [], slabs: [] }).graph;
  expect(g.corners).toBe(4);
  expect(g.tees).toBe(0);
  expect(r2(g.runs.reduce((s, r) => s + r.middle, 0))).toBe(r2(280 - 4 * t)); // 277' 4"
  expect(g.faces.length).toBe(1);
  expect(g.faces[0].rect).toEqual({ w: 70 - 2 * t, h: 70 - 2 * t });
});

test('your job: the runs as you measure them and along the middle', () => {
  const l = buildLayout(job);
  expect(l.problems).toEqual([]);
  expect(l.runs.map((r) => [r.name, r.measured])).toEqual([
    ['House top', 70],
    ['House right', 70],
    ['House bottom', 70],
    ['House left', 70],
    ['Add-on side', 40],
    ['Add-on far', 70],
    ['Add-on side', 40],
    ['Add-on inside 1', 40],
    ['Add-on inside 2', 40],
  ]);
  expect(l.totals.measured).toBe(510); // 280 + 150 + 80, like your sketch
  // Walls along the middle: house 4 × 69' 4"; add-on sides 40' − 4" (tee into the house wall, corner at
  // the far wall), far 70' − 8", inside 40' − 8" (tee at both ends).
  expect(l.runs.map((r) => r2(r.middle))).toEqual([69.333, 69.333, 69.333, 69.333, 39.667, 69.333, 39.667, 39.333, 39.333].map(r2));
  expect(r2(l.totals.middle)).toBe(r2(277 + 4 / 12 + 227 + 4 / 12)); // 504' 8"
  // Footings: the same, but a tee stops at the edge of the 16" footing it meets.
  expect(l.runs.map((r) => r2(r.footingMiddle)).slice(4)).toEqual([39.333, 69.333, 39.333, 38.667, 38.667].map(r2));
  expect(r2(l.totals.footingMiddle)).toBe(r2(277 + 4 / 12 + 225 + 4 / 12)); // 502' 8"
  // L-bars: 6 corners (4 house + 2 add-on) and 6 tee ends (2 side walls + 2 × 2 inside walls).
  expect(l.graph.corners).toBe(6);
  expect(l.graph.tees).toBe(6);
});

test('your job: the bays, face to face, and the slabs in them', () => {
  const l = buildLayout(job);
  // 70' − 4 × 8" − 2 × 10' = 47' 4" in the middle; 40' − 8" deep.
  expect(l.bays[0].map((b) => [r2(b.w), r2(b.h)])).toEqual([
    [10, 39.333],
    [47.333, 39.333],
    [10, 39.333],
  ]);
  expect(l.graph.faces.length).toBe(4); // house + 3 bays
  expect(l.slabs.map((s) => [s.name, s.pour])).toEqual([
    ['House slab', 1],
    ['Add-on slab, middle bay', 2],
  ]);
  expect(l.slabs[0].face.rect).toEqual({ w: 70 - 2 * t, h: 70 - 2 * t });
  const mid = l.slabs[1].face.rect!;
  expect([r2(mid.w), r2(mid.h)]).toEqual([47.333, 39.333]);
  expect(Math.round(l.slabs[1].face.clearArea)).toBe(1862);
});

test('a corner where three walls meet: the third tees in', () => {
  const g = solveGraph([
    { id: 'a', name: 'a', a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, measured: 10, thick: 1, height: 1, footing: null },
    { id: 'b', name: 'b', a: { x: 0, y: 10 }, b: { x: 0, y: 0 }, measured: 10, thick: 1, height: 1, footing: null },
    { id: 'c', name: 'c', a: { x: 0, y: 0 }, b: { x: 0, y: -5 }, measured: 5, thick: 1, height: 1, footing: null },
  ]);
  expect(g.runs.map((r) => r.ends)).toEqual([
    ['corner', 'free'],
    ['free', 'corner'],
    ['tee', 'free'],
  ]);
  expect(g.runs[2].middle).toBe(4.5);
});
