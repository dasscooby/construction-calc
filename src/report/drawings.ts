// SVG drawings for the job report: a blueprint-style plan and a 3D (isometric) view of the walls.
// Plain SVG strings so they work in a web page, a PDF, or anywhere else.

import { ftIn } from '../tools/format';
import { bounds, Pt } from './geometry';

// Text inside the drawings. No XML entities: the phone's SVG reader shows them literally (&quot;),
// so the few characters that would break the SVG are swapped for look-alikes instead.
const esc = (s: string) => s.replace(/&/g, '+').replace(/</g, '‹').replace(/>/g, '›');
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
<rect x="${W - 400}" y="${H - 58}" width="390" height="48" fill="none" stroke="#ffffff" stroke-width="1"/>
<text x="${W - 390}" y="${H - 38}" font-size="14" font-weight="700">${esc(p.title)}</text>
<text x="${W - 390}" y="${H - 19}" font-size="11">${esc(p.subtitle)}</text>
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

// ---------------------------------------------------------------------------------------------
// Slab extras: footing line and rebar on the plan, a see-through 3D slab with its thickened edge,
// and a section through the edge.

export interface SlabSide {
  kind: 'form' | 'house' | 'dowels';
  /** Thickened edge along this side */
  footing: boolean;
}

export interface SlabPlanExtras {
  /** Footing width (ft) */
  footingFt?: number;
  /** Slab rebar on center (ft): grid */
  rebarFt?: number;
  /** Bars in the footing: drawn as lines running along inside the footing */
  footingBars?: number;
  /** Top, right, bottom, left. Omit for a slab with a footing all the way around. */
  sides?: SlabSide[];
  /** Dowel spacing (ft) on sides marked House + dowels */
  dowelFt?: number;
  /** Corner radii (ft), corner k at the end of side k: top right, bottom right, bottom left, top left */
  radii?: number[];
}

type Box = { minX: number; minY: number; maxX: number; maxY: number };

/** Bar positions between two edges: one at each end, none farther apart than the spacing. */
function barLines(from: number, to: number, spacing: number): number[] {
  const spaces = Math.max(1, Math.ceil((to - from) / spacing - 1e-9));
  return Array.from({ length: spaces + 1 }, (_, i) => from + ((to - from) * i) / spaces);
}

/**
 * The four sides of a rectangle walked clockwise (y down): top, right, bottom, left.
 * at(i, along, inset) is a point `along` ft from the side's start and `inset` ft in from the edge
 * (negative = outside). len(i) is the side's length.
 */
function rectSides(b: Box) {
  const starts = [
    { x: b.minX, y: b.minY, dx: 1, dy: 0 },
    { x: b.maxX, y: b.minY, dx: 0, dy: 1 },
    { x: b.maxX, y: b.maxY, dx: -1, dy: 0 },
    { x: b.minX, y: b.maxY, dx: 0, dy: -1 },
  ];
  const lens = [b.maxX - b.minX, b.maxY - b.minY, b.maxX - b.minX, b.maxY - b.minY];
  return {
    len: (i: number) => lens[i],
    // Inside is to the right of the walking direction: (−dy, dx).
    at: (i: number, along: number, inset: number): Pt => ({
      x: starts[i].x + starts[i].dx * along - starts[i].dy * inset,
      y: starts[i].y + starts[i].dy * along + starts[i].dx * inset,
    }),
  };
}

const OUT = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

/**
 * A rectangle with rounded corners, moved in by `inset`. arcs[k] are the points around corner k
 * (one point for a square corner). The outline is all the arcs in order; the edge from the last
 * point of arc k to the first point of arc k+1 is the straight part of side k+1.
 */
export function roundedRect(b: Box, radii: number[], inset = 0, steps = 10): { points: Pt[]; arcs: Pt[][] } {
  const C = [
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
    { x: b.minX, y: b.minY },
  ];
  const arcs = C.map((c, k) => {
    const o1 = OUT[k];
    const o2 = OUT[(k + 1) % 4];
    const r = radii[k] ?? 0;
    if (r <= 0) return [{ x: c.x - inset * (o1.x + o2.x), y: c.y - inset * (o1.y + o2.y) }];
    const center = { x: c.x - r * (o1.x + o2.x), y: c.y - r * (o1.y + o2.y) };
    const rr = Math.max(0, r - inset);
    const a1 = Math.atan2(o1.y, o1.x);
    return Array.from({ length: steps + 1 }, (_, j) => {
      const a = a1 + ((Math.PI / 2) * j) / steps;
      return { x: center.x + rr * Math.cos(a), y: center.y + rr * Math.sin(a) };
    });
  });
  return { points: arcs.flat(), arcs };
}

/**
 * Lines `inset` in from the edge along the sides that have a footing, following rounded corners.
 * Where a footing side meets a side without one (the house), the line runs out to the edge.
 */
function footingRuns(b: Box, radii: number[], inset: number, footingOn: (i: number) => boolean): Pt[][] {
  const R = rectSides(b);
  const { arcs } = roundedRect(b, radii, inset);
  const runs: Pt[][] = [];
  for (let i = 0; i < 4; i++) {
    if (!footingOn(i)) continue;
    const prev = (i + 3) % 4;
    const start = footingOn(prev) ? arcs[prev][arcs[prev].length - 1] : R.at(i, 0, inset);
    const end = footingOn((i + 1) % 4) ? arcs[i][0] : R.at(i, R.len(i), inset);
    runs.push([start, end]);
    if (footingOn((i + 1) % 4) && arcs[i].length > 1) runs.push(arcs[i]);
  }
  return runs;
}

/** Edge labels for a rounded outline: the full side length on each straight part, nothing on the curves. */
export function roundedLabels(b: Box, radii: number[]): string[] {
  const { arcs } = roundedRect(b, radii);
  const sideLen = [b.maxX - b.minX, b.maxY - b.minY, b.maxX - b.minX, b.maxY - b.minY];
  const labels: string[] = [];
  arcs.forEach((arc, k) => {
    for (let j = 0; j < arc.length - 1; j++) labels.push('');
    labels.push(ftIn(sideLen[(k + 1) % 4]));
  });
  return labels;
}

/** Blueprint plan of a slab: footing line and bars, rebar grid, rounded corners, the house and dowels. */
export function slabPlanSvg(p: PlanInput & SlabPlanExtras): string {
  const base = planSvg(p);
  const b = bounds(p.outer);
  const W = 760;
  const pad = 70;
  const spanX = Math.max(b.maxX - b.minX, 1);
  const spanY = Math.max(b.maxY - b.minY, 1);
  const s = Math.min((W - 2 * pad) / spanX, 420 / spanY);
  const ox = pad + (W - 2 * pad - spanX * s) / 2;
  const X = (x: number) => n(ox + (x - b.minX) * s);
  const Y = (y: number) => n(pad + (y - b.minY) * s);
  const seg = (a: Pt, c: Pt, style: string) => `<line x1="${X(a.x)}" y1="${Y(a.y)}" x2="${X(c.x)}" y2="${Y(c.y)}" ${style}/>`;
  const pl = (pts: Pt[], style: string) => `<polyline points="${pts.map((q) => `${X(q.x)},${Y(q.y)}`).join(' ')}" fill="none" ${style}/>`;
  const R = rectSides(b);
  const sides = p.sides;
  const radii = p.radii ?? [0, 0, 0, 0];
  const footingOn = (i: number) => (sides ? sides[i].footing : true);
  const cover = 3 / 12;
  const out: string[] = [];

  // Rebar grid, trimmed to the slab's outline (rounded corners).
  if (p.rebarFt && p.rebarFt > 0) {
    const g: string[] = [];
    for (const x of barLines(b.minX + cover, b.maxX - cover, p.rebarFt)) g.push(seg({ x, y: b.minY + cover }, { x, y: b.maxY - cover }, ''));
    for (const y of barLines(b.minY + cover, b.maxY - cover, p.rebarFt)) g.push(seg({ x: b.minX + cover, y }, { x: b.maxX - cover, y }, ''));
    const clip = roundedRect(b, radii, cover).points.map((q) => `${X(q.x)},${Y(q.y)}`).join(' ');
    out.push(`<defs><clipPath id="slabclip"><polygon points="${clip}"/></clipPath></defs>`);
    out.push(`<g stroke="#ffb347" stroke-width="1" opacity="0.8" clip-path="url(#slabclip)">${g.join('')}</g>`);
  }

  // Footing: dashed inside edge and the bars, on the sides that have it, around the curves.
  if (p.footingFt && p.footingFt > 0) {
    const f = p.footingFt;
    for (const run of footingRuns(b, radii, f, footingOn)) out.push(pl(run, 'stroke="#ffffff" stroke-width="1.5" stroke-dasharray="8 6"'));
    const nBars = Math.min(p.footingBars ?? 0, 3);
    for (let k = 0; k < nBars; k++) {
      const inset = (f * (k + 1)) / (nBars + 1);
      for (const run of footingRuns(b, radii, inset, footingOn)) out.push(pl(run, 'stroke="#ff7a00" stroke-width="2" stroke-linejoin="round"'));
    }
    const first = [0, 2].find(footingOn) ?? [1, 3].find(footingOn);
    if (first !== undefined) {
      const along = first === 0 ? Math.max(f, radii[3]) + 1 : R.len(first) - Math.max(f, radii[2]) - 9;
      const at = first % 2 === 0 ? R.at(first, along, f + (first === 2 ? 1.5 : 0)) : R.at(first, R.len(first) / 2, f + 1);
      out.push(`<text x="${n(Number(X(at.x)) + 6)}" y="${n(Number(Y(at.y)) + 16)}" font-family="Helvetica, Arial, sans-serif" font-size="12" fill="#ffffff">${esc(`${n(f * 12)}" footing`)}</text>`);
    }
  }

  // Radius callout on the first rounded corner.
  const rk = radii.findIndex((r) => r > 0);
  if (rk >= 0) {
    const arc = roundedRect(b, radii, 0).arcs[rk];
    const mid = arc[Math.floor(arc.length / 2)];
    const o = { x: OUT[rk].x + OUT[(rk + 1) % 4].x, y: OUT[rk].y + OUT[(rk + 1) % 4].y };
    const tx = Number(X(mid.x)) + o.x * 14;
    const ty = Number(Y(mid.y)) + o.y * 14 + 4;
    out.push(
      `<text x="${n(tx)}" y="${n(ty)}" text-anchor="${o.x < 0 ? 'end' : 'start'}" font-family="Helvetica, Arial, sans-serif" font-size="13" font-weight="700" fill="#ffffff">${esc(`R ${ftIn(radii[rk])}`)}</text>`,
    );
  }

  // The house: a hatched wall outside each house side, and the dowels across the joint.
  if (sides) {
    const near = 34 / s; // past the dimension labels
    const far = 60 / s;
    for (let i = 0; i < 4; i++) {
      if (sides[i].kind === 'form') continue;
      const L = R.len(i);
      const corners = [R.at(i, 0, -near), R.at(i, L, -near), R.at(i, L, -far), R.at(i, 0, -far)];
      out.push(`<polygon points="${corners.map((q) => `${X(q.x)},${Y(q.y)}`).join(' ')}" fill="rgba(255,255,255,0.18)" stroke="#ffffff" stroke-width="1.5"/>`);
      const h: string[] = [];
      const step = 14 / s;
      for (let a = step; a < L; a += step) h.push(seg(R.at(i, a, -near), R.at(i, Math.min(L, a + (far - near)), -far), ''));
      out.push(`<g stroke="#ffffff" stroke-width="0.8" opacity="0.6">${h.join('')}</g>`);
      const mid = R.at(i, L / 2, -(near + far) / 2);
      const vertical = i % 2 === 1;
      out.push(
        `<text x="${X(mid.x)}" y="${n(Number(Y(mid.y)) + 5)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="13" font-weight="700" fill="#ffffff"${
          vertical ? ` transform="rotate(-90 ${X(mid.x)} ${Y(mid.y)})"` : ''
        }>HOUSE${sides[i].kind === 'dowels' ? ' · DOWELS' : ''}</text>`,
      );
      if (sides[i].kind === 'dowels' && p.dowelFt && p.dowelFt > 0) {
        const d: string[] = [];
        for (const a of barLines(0.5, L - 0.5, p.dowelFt)) d.push(seg(R.at(i, a, -10 / s), R.at(i, a, 16 / s), ''));
        out.push(`<g stroke="#ff7a00" stroke-width="2.5" stroke-linecap="round">${d.join('')}</g>`);
      }
    }
  }
  const marker = '<g font-family="Helvetica, Arial, sans-serif" font-size="15"';
  return base.replace(marker, `${out.join('')}${marker}`);
}

export interface IsoSlabInput {
  outer: Pt[];
  /** Slab thickness, ft (already stretched for the drawing) */
  thick: number;
  /** Thickened edge: width (ft) and total depth (ft, stretched) */
  footing?: { width: number; depth: number };
  /** Slab rebar on center, ft */
  rebarFt?: number;
  /** Small caption, like "Height exaggerated" */
  note?: string;
  /** Bars along inside the footing: how far in from the outside (ft) and how high (ft, stretched) */
  footingBars?: { inset: number; z: number }[];
  /** Slab bars bent down into the footing: how far down the legs reach (z, stretched) */
  bentLegsTo?: number;
  /** Top, right, bottom, left */
  sides?: SlabSide[];
  /** Dowel spacing (ft) */
  dowelFt?: number;
  /** Corner radii (ft), corner k at the end of side k */
  radii?: number[];
}

type P3 = [number, number, number];

/** A slab in 3D: see-through top with the rebar, the thickened edge, rounded corners, the house and dowels. */
export function isoSlabSvg(p: IsoSlabInput): string {
  const depth = p.footing ? Math.max(p.footing.depth, p.thick) : p.thick;
  const houseH = depth + Math.max(depth * 1.6, 1.5);
  const proj = ([x, y, z]: P3) => ({ x: (x - y) * C30, y: (x + y) * S30 - z });
  const b0 = bounds(p.outer);
  const sides = p.sides;
  const radii = p.radii ?? [0, 0, 0, 0];
  const R = rectSides(b0);
  const footingOn = (i: number) => !!p.footing && (sides ? sides[i].footing : true);
  const HW = 1.2; // house wall thickness drawn, ft
  const houseAt = (i: number) => !!sides && sides[i].kind !== 'form';
  const outline = roundedRect(b0, radii);
  // Which side (or corner) each outline edge belongs to, for the full-depth faces.
  const edgeFooting: boolean[] = [];
  outline.arcs.forEach((arc, k) => {
    const both = footingOn(k) && footingOn((k + 1) % 4);
    for (let j = 0; j < arc.length - 1; j++) edgeFooting.push(both);
    edgeFooting.push(footingOn((k + 1) % 4));
  });
  const anyHouse = [0, 1, 2, 3].some(houseAt);
  const fit: P3[] = outline.points.flatMap((q): P3[] => [
    [q.x, q.y, 0],
    [q.x, q.y, anyHouse ? houseH : depth],
    [q.x - HW, q.y - HW, 0],
    [q.x + HW, q.y + HW, 0],
  ]);
  const pb = bounds(fit.map(proj));
  const W = 760;
  const pad = 30;
  const s = Math.min((W - 2 * pad) / Math.max(pb.maxX - pb.minX, 1), 380 / Math.max(pb.maxY - pb.minY, 1));
  const H = Math.round((pb.maxY - pb.minY) * s + 2 * pad);
  const pt = (x: number, y: number, z: number) => {
    const q = proj([x, y, z]);
    return `${n(pad + (q.x - pb.minX) * s)},${n(pad + (q.y - pb.minY) * s)}`;
  };
  const poly = (pts: P3[], fill: string, extra = '') =>
    `<polygon points="${pts.map(([x, y, z]) => pt(x, y, z)).join(' ')}" fill="${fill}" stroke="#5f5b55" stroke-width="0.8" stroke-linejoin="round"${extra}/>`;
  const line = (a: P3, c: P3) => `<polyline points="${pt(...a)} ${pt(...c)}"/>`;
  const run3 = (pts: Pt[], z: number) => `<polyline points="${pts.map((q) => pt(q.x, q.y, z)).join(' ')}"/>`;
  const out: string[] = [];

  const houseWall = (i: number, nearSide: boolean) => {
    const L = R.len(i);
    const a = R.at(i, 0, 0);
    const c = R.at(i, L, 0);
    const a2 = R.at(i, 0, -HW);
    const c2 = R.at(i, L, -HW);
    const fill = nearSide ? ' fill-opacity="0.28"' : '';
    if (nearSide) out.push(poly([[a2.x, a2.y, 0], [c2.x, c2.y, 0], [c2.x, c2.y, houseH], [a2.x, a2.y, houseH]], '#7d8a96', fill));
    else out.push(poly([[a.x, a.y, 0], [c.x, c.y, 0], [c.x, c.y, houseH], [a.x, a.y, houseH]], '#9aa5af'));
    out.push(poly([[a.x, a.y, houseH], [c.x, c.y, houseH], [c2.x, c2.y, houseH], [a2.x, a2.y, houseH]], '#c3cbd2', fill));
    if (!nearSide) {
      const mid = R.at(i, L / 2, -HW / 2);
      const q = proj([mid.x, mid.y, houseH]);
      out.push(`<text x="${n(pad + (q.x - pb.minX) * s)}" y="${n(pad + (q.y - pb.minY) * s - 6)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="13" font-weight="700" fill="#4a5560">HOUSE</text>`);
    }
  };
  const FAR = [0, 3];
  const NEAR = [1, 2];
  for (const i of FAR) if (houseAt(i)) houseWall(i, false);

  // The footing under the slab (seen through the top): its inside face along the far sides.
  if (p.footing) {
    const f = p.footing.width;
    const zTop = depth - p.thick;
    const runs = footingRuns(b0, radii, f, footingOn);
    for (const run of runs) {
      for (let j = 0; j < run.length - 1; j++) {
        const a = run[j];
        const c = run[j + 1];
        // The inside face points to the right of the walk (−dy, dx); draw it if that faces the viewer (+x, +y).
        if (c.x - a.x - (c.y - a.y) > 1e-9) {
          out.push(poly([[a.x, a.y, 0], [c.x, c.y, 0], [c.x, c.y, zTop], [a.x, a.y, zTop]], '#a39e95'));
        }
      }
    }
  }
  // Outside faces toward the viewer, full depth where there's a footing, slab thickness elsewhere.
  const pts = outline.points;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const c = pts[(i + 1) % pts.length];
    const nx = c.y - a.y;
    const ny = -(c.x - a.x);
    if (nx + ny <= 1e-9) continue;
    const foot = !!p.footing && edgeFooting[i];
    const bottom = foot ? 0 : depth - p.thick;
    out.push(poly([[a.x, a.y, bottom], [c.x, c.y, bottom], [c.x, c.y, depth], [a.x, a.y, depth]], nx >= ny ? '#b9b5ad' : '#8f8b84', ' stroke-opacity="0.6"'));
    if (foot) out.push(`<polyline points="${pt(a.x, a.y, depth - p.thick)} ${pt(c.x, c.y, depth - p.thick)}" fill="none" stroke="#6b675f" stroke-width="0.8" stroke-dasharray="5 4"/>`);
  }
  // Top of the slab, a little see-through.
  const topPts = pts.map((q) => pt(q.x, q.y, depth)).join(' ');
  out.push(`<polygon points="${topPts}" fill="#d9d6cf" fill-opacity="${p.footing ? 0.55 : 0.8}" stroke="#5f5b55" stroke-width="0.8" stroke-linejoin="round"/>`);

  // Rebar grid at mid-slab (trimmed to the outline), with legs bent down on the footing sides.
  const zBar = depth - p.thick / 2;
  if (p.rebarFt && p.rebarFt > 0) {
    const c = 3 / 12;
    const g: string[] = [];
    const xs = barLines(b0.minX + c, b0.maxX - c, p.rebarFt);
    const ys = barLines(b0.minY + c, b0.maxY - c, p.rebarFt);
    for (const x of xs) g.push(line([x, b0.minY + c, zBar], [x, b0.maxY - c, zBar]));
    for (const y of ys) g.push(line([b0.minX + c, y, zBar], [b0.maxX - c, y, zBar]));
    const clip = roundedRect(b0, radii, c).points.map((q) => pt(q.x, q.y, zBar)).join(' ');
    out.push(`<defs><clipPath id="isoclip"><polygon points="${clip}"/></clipPath></defs>`);
    out.push(`<g fill="none" stroke="#b5501c" stroke-width="1.1" opacity="0.85" clip-path="url(#isoclip)">${g.join('')}</g>`);
    if (p.bentLegsTo !== undefined) {
      const to = p.bentLegsTo;
      // No legs where a rounded corner has curved the edge away.
      const clear = (side: number, along: number) => along >= radii[(side + 3) % 4] - 1e-9 && along <= R.len(side) - radii[side] + 1e-9;
      const legs: string[] = [];
      for (const x of xs) {
        if (footingOn(0) && clear(0, x - b0.minX)) legs.push(line([x, b0.minY + c, zBar], [x, b0.minY + c, to]));
        if (footingOn(2) && clear(2, b0.maxX - x)) legs.push(line([x, b0.maxY - c, zBar], [x, b0.maxY - c, to]));
      }
      for (const y of ys) {
        if (footingOn(3) && clear(3, b0.maxY - y)) legs.push(line([b0.minX + c, y, zBar], [b0.minX + c, y, to]));
        if (footingOn(1) && clear(1, y - b0.minY)) legs.push(line([b0.maxX - c, y, zBar], [b0.maxX - c, y, to]));
      }
      out.push(`<g fill="none" stroke="#b5501c" stroke-width="1.1" opacity="0.85">${legs.join('')}</g>`);
    }
  }
  // Footing bars along the footing, around the curves.
  for (const bar of p.footingBars ?? []) {
    const g = footingRuns(b0, radii, bar.inset, footingOn).map((run) => run3(run, bar.z));
    out.push(`<g fill="none" stroke="#8a2e00" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${g.join('')}</g>`);
  }
  // Dowels: from inside the house wall into the slab.
  if (sides && p.dowelFt && p.dowelFt > 0) {
    const g: string[] = [];
    for (let i = 0; i < 4; i++) {
      if (sides[i].kind !== 'dowels') continue;
      for (const a of barLines(0.5, R.len(i) - 0.5, p.dowelFt)) {
        const o = R.at(i, a, -HW * 0.6);
        const e = R.at(i, a, 1.2);
        g.push(line([o.x, o.y, zBar], [e.x, e.y, zBar]));
      }
    }
    out.push(`<g fill="none" stroke="#e05a00" stroke-width="2.4" stroke-linecap="round">${g.join('')}</g>`);
  }
  for (const i of NEAR) if (houseAt(i)) houseWall(i, true);
  if (p.note) out.push(`<text x="${W - 14}" y="${H - 12}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="12" fill="#666">${esc(p.note)}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="3D view"><rect width="${W}" height="${H}" fill="#f4f6f8"/>${out.join('')}</svg>`;
}

export interface SectionInput {
  slabIn: number;
  footWIn: number;
  footDIn: number;
  /** Bars in the footing (2 bottom, the rest on top), 0 for none */
  bars: number;
  barSize: number;
  tie: 'bend' | 'lbars' | 'none';
  slabBars: boolean;
  slabBarSize: number;
}

/** Section through the thickened edge: slab, footing, bars, and how the slab ties in. */
export function sectionSvg(p: SectionInput): string {
  const W = 760;
  const H = 380;
  const k = Math.min(9, 250 / Math.max(p.footDIn, 1)); // pixels per inch
  const x0 = 140; // outside face of the footing
  const y0 = 50; // top of slab
  const slabLen = Math.max(30, 52 - p.footWIn); // inches of slab drawn past the footing
  const X = (inch: number) => x0 + inch * k;
  const Y = (inch: number) => y0 + inch * k;
  const right = p.footWIn + slabLen;
  const parts: string[] = [];
  parts.push(
    `<path d="M${n(X(0))} ${n(Y(0))} L${n(X(right))} ${n(Y(0))} L${n(X(right))} ${n(Y(p.slabIn))} L${n(X(p.footWIn))} ${n(Y(p.slabIn))} L${n(X(p.footWIn))} ${n(Y(p.footDIn))} L${n(X(0))} ${n(Y(p.footDIn))} Z" fill="#d9d6cf" stroke="#3b3a37" stroke-width="2"/>`,
  );
  // Grade outside the edge.
  parts.push(`<line x1="${n(X(-12))}" y1="${n(Y(p.slabIn))}" x2="${n(X(0))}" y2="${n(Y(p.slabIn))}" stroke="#7a6a4f" stroke-width="2" stroke-dasharray="6 4"/>`);
  if (p.bars > 0) {
    const r = Math.max(4, (p.barSize / 8) * k * 0.9);
    const row = (count: number, yIn: number) => {
      for (let i = 0; i < count; i++) {
        const xIn = count === 1 ? p.footWIn / 2 : 3 + ((p.footWIn - 6) * i) / (count - 1);
        parts.push(`<circle cx="${n(X(xIn))}" cy="${n(Y(yIn))}" r="${n(r)}" fill="#c0622b" stroke="#5a2a0f"/>`);
      }
    };
    const bottom = Math.min(2, p.bars);
    row(bottom, p.footDIn - 3);
    row(p.bars - bottom, Math.max(p.slabIn + 3, p.footDIn * 0.45));
  }
  if (p.slabBars) {
    const yb = p.slabIn / 2;
    const sw = Math.max(3, (p.slabBarSize / 8) * k * 0.8);
    if (p.tie === 'bend') {
      // Bent down just inside the footing bars it ties to.
      const legX = Math.min(p.footWIn / 2, 4.5);
      parts.push(`<polyline points="${n(X(right))},${n(Y(yb))} ${n(X(legX))},${n(Y(yb))} ${n(X(legX))},${n(Y(p.footDIn - 4))}" fill="none" stroke="#c0622b" stroke-width="${n(sw)}"/>`);
    } else {
      parts.push(`<line x1="${n(X(3))}" y1="${n(Y(yb))}" x2="${n(X(right))}" y2="${n(Y(yb))}" stroke="#c0622b" stroke-width="${n(sw)}"/>`);
      if (p.tie === 'lbars') {
        parts.push(`<polyline points="${n(X(p.footWIn + 24))},${n(Y(yb + 1))} ${n(X(5))},${n(Y(yb + 1))} ${n(X(5))},${n(Y(p.footDIn - 3))}" fill="none" stroke="#e08a2a" stroke-width="${n(sw * 0.8)}"/>`);
      }
    }
  }
  const text = (x: number, y: number, label: string, anchor = 'start') =>
    `<text x="${n(x)}" y="${n(y)}" font-size="14" font-weight="700" text-anchor="${anchor}">${esc(label)}</text>`;
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="#333" stroke-width="1"/>`;
  parts.push(line(X(-5), Y(0), X(-5), Y(p.footDIn)), text(X(-8), (Y(0) + Y(p.footDIn)) / 2 + 5, `${n(p.footDIn)}"`, 'end'));
  parts.push(line(X(0), Y(p.footDIn + 4), X(p.footWIn), Y(p.footDIn + 4)), text(X(0), Y(p.footDIn + 4) + 20, `${n(p.footWIn)}" footing`));
  parts.push(line(X(right + 4), Y(0), X(right + 4), Y(p.slabIn)), text(X(right + 6), Y(p.slabIn / 2) + 5, `${n(p.slabIn)}" slab`));
  const legend: string[] = [];
  if (p.bars) legend.push(`${p.bars} #${p.barSize} in the footing (${Math.min(2, p.bars)} bottom${p.bars > 2 ? ` + ${p.bars - 2} top` : ''}), L-bars at corners`);
  if (p.slabBars) legend.push(p.tie === 'bend' ? `#${p.slabBarSize} slab bars bent down into the footing` : p.tie === 'lbars' ? 'L-bars tie the slab to the footing' : 'Slab bars stop at the edge');
  legend.forEach((l, i) => parts.push(`<text x="${W - 20}" y="${H - 20 - i * 20}" text-anchor="end" font-size="13">${esc(l)}</text>`));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Edge detail"><rect width="${W}" height="${H}" fill="#ffffff"/><g font-family="Helvetica, Arial, sans-serif" fill="#222">${parts.join('')}</g></svg>`;
}

export interface HouseSectionInput {
  slabIn: number;
  /** Dowels drilled into the house: size and whole length (in); 0 length = no dowels */
  dowelSize: number;
  dowelIn: number;
  /** A thickened edge along the house too */
  footing?: { widthIn: number; depthIn: number };
}

/** Section where the slab meets the house: the house foundation, the slab against it, and a dowel drilled in. */
export function houseSectionSvg(p: HouseSectionInput): string {
  const W = 760;
  const H = 360;
  const depthIn = p.footing ? Math.max(p.footing.depthIn, p.slabIn) : p.slabIn;
  const k = Math.min(9, 240 / Math.max(depthIn + 26, 1)); // pixels per inch
  const x0 = 250; // face of the house foundation
  const y0 = 40 + 12 * k; // top of slab, leaving room for the wall above it
  const X = (inch: number) => x0 + inch * k;
  const Y = (inch: number) => y0 + inch * k;
  const parts: string[] = [];
  // House foundation wall (8" shown), running above and below the slab.
  const wallTop = -10;
  const wallBottom = depthIn + 16;
  parts.push(`<rect x="${n(X(-8))}" y="${n(Y(wallTop))}" width="${n(8 * k)}" height="${n((wallBottom - wallTop) * k)}" fill="#c3cbd2" stroke="#3b3a37" stroke-width="2"/>`);
  for (let yy = wallTop + 4; yy < wallBottom; yy += 3) {
    parts.push(`<line x1="${n(X(-8))}" y1="${n(Y(yy))}" x2="${n(X(0))}" y2="${n(Y(yy - 4))}" stroke="#8a96a1" stroke-width="1"/>`);
  }
  parts.push(`<text x="${n(X(-4))}" y="${n(Y(wallTop) - 8)}" text-anchor="middle" font-size="13" font-weight="700">HOUSE</text>`);
  // Slab (and footing) against it.
  const run = 56;
  const slab = p.footing
    ? `M${n(X(0))} ${n(Y(0))} L${n(X(run))} ${n(Y(0))} L${n(X(run))} ${n(Y(p.slabIn))} L${n(X(p.footing.widthIn))} ${n(Y(p.slabIn))} L${n(X(p.footing.widthIn))} ${n(Y(depthIn))} L${n(X(0))} ${n(Y(depthIn))} Z`
    : `M${n(X(0))} ${n(Y(0))} L${n(X(run))} ${n(Y(0))} L${n(X(run))} ${n(Y(p.slabIn))} L${n(X(0))} ${n(Y(p.slabIn))} Z`;
  parts.push(`<path d="${slab}" fill="#d9d6cf" stroke="#3b3a37" stroke-width="2"/>`);
  // Dowel at mid-slab: about half drilled into the house.
  if (p.dowelIn > 0) {
    const half = p.dowelIn / 2;
    const yb = p.slabIn / 2;
    const sw = Math.max(3, (p.dowelSize / 8) * k * 0.8);
    parts.push(`<line x1="${n(X(-Math.min(half, 7)))}" y1="${n(Y(yb))}" x2="${n(X(p.dowelIn - Math.min(half, 7)))}" y2="${n(Y(yb))}" stroke="#e05a00" stroke-width="${n(sw)}" stroke-linecap="round"/>`);
    parts.push(`<text x="${n(X(-8) - 10)}" y="${n(Y(yb) + 5)}" text-anchor="end" font-size="13">Drill + epoxy ${n(Math.min(half, 7))}"</text>`);
    parts.push(`<text x="${n(X(p.dowelIn - Math.min(half, 7)) + 8)}" y="${n(Y(0) - 10)}" font-size="13">${n(p.dowelIn - Math.min(half, 7))}" in the slab</text>`);
  }
  parts.push(`<text x="${n(X(run) + 8)}" y="${n(Y(p.slabIn / 2) + 5)}" font-size="14" font-weight="700">${n(p.slabIn)}" slab</text>`);
  const legend = p.dowelIn > 0 ? `#${p.dowelSize} dowels, ${n(p.dowelIn)}" long, drilled and epoxied into the house` : 'Poured against the house, no dowels';
  parts.push(`<text x="${W - 20}" y="${H - 20}" text-anchor="end" font-size="13">${esc(legend)}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="House detail"><rect width="${W}" height="${H}" fill="#ffffff"/><g font-family="Helvetica, Arial, sans-serif" fill="#222">${parts.join('')}</g></svg>`;
}
