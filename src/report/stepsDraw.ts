// Half-round steps from the top: the house (or slab) along the top, each step a half circle on the same
// center, the bottom step biggest. Print style, like the other plans: black on white, sizes on each step.

import { ftIn } from '../tools/format';

const n = (v: number) => Math.round(v * 10) / 10;
const FONT = 'font-family="Helvetica, Arial, sans-serif"';
const dim = (ft: number) => ftIn(ft).replace(/' /, "'-");

export function radiusStepsSvg(diameters: number[], treadFt: number, title: string): string {
  const W = 760;
  const D = diameters[0];
  const pad = 70;
  const s = (W - 2 * pad) / D;
  const R = (D / 2) * s;
  const cx = W / 2;
  const top = 90;
  const H = Math.round(top + R + 170);
  const out: string[] = [`<rect width="${W}" height="${H}" fill="#ffffff"/>`, `<rect x="6" y="6" width="${W - 12}" height="${H - 12}" fill="none" stroke="#111" stroke-width="2"/>`];
  // The house or slab the steps sit against.
  out.push(`<rect x="${pad - 20}" y="${top - 30}" width="${W - 2 * pad + 40}" height="30" fill="#e6e3dc" stroke="#111" stroke-width="2"/>`);
  out.push(`<text x="${cx}" y="${top - 10}" text-anchor="middle" ${FONT} font-size="15" font-weight="800" fill="#111">HOUSE / SLAB</text>`);
  // Each step, biggest first; the top step shaded as the landing.
  diameters.forEach((d, k) => {
    const r = (d / 2) * s;
    const last = k === diameters.length - 1;
    out.push(`<path d="M${n(cx - r)} ${top} A${n(r)} ${n(r)} 0 0 0 ${n(cx + r)} ${top} Z" fill="${last ? '#efece6' : '#ffffff'}" stroke="#111" stroke-width="${k === 0 ? 3 : 2}"/>`);
  });
  // Sizes: each step's diameter along the flat side, below the rings.
  diameters.forEach((d, k) => {
    const r = (d / 2) * s;
    const y = top + r - 10;
    out.push(`<text x="${cx}" y="${n(Math.max(top + 22, y))}" text-anchor="middle" ${FONT} font-size="15" font-weight="800" fill="#111">STEP ${k + 1}: ${dim(d)}</text>`);
  });
  // Main diameter.
  out.push(`<line x1="${n(cx - R)}" y1="${top + R + 30}" x2="${n(cx + R)}" y2="${top + R + 30}" stroke="#111" stroke-width="1"/>`);
  for (const x of [cx - R, cx + R]) out.push(`<line x1="${n(x - 6)}" y1="${top + R + 36}" x2="${n(x + 6)}" y2="${top + R + 24}" stroke="#111" stroke-width="2"/>`);
  out.push(`<text x="${cx}" y="${top + R + 54}" text-anchor="middle" ${FONT} font-size="17" font-weight="800" fill="#111">${dim(D)} MAIN DIAMETER</text>`);
  out.push(`<text x="${cx}" y="${top + R + 76}" text-anchor="middle" ${FONT} font-size="14" font-weight="700" fill="#333">${diameters.length} STEPS · ${dim(treadFt)} TREADS · EACH STEP UP ${dim(2 * treadFt)} SMALLER</text>`);
  out.push(`<line x1="20" y1="${H - 62}" x2="${W - 20}" y2="${H - 62}" stroke="#111" stroke-width="1.5"/>`);
  out.push(`<text x="24" y="${H - 28}" ${FONT} font-size="22" font-weight="900" fill="#111">RADIUS STEPS · TOP VIEW</text>`);
  out.push(`<text x="${W - 22}" y="${H - 28}" text-anchor="end" ${FONT} font-size="13" fill="#333">NOT TO SCALE · ${title.replace(/[<>&]/g, '')}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Plan view">${out.join('')}</svg>`;
}
