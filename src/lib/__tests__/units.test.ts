import { CUFT_PER_CUYD, fixed, fmtCM, fmtNum, formatFtIn, formatInFrac, LIN, metricBase, segText, SHOWS } from '../units';

describe('unit sizes', () => {
  test('feet, yards and metric in inches', () => {
    expect(LIN.ft).toBe(12);
    expect(LIN.yd).toBe(36);
    expect(LIN.m).toBeCloseTo(39.3701, 4); // 1 m = 39.37"
    expect(LIN.cm * 2.54).toBeCloseTo(1, 12); // 1" = 2.54 cm exactly
    expect(LIN.mm * 25.4).toBeCloseTo(1, 12);
  });

  test('areas and volumes', () => {
    expect(SHOWS.sqft.per).toBe(144);
    expect(SHOWS.sqyd.per).toBe(9 * 144);
    expect(SHOWS.cuft.per).toBe(1728);
    expect(SHOWS.cuyd.per).toBe(CUFT_PER_CUYD * 1728); // 27 cu ft = 46,656 cu in
    expect(SHOWS.sqm.per).toBeCloseTo(1550.0031, 3); // 1 sq m = 1,550 sq in
    expect(SHOWS.cum.per).toBeCloseTo(61023.744, 2); // 1 cu m = 61,024 cu in
    expect(SHOWS.cum.per / SHOWS.cuyd.per).toBeCloseTo(1.30795, 4); // 1 cu m = 1.308 cu yd
    expect(SHOWS.bdft.per).toBe(144); // 12" × 12" × 1"
  });

  test('metric base unit', () => {
    expect(metricBase('sqcm')).toBe('cm');
    expect(metricBase('cumm')).toBe('mm');
    expect(metricBase('cum')).toBe('m');
  });
});

describe('number text', () => {
  test('halves round away from zero, even a hair under', () => {
    expect(fixed(4.95935, 4)).toBe('4.9594');
    expect(fixed(2.5, 0)).toBe('3');
    expect(fixed(-2.5, 0)).toBe('-3');
    expect(fixed(-0.0001, 2)).toBe('0.00'); // no "-0.00"
  });

  test('trailing zeros dropped; not a number shows Error', () => {
    expect(fmtNum(1.23)).toBe('1.23');
    expect(fmtNum(2)).toBe('2');
    expect(fmtNum(-0.00001)).toBe('0');
    expect(fmtNum(Infinity)).toBe('Error');
  });

  test('7 digits like the calculator screen', () => {
    expect(fmtCM(14 / 9)).toBe('1.555556');
    expect(fmtCM(261.05034)).toBe('261.0503');
    expect(fmtCM(27215.543)).toBe('27215.54');
    expect(fmtCM(-3.5)).toBe('−3.5');
  });
});

describe('feet-inch and fraction text', () => {
  test('227.875" = 18 FEET 11-7/8 INCH', () => {
    expect(segText(formatFtIn(227.875, 16))).toBe('18 FEET 11-7/8 INCH');
    expect(segText(formatFtIn(-30, 16))).toBe('−2 FEET 6 INCH');
    expect(segText(formatFtIn(-0.001, 16))).toBe('0 FEET 0 INCH'); // rounds to nothing: no minus sign
  });

  test('fractions to the nearest 1/16 or 1/64', () => {
    expect(segText(formatInFrac(3.931, 16))).toBe('3-15/16 INCH');
    expect(segText(formatInFrac(0.703, 64))).toBe('0-45/64 INCH');
    expect(segText(formatInFrac(0.5, 16, false))).toBe('0-8/16 INCH'); // not reduced when asked
  });
});
