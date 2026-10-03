import { belledPierCuFt, bellHeightFt, perimeterBeamCenterline, truckLoads } from '../../lib/concrete';
import { CONCRETE_TOOLS } from '../concreteTools';
import { rowValue, runTool } from '../run';

const tool = (id: string) => CONCRETE_TOOLS.find((t) => t.id === id)!;

describe('slab', () => {
  test('10 x 10 x 4" = 1.23 cu yd before waste, 1.36 with 10%', () => {
    const r = runTool(tool('slab'), { areas: [[10, 10]] });
    expect(rowValue(r, 'Slab area')).toBe('100 sq ft');
    expect(rowValue(r, 'Before waste')).toBe('1.23 cu yd');
    expect(rowValue(r, 'Cubic yards')).toBe('1.36');
    expect(rowValue(r, 'Order')).toBe('1.50 yd');
    expect(rowValue(r, 'Trucks')).toBe('1 truck');
    expect(rowValue(r, '80 lb bags')).toBe('62');
  });

  test('L-shaped slab adds the areas: 20x10 + 10x5 = 250 sq ft', () => {
    // 250 × 4/12 = 83.33 cu ft = 3.09 cu yd
    const r = runTool(tool('slab'), { areas: [[20, 10], [10, 5]] });
    expect(rowValue(r, 'Slab area')).toBe('250 sq ft');
    expect(rowValue(r, 'Before waste')).toBe('3.09 cu yd');
  });

  test('no truck size = no truck row; missing size asks for it', () => {
    const r = runTool(tool('slab'), { areas: [[10, 10]], truck: '' });
    expect(rowValue(r, 'Trucks')).toBeUndefined();
    expect(runTool(tool('slab'), {}).status).toBe('missing');
  });
});

describe('slab + grade beams', () => {
  // 40 x 30 slab, 4" thick, 12" x 24" perimeter beam:
  //   slab      1200 sq ft × 1/3 ft                 = 400 cu ft   = 14.81 cu yd
  //   perimeter 140 ft → centerline 140 − 4 = 136 ft
  //   beam      136 × 1 × (2 − 1/3)                 = 226.67 cu ft = 8.40 cu yd
  //   total     626.67 cu ft = 23.21 cu yd; +10% = 25.53 → order 25.75 → 3 trucks, last 5.75
  test('monolithic slab with a perimeter beam', () => {
    const r = runTool(tool('slab-beams'), { areas: [[40, 30]] });
    expect(rowValue(r, 'Slab')).toBe('14.81 cu yd');
    expect(rowValue(r, 'Perimeter beam')).toBe('8.4 cu yd');
    expect(rowValue(r, 'Interior beams')).toBe('0 cu yd');
    expect(rowValue(r, 'Before waste')).toBe('23.21 cu yd');
    expect(rowValue(r, 'Cubic yards')).toBe('25.53');
    expect(rowValue(r, 'Order')).toBe('25.75 yd');
    expect(rowValue(r, 'Trucks')).toBe('3 trucks');
    if (r.status === 'ok') expect(r.result.rows.find((x) => x.label === 'Trucks')!.note).toBe('2 full (10 yd) + last load 5.75 yd');
  });

  test('interior beams: 60 ft of 12" x 24" = 60 × 1 × 5/3 = 100 cu ft = 3.7 cu yd', () => {
    const r = runTool(tool('slab-beams'), { areas: [[40, 30]], interior: 60 });
    expect(rowValue(r, 'Interior beams')).toBe('3.7 cu yd');
  });

  test('several areas need the perimeter typed in', () => {
    expect(runTool(tool('slab-beams'), { areas: [[40, 30], [10, 10]] }).status).toBe('invalid');
    const r = runTool(tool('slab-beams'), { areas: [[40, 30], [10, 10]], perim: 160 });
    expect(rowValue(r, 'Perimeter beam')).toBe('9.63 cu yd'); // (160 − 4) × 1 × 5/3 = 260 cu ft
  });

  test('warns when the beam is not deeper than the slab', () => {
    const r = runTool(tool('slab-beams'), { areas: [[40, 30]], pDepth: { ft: '', in: '4' } });
    expect(r.status === 'ok' && r.result.warnings?.length).toBe(1);
  });

  test('centerline rule', () => {
    expect(perimeterBeamCenterline(140, 1)).toBe(136);
  });
});

describe('footings & walls', () => {
  test('20 ft × 16" × 8" = 17.78 cu ft = 0.66 cu yd; three of them = 1.98', () => {
    expect(rowValue(runTool(tool('footings'), { length: 20, width: { ft: '', in: '16' }, depth: { ft: '', in: '8' } }), 'Before waste')).toBe(
      '0.66 cu yd',
    );
    expect(
      rowValue(runTool(tool('footings'), { length: 20, width: { ft: '', in: '16' }, depth: { ft: '', in: '8' }, qty: 3 }), 'Before waste'),
    ).toBe('1.98 cu yd');
  });
});

describe('piers & columns', () => {
  test('four 12" round piers 8 ft deep = 25.13 cu ft = 0.93 cu yd', () => {
    const r = runTool(tool('piers'), { size: 1, height: 8, qty: 4 });
    expect(rowValue(r, 'Each pier')).toBe('6.28 cu ft');
    expect(rowValue(r, 'Before waste')).toBe('0.93 cu yd');
  });

  // 18" shaft, 15 ft deep, 4'6" bell, 60° bell height = 1.5 × tan 60° = 2.598 ft, 6" toe:
  //   shaft π/4 × 1.5² × (15 − 2.598 − 0.5)        = 21.032 cu ft
  //   bell  π × 2.598/12 × (4.5² + 4.5×1.5 + 1.5²) = 19.895 cu ft
  //   toe   π/4 × 4.5² × 0.5                        =  7.952 cu ft   → 48.88 cu ft
  test('belled pier', () => {
    expect(bellHeightFt(1.5, 4.5)).toBeCloseTo(2.598, 3);
    expect(belledPierCuFt(1.5, 15, 4.5, bellHeightFt(1.5, 4.5), 0.5)).toBeCloseTo(48.88, 2);
    const r = runTool(tool('piers'), {
      size: { ft: '', in: '18' },
      height: 15,
      bellDia: { ft: '4', in: '6' },
      toe: { ft: '', in: '6' },
    });
    expect(rowValue(r, 'Bell height used')).toBe(`2' 7-3/16"`);
    expect(rowValue(r, 'Each pier')).toBe('48.88 cu ft');
  });

  test('square columns: 16" × 16" × 10 ft, two of them = 35.56 cu ft = 1.32 cu yd', () => {
    const r = runTool(tool('piers'), { shape: 'square', size: { ft: '', in: '16' }, height: 10, qty: 2 });
    expect(rowValue(r, 'Before waste')).toBe('1.32 cu yd');
  });

  test('impossible bells are rejected', () => {
    expect(runTool(tool('piers'), { size: 2, height: 10, bellDia: 1.5 }).status).toBe('invalid');
    expect(runTool(tool('piers'), { size: 1, height: 2, bellDia: 4 }).status).toBe('invalid'); // 60° bell is 2.6 ft tall
    expect(runTool(tool('piers'), { shape: 'square', size: 1, height: 8, bellDia: 3 }).status).toBe('invalid');
  });
});

describe('steps', () => {
  test('3 steps 7" × 11" × 4 ft = 12.83 cu ft; with a 3 ft landing adds 3 × 4 × 1.75 = 21 cu ft', () => {
    const base = { steps: 3, rise: { ft: '', in: '7' }, run: { ft: '', in: '11' }, width: 4 };
    expect(rowValue(runTool(tool('steps'), base), 'Before waste')).toBe('0.48 cu yd');
    expect(rowValue(runTool(tool('steps'), { ...base, landing: 3 }), 'Before waste')).toBe('1.25 cu yd');
  });
});

describe('trucks', () => {
  test('loads and last load', () => {
    expect(truckLoads(25.75, 10)).toEqual({ trucks: 3, lastLoad: 5.75 });
    expect(truckLoads(20, 10)).toEqual({ trucks: 2, lastLoad: 10 });
    expect(truckLoads(0, 10)).toEqual({ trucks: 0, lastLoad: 0 });
  });
});
