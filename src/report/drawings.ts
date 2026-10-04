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

// ---------------------------------------------------------------------------------------------
// Slab extras: footing line and rebar on the plan, a see-through 3D slab with its thickened edge,
// and a section through the edge.

export interface SlabPlanExtras {
  /** Footing width (ft): dashed line this far in from the edge */
  footingFt?: number;
  /** Slab rebar on center (ft): light grid */
  rebarFt?: number;
  /** Bars in the footing: drawn as lines running around inside the footing */
  footingBars?: number;
}

/** Bar positions between two edges: one at each end, none farther apart than the spacing. */
function barLines(from: number, to: number, spacing: number): number[] {
  const spaces = Math.max(1, Math.ceil((to - from) / spacing - 1e-9));
  return Array.from({ length: spaces + 1 }, (_, i) => from + ((to - from) * i) / spaces);
}

/** Blueprint plan of a rectangular slab with its footing line, footing bars and rebar grid. */
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
  const cover = 3 / 12;
  const parts: string[] = [];
  if (p.rebarFt && p.rebarFt > 0) {
    for (const x of barLines(b.minX + cover, b.maxX - cover, p.rebarFt)) {
      parts.push(`<line x1="${X(x)}" y1="${Y(b.minY + cover)}" x2="${X(x)}" y2="${Y(b.maxY - cover)}"/>`);
    }
    for (const y of barLines(b.minY + cover, b.maxY - cover, p.rebarFt)) {
      parts.push(`<line x1="${X(b.minX + cover)}" y1="${Y(y)}" x2="${X(b.maxX - cover)}" y2="${Y(y)}"/>`);
    }
  }
  const grid = parts.length ? `<g stroke="#ffb347" stroke-width="0.8" opacity="0.55">${parts.join('')}</g>` : '';
  let footing = '';
  if (p.footingFt && p.footingFt > 0) {
    const f = p.footingFt;
    const rect = (inset: number, style: string) =>
      `<rect x="${X(b.minX + inset)}" y="${Y(b.minY + inset)}" width="${n((spanX - 2 * inset) * s)}" height="${n((spanY - 2 * inset) * s)}" fill="none" ${style}/>`;
    footing = rect(f, 'stroke="#ffffff" stroke-width="1.5" stroke-dasharray="8 6"');
    const nBars = Math.min(p.footingBars ?? 0, 3);
    for (let i = 0; i < nBars; i++) footing += rect((f * (i + 1)) / (nBars + 1), 'stroke="#ff7a00" stroke-width="2"');
    footing += `<text x="${n(Number(X(b.minX + f)) + 6)}" y="${n(Number(Y(b.minY + f)) + 18)}" font-family="Helvetica, Arial, sans-serif" font-size="12" fill="#ffffff">${esc(`${n(f * 12)}" footing`)}</text>`;
  }
  // Under the wall-length labels so they stay readable.
  const marker = '<g font-family="Helvetica, Arial, sans-serif" font-size="15"';
  return base.replace(marker, `${grid}${footing}${marker}`);
}

export interface IsoSlabInput {
  outer: Pt[];
  /** Slab thickness, ft */
  thick: number;
  /** Thickened edge: width and total depth (top of slab to bottom), ft */
  footing?: { width: number; depth: number };
  /** Slab rebar on center, ft */
  rebarFt?: number;
  /** Small caption, like "Height exaggerated" */
  note?: string;
}

type P3 = [number, number, number];

/** A slab in 3D: full-depth edges where there's a footing, and a see-through top showing the footing and rebar. */
export function isoSlabSvg(p: IsoSlabInput): string {
  const depth = p.footing ? Math.max(p.footing.depth, p.thick) : p.thick;
  const proj = ([x, y, z]: P3) => ({ x: (x - y) * C30, y: (x + y) * S30 - z });
  const b0 = bounds(p.outer);
  const pb = bounds(p.outer.flatMap((q) => [proj([q.x, q.y, 0]), proj([q.x, q.y, depth])]));
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
  const out: string[] = [];
  const N = p.outer.length;

  // The footing ring under the slab, seen through the top: its two inside faces that face the viewer.
  if (p.footing) {
    const f = p.footing.width;
    const zTop = depth - p.thick;
    const a = { x: b0.minX + f, y: b0.minY + f };
    const c = { x: b0.maxX - f, y: b0.minY + f };
    const d = { x: b0.minX + f, y: b0.maxY - f };
    out.push(poly([[a.x, a.y, 0], [c.x, c.y, 0], [c.x, c.y, zTop], [a.x, a.y, zTop]], '#a9a49b'));
    out.push(poly([[d.x, d.y, 0], [a.x, a.y, 0], [a.x, a.y, zTop], [d.x, d.y, zTop]], '#9b968d'));
  }
  // Outside faces toward the viewer, full depth.
  for (let i = 0; i < N; i++) {
    const a = p.outer[i];
    const c = p.outer[(i + 1) % N];
    const nx = c.y - a.y;
    const ny = -(c.x - a.x);
    if (nx + ny <= 1e-9) continue;
    out.push(poly([[a.x, a.y, 0], [c.x, c.y, 0], [c.x, c.y, depth], [a.x, a.y, depth]], nx >= ny ? '#b9b5ad' : '#8f8b84'));
    if (p.footing) {
      // Where the slab ends and the footing starts.
      out.push(`<polyline points="${pt(a.x, a.y, depth - p.thick)} ${pt(c.x, c.y, depth - p.thick)}" fill="none" stroke="#6b675f" stroke-width="0.8" stroke-dasharray="5 4"/>`);
    }
  }
  // Top of the slab, a little see-through.
  out.push(poly(p.outer.map((q): P3 => [q.x, q.y, depth]), '#d9d6cf', ` fill-opacity="${p.footing ? 0.55 : 0.85}"`));
  // Rebar grid at mid-slab.
  if (p.rebarFt && p.rebarFt > 0) {
    const c = 3 / 12;
    const z = depth - p.thick / 2;
    const segs: string[] = [];
    for (const x of barLines(b0.minX + c, b0.maxX - c, p.rebarFt)) segs.push(`<polyline points="${pt(x, b0.minY + c, z)} ${pt(x, b0.maxY - c, z)}"/>`);
    for (const y of barLines(b0.minY + c, b0.maxY - c, p.rebarFt)) segs.push(`<polyline points="${pt(b0.minX + c, y, z)} ${pt(b0.maxX - c, y, z)}"/>`);
    out.push(`<g fill="none" stroke="#c0622b" stroke-width="0.7" opacity="0.6">${segs.join('')}</g>`);
  }
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
