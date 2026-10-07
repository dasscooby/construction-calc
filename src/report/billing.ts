// Bids and final bills for a job: the price lines typed into the job, with the company up top,
// a total, and (on the bill) what's already been paid and the balance due.

import type { ChangeOrder, Job, PriceLine, Signature } from '../lib/jobs';
import type { Settings } from '../lib/settings';
import { commas, dec, ftIn, money } from '../tools/format';
import { parseLength, parseNumber, RawLength, RawWallRow } from '../tools/run';
import { DocMedia, docCss, logoHtml, noticeHtml, uniqueSvgIds } from './docStyle';
import { confirmedFoundation, pourCount, pourName } from './foundation';
import { bidOptions, refreshLines, remapLines } from './bidOptions';
import { buildLayout, LayoutRun, LayoutSpec } from './foundationLayout';
import { ledgeOf, slabDropIn } from './slabLedge';
import { Block, contentWidth, drawingCss, drawingPage, footerHtml, letterPortrait, pageCss, paginate, textHeight } from './pager';
import { builtItems, FiguredItem, itemRebarLb, jobDrawings, jobTotals, numberIn, pieceName, steelItems } from './report';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const num = (v: string | undefined) => {
  const n = parseNumber((v ?? '').replace(/[$,%\s]/g, ''));
  return n !== null && Number.isFinite(n) ? n : 0;
};

export const lineAmount = (l: Pick<PriceLine, 'qty' | 'price'>) => Math.round(num(l.qty || '1') * num(l.price) * 100) / 100;

export interface Money {
  subtotal: number;
  tax: number;
  total: number;
  paid: number;
  balance: number;
}

/** Change orders as bill lines: "Change order #2: Extra 10' of footing". */
export const changeLines = (job: Job): PriceLine[] =>
  (job.changes ?? []).filter((c) => c.desc.trim() || num(c.price)).map((c) => ({ id: c.id, desc: `Change order #${c.no}: ${c.desc}`, qty: c.qty, unit: c.unit, price: c.price }));

/** Bid total (no change orders), or the bill total with `withChanges`. */
export function priceTotals(job: Job, withChanges = false): Money {
  const subtotal = [...(job.lines ?? []), ...(withChanges ? changeLines(job) : [])].reduce((a, l) => a + lineAmount(l), 0);
  const tax = Math.round(subtotal * num(job.taxPct)) / 100;
  const total = subtotal + tax;
  const paid = num(job.paid);
  return { subtotal, tax, total, paid, balance: Math.round((total - paid) * 100) / 100 };
}

/** Concrete actually delivered on a finished pour (trucks counted in), or null if there's no finished pour. */
export function deliveredYd(job?: Job): number | null {
  const p = job?.pour;
  if (!p?.done || !p.trucksIn) return null;
  const planned = Math.max(1, Math.ceil(p.totalYd / p.truckYd - 1e-9));
  // Up to the planned trucks the last one is short; trucks past the plan count full.
  return p.trucksIn <= planned ? Math.min(p.totalYd, p.trucksIn * p.truckYd) : p.totalYd + (p.trucksIn - planned) * p.truckYd;
}

/**
 * Lines from what's in the job: each slab, wall, footing, pier and set of steps; excavation, base rock,
 * vapor barrier and dowels; then concrete (what was delivered, once the pour is done), rebar, a pump
 * if you ordered one, and labor. Prices come from your price book (Settings); blank ones are left for you.
 * Each line remembers where it came from (src) so it can stay in sync with the job.
 */
export function suggestLines(items: FiguredItem[], s?: Settings, job?: Job): Omit<PriceLine, 'id'>[] {
  const lines: Omit<PriceLine, 'id'>[] = [];
  const t = jobTotals(items, job);
  const p = s?.prices;
  const price = (v: string | undefined) => (v && num(v) ? dec(num(v), 2) : '');
  const rowNum = (rows: { label: string; value: string }[], label: string) => {
    const r = rows.find((x) => x.label === label);
    return r ? numberIn(r.value) : 0;
  };
  // Walls, footings and slab that make one foundation are bid together under its name.
  const fnd = confirmedFoundation(items, job);
  const inFnd = (id: string) => !!fnd && [...fnd.walls, ...fnd.footings, ...(fnd.slab ? [fnd.slab] : []), ...fnd.addOns.map((a) => a.item), ...fnd.pours].some((f) => f.item.id === id);
  const wallText = fnd ? `${Math.round(fnd.thickFt * 12)}" × ${ftIn(fnd.heightFt)}` : '';
  const ft = (v: unknown) => parseLength(v as RawLength) ?? 0;
  for (const { item, tool, result } of items) {
    if (result.status !== 'ok') continue;
    // A layout's wall forms are the load list; the walls themselves are billed.
    if (item.id.endsWith(':forms')) continue;
    const pour = fnd ? fnd.pours.findIndex((x) => x.item.id === item.id) : -1;
    const name = !inFnd(item.id) ? item.label || tool.title : fnd!.addOns.some((a) => a.item.item.id === item.id) ? `${fnd!.kind} add-on` : pour >= 0 ? `${fnd!.kind}, ${pourName(pour)}` : fnd!.kind;
    const raw = item.raw;
    const rows = result.result.rows;
    const src = `item:${item.id}`;
    const area = rows.find((r) => r.label === 'Slab area' || (r.label === 'Area' && !['fill-base', 'vapor-barrier'].includes(tool.id)));
    if (area && fnd?.slab?.item.id === item.id) {
      const inside = fnd.slabAtOutside && job?.slabBid === 'inside';
      const sqft = fnd.slabAtOutside ? (inside ? fnd.insideArea : fnd.outsideArea) : numberIn(area.value);
      lines.push({ desc: `${name}: slab${inside || !fnd.slabAtOutside ? ' inside the walls' : ''}, pour and finish`, qty: dec(sqft, 1), unit: 'sq ft', price: price(p?.slabSqFt), src });
    } else if (area) lines.push({ desc: `${name}: form, pour and finish`, qty: dec(numberIn(area.value), 1), unit: 'sq ft', price: price(p?.slabSqFt), src });
    else if (tool.id === 'wall-forms') {
      const total = ((raw.walls as RawWallRow[]) ?? []).reduce((a, w) => a + ft(w.length), 0);
      lines.push({ desc: `${name}: form and pour ${inFnd(item.id) ? `${wallText} ` : ''}walls`, qty: dec(total, 1), unit: 'ft', price: price(p?.wallFt), src });
    } else if (tool.id === 'footings' && raw.kind === 'wall') {
      // Walls entered in Footings & Walls: billed like Wall Forms, by the foot around the outside.
      const around = rows.some((r) => r.label === 'House, around the outside')
        ? rowNum(rows, 'House, around the outside')
        : rows.some((r) => r.label === 'As measured')
          ? rowNum(rows, 'As measured')
          : ft(raw.length) * (Number(raw.qty) || 1);
      lines.push({ desc: `${name}: form and pour ${inFnd(item.id) ? `${wallText} ` : ''}walls`, qty: dec(around, 1), unit: 'ft', price: price(p?.wallFt), src });
    } else if (tool.id === 'footings') {
      lines.push({
        desc: `${name}: ${inFnd(item.id) ? 'footings under the walls, ' : ''}dig, form and pour`,
        qty: dec(rows.some((r) => r.label === 'Along the middle') ? rowNum(rows, 'Along the middle') : ft(raw.length) * (Number(raw.qty) || 1), 1),
        unit: 'ft',
        price: price(p?.footingFt),
        src,
      });
    } else if (tool.id === 'piers') {
      lines.push({ desc: `${name}: drill and pour`, qty: String(Number(raw.qty) || 1), unit: 'ea', price: price(p?.pierEa), src });
    } else if (tool.id === 'steps') {
      lines.push({ desc: `${name}: form and pour steps`, qty: '1', unit: 'set', price: price(p?.stepsSet), src });
    } else if (tool.id === 'excavation') {
      lines.push({ desc: `${item.label || 'Excavation'}: dig and haul`, qty: dec(rowNum(rows, 'In the ground'), 2), unit: 'yd', price: price(p?.excavYd), src });
    } else if (tool.id === 'fill-base') {
      lines.push({ desc: `${item.label || 'Base rock'}: placed and compacted`, qty: dec(rowNum(rows, 'Tons'), 1), unit: 'tons', price: price(p?.baseTon), src });
    } else if (tool.id === 'vapor-barrier') {
      lines.push({ desc: 'Vapor barrier', qty: dec(rowNum(rows, 'Area'), 1), unit: 'sq ft', price: price(p?.barrierSqFt), src });
    } else if (tool.id === 'dowels') {
      lines.push({ desc: `${item.label || 'Dowels'}: drilled and set`, qty: String(rowNum(rows, 'Total')), unit: 'ea', price: price(p?.dowelEa), src });
    }
    // Dowels into the house or an existing slab, from a slab.
    const dowels = rows.find((r) => r.label === 'Dowels');
    if (dowels) lines.push({ desc: `${name}: dowels drilled and epoxied`, qty: String(numberIn(dowels.value)), unit: 'ea', price: price(p?.dowelEa), src: `${src}:dowels` });
  }
  const delivered = deliveredYd(job);
  if (delivered !== null) {
    lines.push({ desc: 'Concrete (delivered)', qty: dec(delivered, 2), unit: 'yd', price: price(s?.defaults.price) || (t.concreteCost && t.concreteOrderYd ? dec(t.concreteCost / t.concreteOrderYd, 2) : ''), src: 'concrete' });
  } else if (t.concreteOrderYd) {
    const perYd = t.concreteCost ? dec(t.concreteCost / t.concreteOrderYd, 2) : price(s?.defaults.price);
    lines.push({ desc: 'Concrete', qty: dec(t.concreteOrderYd, 2), unit: 'yd', price: perYd, src: 'concrete' });
  }
  // Rebar, a line for each piece that has it (footings, walls, slab, cut lists ...).
  for (const f of steelItems(builtItems(items, job).items)) {
    const lb = itemRebarLb(f);
    if (lb > 0) lines.push({ desc: `${pieceName(f, items, job)}: rebar, cut, bent and tied`, qty: String(Math.round(lb)), unit: 'lb', price: price(p?.rebarLb), src: `item:${f.item.id}:rebar` });
  }
  const layoutPours = items.filter((x) => /:(footings|walls|slab\d+)$/.test(x.item.id)).length;
  if (job?.order?.place === 'pump') lines.push({ desc: 'Pump truck', qty: String(layoutPours || (fnd ? pourCount(fnd) : 1)), unit: 'pour', price: price(p?.pumpPour), src: 'pump' });
  lines.push({ desc: 'Labor', qty: '1', unit: 'job', price: price(p?.laborJob), src: 'labor' });
  return lines;
}

/**
 * Keeps the job's lines in step with the job: lines that came from it get fresh quantities (your
 * prices and wording stay), new ones are added, and ones whose source is gone are dropped.
 * Lines you typed yourself are never touched.
 */
export function syncLines(current: PriceLine[], fresh: Omit<PriceLine, 'id'>[]): (PriceLine | Omit<PriceLine, 'id'>)[] {
  const bySrc = new Map(fresh.filter((l) => l.src).map((l) => [l.src!, l]));
  const out: (PriceLine | Omit<PriceLine, 'id'>)[] = [];
  const seen = new Set<string>();
  for (const l of current) {
    if (!l.src) {
      out.push(l);
      continue;
    }
    const f = bySrc.get(l.src);
    if (!f) continue; // its tool was taken out of the job
    seen.add(l.src);
    out.push({ ...l, qty: f.qty, unit: f.unit, price: l.price || f.price, desc: l.src === 'concrete' ? f.desc : l.desc });
  }
  for (const f of fresh) if (f.src && !seen.has(f.src)) out.push(f);
  return out;
}

const docNumber = (job: Job) => {
  const d = new Date(job.createdAt);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-${job.id.slice(-3).toUpperCase()}`;
};

const STYLE = `
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #111; margin: 0; background: #fff; }
  .top { display: flex; justify-content: space-between; gap: 16px; border-bottom: 3px solid #111; padding-bottom: 12px; }
  .co { font-size: 14px; line-height: 1.45; }
  .co b { font-size: 20px; }
  .doc { text-align: right; }
  .doc h1 { font-size: 28px; margin: 0 0 4px; letter-spacing: .04em; }
  .meta { font-size: 13px; color: #444; }
  .to { display: flex; gap: 40px; margin: 18px 0; font-size: 14px; }
  .to h4 { margin: 0 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #666; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: #555; border-bottom: 2px solid #111; padding: 6px 4px; }
  td { padding: 8px 4px; border-bottom: 1px solid #ddd; font-size: 14px; vertical-align: top; }
  .r { text-align: right; white-space: nowrap; }
  .sum { width: 300px; margin-left: auto; margin-top: 10px; }
  .sum td { border: 0; padding: 4px; }
  .sum tr.total td { border-top: 2px solid #111; font-size: 18px; font-weight: 700; padding-top: 8px; }
  .sum tr.due td { font-size: 20px; font-weight: 800; background: #fff4dc; }
  .terms { margin-top: 22px; font-size: 13px; color: #333; white-space: pre-wrap; }
  .sign { display: flex; gap: 30px; margin-top: 40px; font-size: 13px; align-items: flex-end; }
  .sign > div { flex: 1; }
  .sign .line { border-top: 1px solid #111; padding-top: 4px; }
  .sign svg { display: block; height: 60px; max-width: 100%; }
  .sign .filled { font-size: 15px; padding-bottom: 4px; }
  .co-sum { width: 340px; margin-left: auto; margin-top: 10px; }
  .draw { border: 1px solid #ccc; border-radius: 10px; overflow: hidden; margin-top: 10px; break-inside: avoid; page-break-inside: avoid; }
  h3.page { break-before: page; page-break-before: always; }
  .draw svg { display: block; width: 100%; height: auto; max-height: 92vh; }
  h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: #333; margin: 26px 0 6px; border-bottom: 2px solid #111; padding-bottom: 4px; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .08em; color: #333; margin: 0 0 6px; padding-top: 4px; }
  table.scope td.k { width: 30%; font-weight: 700; }
  .scope { margin: 0; padding: 0; list-style: none; }
  .scope li { font-size: 14px; padding: 6px 0; border-bottom: 1px solid #e5e5e5; display: flex; gap: 12px; }
  .scope li b { min-width: 34%; }
  .scope li span { flex: 1; color: #222; }
  .foot { margin-top: 28px; font-size: 11px; color: #888; text-align: center; }
  .print { position: fixed; right: 16px; bottom: 16px; padding: 12px 18px; border-radius: 999px; border: 0; background: #ff9f0a; color: #000; font-size: 16px; font-weight: 700; }
  @media print { .print { display: none; } body { padding: 0; } }`;

const fmtDate = (t: number | Date) => new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

/** A signature line: the finger signature and name/date when signed, blank lines to sign by hand when not. */
export function signBlock(who: string, sig?: Signature): string {
  if (!sig) return `<div class="sign"><div><div class="line">${who}</div></div><div><div class="line">Date</div></div></div>`;
  const ink = `<svg viewBox="0 0 ${sig.w} ${sig.h}" preserveAspectRatio="xMinYMax meet"><path d="${sig.d}" fill="none" stroke="#111" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return `<div class="sign"><div>${ink}<div class="line">${who}: ${esc(sig.name)}</div></div><div><div class="filled">${fmtDate(sig.at)}</div><div class="line">Date</div></div></div>`;
}

/**
 * Every piece of the job in plain words, priced or not, so the bid shows the whole job: walls, footings,
 * each slab and its pour, rebar, concrete and pumps, and anything else in it.
 */
export function scopeOfWork(items: FiguredItem[], job: Job): [string, string][] {
  const out: [string, string][] = [];
  const row = (f: FiguredItem, label: string) => (f.result.status === 'ok' ? f.result.result.rows.find((r) => r.label === label) : undefined);
  let rebar = 0;
  let yards = 0;
  for (const f of items) {
    if (f.result.status !== 'ok' || f.item.id.endsWith(':forms')) continue;
    const name = f.item.label || f.tool.title;
    const parts: string[] = [];
    const measured = row(f, 'As measured') ?? row(f, 'House, around the outside');
    const middle = row(f, 'Along the middle');
    const area = row(f, 'Slab area');
    const outside = row(f, 'To the outside of the walls');
    if (measured) parts.push(`${measured.value} as measured`);
    else if (middle) parts.push(`${middle.value}`);
    if (area) parts.push(outside ? `${area.value} poured inside the walls (${outside.value} to the outside)` : area.value);
    const order = row(f, 'Order');
    if (order) {
      parts.push(`${order.value} of concrete`);
      yards += numberIn(order.value);
    }
    const lb = itemRebarLb(f);
    if (lb > 0) {
      parts.push(`${commas(Math.round(lb))} lb rebar`);
      rebar += lb;
    }
    if (!parts.length) {
      const big = f.result.result.rows.find((r) => r.big);
      if (big) parts.push(`${big.label}: ${big.value}`);
    }
    if (parts.length) out.push([name, parts.join(' · ')]);
  }
  const pours = items.filter((x) => /:(footings|walls|slab\d+)$/.test(x.item.id)).length;
  // A foundation layout: the walls by where they are, and their size.
  const layoutItem = job.items.find((it) => it.toolId === 'foundation-layout');
  const spec = (layoutItem?.raw as { layout?: LayoutSpec } | undefined)?.layout;
  if (spec?.house?.length) {
    const l = buildLayout(spec);
    const sum = (ok: (r: LayoutRun) => boolean) => l.runs.filter((r) => !r.existing && ok(r)).reduce((t, r) => t + r.measured, 0);
    const parts = [
      ['Main', sum((r) => r.group === 'Main')],
      ['add-on outside walls', sum((r) => r.group !== 'Main' && !/inside/.test(r.name))],
      ['inside walls', sum((r) => /inside/.test(r.name))],
    ].filter(([, v]) => (v as number) > 0);
    const at = out.findIndex(([k]) => k === 'Walls');
    const line: [string, string] = [
      'Wall breakdown',
      `${parts.map(([k, v]) => `${k} ${ftIn(v as number).replace(/ 0"$/, '')}`).join(' · ')} · ${Math.round(spec.wall.thick * 12)}" thick × ${ftIn(spec.wall.height).replace(/ 0"$/, '')} tall${spec.footing ? ` on a ${Math.round(spec.footing.width * 12)}" × ${Math.round(spec.footing.depth * 12)}" footing` : ''}`,
    ];
    if (at >= 0) out.splice(at + 1, 0, line);
    else out.push(line);
    // Where the slabs sit in the walls.
    if (l.slabs.length) {
      const drop = slabDropIn(spec, l.slabs[0].thick);
      const ledge = ledgeOf(l);
      const lastSlab = out.reduce((k, [name], i) => (/^Slab \d/.test(name) ? i : k), -1);
      const where: [string, string] = [
        'Slab in the walls',
        `Top of slab ${drop > 0 ? `${drop}" below` : 'flush with'} the top of the wall${ledge ? ` · ${ledge.ledgeIn}" ledge cut in the walls from the bottom of the slab up; the slab runs onto it` : ''}`,
      ];
      if (lastSlab >= 0) out.splice(lastSlab + 1, 0, where);
      else out.push(where);
    }
  }
  if (yards) out.push(['Concrete', `${dec(yards, 2)} yd${pours > 1 ? ` in ${pours} pours` : ''}`]);
  if (rebar) {
    const by = items
      .filter((f) => f.result.status === 'ok' && itemRebarLb(f) > 0 && !f.item.id.endsWith(':forms'))
      .map((f) => `${f.item.label || f.tool.title} ${commas(Math.round(itemRebarLb(f)))} lb`);
    out.push(['Rebar', `${commas(Math.round(rebar))} lb, cut, bent and tied${by.length > 1 ? ` (${by.join(' · ')})` : ''}`]);
  }
  if (job.order?.place === 'pump') out.push(['Pump truck', `${pours > 1 ? `${pours} pours` : 'for the pour'}`]);
  return out;
}

function moneyDoc(kind: 'bid' | 'bill', job: Job, s: Settings, items: FiguredItem[], now: Date, media: DocMedia): { html: string; text: string } {
  const c = s.company;
  // Lines made before the foundation layout took over a piece bill as the layout's piece (never the hidden one).
  const sources = bidOptions(items, s, job);
  const current = refreshLines(remapLines(job.lines ?? [], job, sources), sources);
  // The bill adds any change orders after the bid's lines.
  const lines = [...current, ...(kind === 'bill' ? changeLines(job) : [])].filter((l) => l.desc.trim() || num(l.price));
  const m = priceTotals({ ...job, lines, changes: [] });
  const title = kind === 'bid' ? 'BID' : 'INVOICE';
  const date = now.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const no = docNumber(job);
  const coLines = [c.phone, c.email, c.license && `Lic #${c.license.replace(/^#/, '')}`].filter((x) => x && x.trim());
  const qtyText = (l: PriceLine) => (l.qty ? `${commas(num(l.qty), num(l.qty) % 1 ? 2 : 0)}${l.unit ? ` ${l.unit}` : ''}` : '');
  const drawings = kind === 'bid' ? jobDrawings(job, items, s.company.name) : null;
  const scope = scopeOfWork(items, job);

  const sumRows: [string, string, string?][] = [['Subtotal', money(m.subtotal)]];
  if (m.tax) sumRows.push([`Tax (${dec(num(job.taxPct), 2)}%)`, money(m.tax)]);
  sumRows.push(['Total', money(m.total), 'total']);
  const depositPct = num(s.prices.depositPct);
  if (kind === 'bid' && depositPct > 0) sumRows.push([`Deposit to start (${dec(depositPct, 1)}%)`, money(Math.round(m.total * depositPct) / 100)]);
  if (kind === 'bill') {
    if (m.paid) sumRows.push(['Paid', `−${money(m.paid)}`]);
    sumRows.push(['Balance due', money(m.balance), 'due']);
  }
  // Calendar days (adding hours would slip a day when the clocks change).
  const days = (d: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
  const terms = num(s.prices.termsDays);
  const when = kind === 'bid' ? `Good through ${fmtDate(days(30))}` : terms > 0 ? `Due ${fmtDate(days(terms))}` : 'Due on receipt';

  // Laid out on Letter pages: the bid (lines run on with their heads if there are many), the totals
  // kept with the signature, the scope of work on a fresh page, then each drawing on a page of its own.
  const box = letterPortrait;
  const W = contentWidth(box);
  const header = `<div class="top"><div class="co">${logoHtml(media.logo)}${c.name ? `<b>${esc(c.name)}</b><br>` : ''}${coLines.map(esc).join('<br>')}</div>
<div class="doc"><h1>${title}</h1><div class="meta">#${no}</div><div class="meta">${esc(date)}</div><div class="meta"><b>${esc(when)}</b></div></div></div>
<div class="to">${job.customer ? `<div><h4>${kind === 'bid' ? 'Prepared for' : 'Bill to'}</h4>${esc(job.customer).replace(/\n/g, '<br>')}</div>` : ''}
<div><h4>Job</h4>${esc(job.name)}${job.address ? `<br>${esc(job.address)}` : ''}</div></div>`;
  const headerH = 150 + (media.logo ? 70 : 0) + Math.max(coLines.length * 20, (job.customer ?? '').split('\n').length * 20);
  const sumH = sumRows.length * 30 + 24;
  const notice = noticeHtml(kind, s.docs);
  const blocks: Block[] = [
    { kind: 'block', html: header, h: headerH, keepWithNext: true },
    {
      kind: 'table',
      title: '',
      contTitle: kind === 'bid' ? 'Bid' : 'Invoice',
      cls: 'lines',
      head: '<tr><th>Description</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Amount</th></tr>',
      headH: 34,
      rows: lines.map((l) => ({
        html: `<tr><td>${esc(l.desc)}</td><td class="r">${esc(qtyText(l))}</td><td class="r">${num(l.price) ? money(num(l.price)) : ''}</td><td class="r">${money(lineAmount(l))}</td></tr>`,
        h: textHeight(l.desc, 14, W * 0.5) + 15,
      })),
    },
    {
      kind: 'block',
      html: `<table class="sum">${sumRows.map(([k, v, cls]) => `<tr class="${cls ?? ''}"><td>${k}</td><td class="r">${v}</td></tr>`).join('')}</table>`,
      h: sumH,
      keepWithNext: kind === 'bid',
    },
    ...(kind === 'bid' ? [{ kind: 'block' as const, html: signBlock('Accepted by', job.signature), h: job.signature ? 120 : 80 }] : []),
    ...(notice ? [{ kind: 'block' as const, html: notice, h: textHeight(notice.replace(/<[^>]+>/g, ''), 13, W) + 40 }] : []),
  ];
  if (scope.length) {
    blocks.push({
      kind: 'table',
      title: 'Scope of work',
      cls: 'scope',
      head: '<tr><th>What</th><th>Included</th></tr>',
      headH: 34,
      newPage: true,
      rows: scope.map(([k, v]) => ({
        html: `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`,
        h: Math.max(textHeight(k, 14, W * 0.3), textHeight(v, 14, W * 0.66)) + 16,
      })),
    });
  }
  const sheetNote = `${esc(job.name)} · ${esc(date)}`;
  if (drawings?.plan) blocks.push(drawingPage(drawings.plan, 'Plan', sheetNote, box));
  if (drawings?.iso) blocks.push(drawingPage(drawings.iso, '3D view', sheetNote, box));
  if (drawings?.section) blocks.push(drawingPage(drawings.section, 'Typical section', sheetNote, box));

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(job.name)} – ${kind === 'bid' ? 'Bid' : 'Invoice'}</title><style>${STYLE}${docCss(s.docs)}${pageCss(box)}${drawingCss}</style></head><body>
${paginate(blocks, box, (n, of) => footerHtml(`${esc(job.name)} · ${kind === 'bid' ? 'Bid' : 'Invoice'} #${no} · ${esc(date)}`, n, of))}
<button class="print" onclick="window.print()">Save as PDF / Print</button>
</body></html>`;

  const text = [
    `${kind === 'bid' ? 'Bid' : 'Invoice'} #${no} · ${date} · ${when}`,
    c.name,
    job.customer ? `${kind === 'bid' ? 'For' : 'Bill to'}: ${job.customer}` : '',
    `Job: ${job.name}${job.address ? `, ${job.address}` : ''}`,
    '',
    ...lines.map((l) => `${l.desc}${qtyText(l) ? ` (${qtyText(l)})` : ''}: ${money(lineAmount(l))}`),
    '',
    ...sumRows.map(([k, v]) => `${k}: ${v}`),
    '',
    ...(scope.length ? ['Scope of work:', ...scope.map(([k, v]) => `• ${k}: ${v}`), ''] : []),
    [c.phone, c.email].filter(Boolean).join(' · '),
  ]
    .filter((l, i, a) => l !== '' || a[i - 1] !== '')
    .join('\n')
    .trim();
  return { html: uniqueSvgIds(html), text };
}

export const buildBid = (job: Job, s: Settings, items: FiguredItem[], now = new Date(), media: DocMedia = {}) => moneyDoc('bid', job, s, items, now, media);

/** One change order: what's added, the contract before and after, and a place to sign. */
export function buildChange(job: Job, s: Settings, change: ChangeOrder, now = new Date(), media: DocMedia = {}): { html: string; text: string } {
  const c = s.company;
  const coLines = [c.phone, c.email, c.license && `Lic #${c.license.replace(/^#/, '')}`].filter((x) => x && x.trim());
  const original = priceTotals({ ...job, changes: [] }).total;
  const earlier = (job.changes ?? []).filter((x) => x.no < change.no).reduce((a, x) => a + lineAmount(x), 0);
  const thisOne = lineAmount(change);
  const qty = change.qty ? `${commas(num(change.qty), num(change.qty) % 1 ? 2 : 0)}${change.unit ? ` ${change.unit}` : ''}` : '';
  const rows: [string, string, string?][] = [['Original contract', money(original)]];
  if (earlier) rows.push(['Earlier change orders', money(earlier)]);
  rows.push(['This change order', money(thisOne)]);
  rows.push(['New contract total', money(original + earlier + thisOne), 'total']);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(job.name)} – Change order ${change.no}</title><style>${STYLE}${docCss(s.docs)}</style></head><body>
<div class="top"><div class="co">${logoHtml(media.logo)}${c.name ? `<b>${esc(c.name)}</b><br>` : ''}${coLines.map(esc).join('<br>')}</div>
<div class="doc"><h1>CHANGE ORDER</h1><div class="meta">#${docNumber(job)}-${change.no}</div><div class="meta">${esc(fmtDate(change.at || now))}</div></div></div>
<div class="to">${job.customer ? `<div><h4>For</h4>${esc(job.customer).replace(/\n/g, '<br>')}</div>` : ''}
<div><h4>Job</h4>${esc(job.name)}${job.address ? `<br>${esc(job.address)}` : ''}</div></div>
<table><tr><th>Change</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Amount</th></tr>
<tr><td>${esc(change.desc)}</td><td class="r">${esc(qty)}</td><td class="r">${num(change.price) ? money(num(change.price)) : ''}</td><td class="r">${money(thisOne)}</td></tr></table>
<table class="sum co-sum">${rows.map(([k, v, cls]) => `<tr class="${cls ?? ''}"><td>${k}</td><td class="r">${v}</td></tr>`).join('')}</table>
${signBlock('Approved by', change.signature)}
${noticeHtml('change', s.docs)}
<button class="print" onclick="window.print()">Save as PDF / Print</button>
</body></html>`;
  const text = [
    `Change order #${change.no} · ${job.name}`,
    c.name,
    `${change.desc}${qty ? ` (${qty})` : ''}: ${money(thisOne)}`,
    ...rows.map(([k, v]) => `${k}: ${v}`),
  ]
    .filter(Boolean)
    .join('\n');
  return { html: uniqueSvgIds(html), text };
}
export const buildBill = (job: Job, s: Settings, items: FiguredItem[], now = new Date(), media: DocMedia = {}) => moneyDoc('bill', job, s, items, now, media);
