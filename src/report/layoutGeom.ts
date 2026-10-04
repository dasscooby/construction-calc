// Geometry for a slab of any square-cornered shape, described by walking its edge clockwise:
// each side's length (corner to corner, as if square), the turn at its end (right = outside
// corner, left = inside corner), the corner radius, and what the edge is (formed, house, ...).
// Coordinates are feet with y down; the walk starts heading right (+x).

import type { OutlineRow } from '../tools/types';
import type { Pt } from './geometry';

export interface Layout {
  sides: OutlineRow[];
  /** Square corner at the end of side k */
  V: Pt[];
  /** Direction of side k */
  dir: Pt[];
  closed: boolean;
  /** How far the last corner misses the start (ft) */
  gap: number;
}

const right = (d: Pt): Pt => ({ x: -d.y, y: d.x });
const left = (d: Pt): Pt => ({ x: d.y, y: -d.x });
/** Inside of the slab is to the right of the walk. */
const inward = (d: Pt): Pt => right(d);

export function buildLayout(sides: OutlineRow[]): Layout {
  let p: Pt = { x: 0, y: 0 };
  let d: Pt = { x: 1, y: 0 };
  const V: Pt[] = [];
  const dir: Pt[] = [];
  for (const s of sides) {
    dir.push(d);
    p = { x: p.x + d.x * s.length, y: p.y + d.y * s.length };
    V.push(p);
    d = s.turn === 'R' ? right(d) : left(d);
  }
  const gap = Math.hypot(p.x, p.y);
  return { sides, V, dir, closed: sides.length >= 4 && gap < 0.05 && d.x === 1 && d.y === 0, gap };
}

const n = (L: Layout) => L.sides.length;
const outsideCorner = (L: Layout, k: number) => L.sides[k].turn === 'R';

/** Straight part of side k, between the curves at its ends. */
export const straight = (L: Layout, k: number) => L.sides[k].length - L.sides[(k + n(L) - 1) % n(L)].radius - L.sides[k].radius;
export const arcLen = (L: Layout, k: number) => (Math.PI / 2) * L.sides[k].radius;

/** Square-cornered area (shoelace), then each rounded corner: outside corners lose, inside corners gain r²(1 − π/4). */
export function layoutArea(L: Layout): number {
  let a = 0;
  L.V.forEach((p, i) => {
    const q = L.V[(i + 1) % L.V.length];
    a += p.x * q.y - q.x * p.y;
  });
  const fillet = L.sides.reduce((sum, s) => sum + (s.radius > 0 ? (s.turn === 'R' ? -1 : 1) * s.radius * s.radius * (1 - Math.PI / 4) : 0), 0);
  return Math.abs(a) / 2 + fillet;
}

/** Points around corner k, `inset` ft in from the edge (one point for a square corner). */
export function cornerArc(L: Layout, k: number, inset: number, steps = 12): Pt[] {
  const a = L.dir[k];
  const b = L.dir[(k + 1) % n(L)];
  const na = inward(a);
  const nb = inward(b);
  const V = L.V[k];
  const r = L.sides[k].radius;
  if (r <= 0) return [{ x: V.x + inset * (na.x + nb.x), y: V.y + inset * (na.y + nb.y) }];
  const out = outsideCorner(L, k);
  const sign = out ? 1 : -1;
  const C = { x: V.x + sign * r * (na.x + nb.x), y: V.y + sign * r * (na.y + nb.y) };
  const T1 = { x: V.x - r * a.x, y: V.y - r * a.y };
  const T2 = { x: V.x + r * b.x, y: V.y + r * b.y };
  const rr = Math.max(0, out ? r - inset : r + inset);
  const t1 = Math.atan2(T1.y - C.y, T1.x - C.x);
  let dt = Math.atan2(T2.y - C.y, T2.x - C.x) - t1;
  while (dt > Math.PI) dt -= 2 * Math.PI;
  while (dt <= -Math.PI) dt += 2 * Math.PI;
  return Array.from({ length: steps + 1 }, (_, j) => {
    const t = t1 + (dt * j) / steps;
    return { x: C.x + rr * Math.cos(t), y: C.y + rr * Math.sin(t) };
  });
}

/**
 * The outline `inset` ft in from the edge, as points, plus who owns each edge of it:
 * owner[i] for the edge from points[i] to points[i+1] is { side } for a straight part or { corner } on a curve.
 */
export function outlinePoints(L: Layout, inset: number): { points: Pt[]; owner: ({ side: number } | { corner: number })[] } {
  const points: Pt[] = [];
  const owner: ({ side: number } | { corner: number })[] = [];
  for (let k = 0; k < n(L); k++) {
    const arc = cornerArc(L, k, inset);
    arc.forEach((p, j) => {
      points.push(p);
      owner.push(j < arc.length - 1 ? { corner: k } : { side: (k + 1) % n(L) });
    });
  }
  return { points, owner };
}

/** Start of side k's straight part (after the previous corner's curve) and its far end, `inset` in. */
export function sideRun(L: Layout, k: number, inset: number): [Pt, Pt] {
  const prev = (k + n(L) - 1) % n(L);
  const d = L.dir[k];
  const nk = inward(d);
  const start = L.V[prev];
  const r0 = L.sides[prev].radius;
  const r1 = L.sides[k].radius;
  const a = { x: start.x + d.x * r0 + nk.x * inset, y: start.y + d.y * r0 + nk.y * inset };
  const b = { x: L.V[k].x - d.x * r1 + nk.x * inset, y: L.V[k].y - d.y * r1 + nk.y * inset };
  return [a, b];
}

/**
 * Lines `inset` in from the edge along the sides where `on(k)` is true, joined around corners
 * (square or curved) where both sides are on. Where an on-side meets an off-side the line runs to the edge.
 */
export function insetRuns(L: Layout, inset: number, on: (k: number) => boolean): Pt[][] {
  const runs: Pt[][] = [];
  for (let k = 0; k < n(L); k++) {
    if (!on(k)) continue;
    const prev = (k + n(L) - 1) % n(L);
    const next = (k + 1) % n(L);
    let [a, b] = sideRun(L, k, inset);
    if (on(prev)) {
      const arc = cornerArc(L, prev, inset);
      a = arc[arc.length - 1];
    } else if (L.sides[prev].radius === 0) {
      // Off-side before: run out to the edge of the slab at that corner.
      const d = L.dir[k];
      const nk = inward(d);
      a = { x: L.V[prev].x + nk.x * inset, y: L.V[prev].y + nk.y * inset };
    }
    if (on(next)) b = cornerArc(L, k, inset)[0];
    else if (L.sides[k].radius === 0) {
      const d = L.dir[k];
      const nk = inward(d);
      b = { x: L.V[k].x + nk.x * inset, y: L.V[k].y + nk.y * inset };
    }
    runs.push([a, b]);
    if (on(next)) {
      const arc = cornerArc(L, k, inset);
      if (arc.length > 1) runs.push(arc);
    }
  }
  return runs;
}

export interface BarSegment {
  a: Pt;
  b: Pt;
  /** Does each end land on a footing edge (so it can be bent down)? */
  footAtA: boolean;
  footAtB: boolean;
}

/**
 * The slab mat for this shape: bars every `spacingFt` both ways, each one cut to fit the shape
 * `coverFt` in from the edge. Lines through the shape that cross a notch make two bars.
 */
export function matBars(L: Layout, coverFt: number, spacingFt: number, footingOn: (k: number) => boolean): BarSegment[] {
  const { points, owner } = outlinePoints(L, coverFt);
  const ownerFoot = (i: number) => {
    const o = owner[i];
    if ('side' in o) return footingOn(o.side);
    return footingOn(o.corner) && footingOn((o.corner + 1) % n(L));
  };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const segs: BarSegment[] = [];
  const lines = (from: number, to: number) => {
    const spaces = Math.max(1, Math.ceil((to - from) / spacingFt - 1e-9));
    return Array.from({ length: spaces + 1 }, (_, i) => from + ((to - from) * i) / spaces);
  };
  const eps = 1e-6;
  // Bars running left-right, one row every spacing from top to bottom.
  for (let y of lines(Math.min(...ys), Math.max(...ys))) {
    y = Math.min(Math.max(y, Math.min(...ys) + eps), Math.max(...ys) - eps);
    const hits: { x: number; foot: boolean }[] = [];
    points.forEach((p, i) => {
      const q = points[(i + 1) % points.length];
      if ((p.y <= y && q.y > y) || (q.y <= y && p.y > y)) hits.push({ x: p.x + ((y - p.y) * (q.x - p.x)) / (q.y - p.y), foot: ownerFoot(i) });
    });
    hits.sort((u, v) => u.x - v.x);
    for (let i = 0; i + 1 < hits.length; i += 2) {
      if (hits[i + 1].x - hits[i].x > 0.05) segs.push({ a: { x: hits[i].x, y }, b: { x: hits[i + 1].x, y }, footAtA: hits[i].foot, footAtB: hits[i + 1].foot });
    }
  }
  // Bars running up-down.
  for (let x of lines(Math.min(...xs), Math.max(...xs))) {
    x = Math.min(Math.max(x, Math.min(...xs) + eps), Math.max(...xs) - eps);
    const hits: { y: number; foot: boolean }[] = [];
    points.forEach((p, i) => {
      const q = points[(i + 1) % points.length];
      if ((p.x <= x && q.x > x) || (q.x <= x && p.x > x)) hits.push({ y: p.y + ((x - p.x) * (q.y - p.y)) / (q.x - p.x), foot: ownerFoot(i) });
    });
    hits.sort((u, v) => u.y - v.y);
    for (let i = 0; i + 1 < hits.length; i += 2) {
      if (hits[i + 1].y - hits[i].y > 0.05) segs.push({ a: { x, y: hits[i].y }, b: { x, y: hits[i + 1].y }, footAtA: hits[i].foot, footAtB: hits[i + 1].foot });
    }
  }
  return segs;
}

/** Points every `spacingFt` along side k's straight part, 6" in from its ends, `inset` ft in (negative = outside). */
export function alongSide(L: Layout, k: number, spacingFt: number, inset: number): Pt[] {
  const [a, b] = sideRun(L, k, inset);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len <= 1) return [{ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }];
  const spaces = Math.max(1, Math.ceil((len - 1) / spacingFt - 1e-9));
  return Array.from({ length: spaces + 1 }, (_, i) => {
    const t = (0.5 + ((len - 1) * i) / spaces) / len;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  });
}
