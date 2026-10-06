// A Foundation layout item stands for several pieces: the walls, the footing under them and each slab
// (its own pour). It's figured as those pieces, with the row labels every other part of the app reads
// (As measured, Along the middle, Slab area, Order, rebar rows), so totals, the bill, bid pick-lists, the
// crew sheet and the rebar schedule work without knowing about layouts.

import type { JobItem } from '../lib/jobs';
import { ALL_TOOLS } from '../tools';
import { commasTrim, ftIn } from '../tools/format';
import { defaultRaw, RawLength, RawValues, runTool } from '../tools/run';
import type { ResultRow } from '../tools/types';
import { buildLayout, Layout, LayoutSpec } from './foundationLayout';
import type { FiguredItem } from './report';
import type { Pt } from './wallGraph';

export const LAYOUT_TOOL_ID = 'foundation-layout';

/** What a layout item saves: the layout, and the boxes for the pieces (rebar, waste, price ...). */
export interface LayoutRaw {
  layout: LayoutSpec;
  /** Footings & Walls boxes for the walls (bars, lines, barSize, vSpacing, stockLength, lap, waste, price) */
  wall?: RawValues;
  footing?: RawValues;
  /** Slab boxes (rebar, waste, price ...) for every slab */
  slab?: RawValues;
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
  const child = (suffix: string, label: string, tool: typeof footingsTool, r: RawValues, extra: ResultRow[]): FiguredItem => {
    const res = runTool(tool, r);
    const result = res.status === 'ok' ? { ...res, result: { ...res.result, rows: [...extra, ...res.result.rows], warnings: [...(res.result.warnings ?? []), ...l.problems] } } : res;
    return { item: { ...item, id: `${item.id}:${suffix}`, toolId: tool.id, title: tool.title, label, raw: r }, tool, result, inputs: [] };
  };

  // Walls: concrete and bars along the middle, an L-bar per bar at every corner and tee. Walls that are
  // already there aren't in it.
  if (l.totals.measured > 0) {
  const wallRaw = defaultRaw(footingsTool, {
    ...(raw.wall ?? {}),
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
    ]),
  );
  }

  // The footing under every new wall.
  if (spec.footing && l.totals.footingMiddle > 0) {
    const footRaw = defaultRaw(footingsTool, {
      ...(raw.footing ?? {}),
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
      ]),
    );
  }

  // Each slab pour (one or more areas poured together), at the clear size inside the walls.
  for (const pour of [...new Set(l.slabs.map((s) => s.pour))].sort((a, b) => a - b)) {
    const these = l.slabs.filter((s) => s.pour === pour);
    const rects = these.flatMap((s) => (s.face.rect ? [s.face.rect] : rectsOf(s.face.clear)));
    const slabRaw = defaultRaw(slabTool, {
      ...(raw.slab ?? {}),
      thick: toRaw(these[0].thick),
      areas: rects.map((r) => ({ length: toRaw(r.w), width: toRaw(r.h) })) as never,
    });
    const size = these.map((s) => (s.face.rect ? `${ftIn(s.face.rect.w)} × ${ftIn(s.face.rect.h)}` : `${Math.round(s.face.clearArea).toLocaleString()} sq ft`)).join(' + ');
    out.push(child(`slab${pour}`, `Slab ${pour}: ${these.map((s) => s.name).join(' + ')}`, slabTool, slabRaw, [{ label: 'Pour', value: `Slab ${pour}`, note: `Inside the walls: ${size}` }]));
  }
  return out;
}
