import { cornersAfter, insetOutline, polygonArea, wallOutline } from '../geometry';

describe('cornersAfter', () => {
  test('a rectangle is all outside corners', () => {
    expect(cornersAfter(['oo', 'oo', 'oo', 'oo'])).toEqual(['o', 'o', 'o', 'o']);
  });

  test('the crew job: the two o+i walls meet at the bump\'s inside corner', () => {
    // 70, 29'6", 74, 4 (bump end), 4 (bump side, o then i), 25'6" (i then o)
    expect(cornersAfter(['oo', 'oo', 'oo', 'oo', 'oi', 'oi'])).toEqual(['o', 'o', 'o', 'o', 'i', 'o']);
  });

  test('corners that can\'t line up', () => {
    expect(cornersAfter(['oo', 'ii'])).toBeNull();
  });
});

describe('wallOutline', () => {
  test('40 x 30 rectangle closes', () => {
    const o = wallOutline([
      { length: 40, ends: 'oo' },
      { length: 30, ends: 'oo' },
      { length: 40, ends: 'oo' },
      { length: 30, ends: 'oo' },
    ])!;
    expect(o.closed).toBe(true);
    expect(o.points).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 30 },
      { x: 0, y: 30 },
    ]);
    expect(polygonArea(o.points)).toBe(1200);
    // 8" walls: inside face is 40 − 1.33 by 30 − 1.33
    const inner = insetOutline(o.points, 8 / 12);
    expect(polygonArea(inner)).toBeCloseTo((40 - 16 / 12) * (30 - 16 / 12), 6);
  });

  test('the crew job closes: 70 × 29\'6" with a 4 × 4 bump', () => {
    const o = wallOutline([
      { length: 70, ends: 'oo' },
      { length: 29.5, ends: 'oo' },
      { length: 74, ends: 'oo' },
      { length: 4, ends: 'oo' },
      { length: 4, ends: 'oi' },
      { length: 25.5, ends: 'oi' },
    ])!;
    expect(o.closed).toBe(true);
    expect(o.points).toHaveLength(6);
    expect(polygonArea(o.points)).toBeCloseTo(70 * 29.5 + 16, 6);
  });

  test('a run of walls that doesn\'t come back around stays open', () => {
    const o = wallOutline([
      { length: 20, ends: 'oo' },
      { length: 10, ends: 'oo' },
    ])!;
    expect(o.closed).toBe(false);
  });
});
