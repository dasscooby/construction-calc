// Layout Sketch drawing: the squared-up layout with every line's length. Measured lines are white,
// lines the app figured are orange and dashed. Points are lettered.

import type { PadSolution } from '../lib/padSolve';
import { ftIn } from '../tools/format';
import { pointName } from '../tools/sketchTool';
import { bounds } from './geometry';
import { printColors, withTitleBar } from './sheet';

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
  return withTitleBar(
    printColors(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Plan view">${out.join('')}</svg>`),
    'Layout sketch',
    `${title} · SOLID = MEASURED · RED DASHED = FIGURED`,
  );
}

type P3 = [number, number, number];
const C30 = Math.cos(Math.PI / 6);

/**
 * The sketch in 3D as a slab: the outline raised to the slab thickness (stretched so it shows),
 * with the sides you can see shaded and any braces or inside lines drawn on top.
 */
export function sketchIsoSvg(s: PadSolution, loop: number[], thickFt: number): string {
  const pts = loop.map((i) => s.points[i]);
  // Walk the outline clockwise on screen (y down) so "facing the viewer" is the same test every time.
  let area2 = 0;
  pts.forEach((p, k) => {
    const q = pts[(k + 1) % pts.length];
    area2 += p.x * q.y - q.x * p.y;
  });
  if (area2 < 0) pts.reverse();
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
  const z = Math.max(1, span / 10 / Math.max(thickFt, 1 / 12));
  const t = thickFt * z;
  const proj = ([x, y, h]: P3) => ({ x: (x - y) * C30, y: (x + y) * 0.5 - h });
  const all = pts.flatMap((p): P3[] => [
    [p.x, p.y, 0],
    [p.x, p.y, t],
  ]);
  const pb = bounds(all.map(proj));
  const W = 760;
  const padPx = 30;
  const k = Math.min((W - 2 * padPx) / Math.max(pb.maxX - pb.minX, 1), 380 / Math.max(pb.maxY - pb.minY, 1));
  const H = Math.round((pb.maxY - pb.minY) * k + 2 * padPx + 20);
  const left = (W - (pb.maxX - pb.minX) * k) / 2;
  const pt = (x: number, y: number, h: number) => {
    const q = proj([x, y, h]);
    return `${n(left + (q.x - pb.minX) * k)},${n(padPx + (q.y - pb.minY) * k)}`;
  };
  const out: string[] = [`<rect width="${W}" height="${H}" fill="#f4f6f8"/>`];
  // Sides facing the viewer (outward normal pointing toward +x+y), back to front.
  const sides = pts
    .map((p, i) => ({ p, q: pts[(i + 1) % pts.length] }))
    // Outward normal of a clockwise outline is (dy, −dx); the viewer looks from +x+y.
    .filter(({ p, q }) => q.y - p.y - (q.x - p.x) > 1e-9)
    .sort((u, v) => u.p.x + u.p.y + u.q.x + u.q.y - (v.p.x + v.p.y + v.q.x + v.q.y));
  for (const { p, q } of sides) {
    const nx = q.y - p.y; // outward normal for a clockwise outline (y down)
    const ny = -(q.x - p.x);
    const shade = nx >= ny ? '#b9b5ad' : '#8f8b84';
    out.push(`<polygon points="${pt(p.x, p.y, 0)} ${pt(q.x, q.y, 0)} ${pt(q.x, q.y, t)} ${pt(p.x, p.y, t)}" fill="${shade}" stroke="#5f5b55" stroke-width="0.8" stroke-linejoin="round"/>`);
  }
  out.push(`<polygon points="${pts.map((p) => pt(p.x, p.y, t)).join(' ')}" fill="#d9d6cf" stroke="#5f5b55" stroke-width="1.2" stroke-linejoin="round"/>`);
  // Braces and inside lines, on top of the slab.
  const onLoop = (a: number, b: number) => loop.some((v, i) => (v === a && loop[(i + 1) % loop.length] === b) || (v === b && loop[(i + 1) % loop.length] === a));
  for (const e of s.edges) {
    if (onLoop(e.a, e.b)) continue;
    const p = s.points[e.a];
    const q = s.points[e.b];
    out.push(`<polyline points="${pt(p.x, p.y, t)} ${pt(q.x, q.y, t)}" fill="none" stroke="#b5371a" stroke-width="2.5" stroke-dasharray="8 6"/>`);
  }
  if (z > 1.5) out.push(`<text x="${W - 14}" y="${H - 10}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="12" fill="#666">Height exaggerated to show the slab</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="3D view">${out.join('')}</svg>`;
}
