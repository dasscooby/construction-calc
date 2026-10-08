import { REBAR_TOOLS } from '../rebarTools';
import { rowValue, runTool } from '../run';
import { Tool } from '../types';

const tool = (id: string): Tool => {
  const t = REBAR_TOOLS.find((x) => x.id === id);
  if (!t) throw new Error(`no tool ${id}`);
  return t;
};

const ok = (r: ReturnType<typeof runTool>) => {
  if (r.status !== 'ok') throw new Error(`${r.status}: ${r.message}`);
  return r.result;
};

const note = (r: ReturnType<typeof runTool>, label: string) => ok(r).rows.find((row) => row.label === label)?.note;

describe('the rebar tool list', () => {
  test('ids and order', () => {
    expect(REBAR_TOOLS.map((t) => t.id)).toEqual(['slab-rebar', 'beam-bars', 'stirrups', 'cut-list', 'rebar-weight', 'dowels', 'wire-mesh']);
  });

  test.each(REBAR_TOOLS.map((t) => [t.id, t] as const))('%s is well formed', (_id, t) => {
    const keys = t.fields.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z][a-zA-Z0-9]*$/);
    for (const f of t.fields) {
      if (f.kind === 'choice') expect(f.options.map((o) => o.value)).toContain(f.default);
    }
    expect(t.title).toBeTruthy();
    expect(t.blurb).toBeTruthy();
    expect(t.notes?.length).toBeGreaterThan(0);
  });

  test('plain trade words: no "bar diameters" anywhere on the screen', () => {
    for (const t of REBAR_TOOLS) {
      const text = JSON.stringify({ fields: t.fields, notes: t.notes, blurb: t.blurb });
      expect(text).not.toMatch(/diameters/i);
    }
  });
});

describe('slab-rebar', () => {
  const slab = tool('slab-rebar');

  test('worked example: 30 x 20 slab, #4 at 18" on center, 3" from edge, 20 ft sticks, lap blank', () => {
    // Lap = 40 × 1/2" = 20" (1.667 ft).
    // Long-way bars are spread across the width: (240" − 2 × 3") = 234" ÷ 18" = 13 spaces → 14 bars,
    //   each 30' − 2 × 3" = 29' 6". Longer than 20': (29.5 − 1.667) ÷ (20 − 1.667) = 1.52 → 2 sticks, 1 lap,
    //   so each run is 29.5 + 1.667 = 31.167 ft of steel.
    // Short-way bars are spread along the length: (360" − 6") = 354" ÷ 18" = 19.7 → 20 spaces → 21 bars,
    //   each 20' − 6" = 19' 6" (fits one stick, no lap).
    // Total = 14 × 31.167 + 21 × 19.5 = 436.33 + 409.5 = 845.83 ft.  Weight = 845.83 × 0.668 = 565 lb = 0.28 tons.
    // Sticks: 14 full sticks + 21 sticks for the 19.5' bars (6" scraps) + 14 sticks for the 11.17' end pieces
    //   (8.83' scraps, too short for anything else) = 49.
    // Edge bar, 3" in: 2 × (29.5 + 19.5) = 98 ft → (98 − 1.667) ÷ (20 − 1.667) = 5.25 → 6 sticks, 5 laps = 106.33 ft,
    //   + 4 corner L-bars 2 × 20" = 3' 4" = 13.33 ft → 119.67 ft. Sticks: 5 full + 1 for the 6.33' end, whose
    //   13.67' scrap holds the 4 corner bars = 6.
    // With the edge bar: 965.5 ft, 19 laps, 55 sticks (bare minimum 965.5 ÷ 20 = 48.3 → 49), 965.5 × 0.668 = 645 lb.
    const r = runTool(slab, { pickBars: true, length: 30, width: 20 });
    expect(rowValue(r, 'Bars long way')).toBe(`14 × 29' 6"`);
    expect(rowValue(r, 'Bars short way')).toBe(`21 × 19' 6"`);
    expect(note(r, 'Bars long way')).toBe('2 sticks lapped together');
    expect(note(r, 'Bars short way')).toBeUndefined();
    expect(rowValue(r, 'Lap')).toBe('20"');
    expect(rowValue(r, 'Edge bar')).toBe('119.7 ft');
    expect(note(r, 'Edge bar')).toBe(`1 #4 around the edge · 4 corner L-bars 3' 4" · 5 laps`);
    expect(rowValue(r, 'Number of laps')).toBe('19');
    expect(rowValue(r, 'Total footage')).toBe('965.5 ft');
    expect(rowValue(r, 'Sticks to order')).toBe(`55 × 20'`);
    expect(note(r, 'Sticks to order')).toBe('49 if you use the cut-offs');
    expect(rowValue(r, 'Weight')).toBe('645 lb');
    expect(note(r, 'Weight')).toBe('0.32 tons');
    expect(rowValue(r, 'Chairs')).toBeUndefined(); // chair spacing blank = no chairs
  });

  test('chairs every 4 ft', () => {
    // (29.5 ÷ 4 = 7.4 → 8 spaces → 9) × (19.5 ÷ 4 = 4.9 → 5 spaces → 6) = 54
    expect(rowValue(runTool(slab, { pickBars: true, length: 30, width: 20, chairSpacing: 4 }), 'Chairs')).toBe('54');
  });

  test('two mats', () => {
    const r = runTool(slab, { pickBars: true, length: 30, width: 20, layers: 2, chairSpacing: 4 });
    expect(rowValue(r, 'Bars long way')).toBe(`14 × 29' 6"`);
    expect(note(r, 'Bars long way')).toBe('Each mat, 2 sticks lapped together');
    // Two mats + one edge bar: 2 × 845.83 + 119.67 = 1,811.33 ft
    expect(rowValue(r, 'Number of laps')).toBe('33');
    expect(rowValue(r, 'Total footage')).toBe('1,811.3 ft');
    expect(rowValue(r, 'Sticks to order')).toBe(`104 × 20'`);
    expect(rowValue(r, 'Weight')).toBe('1,210 lb'); // 1811.33 × 0.668 = 1210.0
    expect(rowValue(r, 'Chairs')).toBe('108');
  });

  test('typed lap is used and shown', () => {
    // 30" lap = 2.5 ft: (29.5 − 2.5) ÷ (20 − 2.5) = 1.54 → 2 sticks → 32 ft per long-way run
    // Mat = 14 × 32 + 21 × 19.5 = 448 + 409.5 = 857.5 ft
    // Edge bar: (98 − 2.5) ÷ 17.5 = 5.46 → 6 sticks, 5 laps = 110.5 + 4 corner bars × 5' = 130.5 → 988 ft
    const r = runTool(slab, { pickBars: true, length: 30, width: 20, lap: 30 });
    expect(rowValue(r, 'Lap')).toBe('30"');
    expect(rowValue(r, 'Total footage')).toBe('988 ft');
  });

  test('runs shorter than one stick: no laps', () => {
    // 12 x 10 slab, #5 at 12": long way 114" ÷ 12 = 9.5 → 10 spaces → 11 bars × 11' 6";
    // short way 138" ÷ 12 = 11.5 → 12 spaces → 13 bars × 9' 6".  Total = 126.5 + 123.5 = 250 ft
    const r = runTool(slab, { pickBars: true, length: 12, width: 10, barSize: '5', spacing: 12 });
    expect(rowValue(r, 'Bars long way')).toBe(`11 × 11' 6"`);
    expect(rowValue(r, 'Bars short way')).toBe(`13 × 9' 6"`);
    expect(rowValue(r, 'Lap')).toBe('25"');
    // Mat 250 ft, no laps. Edge bar, 3" in: 2 × (11.5 + 9.5) = 42 ft, 25" laps → (42 − 2.083) ÷ 17.917 = 2.2 → 3 sticks,
    //   2 laps = 46.17 ft + 4 corner bars × 4' 2" = 16.67 → 62.83 ft.  Total 312.8 ft × 1.043 = 326 lb.
    expect(rowValue(r, 'Number of laps')).toBe('2');
    expect(rowValue(r, 'Total footage')).toBe('312.8 ft');
    expect(rowValue(r, 'Sticks to order')).toBe(`22 × 20'`);
    expect(rowValue(r, 'Weight')).toBe('326 lb');
  });

  test('40 ft sticks', () => {
    // No laps; 14 × 29.5' (10.5' scraps) + 21 × 19.5' (2 per stick → 11) = 25 sticks
    const r = runTool(slab, { pickBars: true, length: 30, width: 20, stockLength: '40' });
    // Edge bar: 98 ft in 40' sticks → 3 sticks, 2 laps = 101.33 + 4 corner bars × 3' 4" = 114.67 → 937.2 ft
    expect(rowValue(r, 'Number of laps')).toBe('2');
    expect(rowValue(r, 'Total footage')).toBe('937.2 ft');
    expect(rowValue(r, 'Sticks to order')).toBe(`28 × 40'`);
    expect(note(r, 'Sticks to order')).toBe('24 if you use the cut-offs');
  });

  test('sized for me: 4" slab 30\' long → #4 at 18" + edge bar; a 4" pad 8\' long → edge bar only', () => {
    const big = runTool(slab, { length: 30, width: 20 });
    expect(rowValue(big, 'Bars long way')).toBe(`14 × 29' 6"`);
    expect(note(big, 'Bars long way')).toContain(`Sized for a 30' 0" long, 4" slab: #4 at 18"`);
    const pad = runTool(slab, { length: 8, width: 4 });
    expect(rowValue(pad, 'Bars both ways')).toBe('Edge bar only');
    expect(rowValue(pad, 'Edge bar')).toBeDefined();
    expect(rowValue(pad, 'Bars long way')).toBeUndefined();
  });

  test('errors', () => {
    expect(runTool(slab, { pickBars: true })).toEqual({ status: 'missing', message: 'Enter length' });
    expect(runTool(slab, { pickBars: true, length: 30, width: 20, lap: 240 })).toEqual({ status: 'invalid', message: `The lap must be shorter than a 20' stick.` });
    expect(runTool(slab, { pickBars: true, length: 0.5, width: 20 }).status).toBe('invalid'); // 6" slab, 3" from each edge
    expect(runTool(slab, { pickBars: true, length: 30, width: 20, cover: 120 }).status).toBe('invalid');
    expect(runTool(slab, { pickBars: true, length: 30, width: 20, spacing: 0 })).toEqual({ status: 'invalid', message: 'On center must be more than 0.' });
    expect(runTool(slab, { pickBars: true, length: 30, width: 20, layers: 0 })).toEqual({ status: 'invalid', message: 'Mats must be at least 1.' });
    expect(runTool(slab, { pickBars: true, length: 30, width: 20, chairSpacing: 0 }).status).toBe('invalid');
  });
});

describe('beam-bars', () => {
  const beam = tool('beam-bars');

  test('worked example: 100 ft perimeter, 4 #5 bars, 20 ft sticks, lap blank, 4 corners', () => {
    // Lap = 40 × 5/8" = 25" (2.083 ft).
    // Sticks per line: (100 − 2.083) ÷ (20 − 2.083) = 5.47 → 6, 5 laps → 100 + 5 × 2.083 = 110.42 ft
    // 4 lines → 441.67 ft, 20 laps.
    // Corner bars: 4 corners × 4 bars = 16, each 2 × 25" = 50" = 4' 2" → 66.67 ft.  Total 508.33 ft.
    // Sticks: 20 full + 4 for the 10.42' end pieces (their 9.58' scraps hold 2 corner bars each = 8)
    //   + 2 for the other 8 corner bars (4 per stick) = 26.   Weight = 508.33 × 1.043 = 530 lb.
    const r = runTool(beam, { run: 100, corners: 4 });
    expect(rowValue(r, 'Lap')).toBe('25"');
    expect(rowValue(r, 'Number of laps')).toBe('20');
    expect(rowValue(r, 'Corner bars')).toBe(`16 × 4' 2"`);
    expect(note(r, 'Corner bars')).toBe('L-bars, 25" each leg');
    expect(rowValue(r, 'Total footage')).toBe('508.3 ft');
    expect(rowValue(r, 'Sticks to order')).toBe(`26 × 20'`);
    expect(note(r, 'Sticks to order')).toBeUndefined(); // 508.33 ÷ 20 = 25.4 → 26 either way
    expect(rowValue(r, 'Weight')).toBe('530 lb');
    expect(note(r, 'Weight')).toBe('0.27 tons');
  });

  // Garage thickened edge: 96 ft around, 2 #4, 4 corners, 20' sticks, 20" lap.
  //   per bar  (96 − 1.667) ÷ (20 − 1.667) = 5.15 → 6 sticks, 5 laps → 96 + 5 × 1.667 = 104.33 ft
  //   2 bars   208.67 ft, 10 laps;  corner L-bars 4 × 2 = 8 × 40" (3' 4") = 26.67 ft  → 235.33 ft
  //   sticks   10 full + two 4.33' ends + eight 3.33' L-bars (5 fit in one stick, 3 + the ends in another) = 12
  //   weight   235.33 × 0.668 = 157 lb
  test('garage thickened edge: 96 ft, 2 #4, 4 corners', () => {
    const r = runTool(beam, { run: 96, bars: 2, barSize: '4', corners: 4 });
    expect(rowValue(r, 'Number of laps')).toBe('10');
    expect(rowValue(r, 'Corner bars')).toBe(`8 × 3' 4"`);
    expect(rowValue(r, 'Total footage')).toBe('235.3 ft');
    expect(rowValue(r, 'Sticks to order')).toBe(`12 × 20'`);
    expect(rowValue(r, 'Weight')).toBe('157 lb');
  });

  test('corners blank = no corner bars', () => {
    const r = runTool(beam, { run: 100 });
    expect(rowValue(r, 'Corner bars')).toBeUndefined();
    expect(rowValue(r, 'Total footage')).toBe('441.7 ft');
    // 20 full sticks + four 10.42' end pieces, one per stick = 24
    expect(rowValue(r, 'Sticks to order')).toBe(`24 × 20'`);
    expect(note(r, 'Sticks to order')).toBe('23 if you use the cut-offs'); // 441.67 ÷ 20 = 22.1
  });

  test('length shorter than one stick', () => {
    // 4 × 15' = 60 ft, no laps, one 15' piece per stick
    const r = runTool(beam, { run: 15 });
    expect(rowValue(r, 'Number of laps')).toBe('0');
    expect(rowValue(r, 'Total footage')).toBe('60 ft');
    expect(rowValue(r, 'Sticks to order')).toBe(`4 × 20'`);
    expect(rowValue(r, 'Weight')).toBe('62.6 lb'); // 60 × 1.043 = 62.58
  });

  test('typed lap and 60 ft sticks', () => {
    // 2 #4 bars, 36" lap: (130 − 3) ÷ (60 − 3) = 2.23 → 3 sticks, 2 laps → 136 ft per line → 272 ft
    const r = runTool(beam, { run: 130, bars: 2, barSize: '4', stockLength: '60', lap: 36 });
    expect(rowValue(r, 'Lap')).toBe('36"');
    expect(rowValue(r, 'Number of laps')).toBe('4');
    expect(rowValue(r, 'Total footage')).toBe('272 ft');
    // 4 full 60' sticks + two 16' end pieces (3 per stick → 1 stick) = 5
    expect(rowValue(r, 'Sticks to order')).toBe(`5 × 60'`);
  });

  test('errors', () => {
    expect(runTool(beam, {})).toEqual({ status: 'missing', message: 'Enter length' });
    expect(runTool(beam, { run: 100, lap: 300 })).toEqual({ status: 'invalid', message: `The lap must be shorter than a 20' stick.` });
    expect(runTool(beam, { run: 100, bars: 0 }).status).toBe('invalid');
    expect(runTool(beam, { run: 0 }).status).toBe('invalid');
    expect(runTool(beam, { run: 100, corners: 4, lap: 0 }).status).toBe('invalid'); // corner bars need a lap
    expect(runTool(beam, { run: 100, corners: 4, lap: 130 }).status).toBe('invalid'); // 2 × 130" > 20'
    expect(runTool(beam, { run: 100, lap: 0 }).status).toBe('ok'); // butt joints, no corners: allowed
  });
});

describe('stirrups', () => {
  const ties = tool('stirrups');

  test('worked example: 20 ft, 24" on center, 12 x 24 beam, 1-1/2" clear, #3, 135° hooks', () => {
    // Count: 240" ÷ 24" = 10 spaces → 11 stirrups.
    // Stirrup outside: 12 − 3 = 9" by 24 − 3 = 21".  Hook = 6 × 3/8" = 2.25" → 3" minimum (ACI 318-19 Table 25.3.2).
    // Cut length = 2 × 9 + 2 × 21 + 2 × 3 = 66" = 5' 6".   Total = 11 × 5.5 = 60.5 ft.
    // 240" ÷ 66" = 3.6 → 3 per 20' stick → 11 ÷ 3 = 3.7 → 4 sticks.  Weight = 60.5 × 0.376 = 22.7 lb.
    const r = runTool(ties, { run: 20, width: 12, depth: 24 });
    expect(rowValue(r, 'Stirrups')).toBe('11');
    expect(rowValue(r, 'Cut length')).toBe(`5' 6"`);
    expect(note(r, 'Cut length')).toBe('9" × 21" with two 3" hooks');
    expect(rowValue(r, 'Total footage')).toBe('60.5 ft');
    expect(rowValue(r, 'Sticks to order')).toBe(`4 × 20'`);
    expect(note(r, 'Sticks to order')).toBe('3 stirrups per stick');
    expect(rowValue(r, 'Weight')).toBe('22.7 lb');
  });

  test('#5 with 90° hooks', () => {
    // 30 ft at 18": 360 ÷ 18 = 20 spaces → 21 stirrups.  16 x 30 beam, 2" clear → 12" × 26".
    // Hook = 6 × 5/8" = 3.75".  Cut = 24 + 52 + 7.5 = 83.5" = 6' 11-1/2".  Total = 21 × 83.5 ÷ 12 = 146.1 ft.
    // 240 ÷ 83.5 = 2.9 → 2 per stick → 11 sticks.  Weight = 146.125 × 1.043 = 152 lb.
    const r = runTool(ties, { run: 30, spacing: 18, width: 16, depth: 30, cover: 2, barSize: '5', hook: '90' });
    expect(rowValue(r, 'Stirrups')).toBe('21');
    expect(rowValue(r, 'Cut length')).toBe(`6' 11-1/2"`);
    expect(note(r, 'Cut length')).toBe('12" × 26" with two 3-3/4" hooks');
    expect(rowValue(r, 'Total footage')).toBe('146.1 ft');
    expect(rowValue(r, 'Sticks to order')).toBe(`11 × 20'`);
    expect(rowValue(r, 'Weight')).toBe('152 lb');
  });

  test('on center that does not divide evenly rounds the count up', () => {
    // 21 ft at 24": 252 ÷ 24 = 10.5 → 11 spaces → 12 stirrups
    expect(rowValue(runTool(ties, { run: 21, width: 12, depth: 24 }), 'Stirrups')).toBe('12');
  });

  test('errors', () => {
    expect(runTool(ties, { run: 20 })).toEqual({ status: 'missing', message: 'Enter beam width' });
    expect(runTool(ties, { run: 20, width: 3, depth: 24 }).status).toBe('invalid'); // 3" wide, 1.5" clear each side
    expect(runTool(ties, { run: 20, width: 1, depth: 2 })).toEqual({ status: 'invalid', message: 'The cover leaves no room for a stirrup. Beam width and depth are in inches (12, not 1).' });
    expect(runTool(ties, { run: 20, width: 12, depth: 24, cover: 13 })).toEqual({ status: 'invalid', message: 'The cover leaves no room for a stirrup.' });
    expect(runTool(ties, { run: 20, width: 12, depth: 24, spacing: 0 }).status).toBe('invalid');
    expect(runTool(ties, { run: 0, width: 12, depth: 24 }).status).toBe('invalid');
    expect(runTool(ties, { run: 20, width: 60, depth: 72 }).status).toBe('invalid'); // stirrup longer than 20'
  });
});

describe('rebar-weight', () => {
  const rw = tool('rebar-weight');

  test('worked example: ten 20 ft #5 bars', () => {
    // 10 × 20 = 200 ft × 1.043 lb/ft = 208.6 lb = 0.10 tons
    // Laps 40 × 5/8" = 25", 48 × = 30", 60 × = 37.5"
    // ACI 318-19 Table 25.3.1: 90° hook 12 × 0.625 = 7.5"; 180° hook 4 × 0.625 = 2.5" (2.5" minimum);
    // inside bend 6 × 0.625 = 3.75"
    const r = runTool(rw, { barSize: '5', count: 10, lengthEach: 20 });
    expect(rowValue(r, 'Total footage')).toBe('200 ft');
    expect(rowValue(r, 'Weight')).toBe('209 lb');
    expect(note(r, 'Weight')).toBe('0.1 tons');
    expect(rowValue(r, 'Bar thickness')).toBe('5/8"');
    expect(rowValue(r, 'Weight per foot')).toBe('1.043 lb');
    expect(rowValue(r, 'Common laps')).toBe('25" · 30" · 37-1/2"');
    expect(note(r, 'Common laps')).toBe('40, 48 and 60 times the bar size. Your plans say which.');
    expect(rowValue(r, '90° hook leg')).toBe('7-1/2"');
    expect(rowValue(r, '180° hook leg')).toBe('2-1/2"');
    expect(rowValue(r, 'Smallest bend')).toBe('3-3/4"');
  });

  test('defaults: one 20 ft #4 bar', () => {
    const r = runTool(rw, {});
    expect(rowValue(r, 'Total footage')).toBe('20 ft');
    expect(rowValue(r, 'Weight')).toBe('13.4 lb'); // 20 × 0.668 = 13.36
    expect(rowValue(r, 'Common laps')).toBe('20" · 24" · 30"');
    expect(rowValue(r, '180° hook leg')).toBe('2-1/2"'); // 4 × 0.5 = 2" → 2.5" minimum
  });

  test('#9: odd sizes are rounded UP to the next 1/8"', () => {
    // 40 × 1.128 = 45.12 → 45-1/8";  48 × = 54.14 → 54-1/4";  60 × = 67.68 → 67-3/4"
    // 12 × 1.128 = 13.54 → 13-5/8";  4 × = 4.51 → 4-5/8";  8 × = 9.02 → 9-1/8"
    const r = runTool(rw, { barSize: '9', lengthEach: { ft: '1', in: '' } });
    expect(rowValue(r, 'Bar thickness')).toBe('1.128"');
    expect(rowValue(r, 'Weight')).toBe('3.4 lb');
    expect(rowValue(r, 'Common laps')).toBe('45-1/8" · 54-1/4" · 67-3/4"');
    expect(rowValue(r, '90° hook leg')).toBe('13-5/8"');
    expect(rowValue(r, '180° hook leg')).toBe('4-5/8"');
    expect(rowValue(r, 'Smallest bend')).toBe('9-1/8"');
  });

  test('#11 and #3', () => {
    const r11 = runTool(rw, { barSize: '11', count: 2, lengthEach: 60 });
    expect(rowValue(r11, 'Weight')).toBe('638 lb'); // 120 × 5.313 = 637.6
    expect(rowValue(r11, 'Common laps')).toBe('56-1/2" · 67-3/4" · 84-5/8"'); // 56.4, 67.68, 84.6
    expect(rowValue(r11, 'Smallest bend')).toBe('11-3/8"'); // 8 × 1.41 = 11.28
    const r3 = runTool(rw, { barSize: '3', count: 1, lengthEach: 1 });
    expect(rowValue(r3, 'Weight')).toBe('0.38 lb');
    expect(rowValue(r3, '90° hook leg')).toBe('4-1/2"');
    expect(rowValue(r3, 'Common laps')).toBe('15" · 18" · 22-1/2"');
  });

  test('blank length or bad count', () => {
    expect(runTool(rw, { lengthEach: { ft: '', in: '' } })).toEqual({ status: 'missing', message: 'Enter length each' });
    expect(runTool(rw, { count: '2.5' }).status).toBe('invalid');
    expect(runTool(rw, { count: 0 })).toEqual({ status: 'invalid', message: 'How many must be at least 1.' });
    expect(runTool(rw, { lengthEach: 0 })).toEqual({ status: 'invalid', message: 'Length each must be more than 0.' });
  });
});

describe('dowels', () => {
  const dw = tool('dowels');

  test('worked example: 30 ft wall, 6 ft on center, 12" from the ends', () => {
    // (30 − 2 × 1) ÷ 6 = 4.67 → 5 spaces → 6 bolts, 28 ÷ 5 = 5.6 ft = 5' 7-3/16" apart
    const r = runTool(dw, { wallLength: 30 });
    expect(rowValue(r, 'Per wall')).toBe('6');
    expect(rowValue(r, 'Total')).toBe('6');
    expect(rowValue(r, 'Actual spacing')).toBe(`5' 7-3/16"`);
    expect(rowValue(r, 'Dowel footage')).toBeUndefined(); // no dowel length = bolts only
    expect(ok(r).warnings).toEqual([]);
  });

  test('four walls with 2-1/2 ft #4 dowels', () => {
    // 6 × 4 = 24 dowels × 2.5 ft = 60 ft; 8 per 20' stick → 3 sticks; 60 × 0.668 = 40.1 lb
    const r = runTool(dw, { wallLength: 30, walls: 4, dowelLength: { ft: '2', in: '6' } });
    expect(rowValue(r, 'Total')).toBe('24');
    expect(rowValue(r, 'Dowel footage')).toBe('60 ft');
    expect(rowValue(r, 'Sticks to order')).toBe(`3 × 20'`);
    expect(note(r, 'Sticks to order')).toBe('8 dowels per stick');
    expect(rowValue(r, 'Dowel weight')).toBe('40.1 lb');
  });

  test('short wall still gets 2', () => {
    const r = runTool(dw, { wallLength: { ft: '1', in: '6' } });
    expect(rowValue(r, 'Per wall')).toBe('2');
    expect(rowValue(r, 'Actual spacing')).toBeUndefined();
  });

  test('exact multiple of the on center', () => {
    // 26' wall: 24 ÷ 6 = 4 spaces exactly → 5 bolts, 6' 0" apart
    const r = runTool(dw, { wallLength: 26 });
    expect(rowValue(r, 'Per wall')).toBe('5');
    expect(rowValue(r, 'Actual spacing')).toBe(`6' 0"`);
  });

  test('anchor bolt code warnings', () => {
    expect(ok(runTool(dw, { wallLength: 30, spacing: 8 })).warnings).toEqual(['Anchor bolts: code max is 6 ft on center.']);
    expect(ok(runTool(dw, { wallLength: 30, endDistance: 18 })).warnings?.[0]).toMatch(/within 12"/);
    expect(ok(runTool(dw, { wallLength: 30, endDistance: 2 })).warnings?.[0]).toMatch(/3-1\/2"/);
  });

  test('errors', () => {
    expect(runTool(dw, {})).toEqual({ status: 'missing', message: 'Enter wall length' });
    expect(runTool(dw, { wallLength: 30, spacing: { ft: '0', in: '' } }).status).toBe('invalid');
    expect(runTool(dw, { wallLength: 30, walls: 0 }).status).toBe('invalid');
    expect(runTool(dw, { wallLength: 30, dowelLength: 25 }).status).toBe('invalid'); // longer than a 20' stick
  });
});

describe('wire-mesh', () => {
  const mesh = tool('wire-mesh');

  test('worked example: 30 x 40 slab with 5 x 10 sheets, 6" overlap', () => {
    // Each sheet covers (5 − 0.5) × (10 − 0.5) = 4.5 × 9.5 = 42.75 sq ft; 1200 ÷ 42.75 = 28.07 → 29 sheets
    const r = runTool(mesh, { areas: [[30, 40]] });
    expect(rowValue(r, 'Area')).toBe('1,200 sq ft');
    expect(rowValue(r, 'Sheets')).toBe('29');
    expect(note(r, 'Sheets')).toBe('Each covers 42.8 sq ft after overlap');
  });

  test('rolls and big sheets', () => {
    // 5 x 150 roll: 4.5 × 149.5 = 672.75 → 1200 ÷ 672.75 = 1.78 → 2 rolls
    const roll = runTool(mesh, { areas: [[30, 40]], product: '5x150' });
    expect(rowValue(roll, 'Rolls')).toBe('2');
    expect(note(roll, 'Rolls')).toBe('Each covers 672.8 sq ft after overlap');
    // 8 x 20 sheet: 7.5 × 19.5 = 146.25 → 8.2 → 9 sheets
    expect(rowValue(runTool(mesh, { areas: [[30, 40]], product: '8x20' }), 'Sheets')).toBe('9');
  });

  test('several areas, no overlap', () => {
    // 20 × 10 + 10 × 10 = 300 sq ft; 5 × 10 = 50 each → exactly 6 sheets
    const r = runTool(mesh, { areas: [[20, 10], [10, 10]], overlap: 0 });
    expect(rowValue(r, 'Area')).toBe('300 sq ft');
    expect(rowValue(r, 'Sheets')).toBe('6');
  });

  test('errors', () => {
    expect(runTool(mesh, {})).toEqual({ status: 'missing', message: 'Enter slab size' });
    expect(runTool(mesh, { areas: [[30, 40]], overlap: 60 })).toEqual({ status: 'invalid', message: `The overlap must be less than 5'.` });
    expect(runTool(mesh, { areas: [[0, 40]] }).status).toBe('invalid');
  });
});

describe('inches typed in the feet box', () => {
  test('a 4 ft slab asks if you meant 4 inches; a 4" slab says nothing', () => {
    expect(ok(runTool(tool('slab-rebar'), { length: 30, width: 20, thick: 4 })).warnings).toEqual([
      'Slab thickness is 4 feet. Did you mean 4 inches? Inches go in the “in” box.',
    ]);
    expect(ok(runTool(tool('slab-rebar'), { length: 30, width: 20 })).warnings).toEqual([]);
    expect(ok(runTool(tool('slab-rebar'), { length: 8, width: 4 })).warnings).toEqual([]); // edge bar only
  });
});
