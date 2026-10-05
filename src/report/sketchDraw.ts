// Layout Sketch drawing: the lines with their lengths, each point lettered, and the measured
// board between two points as a dashed orange line.

import { ftIn } from '../tools/format';
import { pointName, Pt } from '../tools/sketchTool';
import { bounds } from './geometry';

const n = (v: number) => Math.round(v * 10) / 10;
const esc = (s: string) => s.replace(/&/g, '+').replace(/</g, '‹').replace(/>/g, '›');

export function sketchSvg(pts: Pt[], lengths: number[], from: number, to: number, title: string): string {
  const b = bounds(pts);
  const W = 760;
  const pad = 100;
  const spanX = Math.max(b.maxX - b.minX, 1);
  const spanY = Math.max(b.maxY - b.minY, 1);
  const s = Math.min((W - 2 * pad) / spanX, 420 / spanY);
  const H = Math.round(spanY * s + 2 * pad + 30);
  const ox = (W - spanX * s) / 2;
  const X = (x: number) => n(ox + (x - b.minX) * s);
  const Y = (y: number) => n(pad + (y - b.minY) * s);
  const font = 'font-family="Helvetica, Arial, sans-serif"';
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const out: string[] = [`<rect width="${W}" height="${H}" fill="#0d4a8a"/>`];

  // Lines and their lengths (label pushed away from the middle of the drawing).
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    out.push(`<line x1="${X(p.x)}" y1="${Y(p.y)}" x2="${X(q.x)}" y2="${Y(q.y)}" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>`);
    const mx = (p.x + q.x) / 2;
    const my = (p.y + q.y) / 2;
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    let nx = -(q.y - p.y) / len;
    let ny = (q.x - p.x) / len;
    if ((mx - cx) * nx + (my - cy) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    out.push(
      `<text x="${n(Number(X(mx)) + nx * 30)}" y="${n(Number(Y(my)) + ny * 30 + 10)}" text-anchor="middle" ${font} font-size="30" font-weight="700" fill="#ffffff">${esc(ftIn(lengths[i]))}</text>`,
    );
  }

  // The measured board.
  const a = pts[from];
  const c = pts[to];
  if (a && c) {
    out.push(`<line x1="${X(a.x)}" y1="${Y(a.y)}" x2="${X(c.x)}" y2="${Y(c.y)}" stroke="#ffb347" stroke-width="4" stroke-dasharray="12 8" stroke-linecap="round"/>`);
    const mx = Number(X((a.x + c.x) / 2));
    const my = Number(Y((a.y + c.y) / 2));
    const label = esc(ftIn(Math.hypot(c.x - a.x, c.y - a.y)));
    out.push(`<rect x="${n(mx - 100)}" y="${n(my - 24)}" width="200" height="46" rx="8" fill="#0d4a8a" stroke="#ffb347" stroke-width="2"/>`);
    out.push(`<text x="${n(mx)}" y="${n(my + 10)}" text-anchor="middle" ${font} font-size="28" font-weight="800" fill="#ffb347">${label}</text>`);
  }

  // Points, lettered (the letter sits outside the shape).
  pts.forEach((p, i) => {
    if (i === pts.length - 1 && i > 0 && Math.hypot(p.x - pts[0].x, p.y - pts[0].y) < 1 / 192) return; // closed: same as A
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d = Math.hypot(dx, dy) || 1;
    const on = i === from || i === to;
    out.push(`<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${on ? 13 : 10}" fill="${on ? '#ffb347' : '#ffffff'}"/>`);
    out.push(
      `<text x="${n(Number(X(p.x)) + (dx / d) * 34)}" y="${n(Number(Y(p.y)) + (dy / d) * 34 + 12)}" text-anchor="middle" ${font} font-size="34" font-weight="800" fill="${on ? '#ffb347' : '#ffffff'}">${pointName(i)}</text>`,
    );
  });
  out.push(`<text x="16" y="${H - 14}" ${font} font-size="18" fill="#cfe0f5">${esc(title)}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Plan view">${out.join('')}</svg>`;
}
