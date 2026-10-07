// The slab ledge: where a slab meets a wall, the wall is cut back (2" usually) from the bottom of the slab
// to the top of the wall, so the slab runs over onto it. Below the slab the wall is its full thickness.
//
// For each slab: the notch is the strip between the clear outline (wall faces) and that outline grown by
// the ledge, as tall as from the slab's bottom to the top of the wall. The wall loses that concrete; the
// slab gains the strip × its thickness. A slab sitting on the footing (a basement slab) gets no ledge.

import type { Layout, LayoutSpec } from './foundationLayout';
import type { Pt } from './wallGraph';

/** Top of slab below the top of the wall, inches (blank: a basement slab sits on the footing, a stem wall slab at the top). */
export function slabDropIn(spec: LayoutSpec, thickFt: number): number {
  if (spec.slabDropIn !== undefined) return spec.slabDropIn;
  return spec.wall.height >= 6 ? Math.round(spec.wall.height * 12 - thickFt * 12) : 0;
}

export interface SlabLedge {
  /** Index in layout.slabs */
  slab: number;
  pour: number;
  /** From the bottom of the slab to the top of the wall, ft */
  notchH: number;
  /** Around the slab's clear outline, ft */
  perimeter: number;
  /** The strip the slab runs over onto, sq ft */
  strip: number;
  /** The slab's poured outline (clear grown by the ledge) */
  poured: Pt[];
}

export interface LedgeInfo {
  /** Ledge width, ft */
  e: number;
  ledgeIn: number;
  slabs: SlabLedge[];
  /** Concrete the notches take out of the walls, cu ft */
  wallLessCuFt: number;
  /** Notch length all together (where the inside forms get a blockout strip), ft */
  length: number;
}

const area = (pts: Pt[]) => pts.reduce((s, p, i) => s + p.x * pts[(i + 1) % pts.length].y - pts[(i + 1) % pts.length].x * p.y, 0) / 2;
const perimeterOf = (pts: Pt[]) => pts.reduce((s, p, i) => s + Math.hypot(pts[(i + 1) % pts.length].x - p.x, pts[(i + 1) % pts.length].y - p.y), 0);

/** A polygon grown outward by e (each side moved out, the corners where they meet). */
export function grow(pts: Pt[], e: number): Pt[] {
  const s = Math.sign(area(pts)) || 1;
  const n = pts.length;
  const side = (i: number) => {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    // Outward normal: to the right of the direction of travel for a positive (y-down clockwise) outline.
    const nx = (s * (b.y - a.y)) / L;
    const ny = (-s * (b.x - a.x)) / L;
    return { a: { x: a.x + nx * e, y: a.y + ny * e }, d: { x: b.x - a.x, y: b.y - a.y } };
  };
  return pts.map((_, i) => {
    const p = side((i - 1 + n) % n);
    const q = side(i);
    const den = p.d.x * q.d.y - p.d.y * q.d.x;
    if (Math.abs(den) < 1e-12) return q.a;
    const t = ((q.a.x - p.a.x) * q.d.y - (q.a.y - p.a.y) * q.d.x) / den;
    return { x: p.a.x + p.d.x * t, y: p.a.y + p.d.y * t };
  });
}

/** The ledge for each slab of a layout, or null when there's none (no ledge set, or no slab on one). */
export function ledgeOf(l: Layout): LedgeInfo | null {
  const ledgeIn = l.spec.ledgeIn ?? 0;
  if (!(ledgeIn > 0) || !l.slabs.length) return null;
  const e = ledgeIn / 12;
  const h = l.spec.wall.height;
  const slabs: SlabLedge[] = [];
  l.slabs.forEach((sl, i) => {
    // Main slab in a house that's already there: its walls aren't ours to notch.
    if (l.spec.existing && sl.at.in === 'main') return;
    const notchH = slabDropIn(l.spec, sl.thick) / 12 + sl.thick;
    if (notchH >= h - 1e-6) return; // on the footing
    const poured = grow(sl.face.clear, e);
    const strip = Math.abs(area(poured)) - Math.abs(area(sl.face.clear));
    slabs.push({ slab: i, pour: sl.pour, notchH, perimeter: perimeterOf(sl.face.clear), strip, poured });
  });
  if (!slabs.length) return null;
  return {
    e,
    ledgeIn,
    slabs,
    wallLessCuFt: slabs.reduce((s, x) => s + x.strip * x.notchH, 0),
    length: slabs.reduce((s, x) => s + x.perimeter, 0),
  };
}
