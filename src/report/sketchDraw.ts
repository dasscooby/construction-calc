// Layout Sketch drawing: the squared-up layout with every line's length. Measured lines are white,
// lines the app figured are orange and dashed. Points are lettered.

import type { PadSolution } from '../lib/padSolve';
import { ftIn } from '../tools/format';
import { pointName } from '../tools/sketchTool';
import { bounds } from './geometry';

const n = (v: number) => Math.round(v * 10) / 10;
const esc = (s: string) => s.replace(/&/g, '+').replace(/</g, '‹').replace(/>/g, '›');

export function sketchSvg(s: PadSolution, title: string): string {
  const pts = s.points;
  const b = bounds(pts);
  const W = 760;
  const pad = 100;
  const spanX = Math.max(b.maxX - b.minX, 1);
  const spanY = Math.max(b.maxY - b.minY, 1);
  const k = Math.min((W - 2 * pad) / spanX, 420 / spanY);
  const H = Math.round(spanY * k + 2 * pad + 30);
  const ox = (W - spanX * k) / 2;
  const X = (x: number) => n(ox + (x - b.minX) * k);
  const Y = (y: number) => n(pad + (y - b.minY) * k);
  const font = 'font-family="Helvetica, Arial, sans-serif"';
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const out: string[] = [`<rect width="${W}" height="${H}" fill="#0d4a8a"/>`];

  for (const e of s.edges) {
    const p = pts[e.a];
    const q = pts[e.b];
    const color = e.measured ? '#ffffff' : '#ffb347';
    out.push(
      `<line x1="${X(p.x)}" y1="${Y(p.y)}" x2="${X(q.x)}" y2="${Y(q.y)}" stroke="${color}" stroke-width="4" stroke-linecap="round"${e.measured ? '' : ' stroke-dasharray="12 8"'}/>`,
    );
    // Length label beside the line, on the side away from the middle of the drawing.
    const mx = (p.x + q.x) / 2;
    const my = (p.y + q.y) / 2;
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    let nx = -(q.y - p.y) / len;
    let ny = (q.x - p.x) / len;
    if ((mx - cx) * nx + (my - cy) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const inside = Math.abs((mx - cx) * nx + (my - cy) * ny) < 1e-6; // a brace through the middle
    const off = inside ? 0 : 30;
    const tx = Number(X(mx)) + nx * off;
    const ty = Number(Y(my)) + ny * off;
    const label = esc(ftIn(e.length));
    if (inside || !e.measured) out.push(`<rect x="${n(tx - 82)}" y="${n(ty - 22)}" width="164" height="40" rx="8" fill="#0d4a8a"/>`);
    out.push(`<text x="${n(tx)}" y="${n(ty + 10)}" text-anchor="middle" ${font} font-size="28" font-weight="800" fill="${color}">${label}</text>`);
  }

  pts.forEach((p, i) => {
    if (!s.edges.some((e) => e.a === i || e.b === i)) return;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d = Math.hypot(dx, dy) || 1;
    out.push(`<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="9" fill="#ffffff"/>`);
    out.push(
      `<text x="${n(Number(X(p.x)) + (dx / d) * 32)}" y="${n(Number(Y(p.y)) + (dy / d) * 32 + 12)}" text-anchor="middle" ${font} font-size="32" font-weight="800" fill="#ffffff">${pointName(i)}</text>`,
    );
  });
  out.push(`<text x="16" y="${H - 14}" ${font} font-size="18" fill="#cfe0f5">${esc(title)} · white = measured, orange = figured</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Plan view">${out.join('')}</svg>`;
}
