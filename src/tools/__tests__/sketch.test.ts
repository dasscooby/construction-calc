import { rowValue, runTool } from '../run';
import { layoutSketch } from '../sketchTool';

const note = (r: ReturnType<typeof runTool>, label: string) => (r.status === 'ok' ? r.result.rows.find((x) => x.label === label)?.note : undefined);

test('a rough box with a brace: two sides measured, the rest and the brace figured (3-4-5)', () => {
  const r = runTool(layoutSketch, {
    sketch: {
      points: [
        [100, 100],
        [404, 108],
        [398, 330],
        [96, 322],
      ],
      edges: [
        [0, 1, 12],
        [1, 2, 9],
        [2, 3, null],
        [3, 0, null],
        [0, 2, null],
      ],
    },
  });
  expect(rowValue(r, 'A–C')).toBe(`15' 0"`);
  expect(note(r, 'A–C')).toBe('Figured from your measurements · 36.87° off A–B · miter saw 53.13°');
  expect(rowValue(r, 'C–D')).toBe(`12' 0"`);
  expect(rowValue(r, 'D–A')).toBe(`9' 0"`);
  if (r.status === 'ok') expect(r.result.warnings).toEqual([]);
});

test('the angled side only needs its length', () => {
  // Top 10 level, right 8 plumb, bottom 16 level, left side angled at 10 → the top-left corner sits 6 over.
  const r = runTool(layoutSketch, {
    sketch: {
      points: [
        [160, 100],
        [360, 100],
        [360, 260],
        [40, 262],
      ],
      edges: [
        [0, 1, 10],
        [1, 2, 8],
        [2, 3, 16],
        [3, 0, 10],
      ],
    },
  });
  expect(rowValue(r, 'D–A')).toBe(`10' 0"`);
  // 6 over, 8 down: tan⁻¹(8/6) = 53.13° off D–C
  expect(note(r, 'D–A')).toBe('Measured · 53.13° off D–C · miter saw 36.87°');
});

test('nothing measured yet, or nothing drawn', () => {
  expect(runTool(layoutSketch, { sketch: { points: [[0, 0], [100, 0]], edges: [[0, 1, null]] } })).toEqual({ status: 'invalid', message: 'Type the length of at least one line.' });
  expect(runTool(layoutSketch, {}).status).toBe('missing');
});

test('a closed sketch is a slab: area and concrete (12 × 9 at 4" = 108 sq ft, 1.33 yd + 10% → order 1.5)', () => {
  const r = runTool(layoutSketch, {
    sketch: {
      points: [
        [100, 100],
        [404, 108],
        [398, 330],
        [96, 322],
      ],
      edges: [
        [0, 1, 12],
        [1, 2, 9],
        [2, 3, null],
        [3, 0, null],
      ],
    },
  });
  expect(rowValue(r, 'Slab area')).toBe('108 sq ft');
  expect(rowValue(r, 'Slab')).toBe('1.33 cu yd');
  expect(rowValue(r, 'Order')).toBe('1.50 yd');
});

test('an open sketch asks to close it for the concrete', () => {
  const r = runTool(layoutSketch, { sketch: { points: [[0, 0], [200, 0], [200, 100]], edges: [[0, 1, 20], [1, 2, 10]] } });
  expect(rowValue(r, 'Concrete')).toBe('Close the shape');
});
