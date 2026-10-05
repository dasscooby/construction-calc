import { rowValue, runTool } from '../run';
import { layoutSketch } from '../sketchTool';

const note = (r: ReturnType<typeof runTool>, label: string) => (r.status === 'ok' ? r.result.rows.find((x) => x.label === label)?.note : undefined);

test('12 by 9, square corner: the diagonal board A to C is 15 ft (3-4-5)', () => {
  const r = runTool(layoutSketch, { lines: [[12, 'R', 0], [9, 'R', 0]], from: 'A', to: 'C' });
  expect(rowValue(r, 'A to C')).toBe(`15' 0"`);
  expect(rowValue(r, 'Over and across')).toBe(`12' 0" × 9' 0"`);
  // tan⁻¹(9/12) = 36.87° off A–B; the saw is set to 90 − 36.87 = 53.13°
  expect(rowValue(r, 'Angle at A')).toBe('36.87°');
  expect(note(r, 'Angle at A')).toBe('Off line A–B · miter saw 53.13°');
  expect(rowValue(r, 'Angle at C')).toBe('53.13°');
});

test('a 45° turn: 10 ft, then 10 ft at 45° → A to C = √(17.071² + 7.071²) = 18.478 ft = 18\' 5 3/4"', () => {
  const r = runTool(layoutSketch, { lines: [[10, 'R', 0], [10, 'R', 45]], from: 'A', to: 'C' });
  expect(rowValue(r, 'A to C')).toBe(`18' 5-3/4"`);
});

test('a closed rectangle says so, and lists both diagonals', () => {
  const r = runTool(layoutSketch, { lines: [[20, 'R', 0], [10, 'R', 0], [20, 'R', 0], [10, 'R', 0]], from: 'B', to: 'D' });
  expect(rowValue(r, 'Closes')).toBe('Yes, back at A');
  expect(rowValue(r, 'B to D')).toBe(`22' 4-5/16"`); // √500 = 22.3607 ft
  expect(note(r, 'All diagonals')).toBe(`A–C 22' 4-5/16" · B–D 22' 4-5/16"`);
});

test('three sides of a box: how to close it back to A', () => {
  const r = runTool(layoutSketch, { lines: [[20, 'R', 0], [10, 'R', 0], [20, 'R', 0]], from: 'A', to: 'C' });
  expect(rowValue(r, 'D back to A')).toBe(`10' 0"`);
  expect(note(r, 'D back to A')).toBe('To close it: turn right 90° after C–D');
});

test('straight on and left turns', () => {
  const r = runTool(layoutSketch, { lines: [[5, 'R', 0], [5, 'S', 0], [4, 'L', 0]], from: 'A', to: 'D' });
  expect(rowValue(r, 'A to D')).toBe(`10' 9-1/4"`); // √(10² + 4²) = 10.7703 ft = 10' 9.24"
});

test('errors', () => {
  expect(runTool(layoutSketch, { lines: [[12, 'R', 0]], from: 'A', to: 'C' })).toEqual({ status: 'invalid', message: 'Point C isn’t on the sketch yet. You have A to B.' });
  expect(runTool(layoutSketch, { lines: [[12, 'R', 0], [9, 'R', 0]], from: 'B', to: 'B' })).toEqual({ status: 'invalid', message: 'Pick two different points.' });
  expect(runTool(layoutSketch, { lines: [[12, 'R', 0], [9, 'R', 200]], from: 'A', to: 'C' }).status).toBe('invalid');
});
