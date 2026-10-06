import { commas, dec, ftIn, inches } from '../format';
import { defaultRaw, parseNumber, restoreRaw, rowValue, runTool } from '../run';
import { Tool } from '../types';

describe('parseNumber', () => {
  test.each([
    ['12', 12],
    ['12.5', 12.5],
    ['.5', 0.5],
    ['1/4', 0.25],
    ['1 1/2', 1.5],
    ['1-1/2', 1.5],
    ['2,500', 2500],
  ])('%s = %d', (t, n) => expect(parseNumber(t)).toBe(n));

  test('rejects junk and unwanted negatives', () => {
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('1/0')).toBeNull();
    expect(parseNumber('-3')).toBeNull();
    expect(parseNumber('-3', true)).toBe(-3);
  });
});

describe('format', () => {
  test('lengths', () => {
    expect(ftIn(16.270833)).toBe(`16' 3-1/4"`);
    expect(ftIn(0.5)).toBe(`0' 6"`);
    expect(ftIn(-1.25)).toBe(`−1' 3"`);
    expect(inches(7.5)).toBe(`7-1/2"`);
    expect(inches(0.75)).toBe(`3/4"`);
    expect(inches(10)).toBe(`10"`);
  });
  test('numbers', () => {
    expect(dec(1.5)).toBe('1.5');
    expect(dec(2)).toBe('2');
    expect(commas(1234567.891, 1)).toBe('1,234,567.9');
    expect(commas(999)).toBe('999');
  });
});

const box: Tool = {
  id: 'box',
  title: 'Box',
  blurb: 'test',
  fields: [
    { key: 'l', label: 'Length', kind: 'length' },
    { key: 'w', label: 'Width', kind: 'length', default: { ft: '2' } },
    { key: 'n', label: 'Quantity', kind: 'count', default: '1' },
    { key: 'x', label: 'Extra', kind: 'number', optional: true },
    { key: 'k', label: 'Kind', kind: 'choice', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], default: 'a' },
    { key: 'areas', label: 'Areas', kind: 'areas', optional: true },
  ],
  compute: (inp) => {
    if (inp.len('l') > 100) return { error: 'Too long' };
    const area = inp.areas('areas').reduce((s, r) => s + r.length * r.width, 0);
    return {
      rows: [
        { label: 'Total', value: String(inp.len('l') * inp.len('w') * inp.count('n')) },
        { label: 'Extra', value: inp.has('x') ? String(inp.num('x')) : 'none' },
        { label: 'Kind', value: inp.choice('k') },
        { label: 'Areas', value: String(area) },
      ],
    };
  },
};

describe('runTool', () => {
  test('uses defaults and reads lengths in feet', () => {
    const r = runTool(box, { l: { ft: '3', in: '6' } });
    expect(rowValue(r, 'Total')).toBe('7');
    expect(rowValue(r, 'Extra')).toBe('none');
    expect(rowValue(r, 'Kind')).toBe('a');
  });

  test('accepts plain numbers in tests', () => {
    expect(rowValue(runTool(box, { l: 4, n: 3, x: 1.5, k: 'b' }), 'Total')).toBe('24');
    expect(rowValue(runTool(box, { l: 4, areas: [[10, 10], [2, 3]] }), 'Areas')).toBe('106');
  });

  test('restoring saved boxes keeps good values and drops bad or old ones', () => {
    const saved = {
      l: { ft: '5', in: '' },
      w: 'not a length',
      k: 'zzz',
      n: '3',
      gone: 'field that no longer exists',
      areas: [{ length: { ft: '10', in: '' }, width: { ft: '4', in: '' } }],
    };
    const raw = restoreRaw(box, saved);
    expect(raw.l).toEqual({ ft: '5', in: '' });
    expect(raw.w).toEqual(defaultRaw(box).w);
    expect(raw.k).toBe('a');
    expect(raw.n).toBe('3');
    expect('gone' in raw).toBe(false);
    expect(rowValue(runTool(box, raw), 'Areas')).toBe('40');
    expect(restoreRaw(box, null)).toEqual(defaultRaw(box));
  });

  test('missing, invalid and compute errors', () => {
    expect(runTool(box, {})).toEqual({ status: 'missing', message: 'Enter length' });
    expect(runTool(box, { l: { ft: 'abc', in: '' } })).toEqual({ status: 'invalid', message: 'Check Length' });
    expect(runTool(box, { l: 4, n: '2.5' })).toEqual({ status: 'invalid', message: 'Quantity must be a whole number' });
    expect(runTool(box, { l: 200 })).toEqual({ status: 'invalid', message: 'Too long' });
  });

  test('an area with a 0 side asks for a real size instead of adding nothing', () => {
    expect(runTool(box, { l: 4, areas: [[10, 10], [12, 0]] })).toEqual({ status: 'invalid', message: 'Area 2: length and width must be more than 0' });
    expect(runTool(box, { l: 4, areas: [[0, 10]] }).status).toBe('invalid');
  });
});
