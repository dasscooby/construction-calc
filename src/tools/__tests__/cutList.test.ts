import { cutPatterns } from '../../lib/rebar';
import { REBAR_TOOLS } from '../rebarTools';
import { RawBarRow, defaultRaw, restoreRaw, rowValue, runTool } from '../run';

const cutList = REBAR_TOOLS.find((t) => t.id === 'cut-list')!;
const rowsOf = (r: ReturnType<typeof runTool>) => (r.status === 'ok' ? r.result.rows : []);

describe('cutting patterns', () => {
  test('12\' and 8\' pieces pair up on 20\' bars with no scrap', () => {
    const pieces = [...Array(10).fill(144), ...Array(10).fill(96)];
    expect(cutPatterns(pieces, 240)).toEqual([{ piecesIn: [144, 96], count: 10, scrapIn: 0 }]);
  });

  test('five 6\' 8" pieces: one bar cut 3 ways (no scrap), one cut 2 ways (6\' 8" left)', () => {
    expect(cutPatterns(Array(5).fill(80), 240)).toEqual([
      { piecesIn: [80, 80, 80], count: 1, scrapIn: 0 },
      { piecesIn: [80, 80], count: 1, scrapIn: 80 },
    ]);
  });

  test('a piece longer than the stock bar is refused', () => {
    expect(() => cutPatterns([300], 240)).toThrow();
  });
});

describe('rebar cut list tool', () => {
  // #5: 10 @ 12' + 10 @ 8' → 10 sticks cut 12' + 8', 200 ft, 200 × 1.043 = 208.6 lb
  // #4: 5 @ 6' 8"          → 2 sticks (3 + 2 pieces), 33.3 ft cut, 6.7 ft scrap, 33.33 × 0.668 = 22.3 lb
  const marks: RawBarRow[] = [
    { size: '5', qty: '10', length: { ft: '12', in: '' } },
    { size: '5', qty: '10', length: { ft: '8', in: '' } },
    { size: '4', qty: '5', length: { ft: '6', in: '8' } },
  ];

  test('totals, per-size sticks, cutting plan and weights', () => {
    const r = runTool(cutList, { marks });
    expect(rowValue(r, 'Sticks to order')).toBe('12');
    expect(rowsOf(r)[0].note).toBe('#4: 2 · #5: 10');
    expect(rowValue(r, 'Weight')).toBe('231 lb');
    expect(rowsOf(r)[1].note).toBe('0.12 tons'); // 230.9 lb ÷ 2,000

    expect(rowValue(r, '#4 sticks')).toBe(`2 × 20'`);
    expect(rowsOf(r).find((x) => x.label === '#4 sticks')!.note).toBe('5 pieces, 6.7 ft scrap');
    expect(rowValue(r, '#4 weight')).toBe('22.3 lb');
    expect(rowValue(r, '#5 sticks')).toBe(`10 × 20'`);
    expect(rowValue(r, '#5 weight')).toBe('209 lb');

    const plan = rowsOf(r).filter((x) => x.label.startsWith('   ')); // cutting-plan rows are indented
    expect(plan.map((x) => [x.label.trim(), x.value, x.note])).toEqual([
      ['1 stick', `3 × 6' 8"`, 'No scrap'],
      ['1 stick', `2 × 6' 8"`, `6' 8" left over each`],
      ['10 sticks', `12' 0" + 8' 0"`, 'No scrap'],
    ]);
  });

  test('one size shows the stock length with the count', () => {
    // three 7' #5 pieces: 7 + 7 on one bar (6' left), 7 on another (13' left)
    const r = runTool(cutList, { marks: [['5', 3, 7]] });
    expect(rowValue(r, 'Sticks to order')).toBe(`2 × 20'`);
  });

  test('pieces longer than the stock bar need a longer stock length', () => {
    expect(runTool(cutList, { marks: [['5', 1, 25]] }).status).toBe('invalid');
    expect(rowValue(runTool(cutList, { marks: [['5', 1, 25]], stockLength: '30' }), 'Sticks to order')).toBe(`1 × 30'`);
  });

  test('blank and bad rows', () => {
    expect(runTool(cutList, {})).toEqual({ status: 'missing', message: 'Enter bar marks' });
    expect(runTool(cutList, { marks: [{ size: '4', qty: '0', length: { ft: '5', in: '' } }] }).status).toBe('invalid');
    expect(runTool(cutList, { marks: [{ size: '4', qty: '3', length: { ft: '', in: '' } }] })).toEqual({
      status: 'missing',
      message: 'Enter the length of mark 1',
    });
    // an empty row in the middle is skipped
    const r = runTool(cutList, {
      marks: [
        { size: '4', qty: '', length: { ft: '', in: '' } },
        { size: '4', qty: '3', length: { ft: '5', in: '' } },
      ],
    });
    expect(rowValue(r, 'Sticks to order')).toBe(`1 × 20'`);
  });

  test('saved rows come back; rows with a size that no longer exists are dropped', () => {
    expect(restoreRaw(cutList, { marks })).toEqual({ ...defaultRaw(cutList), marks });
    expect(restoreRaw(cutList, { marks: [{ size: '14', qty: '1', length: { ft: '5', in: '' } }] }).marks).toEqual(defaultRaw(cutList).marks);
  });
});
