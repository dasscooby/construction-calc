// Cleans up a finger sketch using the measurements:
//   - a line drawn within 12° of level or plumb is made exactly level / plumb,
//   - two lines meeting within 12° of square are made exactly square,
//   - every line with a measurement is made exactly that long,
// and everything else (angled lines, lines with no measurement) falls where those put it.
// Solved by least squares (Levenberg–Marquardt), starting from the sketch scaled to the measurements.

export interface PadPoint {
  x: number;
  y: number;
}
export interface PadEdge {
  a: number;
  b: number;
  /** Measured length, ft; null = not measured */
  length: number | null;
}

export interface PadSolution {
  points: PadPoint[];
  /** Each line: its solved length and how it's held */
  edges: { a: number; b: number; length: number; measured: boolean; axis: 'H' | 'V' | null; sure: boolean }[];
  /** Pairs of lines held square, by edge index */
  square: [number, number][];
  /** Measured lines that couldn't be made to fit, by edge index, with how far off (ft) */
  misfit: { edge: number; off: number }[];
}

const SNAP_DEG = 12;
const TOL_FT = 1 / 16 / 12; // 1/16"

const angleOf = (p: PadPoint, q: PadPoint) => (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
const off90 = (deg: number) => {
  const a = Math.abs(((deg % 180) + 180) % 180); // 0..180
  return Math.min(Math.abs(a - 90), a, 180 - a); // how far from level (0/180) or plumb (90)
};

/** Which way each sketched line is held: level, plumb, or free. */
function axes(pts: PadPoint[], edges: PadEdge[]): ('H' | 'V' | null)[] {
  return edges.map((e) => {
    const a = Math.abs(angleOf(pts[e.a], pts[e.b]));
    const fromLevel = Math.min(a, 180 - a);
    if (fromLevel <= SNAP_DEG) return 'H';
    if (Math.abs(a - 90) <= SNAP_DEG) return 'V';
    return null;
  });
}

/** Pairs of lines sharing a point that were drawn nearly square (and aren't already held level/plumb). */
function squares(pts: PadPoint[], edges: PadEdge[], ax: ('H' | 'V' | null)[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      if (ax[i] && ax[j]) continue; // level + plumb is square already
      const ei = edges[i];
      const ej = edges[j];
      const shared = [ei.a, ei.b].find((p) => p === ej.a || p === ej.b);
      if (shared === undefined) continue;
      const oi = shared === ei.a ? ei.b : ei.a;
      const oj = shared === ej.a ? ej.b : ej.a;
      const d = Math.abs(angleOf(pts[shared], pts[oi]) - angleOf(pts[shared], pts[oj]));
      const ang = Math.min(d, 360 - d);
      if (Math.abs(ang - 90) <= SNAP_DEG && off90(ang) <= SNAP_DEG) out.push([i, j]);
    }
  }
  return out;
}

/** Solve (A + λI) x = b for a small dense system. */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const v = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / v;
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

function lm(x0: number[], residuals: (x: number[]) => number[], iters = 200): number[] {
  let x = [...x0];
  let r = residuals(x);
  let cost = r.reduce((s, v) => s + v * v, 0);
  let lambda = 1e-3;
  const n = x.length;
  for (let it = 0; it < iters && cost > 1e-18; it++) {
    // Jacobian by finite differences.
    const J: number[][] = r.map(() => new Array(n).fill(0));
    for (let k = 0; k < n; k++) {
      const h = 1e-6 * Math.max(1, Math.abs(x[k]));
      const xh = [...x];
      xh[k] += h;
      const rh = residuals(xh);
      for (let i = 0; i < r.length; i++) J[i][k] = (rh[i] - r[i]) / h;
    }
    const JtJ = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => J.reduce((s, row) => s + row[a] * row[b], 0)));
    const Jtr = Array.from({ length: n }, (_, a) => J.reduce((s, row, i) => s + row[a] * r[i], 0));
    let improved = false;
    for (let tries = 0; tries < 10; tries++) {
      const A = JtJ.map((row, i) => row.map((v, j) => (i === j ? v + lambda * (v || 1) : v)));
      const step = solveLinear(A, Jtr.map((v) => -v));
      const xn = x.map((v, i) => v + step[i]);
      const rn = residuals(xn);
      const cn = rn.reduce((s, v) => s + v * v, 0);
      if (cn < cost) {
        x = xn;
        r = rn;
        const done = cost - cn < 1e-14;
        cost = cn;
        lambda = Math.max(lambda / 3, 1e-9);
        improved = true;
        if (done) it = iters;
        break;
      }
      lambda *= 4;
    }
    if (!improved) break;
  }
  return x;
}

export function solvePad(sketch: PadPoint[], edges: PadEdge[]): PadSolution {
  const n = sketch.length;
  const ax = axes(sketch, edges);
  const sq = squares(sketch, edges, ax);
  // Scale the sketch to feet using the measured lines (middle ratio), so the start is close.
  const ratios = edges.filter((e) => e.length && e.length > 0).map((e) => e.length! / (Math.hypot(sketch[e.b].x - sketch[e.a].x, sketch[e.b].y - sketch[e.a].y) || 1));
  ratios.sort((p, q) => p - q);
  const k = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 0.05;
  const start = sketch.map((p) => ({ x: (p.x - sketch[0].x) * k, y: (p.y - sketch[0].y) * k }));
  const avg = Math.max(1, edges.reduce((s, e) => s + (e.length ?? 0), 0) / Math.max(1, edges.filter((e) => e.length).length));

  // Point 0 stays put; the others move.
  const pts = (x: number[]): PadPoint[] => [{ x: 0, y: 0 }, ...Array.from({ length: n - 1 }, (_, i) => ({ x: x[2 * i], y: x[2 * i + 1] }))];
  // A nudged copy of the sketch (bigger and turned a little), to see what the measurements really decide.
  const nudged = start.map((p) => {
    const c = Math.cos(0.08);
    const sn = Math.sin(0.08);
    return { x: 1.25 * (p.x * c - p.y * sn), y: 1.25 * (p.x * sn + p.y * c) };
  });
  const run = (pull: number, target: PadPoint[]) =>
    lm(
      target.slice(1).flatMap((p) => [p.x, p.y]),
      (x) => {
        const p = pts(x);
        const r: number[] = [];
        edges.forEach((e, i) => {
          const dx = p[e.b].x - p[e.a].x;
          const dy = p[e.b].y - p[e.a].y;
          if (e.length) r.push((Math.hypot(dx, dy) - e.length) * 10);
          if (ax[i] === 'H') r.push(dy * 10);
          if (ax[i] === 'V') r.push(dx * 10);
        });
        for (const [i, j] of sq) {
          const ei = edges[i];
          const ej = edges[j];
          const shared = [ei.a, ei.b].find((q) => q === ej.a || q === ej.b)!;
          const oi = shared === ei.a ? ei.b : ei.a;
          const oj = shared === ej.a ? ej.b : ej.a;
          const ux = p[oi].x - p[shared].x;
          const uy = p[oi].y - p[shared].y;
          const vx = p[oj].x - p[shared].x;
          const vy = p[oj].y - p[shared].y;
          r.push(((ux * vx + uy * vy) / ((Math.hypot(ux, uy) || 1) * (Math.hypot(vx, vy) || 1))) * avg * 10);
        }
        // A light pull toward the sketch, for anything the measurements don't pin down.
        for (let q = 1; q < n; q++) r.push((p[q].x - target[q].x) * pull, (p[q].y - target[q].y) * pull);
        return r;
      },
    );
  const weak = pts(run(0.0005, start));
  const other = pts(run(0.0005, nudged));
  const lenOf = (p: PadPoint[], e: PadEdge) => Math.hypot(p[e.b].x - p[e.a].x, p[e.b].y - p[e.a].y);
  return {
    points: weak,
    edges: edges.map((e, i) => ({
      a: e.a,
      b: e.b,
      length: lenOf(weak, e),
      measured: !!e.length,
      axis: ax[i],
      // If nudging the sketch changes this line, the measurements don't decide it.
      sure: Math.abs(lenOf(other, e) - lenOf(weak, e)) < 1 / 48,
    })),
    square: sq,
    misfit: edges.flatMap((e, i) => (e.length && Math.abs(lenOf(weak, e) - e.length) > TOL_FT * 2 ? [{ edge: i, off: lenOf(weak, e) - e.length }] : [])),
  };
}
