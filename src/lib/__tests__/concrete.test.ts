import {
  boxCuFt,
  columnCuFt,
  concreteResult,
  feetAndInches,
  parseInchText,
  roundUpQuarter,
  stepsCuFt,
} from '../concrete';

describe('slab', () => {
  test('10 ft x 10 ft x 4 in = 1.23 cubic yards before waste', () => {
    const cuFt = boxCuFt(10, 10, 4 / 12);
    const r = concreteResult(cuFt, 0);
    expect(r.cuFt).toBeCloseTo(33.33, 2);
    expect(r.cuYd.toFixed(2)).toBe('1.23');
  });

  test('with the default 10% waste', () => {
    const r = concreteResult(boxCuFt(10, 10, 4 / 12), 10);
    expect(r.baseCuYd.toFixed(2)).toBe('1.23');
    expect(r.cuFt).toBeCloseTo(36.67, 2);
    expect(r.cuYd.toFixed(2)).toBe('1.36');
    expect(r.orderCuYd).toBe(1.5);
    expect(r.bags).toEqual([
      { lb: 40, count: 123 }, // 36.67 / 0.30 = 122.2
      { lb: 60, count: 82 }, //  36.67 / 0.45 = 81.5
      { lb: 80, count: 62 }, //  36.67 / 0.60 = 61.1
    ]);
  });
});

describe('footings & walls', () => {
  test('20 ft x 16 in x 8 in footing', () => {
    const r = concreteResult(boxCuFt(20, 16 / 12, 8 / 12), 0);
    expect(r.cuFt).toBeCloseTo(17.78, 2);
    expect(r.cuYd.toFixed(2)).toBe('0.66');
  });
});

describe('columns', () => {
  test('four 12 in round columns, 8 ft tall', () => {
    const cuFt = columnCuFt(1, 8, 4); // π × 0.5² × 8 × 4 = 25.13
    expect(cuFt).toBeCloseTo(25.13, 2);
    expect(concreteResult(cuFt, 0).cuYd.toFixed(2)).toBe('0.93');
  });
});

describe('steps', () => {
  test('3 steps, 7 in rise, 11 in run, 4 ft wide', () => {
    // block heights 7", 14", 21" → 42" total, × 11" deep × 48" wide
    const cuFt = stepsCuFt(3, 7 / 12, 11 / 12, 4);
    expect(cuFt).toBeCloseTo((42 * 11 * 48) / 1728, 6);
    expect(cuFt).toBeCloseTo(12.83, 2);
  });
});

describe('rounding & bags', () => {
  test('rounds up to the nearest quarter yard', () => {
    expect(roundUpQuarter(1.01)).toBe(1.25);
    expect(roundUpQuarter(1.25)).toBe(1.25);
    expect(roundUpQuarter(1.2500000001)).toBe(1.25);
    expect(roundUpQuarter(0)).toBe(0);
  });
  test('exact bag counts are not bumped up', () => {
    expect(concreteResult(6, 0).bags.find((b) => b.lb === 80)!.count).toBe(10);
  });
});

describe('reading the input boxes', () => {
  test.each([
    ['6', 6],
    ['6.5', 6.5],
    ['6 1/2', 6.5],
    ['6-1/2', 6.5],
    ['3/4', 0.75],
    ['', 0],
  ])('inches "%s" = %d', (text, n) => {
    expect(parseInchText(text)).toBe(n);
  });

  test('bad inches are rejected', () => {
    expect(parseInchText('abc')).toBeNull();
    expect(parseInchText('1/0')).toBeNull();
  });

  test('feet and inches combine', () => {
    expect(feetAndInches('10', '6')).toBe(10.5);
    expect(feetAndInches('', '4')).toBeCloseTo(1 / 3);
    expect(feetAndInches('', '')).toBeNull();
  });
});
