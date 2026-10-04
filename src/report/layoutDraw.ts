// Drawings for Slab Layout (any shape): blueprint plan and 3D view, from the same geometry the tool
// uses for its numbers, so every bar drawn is a bar counted.

import { ftIn } from '../tools/format';
import type { EdgeKind, OutlineRow } from '../tools/types';
import { planSvg } from './drawings';
import { bounds, Pt } from './geometry';
import { alongSide, BarSegment, cornerArc, insetRuns, Layout, outlinePoints, sideRun } from './layoutGeom';

const n = (v: number) => Math.round(v * 10) / 10;
// No XML entities: the phone's SVG reader shows them literally.
const esc = (s: string) => s.replace(/&/g, '+').replace(/</g, '‹').replace(/>/g, '›');
const C30 = Math.cos(Math.PI / 6);
const S30 = 0.5;

const AGAINST: Partial<Record<EdgeKind, string>> = {
  house: 'HOUSE',
  dowels: 'HOUSE · DOWELS',
  slab: 'EXISTING SLAB',
  slabDowels: 'EXISTING SLAB · DOWELS',
};
const hasDowels = (e: EdgeKind) => e === 'dowels' || e === 'slabDowels';
const isHouse = (e: EdgeKind) => e === 'house' || e === 'dowels';

export interface LayoutDrawInput {
  L: Layout;
  title: string;
  subtitle: string;
  /** Footing width (ft) on formed sides, if there's a thickened edge */
  footingFt?: number;
  footingBars?: number;
  /** Slab mat as cut to the shape */
  bars?: BarSegment[];
  dowelFt?: number;
}

/** Straight-edge labels: each side's length on its straight part; curves left blank. */
function edgeLabels(L: Layout): string[] {
  const { owner } = outlinePoints(L, 0);
  return owner.map((o) => ('side' in o ? ftIn(L.sides[o.side].length) : ''));
}

const outward = (d: Pt): Pt => ({ x: d.y, y: -d.x });

export function layoutPlanSvg(p: LayoutDrawInput): string {
  const { L } = p;
  const outer = outlinePoints(L, 0).points;
  const base = planSvg({ outer, labels: edgeLabels(L), title: p.title, subtitle: p.subtitle });
  // Same placement as planSvg.
  const b = bounds(outer);
  const W = 760;
  const pad = 70;
  const spanX = Math.max(b.maxX - b.minX, 1);
  const spanY = Math.max(b.maxY - b.minY, 1);
  const s = Math.min((W - 2 * pad) / spanX, 420 / spanY);
  const ox = pad + (W - 2 * pad - spanX * s) / 2;
  const X = (x: number) => n(ox + (x - b.minX) * s);
  const Y = (y: number) => n(pad + (y - b.minY) * s);
  const pl = (pts: Pt[], style: string) => `<polyline points="${pts.map((q) => `${X(q.x)},${Y(q.y)}`).join(' ')}" fill="none" ${style}/>`;
  const out: string[] = [];
  const footOn = (k: number) => !!p.footingFt && L.sides[k].edge === 'form';

  if (p.bars?.length) out.push(`<g stroke="#ffb347" stroke-width="1" opacity="0.85">${p.bars.map((sg) => pl([sg.a, sg.b], '')).join('')}</g>`);

  if (p.footingFt) {
    for (const run of insetRuns(L, p.footingFt, footOn)) out.push(pl(run, 'stroke="#ffffff" stroke-width="1.5" stroke-dasharray="8 6"'));
    const nb = Math.min(p.footingBars ?? 0, 3);
    for (let i = 0; i < nb; i++) {
      for (const run of insetRuns(L, (p.footingFt * (i + 1)) / (nb + 1), footOn)) out.push(pl(run, 'stroke="#ff7a00" stroke-width="2" stroke-linejoin="round"'));
    }
  }

  // Radius callouts.
  L.sides.forEach((side, k) => {
    if (side.radius <= 0) return;
    const arc = cornerArc(L, k, 0);
    const mid = arc[Math.floor(arc.length / 2)];
    const o = outward(L.dir[k]);
    const o2 = outward(L.dir[(k + 1) % L.sides.length]);
    const dx = side.turn === 'R' ? o.x + o2.x : -(o.x + o2.x);
    const dy = side.turn === 'R' ? o.y + o2.y : -(o.y + o2.y);
    out.push(
      `<text x="${n(Number(X(mid.x)) + dx * 14)}" y="${n(Number(Y(mid.y)) + dy * 14 + 4)}" text-anchor="${dx < 0 ? 'end' : 'start'}" font-family="Helvetica, Arial, sans-serif" font-size="13" font-weight="700" fill="#ffffff">${esc(`R ${ftIn(side.radius)}`)}</text>`,
    );
  });

  // What the non-formed sides butt against, and their dowels.
  const near = 34 / s;
  const far = 58 / s;
  L.sides.forEach((side, k) => {
    const label = AGAINST[side.edge];
    if (!label) return;
    const [a0, b0] = sideRun(L, k, -near);
    const [a1, b1] = sideRun(L, k, -far);
    const fill = isHouse(side.edge) ? 'rgba(255,255,255,0.18)' : 'rgba(200,220,255,0.10)';
    out.push(`<polygon points="${[a0, b0, b1, a1].map((q) => `${X(q.x)},${Y(q.y)}`).join(' ')}" fill="${fill}" stroke="#ffffff" stroke-width="1.5"${isHouse(side.edge) ? '' : ' stroke-dasharray="6 4"'}/>`);
    const mid = { x: (a0.x + b1.x) / 2, y: (a0.y + b1.y) / 2 };
    const vertical = Math.abs(L.dir[k].y) > 0.5;
    out.push(
      `<text x="${X(mid.x)}" y="${n(Number(Y(mid.y)) + 4)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="11" font-weight="700" fill="#ffffff"${
        vertical ? ` transform="rotate(-90 ${X(mid.x)} ${Y(mid.y)})"` : ''
      }>${label}</text>`,
    );
    if (hasDowels(side.edge) && p.dowelFt) {
      const nk = { x: -L.dir[k].y, y: L.dir[k].x };
      const ticks = alongSide(L, k, p.dowelFt, 0).map((q) =>
        pl([{ x: q.x - (nk.x * 10) / s, y: q.y - (nk.y * 10) / s }, { x: q.x + (nk.x * 16) / s, y: q.y + (nk.y * 16) / s }], ''),
      );
      out.push(`<g stroke="#ff7a00" stroke-width="2.5" stroke-linecap="round">${ticks.join('')}</g>`);
    }
  });
  const marker = '<g font-family="Helvetica, Arial, sans-serif" font-size="15"';
  return base.replace(marker, `${out.join('')}${marker}`);
}

type P3 = [number, number, number];

export interface LayoutIsoInput {
  L: Layout;
  /** Slab thickness (stretched) */
  thick: number;
  /** Thickened edge on formed sides: width (ft) and depth (stretched) */
  footing?: { width: number; depth: number };
  bars?: BarSegment[];
  /** Footing bars: inset (ft) and height (stretched) */
  footingBars?: { inset: number; z: number }[];
  /** Bent legs reach down to (stretched), at bar ends on a footing edge */
  bentLegsTo?: number;
  dowelFt?: number;
  note?: string;
}

export function layoutIsoSvg(p: LayoutIsoInput): string {
  const { L } = p;
  const N = L.sides.length;
  const depth = p.footing ? Math.max(p.footing.depth, p.thick) : p.thick;
  const houseH = depth + Math.max(depth * 1.6, 1.5);
  const reach = 3; // existing slab shown this far out, ft
  const proj = ([x, y, z]: P3) => ({ x: (x - y) * C30, y: (x + y) * S30 - z });
  const { points: pts, owner } = outlinePoints(L, 0);
  const footOn = (k: number) => !!p.footing && L.sides[k].edge === 'form';
  const edgeFoot = owner.map((o) => ('side' in o ? footOn(o.side) : footOn(o.corner) && footOn((o.corner + 1) % N)));
  const fit: P3[] = pts.flatMap((q): P3[] => [
    [q.x, q.y, 0],
    [q.x, q.y, houseH],
    [q.x - reach, q.y - reach, 0],
    [q.x + reach, q.y + reach, 0],
  ]);
  const pb = bounds(fit.map(proj));
  const W = 760;
  const pad = 30;
  const s = Math.min((W - 2 * pad) / Math.max(pb.maxX - pb.minX, 1), 380 / Math.max(pb.maxY - pb.minY, 1));
  const H = Math.round((pb.maxY - pb.minY) * s + 2 * pad);
  const left = (W - (pb.maxX - pb.minX) * s) / 2; // centered side to side
  const pt = (x: number, y: number, z: number) => {
    const q = proj([x, y, z]);
    return `${n(left + (q.x - pb.minX) * s)},${n(pad + (q.y - pb.minY) * s)}`;
  };
  const poly = (ps: P3[], fill: string, extra = '') =>
    `<polygon points="${ps.map(([x, y, z]) => pt(x, y, z)).join(' ')}" fill="${fill}" stroke="#5f5b55" stroke-width="0.8" stroke-linejoin="round"${extra}/>`;
  const line = (a: P3, c: P3) => `<polyline points="${pt(...a)} ${pt(...c)}"/>`;
  const out: string[] = [];

  // A side faces away from the viewer (+x, +y) when its outside points to −x or −y: those are drawn first.
  const farSide = (k: number) => {
    const o = outward(L.dir[k]);
    return o.x + o.y < 0;
  };
  const neighbour = (k: number, nearSide: boolean) => {
    const side = L.sides[k];
    if (!AGAINST[side.edge]) return;
    const [a, b] = sideRun(L, k, 0);
    const [a2, b2] = sideRun(L, k, isHouse(side.edge) ? -1.2 : -reach);
    const top = isHouse(side.edge) ? houseH : depth;
    const fill = nearSide ? ' fill-opacity="0.28"' : '';
    if (nearSide) out.push(poly([[a2.x, a2.y, 0], [b2.x, b2.y, 0], [b2.x, b2.y, top], [a2.x, a2.y, top]], '#7d8a96', fill));
    else out.push(poly([[a.x, a.y, 0], [b.x, b.y, 0], [b.x, b.y, top], [a.x, a.y, top]], '#9aa5af'));
    out.push(poly([[a.x, a.y, top], [b.x, b.y, top], [b2.x, b2.y, top], [a2.x, a2.y, top]], isHouse(side.edge) ? '#c3cbd2' : '#cfcac1', fill));
    if (!nearSide) {
      const mid = { x: (a.x + b2.x) / 2, y: (a.y + b2.y) / 2 };
      const q = proj([mid.x, mid.y, top]);
      out.push(
        `<text x="${n(left + (q.x - pb.minX) * s)}" y="${n(pad + (q.y - pb.minY) * s - 6)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="12" font-weight="700" fill="#4a5560">${
          isHouse(side.edge) ? 'HOUSE' : 'EXISTING SLAB'
        }</text>`,
      );
    }
  };
  for (let k = 0; k < N; k++) if (farSide(k)) neighbour(k, false);

  // Inside faces of the thickened edge that face the viewer (seen through the top).
  if (p.footing) {
    const zTop = depth - p.thick;
    for (const run of insetRuns(L, p.footing.width, footOn)) {
      for (let j = 0; j < run.length - 1; j++) {
        const a = run[j];
        const c = run[j + 1];
        if (c.x - a.x - (c.y - a.y) > 1e-9) out.push(poly([[a.x, a.y, 0], [c.x, c.y, 0], [c.x, c.y, zTop], [a.x, a.y, zTop]], '#a39e95'));
      }
    }
  }
  // Outside faces toward the viewer, full depth along the thickened edge.
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const c = pts[(i + 1) % pts.length];
    const nx = c.y - a.y;
    const ny = -(c.x - a.x);
    if (nx + ny <= 1e-9) continue;
    const bottom = edgeFoot[i] ? 0 : depth - p.thick;
    out.push(poly([[a.x, a.y, bottom], [c.x, c.y, bottom], [c.x, c.y, depth], [a.x, a.y, depth]], nx >= ny ? '#b9b5ad' : '#8f8b84', ' stroke-opacity="0.6"'));
  }
  out.push(`<polygon points="${pts.map((q) => pt(q.x, q.y, depth)).join(' ')}" fill="#d9d6cf" fill-opacity="${p.footing ? 0.55 : 0.8}" stroke="#5f5b55" stroke-width="0.8" stroke-linejoin="round"/>`);

  // The slab mat as cut, with legs bent down at footing edges.
  const zBar = depth - p.thick / 2;
  if (p.bars?.length) {
    const g: string[] = [];
    for (const sg of p.bars) {
      g.push(line([sg.a.x, sg.a.y, zBar], [sg.b.x, sg.b.y, zBar]));
      if (p.bentLegsTo !== undefined) {
        if (sg.footAtA) g.push(line([sg.a.x, sg.a.y, zBar], [sg.a.x, sg.a.y, p.bentLegsTo]));
        if (sg.footAtB) g.push(line([sg.b.x, sg.b.y, zBar], [sg.b.x, sg.b.y, p.bentLegsTo]));
      }
    }
    out.push(`<g fill="none" stroke="#b5501c" stroke-width="1.1" opacity="0.85">${g.join('')}</g>`);
  }
  for (const bar of p.footingBars ?? []) {
    const g = insetRuns(L, bar.inset, footOn).map((run) => `<polyline points="${run.map((q) => pt(q.x, q.y, bar.z)).join(' ')}"/>`);
    out.push(`<g fill="none" stroke="#8a2e00" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${g.join('')}</g>`);
  }
  if (p.dowelFt) {
    const g: string[] = [];
    L.sides.forEach((side, k) => {
      if (!hasDowels(side.edge)) return;
      const nk = { x: -L.dir[k].y, y: L.dir[k].x };
      for (const q of alongSide(L, k, p.dowelFt!, 0)) g.push(line([q.x - nk.x * 0.7, q.y - nk.y * 0.7, zBar], [q.x + nk.x * 1.2, q.y + nk.y * 1.2, zBar]));
    });
    out.push(`<g fill="none" stroke="#e05a00" stroke-width="2.4" stroke-linecap="round">${g.join('')}</g>`);
  }
  for (let k = 0; k < N; k++) if (!farSide(k)) neighbour(k, true);
  if (p.note) out.push(`<text x="${W - 14}" y="${H - 12}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="12" fill="#666">${esc(p.note)}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="3D view"><rect width="${W}" height="${H}" fill="#f4f6f8"/>${out.join('')}</svg>`;
}

export type { OutlineRow };
