// Slab: one pour with everything that goes with it. The slab, a thickened edge (exterior footing)
// that follows the outside for a mono pour, interior footings, and the rebar: the slab mat, bars
// in the footing with L-bars at the corners, and the slab tied into the edge (bars bent down,
// or separate L-bars).
//
// Rebar practice for a thickened edge: continuous bars in the trench (commonly 2 bottom + 1 top),
// L-shaped corner bars bent at each corner so the running bars are continuous, and the slab tied
// to the edge by bending slab bars down into it or with L-bars along the edge.

import { beamBars, Bar, BARS, countAlong, getBar, lapIn, LB_PER_TON, planRun, slabBarsAdvice, sticksToCut, weightLb } from '../lib/rebar';
import { buildLayout, insetRuns } from '../report/layoutGeom';
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
/** Corner k sits at the end of side k (clockwise from the top). */
export const CORNER_KEYS = ['tr', 'br', 'bl', 'tl'] as const;

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

    { key: 'rounded', label: 'Rounded corners', kind: 'toggle', help: 'Radius corners (one-piece slab)' },
    { key: 'radius', label: 'Radius', kind: 'length', default: { ft: '2' }, showIf: ['rounded'] },
    {
      key: 'roundCorners',
      label: 'Which corners',
      kind: 'multi',
      options: [
        { value: 'tr', label: 'Top right' },
        { value: 'br', label: 'Bottom right' },
        { value: 'bl', label: 'Bottom left' },
        { value: 'tl', label: 'Top left' },
      ],
      default: ['tr', 'br', 'bl', 'tl'],
      showIf: ['rounded'],
    },

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
    { key: 'pickBars', label: 'Pick my own bars', kind: 'toggle', help: 'Off: sized for how long and thick the slab is', showIf: ['slabRebar'] },
    barChoice('barSize', 3, 5, '4', 'Slab bar size', ['slabRebar', 'pickBars']),
    { key: 'spacing', label: 'On center', kind: 'number', unit: 'in', default: '18', showIf: ['slabRebar', 'pickBars'] },
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
    const t = inp.len('thick');
    if (t <= 0) return { error: 'Thickness must be more than 0.' };
    const one = rects.length === 1 ? rects[0] : null;
    // Side lengths clockwise from the top (one-piece slab): top and bottom run the length.
    const lens = one ? [one.length, one.width, one.length, one.width] : [];

    // ---- Rounded corners (one-piece slab). Corner k is at the end of side k: top right, bottom right, bottom left, top left.
    const radii = [0, 0, 0, 0];
    if (inp.on('rounded')) {
      if (!one) return { error: 'Rounded corners work on a one-piece slab. Use one area.' };
      const r = inp.len('radius');
      if (r <= 0) return { error: 'The radius must be more than 0.' };
      if (r > Math.min(one.length, one.width) / 2 + 1e-9) return { error: `The radius can’t be more than half the slab’s width (${ftIn(Math.min(one.length, one.width) / 2)}).` };
      for (const c of inp.picks('roundCorners')) radii[CORNER_KEYS.indexOf(c as (typeof CORNER_KEYS)[number])] = r;
    }
    const rounded = radii.filter((r) => r > 0);
    // Each rounded corner trims a square minus a quarter circle.
    const area = rects.reduce((sum, r) => sum + r.length * r.width, 0) - rounded.reduce((a, r) => a + r * r * (1 - Math.PI / 4), 0);
    const rows: ResultRow[] = [{ label: 'Slab area', value: sqFt(area) }];
    const warnings: string[] = [];
    const slabCuFt = area * t;
    let totalCuFt = slabCuFt;
    if (rounded.length) {
      rows.push({
        label: 'Rounded corners',
        value: `${rounded.length} × ${ftIn(rounded[0])} radius`,
        note: `${feet(rounded.reduce((a, r) => a + (Math.PI / 2) * r, 0))} of curved edge (bender board)`,
      });
    }
    /** Straight part of side i, between the curves at its two ends. */
    const straight = (i: number) => lens[i] - radii[(i + 3) % 4] - radii[i];
    const arc = (k: number) => (Math.PI / 2) * radii[k];

    // ---- Sides: formed, or poured against a house (with or without dowels) ----
    const edges = inp.on('edges');
    let sides: Side[] | null = null;
    if (edges) {
      if (!one) return { error: 'Marking sides works on a one-piece slab. Use one area.' };
      sides = sidesOf(one, (k) => inp.choice(k) as SideKind);
      for (let k = 0; k < 4; k++) {
        if (radii[k] > 0 && (sides[k].kind !== 'form' || sides[(k + 1) % 4].kind !== 'form')) {
          return { error: 'A corner next to the house can’t be rounded. Pick only corners between two formed sides.' };
        }
      }
      const formed = sides.reduce((a, s, i) => a + (s.kind === 'form' ? straight(i) : 0), 0) + [0, 1, 2, 3].reduce((a, k) => a + arc(k), 0);
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
      if (rounded.some((r) => r < w - 1e-9)) return { error: 'Make the corner radius at least the footing width so the footing can follow the curve.' };
      // Footing along its centerline, for a footing this wide.
      let edgeFt: number;
      let centerlineFor: (width: number) => number;
      if (one && !inp.has('fPerim')) {
        // Straight runs where there's a footing; square corners where two runs meet overlap by one width;
        // rounded corners follow the curve (centerline radius = r − width/2).
        const both = (k: number) => footOn(k) && footOn((k + 1) % 4);
        edgeFt = [0, 1, 2, 3].reduce((a, i) => a + (footOn(i) ? straight(i) : 0) + (both(i) ? arc(i) : 0), 0);
        centerlineFor = (width) =>
          [0, 1, 2, 3].reduce(
            (a, k) =>
              a +
              (footOn(k) ? straight(k) : 0) -
              (both(k) && radii[k] === 0 ? width : 0) +
              (both(k) && radii[k] > 0 ? (Math.PI / 2) * (radii[k] - width / 2) : 0),
            0,
          );
        corners = [0, 1, 2, 3].filter((k) => both(k) && radii[k] === 0).length;
      } else {
        if (inp.has('fPerim')) edgeFt = inp.num('fPerim');
        else return { error: 'Enter the footing length (around the outside). It can’t be figured from several areas.' };
        // Any closed slab has 4 more outside corners than inside ones.
        centerlineFor = (width) => edgeFt - 4 * width;
        corners = inp.has('corners') ? inp.count('corners') : 4;
      }
      hasFooting = edgeFt > 0;
      if (!hasFooting) {
        warnings.push('No side has a footing: every side is against the house. Turn on “Footing along the house too” if it needs one.');
      } else {
        centerline = centerlineFor(w);
        if (centerline <= 0) return { error: 'The footing is too wide for that slab.' };
        const planned = centerline * w * Math.max(0, d - t);
        const w2 = w + inp.num('dugW') / 12;
        const d2 = d + inp.num('dugD') / 12;
        const dug = Math.max(0, centerlineFor(w2)) * w2 * Math.max(0, d2 - t);
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
        // Your own bars, or sized for the slab's length and thickness (a small slab gets just the edge bar).
        const own = inp.on('pickBars');
        if (own && inp.num('spacing') <= 0) return { error: 'On center must be more than 0.' };
        const longest = Math.max(...rects.map((r) => Math.max(r.length, r.width)));
        const advice = slabBarsAdvice(t * 12, longest);
        const bar = getBar(own ? inp.choice('barSize') : advice.size);
        const spacing = own ? inp.num('spacing') : advice.spacingIn;
        const matOn = own || !advice.edgeOnly;
        const lapFt = lapFor(bar);
        if (lapFt >= stockFt) return { error: `The lap must be shorter than a ${stockFt}' stick.` };
        const tie = hasFooting ? inp.choice('edgeTie') : 'none';
        // Bars bend down only where there's a footing under that side.
        const leg = (i: number) => (tie === 'bend' && (!sides || footOn(i)) ? legFt : 0);
        let bars = 0;
        let laps = 0;
        let ft = 0;
        const pieces: { lengthFt: number; count: number }[] = [];
        for (const r of matOn ? rects : []) {
          const m = mat(r.length, r.width, spacing, stockFt, lapFt, { top: leg(0), right: leg(1), bottom: leg(2), left: leg(3) });
          bars += m.bars;
          laps += m.laps;
          ft += m.totalFt;
          pieces.push(...m.pieces);
        }
        if (pieces.some((p) => p.lengthFt > stockFt + 1e-9)) return { error: `A bar piece is longer than a ${stockFt}' stick. Try a longer stick.` };
        let slabSticks = laps + sticksToCut(pieces, stockFt);
        const bentWhere = sides ? sides.filter((_, i) => leg(i) > 0).map((s) => s.name.toLowerCase()) : [];
        const why = own ? '' : ` · sized for a ${ftIn(longest)} long, ${inches(t * 12)} slab`;
        if (matOn) {
          rows.push({
            label: 'Slab bars',
            value: feet(ft),
            note: `${commas(bars)} bars, #${bar.size} at ${dec(spacing)}" both ways${why} · ${commas(laps)} laps${
              tie === 'bend' && legFt > 0 ? ` · ends bent down ${inches(legFt * 12)} into the footing${sides ? ` (${bentWhere.join(', ')})` : ''}` : ''
            }`,
          });
        } else {
          rows.push({ label: 'Slab bars', value: 'Edge bar only', note: `Small enough (${ftIn(longest)} long, ${inches(t * 12)} thick) that a bar around the edge is enough` });
        }

        // A bar around the whole edge, 3" in, lapped at the corners. Where footing bars run, they are the edge bar.
        const edgeOn = (i: number) => !(footBars && footOn(i));
        let edgeFt = 0;
        let edgeCorners = 0;
        if (one) {
          const L = buildLayout(lens.map((len, k) => ({ length: len, turn: 'R' as const, radius: radii[k], edge: 'form' as const })));
          edgeFt = insetRuns(L, COVER_IN / 12, edgeOn).reduce((a, run) => a + run.slice(1).reduce((b, q, j) => b + Math.hypot(q.x - run[j].x, q.y - run[j].y), 0), 0);
          edgeCorners = [0, 1, 2, 3].filter((k) => radii[k] === 0 && edgeOn(k) && edgeOn((k + 1) % 4)).length;
        } else if (!footBars && inp.has('fPerim')) {
          edgeFt = inp.num('fPerim');
          edgeCorners = inp.has('corners') ? inp.count('corners') : 4;
        } else if (!footBars) {
          warnings.push('For the bar around the edge on a slab made of several areas, use Slab Layout (or enter the footing length).');
        }
        if (edgeFt > 0) {
          const eBar = getBar(Math.max(4, bar.size));
          const e = beamBars(edgeFt, 1, eBar, stockFt, lapFor(eBar), edgeCorners);
          rows.push({
            label: 'Edge bar',
            value: feet(e.totalFt),
            note: `1 #${eBar.size} around the edge, 3" in · ${commas(e.cornerBars)} corner L-bars ${ftIn(e.cornerBarFt)} · ${commas(e.laps)} laps${
              footBars ? ' · footing bars are the edge bar where the footing runs' : ''
            }`,
          });
          addSticks(eBar, e.sticks);
          totalLb += e.lb;
        }
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
          note: `${lines} #${bar.size} bars along the footing · ${commas(r.cornerBars)} corner L-bars ${ftIn(r.cornerBarFt)} (${inches(lapFt * 12)} legs)${
            rounded.length ? ` · bent around the ${rounded.length} rounded ${rounded.length === 1 ? 'corner' : 'corners'}` : ''
          } · ${commas(r.laps)} laps`,
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

