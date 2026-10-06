// Rebar tools: slab mats, beam & footing bars, stirrups, cut lists, bar weights,
// dowels / anchor bolts, wire mesh. The math lives in src/lib/rebar.ts.

import {
  anchorsPerWall,
  Bar,
  BARS,
  beamBars,
  countAlong,
  cutPatterns,
  getBar,
  hook180ExtIn,
  hook90ExtIn,
  LB_PER_TON,
  lapIn,
  minBendDiaIn,
  piecesToCover,
  RunPlan,
  minSticks,
  slabBarsAdvice,
  slabGrid,
  sticksToCut,
  tieCutLengthIn,
  TieHook,
  tieHookExtIn,
  weightLb,
} from '../lib/rebar';
import { commas, commasTrim, dec, ftIn, inches, lb, sqFt, tons } from './format';
import { ChoiceField, Inputs, NumberField, ResultRow, Tool } from './types';

// ---------------------------------------------------------------------------------------------
// Shared boxes and answer rows

function barSizeField(from: number, to: number, def: string, label = 'Bar size'): ChoiceField {
  return {
    key: 'barSize',
    label,
    kind: 'choice',
    options: BARS.filter((b) => b.size >= from && b.size <= to).map((b) => ({ value: String(b.size), label: `#${b.size}` })),
    default: def,
  };
}

const STICK_FIELD: ChoiceField = {
  key: 'stockLength',
  label: 'Stick length',
  kind: 'choice',
  options: [20, 30, 40, 60].map((n) => ({ value: String(n), label: `${n}'` })),
  default: '20',
};

const LAP_FIELD: NumberField = {
  key: 'lap',
  label: 'Lap',
  kind: 'number',
  unit: 'in',
  optional: true,
  help: 'Blank = 20" on #4, 25" on #5, 30" on #6',
};

/** Stirrups and dowels are cut from 20' sticks. */
const SHORT_STOCK_FT = 20;

/** 845.83 → "845.8 ft" */
const feet = (n: number) => `${commasTrim(n, 1)} ft`;

/** Weight with more decimals for small amounts: 0.38 lb, 20.9 lb, 565 lb. */
function pounds(n: number): string {
  if (n < 10) return `${dec(n, 2)} lb`;
  if (n < 100) return `${dec(n, 1)} lb`;
  return lb(n);
}

/** Rounded UP to the next 1/8" */
const up8 = (inch: number) => Math.ceil(inch * 8 - 1e-6) / 8;

const plural = (n: number, word: string) => `${commas(n)} ${word}${n === 1 ? '' : 's'}`;

/** The lap in inches: what was typed, or 40 × the bar size when blank (#4 = 20"). */
function lapUsed(inp: Inputs, bar: Bar): { lap: number; row: ResultRow } {
  const lap = inp.has('lap') ? inp.num('lap') : lapIn(bar);
  return { lap, row: { label: 'Lap', value: inches(lap) } };
}

function weightRow(bar: Bar, ft: number): ResultRow {
  const w = weightLb(bar, ft);
  return { label: 'Weight', value: pounds(w), big: true, note: tons(w / LB_PER_TON) };
}

const sticksRow = (sticks: number, stockFt: number, note?: string): ResultRow => ({
  label: 'Sticks to order',
  value: `${commas(sticks)} × ${stockFt}'`,
  big: true,
  note,
});

/** "2 sticks lapped together" – only when a run needs more than one stick. */
function runNote(run: RunPlan): string | undefined {
  if (run.pieces === 1) return undefined;
  return `${run.pieces} sticks lapped together`;
}

// ---------------------------------------------------------------------------------------------

const slabRebar: Tool = {
  id: 'slab-rebar',
  title: 'Slab Rebar',
  blurb: 'Bars both ways, laps, sticks and weight',
  fields: [
    { key: 'length', label: 'Length', kind: 'length' },
    { key: 'width', label: 'Width', kind: 'length' },
    { key: 'thick', label: 'Slab thickness', kind: 'length', default: { in: '4' } },
    { key: 'pickBars', label: 'Pick my own bars', kind: 'toggle', help: 'Off: sized for how long and thick the slab is' },
    { ...barSizeField(3, 8, '4'), showIf: ['pickBars'] },
    { key: 'spacing', label: 'On center', kind: 'number', unit: 'in', default: '18', showIf: ['pickBars'] },
    { key: 'cover', label: 'From edge', kind: 'number', unit: 'in', default: '3', help: 'Slab edge to the first bar' },
    STICK_FIELD,
    LAP_FIELD,
    { key: 'layers', label: 'Mats', kind: 'count', default: '1', help: '2 = top and bottom' },
    { key: 'chairSpacing', label: 'Chairs every', kind: 'number', unit: 'ft', optional: true },
  ],
  compute: (inp) => {
    const lengthFt = inp.len('length');
    const widthFt = inp.len('width');
    const thickFt = inp.len('thick');
    const own = inp.on('pickBars');
    if (!own && thickFt <= 0) return { error: 'Thickness must be more than 0.' };
    // Your own bars, or sized for the slab's length and thickness (a small slab gets just the edge bar).
    const advice = slabBarsAdvice(thickFt * 12, Math.max(lengthFt, widthFt));
    const matOn = own || !advice.edgeOnly;
    const bar = getBar(own ? inp.choice('barSize') : advice.size);
    const spacingIn = own ? inp.num('spacing') : advice.spacingIn;
    const coverIn = inp.num('cover');
    const stockFt = Number(inp.choice('stockLength'));
    const layers = inp.count('layers');
    const chairSpacingFt = inp.num('chairSpacing');
    const { lap, row: lapRow } = lapUsed(inp, bar);

    if (spacingIn <= 0) return { error: 'On center must be more than 0.' };
    if (lengthFt - (2 * coverIn) / 12 <= 0 || widthFt - (2 * coverIn) / 12 <= 0) {
      return { error: 'The edge distance leaves no room for bars.' };
    }
    if (lap / 12 >= stockFt) return { error: `The lap must be shorter than a ${stockFt}' stick.` };
    if (layers < 1) return { error: 'Mats must be at least 1.' };
    if (inp.has('chairSpacing') && chairSpacingFt <= 0) return { error: 'Chair spacing must be more than 0.' };

    // A bar around the edge, at the edge distance, with an L-bar at each corner (same size as the slab bars).
    const edgeRun = 2 * (lengthFt + widthFt) - (8 * coverIn) / 12;
    const e = beamBars(edgeRun, 1, bar, stockFt, lap / 12, 4);
    const edgeRow: ResultRow = {
      label: 'Edge bar',
      value: feet(e.totalFt),
      note: `1 #${bar.size} around the edge · 4 corner L-bars ${ftIn(e.cornerBarFt)} · ${commas(e.laps)} laps`,
    };
    const why = own ? undefined : `Sized for a ${ftIn(Math.max(lengthFt, widthFt))} long, ${inches(thickFt * 12)} slab: #${bar.size} at ${dec(spacingIn)}"`;

    if (!matOn) {
      return {
        rows: [
          {
            label: 'Bars both ways',
            value: 'Edge bar only',
            note: `Small enough (${ftIn(Math.max(lengthFt, widthFt))} long, ${inches(thickFt * 12)} thick) that a bar around the edge is enough`,
          },
          edgeRow,
          lapRow,
          { label: 'Total footage', value: feet(e.totalFt), big: true },
          sticksRow(e.sticks, stockFt),
          weightRow(bar, e.totalFt),
        ],
      };
    }

    const g = slabGrid({ lengthFt, widthFt, bar, spacingIn, coverIn, stockFt, lapIn: lap, layers, chairSpacingFt });
    const perMat = layers > 1 ? 'Each mat' : undefined;
    const join = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(', ') || undefined;
    const totalFt = g.totalFt + e.totalFt;
    const sticks = g.sticks + e.sticks;
    const minS = minSticks(totalFt, stockFt);
    const rows: ResultRow[] = [
      { label: 'Bars long way', value: `${commas(g.alongLength.count)} × ${ftIn(g.alongLength.runFt)}`, note: join(perMat, runNote(g.alongLength), why) },
      { label: 'Bars short way', value: `${commas(g.alongWidth.count)} × ${ftIn(g.alongWidth.runFt)}`, note: join(perMat, runNote(g.alongWidth)) },
      edgeRow,
      lapRow,
      { label: 'Number of laps', value: commas(g.laps + e.laps) },
      { label: 'Total footage', value: feet(totalFt), big: true },
      sticksRow(sticks, stockFt, minS < sticks ? `${commas(minS)} if you use the cut-offs` : undefined),
      weightRow(bar, totalFt),
    ];
    if (g.chairs) rows.push({ label: 'Chairs', value: commas(g.chairs) });
    return { rows };
  },
  notes: ['Bars start at the edge distance and are never farther apart than the on center. A bar runs around the edge.'],
};

// ---------------------------------------------------------------------------------------------

const beamBarsTool: Tool = {
  id: 'beam-bars',
  title: 'Beam & Footing Bars',
  blurb: 'Bars running the length, laps, corner bars, sticks',
  fields: [
    { key: 'run', label: 'Length', kind: 'length', help: 'Total length, like the whole perimeter' },
    { key: 'bars', label: 'Number of bars', kind: 'count', default: '4', help: '2 top + 2 bottom = 4' },
    barSizeField(3, 8, '5'),
    STICK_FIELD,
    LAP_FIELD,
    { key: 'corners', label: 'Corners', kind: 'count', optional: true, help: 'Adds an L-bar at each corner for every bar' },
  ],
  compute: (inp) => {
    const runFt = inp.len('run');
    const lines = inp.count('bars');
    const bar = getBar(inp.choice('barSize'));
    const stockFt = Number(inp.choice('stockLength'));
    const corners = inp.count('corners');
    const { lap, row: lapRow } = lapUsed(inp, bar);

    if (runFt <= 0) return { error: 'Length must be more than 0.' };
    if (lines < 1) return { error: 'Enter at least 1 bar.' };
    if (lap / 12 >= stockFt) return { error: `The lap must be shorter than a ${stockFt}' stick.` };
    if (corners > 0 && lap <= 0) return { error: 'Corner bars need a lap.' };
    if (corners > 0 && (2 * lap) / 12 > stockFt) return { error: `A corner bar won’t fit in a ${stockFt}' stick.` };

    const r = beamBars(runFt, lines, bar, stockFt, lap / 12, corners);
    const rows: ResultRow[] = [
      lapRow,
      { label: 'Number of laps', value: commas(r.laps) },
    ];
    if (r.cornerBars) {
      rows.push({ label: 'Corner bars', value: `${commas(r.cornerBars)} × ${ftIn(r.cornerBarFt)}`, note: `L-bars, ${inches(lap)} each leg` });
    }
    rows.push(
      { label: 'Total footage', value: feet(r.totalFt), big: true },
      sticksRow(r.sticks, stockFt, r.minSticks < r.sticks ? `${commas(r.minSticks)} if you use the cut-offs` : undefined),
      weightRow(bar, r.totalFt),
    );
    return { rows };
  },
  notes: ['Every bar runs the full length, lapped where sticks join.'],
};

// ---------------------------------------------------------------------------------------------

const stirrups: Tool = {
  id: 'stirrups',
  title: 'Stirrups & Ties',
  blurb: 'How many, cut length with hooks, sticks',
  fields: [
    { key: 'run', label: 'Length', kind: 'length', help: 'Length of beam that gets stirrups' },
    { key: 'spacing', label: 'On center', kind: 'number', unit: 'in', default: '24' },
    { key: 'width', label: 'Beam width', kind: 'number', unit: 'in' },
    { key: 'depth', label: 'Beam depth', kind: 'number', unit: 'in' },
    { key: 'cover', label: 'Cover', kind: 'number', unit: 'in', default: '1.5', help: 'Concrete outside the stirrup. 1-1/2" is common.' },
    barSizeField(3, 5, '3'),
    {
      key: 'hook',
      label: 'Hook',
      kind: 'choice',
      options: [
        { value: '135', label: '135°' },
        { value: '90', label: '90°' },
      ],
      default: '135',
    },
  ],
  compute: (inp) => {
    const runFt = inp.len('run');
    const spacingIn = inp.num('spacing');
    const widthIn = inp.num('width');
    const depthIn = inp.num('depth');
    const coverIn = inp.num('cover');
    const bar = getBar(inp.choice('barSize'));
    const hook = Number(inp.choice('hook')) as TieHook;

    if (runFt <= 0) return { error: 'Length must be more than 0.' };
    if (spacingIn <= 0) return { error: 'On center must be more than 0.' };
    const outW = widthIn - 2 * coverIn;
    const outD = depthIn - 2 * coverIn;
    if (outW <= 0 || outD <= 0) return { error: 'The cover leaves no room for a stirrup.' };

    const ext = tieHookExtIn(bar, hook);
    const cutIn = tieCutLengthIn(widthIn, depthIn, coverIn, bar, hook);
    if (cutIn > SHORT_STOCK_FT * 12) return { error: `Each stirrup would be ${ftIn(cutIn / 12)}, longer than a 20' stick.` };

    const count = countAlong(runFt * 12, spacingIn);
    const totalFt = (count * cutIn) / 12;
    const perStick = Math.floor((SHORT_STOCK_FT * 12) / cutIn + 1e-9);
    const sticks = sticksToCut([{ lengthFt: cutIn / 12, count }], SHORT_STOCK_FT);
    return {
      rows: [
        { label: 'Stirrups', value: commas(count), big: true },
        { label: 'Cut length', value: ftIn(cutIn / 12), big: true, note: `${inches(outW)} × ${inches(outD)} with two ${inches(ext)} hooks` },
        { label: 'Total footage', value: feet(totalFt) },
        sticksRow(sticks, SHORT_STOCK_FT, `${plural(perStick, 'stirrup')} per stick`),
        weightRow(bar, totalFt),
      ],
    };
  },
  notes: ['One stirrup at each end, never farther apart than the on center.'],
};

// ---------------------------------------------------------------------------------------------

/** 10' 6" + 9' 0", or 3 × 6' 8" when the same piece repeats */
function describePattern(piecesIn: number[]): string {
  const groups: { len: number; n: number }[] = [];
  for (const p of piecesIn) {
    const g = groups.find((x) => Math.abs(x.len - p) < 1e-9);
    if (g) g.n += 1;
    else groups.push({ len: p, n: 1 });
  }
  return groups.map((g) => (g.n > 1 ? `${g.n} × ${ftIn(g.len / 12)}` : ftIn(g.len / 12))).join(' + ');
}

const MAX_PATTERNS_SHOWN = 8;

const cutList: Tool = {
  id: 'cut-list',
  title: 'Rebar Cut List',
  blurb: 'Your bar marks → sticks, cutting plan, weight',
  fields: [
    {
      key: 'marks',
      label: 'Bar marks',
      kind: 'barlist',
      sizes: ['3', '4', '5', '6', '7', '8'],
      defaultSize: '4',
      help: 'Size, how many, and cut length (hooks included)',
    },
    STICK_FIELD,
    // Never shown: marks a list sent from Slab Layout, so a job doesn't count that steel twice.
    {
      key: 'from',
      label: 'From',
      kind: 'choice',
      options: [
        { value: '', label: '' },
        { value: 'slab-layout', label: 'Slab Layout' },
      ],
      default: '',
      showIf: ['never'],
    },
  ],
  compute: (inp) => {
    const stockFt = Number(inp.choice('stockLength'));
    const marks = inp.bars('marks');
    const tooLong = marks.find((m) => m.length > stockFt + 1e-9);
    if (tooLong) {
      return { error: `A #${tooLong.size} piece ${ftIn(tooLong.length)} long won't fit in a ${stockFt}' stick. Pick a longer stick.` };
    }

    const sizes = [...new Set(marks.map((m) => m.size))].sort((a, b) => Number(a) - Number(b));
    let totalSticks = 0;
    let totalLb = 0;
    const perSize: ResultRow[] = [];
    const stickNotes: string[] = [];
    for (const size of sizes) {
      const bar = getBar(size);
      const these = marks.filter((m) => m.size === size);
      const pieces = these.flatMap((m) => Array<number>(m.qty).fill(m.length * 12));
      const patterns = cutPatterns(pieces, stockFt * 12);
      const sticks = patterns.reduce((s, p) => s + p.count, 0);
      const cutFt = these.reduce((s, m) => s + m.qty * m.length, 0);
      const scrapFt = sticks * stockFt - cutFt;
      totalSticks += sticks;
      totalLb += weightLb(bar, cutFt);
      stickNotes.push(`#${size}: ${commas(sticks)}`);
      perSize.push({ label: `#${size} sticks`, value: `${commas(sticks)} × ${stockFt}'`, note: `${plural(pieces.length, 'piece')}, ${feet(scrapFt)} scrap` });
      for (const p of patterns.slice(0, MAX_PATTERNS_SHOWN)) {
        perSize.push({
          label: `   ${plural(p.count, 'stick')}`,
          value: describePattern(p.piecesIn),
          note: p.scrapIn > 1e-9 ? `${p.scrapIn >= 12 ? ftIn(p.scrapIn / 12) : inches(p.scrapIn)} left over each` : 'No scrap',
        });
      }
      if (patterns.length > MAX_PATTERNS_SHOWN) {
        const rest = patterns.slice(MAX_PATTERNS_SHOWN).reduce((s, p) => s + p.count, 0);
        perSize.push({ label: `   ${plural(rest, 'more stick')}`, value: `${patterns.length - MAX_PATTERNS_SHOWN} other cuts` });
      }
      perSize.push({ label: `#${size} weight`, value: pounds(weightLb(bar, cutFt)) });
    }

    return {
      rows: [
        {
          label: 'Sticks to order',
          value: sizes.length === 1 ? `${commas(totalSticks)} × ${stockFt}'` : commas(totalSticks),
          big: true,
          note: sizes.length > 1 ? stickNotes.join(' · ') : undefined,
        },
        { label: 'Weight', value: pounds(totalLb), big: true, note: tons(totalLb / LB_PER_TON) },
        ...perSize,
      ],
    };
  },
  notes: ['Longest pieces are cut first. Scrap shorter than a piece is not used.'],
};

// ---------------------------------------------------------------------------------------------

const rebarWeight: Tool = {
  id: 'rebar-weight',
  title: 'Rebar Weight & Chart',
  blurb: 'Weight of any bars, plus laps, hooks and bends',
  fields: [
    barSizeField(3, 11, '4'),
    { key: 'count', label: 'How many', kind: 'count', default: '1' },
    { key: 'lengthEach', label: 'Length each', kind: 'length', default: { ft: '20' } },
  ],
  compute: (inp) => {
    const bar = getBar(inp.choice('barSize'));
    const totalFt = inp.count('count') * inp.len('lengthEach');
    const d = bar.diaIn;
    const lapText = [40, 48, 60].map((n) => inches(up8(n * d))).join(' · ');
    return {
      rows: [
        { label: 'Total footage', value: feet(totalFt) },
        weightRow(bar, totalFt),
        { label: 'Bar thickness', value: bar.size <= 8 ? inches(d) : `${dec(d, 3)}"` },
        { label: 'Weight per foot', value: `${dec(bar.lbPerFt, 3)} lb` },
        { label: 'Common laps', value: lapText },
        { label: '90° hook leg', value: inches(up8(hook90ExtIn(bar))) },
        { label: '180° hook leg', value: inches(up8(hook180ExtIn(bar))) },
        { label: 'Smallest bend', value: inches(up8(minBendDiaIn(bar))), note: 'Inside diameter of the bend' },
      ],
    };
  },
  notes: ['Use the lap on your plans.'],
};

// ---------------------------------------------------------------------------------------------

const dowels: Tool = {
  id: 'dowels',
  title: 'Dowels & Anchor Bolts',
  blurb: 'How many along a wall or edge',
  fields: [
    { key: 'wallLength', label: 'Wall length', kind: 'length', help: 'One wall, one slab edge, or one plate' },
    { key: 'spacing', label: 'On center', kind: 'length', default: { ft: '6' } },
    { key: 'endDistance', label: 'From each end', kind: 'number', unit: 'in', default: '12' },
    { key: 'walls', label: 'How many walls', kind: 'count', default: '1' },
    { key: 'dowelLength', label: 'Dowel length', kind: 'length', optional: true, help: 'Rebar dowels only' },
    barSizeField(3, 8, '4', 'Dowel size'),
  ],
  compute: (inp) => {
    const wallFt = inp.len('wallLength');
    const spacingFt = inp.len('spacing');
    const endIn = inp.num('endDistance');
    const walls = inp.count('walls');

    if (wallFt <= 0) return { error: 'Wall length must be more than 0.' };
    if (spacingFt <= 0) return { error: 'On center must be more than 0.' };
    if (walls < 1) return { error: 'Enter at least 1 wall.' };

    const perWall = anchorsPerWall(wallFt, spacingFt, endIn / 12);
    const total = perWall * walls;
    const betweenFt = wallFt - (2 * endIn) / 12;
    const rows: ResultRow[] = [
      { label: 'Per wall', value: commas(perWall), big: true },
      { label: 'Total', value: commas(total), big: true },
    ];
    if (betweenFt > 0) rows.push({ label: 'Actual spacing', value: ftIn(betweenFt / (perWall - 1)) });

    if (inp.has('dowelLength')) {
      const dowelFt = inp.len('dowelLength');
      if (dowelFt <= 0) return { error: 'Dowel length must be more than 0.' };
      if (dowelFt > SHORT_STOCK_FT) return { error: `A dowel is longer than a 20' stick.` };
      const bar = getBar(inp.choice('barSize'));
      const totalFt = total * dowelFt;
      const perStick = Math.floor(SHORT_STOCK_FT / dowelFt + 1e-9);
      rows.push(
        { label: 'Dowel footage', value: feet(totalFt) },
        sticksRow(sticksToCut([{ lengthFt: dowelFt, count: total }], SHORT_STOCK_FT), SHORT_STOCK_FT, `${plural(perStick, 'dowel')} per stick`),
        { label: 'Dowel weight', value: pounds(weightLb(bar, totalFt)) },
      );
    }

    const warnings: string[] = [];
    if (spacingFt > 6 + 1e-9) warnings.push('Anchor bolts: code max is 6 ft on center.');
    if (endIn > 12 + 1e-9) warnings.push('Anchor bolts: code wants one within 12" of each end.');
    if (endIn < 3.5 - 1e-9) warnings.push('Anchor bolts: keep them at least 3-1/2" from the end of the plate.');
    return { rows, warnings };
  },
  notes: ['Every separate plate needs at least 2 bolts.'],
};

// ---------------------------------------------------------------------------------------------

const MESH = {
  '5x10': { w: 5, l: 10, roll: false },
  '8x20': { w: 8, l: 20, roll: false },
  '5x150': { w: 5, l: 150, roll: true },
} as const;

const wireMesh: Tool = {
  id: 'wire-mesh',
  title: 'Wire Mesh',
  blurb: 'Sheets or rolls to cover a slab',
  fields: [
    { key: 'areas', label: 'Slab size', kind: 'areas', help: 'Add more areas for odd shapes' },
    {
      key: 'product',
      label: 'Sheet or roll',
      kind: 'choice',
      options: [
        { value: '5x10', label: "5'×10' sheet" },
        { value: '8x20', label: "8'×20' sheet" },
        { value: '5x150', label: "5'×150' roll" },
      ],
      default: '5x10',
    },
    { key: 'overlap', label: 'Overlap', kind: 'number', unit: 'in', default: '6' },
  ],
  compute: (inp) => {
    const area = inp.areas('areas').reduce((sum, r) => sum + r.length * r.width, 0);
    const p = MESH[inp.choice('product') as keyof typeof MESH];
    const overlapFt = inp.num('overlap') / 12;
    if (area <= 0) return { error: 'The area must be more than 0.' };
    if (overlapFt >= p.w) return { error: `The overlap must be less than ${p.w}'.` };
    const each = (p.w - overlapFt) * (p.l - overlapFt);
    return {
      rows: [
        { label: 'Area', value: sqFt(area) },
        { label: p.roll ? 'Rolls' : 'Sheets', value: commas(piecesToCover(area, each)), big: true, note: `Each covers ${sqFt(each)} after overlap` },
      ],
    };
  },
  notes: ['Add a few extra for cutting around odd shapes.'],
};

export const REBAR_TOOLS: Tool[] = [slabRebar, beamBarsTool, stirrups, cutList, rebarWeight, dowels, wireMesh];
