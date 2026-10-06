import { cutFill, elevationFromRod, heightOfInstrument, loadsNeeded, looseFromBank, slopeRatioX } from '../../lib/site';
import { rowValue, runTool } from '../run';
import { SITE_TOOLS } from '../siteTools';

const tool = (id: string) => SITE_TOOLS.find((t) => t.id === id)!;
const note = (r: ReturnType<typeof runTool>, label: string) =>
  r.status === 'ok' ? r.result.rows.find((x) => x.label === label)?.note : undefined;

describe('slope & fall', () => {
  test('1/4" per ft over 20 ft = 5" drop, 2.08%, 1:48', () => {
    const r = runTool(tool('slope'), { run: 20, slope: '1/4' });
    expect(rowValue(r, 'Drop')).toBe('5"');
    expect(rowValue(r, 'Slope')).toBe('1/4" per ft');
    expect(rowValue(r, 'Percent')).toBe('2.08%');
  });

  test('6" drop over 10 ft = 0.6" per ft (5/8" to the nearest 16th), 5%, 1:20', () => {
    const r = runTool(tool('slope'), { run: 10, drop: { ft: '', in: '6' } });
    expect(rowValue(r, 'Slope')).toBe('5/8" per ft');
    expect(rowValue(r, 'Percent')).toBe('5%');
  });

  test('2% over 50 ft = 1 ft = 12"', () => {
    const r = runTool(tool('slope'), { run: 50, slope: 2, slopeUnit: 'pct' });
    expect(rowValue(r, 'Drop')).toBe('12"');
    expect(note(r, 'Drop')).toBe(`1' 0"`);
  });

  test('needs exactly one of slope or drop', () => {
    expect(runTool(tool('slope'), { run: 20 }).status).toBe('invalid');
    expect(runTool(tool('slope'), { run: 20, slope: 1, drop: 1 }).status).toBe('invalid');
    expect(runTool(tool('slope'), { run: 0, slope: 1 }).status).toBe('invalid');
    expect(slopeRatioX(0)).toBe(Infinity);
  });
});

describe('grade rod & elevations', () => {
  // BM 100.00, backsight 4.62 → HI 104.62. Top of slab 101.50 → rod should read 3.12.
  const base = { bm: 100, bs: 4.62, target: 101.5 };

  test('height of instrument and the target rod reading', () => {
    const r = runTool(tool('elevations'), base);
    expect(rowValue(r, 'Laser height (HI)')).toBe('104.62 ft');
    expect(rowValue(r, 'Rod at grade')).toBe('3.12 ft');
    expect(note(r, 'Rod at grade')).toBe(`3' 1-7/16" on a feet-inch rod`); // 0.12 ft = 1.44"
  });

  test('a spot reading 3.47 is 101.15 = 0.35 ft (4-3/16") of fill', () => {
    const r = runTool(tool('elevations'), { ...base, shot: 3.47 });
    expect(rowValue(r, 'Spot elevation')).toBe('101.15 ft');
    expect(rowValue(r, 'Fill')).toBe('0.35 ft');
    expect(note(r, 'Fill')).toBe('4-3/16" low');
  });

  test('a spot reading 2.80 is 101.82 = 0.32 ft (3-13/16") of cut', () => {
    const r = runTool(tool('elevations'), { ...base, shot: '2.80' });
    expect(rowValue(r, 'Cut')).toBe('0.32 ft');
    expect(note(r, 'Cut')).toBe('3-13/16" high');
  });

  test('on grade, and a target above the laser', () => {
    expect(rowValue(runTool(tool('elevations'), { ...base, shot: 3.12 }), 'On grade')).toBe('0.00 ft');
    const r = runTool(tool('elevations'), { bm: 100, bs: 4, target: 105 });
    expect(r.status === 'ok' && r.result.warnings?.length).toBe(1);
  });

  test('the leveling formulas', () => {
    const hi = heightOfInstrument(100, 4.62);
    expect(elevationFromRod(hi, 3.47)).toBeCloseTo(101.15, 9);
    expect(cutFill(101.82, 101.5)).toBeCloseTo(0.32, 9);
  });
});

describe('excavation', () => {
  test('40 × 30 × 3 ft = 133.33 bank yd, 166.67 loose at 25%, 17 ten-yard loads', () => {
    const r = runTool(tool('excavation'), { length: 40, width: 30, depth: 3 });
    expect(rowValue(r, 'In the ground')).toBe('133.33 cu yd');
    expect(rowValue(r, 'Loose (to haul)')).toBe('166.67 cu yd');
    expect(rowValue(r, 'Truck loads')).toBe('17');
  });

  test('2 ft over-dig each side: 44 × 34 × 3 = 4,488 cu ft = 166.22 yd', () => {
    const r = runTool(tool('excavation'), { length: 40, width: 30, depth: 3, overDig: 24 });
    expect(rowValue(r, 'Dig size')).toBe(`44' 0" × 34' 0"`);
    expect(rowValue(r, 'In the ground')).toBe('166.22 cu yd');
  });

  test('swell and loads', () => {
    expect(looseFromBank(100, 25)).toBe(125);
    expect(loadsNeeded(20, 10)).toBe(2);
    expect(loadsNeeded(20.1, 10)).toBe(3);
    expect(loadsNeeded(0, 10)).toBe(0);
  });

  test('footing trench 120 ft × 24" × 18" = 360 cu ft = 13.33 yd, 16.67 loose, 2 loads', () => {
    const r = runTool(tool('excavation'), { length: 120, width: 2, depth: 1.5 });
    expect(rowValue(r, 'In the ground')).toBe('13.33 cu yd');
    expect(rowValue(r, 'Loose (to haul)')).toBe('16.67 cu yd');
    expect(rowValue(r, 'Truck loads')).toBe('2');
  });

  test('4 pier holes 3 × 3 × 4 ft = 144 cu ft = 5.33 yd', () => {
    const r = runTool(tool('excavation'), { length: 3, width: 3, depth: 4, qty: 4 });
    expect(rowValue(r, 'In the ground')).toBe('5.33 cu yd');
    expect(rowValue(r, 'Loose (to haul)')).toBe('6.67 cu yd');
  });

  test('a 0 size or 0 holes gets a note, not 0 yards', () => {
    expect(runTool(tool('excavation'), { length: 40, width: 30, depth: 0 })).toEqual({ status: 'invalid', message: 'Length, width and depth must be more than 0.' });
    expect(runTool(tool('excavation'), { length: 40, width: 30, depth: 3, qty: 0 })).toEqual({ status: 'invalid', message: 'How many must be at least 1.' });
  });
});

describe('fill & base rock', () => {
  // 40 × 30 × 4" = 400 cu ft = 14.81 yd compacted; +20% = 17.78 loose; × 1.4 = 24.9 tons; 15-ton loads = 2
  test('4" of base under a 40 × 30 slab', () => {
    const r = runTool(tool('fill-base'), { areas: [[40, 30]] });
    expect(rowValue(r, 'Area')).toBe('1,200 sq ft');
    expect(rowValue(r, 'Compacted')).toBe('14.81 cu yd');
    expect(rowValue(r, 'Order (loose)')).toBe('17.78 cu yd');
    expect(rowValue(r, 'Tons')).toBe('24.9 tons');
    expect(rowValue(r, 'Truck loads')).toBe('2');
  });

  // 24 × 24 garage + 12 × 10 apron = 696 sq ft at 6": 348 cu ft = 12.89 yd; +20% = 15.47; × 1.4 = 21.65 tons
  test('6" of rock under a garage and apron', () => {
    const r = runTool(tool('fill-base'), { areas: [[24, 24], [12, 10]], depth: 0.5 });
    expect(rowValue(r, 'Area')).toBe('696 sq ft');
    expect(rowValue(r, 'Compacted')).toBe('12.89 cu yd');
    expect(rowValue(r, 'Order (loose)')).toBe('15.47 cu yd');
    expect(rowValue(r, 'Tons')).toBe('21.7 tons');
    expect(rowValue(r, 'Truck loads')).toBe('2');
  });

  test('0 depth or 0 tons per yard gets a note, not 0 tons', () => {
    expect(runTool(tool('fill-base'), { areas: [[40, 30]], depth: 0 }).status).toBe('invalid');
    expect(runTool(tool('fill-base'), { areas: [[40, 30]], density: 0 }).status).toBe('invalid');
  });
});
