import {
  chemistryCoefficient,
  cylinderAreaSqIn,
  formPressure,
  ptElongationIn,
  singleTestLimitPsi,
  unitWeightCoefficient,
} from '../../lib/engineering';
import { ENGINEERING_TOOLS } from '../engineeringTools';
import { rowValue, runTool } from '../run';

const tool = (id: string) => ENGINEERING_TOOLS.find((t) => t.id === id)!;
const note = (r: ReturnType<typeof runTool>, label: string) =>
  r.status === 'ok' ? r.result.rows.find((x) => x.label === label)?.note : undefined;
const warnings = (r: ReturnType<typeof runTool>) => (r.status === 'ok' ? r.result.warnings ?? [] : []);

describe('footing size', () => {
  test('soil bearing typed as 15 (meant 1,500) gets a yellow check; 1,500 does not', () => {
    const r = runTool(tool('footing-size'), { load: 3000, bearing: 15 });
    expect(warnings(r)).toContain('Soil bearing is 15 psf. Even soft clay takes about 1,500. Missed some zeros? Check the number.');
    expect(warnings(runTool(tool('footing-size'), { load: 3000 }))).toEqual([]);
  });

  test('3,000 lb/ft wall on 1,500 psf soil needs a 24" footing', () => {
    const r = runTool(tool('footing-size'), { load: 3000 });
    expect(rowValue(r, 'Footing width')).toBe(`24" (2' 0")`);
    expect(rowValue(r, 'Soil pressure')).toBe('1,500 psf');
  });

  test('12" thick footing weighs 150 psf: 3000 ÷ 1350 = 26.7" → 27"; pressure 3000/2.25 + 150 = 1,483 psf', () => {
    const r = runTool(tool('footing-size'), { load: 3000, thick: 1 });
    expect(rowValue(r, 'Footing width')).toBe(`27" (2' 3")`);
    expect(rowValue(r, 'Soil pressure')).toBe('1,483 psf');
  });

  test('20,000 lb pad on 2,000 psf: 10 sq ft → 37.9" → 3\' 2" square', () => {
    const r = runTool(tool('footing-size'), { type: 'pad', load: 20000, bearing: 2000 });
    expect(rowValue(r, 'Pad size')).toBe(`3' 2" square`);
    expect(rowValue(r, 'Soil pressure')).toBe('1,994 psf'); // 20000 ÷ (38/12)²
  });

  test('warns below the 12" code minimum; rejects impossible numbers', () => {
    const r = runTool(tool('footing-size'), { load: 800 }); // 6.4" → 7"
    expect(warnings(r)[0]).toMatch(/12"/);
    expect(runTool(tool('footing-size'), { load: 3000, thick: 10 }).status).toBe('invalid'); // 10 ft thick uses up 1,500 psf
    expect(runTool(tool('footing-size'), { load: 0 }).status).toBe('invalid');
  });
});

describe('cylinder breaks', () => {
  // 4" cylinder: area = π × 4² ÷ 4 = 12.566 sq in
  //   37,700 → 3,000.1 psi   38,200 → 3,039.9   36,900 → 2,936.4   average 2,992.1 → 2,990
  test('loads typed in kips (37.7 for 37,700 lb) get a yellow check; the answer is left as typed', () => {
    const r = runTool(tool('cylinder-break'), { load1: 37.7, load2: 38.2, load3: 36.9 });
    expect(warnings(r)[0]).toBe('A break load of 37.7 lb is tiny. If the tester shows kips, 37.7 kips = 37,700 lb. Check the number.');
    expect(rowValue(r, 'Result')).toBe('Too low');
  });

  test('three 4×8 cylinders averaging just under 3,000 psi', () => {
    const r = runTool(tool('cylinder-break'), { load1: 37700, load2: 38200, load3: 36900 });
    expect(rowValue(r, 'Cylinder 1')).toBe('3,000 psi');
    expect(rowValue(r, 'Cylinder 2')).toBe('3,040 psi');
    expect(rowValue(r, 'Cylinder 3')).toBe('2,940 psi');
    expect(rowValue(r, 'Average')).toBe('2,990 psi');
    expect(note(r, 'Average')).toBe('99.7% of design');
    expect(rowValue(r, 'Result')).toBe('A little low');
    expect(warnings(r)).toEqual([]);
  });

  test('one 4×8 cylinder meets f′c but is not a full strength test', () => {
    const r = runTool(tool('cylinder-break'), { load1: 37700 });
    expect(rowValue(r, 'Strength')).toBe('3,000 psi');
    expect(rowValue(r, 'Result')).toBe('Passes');
    expect(warnings(r)[0]).toMatch(/3 cylinders for 4×8/);
  });

  test('more than 500 psi low is too low', () => {
    // 30,000 ÷ 12.566 = 2,387 psi < 3,000 − 500
    expect(rowValue(runTool(tool('cylinder-break'), { load1: 30000, load2: 30000, load3: 30000 }), 'Result')).toBe('Too low');
  });

  test('6×12 pair: 95,000 and 92,000 lb on 28.27 sq in = 3,360 and 3,250, average 3,310', () => {
    const r = runTool(tool('cylinder-break'), { size: '6x12', load1: 95000, load2: 92000 });
    expect(rowValue(r, 'Average')).toBe('3,310 psi');
    expect(warnings(r)).toEqual([]);
  });

  test('6×12 pair 16% apart is more spread than ASTM C39 allows (8%)', () => {
    const r = runTool(tool('cylinder-break'), { size: '6x12', load1: 100000, load2: 85000 });
    expect(warnings(r)[0]).toMatch(/16.2%/);
  });

  test('ACI single-test limits and areas', () => {
    expect(singleTestLimitPsi(3000)).toBe(2500);
    expect(singleTestLimitPsi(6000)).toBe(5400);
    expect(cylinderAreaSqIn(4)).toBeCloseTo(12.566, 3);
    expect(cylinderAreaSqIn(6)).toBeCloseTo(28.274, 3);
  });
});

describe('post-tension elongation', () => {
  // 100 ft tendon, 33 kips, 0.153 sq in, 28,500 ksi: 33 × 1,200 ÷ (0.153 × 28,500) = 9.08"
  test('calculated elongation and the ±7% range', () => {
    expect(ptElongationIn(33, 100, 0.153, 28500)).toBeCloseTo(9.0815, 4);
    const r = runTool(tool('pt-elongation'), { length: 100 });
    expect(rowValue(r, 'Calculated elongation')).toBe('9-1/16"');
    expect(rowValue(r, 'OK range (±7%)')).toBe('8-7/16" to 9-11/16"'); // 8.446" to 9.717"
  });

  test('measured 8-3/4" is 3.7% short: OK; 8-1/4" is 9.2% short: not OK', () => {
    const ok = runTool(tool('pt-elongation'), { length: 100, measured: '8 3/4' });
    expect(rowValue(ok, 'Measured is')).toBe('−3.7%');
    expect(rowValue(ok, 'Result')).toBe('OK');
    const bad = runTool(tool('pt-elongation'), { length: 100, measured: '8 1/4' });
    expect(rowValue(bad, 'Measured is')).toBe('−9.2%');
    expect(rowValue(bad, 'Result')).toBe('Out of range');
  });

  test('compares against the shop-drawing number when given', () => {
    const r = runTool(tool('pt-elongation'), { length: 100, required: '7 1/2', measured: '7 1/4' });
    expect(rowValue(r, 'Required elongation')).toBe('7-1/2"');
    expect(rowValue(r, 'OK range (±7%)')).toBe('7" to 8"'); // 6.98" to 8.03"
    expect(rowValue(r, 'Measured is')).toBe('−3.3%');
  });

  test('warns about short tendons and over-stressing', () => {
    expect(warnings(runTool(tool('pt-elongation'), { length: 30 }))[0]).toMatch(/Short cable/);
    expect(warnings(runTool(tool('pt-elongation'), { length: 100, force: 40 }))[0]).toMatch(/strand limit/);
  });
});

describe('form pressure (ACI 347R-14)', () => {
  test('10 ft wall at 5 ft/hr and 70°F: 150 + 9,000 × 5 ÷ 70 = 793 psf', () => {
    const r = runTool(tool('form-pressure'), { height: 10, rate: 5 });
    expect(rowValue(r, 'Form pressure')).toBe('793 psf');
    expect(rowValue(r, 'Full liquid')).toBe('1,500 psf');
    expect(r.status === 'ok' && r.result.rows.find((x) => x.label === 'Full liquid')?.note).toBe('The most it could push: the whole pour still soft, like a tank of water');
    expect(rowValue(r, 'Max pressure starts at')).toBe(`5' 3-7/16"`); // 792.9 ÷ 150 = 5.29 ft
  });

  test('textbook check: 4 ft/hr at 50°F = 150 + 720 = 870 psf', () => {
    expect(rowValue(runTool(tool('form-pressure'), { height: 12, rate: 4, temp: 50 }), 'Form pressure')).toBe('870 psf');
  });

  test('walls over 14 ft or 7–15 ft/hr use the second equation', () => {
    // 16 ft wall, 5 ft/hr, 70°F: 150 + 43,400/70 + 2,800 × 5/70 = 150 + 620 + 200 = 970
    expect(rowValue(runTool(tool('form-pressure'), { height: 16, rate: 5 }), 'Form pressure')).toBe('970 psf');
    // 10 ft wall, 10 ft/hr, 60°F: 150 + 723.3 + 466.7 = 1,340
    expect(rowValue(runTool(tool('form-pressure'), { height: 10, rate: 10, temp: 60 }), 'Form pressure')).toBe('1,340 psf');
  });

  test('600 psf minimum, liquid-head cap, fast walls, pumping, retarder', () => {
    const p = (v: Record<string, string | number>) => rowValue(runTool(tool('form-pressure'), v), 'Form pressure');
    expect(p({ height: 10, rate: 1, temp: 90 })).toBe('600 psf'); // 150 + 100 = 250 → 600 minimum
    expect(p({ height: 4, rate: 5, temp: 50 })).toBe('600 psf'); // 1,050 → capped at 150 × 4
    expect(p({ height: 10, rate: 20 })).toBe('1,500 psf'); // over 15 ft/hr → full liquid head
    expect(p({ height: 10, rate: 5, placement: 'pumped' })).toBe('1,875 psf'); // 1.25 × 1,500
    expect(p({ height: 10, rate: 5, retarder: 'yes' })).toBe('951 psf'); // 1.2 × 792.9
    expect(p({ element: 'column', height: 20, rate: 10 })).toBe('1,436 psf'); // columns: 150 + 9,000 × 10/70
  });

  test('coefficients', () => {
    expect(chemistryCoefficient('plain', false)).toBe(1.0);
    expect(chemistryCoefficient('plain', true)).toBe(1.2);
    expect(chemistryCoefficient('blend', false)).toBe(1.2);
    expect(chemistryCoefficient('blend', true)).toBe(1.4);
    expect(chemistryCoefficient('highScm', false)).toBe(1.4);
    expect(chemistryCoefficient('highScm', true)).toBe(1.4);
    expect(unitWeightCoefficient(145)).toBe(1);
    expect(unitWeightCoefficient(120)).toBeCloseTo(0.914, 3); // 0.5 × (1 + 120/145)
    expect(unitWeightCoefficient(80)).toBe(0.8); // never below 0.80
    expect(unitWeightCoefficient(160)).toBeCloseTo(1.103, 3); // 160/145
    const r = formPressure({ element: 'wall', heightFt: 10, rateFtPerHr: 5, tempF: 70, unitWeightPcf: 150, cc: 1, placement: 'liquid' });
    expect(r.governs).toBe('liquidMix');
    expect(r.pressurePsf).toBe(1500);
  });

  test('impossible inputs', () => {
    expect(runTool(tool('form-pressure'), { height: 10, rate: 0 }).status).toBe('invalid');
    expect(runTool(tool('form-pressure'), { height: 10, rate: 5, temp: 20 }).status).toBe('invalid');
    expect(note(runTool(tool('form-pressure'), { height: 10, rate: 1, temp: 90 }), 'Form pressure')).toBe('600 psf minimum');
  });
});
