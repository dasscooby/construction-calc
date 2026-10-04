// SVG drawings for the job report: a blueprint-style plan and a 3D (isometric) view of the walls.
// Plain SVG strings so they work in a web page, a PDF, or anywhere else.

import { ftIn } from '../tools/format';
import { bounds, Pt } from './geometry';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => Math.round(v * 10) / 10;
const path = (pts: Pt[]) => `M${pts.map((p) => `${n(p.x)} ${n(p.y)}`).join(' L')} Z`;

export interface PlanInput {
  /** Outside outline, clockwise, feet */
  outer: Pt[];
  /** Inside face (same corners), feet. Omit for a slab. */
  inner?: Pt[];
  /** Label for each side of the outer outline (side i runs from point i to i+1) */
  labels: string[];
  title: string;
  subtitle: string;
}

/** Blueprint: white lines on blue, wall lengths on the outside of each wall. */
export function planSvg(p: PlanInput): string {
  const W = 760;
  const pad = 70;
  const b = bounds(p.outer);
  const spanX = Math.max(b.maxX - b.minX, 1);
  const spanY = Math.max(b.maxY - b.minY, 1);
  const s = Math.min((W - 2 * pad) / spanX, 420 / spanY);
  const H = Math.round(spanY * s + 2 * pad + 60);
  const tx = (q: Pt): Pt => ({ x: pad + (q.x - b.minX) * s + ((W - 2 * pad) - spanX * s) / 2, y: pad + (q.y - b.minY) * s });
  const outer = p.outer.map(tx);
  const inner = p.inner?.map(tx);

  // Grid every 10 ft (or 5 ft on small jobs).
  const step = (spanX > 60 || spanY > 60 ? 10 : 5) * s;
  const grid: string[] = [];
  for (let x = pad % step; x < W; x += step) grid.push(`<line x1="${n(x)}" y1="0" x2="${n(x)}" y2="${H}"/>`);
  for (let y = pad % step; y < H; y += step) grid.push(`<line x1="0" y1="${n(y)}" x2="${W}" y2="${n(y)}"/>`);

  // Labels sit outside the wall, along its outward side (left of the clockwise walk).
  const dims = outer.map((a, i) => {
    const c = outer[(i + 1) % outer.length];
    const len = Math.hypot(c.x - a.x, c.y - a.y);
    if (len < 1) return '';
    const ux = (c.x - a.x) / len;
    const uy = (c.y - a.y) / len;
    const ox = uy * 22;
    const oy = -ux * 22;
    const mx = (a.x + c.x) / 2 + ox;
    const my = (a.y + c.y) / 2 + oy;
    const vertical = Math.abs(uy) > Math.abs(ux);
    const rot = vertical ? ` transform="rotate(-90 ${n(mx)} ${n(my)})"` : '';
    // Dimension line with ticks, then the length.
    const lx1 = a.x + ox * 0.45;
    const ly1 = a.y + oy * 0.45;
    const lx2 = c.x + ox * 0.45;
    const ly2 = c.y + oy * 0.45;
    return (
      `<line x1="${n(lx1)}" y1="${n(ly1)}" x2="${n(lx2)}" y2="${n(ly2)}" stroke="#cfe3ff" stroke-width="1"/>` +
      `<text x="${n(mx)}" y="${n(my + 5)}" text-anchor="middle"${rot}>${esc(p.labels[i] ?? '')}</text>`
    );
  });

  const walls = inner
    ? `<path d="${path(outer)} ${path(inner)}" fill="rgba(255,255,255,0.22)" fill-rule="evenodd" stroke="#ffffff" stroke-width="2"/>`
    : `<path d="${path(outer)}" fill="rgba(255,255,255,0.16)" stroke="#ffffff" stroke-width="2"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Plan view">
<rect width="${W}" height="${H}" fill="#0b4f8a"/>
<g stroke="rgba(255,255,255,0.08)" stroke-width="1">${grid.join('')}</g>
${walls}
<g font-family="Helvetica, Arial, sans-serif" font-size="15" font-weight="700" fill="#ffffff">${dims.join('')}</g>
<g font-family="Helvetica, Arial, sans-serif" fill="#ffffff">
<rect x="${W - 260}" y="${H - 58}" width="250" height="48" fill="none" stroke="#ffffff" stroke-width="1"/>
<text x="${W - 250}" y="${H - 38}" font-size="14" font-weight="700">${esc(p.title)}</text>
<text x="${W - 250}" y="${H - 19}" font-size="11">${esc(p.subtitle)}</text>
</g>
</svg>`;
}

/** Wall length labels for an outline in feet, tape-measure style. */
export const sideLabels = (pts: Pt[]) =>
  pts.map((a, i) => {
    const c = pts[(i + 1) % pts.length];
    return ftIn(Math.hypot(c.x - a.x, c.y - a.y));
  });

// ---------------------------------------------------------------------------------------------
// 3D view. Isometric: screen x = (x − y)·cos30, screen y = (x + y)·sin30 − z.
// The viewer is toward +x, +y, so faces pointing that way are visible; far boxes are drawn first.

const C30 = Math.cos(Math.PI / 6);
const S30 = 0.5;

export interface IsoInput {
  outer: Pt[];
  /** Inside face; omit for a solid slab */
  inner?: Pt[];
  /** Height of the walls (or slab thickness), feet */
  height: number;
  /** A slab inside the walls: its thickness in feet (drawn at the bottom) */
  slabThick?: number;
}

type Face = { pts: [number, number, number][]; fill: string; depth: number };

export function isoSvg(p: IsoInput): string {
  const faces: Face[] = [];
  const top = '#d9d6cf';
  const lit = '#b9b5ad';
  const shade = '#8f8b84';
  const sideColor = (nx: number, ny: number) => (nx >= ny ? lit : shade);

  const box = (a: Pt, b: Pt, c: Pt, d: Pt, z0: number, z1: number) => {
    // Base quad a→b (outside edge), c→d (inside edge, b side first).
    const quad: Pt[] = [a, b, c, d];
    const depth = (a.x + a.y + b.x + b.y + c.x + c.y + d.x + d.y) / 4;
    quad.forEach((q, i) => {
      const r = quad[(i + 1) % 4];
      const dx = r.x - q.x;
      const dy = r.y - q.y;
      // Outward normal of this edge for a quad walked a→b→c→d (clockwise on screen): (dy, −dx).
      const nx = dy;
      const ny = -dx;
      if (nx + ny <= 1e-9) return; // facing away
      faces.push({
        pts: [
          [q.x, q.y, z0],
          [r.x, r.y, z0],
          [r.x, r.y, z1],
          [q.x, q.y, z1],
        ],
        fill: sideColor(nx, ny),
        depth: depth - 0.001,
      });
    });
    faces.push({ pts: quad.map((q) => [q.x, q.y, z1] as [number, number, number]), fill: top, depth });
  };

  const N = p.outer.length;
  if (p.slabThick && p.inner) {
    const t = p.slabThick;
    faces.push({ pts: p.inner.map((q) => [q.x, q.y, t] as [number, number, number]), fill: '#c9c4ba', depth: -1e9 });
  }
  if (p.inner) {
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      box(p.outer[i], p.outer[j], p.inner[j], p.inner[i], 0, p.height);
    }
  } else {
    // Solid slab: sides of the outline, then the top.
    for (let i = 0; i < N; i++) {
      const a = p.outer[i];
      const b = p.outer[(i + 1) % N];
      const nx = b.y - a.y;
      const ny = -(b.x - a.x);
      if (nx + ny <= 1e-9) continue;
      faces.push({
        pts: [
          [a.x, a.y, 0],
          [b.x, b.y, 0],
          [b.x, b.y, p.height],
          [a.x, a.y, p.height],
        ],
        fill: sideColor(nx, ny),
        depth: (a.x + a.y + b.x + b.y) / 2,
      });
    }
    faces.push({ pts: p.outer.map((q) => [q.x, q.y, p.height] as [number, number, number]), fill: top, depth: 1e9 });
  }
  faces.sort((f, g) => f.depth - g.depth);

  // Fit to the drawing.
  const proj = ([x, y, z]: [number, number, number]) => ({ x: (x - y) * C30, y: (x + y) * S30 - z });
  const all = faces.flatMap((f) => f.pts.map(proj));
  const b = bounds(all);
  const W = 760;
  const pad = 30;
  const s = Math.min((W - 2 * pad) / Math.max(b.maxX - b.minX, 1), 380 / Math.max(b.maxY - b.minY, 1));
  const H = Math.round((b.maxY - b.minY) * s + 2 * pad);
  const tx = (q: Pt) => `${n(pad + (q.x - b.minX) * s)},${n(pad + (q.y - b.minY) * s)}`;
  const polys = faces
    .map((f) => `<polygon points="${f.pts.map((q) => tx(proj(q))).join(' ')}" fill="${f.fill}" stroke="#5f5b55" stroke-width="0.8" stroke-linejoin="round"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="3D view"><rect width="${W}" height="${H}" fill="#f4f6f8"/>${polys}</svg>`;
}
