// Walls that change height around the house (a daylight basement): you start at corner A, go
// clockwise along the outside of the walls, and say how far each height runs. Whatever's left is
// "the rest of the way". Concrete and wall steel are figured run by run.

import { beamBars, countAlong, getBar, lapIn, sticksToCut, weightLb } from '../lib/rebar';
import type { Pt } from './geometry';

export interface HeightRun {
  /** Along the outside of the walls, ft */
  length: number;
  /** Wall height, ft */
  height: number;
}

/** The runs as entered plus "the rest of the way"; null if they add up to more than the walls. */
export function fullRuns(outsideFt: number, runs: HeightRun[], restHeight: number): { runs: HeightRun[]; over: number } {
  const used = runs.reduce((s, r) => s + r.length, 0);
  const rest = outsideFt - used;
  if (rest < -1 / 96) return { runs, over: -rest };
  return { runs: rest > 1 / 96 ? [...runs, { length: rest, height: restHeight }] : runs, over: 0 };
}

/** Pieces of the house outline, each at its wall height, starting at corner A and going clockwise. */
export function splitOutline(outline: Pt[], runs: HeightRun[]): { a: Pt; b: Pt; height: number; run: number }[] {
  const out: { a: Pt; b: Pt; height: number; run: number }[] = [];
  let r = 0;
  let left = runs[0]?.length ?? 0;
  for (let i = 0; i < outline.length && r < runs.length; i++) {
    const p = outline[i];
    const q = outline[(i + 1) % outline.length];
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    let done = 0;
    while (done < len - 1e-9 && r < runs.length) {
      const take = Math.min(len - done, left);
      const a = { x: p.x + ((q.x - p.x) * done) / len, y: p.y + ((q.y - p.y) * done) / len };
      const b = { x: p.x + ((q.x - p.x) * (done + take)) / len, y: p.y + ((q.y - p.y) * (done + take)) / len };
      if (take > 1e-9) out.push({ a, b, height: runs[r].height, run: r });
      done += take;
      left -= take;
      if (left <= 1e-9) {
        r++;
        left = runs[r]?.length ?? 0;
      }
    }
  }
  return out;
}

/** Wall height at a corner (the run that's there going clockwise). */
function heightAt(outline: Pt[], runs: HeightRun[], corner: number): number {
  let d = 0;
  for (let i = 0; i < corner; i++) d += Math.hypot(outline[(i + 1) % outline.length].x - outline[i].x, outline[(i + 1) % outline.length].y - outline[i].y);
  for (const r of runs) {
    if (d < r.length - 1e-9) return r.height;
    d -= r.length;
  }
  return runs[runs.length - 1]?.height ?? 0;
}

export interface WallSteel {
  horiz: { size: number; spacingIn: number } | null;
  /** Bars along it when the wall gives a count, not a spacing (Footings & Walls) */
  horizLines?: number;
  vert: { size: number; spacingIn: number } | null;
}

export interface DaylightWall {
  /** Concrete in the walls, cu ft (no waste) */
  cuFt: number;
  horizFt: number;
  horizLaps: number;
  cornerBars: number;
  vertCount: number;
  vertFt: number;
  /** Sticks by bar size */
  sticks: Map<number, number>;
  lb: number;
  /** Feet of wall at each height, tallest first */
  byHeight: { height: number; length: number }[];
}

/**
 * Concrete and steel for walls whose height changes. Lengths are along the outside; the middle of the
 * wall is shorter by the corners, so each run is scaled by (middle ÷ outside).
 */
export function daylightWall(
  outline: Pt[],
  runs: HeightRun[],
  thickFt: number,
  centerFt: number,
  outsideFt: number,
  steel: WallSteel,
  stockFt: number,
  lapIn_?: number,
): DaylightWall {
  const k = outsideFt > 0 ? centerFt / outsideFt : 1;
  const cuFt = runs.reduce((s, r) => s + r.length * k * r.height * thickFt, 0);
  const sticks = new Map<number, number>();
  const add = (size: number, n: number) => sticks.set(size, (sticks.get(size) ?? 0) + n);
  let lb = 0;
  let horizFt = 0;
  let horizLaps = 0;
  let cornerBars = 0;
  const rowsFor = (h: number) => (steel.horizLines ? steel.horizLines : steel.horiz ? countAlong(Math.max(0, h * 12 - 6), steel.horiz.spacingIn) : 0);
  if (steel.horiz) {
    const bar = getBar(steel.horiz.size);
    const lap = (lapIn_ ?? lapIn(bar)) / 12;
    for (const r of runs) {
      const rows = rowsFor(r.height);
      if (!rows) continue;
      const b = beamBars(r.length * k, rows, bar, stockFt, lap, 0);
      horizFt += b.totalFt;
      horizLaps += b.laps;
      add(bar.size, b.sticks);
      lb += b.lb;
    }
    // An L-bar for every row at every corner, at that corner's height.
    for (let c = 0; c < outline.length; c++) cornerBars += rowsFor(heightAt(outline, runs, c));
    if (cornerBars) {
      add(bar.size, sticksToCut([{ lengthFt: 2 * lap, count: cornerBars }], stockFt));
      horizFt += cornerBars * 2 * lap;
      lb += weightLb(bar, cornerBars * 2 * lap);
    }
  }
  let vertCount = 0;
  let vertFt = 0;
  if (steel.vert) {
    const bar = getBar(steel.vert.size);
    const pieces: { lengthFt: number; count: number }[] = [];
    for (const r of runs) {
      const n = countAlong(r.length * k * 12, steel.vert.spacingIn);
      const len = r.height - 0.25;
      if (len <= 0) continue;
      pieces.push({ lengthFt: len, count: n });
      vertCount += n;
      vertFt += n * len;
    }
    add(bar.size, sticksToCut(pieces.filter((p) => p.lengthFt <= stockFt), stockFt));
    lb += weightLb(bar, vertFt);
  }
  const map = new Map<number, number>();
  for (const r of runs) map.set(r.height, (map.get(r.height) ?? 0) + r.length);
  const byHeight = [...map].map(([height, length]) => ({ height, length })).sort((a, b) => b.height - a.height);
  return { cuFt, horizFt, horizLaps, cornerBars, vertCount, vertFt, sticks, lb, byHeight };
}
