// The job report ("the bill"): every calculation in a job figured fresh, the order added up,
// a blueprint plan and a 3D view, as one printable page (HTML → PDF) or plain text.

import type { Job, JobItem } from '../lib/jobs';
import { companyLine, Settings } from '../lib/settings';
import { ALL_TOOLS } from '../tools';
import { commas, cuYd, dec, money } from '../tools/format';
import { parseLength, parseNumber, RawArea, RawWallRow, restoreRaw, runTool, RunResult } from '../tools/run';
import { fieldText } from '../tools/share';
import type { ResultRow, Tool } from '../tools/types';
import { isoSvg, planSvg, sideLabels } from './drawings';
import { insetOutline, Pt, wallOutline } from './geometry';

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
    const tool = ALL_TOOLS.find((t) => t.id === item.toolId);
    if (!tool) continue; // a tool that was removed in an update
    const raw = restoreRaw(tool, item.raw);
    const inputs = tool.fields.flatMap((f) => {
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
  for (const { item, tool, result } of items) {
    if (result.status !== 'ok') continue;
    const rows = result.result.rows;
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
    if (row('Weight') && / lb$/.test(row('Weight')!.value)) t.rebarLb += numberIn(row('Weight')!.value);
    const sticks = row('Sticks to order');
    if (sticks) {
      const m = sticks.value.match(/^([\d,]+) × (\d+)'$/);
      const size = typeof item.raw.barSize === 'string' ? `#${item.raw.barSize} ` : '';
      if (m) add(t.sticks, `${size}${m[2]}' sticks`, numberIn(m[1]));
      else add(t.sticks, `Sticks (${tool.title})`, numberIn(sticks.value));
    }
  }
  return t;
}

/** The plan and 3D view: from Wall Forms walls if the job has them, else from a one-piece slab. */
export function jobDrawings(job: Job, items: FiguredItem[]): { plan: string; iso: string } | null {
  const walls = items.find((f) => f.tool.id === 'wall-forms' && f.result.status === 'ok');
  const slab = items.find((f) => (f.tool.id === 'slab' || f.tool.id === 'slab-beams') && f.result.status === 'ok');
  const title = job.name;
  const date = new Date(job.createdAt).toLocaleDateString();
  if (walls) {
    const raw = restoreRaw(walls.tool, walls.item.raw);
    const run = runTool(walls.tool, raw);
    if (run.status !== 'ok') return null;
    // Re-read the walls the same way the tool does.
    const rows = (raw.walls as RawWallRow[])
      .map((r) => ({ length: parseLength(r.length) ?? 0, ends: r.ends }))
      .filter((r) => r.length > 0);
    const outline = wallOutline(rows);
    if (!outline || !outline.closed) return null;
    const t = (parseNumber(String(raw.thick)) ?? 8) / 12;
    const inner = insetOutline(outline.points, t);
    const heightText = run.result.rows.find((r) => r.label === 'Wall height')?.value ?? `4'`;
    const hFt = parseHeight(heightText) || 4;
    const slabThick = slab ? parseHeight(slab.inputs.find((i) => i.label.toLowerCase().includes('thickness'))?.value ?? '') : 0;
    return {
      plan: planSvg({ outer: outline.points, inner, labels: sideLabels(outline.points), title, subtitle: `${dec(t * 12)}" walls, ${heightText} tall · ${date}` }),
      iso: isoSvg({ outer: outline.points, inner, height: hFt, slabThick: slabThick || undefined }),
    };
  }
  if (slab) {
    const raw = restoreRaw(slab.tool, slab.item.raw);
    const filled = (raw.areas as RawArea[]).filter((a) => parseLength(a.length) !== null);
    if (filled.length !== 1) return null;
    const L = parseLength(filled[0].length) ?? 0;
    const Wd = parseLength(filled[0].width) ?? 0;
    if (!(L > 0 && Wd > 0)) return null;
    const outer: Pt[] = [
      { x: 0, y: 0 },
      { x: L, y: 0 },
      { x: L, y: Wd },
      { x: 0, y: Wd },
    ];
    const thick = parseHeight(slab.inputs.find((i) => i.label.toLowerCase().includes('thickness'))?.value ?? '') || 4 / 12;
    return {
      plan: planSvg({ outer, labels: sideLabels(outer), title, subtitle: `${dec(thick * 12)}" slab · ${date}` }),
      // Exaggerate the thickness a little so the slab reads as 3D.
      iso: isoSvg({ outer, height: Math.max(thick, Math.max(L, Wd) / 40) }),
    };
  }
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

export function buildReport(job: Job, s: Settings, now = new Date()): { html: string; text: string } {
  const items = figureItems(job);
  const totals = jobTotals(items);
  const drawings = jobDrawings(job, items);
  const company = companyLine(s);
  const sum = totalsRows(totals);
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
<title>${esc(job.name)} – Job report</title>
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
  .foot { margin-top: 24px; font-size: 11px; color: #888; text-align: center; }
  .print { position: fixed; right: 16px; bottom: 16px; padding: 12px 18px; border-radius: 999px; border: 0; background: #ff9f0a; color: #000; font-size: 16px; font-weight: 700; }
  @media print { .print { display: none; } body { padding: 0; } }
</style></head><body>
<div class="top"><div><h1>${esc(job.name)}</h1>${job.address ? `<div class="meta">${esc(job.address)}</div>` : ''}<div class="meta">${esc(date)}</div></div>
${company ? `<div class="co">${esc(company).replace(/ · /g, '<br>')}</div>` : ''}</div>
${sum.length ? `<h2>Order summary</h2><table class="sum">${sum.map((r) => `<tr><td>${esc(r.label)}</td><td class="v">${esc(r.value)}</td></tr>`).join('')}</table>` : ''}
${drawings ? `<h2>Plan</h2><div class="draw">${drawings.plan}</div><h2>3D view</h2><div class="draw">${drawings.iso}</div>` : ''}
${items.length ? `<h2>Details</h2>${itemHtml}` : '<p>Nothing added to this job yet.</p>'}
${job.notes ? `<h2>Notes</h2><div class="notes">${esc(job.notes)}</div>` : ''}
<div class="foot">Made with Construction Calc · Field numbers — always follow your plans and your engineer.</div>
<button class="print" onclick="window.print()">Save as PDF / Print</button>
</body></html>`;

  const text = [
    `${job.name} – Job report`,
    job.address,
    date,
    '',
    ...(sum.length ? ['ORDER SUMMARY', ...sum.map((r) => `${r.label}: ${r.value}`), ''] : []),
    ...items.flatMap(({ item, tool, result }) => [
      `— ${item.label || tool.title}`,
      ...(result.status === 'ok' ? result.result.rows.filter((r) => r.big).map((r) => `${r.label.trim()}: ${r.value}`) : [`Not finished: ${result.message}`]),
      '',
    ]),
    ...(job.notes ? ['NOTES', job.notes, ''] : []),
    company,
  ]
    .filter((l, i, a) => !(l === '' && a[i - 1] === ''))
    .join('\n')
    .trim();

  return { html, text };
}
