// The job report ("the bill"): every calculation in a job figured fresh, the order added up,
// a blueprint plan and a 3D view, as one printable page (HTML → PDF) or plain text.

import type { Job, JobItem } from '../lib/jobs';
import { companyLine, Settings } from '../lib/settings';
import { ALL_TOOLS, migrateItem } from '../tools';
import { commas, cuYd, dec, ftIn, money } from '../tools/format';
import { isShown, parseLength, parseNumber, RawArea, RawOutlineRow, RawPad, RawValues, RawWallRow, restoreRaw, runTool, RunResult } from '../tools/run';
import { padLoop, solvePad } from '../lib/padSolve';
import { sketchIsoSvg, sketchSvg } from './sketchDraw';
import { footingIsoSvg, sectionWithBarsSvg } from './footingDraw';
import { fieldText } from '../tools/share';
import type { ResultRow, Tool } from '../tools/types';
import { houseSectionSvg, isoSlabSvg, isoSvg, planSvg, roundedLabels, roundedRect, sectionSvg, sideLabels, SlabSide, slabPlanSvg } from './drawings';
import { insetOutline, Pt, wallOutline } from './geometry';
import { layoutIsoSvg, layoutPlanSvg } from './layoutDraw';
import { DocMedia, docCss, logoHtml, noticeHtml } from './docStyle';
import { buildLayout, matBars } from './layoutGeom';
import { confirmedFoundation, Foundation, foundationLines, pourName } from './foundation';
import { daylightWall, splitOutline, WallSteel } from './heightRuns';
import { concreteResult } from '../lib/concrete';
import { AddOnDraw, FoundationDraw, foundationIsoSvg, foundationPlanSvg, foundationSectionSvg } from './foundationDraw';
import { slabBarPlan } from '../tools/slabLayoutTool';
import { LAYOUT_TOOL_ID, layoutChildren, LayoutRaw } from './layoutItems';
import { buildLayout as buildFoundationLayout } from './foundationLayout';
import { graphIsoSvg, graphPlanSvg } from './layoutPlanDraw';
import { slabBarsAdvice } from '../lib/rebar';

export interface FiguredItem {
  item: JobItem;
  tool: Tool;
  result: RunResult;
  inputs: { label: string; value: string }[];
}

export interface Totals {
  concreteOrderYd: number;
  concreteCost: number;
  wallConcreteYd: number;
  rebarLb: number;
  sticks: Map<string, number>;
  panels: Map<string, number>;
  fillers: Map<string, number>;
  insideCorners: number;
  ties: number;
}

/** First number in a value like "16.50 yd", "$2,475.00", "about 351", "565 lb". */
export const numberIn = (v: string): number => {
  const m = v.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : 0;
};

const add = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);

export function figureItems(job: Job): FiguredItem[] {
  const out: FiguredItem[] = [];
  for (const item of job.items) {
    // Taken over by the foundation layout: kept, but not counted.
    if (item.replacedBy) continue;
    // A foundation layout is figured as its pieces: walls, footing, and each slab.
    if (item.toolId === LAYOUT_TOOL_ID) {
      out.push(...layoutChildren(item));
      continue;
    }
    const m = migrateItem(item.toolId, item.raw);
    const tool = ALL_TOOLS.find((t) => t.id === m.toolId);
    if (!tool) continue; // a tool that was removed in an update
    const raw = restoreRaw(tool, m.raw);
    const inputs = tool.fields.flatMap((f) => {
      if (!isShown(f, raw)) return [];
      const v = fieldText(f, raw[f.key]);
      return v === null ? [] : [{ label: f.label, value: v }];
    });
    // Every box filled in (older saved jobs miss boxes added since), so nothing reads a missing one.
    out.push({ item: { ...item, toolId: m.toolId, raw }, tool, result: runTool(tool, raw), inputs });
  }
  return out;
}

/**
 * The job's items as they're really built. Once you've said the walls, footings and slab go together,
 * a one-piece Slab measured to the house size is refigured at the inside of the walls (L − 2 × wall,
 * W − 2 × wall), so its concrete AND its rebar are what goes inside. Other slab shapes keep their
 * numbers and only the concrete order is brought down to the inside.
 */
export function builtItems(items: FiguredItem[], job?: Job): { items: FiguredItem[]; slabInside: boolean } {
  const f = confirmedFoundation(items, job);
  // Walls that change height: their concrete and steel, run by run.
  if (f?.runs && f.outline && !f.runsOver) {
    const wall = f.walls[0];
    const refigured = daylightItem(wall, f);
    if (refigured) items = items.map((x) => (x.item.id === wall.item.id ? refigured : x));
  }
  if (!f?.slab || !f.slabAtOutside || f.slab.tool.id !== 'slab') return { items, slabInside: false };
  const raw = f.slab.item.raw;
  const areas = (raw.areas as RawArea[]) ?? [];
  const filled = areas.filter((a) => parseLength(a.length) !== null);
  if (filled.length !== 1) return { items, slabInside: false };
  const L = (parseLength(filled[0].length) ?? 0) - 2 * f.thickFt;
  const W = (parseLength(filled[0].width) ?? 0) - 2 * f.thickFt;
  if (!(L > 0 && W > 0)) return { items, slabInside: false };
  const toRaw = (ft: number) => ({ ft: String(Math.floor(ft + 1e-9)), in: String(Math.round((ft - Math.floor(ft + 1e-9)) * 12 * 16) / 16) });
  const insideRaw = { ...raw, areas: [{ length: toRaw(L), width: toRaw(W) }] };
  const slab = f.slab;
  const refigured: FiguredItem = { ...slab, result: runTool(slab.tool, insideRaw) };
  return { items: items.map((x) => (x.item.id === slab.item.id ? refigured : x)), slabInside: true };
}

/** A wall item refigured for heights that change around the house. */
function daylightItem(wall: FiguredItem, f: Foundation): FiguredItem | null {
  if (wall.result.status !== 'ok' || !f.runs || !f.outline) return null;
  const raw = wall.item.raw;
  const num = (v: unknown, d: number) => parseNumber(String(v ?? '')) ?? d;
  const isForms = wall.tool.id === 'wall-forms';
  let steel: WallSteel = { horiz: null, vert: null };
  if (isForms && raw.wallRebar === '1') {
    steel = { horiz: { size: num(raw.hBarSize, 4), spacingIn: num(raw.hSpacing, 24) }, vert: { size: num(raw.vBarSize, 4), spacingIn: num(raw.vSpacing, 24) } };
  } else if (!isForms && raw.bars === '1') {
    steel = {
      horiz: { size: num(raw.barSize, 4), spacingIn: 0 },
      horizLines: num(raw.lines, 2),
      vert: String(raw.vSpacing ?? '').trim() ? { size: num(raw.barSize, 4), spacingIn: num(raw.vSpacing, 24) } : null,
    };
  }
  const stockFt = num(raw.stockLength, 20);
  const lap = String(raw.lap ?? '').trim() ? num(raw.lap, 20) : undefined;
  const d = daylightWall(f.outline, f.runs, f.thickFt, f.centerFt, f.outsideFt, steel, stockFt, lap);
  // Wall Forms counts its panels, fillers and corners column by column at each stretch's height.
  const stepped = isForms ? runTool(wall.tool, raw, { heightRuns: f.runs }) : null;
  const base = stepped?.status === 'ok' ? stepped.result : wall.result.result;
  const drop = /^(Concrete in the wall|Cubic yards|Cubic feet|Order|Concrete cost|Trucks|Before waste|Horizontal bars|Vertical bars|Bars along it|Verticals|Rebar weight|#\d+ sticks|.* lb bags)$/;
  const rows: ResultRow[] = base.rows.filter((r) => !drop.test(r.label) && !(r.label === 'Wall height' && !isForms));
  const heights = d.byHeight.map((h) => `${ftIn(h.length)} at ${ftIn(h.height)}`).join(', ');
  const steelRows: ResultRow[] = [];
  if (d.horizFt) steelRows.push({ label: 'Horizontal bars', value: `${commas(Math.round(d.horizFt * 10) / 10, 1)} ft`, note: `More rows where the wall is taller · ${commas(d.horizLaps)} laps · ${commas(d.cornerBars)} corner L-bars` });
  if (d.vertCount) steelRows.push({ label: 'Vertical bars', value: `${commas(d.vertCount)} bars`, note: `${commas(Math.round(d.vertFt))} ft, each cut to its wall height, 3" from the top` });
  for (const [size, k] of [...d.sticks].sort((a, b) => a[0] - b[0])) steelRows.push({ label: `#${size} sticks`, value: `${commas(k)} × ${stockFt}'` });
  if (d.lb) steelRows.push({ label: 'Rebar weight', value: `${commas(Math.round(d.lb))} lb`, note: `${dec(d.lb / 2000, 2)} tons` });
  const concrete: ResultRow[] = [];
  if (isForms) {
    concrete.push({ label: 'Concrete in the wall', value: cuYd(d.cuFt / 27), note: 'No waste added · figured run by run' });
  } else {
    const c = concreteResult(d.cuFt, raw.waste === '' ? 0 : num(raw.waste, 10));
    concrete.push({ label: 'Cubic yards', value: dec(c.cuYd, 2), big: true, note: 'Figured run by run, with waste' });
    concrete.push({ label: 'Order', value: `${c.orderCuYd.toFixed(2)} yd`, big: true, note: 'Rounded up to the next ¼ yard' });
  }
  const warnings = [...(base.warnings ?? [])];
  return {
    ...wall,
    result: {
      status: 'ok',
      result: { rows: [{ label: 'Wall heights', value: 'Change', note: heights }, ...rows, ...concrete, ...steelRows], warnings },
    },
  };
}

/** Adds up the order across everything in the job. */
export function jobTotals(items: FiguredItem[], job?: Job): Totals {
  const built = builtItems(items, job);
  const t = rawTotals(built.items);
  if (built.slabInside) return t;
  // A slab measured to the outside of basement or stem walls is poured inside them: order for the inside
  // (once you've said they go together).
  const f = confirmedFoundation(items, job);
  if (f?.slabOrder && f.slabOrder.inside < f.slabOrder.asMeasured) {
    const { asMeasured, inside } = f.slabOrder;
    const cost = f.slab && f.slab.result.status === 'ok' ? f.slab.result.result.rows.find((r) => r.label === 'Concrete cost') : undefined;
    t.concreteOrderYd = Math.round((t.concreteOrderYd - asMeasured + inside) * 100) / 100;
    if (cost && asMeasured > 0) t.concreteCost = Math.round((t.concreteCost - numberIn(cost.value) * (1 - inside / asMeasured)) * 100) / 100;
  }
  return t;
}

function rawTotals(items: FiguredItem[]): Totals {
  const t: Totals = {
    concreteOrderYd: 0,
    concreteCost: 0,
    wallConcreteYd: 0,
    rebarLb: 0,
    sticks: new Map(),
    panels: new Map(),
    fillers: new Map(),
    insideCorners: 0,
    ties: 0,
  };
  // A cut list sent from Slab Layout is that slab's steel, cut up: count it once, from the cut list.
  const cutFromLayout = items.some((f) => f.tool.id === 'cut-list' && f.item.raw.from === 'slab-layout' && f.result.status === 'ok');
  for (const { item, tool, result } of items) {
    if (result.status !== 'ok') continue;
    const rows = result.result.rows;
    const steel = !(cutFromLayout && tool.id === 'slab-layout');
    const row = (label: string) => rows.find((r) => r.label === label);
    if (row('Order')) t.concreteOrderYd += numberIn(row('Order')!.value);
    if (row('Concrete cost')) t.concreteCost += numberIn(row('Concrete cost')!.value);
    if (tool.id === 'wall-forms') {
      t.wallConcreteYd += numberIn(row('Concrete in the wall')?.value ?? '0');
      const heights = (row('Wall height') && rows.find((r) => r.label.endsWith(' panels'))) || undefined;
      if (heights) {
        // "192 × 5' + 192 × 3'" when stacked; otherwise one height = the wall height.
        const note = heights.note?.split('\n')[0] ?? '';
        const parts = [...note.matchAll(/([\d,]+) × ([^ +]+)/g)];
        if (parts.length) parts.forEach((m) => add(t.panels, `${heights.label.replace(' panels', '')} × ${m[2]} panels`, numberIn(m[1])));
        else add(t.panels, `${heights.label.replace(' panels', '')} × ${row('Wall height')!.value} panels`, numberIn(heights.value));
      }
      const fillerNote = rows.find((r) => r.label === 'Fillers')?.note;
      const each = fillerNote === 'of each height' ? 'of each height' : '';
      for (const r of rows) {
        if (!r.label.endsWith(' fillers')) continue;
        // Walls that change height: "12 × 4' + 6 × 4'" by panel height.
        const parts = fillerNote === 'by height' ? [...(r.note?.split('\n')[0] ?? '').matchAll(/([\d,]+) × ([^ +]+)/g)] : [];
        if (parts.length) parts.forEach((m) => add(t.fillers, `${r.label.replace(' fillers', '')} × ${m[2]} fillers`, numberIn(m[1])));
        else add(t.fillers, `${r.label}${each ? ' (each height)' : ''}`, numberIn(r.value));
      }
      t.insideCorners += numberIn(row('Inside corners (4×4)')?.value ?? '0');
      t.ties += numberIn(row('Ties')?.value ?? '0');
    }
    if (!steel) continue;
    if (row('Weight') && / lb$/.test(row('Weight')!.value)) t.rebarLb += numberIn(row('Weight')!.value);
    if (row('Rebar weight')) t.rebarLb += numberIn(row('Rebar weight')!.value);
    let bySize = false;
    for (const r of rows) {
      const size = r.label.match(/^#(\d+) sticks$/);
      const m = r.value.match(/^([\d,]+) × (\d+)'$/);
      if (size && m) {
        add(t.sticks, `#${size[1]} ${m[2]}' sticks`, numberIn(m[1]));
        bySize = true;
      }
    }
    // The cut list gives both a total and each size: count the sizes only.
    const sticks = bySize ? undefined : row('Sticks to order');
    if (sticks) {
      const m = sticks.value.match(/^([\d,]+) × (\d+)'$/);
      const size = typeof item.raw.barSize === 'string' ? `#${item.raw.barSize} ` : '';
      if (m) add(t.sticks, `${size}${m[2]}' sticks`, numberIn(m[1]));
      else add(t.sticks, `Sticks (${tool.title})`, numberIn(sticks.value));
    }
  }
  return t;
}

export interface Drawings {
  plan?: string;
  iso?: string;
  section?: string;
  /** Where the slab meets the house */
  house?: string;
}

/** Plan and 3D view of a Wall Forms foundation (raw = the tool's boxes). Null until the walls close up. */
export function wallFormsDrawings(raw: RawValues, title: string, date: string, slabThickFt = 0): Drawings | null {
  const tool = ALL_TOOLS.find((t) => t.id === 'wall-forms')!;
  const run = runTool(tool, raw);
  if (run.status !== 'ok') return null;
  const rows = (raw.walls as RawWallRow[]).map((r) => ({ length: parseLength(r.length) ?? 0, ends: r.ends })).filter((r) => r.length > 0);
  const outline = wallOutline(rows);
  if (!outline || !outline.closed) return null;
  const t = (parseNumber(String(raw.thick)) ?? 8) / 12;
  const inner = insetOutline(outline.points, t);
  const heightText = run.result.rows.find((r) => r.label === 'Wall height')?.value ?? `4'`;
  const hFt = parseHeight(heightText) || 4;
  const steel = raw.wallRebar === '1';
  return {
    plan: planSvg({ outer: outline.points, inner, labels: sideLabels(outline.points), title, subtitle: `${dec(t * 12)}" walls, ${heightText} tall · ${date}` }),
    iso: isoSvg({ outer: outline.points, inner, height: hFt, slabThick: slabThickFt || undefined }),
    section: steel
      ? sectionWithBarsSvg({
          widthIn: t * 12,
          depthIn: hFt * 12,
          lines: 0,
          barSize: Number(raw.hBarSize) || 4,
          hSpacingIn: parseNumber(String(raw.hSpacing)) ?? 24,
          vSpacingIn: parseNumber(String(raw.vSpacing)) ?? 24,
          title: 'Wall',
        })
      : undefined,
  };
}

/**
 * Footings & Walls: around a building (square or odd shape), the plan and the ring in 3D;
 * a straight run, a 3D look along it. Both with a cross-section showing the bars.
 */
export function footingDrawings(raw: RawValues, title = 'Footings & Walls', date = new Date().toLocaleDateString()): Drawings | null {
  const W = parseLength(raw.width as never) ?? 0;
  const D = parseLength(raw.depth as never) ?? 0;
  const bars = raw.bars === '1';
  const lines = bars ? Number(raw.lines) || 0 : 0;
  const barSize = Number(raw.barSize) || 4;
  const vSpacingIn = bars ? parseNumber(String(raw.vSpacing)) ?? 0 : 0;
  if (!(W > 0 && D > 0)) return null;
  const section = sectionWithBarsSvg({ widthIn: W * 12, depthIn: D * 12, lines, barSize, vSpacingIn, title: 'Section' });
  if (raw.shape === 'rect' || raw.shape === 'odd') {
    let rows: { length: number; ends: RawWallRow['ends'] }[];
    if (raw.shape === 'rect') {
      const BL = parseLength(raw.bLength as never) ?? 0;
      const BW = parseLength(raw.bWidth as never) ?? 0;
      if (!(BL > 0 && BW > 0)) return null;
      rows = [BL, BW, BL, BW].map((length) => ({ length, ends: 'oo' as const }));
    } else {
      rows = ((raw.walls as RawWallRow[]) ?? []).map((r) => ({ length: parseLength(r.length) ?? 0, ends: r.ends })).filter((r) => r.length > 0);
    }
    const outline = wallOutline(rows);
    if (!outline?.closed) return { section };
    const inner = insetOutline(outline.points, W);
    return {
      plan: planSvg({ outer: outline.points, inner, labels: sideLabels(outline.points), title, subtitle: `${dec(W * 12)}" × ${ftIn(D)} · ${date}` }),
      iso: isoSvg({ outer: outline.points, inner, height: Math.max(D, 0.5) }),
      section,
    };
  }
  // An add-on is drawn with the house on the job's foundation plan; on its own, the cross-section.
  if (raw.shape === 'addon') return { section };
  const L = parseLength(raw.length as never) ?? 0;
  if (!(L > 0)) return null;
  return {
    iso: footingIsoSvg({ lengthFt: L * (Number(raw.qty) || 1), widthFt: W, depthFt: D, lines, barSize, vSpacingIn }),
    section,
  };
}

/** Plan, 3D view and edge detail of a one-piece Slab, with its footing and rebar. Null for odd shapes. */
export function slabDrawings(raw: RawValues, title: string, date: string): Drawings | null {
  const filled = (raw.areas as RawArea[]).filter((a) => parseLength(a.length) !== null);
  if (filled.length !== 1) return null;
  const L = parseLength(filled[0].length) ?? 0;
  const Wd = parseLength(filled[0].width) ?? 0;
  if (!(L > 0 && Wd > 0)) return null;
  const on = (k: string) => raw[k] === '1';
  // Rounded corners: corner k at the end of side k (top right, bottom right, bottom left, top left).
  const r = on('rounded') ? parseLength(raw.radius as never) ?? 0 : 0;
  const picked = typeof raw.roundCorners === 'string' ? raw.roundCorners.split(',') : [];
  const radii = ['tr', 'br', 'bl', 'tl'].map((c) => (r > 0 && r <= Math.min(L, Wd) / 2 && picked.includes(c) ? r : 0));
  const box = { minX: 0, minY: 0, maxX: L, maxY: Wd };
  const outer: Pt[] = roundedRect(box, radii).points;
  const labels = radii.some((x) => x > 0) ? roundedLabels(box, radii) : sideLabels(outer);
  const thick = parseLength(raw.thick as never) ?? 4 / 12;
  if (!(thick > 0)) return null;
  const footing = on('footing');
  const fW = footing ? parseLength(raw.fWidth as never) ?? 1 : 0;
  const fD = footing ? Math.max(parseLength(raw.fDepth as never) ?? 16 / 12, thick) : 0;
  const slabRebar = on('slabRebar');
  const advice = slabBarsAdvice(thick * 12, Math.max(L, Wd));
  const own = on('pickBars');
  const matOn = slabRebar && (own || !advice.edgeOnly);
  const spacingFt = matOn ? (own ? parseNumber(String(raw.spacing)) ?? 0 : advice.spacingIn) / 12 : 0;
  const barSize = own ? String(raw.barSize) : String(advice.size);
  const footBars = footing && on('footBars') ? Number(raw.fBars) || 0 : 0;
  // Sides marked against the house (top, right, bottom, left); footing only where it runs.
  const marked = on('edges');
  const sides: SlabSide[] | undefined = marked
    ? (['sideTop', 'sideRight', 'sideBottom', 'sideLeft'] as const).map((k) => {
        const kind = (['form', 'house', 'dowels'].includes(String(raw[k])) ? raw[k] : 'form') as SlabSide['kind'];
        return { kind, footing: footing && (kind === 'form' || on('houseFooting')) };
      })
    : undefined;
  const anyFooting = footing && (!sides || sides.some((x) => x.footing));
  const dowelFt = marked ? (parseNumber(String(raw.dowelSpacing)) ?? 24) / 12 : 0;
  const dowelLenIn = marked ? (parseLength(raw.dowelLength as never) ?? 1.5) * 12 : 0;
  const tie = (anyFooting && matOn ? raw.edgeTie : 'none') as 'bend' | 'lbars' | 'none';
  // The bar around the edge: footing bars take its place where the footing runs.
  const edgeBar = slabRebar ? [0, 1, 2, 3].map((i) => !(footBars > 0 && (sides ? sides[i].footing : footing))) : undefined;
  // Slabs are thin next to their size; stretch the height so the edge and footing show in 3D.
  const realDepth = footing ? fD : thick;
  const z = Math.max(1, Math.max(L, Wd) / 10 / realDepth);
  // Footing bars: 2 on the bottom 3" up, the rest near the top of the trench (as in the edge detail).
  const inch = 1 / 12;
  const bars: { inset: number; z: number }[] = [];
  if (footBars > 0) {
    const bottom = Math.min(2, footBars);
    const spread = (count: number) =>
      Array.from({ length: count }, (_, i) => (count === 1 ? fW / 2 : 3 * inch + ((fW - 6 * inch) * i) / (count - 1)));
    for (const inset of spread(bottom)) bars.push({ inset, z: 3 * inch * z });
    const topFromTop = Math.max(thick + 3 * inch, fD * 0.45);
    for (const inset of spread(footBars - bottom)) bars.push({ inset, z: (fD - topFromTop) * z });
  }
  const parts = [`${dec(thick * 12)}" slab`];
  if (footing) parts.push(`${dec(fW * 12)}" × ${dec(fD * 12)}" edge`);
  if (slabRebar) parts.push(matOn ? `#${barSize} at ${dec(spacingFt * 12)}"` : 'edge bar');
  return {
    plan: slabPlanSvg({
      outer,
      labels,
      radii,
      title,
      subtitle: `${parts.join(' · ')} · ${date}`,
      footingFt: anyFooting ? fW : undefined,
      rebarFt: spacingFt || undefined,
      footingBars: footBars,
      sides,
      dowelFt: dowelFt || undefined,
      edgeBar,
    }),
    iso: isoSlabSvg({
      outer,
      radii,
      thick: thick * z,
      footing: anyFooting ? { width: fW, depth: fD * z } : undefined,
      rebarFt: spacingFt || undefined,
      footingBars: bars,
      bentLegsTo: tie === 'bend' ? 4 * inch * z : undefined,
      edgeBar,
      sides,
      dowelFt: dowelFt || undefined,
      note: z > 1.5 ? 'Height exaggerated to show the edge and rebar' : undefined,
    }),
    house: sides?.some((x) => x.kind !== 'form')
      ? houseSectionSvg({
          slabIn: thick * 12,
          dowelSize: Number(raw.dowelSize) || 4,
          dowelIn: sides.some((x) => x.kind === 'dowels') ? dowelLenIn : 0,
          footing: on('houseFooting') && footing ? { widthIn: fW * 12, depthIn: fD * 12 } : undefined,
        })
      : undefined,
    section: anyFooting
      ? sectionSvg({
          slabIn: thick * 12,
          footWIn: fW * 12,
          footDIn: fD * 12,
          bars: footBars,
          barSize: Number(raw.fBarSize) || 4,
          tie,
          slabBars: matOn,
          slabBarSize: Number(barSize) || 4,
        })
      : undefined,
  };
}

/** Plan, 3D and details for a Slab Layout (any shape). Null until the sides close up. */
export function layoutDrawings(raw: RawValues, title: string, date: string): Drawings | null {
  const sides = (raw.sides as RawOutlineRow[])
    .map((r) => ({ length: parseLength(r.length) ?? 0, turn: r.turn, radius: parseLength(r.radius) ?? 0, edge: r.edge }))
    .filter((r) => r.length > 0);
  if (sides.length < 4) return null;
  const L = buildLayout(sides);
  if (!L.closed) return null;
  const on = (k: string) => raw[k] === '1';
  const thick = parseLength(raw.thick as never) ?? 4 / 12;
  if (!(thick > 0)) return null;
  const footing = on('footing') && sides.some((s) => s.edge === 'form');
  const fW = footing ? parseLength(raw.fWidth as never) ?? 1 : 0;
  const fD = footing ? Math.max(parseLength(raw.fDepth as never) ?? 16 / 12, thick) : 0;
  const footOn = (k: number) => footing && sides[k].edge === 'form';
  const slabRebar = on('slabRebar');
  const plan = slabBarPlan(L, thick, on('pickBars') ? { size: Number(raw.barSize) || 4, spacingIn: parseNumber(String(raw.spacing)) ?? 18 } : null);
  const spacingFt = slabRebar ? plan.spacingIn / 12 : 0;
  const tie = (footing && slabRebar ? raw.edgeTie : 'none') as 'bend' | 'lbars' | 'none';
  const bars = slabRebar && plan.mat && spacingFt > 0 ? matBars(L, 3 / 12, spacingFt, footOn) : undefined;
  const footBars = footing && on('footBars') ? Number(raw.fBars) || 0 : 0;
  // The bar around the edge (footing bars take its place on the formed sides).
  const edgeBar = slabRebar ? { inset: 3 / 12, on: (k: number) => !(footBars > 0 && footOn(k)) } : undefined;
  const dowels = sides.some((s) => s.edge === 'dowels' || s.edge === 'slabDowels');
  const dowelFt = dowels ? (parseNumber(String(raw.dowelSpacing)) ?? 24) / 12 : undefined;
  const dowelLenIn = (parseLength(raw.dowelLength as never) ?? 1.5) * 12;
  // Stretch the height so the edge and rebar show in 3D.
  const xs = L.V.map((p) => p.x);
  const ys = L.V.map((p) => p.y);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const realDepth = footing ? fD : thick;
  const z = Math.max(1, span / 10 / realDepth);
  const inch = 1 / 12;
  const fBars: { inset: number; z: number }[] = [];
  if (footBars > 0) {
    const bottom = Math.min(2, footBars);
    const spread = (count: number) => Array.from({ length: count }, (_, i) => (count === 1 ? fW / 2 : 3 * inch + ((fW - 6 * inch) * i) / (count - 1)));
    for (const inset of spread(bottom)) fBars.push({ inset, z: 3 * inch * z });
    const topFromTop = Math.max(thick + 3 * inch, fD * 0.45);
    for (const inset of spread(footBars - bottom)) fBars.push({ inset, z: (fD - topFromTop) * z });
  }
  const parts = [`${dec(thick * 12)}" slab`];
  if (footing) parts.push(`${dec(fW * 12)}" × ${dec(fD * 12)}" edge`);
  if (slabRebar) parts.push(plan.mat ? `#${plan.size} at ${dec(plan.spacingIn)}"` : 'edge bar');
  const joint = sides.find((s) => s.edge !== 'form');
  return {
    plan: layoutPlanSvg({ L, title, subtitle: `${parts.join(' · ')} · ${date}`, footingFt: footing ? fW : undefined, footingBars: footBars, bars, dowelFt, edgeBar }),
    iso: layoutIsoSvg({
      L,
      thick: thick * z,
      footing: footing ? { width: fW, depth: fD * z } : undefined,
      bars,
      footingBars: fBars,
      bentLegsTo: tie === 'bend' ? 4 * inch * z : undefined,
      edgeBar,
      dowelFt,
      note: z > 1.5 ? 'Height exaggerated to show the edge and rebar' : undefined,
    }),
    section: footing
      ? sectionSvg({ slabIn: thick * 12, footWIn: fW * 12, footDIn: fD * 12, bars: footBars, barSize: Number(raw.fBarSize) || 4, tie, slabBars: slabRebar && plan.mat, slabBarSize: plan.size })
      : undefined,
    house: joint
      ? houseSectionSvg({
          slabIn: thick * 12,
          dowelSize: Number(raw.dowelSize) || 4,
          dowelIn: dowels ? dowelLenIn : 0,
          against: joint.edge === 'slab' || joint.edge === 'slabDowels' ? 'slab' : 'house',
        })
      : undefined,
  };
}

/** Plan and (once it closes) 3D view of a Layout Sketch. */
export function sketchDrawings(raw: RawValues, title: string, date: string): Drawings | null {
  const pad = raw.sketch as RawPad | undefined;
  const edges = (pad?.edges ?? []).map((e) => {
    const l = parseLength(e.length);
    return { a: e.a, b: e.b, length: l !== null && l > 0 ? l : null };
  });
  if (!pad || !edges.some((e) => e.length)) return null;
  const s = solvePad(pad.points, edges);
  const loop = padLoop(s.points.length, edges);
  const thick = parseLength(raw.thick as never) ?? 4 / 12;
  return { plan: sketchSvg(s, `${title} · ${date}`), iso: loop && thick > 0 ? sketchIsoSvg(s, loop, thick) : undefined };
}

/** Drawings for one tool's numbers (the tool screen shows these under the answers). */
export function toolDrawings(toolId: string, raw: RawValues, title: string): Drawings | null {
  const date = new Date().toLocaleDateString();
  if (toolId === 'slab') return slabDrawings(raw, title, date);
  if (toolId === 'wall-forms') return wallFormsDrawings(raw, title, date);
  if (toolId === 'slab-layout') return layoutDrawings(raw, title, date);
  if (toolId === 'layout-sketch') return sketchDrawings(raw, title, date);
  if (toolId === 'footings') return footingDrawings(raw, title, date);
  return null;
}

/** Each add-on's walls with the footing under them (matched by side) and the slab poured in it. */
function addOnDraws(f: Foundation): AddOnDraw[] {
  const len = (v: unknown) => parseLength(v as never) ?? 0;
  const walls = f.addOns.filter((a) => a.kind === 'wall');
  return walls.map((a, i) => {
    const ft = f.addOns.find((x) => x.kind === 'footing' && x.side === a.side);
    const pour = f.pours[i];
    const area = pour?.result.status === 'ok' ? pour.result.result.rows.find((r) => r.label === 'Slab area') : undefined;
    const order = pour?.result.status === 'ok' ? pour.result.result.rows.find((r) => r.label === 'Order') : undefined;
    return {
      side: a.side,
      width: a.width,
      depth: a.depth,
      inside: a.inside,
      inFrom: a.inFrom,
      wallFt: len(a.item.item.raw.depth) || f.heightFt,
      footing: ft ? { widthIn: len(ft.item.item.raw.width) * 12, depthIn: len(ft.item.item.raw.depth) * 12 } : null,
      pour: pour ? { thickIn: len(pour.item.raw.thick) * 12 || 4, sqFt: area ? numberIn(area.value) : 0, label: order ? `${order.value.toUpperCase()} ORDERED` : '' } : null,
    };
  });
}

/**
 * Walls, footings and slab you put together, drawn the way an engineer does: foundation plan,
 * 3D, and a typical section through the wall.
 */
export function foundationDrawings(job: Job, items: FiguredItem[], company = ''): Drawings | null {
  const f = confirmedFoundation(items, job);
  if (!f?.outline) return null;
  const wall = f.walls[0];
  const wr = wall.item.raw;
  const len = (v: unknown) => parseLength(v as never) ?? 0;
  const num = (v: unknown, d: number) => parseNumber(String(v ?? '')) ?? d;
  let wallVert: FoundationDraw['wallVert'] = null;
  let wallHoriz: FoundationDraw['wallHoriz'] = null;
  if (wall.tool.id === 'wall-forms' && wr.wallRebar === '1') {
    wallVert = { size: num(wr.vBarSize, 4), spacingIn: num(wr.vSpacing, 24) };
    wallHoriz = { size: num(wr.hBarSize, 4), spacingIn: num(wr.hSpacing, 24) };
  } else if (wall.tool.id === 'footings' && wr.bars === '1') {
    if (String(wr.vSpacing ?? '').trim()) wallVert = { size: num(wr.barSize, 4), spacingIn: num(wr.vSpacing, 24) };
    const lines = num(wr.lines, 2);
    if (lines > 1) wallHoriz = { size: num(wr.barSize, 4), spacingIn: Math.max(6, (f.heightFt * 12 - 6) / (lines - 1)) };
  }
  const wallSteel = [wallVert ? `#${wallVert.size} VERT. @ ${n2(wallVert.spacingIn)}" O.C.` : '', wallHoriz ? `#${wallHoriz.size} HORIZ. @ ${n2(wallHoriz.spacingIn)}" O.C.` : '']
    .filter(Boolean)
    .join(', ');
  const ft = f.footings[0];
  const footing = ft
    ? {
        widthIn: len(ft.item.raw.width) * 12,
        depthIn: len(ft.item.raw.depth) * 12,
        lines: ft.item.raw.bars === '1' ? num(ft.item.raw.lines, 2) : 0,
        barSize: num(ft.item.raw.barSize, 4),
      }
    : null;
  let slab: FoundationDraw['slab'] = null;
  if (f.slab) {
    const note = f.slab.result.status === 'ok' ? f.slab.result.result.rows.find((r) => r.label === 'Slab bars') : undefined;
    const m = note?.note?.match(/#(\d+) at ([\d.]+)"/);
    const bar = m ? { size: Number(m[1]), spacingIn: Number(m[2]) } : null;
    const steel = bar ? `#${bar.size} @ ${n2(bar.spacingIn)}" O.C. EACH WAY` : note?.value === 'Edge bar only' ? 'BAR AROUND THE EDGE' : '';
    slab = { thickIn: len(f.slab.item.raw.thick) * 12 || 4, dropIn: f.slabDropIn, steel, bar };
  }
  const d: FoundationDraw = {
    outline: f.outline,
    wallIn: f.thickFt * 12,
    wallFt: f.heightFt,
    wallSteel,
    wallVert,
    wallHoriz,
    footing,
    slab,
    vaporBarrier: items.some((x) => x.tool.id === 'vapor-barrier'),
    runs: f.runs && !f.runsOver ? splitOutline(f.outline, f.runs) : undefined,
    addOns: addOnDraws(f),
    title: job.name,
    job: job.name,
    company,
    date: new Date(job.createdAt).toLocaleDateString(),
    kind: f.kind,
  };
  return { plan: foundationPlanSvg(d), iso: foundationIsoSvg(d), section: foundationSectionSvg(d) };
}

const n2 = (v: number) => String(Math.round(v * 10) / 10);

/** A piece's name on the bill and crew sheet: "Basement walls", "Basement footings", or its own name. */
export function pieceName(f: FiguredItem, items: FiguredItem[], job?: Job): string {
  const fnd = confirmedFoundation(items, job);
  if (fnd) {
    if (fnd.walls.some((x) => x.item.id === f.item.id)) return `${fnd.kind} walls`;
    if (fnd.footings.some((x) => x.item.id === f.item.id)) return `${fnd.kind} footings`;
    if (fnd.footingBars.some((x) => x.item.id === f.item.id)) return `${fnd.kind} footing bars`;
    if (fnd.slab?.item.id === f.item.id) return `${fnd.kind} slab`;
    const a = fnd.addOns.find((x) => x.item.item.id === f.item.id);
    if (a) return `${fnd.kind} add-on ${a.kind === 'wall' ? 'walls' : 'footings'}`;
    const pour = fnd.pours.findIndex((x) => x.item.id === f.item.id);
    if (pour >= 0) return `${fnd.kind} slab, ${pourName(pour)}`;
  }
  // Footings & Walls without a name: say which it is, so a footing doesn't read like walls.
  if (!f.item.label && f.tool.id === 'footings') return f.item.raw.kind === 'wall' ? 'Walls' : 'Footings';
  return f.item.label || f.tool.title;
}

/** Rows that are rebar, by what tools call them. */
const REBAR_ROWS = new Set([
  'Slab bars',
  'Edge bar',
  'Edge L-bars',
  'Footing bars',
  'Bars along it',
  'Verticals',
  'Horizontal bars',
  'Vertical bars',
  'Dowels',
  'Bars long way',
  'Bars short way',
  'Bars both ways',
  'Number of laps',
  'Stirrups',
  'Ties',
  'Corner bars',
]);
const REBAR_TOOLS = ['slab-rebar', 'beam-bars', 'stirrups', 'cut-list', 'dowels'];

/** Steel this job counts for an item (a Slab Layout sent to a cut list is counted on the cut list). */
export function steelItems(items: FiguredItem[]): FiguredItem[] {
  const cutFromLayout = items.some((f) => f.tool.id === 'cut-list' && f.item.raw.from === 'slab-layout' && f.result.status === 'ok');
  return items.filter((f) => f.result.status === 'ok' && !(cutFromLayout && f.tool.id === 'slab-layout'));
}

/** Pounds of rebar in one item, the way the job totals count it. */
export function itemRebarLb(f: FiguredItem): number {
  if (f.result.status !== 'ok') return 0;
  const rows = f.result.result.rows;
  const w = rows.find((r) => r.label === 'Rebar weight') ?? rows.find((r) => r.label === 'Weight' && / lb$/.test(r.value));
  return w ? numberIn(w.value) : 0;
}

export interface RebarLine {
  where: string;
  what: string;
  amount: string;
  note?: string;
}

/** Every bar in the job, piece by piece, for the crew. */
export function rebarSchedule(items: FiguredItem[], job?: Job): RebarLine[] {
  const out: RebarLine[] = [];
  for (const f of steelItems(builtItems(items, job).items)) {
    if (f.result.status !== 'ok' || (!itemRebarLb(f) && !f.result.result.rows.some((r) => r.label === 'Dowels'))) continue;
    const where = pieceName(f, items, job);
    for (const r of f.result.result.rows) {
      const isRebar = REBAR_ROWS.has(r.label) || (REBAR_TOOLS.includes(f.tool.id) && !/sticks|Weight|Sticks to order|Lap$|Total footage|Chairs/.test(r.label));
      if (isRebar && r.label !== 'Ties') out.push({ where, what: r.label.trim(), amount: r.value, note: r.note });
    }
  }
  return out;
}

/** A foundation layout item's plan, 3D and typical section. Null if the job has no layout. */
export function layoutItemDrawings(job: Job, items: FiguredItem[], company = '', highlight?: { run?: number; face?: number }): Drawings | null {
  const it = job.items.find((i) => i.toolId === LAYOUT_TOOL_ID);
  const raw = it?.raw as unknown as LayoutRaw | undefined;
  if (!it || !raw?.layout?.house) return null;
  const l = buildFoundationLayout(raw.layout);
  const pourYd: Record<number, number> = {};
  for (const sl of l.slabs) {
    const f = items.find((x) => x.item.id === `${it.id}:slab${sl.pour}`);
    const order = f?.result.status === 'ok' ? f.result.result.rows.find((r) => r.label === 'Order') : undefined;
    if (order) pourYd[sl.pour] = numberIn(order.value);
  }
  const date = new Date(job.createdAt).toLocaleDateString();
  const w = raw.wall ?? {};
  const ft = raw.footing ?? {};
  const num = (v: unknown, d: number) => parseNumber(String(v ?? '')) ?? d;
  const bars = w.bars === '1';
  const d: FoundationDraw = {
    outline: [],
    wallIn: l.spec.wall.thick * 12,
    wallFt: l.spec.wall.height,
    wallSteel: bars && String(w.vSpacing ?? '').trim() ? `#${num(w.barSize, 4)} VERT. @ ${n2(num(w.vSpacing, 24))}" O.C.` : '',
    wallVert: bars && String(w.vSpacing ?? '').trim() ? { size: num(w.barSize, 4), spacingIn: num(w.vSpacing, 24) } : null,
    wallHoriz: bars && num(w.lines, 2) > 1 ? { size: num(w.barSize, 4), spacingIn: Math.max(6, (l.spec.wall.height * 12 - 6) / (num(w.lines, 2) - 1)) } : null,
    footing: l.spec.footing ? { widthIn: l.spec.footing.width * 12, depthIn: l.spec.footing.depth * 12, lines: ft.bars === '1' ? num(ft.lines, 2) : 0, barSize: num(ft.barSize, 4) } : null,
    slab: l.slabs.length ? { thickIn: l.slabs[0].thick * 12, dropIn: l.spec.slabDropIn ?? (l.spec.wall.height >= 6 ? Math.round(l.spec.wall.height * 12 - l.slabs[0].thick * 12) : 0), steel: '', bar: null } : null,
    vaporBarrier: items.some((x) => x.tool.id === 'vapor-barrier'),
    title: job.name,
    job: job.name,
    company,
    date,
    kind: 'Foundation',
  };
  return {
    plan: graphPlanSvg(l, { title: 'Foundation layout', job: job.name, company, date, pourYd, highlight }),
    iso: graphIsoSvg(l, highlight),
    section: foundationSectionSvg(d),
  };
}

/** The plan and 3D view: a foundation layout, walls that go together, Wall Forms walls, else a one-piece slab. */
export function jobDrawings(job: Job, items: FiguredItem[], company = ''): Drawings | null {
  const laid = layoutItemDrawings(job, items, company);
  if (laid) return laid;
  const together = foundationDrawings(job, items, company);
  if (together) return together;
  const walls = items.find((f) => f.tool.id === 'wall-forms' && f.result.status === 'ok');
  const slab = items.find((f) => f.tool.id === 'slab' && f.result.status === 'ok');
  const date = new Date(job.createdAt).toLocaleDateString();
  if (walls) {
    const slabThick = slab ? parseLength(restoreRaw(slab.tool, slab.item.raw).thick as never) ?? 0 : 0;
    return wallFormsDrawings(restoreRaw(walls.tool, walls.item.raw), job.name, date, slabThick);
  }
  const layout = items.find((f) => f.tool.id === 'slab-layout' && f.result.status === 'ok');
  const sketch = items.find((f) => f.tool.id === 'layout-sketch' && f.result.status === 'ok');
  if (!layout && sketch) return sketchDrawings(restoreRaw(sketch.tool, sketch.item.raw), job.name, date);
  if (layout) return layoutDrawings(restoreRaw(layout.tool, layout.item.raw), job.name, date);
  if (slab) return slabDrawings(restoreRaw(slab.tool, slab.item.raw), job.name, date);
  return null;
}

/** "4'" → 4, "5'4"" → 5.33, "4"" → 0.333, "0' 4"" → 0.333 */
export function parseHeight(v: string): number {
  const ft = v.match(/(\d+(?:\.\d+)?)'/);
  const inch = v.match(/(\d+(?:\.\d+)?)(?:-(\d+)\/(\d+))?"/);
  let total = ft ? Number(ft[1]) : 0;
  if (inch) total += (Number(inch[1]) + (inch[2] ? Number(inch[2]) / Number(inch[3]) : 0)) / 12;
  return total;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function rowsTable(rows: ResultRow[]): string {
  return `<table class="rows">${rows
    .map(
      (r) =>
        `<tr class="${r.big ? 'big' : ''}"><td>${esc(r.label.trim())}${r.note ? `<div class="note">${esc(r.note).replace(/\n/g, '<br>')}</div>` : ''}</td><td class="v">${esc(r.value)}</td></tr>`,
    )
    .join('')}</table>`;
}

function totalsRows(t: Totals): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  if (t.concreteOrderYd) rows.push({ label: 'Concrete to order', value: `${dec(t.concreteOrderYd, 2)} yd` });
  if (t.wallConcreteYd) rows.push({ label: 'Concrete in walls (no waste)', value: cuYd(t.wallConcreteYd) });
  if (t.concreteCost) rows.push({ label: 'Concrete cost', value: money(t.concreteCost) });
  if (t.rebarLb) rows.push({ label: 'Rebar weight', value: `${commas(t.rebarLb)} lb (${dec(t.rebarLb / 2000, 2)} tons)` });
  for (const [k, v] of t.sticks) rows.push({ label: k, value: commas(v) });
  for (const [k, v] of t.panels) rows.push({ label: k, value: commas(v) });
  // Biggest filler first: 14", 1', 8", 6"
  const inchesOf = (label: string) => (/^\d+'/.test(label) ? numberIn(label) * 12 : numberIn(label));
  for (const [k, v] of [...t.fillers].sort((a, b) => inchesOf(b[0]) - inchesOf(a[0]))) rows.push({ label: k, value: commas(v) });
  if (t.insideCorners) rows.push({ label: 'Inside corners (4×4)', value: commas(t.insideCorners) });
  if (t.ties) rows.push({ label: 'Ties', value: `about ${commas(t.ties)}` });
  return rows;
}

/**
 * The job report. `crew`: the crew sheet, with no prices and the notes up top.
 * `scans`: scanned plan pages as data URIs (phone app), added at the end.
 */
export function buildReport(job: Job, s: Settings, opts: { now?: Date; crew?: boolean } & DocMedia = {}): { html: string; text: string } {
  const now = opts.now ?? new Date();
  const scans = opts.scans ?? [];
  const crew = !!opts.crew;
  const priced = (r: { label: string }) => !(crew && /cost|price/i.test(r.label));
  const items = figureItems(job).map((f) =>
    crew && f.result.status === 'ok' ? { ...f, result: { ...f.result, result: { ...f.result.result, rows: f.result.result.rows.filter(priced) } } } : f,
  );
  const totals = jobTotals(items, job);
  const foundation = confirmedFoundation(items, job);
  const schedule = rebarSchedule(items, job);
  const steelTotals: [string, string][] = [
    ...[...totals.sticks].map(([k, v]): [string, string] => [`${k} to load`, commas(v)]),
    ...(totals.rebarLb ? [['Rebar weight', `${commas(totals.rebarLb)} lb (${dec(totals.rebarLb / 2000, 2)} tons)`] as [string, string]] : []),
  ];
  const company = companyLine(s);
  const drawings = jobDrawings(job, items, s.company.name);
  const sum = totalsRows(totals).filter(priced);
  const notesHtml = job.notes ? `<h2>Notes</h2><div class="notes">${esc(job.notes)}</div>` : '';
  const date = now.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

  // Shown as built: a slab inside checked walls, walls whose height changes.
  const shown = builtItems(items, job).items;
  const itemHtml = shown
    .map(({ item, tool, result, inputs }) => {
      const head = `<h3>${esc(item.label || tool.title)}${item.label ? ` <span class="tool">${esc(tool.title)}</span>` : ''}</h3>`;
      const inp = `<div class="inputs">${inputs.map((i) => `<span><b>${esc(i.label)}:</b> ${esc(i.value)}</span>`).join('')}</div>`;
      const body =
        result.status === 'ok'
          ? `${(result.result.warnings ?? []).map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join('')}${rowsTable(result.result.rows)}`
          : `<div class="warn">Not finished: ${esc(result.message)}</div>`;
      return `<section class="item">${head}${inp}${body}</section>`;
    })
    .join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(job.name)} – ${crew ? 'Crew sheet' : 'Job report'}</title>
<style>
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #111; margin: 0; padding: 24px; background: #fff; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 3px solid #111; padding-bottom: 12px; }
  .co { font-size: 13px; color: #444; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  h2 { font-size: 17px; text-transform: uppercase; letter-spacing: .05em; margin: 26px 0 8px; color: #333; }
  h3 { font-size: 17px; margin: 0 0 6px; }
  .tool { font-weight: 400; color: #666; font-size: 14px; }
  .meta { font-size: 13px; color: #555; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 6px 4px; border-bottom: 1px solid #ddd; vertical-align: top; font-size: 14px; }
  td.v { text-align: right; white-space: nowrap; font-weight: 600; }
  .sum td { font-size: 15px; }
  .sum tr:last-child td { border-bottom: 2px solid #111; }
  tr.big td { font-size: 16px; }
  tr.big td.v { font-size: 18px; }
  .note { font-size: 12px; color: #666; font-weight: 400; }
  .item { border: 1px solid #ccc; border-radius: 10px; padding: 12px 14px; margin: 0 0 12px; break-inside: avoid; }
  .inputs { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12.5px; color: #444; margin-bottom: 8px; }
  .warn { background: #fff4dc; border: 1px solid #e0a000; border-radius: 6px; padding: 6px 8px; font-size: 13px; margin-bottom: 6px; }
  .draw { border: 1px solid #ccc; border-radius: 10px; overflow: hidden; margin-bottom: 12px; break-inside: avoid; page-break-inside: avoid; }
  h2.page { break-before: page; page-break-before: always; }
  .draw svg { max-height: 92vh; }
  .notes { white-space: pre-wrap; font-size: 14px; }
  .fnd { margin: 0; padding-left: 18px; font-size: 14px; line-height: 1.5; }
  table.rebar th { text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: #555; border-bottom: 2px solid #111; padding: 6px 4px; }
  table.rebar tr.tot td { font-weight: 700; border-top: 2px solid #111; }
  .kind { font-size: 12px; font-weight: 800; letter-spacing: .12em; color: #b25c00; margin-bottom: 2px; }
  .scan { break-before: page; }
  .scan img { width: 100%; border: 1px solid #ccc; }
  .foot { margin-top: 24px; font-size: 11px; color: #888; text-align: center; }
  .print { position: fixed; right: 16px; bottom: 16px; padding: 12px 18px; border-radius: 999px; border: 0; background: #ff9f0a; color: #000; font-size: 16px; font-weight: 700; }
  @media print { .print { display: none; } body { padding: 0; } }
${docCss(s.docs)}
</style></head><body>
<div class="top"><div>${crew ? '<div class="kind">CREW SHEET</div>' : ''}<h1>${esc(job.name)}</h1>${job.address ? `<div class="meta">${esc(job.address)}</div>` : ''}<div class="meta">${esc(date)}</div></div>
${company || opts.logo ? `<div class="co">${logoHtml(opts.logo)}${esc(company).replace(/ · /g, '<br>')}</div>` : ''}</div>
${crew ? notesHtml : ''}
${sum.length ? `<h2>${crew ? 'Load list' : 'Order summary'}</h2><table class="sum">${sum.map((r) => `<tr><td>${esc(r.label)}</td><td class="v">${esc(r.value)}</td></tr>`).join('')}</table>` : ''}
${schedule.length ? `<h2>Rebar schedule</h2><table class="rebar"><tr><th>Where</th><th>Bars</th><th class="v">How many / long</th></tr>${schedule
      .map((r) => `<tr><td>${esc(r.where)}</td><td>${esc(r.what)}${r.note ? `<div class="note">${esc(r.note)}</div>` : ''}</td><td class="v">${esc(r.amount)}</td></tr>`)
      .join('')}${steelTotals.map(([k, v]) => `<tr class="tot"><td colspan="2">${esc(k)}</td><td class="v">${esc(v)}</td></tr>`).join('')}</table>` : ''}
${drawings?.plan ? `<h2 class="page">${foundation ? 'Foundation plan' : 'Plan'}</h2><div class="draw">${drawings.plan}</div>` : ''}${drawings?.iso ? `<h2 class="page">3D view</h2><div class="draw">${drawings.iso}</div>` : ''}
${drawings?.section ? `<h2 class="page">${foundation ? 'Typical section' : 'Edge detail'}</h2><div class="draw">${drawings.section}</div>` : ''}
${drawings?.house ? `<h2 class="page">At the house</h2><div class="draw">${drawings.house}</div>` : ''}
${opts.photos?.length ? `<h2>Photos</h2><div class="photos">${opts.photos.map((src, i) => `<img src="${src}" alt="Photo ${i + 1}">`).join('')}</div>` : ''}
${foundation ? `<h2>Foundation: ${esc(foundation.kind)}</h2><div class="item"><ul class="fnd">${foundationLines(foundation, job).map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>` : ''}
${items.length ? `<h2>Details</h2>${itemHtml}` : '<p>Nothing added to this job yet.</p>'}
${crew ? '' : notesHtml}
${scans.map((src, i) => `<div class="scan"><h2>Plans · page ${i + 1}</h2><img src="${src}" alt="Plan page ${i + 1}"></div>`).join('')}
${noticeHtml('crew', s.docs)}
<button class="print" onclick="window.print()">Save as PDF / Print</button>
</body></html>`;

  const text = [
    `${job.name} – ${crew ? 'Crew sheet' : 'Job report'}`,
    job.address,
    date,
    '',
    ...(crew && job.notes ? ['NOTES', job.notes, ''] : []),
    ...(schedule.length ? ['REBAR', ...schedule.map((r) => `${r.where} · ${r.what}: ${r.amount}`), ''] : []),
    ...(sum.length ? [crew ? 'LOAD LIST' : 'ORDER SUMMARY', ...sum.map((r) => `${r.label}: ${r.value}`), ''] : []),
    ...shown.flatMap(({ item, tool, result }) => [
      `— ${item.label || tool.title}`,
      ...(result.status === 'ok' ? result.result.rows.filter((r) => r.big).map((r) => `${r.label.trim()}: ${r.value}`) : [`Not finished: ${result.message}`]),
      '',
    ]),
    ...(!crew && job.notes ? ['NOTES', job.notes, ''] : []),
    company,
  ]
    .filter((l, i, a) => !(l === '' && a[i - 1] === ''))
    .join('\n')
    .trim();

  return { html, text };
}
