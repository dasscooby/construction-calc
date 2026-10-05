// Bids and final bills for a job: the price lines typed into the job, with the company up top,
// a total, and (on the bill) what's already been paid and the balance due.

import type { Job, PriceLine } from '../lib/jobs';
import type { Settings } from '../lib/settings';
import { commas, dec, money } from '../tools/format';
import { parseNumber } from '../tools/run';
import { docCss, noticeHtml } from './docStyle';
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

export function priceTotals(job: Job): Money {
  const subtotal = (job.lines ?? []).reduce((a, l) => a + lineAmount(l), 0);
  const tax = Math.round(subtotal * num(job.taxPct)) / 100;
  const total = subtotal + tax;
  const paid = num(job.paid);
  return { subtotal, tax, total, paid, balance: Math.round((total - paid) * 100) / 100 };
}

/** Starting lines from what's in the job: slab areas, concrete, rebar, forms, then labor. Prices left for you. */
export function suggestLines(items: FiguredItem[]): Omit<PriceLine, 'id'>[] {
  const lines: Omit<PriceLine, 'id'>[] = [];
  const t = jobTotals(items);
  for (const { item, tool, result } of items) {
    if (result.status !== 'ok') continue;
    const area = result.result.rows.find((r) => r.label === 'Slab area' || r.label === 'Area');
    if (area) lines.push({ desc: `${item.label || tool.title}: form, pour and finish`, qty: dec(numberIn(area.value), 1), unit: 'sq ft', price: '' });
  }
  if (t.concreteOrderYd) {
    const perYd = t.concreteCost ? dec(t.concreteCost / t.concreteOrderYd, 2) : '';
    lines.push({ desc: 'Concrete', qty: dec(t.concreteOrderYd, 2), unit: 'yd', price: perYd });
  }
  if (t.rebarLb) lines.push({ desc: 'Rebar, cut, bent and tied', qty: String(Math.round(t.rebarLb)), unit: 'lb', price: '' });
  const panels = [...t.panels.values()].reduce((a, b) => a + b, 0);
  if (panels) lines.push({ desc: 'Wall forms, set and strip', qty: '1', unit: 'job', price: '' });
  lines.push({ desc: 'Labor', qty: '1', unit: 'job', price: '' });
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
  .sign { display: flex; gap: 30px; margin-top: 40px; font-size: 13px; }
  .sign div { flex: 1; border-top: 1px solid #111; padding-top: 4px; }
  .draw { border: 1px solid #ccc; border-radius: 10px; overflow: hidden; margin-top: 18px; break-inside: avoid; }
  .foot { margin-top: 28px; font-size: 11px; color: #888; text-align: center; }
  .print { position: fixed; right: 16px; bottom: 16px; padding: 12px 18px; border-radius: 999px; border: 0; background: #ff9f0a; color: #000; font-size: 16px; font-weight: 700; }
  @media print { .print { display: none; } body { padding: 0; } }`;

function moneyDoc(kind: 'bid' | 'bill', job: Job, s: Settings, items: FiguredItem[], now: Date): { html: string; text: string } {
  const c = s.company;
  const lines = (job.lines ?? []).filter((l) => l.desc.trim() || num(l.price));
  const m = priceTotals({ ...job, lines });
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
<div class="top"><div class="co">${c.name ? `<b>${esc(c.name)}</b><br>` : ''}${coLines.map(esc).join('<br>')}</div>
<div class="doc"><h1>${title}</h1><div class="meta">#${no}</div><div class="meta">${esc(date)}</div></div></div>
<div class="to">${job.customer ? `<div><h4>${kind === 'bid' ? 'Prepared for' : 'Bill to'}</h4>${esc(job.customer).replace(/\n/g, '<br>')}</div>` : ''}
<div><h4>Job</h4>${esc(job.name)}${job.address ? `<br>${esc(job.address)}` : ''}</div></div>
<table><tr><th>Description</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Amount</th></tr>
${lines.map((l) => `<tr><td>${esc(l.desc)}</td><td class="r">${esc(qtyText(l))}</td><td class="r">${num(l.price) ? money(num(l.price)) : ''}</td><td class="r">${money(lineAmount(l))}</td></tr>`).join('')}
</table>
<table class="sum">${sumRows.map(([k, v, cls]) => `<tr class="${cls ?? ''}"><td>${k}</td><td class="r">${v}</td></tr>`).join('')}</table>
${kind === 'bid' ? '<div class="sign"><div>Accepted by</div><div>Date</div></div>' : ''}
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

export const buildBid = (job: Job, s: Settings, items: FiguredItem[], now = new Date()) => moneyDoc('bid', job, s, items, now);
export const buildBill = (job: Job, s: Settings, items: FiguredItem[], now = new Date()) => moneyDoc('bill', job, s, items, now);
