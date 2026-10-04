// Slab Layout: a slab of any square-cornered shape (L-shapes, walks, notches) with rounded corners,
// drawn by walking its edge one side at a time. Figures concrete, forms, the thickened edge on
// formed sides, the slab mat cut to the real shape, footing bars and dowels.

import { arcLen, buildLayout, layoutArea, matBars, straight } from '../report/layoutGeom';
import { Bar, BARS, beamBars, countAlong, getBar, lapIn, LB_PER_TON, planRun, sticksToCut, weightLb } from '../lib/rebar';
import { concreteRows, CUFT_PER_CUYD, ORDER_FIELDS } from './concreteShared';
import { commas, commasTrim, cuYd, dec, ftIn, inches, lb, sqFt, tons } from './format';
import { dowelCount } from './slabTool';
import { ChoiceField, EdgeKind, ResultRow, Tool } from './types';

const COVER_IN = 3;
const feet = (n: number) => `${commasTrim(n, 1)} ft`;
const EDGE_NAME: Record<EdgeKind, string> = {
  form: 'formed',
  house: 'house',
  dowels: 'house',
  slab: 'existing slab',
  slabDowels: 'existing slab',
};

const barChoice = (key: string, from: number, to: number, def: string, label: string, showIf: string[]): ChoiceField => ({
  key,
  label,
  kind: 'choice',
  options: BARS.filter((b) => b.size >= from && b.size <= to).map((b) => ({ value: String(b.size), label: `#${b.size}` })),
  default: def,
  showIf,
});

export const slabLayout: Tool = {
  id: 'slab-layout',
  title: 'Slab Layout',
  blurb: 'Any shape: L-shapes, walks, curves. Side by side, with 3D.',
  fields: [
    {
      key: 'sides',
      label: 'Sides',
      kind: 'outline',
      help: 'Walk around the edge with the slab on your right. Each side: length corner to corner (as if square), which way you turn at the end, and the radius if that corner is rounded.',
    },
    { key: 'thick', label: 'Thickness', kind: 'length', default: { in: '4' } },

    { key: 'footing', label: 'Thickened edge', kind: 'toggle', help: 'On the formed sides' },
    { key: 'fWidth', label: 'Footing width', kind: 'length', default: { in: '12' }, showIf: ['footing'] },
    { key: 'fDepth', label: 'Footing depth', kind: 'length', default: { in: '16' }, help: 'Top of slab to bottom of footing', showIf: ['footing'] },
    { key: 'dugW', label: 'Dug wider by', kind: 'number', unit: 'in', optional: true, help: 'Trenches come out uneven. Measure and add the extra.', showIf: ['footing'] },
    { key: 'dugD', label: 'Dug deeper by', kind: 'number', unit: 'in', optional: true, showIf: ['footing'] },

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
    { key: 'footBars', label: 'Bars in the footing', kind: 'toggle', help: 'Runs along the thickened edge, L-bars at square corners', showIf: ['footing'] },
    barChoice('fBarSize', 4, 6, '4', 'Footing bar size', ['footing', 'footBars']),
    { key: 'fBars', label: 'Bars in the footing', kind: 'count', default: '3', help: '2 bottom + 1 top = 3', showIf: ['footing', 'footBars'] },

    barChoice('dowelSize', 4, 6, '4', 'Dowel size', []),
    { key: 'dowelSpacing', label: 'Dowels every', kind: 'number', unit: 'in', default: '24', help: 'Used on sides marked + dowels' },
    { key: 'dowelLength', label: 'Dowel length', kind: 'length', default: { in: '18' }, help: 'Whole bar, about half drilled in' },

    {
      key: 'stockLength',
      label: 'Stick length',
      kind: 'choice',
      options: [20, 30, 40, 60].map((v) => ({ value: String(v), label: `${v}'` })),
      default: '20',
    },
    { key: 'lap', label: 'Lap', kind: 'number', unit: 'in', optional: true, help: 'Blank = 20" on #4, 25" on #5, 30" on #6', showIfAny: ['slabRebar', 'footBars'] },
    ...ORDER_FIELDS,
  ],
  compute: (inp) => {
    const sides = inp.outline('sides');
    const t = inp.len('thick');
    if (t <= 0) return { error: 'Thickness must be more than 0.' };
    if (sides.length < 4) return { error: 'Add the sides all the way around (at least 4).' };
    const rights = sides.filter((s) => s.turn === 'R').length;
    if (rights - (sides.length - rights) !== 4) {
      return { error: `Going all the way around makes 4 more right turns than left. You have ${rights} right and ${sides.length - rights} left.` };
    }
    const L = buildLayout(sides);
    if (!L.closed) return { error: `The sides don’t meet up: the last corner is ${ftIn(L.gap)} from where you started. Check the lengths and turns.` };
    const N = sides.length;
    const formed = (k: number) => sides[k].edge === 'form';
    for (let k = 0; k < N; k++) {
      if (straight(L, k) < -1e-9) return { error: `Side ${k + 1} is too short for the corner radii at its ends.` };
      if (sides[k].radius > 0 && !(formed(k) && formed((k + 1) % N))) {
        return { error: `The corner after side ${k + 1} is rounded but touches the house or existing slab. Only round corners between two formed sides.` };
      }
    }

    const area = layoutArea(L);
    const rows: ResultRow[] = [{ label: 'Slab area', value: sqFt(area) }];
    const warnings: string[] = [];
    const slabCuFt = area * t;
    let totalCuFt = slabCuFt;

    // Forms: formed straight parts plus curves between formed sides.
    const curved = sides.reduce((a, _, k) => a + arcLen(L, k), 0);
    const formsFt = sides.reduce((a, _, k) => a + (formed(k) ? straight(L, k) : 0), 0) + curved;
    const against = (kinds: EdgeKind[]) => sides.reduce((a, s, k) => a + (kinds.includes(s.edge) ? straight(L, k) : 0), 0);
    const houseFt = against(['house', 'dowels']);
    const slabFt = against(['slab', 'slabDowels']);
    rows.push({
      label: 'Forms',
      value: feet(formsFt),
      note:
        [curved > 0 ? `${feet(curved)} curved (bender board)` : '', houseFt ? `${feet(houseFt)} against the house` : '', slabFt ? `${feet(slabFt)} against existing slab` : '']
          .filter(Boolean)
          .join(' · ') || 'Every side formed',
    });

    // ---- Thickened edge on the formed sides ----
    const footing = inp.on('footing');
    const footOn = (k: number) => footing && formed(k);
    const both = (k: number) => footOn(k) && footOn((k + 1) % N);
    let centerline = 0;
    let w = 0;
    let d = 0;
    let squareCorners = 0;
    let hasFooting = false;
    if (footing) {
      w = inp.len('fWidth');
      d = inp.len('fDepth');
      if (w <= 0 || d <= 0) return { error: 'Footing width and depth must be more than 0.' };
      if (d <= t) warnings.push('The footing isn’t deeper than the slab. Measure footing depth from the top of the slab.');
      if (sides.some((s, k) => s.radius > 0 && s.turn === 'R' && both(k) && s.radius < w - 1e-9)) {
        return { error: 'Make the outside corner radius at least the footing width so the footing can follow the curve.' };
      }
      // Along the centerline: straight runs; square corners overlap (outside, take off a width) or
      // leave a gap (inside, add a width); curves follow radius r ∓ width/2.
      const centerlineFor = (width: number) =>
        sides.reduce((a, s, k) => {
          let c = footOn(k) ? straight(L, k) : 0;
          if (both(k)) {
            if (s.radius === 0) c += s.turn === 'R' ? -width : width;
            else c += (Math.PI / 2) * (s.turn === 'R' ? s.radius - width / 2 : s.radius + width / 2);
          }
          return a + c;
        }, 0);
      const edgeFt = sides.reduce((a, _, k) => a + (footOn(k) ? straight(L, k) : 0) + (both(k) ? arcLen(L, k) : 0), 0);
      squareCorners = sides.filter((s, k) => both(k) && s.radius === 0).length;
      hasFooting = edgeFt > 0;
      if (!hasFooting) {
        warnings.push('No formed sides, so no thickened edge.');
      } else {
        centerline = centerlineFor(w);
        const planned = centerline * w * Math.max(0, d - t);
        const w2 = w + inp.num('dugW') / 12;
        const d2 = d + inp.num('dugD') / 12;
        const dug = Math.max(0, centerlineFor(w2)) * w2 * Math.max(0, d2 - t);
        rows.push({ label: 'Slab', value: cuYd(slabCuFt / CUFT_PER_CUYD) });
        rows.push({ label: 'Thickened edge', value: cuYd(planned / CUFT_PER_CUYD), note: `${feet(edgeFt)} of edge · ${inches(w * 12)} wide × ${inches(d * 12)} deep, below the slab only` });
        if (dug > planned + 1e-9) {
          rows.push({ label: 'Edge as dug', value: cuYd(dug / CUFT_PER_CUYD), note: `${dec((dug - planned) / CUFT_PER_CUYD, 2)} yd more than planned. The order below uses this.` });
          warnings.push('Ordering for the edge as dug. Many crews still add a little extra to be safe.');
        } else {
          warnings.push('Footings are rarely dug even. Most crews order extra to be safe. Measure the trench and put the extra in “Dug wider by” and “Dug deeper by”.');
        }
        totalCuFt += Math.max(dug, planned);
      }
    }
    rows.push(...concreteRows(totalCuFt, inp));

    // ---- Rebar ----
    const slabRebar = inp.on('slabRebar');
    const footBars = hasFooting && inp.on('footBars');
    const dowelSides = sides.map((s, k) => ({ s, k })).filter(({ s }) => s.edge === 'dowels' || s.edge === 'slabDowels');
    if (slabRebar || footBars || dowelSides.length) {
      const stockFt = Number(inp.choice('stockLength')) || 20;
      const lapFor = (bar: Bar) => (inp.has('lap') ? inp.num('lap') : lapIn(bar)) / 12;
      const sticks = new Map<number, number>();
      const addSticks = (bar: Bar, k: number) => sticks.set(bar.size, (sticks.get(bar.size) ?? 0) + k);
      let totalLb = 0;
      const legFt = Math.max(0, d - t / 2 - COVER_IN / 12);

      if (slabRebar) {
        const bar = getBar(inp.choice('barSize'));
        const spacing = inp.num('spacing');
        const lapFt = lapFor(bar);
        if (spacing <= 0) return { error: 'On center must be more than 0.' };
        if (lapFt >= stockFt) return { error: `The lap must be shorter than a ${stockFt}' stick.` };
        const tie = hasFooting ? inp.choice('edgeTie') : 'none';
        const segs = matBars(L, COVER_IN / 12, spacing / 12, footOn);
        let ft = 0;
        let laps = 0;
        let bent = 0;
        const pieces: { lengthFt: number; count: number }[] = [];
        for (const sg of segs) {
          const legs = tie === 'bend' ? (sg.footAtA ? 1 : 0) + (sg.footAtB ? 1 : 0) : 0;
          bent += legs;
          const run = planRun(Math.hypot(sg.b.x - sg.a.x, sg.b.y - sg.a.y) + legs * legFt, stockFt, lapFt);
          ft += run.barFt;
          laps += run.laps;
          pieces.push({ lengthFt: run.tailFt, count: 1 });
        }
        if (pieces.some((p) => p.lengthFt > stockFt + 1e-9)) return { error: `A bar piece is longer than a ${stockFt}' stick. Try a longer stick.` };
        let slabSticks = laps + sticksToCut(pieces, stockFt);
        rows.push({
          label: 'Slab bars',
          value: feet(ft),
          note: `${commas(segs.length)} bars cut to the shape, #${bar.size} at ${dec(spacing)}" both ways · ${commas(laps)} laps${
            bent ? ` · ${commas(bent)} ends bent down ${inches(legFt * 12)} into the edge` : ''
          }`,
        });
        if (tie === 'lbars') {
          const k = countAlong(centerline * 12, spacing);
          const len = lapFt + legFt;
          slabSticks += sticksToCut([{ lengthFt: len, count: k }], stockFt);
          ft += k * len;
          rows.push({ label: 'Edge L-bars', value: `${commas(k)} × ${ftIn(len)}`, note: `${inches(lapFt * 12)} into the slab, ${inches(legFt * 12)} down into the edge, every ${dec(spacing)}"` });
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
        const r = beamBars(centerline, lines, bar, stockFt, lapFt, squareCorners);
        const curves = sides.filter((s, k) => both(k) && s.radius > 0).length;
        rows.push({
          label: 'Footing bars',
          value: feet(r.totalFt),
          note: `${lines} #${bar.size} bars along the edge · ${commas(r.cornerBars)} corner L-bars ${ftIn(r.cornerBarFt)} (${inches(lapFt * 12)} legs)${
            curves ? ` · bent around ${curves} ${curves === 1 ? 'curve' : 'curves'}` : ''
          } · ${commas(r.laps)} laps`,
        });
        addSticks(bar, r.sticks);
        totalLb += r.lb;
      }

      if (dowelSides.length) {
        const bar = getBar(inp.choice('dowelSize'));
        const spacing = inp.num('dowelSpacing');
        const len = inp.len('dowelLength');
        if (spacing <= 0) return { error: 'Dowel spacing must be more than 0.' };
        if (len <= 0 || len > stockFt) return { error: `Dowel length must be more than 0 and fit in a ${stockFt}' stick.` };
        const count = dowelSides.reduce((a, { k }) => a + dowelCount(straight(L, k), spacing), 0);
        const where = [...new Set(dowelSides.map(({ s }) => EDGE_NAME[s.edge]))].join(' and ');
        rows.push({
          label: 'Dowels',
          value: `${commas(count)} × ${ftIn(len)}`,
          note: `#${bar.size} every ${dec(spacing)}" into the ${where} (sides ${dowelSides.map(({ k }) => k + 1).join(', ')}) · drill and epoxy about ${inches((len * 12) / 2)}`,
        });
        addSticks(bar, sticksToCut([{ lengthFt: len, count }], stockFt));
        totalLb += weightLb(bar, count * len);
      }

      for (const [size, k] of [...sticks].sort((a, b) => a[0] - b[0])) rows.push({ label: `#${size} sticks`, value: `${commas(k)} × ${stockFt}'` });
      rows.push({ label: 'Rebar weight', value: lb(totalLb), note: tons(totalLb / LB_PER_TON) });
    }
    return { rows, warnings };
  },
  notes: ['Edge yards count only the part below the slab.'],
};
