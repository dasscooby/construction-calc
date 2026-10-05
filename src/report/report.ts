// The job report ("the bill"): every calculation in a job figured fresh, the order added up,
// a blueprint plan and a 3D view, as one printable page (HTML → PDF) or plain text.

import type { Job, JobItem } from '../lib/jobs';
import { companyLine, Settings } from '../lib/settings';
import { ALL_TOOLS, migrateItem } from '../tools';
import { commas, cuYd, dec, money } from '../tools/format';
import { isShown, parseLength, parseNumber, RawArea, RawOutlineRow, RawValues, RawWallRow, restoreRaw, runTool, RunResult } from '../tools/run';
import { fieldText } from '../tools/share';
import type { ResultRow, Tool } from '../tools/types';
import { houseSectionSvg, isoSlabSvg, isoSvg, planSvg, roundedLabels, roundedRect, sectionSvg, sideLabels, SlabSide, slabPlanSvg } from './drawings';
import { insetOutline, Pt, wallOutline } from './geometry';
import { layoutIsoSvg, layoutPlanSvg } from './layoutDraw';
import { buildLayout, matBars } from './layoutGeom';
import { slabBarPlan } from '../tools/slabLayoutTool';

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
    const m = migrateItem(item.toolId, item.raw);
    const tool = ALL_TOOLS.find((t) => t.id === m.toolId);
    if (!tool) continue; // a tool that was removed in an update
    const raw = restoreRaw(tool, m.raw);
    const inputs = tool.fields.flatMap((f) => {
      if (!isShown(f, raw)) return [];
      const v = fieldText(f, raw[f.key]);
      return v === null ? [] : [{ label: f.label, value: v }];
    });
    out.push({ item, tool, result: runTool(tool, raw), inputs });
  }
  return out;
}

/** Adds up the order across everything in the job. */
export function jobTotals(items: FiguredItem[]): Totals {
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
      const each = rows.find((r) => r.label === 'Fillers')?.note === 'of each height' ? 'of each height' : '';
      for (const r of rows) if (r.label.endsWith(' fillers')) add(t.fillers, `${r.label}${each ? ' (each height)' : ''}`, numberIn(r.value));
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
  plan: string;
  iso: string;
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
  return {
    plan: planSvg({ outer: outline.points, inner, labels: sideLabels(outline.points), title, subtitle: `${dec(t * 12)}" walls, ${heightText} tall · ${date}` }),
    iso: isoSvg({ outer: outline.points, inner, height: hFt, slabThick: slabThickFt || undefined }),
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
  const spacingFt = slabRebar ? (parseNumber(String(raw.spacing)) ?? 0) / 12 : 0;
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
  const tie = (anyFooting && slabRebar ? raw.edgeTie : 'none') as 'bend' | 'lbars' | 'none';
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
  if (slabRebar) parts.push(`#${String(raw.barSize)} at ${dec(spacingFt * 12)}"`);
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
    }),
    iso: isoSlabSvg({
      outer,
      radii,
      thick: thick * z,
      footing: anyFooting ? { width: fW, depth: fD * z } : undefined,
      rebarFt: spacingFt || undefined,
      footingBars: bars,
      bentLegsTo: tie === 'bend' ? 4 * inch * z : undefined,
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
          slabBars: slabRebar,
          slabBarSize: Number(raw.barSize) || 4,
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

/** Drawings for one tool's numbers (the tool screen shows these under the answers). */
export function toolDrawings(toolId: string, raw: RawValues, title: string): Drawings | null {
  const date = new Date().toLocaleDateString();
  if (toolId === 'slab') return slabDrawings(raw, title, date);
  if (toolId === 'wall-forms') return wallFormsDrawings(raw, title, date);
  if (toolId === 'slab-layout') return layoutDrawings(raw, title, date);
  return null;
}

/** The plan and 3D view: from Wall Forms walls if the job has them, else from a one-piece slab. */
export function jobDrawings(job: Job, items: FiguredItem[]): Drawings | null {
  const walls = items.find((f) => f.tool.id === 'wall-forms' && f.result.status === 'ok');
  const slab = items.find((f) => f.tool.id === 'slab' && f.result.status === 'ok');
  const date = new Date(job.createdAt).toLocaleDateString();
  if (walls) {
    const slabThick = slab ? parseLength(restoreRaw(slab.tool, slab.item.raw).thick as never) ?? 0 : 0;
    return wallFormsDrawings(restoreRaw(walls.tool, walls.item.raw), job.name, date, slabThick);
  }
  const layout = items.find((f) => f.tool.id === 'slab-layout' && f.result.status === 'ok');
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
export function buildReport(job: Job, s: Settings, opts: { now?: Date; scans?: string[]; crew?: boolean } = {}): { html: string; text: string } {
  const now = opts.now ?? new Date();
  const scans = opts.scans ?? [];
  const crew = !!opts.crew;
  const priced = (r: { label: string }) => !(crew && /cost|price/i.test(r.label));
  const items = figureItems(job).map((f) =>
    crew && f.result.status === 'ok' ? { ...f, result: { ...f.result, result: { ...f.result.result, rows: f.result.result.rows.filter(priced) } } } : f,
  );
  const totals = jobTotals(items);
  const drawings = jobDrawings(job, items);
  const company = companyLine(s);
  const sum = totalsRows(totals).filter(priced);
  const notesHtml = job.notes ? `<h2>Notes</h2><div class="notes">${esc(job.notes)}</div>` : '';
  const date = now.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

  const itemHtml = items
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
  .draw { border: 1px solid #ccc; border-radius: 10px; overflow: hidden; margin-bottom: 12px; break-inside: avoid; }
  .notes { white-space: pre-wrap; font-size: 14px; }
  .kind { font-size: 12px; font-weight: 800; letter-spacing: .12em; color: #b25c00; margin-bottom: 2px; }
  .scan { break-before: page; }
  .scan img { width: 100%; border: 1px solid #ccc; }
  .foot { margin-top: 24px; font-size: 11px; color: #888; text-align: center; }
  .print { position: fixed; right: 16px; bottom: 16px; padding: 12px 18px; border-radius: 999px; border: 0; background: #ff9f0a; color: #000; font-size: 16px; font-weight: 700; }
  @media print { .print { display: none; } body { padding: 0; } }
</style></head><body>
<div class="top"><div>${crew ? '<div class="kind">CREW SHEET</div>' : ''}<h1>${esc(job.name)}</h1>${job.address ? `<div class="meta">${esc(job.address)}</div>` : ''}<div class="meta">${esc(date)}</div></div>
${company ? `<div class="co">${esc(company).replace(/ · /g, '<br>')}</div>` : ''}</div>
${crew ? notesHtml : ''}
${sum.length ? `<h2>${crew ? 'Load list' : 'Order summary'}</h2><table class="sum">${sum.map((r) => `<tr><td>${esc(r.label)}</td><td class="v">${esc(r.value)}</td></tr>`).join('')}</table>` : ''}
${drawings ? `<h2>Plan</h2><div class="draw">${drawings.plan}</div><h2>3D view</h2><div class="draw">${drawings.iso}</div>` : ''}
${drawings?.section ? `<h2>Edge detail</h2><div class="draw">${drawings.section}</div>` : ''}
${drawings?.house ? `<h2>At the house</h2><div class="draw">${drawings.house}</div>` : ''}
${items.length ? `<h2>Details</h2>${itemHtml}` : '<p>Nothing added to this job yet.</p>'}
${crew ? '' : notesHtml}
${scans.map((src, i) => `<div class="scan"><h2>Plans · page ${i + 1}</h2><img src="${src}" alt="Plan page ${i + 1}"></div>`).join('')}
<div class="foot">Made with Construction Calc · Field numbers — always follow your plans and your engineer.</div>
<button class="print" onclick="window.print()">Save as PDF / Print</button>
</body></html>`;

  const text = [
    `${job.name} – ${crew ? 'Crew sheet' : 'Job report'}`,
    job.address,
    date,
    '',
    ...(crew && job.notes ? ['NOTES', job.notes, ''] : []),
    ...(sum.length ? [crew ? 'LOAD LIST' : 'ORDER SUMMARY', ...sum.map((r) => `${r.label}: ${r.value}`), ''] : []),
    ...items.flatMap(({ item, tool, result }) => [
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
