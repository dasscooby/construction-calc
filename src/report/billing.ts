// Bids and final bills for a job: the price lines typed into the job, with the company up top,
// a total, and (on the bill) what's already been paid and the balance due.

import type { ChangeOrder, Job, PriceLine, Signature } from '../lib/jobs';
import type { Settings } from '../lib/settings';
import { commas, dec, money } from '../tools/format';
import { parseLength, parseNumber, RawLength, RawWallRow } from '../tools/run';
import { DocMedia, docCss, logoHtml, noticeHtml } from './docStyle';
import { FiguredItem, jobDrawings, jobTotals, numberIn } from './report';

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

/**
 * Starting lines from what's in the job: each slab, wall, footing, pier and set of steps,
 * then concrete, rebar and labor. Prices come from your price book (Settings); blank ones are left for you.
 */
export function suggestLines(items: FiguredItem[], s?: Settings): Omit<PriceLine, 'id'>[] {
  const lines: Omit<PriceLine, 'id'>[] = [];
  const t = jobTotals(items);
  const p = s?.prices;
  const price = (v: string | undefined) => (v && num(v) ? dec(num(v), 2) : '');
  const ft = (v: unknown) => parseLength(v as RawLength) ?? 0;
  for (const { item, tool, result } of items) {
    if (result.status !== 'ok') continue;
    const name = item.label || tool.title;
    const raw = item.raw;
    const area = result.result.rows.find((r) => r.label === 'Slab area' || r.label === 'Area');
    if (area) lines.push({ desc: `${name}: form, pour and finish`, qty: dec(numberIn(area.value), 1), unit: 'sq ft', price: price(p?.slabSqFt) });
    else if (tool.id === 'wall-forms') {
      const total = ((raw.walls as RawWallRow[]) ?? []).reduce((a, w) => a + ft(w.length), 0);
      lines.push({ desc: `${name}: form and pour walls`, qty: dec(total, 1), unit: 'ft', price: price(p?.wallFt) });
    } else if (tool.id === 'footings') {
      lines.push({ desc: `${name}: dig, form and pour`, qty: dec(ft(raw.length) * (Number(raw.qty) || 1), 1), unit: 'ft', price: price(p?.footingFt) });
    } else if (tool.id === 'piers') {
      lines.push({ desc: `${name}: drill and pour`, qty: String(Number(raw.qty) || 1), unit: 'ea', price: price(p?.pierEa) });
    } else if (tool.id === 'steps') {
      lines.push({ desc: `${name}: form and pour steps`, qty: '1', unit: 'set', price: price(p?.stepsSet) });
    }
  }
  if (t.concreteOrderYd) {
    const perYd = t.concreteCost ? dec(t.concreteCost / t.concreteOrderYd, 2) : price(s?.defaults.price);
    lines.push({ desc: 'Concrete', qty: dec(t.concreteOrderYd, 2), unit: 'yd', price: perYd });
  }
  if (t.rebarLb) lines.push({ desc: 'Rebar, cut, bent and tied', qty: String(Math.round(t.rebarLb)), unit: 'lb', price: price(p?.rebarLb) });
  lines.push({ desc: 'Labor', qty: '1', unit: 'job', price: price(p?.laborJob) });
  return lines;
}

const docNumber = (job: Job) => {
  const d = new Date(job.createdAt);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-${job.id.slice(-3).toUpperCase()}`;
};

const STYLE = `
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #111; margin: 0; padding: 28px; background: #fff; }
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
  .draw { border: 1px solid #ccc; border-radius: 10px; overflow: hidden; margin-top: 18px; break-inside: avoid; }
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

function moneyDoc(kind: 'bid' | 'bill', job: Job, s: Settings, items: FiguredItem[], now: Date, media: DocMedia): { html: string; text: string } {
  const c = s.company;
  // The bill adds any change orders after the bid's lines.
  const lines = [...(job.lines ?? []), ...(kind === 'bill' ? changeLines(job) : [])].filter((l) => l.desc.trim() || num(l.price));
  const m = priceTotals({ ...job, lines, changes: [] });
  const title = kind === 'bid' ? 'BID' : 'INVOICE';
  const date = now.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const no = docNumber(job);
  const coLines = [c.phone, c.email, c.license && `Lic #${c.license.replace(/^#/, '')}`].filter((x) => x && x.trim());
  const qtyText = (l: PriceLine) => (l.qty ? `${commas(num(l.qty), num(l.qty) % 1 ? 2 : 0)}${l.unit ? ` ${l.unit}` : ''}` : '');
  const plan = kind === 'bid' ? jobDrawings(job, items)?.plan : undefined;

  const sumRows: [string, string, string?][] = [['Subtotal', money(m.subtotal)]];
  if (m.tax) sumRows.push([`Tax (${dec(num(job.taxPct), 2)}%)`, money(m.tax)]);
  sumRows.push(['Total', money(m.total), 'total']);
  if (kind === 'bill') {
    if (m.paid) sumRows.push(['Paid', `−${money(m.paid)}`]);
    sumRows.push(['Balance due', money(m.balance), 'due']);
  }

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(job.name)} – ${kind === 'bid' ? 'Bid' : 'Invoice'}</title><style>${STYLE}${docCss(s.docs)}</style></head><body>
<div class="top"><div class="co">${logoHtml(media.logo)}${c.name ? `<b>${esc(c.name)}</b><br>` : ''}${coLines.map(esc).join('<br>')}</div>
<div class="doc"><h1>${title}</h1><div class="meta">#${no}</div><div class="meta">${esc(date)}</div></div></div>
<div class="to">${job.customer ? `<div><h4>${kind === 'bid' ? 'Prepared for' : 'Bill to'}</h4>${esc(job.customer).replace(/\n/g, '<br>')}</div>` : ''}
<div><h4>Job</h4>${esc(job.name)}${job.address ? `<br>${esc(job.address)}` : ''}</div></div>
<table><tr><th>Description</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Amount</th></tr>
${lines.map((l) => `<tr><td>${esc(l.desc)}</td><td class="r">${esc(qtyText(l))}</td><td class="r">${num(l.price) ? money(num(l.price)) : ''}</td><td class="r">${money(lineAmount(l))}</td></tr>`).join('')}
</table>
<table class="sum">${sumRows.map(([k, v, cls]) => `<tr class="${cls ?? ''}"><td>${k}</td><td class="r">${v}</td></tr>`).join('')}</table>
${kind === 'bid' ? signBlock('Accepted by', job.signature) : ''}
${plan ? `<div class="draw">${plan}</div>` : ''}
${noticeHtml(kind, s.docs)}
<button class="print" onclick="window.print()">Save as PDF / Print</button>
</body></html>`;

  const text = [
    `${kind === 'bid' ? 'Bid' : 'Invoice'} #${no} · ${date}`,
    c.name,
    job.customer ? `${kind === 'bid' ? 'For' : 'Bill to'}: ${job.customer}` : '',
    `Job: ${job.name}${job.address ? `, ${job.address}` : ''}`,
    '',
    ...lines.map((l) => `${l.desc}${qtyText(l) ? ` (${qtyText(l)})` : ''}: ${money(lineAmount(l))}`),
    '',
    ...sumRows.map(([k, v]) => `${k}: ${v}`),
    '',
    [c.phone, c.email].filter(Boolean).join(' · '),
  ]
    .filter((l, i, a) => l !== '' || a[i - 1] !== '')
    .join('\n')
    .trim();
  return { html, text };
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
  return { html, text };
}
export const buildBill = (job: Job, s: Settings, items: FiguredItem[], now = new Date(), media: DocMedia = {}) => moneyDoc('bill', job, s, items, now, media);
