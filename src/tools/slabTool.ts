// Slab: one pour with everything that goes with it. The slab, a thickened edge (exterior footing)
// that follows the outside for a mono pour, interior footings, and the rebar: the slab mat, bars
// in the footing with L-bars at the corners, and the slab tied into the edge (bars bent down,
// or separate L-bars).
//
// Rebar practice for a thickened edge: continuous bars in the trench (commonly 2 bottom + 1 top),
// L-shaped corner bars bent at each corner so the running bars are continuous, and the slab tied
// to the edge by bending slab bars down into it or with L-bars along the edge.

import { beamBars, Bar, BARS, countAlong, getBar, lapIn, LB_PER_TON, planRun, sticksToCut, weightLb } from '../lib/rebar';
import { concreteRows, CUFT_PER_CUYD, ORDER_FIELDS } from './concreteShared';
import { commas, commasTrim, cuYd, dec, ftIn, inches, lb, sqFt, tons } from './format';
import { ChoiceField, ResultRow, Tool } from './types';

/** Slab bars stop 3" in from the edge and sit at mid-depth; legs bent down stop 3" off the bottom. */
const COVER_IN = 3;

const barChoice = (key: string, from: number, to: number, def: string, label: string, showIf: string[]): ChoiceField => ({
  key,
  label,
  kind: 'choice',
  options: BARS.filter((b) => b.size >= from && b.size <= to).map((b) => ({ value: String(b.size), label: `#${b.size}` })),
  default: def,
  showIf,
});

const feet = (n: number) => `${commasTrim(n, 1)} ft`;

/** One mat of bars both ways over a rectangle; each side's bar ends can be bent down (legs in ft). */
function mat(
  lengthFt: number,
  widthFt: number,
  spacingIn: number,
  stockFt: number,
  lapFt: number,
  legs: { top: number; right: number; bottom: number; left: number },
) {
  const c = COVER_IN / 12;
  const spanL = lengthFt - 2 * c;
  const spanW = widthFt - 2 * c;
  // Bars running the length end at the left and right sides; bars across end at the top and bottom.
  const alongL = { ...planRun(spanL + legs.left + legs.right, stockFt, lapFt), count: countAlong(spanW * 12, spacingIn) };
  const alongW = { ...planRun(spanW + legs.top + legs.bottom, stockFt, lapFt), count: countAlong(spanL * 12, spacingIn) };
  return {
    alongL,
    alongW,
    bars: alongL.count + alongW.count,
    laps: alongL.count * alongL.laps + alongW.count * alongW.laps,
    totalFt: alongL.count * alongL.barFt + alongW.count * alongW.barFt,
    pieces: [
      { lengthFt: alongL.tailFt, count: alongL.count },
      { lengthFt: alongW.tailFt, count: alongW.count },
    ],
  };
}

export type SideKind = 'form' | 'house' | 'dowels';
export interface Side {
  name: 'Top' | 'Right' | 'Bottom' | 'Left';
  len: number;
  kind: SideKind;
}
export const SIDE_KEYS = ['sideTop', 'sideRight', 'sideBottom', 'sideLeft'] as const;

/** The four sides of a one-piece slab, clockwise from the top (as the plan draws it). */
export function sidesOf(r: { length: number; width: number }, kindOf: (key: string) => SideKind): Side[] {
  return [
    { name: 'Top', len: r.length, kind: kindOf('sideTop') },
    { name: 'Right', len: r.width, kind: kindOf('sideRight') },
    { name: 'Bottom', len: r.length, kind: kindOf('sideBottom') },
    { name: 'Left', len: r.width, kind: kindOf('sideLeft') },
  ];
}

/** Dowels along one side: 6" in from each end, none farther apart than the spacing. */
export const dowelCount = (sideFt: number, spacingIn: number) => countAlong(Math.max(0, sideFt * 12 - 12), spacingIn);

const sideChoice = (key: string, label: string, help?: string): ChoiceField => ({
  key,
  label,
  kind: 'choice',
  options: [
    { value: 'form', label: 'Formed' },
    { value: 'house', label: 'House' },
    { value: 'dowels', label: 'House + dowels' },
  ],
  default: 'form',
  help,
  showIf: ['edges'],
});

export const slab: Tool = {
  id: 'slab',
  title: 'Slab',
  blurb: 'Slab, thickened-edge footings and rebar, one pour',
  fields: [
    { key: 'areas', label: 'Slab size', kind: 'areas', help: 'Add more areas for L-shaped slabs' },
    { key: 'thick', label: 'Thickness', kind: 'length', default: { in: '4' } },

    { key: 'footing', label: 'Exterior footing', kind: 'toggle', help: 'Thickened edge around the outside (mono pour)' },
    { key: 'fWidth', label: 'Footing width', kind: 'length', default: { in: '12' }, showIf: ['footing'] },
    { key: 'fDepth', label: 'Footing depth', kind: 'length', default: { in: '16' }, help: 'Top of slab to bottom of footing', showIf: ['footing'] },
    { key: 'dugW', label: 'Dug wider by', kind: 'number', unit: 'in', optional: true, help: 'Trenches come out uneven. Measure and add the extra.', showIf: ['footing'] },
    { key: 'dugD', label: 'Dug deeper by', kind: 'number', unit: 'in', optional: true, showIf: ['footing'] },
    { key: 'fPerim', label: 'Footing length', kind: 'number', unit: 'ft', optional: true, help: 'Around the outside. Blank = figured from the slab size.', showIf: ['footing'] },
    { key: 'corners', label: 'Corners', kind: 'count', optional: true, help: 'Blank = 4. An L-shaped slab has 6.', showIf: ['footing'] },

    { key: 'edges', label: 'Mark each side', kind: 'toggle', help: 'Poured against a house? Dowels? Set each side.' },
    sideChoice('sideTop', 'Top side', 'Top and bottom run the length, left and right the width, like the plan.'),
    sideChoice('sideRight', 'Right side'),
    sideChoice('sideBottom', 'Bottom side'),
    sideChoice('sideLeft', 'Left side'),
    { key: 'houseFooting', label: 'Footing along the house too', kind: 'toggle', help: 'Off = no thickened edge where it meets the house', showIf: ['edges', 'footing'] },
    barChoice('dowelSize', 4, 6, '4', 'Dowel size', ['edges']),
    { key: 'dowelSpacing', label: 'Dowels every', kind: 'number', unit: 'in', default: '24', help: 'Used on sides marked House + dowels', showIf: ['edges'] },
    { key: 'dowelLength', label: 'Dowel length', kind: 'length', default: { in: '18' }, help: 'Whole bar, about half drilled into the house', showIf: ['edges'] },

    { key: 'interior', label: 'Interior footings', kind: 'toggle', help: 'Footings under bearing walls or posts' },
    { key: 'iLength', label: 'Interior footing length', kind: 'number', unit: 'ft', help: 'All of them added together', showIf: ['interior'] },
    { key: 'iWidth', label: 'Interior footing width', kind: 'length', default: { in: '12' }, showIf: ['interior'] },
    { key: 'iDepth', label: 'Interior footing depth', kind: 'length', default: { in: '16' }, help: 'Top of slab to bottom of footing', showIf: ['interior'] },

    { key: 'slabRebar', label: 'Rebar in the slab', kind: 'toggle' },
    barChoice('barSize', 3, 5, '4', 'Slab bar size', ['slabRebar']),
    { key: 'spacing', label: 'On center', kind: 'number', unit: 'in', default: '18', showIf: ['slabRebar'] },
    {
      key: 'edgeTie',
      label: 'Tie the slab to the footing',
      kind: 'choice',
      options: [
        { value: 'bend', label: 'Bend bars down' },
        { value: 'lbars', label: 'L-bars at the edge' },
        { value: 'none', label: 'No' },
      ],
      default: 'bend',
      showIf: ['slabRebar', 'footing'],
    },

    { key: 'footBars', label: 'Bars in the footing', kind: 'toggle', help: 'Runs around the edge, L-bars at every corner', showIf: ['footing'] },
    barChoice('fBarSize', 4, 6, '4', 'Footing bar size', ['footing', 'footBars']),
    { key: 'fBars', label: 'Bars in the footing', kind: 'count', default: '3', help: '2 bottom + 1 top = 3', showIf: ['footing', 'footBars'] },

    {
      key: 'stockLength',
      label: 'Stick length',
      kind: 'choice',
      options: [20, 30, 40, 60].map((n) => ({ value: String(n), label: `${n}'` })),
      default: '20',
      showIfAny: ['slabRebar', 'footBars', 'edges'],
    },
    { key: 'lap', label: 'Lap', kind: 'number', unit: 'in', optional: true, help: 'Blank = 20" on #4, 25" on #5, 30" on #6', showIfAny: ['slabRebar', 'footBars'] },

    ...ORDER_FIELDS,
  ],
  compute: (inp) => {
    const rects = inp.areas('areas');
    const area = rects.reduce((sum, r) => sum + r.length * r.width, 0);
    const t = inp.len('thick');
    if (t <= 0) return { error: 'Thickness must be more than 0.' };
    const rows: ResultRow[] = [{ label: 'Slab area', value: sqFt(area) }];
    const warnings: string[] = [];
    const slabCuFt = area * t;
    let totalCuFt = slabCuFt;

    // ---- Sides: formed, or poured against a house (with or without dowels) ----
    const edges = inp.on('edges');
    let sides: Side[] | null = null;
    if (edges) {
      if (rects.length !== 1) return { error: 'Marking sides works on a one-piece slab. Use one area.' };
      sides = sidesOf(rects[0], (k) => inp.choice(k) as SideKind);
      const formed = sides.filter((s) => s.kind === 'form').reduce((a, s) => a + s.len, 0);
      const house = sides.filter((s) => s.kind !== 'form');
      rows.push({
        label: 'Forms',
        value: feet(formed),
        note: house.length ? `${feet(house.reduce((a, s) => a + s.len, 0))} against the house (${house.map((s) => s.name.toLowerCase()).join(', ')}), no forms there` : 'All sides formed',
      });
    }

    // ---- Exterior footing (thickened edge) ----
    const footing = inp.on('footing');
    const footOn = (i: number) => footing && (!sides || sides[i].kind === 'form' || inp.on('houseFooting'));
    let centerline = 0;
    let w = 0;
    let d = 0;
    let corners = 4;
    let hasFooting = false;
    if (footing) {
      w = inp.len('fWidth');
      d = inp.len('fDepth');
      if (w <= 0 || d <= 0) return { error: 'Footing width and depth must be more than 0.' };
      if (d <= t) warnings.push('The footing isn’t deeper than the slab. Measure footing depth from the top of the slab.');
      // Footing length along the edge, and how much to take off for corners where two runs overlap.
      let edgeFt: number;
      let overlaps: number;
      if (sides) {
        edgeFt = sides.reduce((a, s, i) => a + (footOn(i) ? s.len : 0), 0);
        overlaps = sides.filter((_, i) => footOn(i) && footOn((i + 1) % 4)).length;
        corners = overlaps;
      } else {
        if (inp.has('fPerim')) edgeFt = inp.num('fPerim');
        else if (rects.length === 1) edgeFt = 2 * (rects[0].length + rects[0].width);
        else return { error: 'Enter the footing length (around the outside). It can’t be figured from several areas.' };
        // Any closed slab has 4 more outside corners than inside ones.
        overlaps = 4;
        corners = inp.has('corners') ? inp.count('corners') : 4;
      }
      hasFooting = edgeFt > 0;
      if (!hasFooting) {
        warnings.push('No side has a footing: every side is against the house. Turn on “Footing along the house too” if it needs one.');
      } else {
        // Centerline = edge length − one footing width per overlapping corner (a closed rectangle: perimeter − 4 × width).
        centerline = edgeFt - overlaps * w;
        if (centerline <= 0) return { error: 'The footing is too wide for that slab.' };
        const planned = centerline * w * Math.max(0, d - t);
        const w2 = w + inp.num('dugW') / 12;
        const d2 = d + inp.num('dugD') / 12;
        const dug = Math.max(0, edgeFt - overlaps * w2) * w2 * Math.max(0, d2 - t);
        rows.push({ label: 'Slab', value: cuYd(slabCuFt / CUFT_PER_CUYD) });
        rows.push({
          label: 'Exterior footing',
          value: cuYd(planned / CUFT_PER_CUYD),
          note: `${feet(edgeFt)} of edge · ${inches(w * 12)} wide × ${inches(d * 12)} deep, below the slab only`,
        });
        if (dug > planned + 1e-9) {
          rows.push({
            label: 'Footing as dug',
            value: cuYd(dug / CUFT_PER_CUYD),
            note: `${dec((dug - planned) / CUFT_PER_CUYD, 2)} yd more than planned. The order below uses this.`,
          });
          warnings.push('Ordering for the footing as dug. Many crews still add a little extra on footings to be safe.');
        } else {
          warnings.push('Footings are rarely dug even. Most crews order extra on footings to be safe. Measure the trench and put the extra in “Dug wider by” and “Dug deeper by”.');
        }
        totalCuFt += Math.max(dug, planned);
      }
    }

    // ---- Interior footings ----
    const interior = inp.on('interior');
    if (interior) {
      const iW = inp.len('iWidth');
      const iD = inp.len('iDepth');
      if (inp.num('iLength') <= 0 || iW <= 0 || iD <= 0) return { error: 'Interior footing length, width and depth must be more than 0.' };
      if (iD <= t) warnings.push('An interior footing isn’t deeper than the slab. Measure its depth from the top of the slab.');
      const iCuFt = inp.num('iLength') * iW * Math.max(0, iD - t);
      if (!hasFooting) rows.push({ label: 'Slab', value: cuYd(slabCuFt / CUFT_PER_CUYD) });
      rows.push({ label: 'Interior footings', value: cuYd(iCuFt / CUFT_PER_CUYD), note: `${feet(inp.num('iLength'))} · below the slab only` });
      totalCuFt += iCuFt;
    }

    rows.push(...concreteRows(totalCuFt, inp));

    // ---- Rebar ----
    const slabRebar = inp.on('slabRebar');
    const footBars = hasFooting && inp.on('footBars');
    const dowelSides = sides ? sides.filter((s) => s.kind === 'dowels') : [];
    if (slabRebar || footBars || dowelSides.length) {
      const stockFt = Number(inp.choice('stockLength')) || 20;
      const lapFor = (bar: Bar) => (inp.has('lap') ? inp.num('lap') : lapIn(bar)) / 12;
      const sticks = new Map<number, number>();
      const addSticks = (bar: Bar, n: number) => sticks.set(bar.size, (sticks.get(bar.size) ?? 0) + n);
      let totalLb = 0;
      // A slab bar sits at mid-slab; a bent-down leg reaches to 3" off the bottom of the footing.
      const legFt = Math.max(0, d - t / 2 - COVER_IN / 12);

      if (slabRebar) {
        const bar = getBar(inp.choice('barSize'));
        const spacing = inp.num('spacing');
        const lapFt = lapFor(bar);
        if (spacing <= 0) return { error: 'On center must be more than 0.' };
        if (lapFt >= stockFt) return { error: `The lap must be shorter than a ${stockFt}' stick.` };
        const tie = hasFooting ? inp.choice('edgeTie') : 'none';
        // Bars bend down only where there's a footing under that side.
        const leg = (i: number) => (tie === 'bend' && (!sides || footOn(i)) ? legFt : 0);
        let bars = 0;
        let laps = 0;
        let ft = 0;
        const pieces: { lengthFt: number; count: number }[] = [];
        for (const r of rects) {
          const m = mat(r.length, r.width, spacing, stockFt, lapFt, { top: leg(0), right: leg(1), bottom: leg(2), left: leg(3) });
          bars += m.bars;
          laps += m.laps;
          ft += m.totalFt;
          pieces.push(...m.pieces);
        }
        if (pieces.some((p) => p.lengthFt > stockFt + 1e-9)) return { error: `A bar piece is longer than a ${stockFt}' stick. Try a longer stick.` };
        let slabSticks = laps + sticksToCut(pieces, stockFt);
        const bentWhere = sides ? sides.filter((_, i) => leg(i) > 0).map((s) => s.name.toLowerCase()) : [];
        rows.push({
          label: 'Slab bars',
          value: feet(ft),
          note: `${commas(bars)} bars, #${bar.size} at ${dec(spacing)}" both ways · ${commas(laps)} laps${
            tie === 'bend' && legFt > 0 ? ` · ends bent down ${inches(legFt * 12)} into the footing${sides ? ` (${bentWhere.join(', ')})` : ''}` : ''
          }`,
        });
        if (tie === 'lbars') {
          const n = countAlong(centerline * 12, spacing);
          const len = lapFt + legFt;
          slabSticks += sticksToCut([{ lengthFt: len, count: n }], stockFt);
          ft += n * len;
          rows.push({ label: 'Edge L-bars', value: `${commas(n)} × ${ftIn(len)}`, note: `${inches(lapFt * 12)} into the slab, ${inches(legFt * 12)} down into the footing, every ${dec(spacing)}"` });
        }
        addSticks(bar, slabSticks);
        totalLb += weightLb(bar, ft);
      }

      if (footBars) {
        const bar = getBar(inp.choice('fBarSize'));
        const lines = inp.count('fBars');
        const lapFt = lapFor(bar);
        if (lines < 1) return { error: 'Enter at least 1 bar in the footing.' };
        if (2 * lapFt > stockFt) return { error: `A corner bar won’t fit in a ${stockFt}' stick.` };
        const r = beamBars(centerline, lines, bar, stockFt, lapFt, corners);
        rows.push({
          label: 'Footing bars',
          value: feet(r.totalFt),
          note: `${lines} #${bar.size} bars along the footing · ${commas(r.cornerBars)} corner L-bars ${ftIn(r.cornerBarFt)} (${inches(lapFt * 12)} legs) · ${commas(r.laps)} laps`,
        });
        addSticks(bar, r.sticks);
        totalLb += r.lb;
        if (interior) {
          const ri = beamBars(inp.num('iLength'), lines, bar, stockFt, lapFt, 0);
          rows.push({ label: 'Interior footing bars', value: feet(ri.totalFt), note: `${lines} #${bar.size} bars · ${commas(ri.laps)} laps` });
          addSticks(bar, ri.sticks);
          totalLb += ri.lb;
        }
      }

      if (dowelSides.length) {
        const bar = getBar(inp.choice('dowelSize'));
        const spacing = inp.num('dowelSpacing');
        const len = inp.len('dowelLength');
        if (spacing <= 0) return { error: 'Dowel spacing must be more than 0.' };
        if (len <= 0 || len > stockFt) return { error: `Dowel length must be more than 0 and fit in a ${stockFt}' stick.` };
        const n = dowelSides.reduce((a, s) => a + dowelCount(s.len, spacing), 0);
        rows.push({
          label: 'Dowels',
          value: `${commas(n)} × ${ftIn(len)}`,
          note: `#${bar.size} every ${dec(spacing)}" along the ${dowelSides.map((s) => s.name.toLowerCase()).join(' and ')} · drill and epoxy about ${inches((len * 12) / 2)} into the house`,
        });
        addSticks(bar, sticksToCut([{ lengthFt: len, count: n }], stockFt));
        totalLb += weightLb(bar, n * len);
      }

      for (const [size, n] of [...sticks].sort((a, b) => a[0] - b[0])) rows.push({ label: `#${size} sticks`, value: `${commas(n)} × ${stockFt}'` });
      rows.push({ label: 'Rebar weight', value: lb(totalLb), note: tons(totalLb / LB_PER_TON) });
    }

    return { rows, warnings };
  },
  notes: ['Footing yards count only the part below the slab. Corners aren’t counted twice.'],
};

