import { rowValue, runTool } from '../../tools/run';
import { slabLayout } from '../../tools/slabLayoutTool';
import { slabToRaw } from '../planReader';

test('a slab read off a plan opens in Slab Layout with the same numbers', () => {
  const raw = slabToRaw({
    name: 'Walk',
    sides: [
      { length_ft: 14, turn: 'R', radius_ft: 3, edge: 'form' },
      { length_ft: 14, turn: 'R', radius_ft: 0, edge: 'form' },
      { length_ft: 7, turn: 'R', radius_ft: 0, edge: 'slabDowels' },
      { length_ft: 7, turn: 'L', radius_ft: 0, edge: 'form' },
      { length_ft: 7, turn: 'R', radius_ft: 0, edge: 'form' },
      { length_ft: 7, turn: 'R', radius_ft: 0, edge: 'house' },
    ],
    thickness_in: 4,
    footing: { width_in: 12, depth_in: 16 },
    rebar: { size: 8, spacing_in: 18 },
    dowels: { size: 4, spacing_in: 24, length_in: 18 },
  });
  expect(raw.barSize).toBe('5'); // #8 isn't a slab bar choice: nearest one
  const r = runTool(slabLayout, raw);
  expect(rowValue(r, 'Slab area')).toBe('145.1 sq ft');
  expect(rowValue(r, 'Thickened edge')).toBe('1.52 cu yd');
});

test("feet and inches: 14.5 ft → 14' 6\"", () => {
  const raw = slabToRaw({ name: '', sides: [{ length_ft: 14.5, turn: 'R', radius_ft: 0, edge: 'form' }] });
  expect((raw.sides as { length: unknown }[])[0].length).toEqual({ ft: '14', in: '6' });
});
