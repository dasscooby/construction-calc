// Turns a Wall Forms wall list into a floor plan: the outside outline and the inside face.
//
// Walls are listed going around the foundation. Each says what kind of corner is at its ends
// ('oo' outside both, 'ii' inside both, 'oi' one of each, either way round). Walking around
// clockwise, you turn right at an outside corner and left at an inside corner.

import type { WallEnds, WallRow } from '../tools/types';

export interface Pt {
  x: number;
  y: number;
}

export type Corner = 'o' | 'i';

/**
 * The corner after each wall (between wall n and wall n+1, the last one closing back to wall 1).
 * Walls marked 'oi' can be either way round, so this tries both and keeps a layout where the
 * corner at the end of one wall matches the start of the next. Null if none fits.
 */
export function cornersAfter(ends: WallEnds[]): Corner[] | null {
  const n = ends.length;
  if (!n) return null;
  const mixed = ends.map((e, i) => (e === 'oi' ? i : -1)).filter((i) => i >= 0);
  if (mixed.length > 14) return null; // too many to try every way
  for (let mask = 0; mask < 1 << mixed.length; mask++) {
    const startEnd = ends.map((e): [Corner, Corner] => (e === 'oo' ? ['o', 'o'] : e === 'ii' ? ['i', 'i'] : ['o', 'i']));
    mixed.forEach((wi, b) => {
      if (mask & (1 << b)) startEnd[wi] = ['i', 'o'];
    });
    if (startEnd.every(([, end], i) => end === startEnd[(i + 1) % n][0])) return startEnd.map(([, end]) => end);
  }
  return null;
}

/**
 * Outside outline, starting at (0, 0) heading right, y down. Returns one point per corner
 * (and the end point if it doesn't close), plus whether it closes back on itself.
 */
export function wallOutline(walls: WallRow[]): { points: Pt[]; closed: boolean; corners: Corner[] } | null {
  const corners = cornersAfter(walls.map((w) => w.ends));
  if (!corners) return null;
  let dir = { x: 1, y: 0 };
  let p: Pt = { x: 0, y: 0 };
  const points: Pt[] = [p];
  walls.forEach((w, i) => {
    p = { x: p.x + dir.x * w.length, y: p.y + dir.y * w.length };
    points.push(p);
    // Right turn (outside corner) in screen coordinates: (x, y) → (−y, x). Left: (y, −x).
    dir = corners[i] === 'o' ? { x: -dir.y, y: dir.x } : { x: dir.y, y: -dir.x };
  });
  const last = points[points.length - 1];
  const closed = Math.hypot(last.x, last.y) < 0.05 && dir.x === 1 && dir.y === 0;
  if (closed) points.pop();
  return { points, closed, corners };
}

/**
 * The inside face: every corner moved in by the wall thickness. Works for square-cornered
 * outlines walked clockwise (inside is to the right of each wall).
 */
export function insetOutline(points: Pt[], t: number): Pt[] {
  const n = points.length;
  return points.map((p, i) => {
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    const a = unit(p.x - prev.x, p.y - prev.y);
    const b = unit(next.x - p.x, next.y - p.y);
    // Right-hand normal of a direction (dx, dy) with y down is (−dy, dx).
    return { x: p.x + t * (-a.y - b.y), y: p.y + t * (a.x + b.x) };
  });
}

function unit(dx: number, dy: number): Pt {
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

/** Area inside an outline (shoelace), always positive. */
export function polygonArea(points: Pt[]): number {
  let a = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  });
  return Math.abs(a) / 2;
}

export function bounds(points: Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  return {
    minX: Math.min(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxX: Math.max(...points.map((p) => p.x)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}
