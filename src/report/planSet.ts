// The plan set: the job's drawings on landscape sheets, the way engineers and architects lay out a set.
// A cover sheet (S0) with the sheet index and general notes, then one drawing per sheet (S1 plan, S2 3D,
// S3 section ...), each inside a border with a title block down the right edge: company, job, customer,
// sheet title and number, date and "not to scale". Any paper size: Letter for home and the crew, up to
// 24 × 36 for the print shop; text and lines grow with the sheet.

import type { Job } from '../lib/jobs';
import type { Settings } from '../lib/settings';
import { scopeOfWork } from './billing';
import { DocMedia, logoHtml, uniqueSvgIds } from './docStyle';
import { Block, footerHtml, PageBox, pageCss, paginate, Paper, PX_PER_IN } from './pager';
import { FiguredItem, jobDrawings } from './report';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface Sheet {
  no: string;
  title: string;
}

/** Landscape page box for a paper size. */
export function sheetBox(paper: Paper): PageBox {
  const k = paper.wIn / 8.5;
  return { w: paper.hIn * PX_PER_IN, h: paper.wIn * PX_PER_IN, margin: 0.35 * PX_PER_IN * k, footer: 0 };
}

/** A drawing on a plan-set sheet: without its own frame and title block (the sheet has them). */
export function onSheet(svg: string): string {
  const tb = svg.match(/<g class="tblock" data-h="([\d.]+)">[\s\S]*?<\/g>/);
  let out = svg.replace(/<rect class="dframe"[^>]*\/>/, '');
  if (tb) out = out.replace(tb[0], '').replace(/viewBox="0 0 ([\d.]+) ([\d.]+)"/, (_, w, h) => `viewBox="0 0 ${w} ${Number(h) - Number(tb[1]) + 12}"`);
  return out;
}

export function buildPlanSet(job: Job, s: Settings, items: FiguredItem[], paper: Paper, now = new Date(), media: DocMedia = {}): { html: string; text: string; sheets: Sheet[] } {
  const box = sheetBox(paper);
  const k = paper.wIn / 8.5; // text and lines grow with the sheet
  const date = now.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const d = jobDrawings(job, items, s.company.name);
  const draws: { title: string; svg: string }[] = [];
  if (d?.plan) draws.push({ title: 'Foundation plan', svg: d.plan });
  if (d?.iso) draws.push({ title: '3D view', svg: d.iso });
  if (d?.section) draws.push({ title: 'Typical section', svg: d.section });
  if (d?.house) draws.push({ title: 'At the house', svg: d.house });
  const sheets: Sheet[] = [{ no: 'S0', title: 'Cover and notes' }, ...draws.map((x, i) => ({ no: `S${i + 1}`, title: x.title }))];
  // The plan and section call the section "1 / S1"; here it's on its own sheet.
  const secNo = sheets.find((sh) => sh.title === 'Typical section')?.no;
  draws.forEach((x) => {
    x.svg = onSheet(x.svg);
    if (secNo && (x.title === 'Foundation plan' || x.title === 'Typical section')) x.svg = x.svg.replace(/1 \/ S1\b/g, `1 / ${secNo}`).replace(/>S1<\/text>/g, `>${secNo}</text>`);
  });
  const c = s.company;
  const innerH = box.h - 2 - 2 * box.margin;
  const block = (sh: Sheet) => `<div class="tb">
  <div class="tbco">${logoHtml(media.logo)}${c.name ? `<b>${esc(c.name)}</b>` : ''}${[c.phone, c.email, c.license && `Lic #${c.license.replace(/^#/, '')}`].filter(Boolean).map((x) => `<div>${esc(String(x))}</div>`).join('')}</div>
  <div class="tbrow"><span>Job</span><b>${esc(job.name)}</b>${job.address ? `<div>${esc(job.address)}</div>` : ''}</div>
  ${job.customer ? `<div class="tbrow"><span>For</span><b>${esc(job.customer.split('\n')[0])}</b></div>` : ''}
  <div class="tbrow"><span>Date</span><b>${esc(date)}</b></div>
  <div class="tbrow"><span>Scale</span><b>Not to scale</b></div>
  <div class="tbsheet"><span>${esc(sh.title)}</span><b>${sh.no}</b><div>Sheet ${sheets.indexOf(sh) + 1} of ${sheets.length}</div></div>
</div>`;
  const frame = (sh: Sheet, body: string): Block => ({ kind: 'sheet', html: `<div class="frame" style="height:${innerH}px"><div class="area">${body}</div>${block(sh)}</div>` });

  // S0: the index and general notes (what's in the job, in plain words).
  const scope = scopeOfWork(items, job);
  const cover = `<h1>Foundation plans</h1><div class="cvjob">${esc(job.name)}${job.address ? ` · ${esc(job.address)}` : ''}</div>
<div class="cols"><div><h3>Sheet index</h3><table class="idx">${sheets.map((sh) => `<tr><td>${sh.no}</td><td>${esc(sh.title)}</td></tr>`).join('')}</table></div>
<div><h3>General notes</h3><ol class="gn">${scope.map(([kk, v]) => `<li><b>${esc(kk)}:</b> ${esc(v)}</li>`).join('')}<li>Sizes are as measured on the job; verify on site before forming.</li><li>Follow the engineered plans and local code where they differ.</li></ol></div></div>`;
  const blocks: Block[] = [frame(sheets[0], cover), ...draws.map((x, i) => frame(sheets[i + 1], `<div class="dtitle">${esc(x.title)}</div><div class="dfit">${x.svg}</div>`))];

  const css = `
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #111; margin: 0; }
  ${pageCss(box)}
  .pagefoot { display: none; }
  .frame { display: flex; border: ${2 * k}px solid #111; box-sizing: border-box; }
  .area { flex: 1; padding: ${10 * k}px; display: flex; flex-direction: column; min-width: 0; }
  .dtitle { font-size: ${15 * k}px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; border-bottom: ${1.5 * k}px solid #111; padding-bottom: ${4 * k}px; margin-bottom: ${8 * k}px; }
  .dfit { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
  .dfit svg { width: 100%; height: 100%; display: block; }
  .tb { width: ${150 * k}px; border-left: ${2 * k}px solid #111; display: flex; flex-direction: column; font-size: ${9.5 * k}px; }
  .tb > div { border-bottom: ${1 * k}px solid #111; padding: ${6 * k}px; }
  .tbco b { display: block; font-size: ${12 * k}px; margin-bottom: ${2 * k}px; }
  .tbco img { max-width: 100%; max-height: ${50 * k}px; display: block; margin-bottom: ${4 * k}px; }
  .tbrow span, .tbsheet span { display: block; font-size: ${7.5 * k}px; text-transform: uppercase; letter-spacing: .08em; color: #555; }
  .tbrow b { font-size: ${10.5 * k}px; }
  .tbsheet { margin-top: auto; border-bottom: 0 !important; text-align: center; }
  .tbsheet b { display: block; font-size: ${34 * k}px; line-height: 1.1; }
  h1 { font-size: ${30 * k}px; margin: ${6 * k}px 0 ${2 * k}px; text-transform: uppercase; letter-spacing: .06em; }
  .cvjob { font-size: ${14 * k}px; color: #333; margin-bottom: ${14 * k}px; }
  .cols { display: flex; gap: ${24 * k}px; }
  .cols > div:first-child { width: 32%; }
  .cols > div:last-child { flex: 1; }
  h3 { font-size: ${11 * k}px; text-transform: uppercase; letter-spacing: .1em; border-bottom: ${1.5 * k}px solid #111; padding-bottom: ${3 * k}px; margin: 0 0 ${6 * k}px; }
  .idx td { font-size: ${11 * k}px; padding: ${3 * k}px ${6 * k}px ${3 * k}px 0; }
  .gn { margin: 0; padding-left: ${16 * k}px; font-size: ${10 * k}px; line-height: 1.45; }
  .gn li { margin-bottom: ${3 * k}px; }`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(job.name)} – Plans (${esc(paper.label)})</title><style>${css}</style></head><body>
${paginate(blocks, box, (n, of) => footerHtml('', n, of))}
</body></html>`;
  const text = `${job.name} – plans: ${sheets.map((sh) => `${sh.no} ${sh.title}`).join(', ')}`;
  return { html: uniqueSvgIds(html), text, sheets };
}
