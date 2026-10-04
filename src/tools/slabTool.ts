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

/** One mat of bars both ways over a rectangle, each bar's ends optionally bent down `legFt`. */
function mat(lengthFt: number, widthFt: number, spacingIn: number, stockFt: number, lapFt: number, legFt: number) {
  const c = COVER_IN / 12;
  const spanL = lengthFt - 2 * c;
  const spanW = widthFt - 2 * c;
  const alongL = { ...planRun(spanL + 2 * legFt, stockFt, lapFt), count: countAlong(spanW * 12, spacingIn) };
  const alongW = { ...planRun(spanW + 2 * legFt, stockFt, lapFt), count: countAlong(spanL * 12, spacingIn) };
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
      showIfAny: ['slabRebar', 'footBars'],
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

    // ---- Exterior footing (thickened edge) ----
    const footing = inp.on('footing');
    let perim = 0;
    let centerline = 0;
    let w = 0;
    let d = 0;
    let corners = 4;
    if (footing) {
      w = inp.len('fWidth');
      d = inp.len('fDepth');
      if (inp.has('fPerim')) perim = inp.num('fPerim');
      else if (rects.length === 1) perim = 2 * (rects[0].length + rects[0].width);
      else return { error: 'Enter the footing length (around the outside). It can’t be figured from several areas.' };
      corners = inp.has('corners') ? inp.count('corners') : 4;
      if (w <= 0 || d <= 0) return { error: 'Footing width and depth must be more than 0.' };
      if (d <= t) warnings.push('The footing isn’t deeper than the slab. Measure footing depth from the top of the slab.');
      // The edge's centerline runs inside the outside edge: 4 more outside corners than inside on any slab.
      centerline = perim - 4 * w;
      if (centerline <= 0) return { error: 'The footing is too wide for that slab.' };
      const planned = centerline * w * Math.max(0, d - t);
      const w2 = w + inp.num('dugW') / 12;
      const d2 = d + inp.num('dugD') / 12;
      const dug = Math.max(0, perim - 4 * w2) * w2 * Math.max(0, d2 - t);
      rows.push({ label: 'Slab', value: cuYd(slabCuFt / CUFT_PER_CUYD) });
      rows.push({
        label: 'Exterior footing',
        value: cuYd(planned / CUFT_PER_CUYD),
        note: `${feet(perim)} around · ${inches(w * 12)} wide × ${inches(d * 12)} deep, below the slab only`,
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

    // ---- Interior footings ----
    const interior = inp.on('interior');
    if (interior) {
      const iW = inp.len('iWidth');
      const iD = inp.len('iDepth');
      if (inp.num('iLength') <= 0 || iW <= 0 || iD <= 0) return { error: 'Interior footing length, width and depth must be more than 0.' };
      if (iD <= t) warnings.push('An interior footing isn’t deeper than the slab. Measure its depth from the top of the slab.');
      const iCuFt = inp.num('iLength') * iW * Math.max(0, iD - t);
      if (!footing) rows.push({ label: 'Slab', value: cuYd(slabCuFt / CUFT_PER_CUYD) });
      rows.push({ label: 'Interior footings', value: cuYd(iCuFt / CUFT_PER_CUYD), note: `${feet(inp.num('iLength'))} · below the slab only` });
      totalCuFt += iCuFt;
    }

    rows.push(...concreteRows(totalCuFt, inp));

    // ---- Rebar ----
    const slabRebar = inp.on('slabRebar');
    const footBars = footing && inp.on('footBars');
    if (slabRebar || footBars) {
      const stockFt = Number(inp.choice('stockLength'));
      const lapFor = (bar: Bar) => (inp.has('lap') ? inp.num('lap') : lapIn(bar)) / 12;
      const sticks = new Map<number, number>();
      const addSticks = (bar: Bar, n: number) => sticks.set(bar.size, (sticks.get(bar.size) ?? 0) + n);
      let totalLb = 0;
      if (slabRebar) {
        const bar = getBar(inp.choice('barSize'));
        const spacing = inp.num('spacing');
        const lapFt = lapFor(bar);
        if (spacing <= 0) return { error: 'On center must be more than 0.' };
        if (lapFt >= stockFt) return { error: `The lap must be shorter than a ${stockFt}' stick.` };
        const tie = footing ? inp.choice('edgeTie') : 'none';
        // A bar sits at mid-slab; a bent-down leg reaches to 3" off the bottom of the footing.
        const legFt = Math.max(0, d - t / 2 - COVER_IN / 12);
        let bars = 0;
        let laps = 0;
        let ft = 0;
        const pieces: { lengthFt: number; count: number }[] = [];
        for (const r of rects) {
          const m = mat(r.length, r.width, spacing, stockFt, lapFt, tie === 'bend' ? legFt : 0);
          bars += m.bars;
          laps += m.laps;
          ft += m.totalFt;
          pieces.push(...m.pieces);
        }
        if (pieces.some((p) => p.lengthFt > stockFt + 1e-9)) return { error: `A bar piece is longer than a ${stockFt}' stick. Try a longer stick.` };
        let slabSticks = laps + sticksToCut(pieces, stockFt);
        rows.push({
          label: 'Slab bars',
          value: feet(ft),
          note: `${commas(bars)} bars, #${bar.size} at ${dec(spacing)}" both ways · ${commas(laps)} laps${tie === 'bend' && legFt > 0 ? ` · each end bent down ${inches(legFt * 12)} into the footing` : ''}`,
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
          note: `${lines} #${bar.size} bars around · ${commas(r.cornerBars)} corner L-bars ${ftIn(r.cornerBarFt)} (${inches(lapFt * 12)} legs) · ${commas(r.laps)} laps`,
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

      for (const [size, n] of [...sticks].sort((a, b) => a[0] - b[0])) rows.push({ label: `#${size} sticks`, value: `${commas(n)} × ${stockFt}'` });
      rows.push({ label: 'Rebar weight', value: lb(totalLb), note: tons(totalLb / LB_PER_TON) });
    }

    return { rows, warnings };
  },
  notes: ['Footing yards count only the part below the slab. Corners aren’t counted twice.'],
};

