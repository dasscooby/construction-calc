import { LAYOUT_TOOLS } from '../layoutTools';
import { rowValue, runTool } from '../run';
import { Tool } from '../types';

const tool = (id: string): Tool => {
  const t = LAYOUT_TOOLS.find((x) => x.id === id);
  if (!t) throw new Error(`no tool ${id}`);
  return t;
};

const ok = (r: ReturnType<typeof runTool>) => {
  if (r.status !== 'ok') throw new Error(`${r.status}: ${r.message}`);
  return r.result;
};

const note = (r: ReturnType<typeof runTool>, label: string) => ok(r).rows.find((row) => row.label === label)?.note;

describe('the layout tool list', () => {
  test('ids and order', () => {
    expect(LAYOUT_TOOLS.map((t) => t.id)).toEqual(['squaring', 'feet-converter', 'vapor-barrier']);
  });

  test.each(LAYOUT_TOOLS.map((t) => [t.id, t] as const))('%s is well formed', (_id, t) => {
    const keys = t.fields.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z][a-zA-Z0-9]*$/);
    for (const f of t.fields) {
      if (f.kind === 'choice') expect(f.options.map((o) => o.value)).toContain(f.default);
    }
    expect(t.notes?.length).toBeGreaterThan(0);
  });
});

describe('squaring', () => {
  const sq = tool('squaring');

  test('worked example: 30 x 20 slab', () => {
    // √(30² + 20²) = √1300 = 36.0555 ft = 36' + 0.666" → 36' 0-11/16" (0.666 × 16 = 10.66 → 11/16)
    // 3-4-5: biggest whole-foot set with 3k ≤ 20 and 4k ≤ 30 → k = 6 → 18-24-30
    const r = runTool(sq, { length: 30, width: 20 });
    expect(rowValue(r, 'Diagonal')).toBe(`36' 0-11/16"`);
    expect(rowValue(r, 'Check')).toBeUndefined(); // no measured diagonals
    expect(rowValue(r, '3-4-5')).toBe(`18' – 24' – 30'`);
    expect(note(r, '3-4-5')).toBe(`18' on the short side, 24' on the long side, 30' across`);
    expect(ok(r).warnings).toEqual([]);
  });

  test('measured diagonals 1/2" apart', () => {
    // 36' 1" − 36' 0-1/2" = 1/2" → out of square, diagonal 1 is long
    const r = runTool(sq, { length: 30, width: 20, diag1: { ft: '36', in: '1' }, diag2: { ft: '36', in: '1/2' } });
    expect(rowValue(r, 'Check')).toBe('Out 1/2"');
    expect(note(r, 'Check')).toMatch(/^Diagonal 1 is long/);
  });

  test('within 1/8" is square, 3/16" is not', () => {
    const square = runTool(sq, { length: 30, width: 20, diag1: { ft: '36', in: '3/4' }, diag2: { ft: '36', in: '5/8' } });
    expect(rowValue(square, 'Check')).toBe('Square');
    const out = runTool(sq, { length: 30, width: 20, diag1: { ft: '36', in: '5/8' }, diag2: { ft: '36', in: '13/16' } });
    expect(rowValue(out, 'Check')).toBe('Out 3/16"');
    expect(note(out, 'Check')).toMatch(/^Diagonal 2 is long/);
  });

  test('equal diagonals', () => {
    const r = runTool(sq, { length: 30, width: 20, diag1: { ft: '36', in: '11/16' }, diag2: { ft: '36', in: '11/16' } });
    expect(rowValue(r, 'Check')).toBe('Square');
  });

  test('only one diagonal measured', () => {
    const r = runTool(sq, { length: 30, width: 20, diag2: { ft: '36', in: '' } });
    expect(rowValue(r, 'Check')).toBeUndefined();
    expect(ok(r).warnings).toEqual(['Measure both diagonals to check for square.']);
  });

  test('a diagonal shorter than a side is flagged (typo or wrong units)', () => {
    const r = runTool(sq, { length: 30, width: 20, diag1: { ft: '', in: '36' }, diag2: { ft: '36', in: '11/16' } });
    expect(ok(r).warnings).toEqual(['A diagonal can’t be shorter than a side. Check the measurements.']);
  });

  test('6-8-10 and tiny layouts', () => {
    // √(10² + 8²) = √164 = 12.806 ft = 12' 9.67" → 12' 9-11/16";  k = min(8/3, 10/4) = 2.5 → 2 → 6-8-10
    const r = runTool(sq, { length: 10, width: 8 });
    expect(rowValue(r, 'Diagonal')).toBe(`12' 9-11/16"`);
    expect(rowValue(r, '3-4-5')).toBe(`6' – 8' – 10'`);
    // Feet-inch input: 3' 6" × 2' 6" → never smaller than 3-4-5
    const tiny = runTool(sq, { length: { ft: '3', in: '6' }, width: { ft: '2', in: '6' } });
    expect(rowValue(tiny, '3-4-5')).toBe(`3' – 4' – 5'`);
  });

  test('errors', () => {
    expect(runTool(sq, {})).toEqual({ status: 'missing', message: 'Enter length' });
    expect(runTool(sq, { length: 30, width: 0 })).toEqual({ status: 'invalid', message: 'Length and width must be more than 0.' });
    expect(runTool(sq, { length: 30, width: 20, diag1: { ft: 'x', in: '' } })).toEqual({
      status: 'invalid',
      message: 'Check Diagonal 1 (measured)',
    });
  });
});

describe('feet-converter', () => {
  const fc = tool('feet-converter');

  test('decimal feet → feet-inches', () => {
    // 12.37 ft: 0.37 × 12 = 4.44" → 4.44 × 16 = 71.04 → 71/16 = 4-7/16" → 12' 4-7/16"
    // Inches: 12.37 × 12 = 148.44" → 148-7/16"
    const r = runTool(fc, { decimalFeet: 12.37 });
    expect(rowValue(r, 'Feet-inches')).toBe(`12' 4-7/16"`);
    expect(note(r, 'Feet-inches')).toBe('Nearest 1/16"');
    expect(rowValue(r, 'Inches')).toBe('148-7/16"');
    expect(rowValue(r, 'Decimal feet')).toBeUndefined();
  });

  test('exact and negative decimals', () => {
    const half = runTool(fc, { decimalFeet: 2.5 });
    expect(rowValue(half, 'Feet-inches')).toBe(`2' 6"`);
    expect(note(half, 'Feet-inches')).toBeUndefined(); // nothing was rounded
    const neg = runTool(fc, { decimalFeet: '-1.25' });
    expect(rowValue(neg, 'Feet-inches')).toBe(`−1' 3"`);
    expect(rowValue(neg, 'Inches')).toBe('−15"');
    expect(rowValue(runTool(fc, { decimalFeet: 0.1 }), 'Feet-inches')).toBe(`0' 1-3/16"`); // 1.2" → 1-3/16"
  });

  test('feet-inches → decimal feet', () => {
    // 8' 3" = 8 + 3/12 = 8.25 ft = 99"
    const r = runTool(fc, { feetInches: { ft: '8', in: '3' } });
    expect(rowValue(r, 'Decimal feet')).toBe('8.25 ft');
    expect(note(r, 'Decimal feet')).toBe('8.250 ft');
    expect(rowValue(r, 'Inches')).toBe('99"');
    expect(rowValue(r, 'Feet-inches')).toBeUndefined();
    // 10' 7-1/2" = 10.625 ft → 10.63 (2 places), 10.625 (3 places), 127-1/2"
    const r2 = runTool(fc, { feetInches: { ft: '10', in: '7 1/2' } });
    expect(rowValue(r2, 'Decimal feet')).toBe('10.63 ft');
    expect(note(r2, 'Decimal feet')).toBe('10.625 ft');
    expect(rowValue(r2, 'Inches')).toBe('127-1/2"');
    // Inches only: 6" = 0.5 ft
    expect(rowValue(runTool(fc, { feetInches: { ft: '', in: '6' } }), 'Decimal feet')).toBe('0.50 ft');
  });

  test('both blank or both filled', () => {
    expect(runTool(fc, {})).toEqual({ status: 'invalid', message: 'Enter decimal feet or feet-inches.' });
    expect(runTool(fc, { decimalFeet: 2, feetInches: { ft: '2', in: '' } })).toEqual({
      status: 'invalid',
      message: 'Fill in just one box. Clear the other one.',
    });
  });

  test('tenths of a foot reminder', () => {
    expect(fc.notes?.[0]).toContain('0.1 ft ≈ 1-3/16"'); // 1.2" to the nearest 1/16
  });
});

describe('vapor-barrier', () => {
  const vb = tool('vapor-barrier');

  test('worked example: 50 x 40 plus 20 x 10, 20 x 100 rolls, 6" overlap', () => {
    // Area = 2000 + 200 = 2200 sq ft.  Each roll covers (20 − 0.5) × 100 = 1950 sq ft.  2200 ÷ 1950 = 1.13 → 2 rolls
    const r = runTool(vb, { areas: [[50, 40], [20, 10]] });
    expect(rowValue(r, 'Area')).toBe('2,200 sq ft');
    expect(rowValue(r, 'Rolls')).toBe('2');
    expect(note(r, 'Rolls')).toBe('Each covers 1,950 sq ft after overlap');
  });

  test('other roll sizes', () => {
    // 10' roll: 9.5 × 100 = 950 → 2200 ÷ 950 = 2.3 → 3
    expect(rowValue(runTool(vb, { areas: [[50, 40], [20, 10]], rollWidth: '10' }), 'Rolls')).toBe('3');
    // 32' × 50' roll: 31.5 × 50 = 1575 → 1.4 → 2
    expect(rowValue(runTool(vb, { areas: [[50, 40], [20, 10]], rollWidth: '32', rollLength: 50 }), 'Rolls')).toBe('2');
  });

  test('exact fit is not rounded up', () => {
    expect(rowValue(runTool(vb, { areas: [[19.5, 100]] }), 'Rolls')).toBe('1'); // 1950 ÷ 1950
  });

  test('errors', () => {
    expect(runTool(vb, {})).toEqual({ status: 'missing', message: 'Enter area' });
    expect(runTool(vb, { areas: [[50, 40]], rollWidth: '10', overlap: 120 })).toEqual({
      status: 'invalid',
      message: `The overlap must be less than 10'.`,
    });
    expect(runTool(vb, { areas: [[50, 40]], rollLength: 0 }).status).toBe('invalid');
    expect(runTool(vb, { areas: [[50, 0]] }).status).toBe('invalid');
  });
});
