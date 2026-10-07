// Round steps from the top, each step a ring on the same center, the bottom step biggest. Half: against the
// house along the top. Full: free-standing circles. Quarter: in the corner of two walls (top and left).
// Print style, like the other plans: black on white, sizes on each step.

import type { RoundKind } from '../tools/concreteTools';
import { ftIn } from '../tools/format';

const n = (v: number) => Math.round(v * 10) / 10;
const FONT = 'font-family="Helvetica, Arial, sans-serif"';
const dim = (ft: number) => ftIn(ft).replace(/' /, "'-");
const TITLE: Record<RoundKind, string> = { half: 'HALF ROUND STEPS', full: 'FULL ROUND STEPS', quarter: 'QUARTER ROUND STEPS' };

export function radiusStepsSvg(diameters: number[], treadFt: number, title: string, kind: RoundKind = 'half'): string {
  const W = 760;
  const D = diameters[0];
  const pad = 70;
  const room = W - 2 * pad;
  // Scale: a half or full round spans its diameter; a quarter spans its radius.
  const s = kind === 'quarter' ? room / (D / 2) / 1.15 : room / D;
  const R = (D / 2) * s;
  const cx = kind === 'quarter' ? pad : W / 2;
  const top = kind === 'full' ? 60 + R : 90;
  const H = Math.round(kind === 'full' ? top + R + 150 : top + R + 170);
  const out: string[] = [`<rect width="${W}" height="${H}" fill="#ffffff"/>`, `<rect class="dframe" x="6" y="6" width="${W - 12}" height="${H - 12}" fill="none" stroke="#111" stroke-width="2"/>`];
  // What the steps sit against.
  if (kind === 'half') {
    out.push(`<rect x="${pad - 20}" y="${top - 30}" width="${W - 2 * pad + 40}" height="30" fill="#e6e3dc" stroke="#111" stroke-width="2"/>`);
    out.push(`<text x="${cx}" y="${top - 10}" text-anchor="middle" ${FONT} font-size="15" font-weight="800" fill="#111">HOUSE / SLAB</text>`);
  } else if (kind === 'quarter') {
    out.push(`<path d="M${cx - 30} ${top - 30} L${n(cx + R + 40)} ${top - 30} L${n(cx + R + 40)} ${top} L${cx} ${top} L${cx} ${n(top + R + 40)} L${cx - 30} ${n(top + R + 40)} Z" fill="#e6e3dc" stroke="#111" stroke-width="2"/>`);
    out.push(`<text x="${n(cx + R / 2)}" y="${top - 10}" text-anchor="middle" ${FONT} font-size="15" font-weight="800" fill="#111">WALL</text>`);
    out.push(`<text x="${cx - 10}" y="${n(top + R / 2)}" text-anchor="middle" ${FONT} font-size="15" font-weight="800" fill="#111" transform="rotate(-90 ${cx - 10} ${n(top + R / 2)})">WALL</text>`);
  }
  // Each step, biggest first; the top step shaded as the landing.
  diameters.forEach((d, k) => {
    const r = (d / 2) * s;
    const last = k === diameters.length - 1;
    const fill = last ? '#efece6' : '#ffffff';
    const w = k === 0 ? 3 : 2;
    if (kind === 'full') out.push(`<circle cx="${cx}" cy="${n(top)}" r="${n(r)}" fill="${fill}" stroke="#111" stroke-width="${w}"/>`);
    else if (kind === 'half') out.push(`<path d="M${n(cx - r)} ${top} A${n(r)} ${n(r)} 0 0 0 ${n(cx + r)} ${top} Z" fill="${fill}" stroke="#111" stroke-width="${w}"/>`);
    else out.push(`<path d="M${cx} ${top} L${n(cx + r)} ${top} A${n(r)} ${n(r)} 0 0 1 ${cx} ${n(top + r)} Z" fill="${fill}" stroke="#111" stroke-width="${w}"/>`);
  });
  // Sizes on each step.
  diameters.forEach((d, k) => {
    const r = (d / 2) * s;
    const label = kind === 'quarter' ? `STEP ${k + 1}: ${dim(d / 2)} OUT` : `STEP ${k + 1}: ${dim(d)}`;
    if (kind === 'quarter') {
      const a = Math.PI / 4;
      const rr = Math.max(r - 16, 30);
      out.push(`<text x="${n(cx + rr * Math.cos(a))}" y="${n(top + rr * Math.sin(a))}" text-anchor="end" ${FONT} font-size="14" font-weight="800" fill="#111">${label}</text>`);
    } else {
      const y = top + r - (kind === 'full' ? 12 : 10);
      out.push(`<text x="${cx}" y="${n(Math.max(top + 22, y))}" text-anchor="middle" ${FONT} font-size="15" font-weight="800" fill="#111">${label}</text>`);
    }
  });
  // The main size.
  const by = top + R + 30;
  if (kind === 'quarter') {
    out.push(`<line x1="${cx}" y1="${n(by)}" x2="${n(cx + R)}" y2="${n(by)}" stroke="#111" stroke-width="1"/>`);
    for (const x of [cx, cx + R]) out.push(`<line x1="${n(x - 6)}" y1="${n(by + 6)}" x2="${n(x + 6)}" y2="${n(by - 6)}" stroke="#111" stroke-width="2"/>`);
    out.push(`<text x="${n(cx + R / 2)}" y="${n(by + 24)}" text-anchor="middle" ${FONT} font-size="17" font-weight="800" fill="#111">${dim(D / 2)} OUT FROM THE CORNER (${dim(D)} DIAMETER)</text>`);
  } else {
    out.push(`<line x1="${n(cx - R)}" y1="${n(by)}" x2="${n(cx + R)}" y2="${n(by)}" stroke="#111" stroke-width="1"/>`);
    for (const x of [cx - R, cx + R]) out.push(`<line x1="${n(x - 6)}" y1="${n(by + 6)}" x2="${n(x + 6)}" y2="${n(by - 6)}" stroke="#111" stroke-width="2"/>`);
    out.push(`<text x="${cx}" y="${n(by + 24)}" text-anchor="middle" ${FONT} font-size="17" font-weight="800" fill="#111">${dim(D)} MAIN DIAMETER</text>`);
  }
  out.push(`<text x="${W / 2}" y="${n(by + 46)}" text-anchor="middle" ${FONT} font-size="14" font-weight="700" fill="#333">${diameters.length} STEPS · ${dim(treadFt)} TREADS · EACH STEP UP ${dim(2 * treadFt)} SMALLER ACROSS</text>`);
  out.push(`<line x1="20" y1="${H - 62}" x2="${W - 20}" y2="${H - 62}" stroke="#111" stroke-width="1.5"/>`);
  out.push(`<text x="24" y="${H - 28}" ${FONT} font-size="22" font-weight="900" fill="#111">${TITLE[kind]} · TOP VIEW</text>`);
  out.push(`<text x="${W - 22}" y="${H - 28}" text-anchor="end" ${FONT} font-size="13" fill="#333">NOT TO SCALE · ${title.replace(/[<>&]/g, '')}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Plan view">${out.join('')}</svg>`;
}
