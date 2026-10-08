import { fillerSet, layoutFace, stackFor } from '../concreteTools';
import { belledPierCuFt, bellHeightFt, perimeterBeamCenterline, truckLoads } from '../../lib/concrete';
import { CONCRETE_TOOLS } from '../concreteTools';
import { migrateItem } from '..';
import { rowValue, runTool } from '../run';
import { isTooBig } from '../concreteShared';

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

describe('slab with an exterior footing (mono pour)', () => {
  // 40 x 30 slab, 4" thick, 12" x 24" thickened edge:
  //   slab      1200 sq ft × 1/3 ft                 = 400 cu ft   = 14.81 cu yd
  //   footing   140 ft around → centerline 140 − 4 = 136 ft
  //             136 × 1 × (2 − 1/3)                 = 226.67 cu ft = 8.40 cu yd
  //   total     626.67 cu ft = 23.21 cu yd; +10% = 25.53 → order 25.75
  const mono = { areas: [[40, 30]] as [number, number][], footing: true, fDepth: 2 };

  test('slab plus the edge, below the slab only', () => {
    const r = runTool(tool('slab'), mono);
    expect(rowValue(r, 'Slab')).toBe('14.81 cu yd');
    expect(rowValue(r, 'Exterior footing')).toBe('8.4 cu yd');
    expect(rowValue(r, 'Before waste')).toBe('23.21 cu yd');
    expect(rowValue(r, 'Order')).toBe('25.75 yd');
    expect(r.status === 'ok' && r.result.warnings?.[0]).toMatch(/rarely dug even/);
  });

  // Garage: 24 × 24, 4" slab, 12" × 18" thickened edge.
  //   slab     576 sq ft × 1/3 ft                = 192 cu ft     = 7.11 yd
  //   edge     96 ft around → middle 96 − 4 = 92 ft × 1 × (1.5 − 1/3) = 107.33 cu ft = 3.98 yd
  //   total    299.33 cu ft = 11.09 yd; +10% = 329.27 cu ft = 12.20 yd → order 12.25 yd
  //   trucks   10 yd trucks: 1 full + a last load of 2.25 yd
  test('24 × 24 garage, mono pour with a 12" × 18" edge', () => {
    const r = runTool(tool('slab'), { areas: [[24, 24]], footing: true, fDepth: { ft: '', in: '18' } });
    expect(rowValue(r, 'Slab')).toBe('7.11 cu yd');
    expect(rowValue(r, 'Exterior footing')).toBe('3.98 cu yd');
    expect(rowValue(r, 'Before waste')).toBe('11.09 cu yd');
    expect(rowValue(r, 'Cubic yards')).toBe('12.2');
    expect(rowValue(r, 'Order')).toBe('12.25 yd');
    expect(rowValue(r, 'Trucks')).toBe('2 trucks');
    expect(r.status === 'ok' && r.result.rows.find((x) => x.label === 'Trucks')?.note).toBe('1 full (10 yd) + last load 2.25 yd');
  });

  test('dug 2" wider and 2" deeper: the order uses the footing as dug', () => {
    // 14" × 26": centerline 140 − 4.667 = 135.33 × 1.1667 × (26 − 4)/12 = 289.46 cu ft = 10.72 yd
    const r = runTool(tool('slab'), { ...mono, dugW: 2, dugD: 2 });
    expect(rowValue(r, 'Exterior footing')).toBe('8.4 cu yd');
    expect(rowValue(r, 'Footing as dug')).toBe('10.72 cu yd');
    expect(rowValue(r, 'Before waste')).toBe('25.54 cu yd'); // 400 + 289.46 = 689.46 cu ft
    expect(r.status === 'ok' && r.result.warnings?.[0]).toMatch(/as dug/);
  });

  test('interior footings: 60 ft of 12" x 24" = 60 × 1 × 5/3 = 100 cu ft = 3.7 cu yd', () => {
    const r = runTool(tool('slab'), { ...mono, interior: true, iLength: 60, iDepth: 2 });
    expect(rowValue(r, 'Interior footings')).toBe('3.7 cu yd');
  });

  test('several areas need the footing length typed in', () => {
    expect(runTool(tool('slab'), { ...mono, areas: [[40, 30], [10, 10]] }).status).toBe('invalid');
    const r = runTool(tool('slab'), { ...mono, areas: [[40, 30], [10, 10]], fPerim: 160, corners: 6 });
    expect(rowValue(r, 'Exterior footing')).toBe('9.63 cu yd'); // (160 − 4) × 1 × 5/3 = 260 cu ft
  });

  test('switches off = a plain slab, no footing rows', () => {
    const r = runTool(tool('slab'), { areas: [[40, 30]], fDepth: 2 });
    expect(rowValue(r, 'Exterior footing')).toBeUndefined();
    expect(rowValue(r, 'Before waste')).toBe('14.81 cu yd');
  });
});

describe('slab rebar, footing bars and tying the slab to the edge', () => {
  const mono = { areas: [[40, 30]] as [number, number][], footing: true, fDepth: 2, slabRebar: true, footBars: true };

  test('slab bars bent down into a 24" footing: legs reach 3" off the bottom', () => {
    // bar at mid-slab (2") → down to 21": 24 − 2 − 3 = 19"
    const r = runTool(tool('slab'), mono);
    if (r.status !== 'ok') throw new Error(r.status);
    const bars = r.result.rows.find((x) => x.label === 'Slab bars')!;
    expect(bars.note).toContain('49 bars, #4 at 18" both ways');
    expect(bars.note).toContain('ends bent down 19"');
    // 49 bars × 2 ends × 19" = 155.17 ft more steel than not bending
    const flat = runTool(tool('slab'), { ...mono, edgeTie: 'none' });
    const ft = (x: ReturnType<typeof runTool>) => (x.status === 'ok' ? Number(x.result.rows.find((y) => y.label === 'Slab bars')!.value.replace(/[^\d.]/g, '')) : 0);
    expect(ft(r) - ft(flat)).toBeGreaterThan(155);
  });

  test('footing bars: 3 #4 around with an L-bar per bar at each of the 4 corners', () => {
    const r = runTool(tool('slab'), mono);
    if (r.status !== 'ok') throw new Error(r.status);
    const fb = r.result.rows.find((x) => x.label === 'Footing bars')!;
    expect(fb.note).toContain('3 #4 bars along the footing');
    expect(fb.note).toContain(`12 corner L-bars 3' 4" (20" legs)`);
    expect(rowValue(r, '#4 sticks')).toMatch(/^\d+ × 20'$/);
    expect(rowValue(r, 'Rebar weight')).toMatch(/ lb$/);
  });

  test('L-bars at the edge instead of bending', () => {
    const r = runTool(tool('slab'), { ...mono, edgeTie: 'lbars' });
    // centerline 136 ft = 1632" at 18" → 91 spaces → 92 L-bars, 20" + 19" = 3' 3"
    expect(rowValue(r, 'Edge L-bars')).toBe(`92 × 3' 3"`);
  });
});

describe('slab sides: against the house, dowels', () => {
  // 40 x 30, 12" x 24" footing on the formed sides only; the top side (40') is against the house with dowels.
  const sides = {
    areas: [[40, 30]] as [number, number][],
    footing: true,
    fDepth: 2,
    edges: true,
    sideTop: 'dowels',
    slabRebar: true,
    footBars: true,
  };

  test('forms only on the formed sides', () => {
    expect(rowValue(runTool(tool('slab'), sides), 'Forms')).toBe('100 ft');
  });

  test('footing runs the 3 formed sides: 100 ft − 2 overlapping corners = 98 ft', () => {
    // 98 × 1 × (2 − 1/3) = 163.33 cu ft = 6.05 cu yd
    const r = runTool(tool('slab'), sides);
    expect(rowValue(r, 'Exterior footing')).toBe('6.05 cu yd');
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.result.rows.find((x) => x.label === 'Footing bars')!.note).toContain('6 corner L-bars');
    expect(r.result.rows.find((x) => x.label === 'Slab bars')!.note).toContain('(right, bottom, left)');
  });

  test('dowels along the house: 40 ft, 6" in from each end, every 24" = 21', () => {
    expect(rowValue(runTool(tool('slab'), sides), 'Dowels')).toBe(`21 × 1' 6"`);
  });

  test('footing along the house too: back to the full 140 ft − 4', () => {
    expect(rowValue(runTool(tool('slab'), { ...sides, houseFooting: true }), 'Exterior footing')).toBe('8.4 cu yd');
  });

  test('every side against the house and no footing there: warns, no footing yards', () => {
    const r = runTool(tool('slab'), { ...sides, sideRight: 'house', sideBottom: 'house', sideLeft: 'house' });
    expect(rowValue(r, 'Exterior footing')).toBeUndefined();
    expect(r.status === 'ok' && r.result.warnings?.some((w) => w.includes('No side has a footing'))).toBe(true);
  });

  test('marking sides needs a one-piece slab', () => {
    expect(runTool(tool('slab'), { ...sides, areas: [[40, 30], [10, 10]] }).status).toBe('invalid');
  });
});

describe('rounded corners', () => {
  // 40 x 30 with all four corners at a 2' radius
  const round = { areas: [[40, 30]] as [number, number][], rounded: true, radius: 2 };

  test('area loses a square minus a quarter circle at each corner', () => {
    // 1200 − 4 × 4 × (1 − π/4) = 1196.57
    const r = runTool(tool('slab'), round);
    expect(rowValue(r, 'Slab area')).toBe('1,196.6 sq ft');
    expect(rowValue(r, 'Rounded corners')).toBe(`4 × 2' 0" radius`);
    if (r.status === 'ok') expect(r.result.rows.find((x) => x.label === 'Rounded corners')!.note).toBe('12.6 ft of curved edge (bender board)');
  });

  test('the footing follows the curve along its centerline', () => {
    // straight 36 + 26 + 36 + 26 = 124, arcs 4 × π/2 × (2 − 0.5) = 9.42 → 133.42 ft × 1 × 5/3 = 222.4 cu ft
    const r = runTool(tool('slab'), { ...round, footing: true, fDepth: 2, footBars: true });
    expect(rowValue(r, 'Exterior footing')).toBe('8.24 cu yd');
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.result.rows.find((x) => x.label === 'Exterior footing')!.note).toContain('136.6 ft of edge');
    const bars = r.result.rows.find((x) => x.label === 'Footing bars')!.note!;
    expect(bars).toContain('0 corner L-bars');
    expect(bars).toContain('bent around the 4 rounded corners');
  });

  test('only some corners: forms count the curves', () => {
    const r = runTool(tool('slab'), { ...round, roundCorners: 'tr,br', edges: true });
    // straight 38 + 26 + 38 + 30 = 132, arcs 2 × π = 6.28 → 138.3 ft
    expect(rowValue(r, 'Forms')).toBe('138.3 ft');
  });

  test('radius smaller than the footing, or next to the house, is refused', () => {
    expect(runTool(tool('slab'), { ...round, radius: 0.5, footing: true }).status).toBe('invalid');
    expect(runTool(tool('slab'), { ...round, edges: true, sideTop: 'house' }).status).toBe('invalid');
    expect(runTool(tool('slab'), { ...round, areas: [[40, 30], [10, 10]] }).status).toBe('invalid');
  });
});

describe('old Slab + Beams calculations', () => {
  test('open as a Slab with the footing switched on', () => {
    const m = migrateItem('slab-beams', { areas: [], pWidth: { ft: '', in: '12' }, pDepth: { ft: '2', in: '' }, perim: '', interior: '60' });
    expect(m.toolId).toBe('slab');
    expect(m.raw).toMatchObject({ footing: '1', fWidth: { ft: '', in: '12' }, fDepth: { ft: '2', in: '' }, interior: '1', iLength: '60' });
  });
});

describe('footings & walls', () => {
  test('20 ft × 16" × 8" = 17.78 cu ft = 0.66 cu yd; three of them = 1.98', () => {
    expect(rowValue(runTool(tool('footings'), { shape: 'run', length: 20, width: { ft: '', in: '16' }, depth: { ft: '', in: '8' } }), 'Before waste')).toBe(
      '0.66 cu yd',
    );
    expect(
      rowValue(runTool(tool('footings'), { shape: 'run', length: 20, width: { ft: '', in: '16' }, depth: { ft: '', in: '8' }, qty: 3 }), 'Before waste'),
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

  // Deck footings: nine 10" sonotubes, 4 ft deep.
  //   each  π × (5/12)² × 4 = 2.18 cu ft;  nine = 19.63 cu ft = 0.73 yd
  //   +10%  21.60 cu ft = 0.80 yd → order 1.00 yd (next ¼ yd up from 0.7999)
  //   bags  21.60 ÷ 0.6 = 36.0 → 36 × 80 lb;  ÷ 0.45 = 48.0 → 48 × 60 lb;  ÷ 0.3 = 72.0 → 72 × 40 lb
  test('deck: nine 10" sonotubes 4 ft deep, with the bag counts', () => {
    const r = runTool(tool('piers'), { size: { ft: '', in: '10' }, height: 4, qty: 9 });
    expect(rowValue(r, 'Each pier')).toBe('2.18 cu ft');
    expect(rowValue(r, 'Before waste')).toBe('0.73 cu yd');
    expect(rowValue(r, 'Cubic feet')).toBe('21.6');
    expect(rowValue(r, 'Order')).toBe('1.00 yd');
    expect(rowValue(r, '80 lb bags')).toBe('36');
    expect(rowValue(r, '60 lb bags')).toBe('48');
    expect(rowValue(r, '40 lb bags')).toBe('72');
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

  // Front steps: 4 steps, 7-1/2" rise, 11" run, 5 ft wide.
  //   steps   5 × 11/12 × 7.5/12 × (1 + 2 + 3 + 4 = 10) = 28.65 cu ft = 1.06 yd
  //   +10%    31.51 cu ft = 1.17 yd → order 1.25 yd; 31.51 ÷ 0.6 = 52.5 → 53 80-lb bags
  //   4 ft landing at the top, 4 rises tall: 4 × 5 × 2.5 = 50 cu ft → 78.65 cu ft = 2.91 yd; +10% = 3.20 → order 3.25
  test('front steps with and without a landing', () => {
    const front = { steps: 4, rise: { ft: '', in: '7 1/2' }, run: { ft: '', in: '11' }, width: 5 };
    const r = runTool(tool('steps'), front);
    expect(rowValue(r, 'Before waste')).toBe('1.06 cu yd');
    expect(rowValue(r, 'Order')).toBe('1.25 yd');
    expect(rowValue(r, '80 lb bags')).toBe('53');
    const l = runTool(tool('steps'), { ...front, landing: 4 });
    expect(rowValue(l, 'Before waste')).toBe('2.91 cu yd');
    expect(rowValue(l, 'Cubic yards')).toBe('3.2');
    expect(rowValue(l, 'Order')).toBe('3.25 yd');
    expect(rowValue(l, '80 lb bags')).toBeUndefined(); // over 2 yd: order a truck
  });
});

describe('trucks', () => {
  test('loads and last load', () => {
    expect(truckLoads(25.75, 10)).toEqual({ trucks: 3, lastLoad: 5.75 });
    expect(truckLoads(20, 10)).toEqual({ trucks: 2, lastLoad: 10 });
    expect(truckLoads(0, 10)).toEqual({ trucks: 0, lastLoad: 0 });
  });
});

describe('concrete cost', () => {
  test('price per yard × the order: 1.50 yd × $150 = $225.00', () => {
    const r = runTool(tool('slab'), { areas: [[10, 10]], price: 150 });
    expect(rowValue(r, 'Concrete cost')).toBe('$225.00');
  });

  test('no price, no cost row', () => {
    expect(rowValue(runTool(tool('slab'), { areas: [[10, 10]] }), 'Concrete cost')).toBeUndefined();
  });
});

describe('forms & stakes', () => {
  test('a 4 ft form (meant 4") and stakes every 40 ft get a yellow check; the count is left as typed', () => {
    const w = (r: ReturnType<typeof runTool>) => (r.status === 'ok' ? r.result.warnings : ['not ok']);
    const r = runTool(tool('forms'), { length: 40, width: 30, height: 4 });
    expect(w(r)).toEqual(['Form height is 4 feet. Did you mean 4 inches? Inches go in the “in” box.']);
    expect(rowValue(r, 'Rows of boards')).toBe('12 high'); // 48" of 2x4s, as typed
    expect(w(runTool(tool('forms'), { length: 40, width: 30, stakeSpacing: 40 }))).toEqual(['Stakes every 40 ft is far apart for slab forms (4 ft is usual). Check the number.']);
    expect(w(runTool(tool('forms'), { length: 40, width: 30 }))).toEqual([]);
  });

  // 40 x 30 = 140 ft of 2x4. 140 / 16 = 8.75 → 9 boards.
  // Stakes: 40' side = 10 + 1 = 11, 30' side = 8 + 1 = 9 → 2 × 11 + 2 × 9 = 40
  test('40 x 30 slab, 4" forms', () => {
    const r = runTool(tool('forms'), { length: 40, width: 30 });
    expect(rowValue(r, 'Form length')).toBe('140 ft');
    expect(rowValue(r, 'Rows of boards')).toBeUndefined();
    expect(rowValue(r, 'Boards')).toBe(`9 × 16' 2x4`);
    expect(rowValue(r, 'Stakes')).toBe('40');
  });

  test('24" beam edge in 2x12 is 2 rows; total form length overrides', () => {
    // 100 ft × 2 rows = 200 ft / 16 = 12.5 → 13 boards; stakes 100 / 4 + 1 = 26
    const r = runTool(tool('forms'), { formLF: 100, height: 2, board: '12' });
    expect(rowValue(r, 'Rows of boards')).toBe('2 high');
    expect(rowValue(r, 'Boards')).toBe(`13 × 16' 2x12`);
    expect(rowValue(r, 'Stakes')).toBe('26');
  });

  test('needs a size', () => {
    expect(runTool(tool('forms'), {}).status).toBe('invalid');
  });

  test('a 2x4 on top of a 2x12 for a 16" footing edge', () => {
    // 140 ft: 1 row of 2x12 (16 − 4 = 12") + the 2x4 → 9 of each at 16'
    const r = runTool(tool('forms'), { length: 40, width: 30, height: { ft: '', in: '16' }, board: '12', topBoard: '4' });
    expect(rowValue(r, 'Rows of boards')).toBe('2 high');
    expect(rowValue(r, 'Boards')).toBe(`9 × 16' 2x12`);
    expect(rowValue(r, 'Top boards')).toBe(`9 × 16' 2x4`);
    expect(r.status === 'ok' && r.result.warnings).toEqual([]);
    // 2x12 + 2x6 is 18": taller than a 16" form, so it warns
    const tall = runTool(tool('forms'), { length: 40, width: 30, height: { ft: '', in: '16' }, board: '12', topBoard: '6' });
    expect(tall.status === 'ok' && tall.result.warnings?.[0]).toMatch(/stack to 18"/);
  });
});

describe('wall forms (aluminum)', () => {
  test(`fillers: fewest pieces from 14", 1', 8", 6"`, () => {
    expect(fillerSet(18)).toEqual([12, 6]);
    expect(fillerSet(26)).toEqual([14, 12]);
    expect(fillerSet(8)).toEqual([8]);
    expect(fillerSet(2)).toBeNull();
  });

  test('layoutFace trades a panel for fillers when the leftover is too small', () => {
    expect(layoutFace(816, 24)).toEqual({ panels: 34, fillers: [], woodIn: 0 });
    expect(layoutFace(290, 24)).toEqual({ panels: 11, fillers: [14, 12], woodIn: 0 });
    expect(layoutFace(331, 24)).toEqual({ panels: 13, fillers: [12, 6], woodIn: 1 });
  });

  // The crew's real job, 8" wall, 2' × 4' panels, measured on the outside, going around:
  //   70' (both outside)     out 1' + 34 + 1'            in 34
  //   29'6" (both outside)   out 1' + 13 + 1' + 6" + 1'  in 13 + 1' + 6"
  //   74' (both outside)     out 1' + 36 + 1'            in 36
  //   4' bump end            out 1' + 1 + 1'             in 1
  //   4' bump side (o + i)   out 1' + 1 + 8"             in 1 + 8"
  //   25'6" (o + i)          out 1' + 11 + 14" + 1'       in 11 + 14" + 1'
  const job: [number, 'oo' | 'oi'][] = [[70, 'oo'], [29.5, 'oo'], [74, 'oo'], [4, 'oo'], [4, 'oi'], [25.5, 'oi']];

  test('the crew job, wall by wall', () => {
    const r = runTool(tool('wall-forms'), { walls: job });
    if (r.status !== 'ok') throw new Error(r.status);
    const note = (label: string) => r.result.rows.find((x) => x.label === label)!.note;
    expect(note(`Wall 1: 70' 0"`)).toBe(`Out: 1' + 34 × 2' + 1'\nIn: 34 × 2'`);
    expect(note(`Wall 2: 29' 6"`)).toBe(`Out: 1' + 13 × 2' + 1' + 6" + 1'\nIn: 13 × 2' + 1' + 6"`);
    expect(note(`Wall 3: 74' 0"`)).toBe(`Out: 1' + 36 × 2' + 1'\nIn: 36 × 2'`);
    expect(note(`Wall 4: 4' 0"`)).toBe(`Out: 1' + 1 × 2' + 1'\nIn: 1 × 2'`);
    expect(note(`Wall 5: 4' 0"`)).toBe(`Out: 1' + 1 × 2' + 8"\nIn: 1 × 2' + 8"`);
    expect(note(`Wall 6: 25' 6"`)).toBe(`Out: 1' + 11 × 2' + 14" + 1'
In: 11 × 2' + 14" + 1'`);
  });

  test('the crew job, totals', () => {
    const r = runTool(tool('wall-forms'), { walls: job });
    expect(rowValue(r, 'Wall height')).toBe(`4'`);
    expect(rowValue(r, `2' panels`)).toBe('192'); // 68 + 26 + 72 + 2 + 2 + 22
    expect(rowValue(r, 'Fillers')).toBe('20');
    expect(rowValue(r, 'Inside corners (4×4)')).toBe('6'); // 5 outside + 1 inside corner
    expect(rowValue(r, 'Ties')).toBe('about 351'); // 117 joints × 3
    // centerline 207 − 4 × 8" = 204.33 ft × 0.667 × 4 = 544.9 cu ft
    expect(rowValue(r, 'Concrete in the wall')).toBe('20.18 cu yd');
    if (r.status === 'ok') {
      // Load list, one row per filler size
      expect(rowValue(r, '14" fillers')).toBe('2');
      expect(rowValue(r, `1' fillers`)).toBe('14');
      expect(rowValue(r, '8" fillers')).toBe('2');
      expect(rowValue(r, '6" fillers')).toBe('2');
      expect(r.result.warnings).toEqual([]);
    }
  });

  const plenty = (sizes: number[]) => sizes.map((n) => [n, null] as [number, null]);

  test(`your fillers: with an 18" on the trailer, 29'6" takes one 18" instead of 1' + 6"`, () => {
    const r = runTool(tool('wall-forms'), { walls: [[29.5, 'oo']], fillers: plenty([6, 8, 12, 14, 18]) });
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.result.rows.find((x) => x.label === `Wall 1: 29' 6"`)!.note).toBe(`Out: 1' + 13 × 2' + 18" + 1'
In: 13 × 2' + 18"`);
    expect(runTool(tool('wall-forms'), { walls: [[29.5, 'oo']], fillers: [{ size: '', qty: '' }] }).status).toBe('missing');
  });

  test(`only one 14" on the trailer: the second face makes do with 1' + 8" + 6"`, () => {
    const r = runTool(tool('wall-forms'), { walls: [[25.5, 'oi']], fillers: [[14, 1], [12, null], [8, null], [6, null]] });
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.result.rows.find((x) => x.label === `Wall 1: 25' 6"`)!.note).toBe(`Out: 1' + 11 × 2' + 14" + 1'
In: 11 × 2' + 1' + 8" + 6"`);
    expect(rowValue(r, '14" fillers')).toBe('1');
    expect(r.result.warnings).toEqual([]);
  });

  test(`short on panels and 1' fillers shows up in the load list and a warning`, () => {
    const r = runTool(tool('wall-forms'), { walls: job, panelsOwned: 150, fillers: [[14, null], [12, 10], [8, null], [6, null]] });
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.result.rows.find((x) => x.label === `2' panels`)!.note).toBe('Short 42. You have 150.');
    expect(r.result.warnings?.[0]).toMatch(/^Short: 42 panels, \d+ × 1'\.$/);
  });

  test(`5' + 3' stacked: 8' wall, both heights listed, 6 ties per joint`, () => {
    const r = runTool(tool('wall-forms'), { walls: job, height1: 5, height2: 3 });
    expect(rowValue(r, 'Wall height')).toBe(`8'`);
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.result.rows.find((x) => x.label === `2' panels`)!.note).toBe(`192 × 5' + 192 × 3'`);
    expect(r.result.rows.find((x) => x.label === 'Ties')!.note).toBe('6 per joint (one every 16")');
    expect(rowValue(runTool(tool('wall-forms'), { walls: job, height1: 5 }), 'Wall height')).toBe(`5'`);
  });

  test('Clear keeps what you own', () => {
    const f = tool('wall-forms').fields;
    expect(f.filter((x) => x.sticky).map((x) => x.key)).toEqual(['fillers', 'panelsOwned', 'cornersOwned']);
  });

  test('staggered 8\' doubles every piece', () => {
    const r = runTool(tool('wall-forms'), { walls: job, height1: { ft: '5', in: '4' }, height2: { ft: '2', in: '8' } });
    expect(rowValue(r, `2' panels`)).toBe('384');
    expect(rowValue(r, 'Fillers')).toBe('40');
  });

  test('corners that don\'t close up get a warning; no walls asks for one', () => {
    const r = runTool(tool('wall-forms'), { walls: [[40, 'oo'], [30, 'oo'], [40, 'oo'], [30, 'oi']] });
    expect(r.status === 'ok' && r.result.warnings?.[0]).toMatch(/4 more outside corners/);
    expect(runTool(tool('wall-forms'), {}).status).toBe('missing');
  });
});

test('bag counts only on small pours (2 yd or less)', () => {
  expect(rowValue(runTool(tool('slab'), { areas: [[10, 10]] }), '80 lb bags')).toBe('62');
  expect(rowValue(runTool(tool('slab'), { areas: [[40, 30]] }), '80 lb bags')).toBeUndefined();
});

describe('slab bars sized for the slab, with a bar around the edge', () => {
  test('40 x 30, 4" slab, no footing bars: #4 at 18" and an edge bar 3" in all the way around', () => {
    const r = runTool(tool('slab'), { areas: [[40, 30]] as [number, number][], slabRebar: true });
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.result.rows.find((x) => x.label === 'Slab bars')!.note).toContain(`#4 at 18" both ways · sized for a 40' 0" long, 4" slab`);
    // 2 × (39.5 + 29.5) = 138 ft around, 4 corner L-bars
    expect(r.result.rows.find((x) => x.label === 'Edge bar')!.note).toMatch(/^1 #4 around the edge, 3" in · 4 corner L-bars/);
  });

  test('a 4" stoop 6 x 4: edge bar only', () => {
    const r = runTool(tool('slab'), { areas: [[6, 4]] as [number, number][], slabRebar: true });
    expect(rowValue(r, 'Slab bars')).toBe('Edge bar only');
    expect(rowValue(r, 'Edge bar')).toBeDefined();
  });

  test('footing bars all the way around are the edge bar', () => {
    const r = runTool(tool('slab'), { areas: [[40, 30]] as [number, number][], footing: true, slabRebar: true, footBars: true });
    expect(rowValue(r, 'Edge bar')).toBeUndefined();
  });
});

describe('rebar in footings and walls', () => {
  const note = (r: ReturnType<typeof runTool>, label: string) => (r.status === 'ok' ? r.result.rows.find((x) => x.label === label)?.note : undefined);
  test('100 ft footing around a building, 2 #4, 4 corners: like Beam & Footing Bars', () => {
    // Per bar: (100 − 1.667) ÷ (20 − 1.667) = 5.36 → 6 sticks, 5 laps → 108.33 ft; × 2 = 216.67 ft.
    // Corner L-bars: 4 corners × 2 bars = 8 × 3' 4" = 26.67 ft. Total 243.33 ft × 0.668 = 163 lb.
    const r = runTool(tool('footings'), { shape: 'run', length: 100, width: { ft: '', in: '20' } as never, depth: { ft: '', in: '10' } as never, bars: true, corners: 4 });
    expect(rowValue(r, 'Bars along it')).toBe('243.3 ft');
    expect(rowValue(r, 'Rebar weight')).toBe('163 lb');
    expect(rowValue(r, '#4 sticks')).toMatch(/^\d+ × 20'$/);
  });

  test('a stem wall with verticals every 24"', () => {
    // 20 ft straight run: verticals over 240 − 6 = 234" at 24" → 10 spaces → 11 bars, each 4' − 3" = 3' 9"
    const r = runTool(tool('footings'), { shape: 'run', length: 20, width: { ft: '', in: '8' } as never, depth: 4, bars: true, vSpacing: 24 });
    expect(rowValue(r, 'Verticals')).toBe(`11 × 3' 9"`);
  });

  test('Wall Forms: horizontals and verticals for a 30 × 20 foundation, 4 ft tall', () => {
    const r = runTool(tool('wall-forms'), { walls: [[30, 'oo'], [20, 'oo'], [30, 'oo'], [20, 'oo']], height1: 4, wallRebar: true });
    // 48" − 6" = 42" at 24" → 2 spaces → 3 rows. Centerline 100 − 4 × 8" = 97.33 ft → 1168" at 24" → 49 spaces → 50 + 4 corners = 54, each 3' 9"
    expect(note(r, 'Horizontal bars')).toMatch(/^3 rows of #4, 24" apart/);
    expect(rowValue(r, 'Vertical bars')).toBe(`54 × 3' 9"`);
    expect(rowValue(r, 'Rebar weight')).toMatch(/ lb$/);
  });
});

describe('Footings & Walls around a building', () => {
  test('square / rectangle: 30 × 40 outside, 8" × 8 ft wall → 140 ft around, 137.33 ft along the middle', () => {
    // 137.33 × 8/12 × 8 = 732.4 cu ft = 27.13 yd before waste
    const r = runTool(tool('footings'), { kind: 'wall', shape: 'rect', bLength: 40, bWidth: 30, depth: 8, width: { ft: '', in: '8' } as never });
    expect(rowValue(r, 'House, around the outside')).toBe('140 ft');
    expect(rowValue(r, 'Along the middle')).toBe('137.3 ft');
    expect(rowValue(r, 'Before waste')).toBe('27.13 cu yd');
  });

  test('odd shape, wall by wall: an L with one inside corner', () => {
    // 30 + 20 + 15 + 10 + 15 + 30... walls: outside 5 corners, inside 1 → middle = outside − 4 × t
    const r = runTool(tool('footings'), {
      kind: 'wall',
      shape: 'odd',
      walls: [[30, 'oo'], [20, 'oo'], [15, 'oi'], [10, 'oi'], [15, 'oo'], [30, 'oo']],
      depth: { ft: '', in: '10' } as never,
      width: { ft: '', in: '20' } as never,
    });
    expect(rowValue(r, 'House, around the outside')).toBe('120 ft');
    // 120 − 4 × 20" = 113.33
    expect(rowValue(r, 'Along the middle')).toBe('113.3 ft');
  });

  test('rebar around a rectangle gets its 4 corners on its own', () => {
    const r = runTool(tool('footings'), { shape: 'rect', bLength: 40, bWidth: 30, depth: { ft: '', in: '10' } as never, width: { ft: '', in: '20' } as never, bars: true });
    expect(rowValue(r, 'Bars along it')).toBeDefined();
    if (r.status === 'ok') expect(r.result.rows.find((x) => x.label === 'Bars along it')!.note).toContain('8 corner L-bars');
  });
});

test('a 70 × 70 footing is entered at the house size and runs centered under the 8" wall', () => {
  // House 280 ft around. Middle of the 8" wall: 280 − 4 × 8" = 277.33 ft, a few inches in from the edge.
  // 277.33 × 20" × 10" = 385.2 cu ft = 14.27 yd before waste
  const r = runTool(CONCRETE_TOOLS.find((t) => t.id === 'footings')!, {
    kind: 'footing',
    shape: 'rect',
    bLength: 70,
    bWidth: 70,
    wallOn: 8,
    width: { ft: '', in: '20' } as never,
    depth: { ft: '', in: '10' } as never,
  });
  expect(rowValue(r, 'House, around the outside')).toBe('280 ft');
  expect(rowValue(r, 'Along the middle')).toBe('277.3 ft');
  expect(rowValue(r, 'Before waste')).toBe('14.27 cu yd');
});

test('a shorter stretch of wall uses the shortest stack of your panels that reaches it', () => {
  // 4' + 4' setup
  expect(stackFor(96, [48, 48])).toEqual({ stack: [0, 1], short: false });
  expect(stackFor(48, [48, 48])).toEqual({ stack: [0], short: false });
  expect(stackFor(30, [48, 48])).toEqual({ stack: [0], short: false });
  // 5' + 3' setup: 3' wall on the 3', 4' on the 5', 6' needs both
  expect(stackFor(36, [60, 36])).toEqual({ stack: [1], short: false });
  expect(stackFor(48, [60, 36])).toEqual({ stack: [0], short: false });
  expect(stackFor(72, [60, 36])).toEqual({ stack: [0, 1], short: false });
  // Taller than the panels reach
  expect(stackFor(108, [60, 36])).toEqual({ stack: [0, 1], short: true });
});

describe('a 0 typed in a size box gets a note, not 0 yards', () => {
  const msg = (r: ReturnType<typeof runTool>) => (r.status === 'invalid' ? r.message : r.status);
  test('piers', () => {
    expect(msg(runTool(tool('piers'), { size: 0, height: 8, qty: 4 }))).toBe('Diameter and depth must be more than 0.');
    expect(msg(runTool(tool('piers'), { size: 1, height: 0, qty: 4 }))).toBe('Diameter and depth must be more than 0.');
    expect(msg(runTool(tool('piers'), { size: 1, height: 8, qty: 0 }))).toBe('How many must be at least 1.');
  });
  test('steps', () => {
    const base = { steps: 3, rise: { ft: '', in: '7' }, run: { ft: '', in: '11' }, width: 4 };
    expect(msg(runTool(tool('steps'), { ...base, steps: 0 }))).toBe('Enter at least 1 step.');
    expect(msg(runTool(tool('steps'), { ...base, width: 0 }))).toBe('Width must be more than 0.');
    expect(msg(runTool(tool('steps'), { ...base, rise: { ft: '0', in: '0' } }))).toBe('Rise and run must be more than 0.');
  });
  test('footings & walls, straight run', () => {
    const run = { shape: 'run', depth: { ft: '', in: '10' }, width: { ft: '', in: '20' } };
    expect(msg(runTool(tool('footings'), { ...run, length: 0 }))).toBe('Length must be more than 0.');
    expect(msg(runTool(tool('footings'), { ...run, length: 40, qty: 0 }))).toBe('How many must be at least 1.');
    // 40 ft of 20" × 10" = 40 × 1.6667 × 0.8333 = 55.56 cu ft = 2.06 cu yd
    expect(rowValue(runTool(tool('footings'), { ...run, length: 40 }), 'Before waste')).toBe('2.06 cu yd');
  });
});

describe('inches typed in the feet box get a yellow check, numbers unchanged', () => {
  const warns = (r: ReturnType<typeof runTool>) => (r.status === 'ok' ? r.result.warnings ?? [] : []);
  test('a 4 ft slab asks if you meant 4 inches; the answer still uses what was typed', () => {
    const r = runTool(tool('slab'), { areas: [[10, 10]], thick: 4 });
    expect(warns(r)).toContain('Thickness is 4 feet. Did you mean 4 inches? Inches go in the “in” box.');
    expect(rowValue(r, 'Before waste')).toBe('14.81 cu yd'); // 10 × 10 × 4 = 400 cu ft
    expect(warns(runTool(tool('slab'), { areas: [[10, 10]] }))).toEqual([]);
  });
  test('a 700 ft slab side is flagged', () => {
    expect(warns(runTool(tool('slab'), { areas: [[700, 30]] }))[0]).toMatch(/^Slab side is 700' 0"\. That’s bigger than usual/);
  });
  test('a 20 ft wide, 10 ft thick footing', () => {
    const r = runTool(tool('footings'), { shape: 'run', length: 40, width: 20, depth: 10 });
    expect(warns(r)).toEqual([
      'Footing width is 20 feet. Did you mean 20 inches? Inches go in the “in” box.',
      'Footing thickness is 10 feet. Did you mean 10 inches? Inches go in the “in” box.',
    ]);
    // An 8 ft wall is normal.
    expect(warns(runTool(tool('footings'), { kind: 'wall', shape: 'run', length: 40, width: { ft: '', in: '8' }, depth: 8 }))).toEqual([]);
  });
  test('a 12 ft pier and a 7 ft rise', () => {
    expect(warns(runTool(tool('piers'), { size: 12, height: 8 }))[0]).toMatch(/^Diameter is 12 feet\. Did you mean 12 inches\?/);
    expect(warns(runTool(tool('steps'), { steps: 3, rise: 7, run: { ft: '', in: '11' }, width: 4 }))[0]).toMatch(/^Rise is 7 feet/);
  });
});

test('the typo notes are told apart from the everyday ones (the screen shows them by the answer too)', () => {
  const r = runTool(tool('slab'), { areas: [[700, 30]], thick: 4, footing: true, fDepth: 2 });
  if (r.status !== 'ok') throw new Error(r.status);
  expect(r.result.warnings!.filter(isTooBig)).toHaveLength(2); // 4 ft thick, 700 ft side
  const everyday = r.result.warnings!.filter((w) => !isTooBig(w));
  expect(everyday.some((w) => /rarely dug even/.test(w))).toBe(true);
  expect(everyday.some((w) => /Did you mean|bigger than usual/.test(w))).toBe(false);
});

test('radius steps: half rounds off the main diameter, 2 treads smaller each step up', () => {
  const t = CONCRETE_TOOLS.find((x) => x.id === 'steps')!;
  const L = (ft: string, i = '') => ({ ft, in: i });
  const r = runTool(t, { shape: 'radius', steps: '3', rise: L('', '7'), run: L('1'), diameter: L('10'), waste: '0' });
  // 10', 8', 6' across.
  expect(rowValue(r, 'Step 1 (bottom)')).toBe(`10' 0" across`);
  expect(rowValue(r, 'Step 2')).toBe(`8' 0" across`);
  expect(rowValue(r, 'Step 3 (top)')).toBe(`6' 0" across`);
  // Each step solid to the ground: 7/12 × π/8 × (10² + 8² + 6²) = 45.81 cu ft = 1.70 cu yd.
  expect(rowValue(r, 'Cubic feet')).toBe('45.8');
  expect(rowValue(r, 'Cubic yards')).toBe('1.7');
  // Curved form: π/2 × (10 + 8 + 6) = 37.7 ft.
  expect(rowValue(r, 'Curved form')).toBe('37.7 ft');
  // Too many steps for the width is caught.
  expect(runTool(t, { shape: 'radius', steps: '6', rise: L('', '7'), run: L('1'), diameter: L('10') }).status).toBe('invalid');
  // Square steps work as before (and an old saved one with no shape opens as square).
  const sq = runTool(t, { steps: '4', rise: L('', '7'), run: L('', '11'), width: L('4'), waste: '10' });
  expect(rowValue(sq, 'Before waste')).toBe('0.79 cu yd');
});

test('round steps: full and quarter rounds off the main diameter, checked by hand', () => {
  const t = CONCRETE_TOOLS.find((x) => x.id === 'steps')!;
  const L = (ft: string, i = '') => ({ ft, in: i });
  const base = { steps: '3', rise: L('', '7'), run: L('1'), diameter: L('10'), waste: '0' };
  // Full: 7/12 × π/4 × (10² + 8² + 6²) = 91.63 cu ft; curved form π × 24 = 75.4 ft.
  const full = runTool(t, { ...base, shape: 'full' });
  expect(rowValue(full, 'Cubic feet')).toBe('91.6');
  expect(rowValue(full, 'Curved form')).toBe('75.4 ft');
  expect(rowValue(full, 'Step 3 (top)')).toBe(`6' 0" across`);
  // Quarter: 7/12 × π/16 × 200 = 22.91 cu ft; curved form π/4 × 24 = 18.8 ft; sizes as reach out from the corner.
  const q = runTool(t, { ...base, shape: 'quarter' });
  expect(rowValue(q, 'Cubic feet')).toBe('22.9');
  expect(rowValue(q, 'Curved form')).toBe('18.8 ft');
  expect(rowValue(q, 'Step 1 (bottom)')).toBe(`5' 0" out from the corner`);
  // The drawing, for each shape.
  const { radiusStepsSvg } = require('../../report/stepsDraw') as typeof import('../../report/stepsDraw');
  for (const kind of ['half', 'full', 'quarter'] as const) expect(radiusStepsSvg([10, 8, 6], 1, 'Front steps', kind)).toContain(`${kind.toUpperCase()} ROUND STEPS`);
});

test('100% waste (meant 10) gets a yellow check on every concrete tool; 10% does not', () => {
  const w = (r: ReturnType<typeof runTool>) => (r.status === 'ok' ? r.result.warnings ?? [] : ['not ok']);
  const note = 'Waste is 100%. Most crews add 5–15%. Check the number.';
  const r = runTool(tool('slab'), { areas: [[10, 10]], waste: 100 });
  expect(w(r)).toEqual([note]);
  expect(rowValue(r, 'Cubic yards')).toBe('2.47'); // 1.23 × 2, left as typed
  expect(w(runTool(tool('piers'), { size: 1, height: 8, waste: 100 }))).toEqual([note]);
  expect(w(runTool(tool('steps'), { steps: 3, rise: { ft: '', in: '7' }, run: { ft: '', in: '11' }, width: 4, waste: 100 }))).toEqual([note]);
  expect(w(runTool(tool('footings'), { shape: 'run', length: 40, depth: { ft: '', in: '10' }, width: { ft: '', in: '20' }, waste: 100 }))).toEqual([note]);
  expect(w(runTool(tool('slab'), { areas: [[10, 10]] }))).toEqual([]);
});

test('round steps: a 120 ft main diameter (meant 120") gets a yellow check; 10 ft does not', () => {
  const L = (ft: string, i = '') => ({ ft, in: i });
  const base = { shape: 'radius', steps: '3', rise: L('', '7'), run: L('1') };
  const w = (r: ReturnType<typeof runTool>) => (r.status === 'ok' ? r.result.warnings ?? [] : ['not ok']);
  expect(w(runTool(tool('steps'), { ...base, diameter: L('120') }))).toEqual([`Main diameter is 120' 0". That’s bigger than usual. Check the number.`]);
  expect(w(runTool(tool('steps'), { ...base, diameter: L('10') }))).toEqual([]);
});

test('a 100 yd truck (typo) gets a yellow check; 10 yd does not', () => {
  const r = runTool(tool('slab'), { areas: [[40, 30]], truck: 100 });
  expect(r.status === 'ok' && r.result.warnings).toEqual(['Truck size is 100 yd. A mixer truck carries about 8–12 yd. Check the number.']);
  expect(rowValue(r, 'Trucks')).toBe('1 truck'); // left as typed
  expect(runTool(tool('slab'), { areas: [[40, 30]], truck: 10 })).toMatchObject({ status: 'ok', result: { warnings: [] } });
});

test('Slab: picked bars 1.5" apart get the same yellow check', () => {
  const r = runTool(tool('slab'), { areas: [[12, 10]], slabRebar: true, pickBars: true, spacing: 1.5 });
  expect(r.status === 'ok' && r.result.warnings).toContain('Bars 1.5" apart is very tight. On center is in inches (18, not 1.5). Check the number.');
  const ok18 = runTool(tool('slab'), { areas: [[12, 10]], slabRebar: true, pickBars: true });
  expect(ok18.status === 'ok' && ok18.result.warnings?.some((w) => /very tight/.test(w))).toBe(false);
});
