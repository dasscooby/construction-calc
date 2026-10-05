import { solvePad } from '../padSolve';

const ft = (n: number) => Math.round(n * 1000) / 1000;

test('a rough rectangle with two sides measured comes out square, with the diagonal figured', () => {
  // Drawn a little crooked on the pad (pixels), A top-left, clockwise, plus a brace A–C.
  const pts = [
    { x: 100, y: 100 },
    { x: 404, y: 108 },
    { x: 398, y: 330 },
    { x: 96, y: 322 },
  ];
  const edges = [
    { a: 0, b: 1, length: 12 },
    { a: 1, b: 2, length: 9 },
    { a: 2, b: 3, length: null },
    { a: 3, b: 0, length: null },
    { a: 0, b: 2, length: null },
  ];
  const s = solvePad(pts, edges);
  expect(s.edges.map((e) => e.axis)).toEqual(['H', 'V', 'H', 'V', null]);
  expect(ft(s.edges[2].length)).toBe(12);
  expect(ft(s.edges[3].length)).toBe(9);
  expect(ft(s.edges[4].length)).toBe(15); // 3-4-5
  expect(s.edges.every((e) => e.sure)).toBe(true);
  expect(s.misfit).toEqual([]);
});

test('an angled side: just its length, and it goes point to point', () => {
  // A trapezoid: top 10 level, right side plumb 8, bottom level 16, left side angled (measured 10 → 6 over, 8 down).
  const pts = [
    { x: 160, y: 100 },
    { x: 360, y: 100 },
    { x: 360, y: 260 },
    { x: 40, y: 262 },
  ];
  const edges = [
    { a: 0, b: 1, length: 10 },
    { a: 1, b: 2, length: 8 },
    { a: 2, b: 3, length: 16 },
    { a: 3, b: 0, length: 10 },
  ];
  const s = solvePad(pts, edges);
  expect(s.edges[3].axis).toBe(null);
  expect(s.misfit).toEqual([]);
  // D sits 6 ft left of A and 8 ft down.
  expect(ft(s.points[3].x - s.points[0].x)).toBe(-6);
  expect(ft(s.points[3].y - s.points[0].y)).toBe(8);
});

test('measurements that can’t all be true are flagged', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 100 },
    { x: 0, y: 100 },
  ];
  const edges = [
    { a: 0, b: 1, length: 20 },
    { a: 1, b: 2, length: 10 },
    { a: 2, b: 3, length: 18 }, // a rectangle can't be 20 on top and 18 on the bottom
    { a: 3, b: 0, length: 10 },
  ];
  expect(solvePad(pts, edges).misfit.length).toBeGreaterThan(0);
});

test('a line nothing pins down is marked as a guess from the sketch', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 100 },
  ];
  const edges = [
    { a: 0, b: 1, length: 20 },
    { a: 1, b: 2, length: null },
  ];
  const s = solvePad(pts, edges);
  expect(s.edges[0].sure).toBe(true);
  expect(s.edges[1].sure).toBe(false);
});
