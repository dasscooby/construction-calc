import { fillerSet, layoutFace } from '../concreteTools';
import { belledPierCuFt, bellHeightFt, perimeterBeamCenterline, truckLoads } from '../../lib/concrete';
import { CONCRETE_TOOLS } from '../concreteTools';
import { migrateItem } from '..';
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
    expect(bars.note).toContain('each end bent down 19"');
    // 49 bars × 2 ends × 19" = 155.17 ft more steel than not bending
    const flat = runTool(tool('slab'), { ...mono, edgeTie: 'none' });
    const ft = (x: ReturnType<typeof runTool>) => (x.status === 'ok' ? Number(x.result.rows.find((y) => y.label === 'Slab bars')!.value.replace(/[^\d.]/g, '')) : 0);
    expect(ft(r) - ft(flat)).toBeGreaterThan(155);
  });

  test('footing bars: 3 #4 around with an L-bar per bar at each of the 4 corners', () => {
    const r = runTool(tool('slab'), mono);
    if (r.status !== 'ok') throw new Error(r.status);
    const fb = r.result.rows.find((x) => x.label === 'Footing bars')!;
    expect(fb.note).toContain('3 #4 bars around');
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

describe('old Slab + Beams calculations', () => {
  test('open as a Slab with the footing switched on', () => {
    const m = migrateItem('slab-beams', { areas: [], pWidth: { ft: '', in: '12' }, pDepth: { ft: '2', in: '' }, perim: '', interior: '60' });
    expect(m.toolId).toBe('slab');
    expect(m.raw).toMatchObject({ footing: '1', fWidth: { ft: '', in: '12' }, fDepth: { ft: '2', in: '' }, interior: '1', iLength: '60' });
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
