// A Foundation layout item stands for several pieces: the walls, the footing under them and each slab
// (its own pour). It's figured as those pieces, with the row labels every other part of the app reads
// (As measured, Along the middle, Slab area, Order, rebar rows), so totals, the bill, bid pick-lists, the
// crew sheet and the rebar schedule work without knowing about layouts.

import type { JobItem } from '../lib/jobs';
import { ALL_TOOLS } from '../tools';
import { commasTrim, ftIn } from '../tools/format';
import { defaultRaw, RawLength, RawValues, runTool } from '../tools/run';
import type { ResultRow, ToolContext } from '../tools/types';
import { buildLayout, Layout, LayoutSpec } from './foundationLayout';
import { DEFAULT_FORMS, formsRows, FormsSetup, layoutForms } from './layoutForms';
import type { FiguredItem } from './report';
import { layoutSteel, LayoutSteel, PieceSteel } from './layoutRebar';
import { ledgeOf } from './slabLedge';
import type { Pt } from './wallGraph';

export const LAYOUT_TOOL_ID = 'foundation-layout';

/** A layout's pieces that are each a pour: footings, walls, each slab pour, each step or pad. */
export const LAYOUT_POUR = /:(footings|walls|slab\d+|piece\d+)$/;

/** What a layout item saves: the layout, and the boxes for the pieces (rebar, waste, price ...). */
export interface LayoutRaw {
  layout: LayoutSpec;
  /** Footings & Walls boxes for the walls (bars, lines, barSize, vSpacing, stockLength, lap, waste, price) */
  wall?: RawValues;
  footing?: RawValues;
  /** Slab boxes (rebar, waste, price ...) for every slab */
  slab?: RawValues;
  /** Aluminum wall forms (panel width, heights, fillers); false = the walls aren't formed with panels */
  forms?: FormsSetup | false;
}

const toRaw = (ft: number): RawLength => {
  const whole = Math.floor(ft + 1e-9);
  const inch = Math.round((ft - whole) * 12 * 16) / 16;
  return inch >= 12 ? { ft: String(whole + 1), in: '' } : { ft: String(whole), in: inch ? String(inch) : '' };
};

const ftText = (ft: number) => ftIn(ft).replace(/ 0"$/, '');

/** One group's runs the way he adds them up: "4 @ 40' + 1 @ 70' = 230'" */
export function rollUp(runs: { measured: number }[]): string {
  const by = new Map<number, number>();
  for (const r of runs) {
    const k = Math.round(r.measured * 96) / 96;
    by.set(k, (by.get(k) ?? 0) + 1);
  }
  const total = runs.reduce((s, r) => s + r.measured, 0);
  return `${[...by].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([len, n]) => `${n} @ ${ftText(len)}`).join(' + ')} = ${ftText(total)}`;
}

/** "Main 4 @ 70' = 280' · Add-on 4 @ 40' + 1 @ 70' = 230'" (walls in the bid only) */
export function runList(l: Layout): string {
  const groups = [...new Set(l.runs.filter((r) => !r.existing).map((r) => r.group))];
  return groups.map((g) => `${g} ${rollUp(l.runs.filter((r) => r.group === g && !r.existing))}`).join(' · ');
}

/** An orthogonal outline cut into rectangles (strips between its corners), for the Slab tool's areas. */
export function rectsOf(pts: Pt[]): { w: number; h: number }[] {
  const ys = [...new Set(pts.map((p) => Math.round(p.y * 1e6) / 1e6))].sort((a, b) => a - b);
  const out: { w: number; h: number }[] = [];
  for (let i = 1; i < ys.length; i++) {
    const y = (ys[i - 1] + ys[i]) / 2;
    const xs: number[] = [];
    for (let k = 0, j = pts.length - 1; k < pts.length; j = k++) {
      const a = pts[k];
      const b = pts[j];
      if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) out.push({ w: xs[k + 1] - xs[k], h: ys[i] - ys[i - 1] });
  }
  return out;
}

/** The walls, the footing and each slab of a layout item, figured. */
export function layoutChildren(item: JobItem): FiguredItem[] {
  const raw = item.raw as unknown as LayoutRaw;
  if (!raw?.layout?.house) return [];
  const l = buildLayout(raw.layout);
  const spec = l.spec;
  const footingsTool = ALL_TOOLS.find((x) => x.id === 'footings')!;
  const slabTool = ALL_TOOLS.find((x) => x.id === 'slab')!;
  const out: FiguredItem[] = [];
  const bends = l.totals.bends;
  const list = runList(l);
  const turns = `${l.totals.corners} corners, ${l.totals.tees} tees`;
  const ledge = ledgeOf(l);
  const inch = (ft: number) => `${commasTrim(ft * 12, 1)}"`;
  // The layout's own rebar and bolts, once they're set. Before that, the old boxes, as they were.
  let steel: LayoutSteel | null = null;
  let steelProblem = '';
  try {
    steel = spec.rebar ? layoutSteel(l, spec.rebar) : null;
  } catch (e) {
    steelProblem = e instanceof Error ? e.message : String(e);
  }
  const own = !!spec.rebar;
  const child = (suffix: string, label: string, tool: typeof footingsTool, r: RawValues, extra: ResultRow[], ctx?: ToolContext, ps?: PieceSteel | null): FiguredItem => {
    const res = runTool(tool, r, ctx);
    const warnings = [...(res.status === 'ok' ? (res.result.warnings ?? []) : []), ...l.problems, ...(steelProblem && suffix === 'walls' ? [steelProblem] : [])];
    const result = res.status === 'ok' ? { ...res, result: { ...res.result, rows: [...extra, ...res.result.rows, ...(ps?.rows ?? [])], warnings } } : res;
    return { item: { ...item, id: `${item.id}:${suffix}`, toolId: tool.id, title: tool.title, label, raw: r }, tool, result, inputs: [] };
  };

  // Walls: concrete and bars along the middle, an L-bar per bar at every corner and tee. Walls that are
  // already there aren't in it.
  if (l.totals.measured > 0) {
  const wallRaw = defaultRaw(footingsTool, {
    ...(raw.wall ?? {}),
    ...(own ? { bars: '' } : {}),
    kind: 'wall',
    shape: 'run',
    length: toRaw(l.totals.middle),
    qty: '1',
    corners: String(bends),
    depth: toRaw(spec.wall.height),
    width: toRaw(spec.wall.thick),
  });
  out.push(
    child('walls', 'Walls', footingsTool, wallRaw, [
      { label: 'As measured', value: `${commasTrim(l.totals.measured, 1)} ft`, note: list },
      { label: 'Along the middle', value: `${commasTrim(l.totals.middle, 1)} ft`, note: `What the concrete and bars follow · ${turns}: each wall that meets another stops at its face` },
    ],
    ledge
      ? {
          less: {
            cuFt: ledge.wallLessCuFt,
            label: 'Slab ledge',
            note: `${inch(ledge.e)} cut back from the bottom of the slab to the top of the wall, ${commasTrim(ledge.length, 1)} ft along the slab sides`,
          },
        }
      : undefined,
    steel?.walls),
  );
  }

  // The footing under every new wall.
  if (spec.footing && l.totals.footingMiddle > 0) {
    const footRaw = defaultRaw(footingsTool, {
      ...(raw.footing ?? {}),
      ...(own ? { bars: '' } : {}),
      kind: 'footing',
      shape: 'run',
      length: toRaw(l.totals.footingMiddle),
      qty: '1',
      corners: String(bends),
      depth: toRaw(spec.footing.depth),
      width: toRaw(spec.footing.width),
    });
    out.push(
      child('footings', 'Footings', footingsTool, footRaw, [
        { label: 'Along the middle', value: `${commasTrim(l.totals.footingMiddle, 1)} ft`, note: `Centered under the walls · ${turns}: each footing that meets another stops at its edge` },
      ], undefined, steel?.footing),
    );
  }

  // Wall forms: panels, fillers and corners for every face (the job's load list reads these).
  if (raw.forms !== false && l.totals.measured > 0) {
    const setup = raw.forms || DEFAULT_FORMS;
    const f = layoutForms(l, setup);
    const formsTool = ALL_TOOLS.find((x) => x.id === 'wall-forms')!;
    const ledgeRows: ResultRow[] = ledge
      ? [{ label: 'Slab ledge blockout', value: `${commasTrim(ledge.length, 1)} ft`, note: `A ${inch(ledge.e)} strip on the inside forms, from the bottom of the slab to the top of the wall (${ledge.slabs.map((x) => inch(x.notchH)).filter((v, i, a) => a.indexOf(v) === i).join(', ')} tall), where a slab meets the wall` }]
      : [];
    if (f) out.push({ item: { ...item, id: `${item.id}:forms`, toolId: formsTool.id, title: formsTool.title, label: 'Wall forms', raw: {} }, tool: formsTool, result: { status: 'ok', result: { rows: [...formsRows(f, setup), ...ledgeRows] } }, inputs: [] });
  }

  // Each slab pour (one or more areas poured together), at the clear size inside the walls.
  for (const pour of [...new Set(l.slabs.map((s) => s.pour))].sort((a, b) => a - b)) {
    const these = l.slabs.filter((s) => s.pour === pour);
    // On a ledge it's poured out over it: a rectangle grows by the ledge each way, any other shape gets
    // the strip as one more area (same square feet).
    const onLedge = (s: (typeof these)[number]) => ledge?.slabs.find((x) => x.slab === l.slabs.indexOf(s));
    const rects = these.flatMap((s) => {
      const lg = onLedge(s);
      const base = s.face.rect ? [s.face.rect] : rectsOf(s.face.clear);
      if (!lg || !ledge) return base;
      return s.face.rect ? [{ w: s.face.rect.w + 2 * ledge.e, h: s.face.rect.h + 2 * ledge.e }] : [...base, { w: lg.strip / ledge.e, h: ledge.e }];
    });
    const slabRaw = defaultRaw(slabTool, {
      ...(raw.slab ?? {}),
      ...(own ? { slabRebar: '', footBars: '' } : {}),
      thick: toRaw(these[0].thick),
      areas: rects.map((r) => ({ length: toRaw(r.w), width: toRaw(r.h) })) as never,
    });
    const size = these.map((s) => (s.face.rect ? `${ftIn(s.face.rect.w)} × ${ftIn(s.face.rect.h)}` : `${Math.round(s.face.clearArea).toLocaleString()} sq ft`)).join(' + ');
    const outer = these.reduce((sum, s) => sum + s.face.outerArea, 0);
    out.push(
      child(`slab${pour}`, `Slab ${pour}: ${these.map((s) => s.name).join(' + ')}`, slabTool, slabRaw, [
        { label: 'Pour', value: `Slab ${pour}`, note: `Inside the walls: ${size}` },
        { label: 'To the outside of the walls', value: `${commasTrim(outer, 1)} sq ft`, note: 'The size it is usually bid at; yards are for what is poured inside' },
        ...(these.some(onLedge) && ledge
          ? [
              {
                label: 'On the ledge',
                value: `${inch(ledge.e)} under the walls`,
                note: `Clear ${size} at the top; poured ${these.map((s) => (s.face.rect ? `${ftIn(s.face.rect.w + 2 * ledge.e)} × ${ftIn(s.face.rect.h + 2 * ledge.e)}` : `${Math.round(s.face.clearArea + (onLedge(s)?.strip ?? 0)).toLocaleString()} sq ft`)).join(' + ')}`,
              },
            ]
          : []),
      ], undefined, steel?.slabs.get(pour)),
    );
  }

  // Steps and pads: each its own piece and pour, figured with the Steps tool (steps) or the Slab tool (pads).
  const stepsTool = ALL_TOOLS.find((x) => x.id === 'steps')!;
  const order = (raw.slab ?? {}) as RawValues;
  const keep = (r: RawValues, keys: string[]) => Object.fromEntries(keys.filter((k) => r[k] !== undefined).map((k) => [k, r[k]]));
  const firstPour = (spec.footing ? 1 : 0) + 1 + new Set(l.slabs.map((s) => s.pour)).size;
  l.pieces
    .filter((pc) => pc.layers.length)
    .forEach((pc, i) => {
      const ps = pc.spec;
      const rows: ResultRow[] = [
        { label: 'Pour', value: `Pour ${firstPour + i + 1}`, note: pc.describe },
        ...(pc.curvedForm ? [{ label: 'Curved form', value: `${commasTrim(pc.curvedForm, 1)} ft`, note: ps.kind === 'steps' ? 'Each riser, bender board or ply strips' : 'Round the edge' }] : []),
        ...(pc.straightForm ? [{ label: 'Straight form', value: `${commasTrim(pc.straightForm, 1)} ft`, note: ps.kind === 'steps' ? 'Risers across the front and both sides of each step' : 'The open edges' }] : []),
        { label: 'Finish', value: `${commasTrim(pc.topArea, 1)} sq ft`, note: ps.kind === 'steps' ? 'Treads and the top' : 'The top' },
      ];
      const label = `${pc.name}: ${pc.describe.split(',')[0]}`;
      if (ps.kind === 'steps') {
        const r = defaultRaw(stepsTool, {
          ...keep(order, ['waste', 'truck', 'price']),
          shape: ps.shape === 'half' ? 'radius' : ps.shape,
          steps: String(ps.steps ?? 1),
          rise: toRaw(ps.rise ?? 7 / 12),
          run: toRaw(ps.tread ?? 1),
          ...(ps.shape === 'square' ? { width: toRaw(ps.width ?? 0) } : { diameter: toRaw(ps.diameter ?? 0) }),
        });
        out.push(child(`piece${i + 1}`, label, stepsTool, r, rows, undefined, steel?.pieces.get(pc.index)));
      } else {
        // The Slab tool by area: a square pad as its size, a round one as its area (a 1 ft wide strip).
        const r = defaultRaw(slabTool, {
          ...keep(order, ['waste', 'truck', 'price']),
          thick: toRaw(ps.thick ?? 4 / 12),
          areas: (ps.shape === 'square' ? [{ length: toRaw(ps.width ?? 0), width: toRaw(ps.depth ?? 0) }] : [{ length: toRaw(pc.topArea), width: toRaw(1) }]) as never,
        });
        out.push(child(`piece${i + 1}`, label, slabTool, r, rows, undefined, steel?.pieces.get(pc.index)));
      }
    });
  return out;
}
