jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import type { Job } from '../../lib/jobs';
import { DEFAULT_SETTINGS } from '../../lib/settings';
import { bidOptions } from '../bidOptions';
import { scopeOfWork, suggestLines } from '../billing';
import { buildLayout, LayoutSpec } from '../foundationLayout';
import { LAYOUT_TOOL_ID, LayoutRaw } from '../layoutItems';
import { dropPieceSteel, gridBars, layoutSteel, noSteelWarning, NO_SLAB_STEEL, withRebar } from '../layoutRebar';
import { figureItems, jobTotals, layoutItemDrawings } from '../report';

// Test 4 (the real job): 70 × 70 house, a 70 × 40 add-on off the back with two inside walls 10' clear
// from each side, 8" × 44" walls on a 16" × 10" footing, 4" slabs, 2" ledge.
const spec: LayoutSpec = {
  house: { length: 70, width: 70 },
  wall: { thick: 8 / 12, height: 44 / 12 },
  footing: { width: 16 / 12, depth: 10 / 12 },
  addOns: [{ side: 'top', width: 70, depth: 40, bays: [10, null, 10] }],
  slabs: [{ at: { in: 'main' }, thick: 4 / 12 }, { at: { in: 'addon', addOn: 0, bay: 1 }, thick: 4 / 12 }],
  ledgeIn: 2,
};
const job = (raw: LayoutRaw): Job => ({ id: 'j', name: 'Test 4', address: '', notes: '', createdAt: 0, items: [{ id: 'L', toolId: LAYOUT_TOOL_ID, title: 'Foundation layout', label: '', raw: raw as never, at: 0 }] });
const rows = (j: Job, id: string) => {
  const f = figureItems(j).find((x) => x.item.id === id)!;
  if (f.result.status !== 'ok') throw new Error(id);
  return f.result.result.rows;
};
const row = (j: Job, id: string, label: string) => rows(j, id).find((r) => r.label === label);

describe('Test 4 rebar and bolts, by hand', () => {
  const s = withRebar(spec);
  const l = buildLayout(s);
  const st = layoutSteel(l, s.rebar!);

  test('the layout is the one he measured', () => {
    expect(l.totals.measured).toBe(510);
    expect(Math.round(l.slabs[0].face.clearArea)).toBe(4715); // 68'-8" × 68'-8"
    expect(Math.round(l.slabs[1].face.clearArea)).toBe(1862); // 47'-4" × 39'-4"
  });

  test('footing: (2) #4, 20 L-bars, 50 laps, 1,155.3 ft, 58 sticks, 772 lb', () => {
    // Per bar line, along each footing (free ends none; the house sides carry straight on into the
    // add-on sides, half a lap each): 75'2" + 73' + 75'2" + 74'4" + 2 × 44'2" + 74'4" + 2 × 42' = 544'4",
    // laps included (23 per line). 4 corners + 6 tees = 10 bends × 2 bars = 20 L-bars of 3'4".
    expect(st.footing!.rows[0]).toMatchObject({ label: 'Footing bars', value: '1,155.3 ft' });
    expect(st.footing!.rows[0].note).toContain('20 corner and tee L-bars');
    expect(st.footing!.rows[0].note).toContain('50 laps of 20"');
    // 46 full sticks in the laps, + 12 cut: 4 × 15'2", 4 × 14'4", 2 × 13' (their offcuts take the 4'2"s,
    // the 2's and 8 of the L-bars), 12 more L-bars, 6 to a stick.
    expect([...st.footing!.sticks]).toEqual([[4, 58]]);
    expect(st.footing!.lb).toBeCloseTo(1155.333 * 0.668, 1);
  });

  test('walls: 222 + 46 verticals 4\'5", 3 rows of horizontals', () => {
    // Cut: 5" hook + 7" down the footing (3" off the bottom) + 41" up the wall (3" below the top) = 53".
    expect(st.vertCutFt * 12).toBeCloseTo(53, 6);
    // Outside: between the ends at 24", 34 on each 70' wall (5), 19 on each add-on side = 208; 2 at each of
    // 4 corners and 2 tees, 1 at each of the 2 joints where the house sides run on = 14. 222.
    expect(st.walls!.rows.find((r) => r.label === 'Vertical bars')!.value).toBe(`222 × 4' 5"`);
    // Inside: 19 on each, 2 at each of 4 tees. 46.
    expect(st.walls!.rows.find((r) => r.label === 'Inside walls: Vertical bars')!.value).toBe(`46 × 4' 5"`);
    expect(st.rows).toBe(3); // 44" wall, 24" apart: 38" ÷ 24 → 2 spaces, 3 rows
    expect(st.walls!.rows.find((r) => r.label === 'Horizontal bars')!.note).toContain('18 corner and tee L-bars');
    expect(st.walls!.rows.find((r) => r.label === 'Inside walls: Horizontal bars')!.note).toContain('12 corner and tee L-bars');
  });

  test('anchor bolts: 101, run by run', () => {
    // 6' max, 12" from every corner, end and break, 2 at least per piece of plate:
    //   house sides 69'8" → 13 each, front 70' → 13, back 68'8" broken by the 2 inside walls (10' + 47'4" + 10')
    //   → 3 + 9 + 3 = 15, far wall the same 15, add-on sides 40'4" → 8, inside walls 39'4" → 8.
    expect(st.bolts.runs.map((b) => b.count)).toEqual([13, 15, 13, 13, 8, 15, 8, 8, 8]);
    expect(st.bolts.total).toBe(101);
  });

  test('slabs: #4 @ 18" both ways', () => {
    // Slab 1: 47 bars each way, 68'2" each with 3 laps (73'2"), 94 × 73'2" = 6,877.7 ft; sticks 282 + 94.
    const s1 = st.slabs.get(1)!;
    expect(s1.rows[0]).toMatchObject({ label: 'Slab bars', value: '6,877.7 ft' });
    expect(s1.rows[0].note).toContain('94 bars · 282 laps');
    expect([...s1.sticks]).toEqual([[4, 376]]);
    expect(Math.round(s1.lb)).toBe(4594);
    expect(s1.rows.find((r) => r.label === 'Chairs')!.value).toBe('524'); // 4,715 sq ft ÷ 9
    // Slab 2: 27 bars the long way (46'10"), 33 the short way (38'10").
    const s2 = st.slabs.get(2)!;
    expect(s2.rows[0].note).toContain('60 bars');
    expect(gridBars(l.slabs[1].face.clear, 18).lengths.length).toBe(60);
    expect(Math.round(s2.lb)).toBe(1834);
  });

  test('in the job: totals, bill, bid, scope, plan', () => {
    const j = job({ layout: s });
    const t = jobTotals(figureItems(j), j);
    expect(t.bolts).toBe(101);
    expect(t.sticks.get(`#4 20' sticks`)).toBe(58 + 155 + 376 + 147);
    expect(Math.round(t.rebarLb)).toBe(772 + 1952 + 4594 + 1834);
    const prices = { ...DEFAULT_SETTINGS, prices: { ...DEFAULT_SETTINGS.prices, boltEa: '4.50', rebarLb: '1.10' } };
    const lines = suggestLines(figureItems(j), prices, j);
    expect(lines.find((x) => x.src === 'item:L:walls:bolts')).toMatchObject({ qty: '101', unit: 'ea', price: '4.5' });
    expect(lines.filter((x) => /:rebar$/.test(x.src ?? '')).map((x) => x.qty)).toEqual(['1952', '772', '4594', '1834']);
    expect(bidOptions(figureItems(j), prices, j).some((o) => o.src === 'item:L:walls:bolts')).toBe(true);
    expect(scopeOfWork(figureItems(j), j).find(([k]) => k === 'Anchor bolts')![1]).toMatch(/^101: 1\/2" × 10" J-bolt/);
    const plan = layoutItemDrawings(j, figureItems(j))!.plan!;
    expect(plan.match(/stroke="#b5371a"/g)!.length).toBe(101 + 1); // a tick at each, and the legend's
    expect(plan).toContain('101 TOTAL');
  });
});

describe('nothing added on its own', () => {
  test('an old layout opens the same, and says it has no rebar yet', () => {
    const j = job({ layout: spec });
    expect(rows(j, 'L:walls').some((r) => /bars|sticks|bolts|weight/i.test(r.label))).toBe(false);
    expect(jobTotals(figureItems(j), j).rebarLb).toBe(0);
    expect(noSteelWarning(buildLayout(spec))).toBe('No rebar yet · Add rebar & bolts');
    expect(noSteelWarning(buildLayout({ ...spec, rebarWarnOff: true }))).toBe('');
  });

  test('old wall boxes still figure their way until rebar is added, then carry over', () => {
    const old = { wall: { bars: '1', lines: '2', barSize: '5', vSpacing: '16' } };
    const j = job({ layout: spec, ...old });
    expect(row(j, 'L:walls', 'Verticals')).toBeDefined(); // the Footings & Walls tool, as before
    expect(noSteelWarning(buildLayout(spec), old)).toBe('No rebar yet: Footing, Slab 1, Slab 2, Anchor bolts');
    const r = withRebar(spec, old).rebar!;
    expect(r.vert).toEqual({ size: 5, spacingIn: 16 });
    expect(r.horiz).toMatchObject({ size: 5, rows: 'count', count: 2 });
  });

  test('a piece set to none on purpose has no warning; one added after rebar is set does', () => {
    const s = withRebar(spec);
    const none = { ...s, rebar: { ...s.rebar!, slabs: { ...s.rebar!.slabs, a0b1: { ...NO_SLAB_STEEL } } } };
    expect(noSteelWarning(buildLayout(none))).toBe('');
    expect(row(job({ layout: none }), 'L:slab2', 'Slab steel')!.value).toBe('None');
    const more: LayoutSpec = { ...s, pieces: [{ kind: 'pad', shape: 'square', wall: { main: 'bottom' }, along: 35, width: 6, depth: 4, thick: 4 / 12 }] };
    expect(noSteelWarning(buildLayout(more))).toBe('No rebar yet: Pad 1');
    expect(noSteelWarning(buildLayout(withRebar(more)))).toBe('');
  });

  test('each wall: bolts off, its own verticals; a step taken out keeps the others\' steel', () => {
    const s = withRebar(spec);
    const own = { ...s, rebar: { ...s.rebar!, walls: { 'Main front D–A': { bolts: false, vertSpacingIn: 0 } } } };
    const st = layoutSteel(buildLayout(own), own.rebar!);
    expect(st.bolts.total).toBe(101 - 13);
    expect(st.walls!.rows[0].value).toBe(`${222 - 34 - 2} × 4' 5"`); // its 34 between the ends, and the one extra at each corner it owns
    const steps = withRebar({
      ...spec,
      pieces: [
        { kind: 'pad', shape: 'square', wall: { main: 'bottom' }, along: 20, width: 6, depth: 4, thick: 4 / 12 },
        { kind: 'steps', shape: 'half', wall: { main: 'bottom' }, along: 50, steps: 3, rise: 7 / 12, tread: 1, diameter: 10 },
      ],
    });
    const after = dropPieceSteel(steps, 0);
    expect(after.pieces!.length).toBe(1);
    expect(after.rebar!.pieces).toEqual({ '0': steps.rebar!.pieces['1'] });
  });

  test('half round steps: a nose bar bent to each curve, dowels along the wall', () => {
    const s = withRebar({ ...spec, pieces: [{ kind: 'steps', shape: 'half', wall: { main: 'bottom' }, along: 35, steps: 3, rise: 7 / 12, tread: 1, diameter: 10 }] });
    const ps = layoutSteel(buildLayout(s), s.rebar!).pieces.get(0)!;
    // Diameters 10', 8', 6': half circles 3" in, π × (r − 3"): π × 4'9" = 14'11", π × 3'9" = 11'9", π × 2'9" = 8'8".
    expect(ps.rows[0]).toMatchObject({ label: 'Nose bars', value: `3 × 8' 7-11/16" to 14' 11-1/16"` });
    // Along the 10' it meets the wall: 9'6" at 24" → 6 dowels, 2' each.
    expect(ps.rows[1]).toMatchObject({ label: 'Dowels', value: `6 × 2' 0"` });
  });
});
