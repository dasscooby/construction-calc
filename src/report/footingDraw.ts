// Drawings for Footings & Walls and for the steel in a Wall Forms wall:
//   - a cross-section with the bars in place and the sizes marked,
//   - a 3D view of a footing run with see-through concrete so the bars show.

import { withTitleBar } from './sheet';

const n = (v: number) => Math.round(v * 10) / 10;
const C30 = Math.cos(Math.PI / 6);
const FONT = 'font-family="Helvetica, Arial, sans-serif"';
const inchText = (v: number) => `${n(v)}"`;

/** Where the bars go in a footing section: up to 3 along the bottom, more split bottom and top. */
export function barSpots(widthIn: number, depthIn: number, lines: number): { x: number; y: number }[] {
  const cover = 3;
  const bottom = lines <= 3 ? lines : Math.ceil(lines / 2);
  const top = lines - bottom;
  const row = (count: number, y: number) =>
    Array.from({ length: count }, (_, i) => ({ x: count === 1 ? widthIn / 2 : cover + ((widthIn - 2 * cover) * i) / (count - 1), y }));
  return [...row(bottom, depthIn - cover), ...row(top, cover)];
}

export interface SectionInput {
  widthIn: number;
  depthIn: number;
  /** Continuous bars along the run */
  lines: number;
  barSize: number;
  /** Vertical bars (stem walls): spacing along the run, in; 0 = none */
  vSpacingIn?: number;
  /** Horizontal bars up a wall: spacing, in; 0 = use `lines` */
  hSpacingIn?: number;
  title: string;
}

/** Cross-section: the concrete, the bars, and the width and depth. */
export function sectionWithBarsSvg(p: SectionInput): string {
  const W = 760;
  const H = 460;
  const k = Math.min(300 / Math.max(p.depthIn, 1), 380 / Math.max(p.widthIn, 1));
  const ox = (W - p.widthIn * k) / 2;
  const oy = (H - p.depthIn * k) / 2;
  const X = (x: number) => n(ox + x * k);
  const Y = (y: number) => n(oy + y * k);
  const out: string[] = [`<rect width="${W}" height="${H}" fill="#ffffff"/>`];
  out.push(`<rect x="${X(0)}" y="${Y(0)}" width="${n(p.widthIn * k)}" height="${n(p.depthIn * k)}" fill="#d9d6cf" stroke="#3b3a37" stroke-width="2"/>`);
  const r = Math.max(9, (p.barSize / 8) * k * 0.5);
  // Bars running along the wall or footing, seen end-on as dots.
  let spots = barSpots(p.widthIn, p.depthIn, p.lines);
  if (p.hSpacingIn && p.hSpacingIn > 0) {
    const count = Math.max(2, Math.ceil((p.depthIn - 6) / p.hSpacingIn - 1e-9) + 1);
    spots = Array.from({ length: count }, (_, i) => ({ x: p.widthIn / 2, y: 3 + ((p.depthIn - 6) * i) / (count - 1) }));
  }
  if (p.vSpacingIn && p.vSpacingIn > 0) {
    out.push(`<line x1="${X(p.widthIn / 2 + (p.hSpacingIn ? r / k + 0.3 : 0))}" y1="${Y(3)}" x2="${X(p.widthIn / 2 + (p.hSpacingIn ? r / k + 0.3 : 0))}" y2="${Y(p.depthIn - 3)}" stroke="#b5371a" stroke-width="${n(r * 0.9)}" stroke-linecap="round"/>`);
  }
  for (const s of spots) out.push(`<circle cx="${X(s.x)}" cy="${Y(s.y)}" r="${n(r)}" fill="#b5371a" stroke="#7a1f0c" stroke-width="1.5"/>`);
  // Sizes.
  out.push(`<line x1="${X(0)}" y1="${n(Number(Y(p.depthIn)) + 24)}" x2="${X(p.widthIn)}" y2="${n(Number(Y(p.depthIn)) + 24)}" stroke="#555" stroke-width="1.5"/>`);
  out.push(`<text x="${n((Number(X(0)) + Number(X(p.widthIn))) / 2)}" y="${n(Number(Y(p.depthIn)) + 54)}" text-anchor="middle" ${FONT} font-size="26" fill="#222">${inchText(p.widthIn)} wide</text>`);
  out.push(`<line x1="${n(Number(X(0)) - 24)}" y1="${Y(0)}" x2="${n(Number(X(0)) - 24)}" y2="${Y(p.depthIn)}" stroke="#555" stroke-width="1.5"/>`);
  out.push(`<text x="${n(Number(X(0)) - 32)}" y="${n((Number(Y(0)) + Number(Y(p.depthIn))) / 2 + 6)}" text-anchor="end" ${FONT} font-size="26" fill="#222">${inchText(p.depthIn)}</text>`);
  const steel = [
    spots.length ? `${spots.length} #${p.barSize} ${p.hSpacingIn ? `at ${p.hSpacingIn}" up the wall` : 'along the run'}` : '',
    p.vSpacingIn ? `verticals every ${p.vSpacingIn}"` : '',
    '3" cover',
  ]
    .filter(Boolean)
    .join(' · ');
  out.push(`<text x="20" y="${H - 18}" ${FONT} font-size="22" fill="#444">${p.title} · ${steel}</text>`);
  return withTitleBar(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Edge detail">${out.join('')}</svg>`, p.title === 'Wall' ? 'Wall section' : 'Section');
}

/** A footing run in 3D (the first 12' if it's longer), see-through so the bars show. */
export function footingIsoSvg(p: { lengthFt: number; widthFt: number; depthFt: number; lines: number; barSize: number; vSpacingIn?: number }): string {
  const shown = Math.min(p.lengthFt, 12);
  const z = Math.max(1, shown / 6 / Math.max(p.depthFt, 0.25)); // stretch the height so it reads
  const L = shown;
  const Wd = p.widthFt;
  const D = p.depthFt * Math.min(z, 3);
  const proj = (x: number, y: number, h: number) => ({ x: (x - y) * C30, y: (x + y) * 0.5 - h });
  const corners = [proj(0, 0, 0), proj(L, 0, 0), proj(L, Wd, 0), proj(0, Wd, 0), proj(0, 0, D), proj(L, 0, D), proj(L, Wd, D), proj(0, Wd, D)];
  const minX = Math.min(...corners.map((c) => c.x));
  const maxX = Math.max(...corners.map((c) => c.x));
  const minY = Math.min(...corners.map((c) => c.y));
  const maxY = Math.max(...corners.map((c) => c.y));
  const W = 760;
  const pad = 40;
  const k = Math.min((W - 2 * pad) / (maxX - minX || 1), 320 / (maxY - minY || 1));
  const H = Math.round((maxY - minY) * k + 2 * pad + 20);
  const left = (W - (maxX - minX) * k) / 2;
  const pt = (x: number, y: number, h: number) => {
    const q = proj(x, y, h);
    return `${n(left + (q.x - minX) * k)},${n(pad + (q.y - minY) * k)}`;
  };
  const poly = (ps: [number, number, number][], fill: string, op = 1) =>
    `<polygon points="${ps.map(([x, y, h]) => pt(x, y, h)).join(' ')}" fill="${fill}" fill-opacity="${op}" stroke="#5f5b55" stroke-width="1" stroke-linejoin="round"/>`;
  const out: string[] = [`<rect width="${W}" height="${H}" fill="#f4f6f8"/>`];
  // Front faces (toward the viewer: +x end and +y side), see-through so the bars show.
  out.push(poly([[0, Wd, 0], [L, Wd, 0], [L, Wd, D], [0, Wd, D]], '#b9b5ad', 0.55));
  out.push(poly([[L, 0, 0], [L, Wd, 0], [L, Wd, D], [L, 0, D]], '#8f8b84', 0.55));
  // Bars along the run.
  const scaleY = D / Math.max(p.depthFt * 12, 1);
  for (const s of barSpots(p.widthFt * 12, p.depthFt * 12, p.lines)) {
    const y = s.x / 12;
    const h = D - s.y * scaleY;
    out.push(`<polyline points="${pt(0, y, h)} ${pt(L, y, h)}" fill="none" stroke="#b5371a" stroke-width="3" stroke-linecap="round"/>`);
  }
  if (p.vSpacingIn && p.vSpacingIn > 0) {
    for (let x = 0.5; x < L; x += p.vSpacingIn / 12) {
      out.push(`<polyline points="${pt(x, Wd / 2, 3 * scaleY)} ${pt(x, Wd / 2, D + 0.6)}" fill="none" stroke="#b5371a" stroke-width="2.2"/>`);
    }
  }
  out.push(poly([[0, 0, D], [L, 0, D], [L, Wd, D], [0, Wd, D]], '#d9d6cf', 0.45));
  const notes = [p.lengthFt > shown ? `First 12' of ${n(p.lengthFt)}' shown` : '', z > 1.5 ? 'Height stretched to show the bars' : ''].filter(Boolean).join(' · ');
  if (notes) out.push(`<text x="${W - 14}" y="${H - 10}" text-anchor="end" ${FONT} font-size="12" fill="#666">${notes}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="3D view">${out.join('')}</svg>`;
}
