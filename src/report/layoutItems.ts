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

/** "House top 70' · House right 70' · … · Add-on inside 2 40'" */
export function runList(l: Layout): string {
  return l.runs.map((r) => `${r.name} ${ftIn(r.measured).replace(/ 0"$/, '')}`).join(' · ');
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
  const turns = `${l.graph.corners} corners, ${l.graph.tees} tees`;
  const child = (suffix: string, label: string, tool: typeof footingsTool, r: RawValues, extra: ResultRow[]): FiguredItem => {
    const res = runTool(tool, r);
    const result = res.status === 'ok' ? { ...res, result: { ...res.result, rows: [...extra, ...res.result.rows], warnings: [...(res.result.warnings ?? []), ...l.problems] } } : res;
    return { item: { ...item, id: `${item.id}:${suffix}`, toolId: tool.id, title: tool.title, label, raw: r }, tool, result, inputs: [] };
  };

  // Walls: concrete and bars along the middle, an L-bar per bar at every corner and tee.
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

  // The footing under every wall.
  if (spec.footing) {
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

  // Each slab, its own pour, at the clear size inside the walls.
  for (const s of l.slabs) {
    const rects = s.face.rect ? [s.face.rect] : rectsOf(s.face.clear);
    const slabRaw = defaultRaw(slabTool, {
      ...(raw.slab ?? {}),
      thick: toRaw(s.thick),
      areas: rects.map((r) => ({ length: toRaw(r.w), width: toRaw(r.h) })) as never,
    });
    const size = s.face.rect ? `${ftIn(s.face.rect.w)} × ${ftIn(s.face.rect.h)}` : `${Math.round(s.face.clearArea).toLocaleString()} sq ft`;
    out.push(child(`slab${s.pour}`, `${s.name}, pour ${s.pour}`, slabTool, slabRaw, [{ label: 'Pour', value: String(s.pour), note: `Inside the walls: ${size}` }]));
  }
  return out;
}
