// A foundation as a set of wall runs: the house, add-ons that share a wall with it, and walls inside
// that tee into other walls. Every run has its own thickness, height and footing. From the runs:
//   - each run's length as you'd measure it and along its middle (what the concrete and bars follow).
//     At a corner both runs go to where their middles meet. At a tee the run stops at the face of the
//     wall it meets (walls) or the edge of that wall's footing (footings).
//   - bends for L-bars: one per corner, one per tee end.
//   - the areas the walls close in (faces), each with its clear size: what a slab poured in it covers.
//
// Square layouts only (every run level or plumb). Plan coordinates in feet, x to the right, y down.
// A run is stored by its middle line.

export interface Pt {
  x: number;
  y: number;
}

export interface Run {
  id: string;
  /** "House top", "Add-on far", "Inside 1" ... */
  name: string;
  /** Middle of the wall, end to end, before anything is taken off at corners and tees */
  a: Pt;
  b: Pt;
  /** As you'd measure it (outside to outside, or face to face for inside walls), ft */
  measured: number;
  thick: number;
  height: number;
  footing: { width: number; depth: number } | null;
}

export type EndKind = 'corner' | 'tee' | 'free';

export interface RunResult {
  run: Run;
  ends: [EndKind, EndKind];
  /** Along the middle, after corners and tees, ft */
  middle: number;
  /** The footing under it, along its middle, ft (0 = no footing) */
  footingMiddle: number;
}

export interface Face {
  /** Middle-of-wall outline, clockwise */
  middle: Pt[];
  /** Clear (inside the wall faces) outline */
  clear: Pt[];
  clearArea: number;
  /** Clear length × width when it's a rectangle */
  rect: { w: number; h: number } | null;
}

export interface GraphResult {
  runs: RunResult[];
  corners: number;
  tees: number;
  faces: Face[];
}

const EPS = 1e-6;
const near = (p: Pt, q: Pt) => Math.abs(p.x - q.x) < 1e-4 && Math.abs(p.y - q.y) < 1e-4;
const len = (r: { a: Pt; b: Pt }) => Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y);
const horiz = (r: { a: Pt; b: Pt }) => Math.abs(r.a.y - r.b.y) < EPS;

/** Is p strictly inside run r's middle line (not at its ends)? */
function onInterior(p: Pt, r: Run): boolean {
  if (near(p, r.a) || near(p, r.b)) return false;
  if (horiz(r)) return Math.abs(p.y - r.a.y) < 1e-4 && p.x > Math.min(r.a.x, r.b.x) + EPS && p.x < Math.max(r.a.x, r.b.x) - EPS;
  return Math.abs(p.x - r.a.x) < 1e-4 && p.y > Math.min(r.a.y, r.b.y) + EPS && p.y < Math.max(r.a.y, r.b.y) - EPS;
}

/**
 * How each run's ends meet the others. Where three runs meet at a point, the first two listed make
 * the corner and later ones tee into the one they run square to (an add-on's side wall lining up
 * with the house wall tees into the house wall it meets).
 */
function joints(runs: Run[]): { kind: EndKind; host: Run | null }[][] {
  const out = runs.map(() => [
    { kind: 'free' as EndKind, host: null as Run | null },
    { kind: 'free' as EndKind, host: null as Run | null },
  ]);
  // Ends that land partway along another run: tees.
  const atNode: { i: number; e: number; p: Pt }[] = [];
  runs.forEach((r, i) =>
    ([r.a, r.b] as const).forEach((p, e) => {
      const through = runs.find((s, k) => k !== i && horiz(s) !== horiz(r) && onInterior(p, s));
      if (through) out[i][e] = { kind: 'tee', host: through };
      else atNode.push({ i, e, p });
    }),
  );
  // Ends that meet at a point: the first two square to each other make the corner; the rest tee into
  // the corner run they're square to.
  const done = new Set<number>();
  atNode.forEach((first, n) => {
    if (done.has(n)) return;
    const group = atNode.map((x, k) => ({ ...x, k })).filter((x) => near(x.p, first.p));
    group.forEach((x) => done.add(x.k));
    if (group.length < 2) return;
    const a = group[0];
    const b = group.find((x) => horiz(runs[x.i]) !== horiz(runs[a.i]));
    if (!b) return;
    out[a.i][a.e] = { kind: 'corner', host: runs[b.i] };
    out[b.i][b.e] = { kind: 'corner', host: runs[a.i] };
    for (const x of group) {
      if (x === a || x === b) continue;
      const host = horiz(runs[x.i]) !== horiz(runs[a.i]) ? runs[a.i] : runs[b.i];
      out[x.i][x.e] = { kind: 'tee', host };
    }
  });
  return out;
}

/** Corners, tees, each run's middle length, and the faces the walls close in. */
export function solveGraph(runs: Run[]): GraphResult {
  const j = joints(runs);
  let corners = 0;
  let tees = 0;
  const results: RunResult[] = runs.map((r, i) => {
    const take = (w: (h: Run) => number) =>
      j[i].reduce((s, end) => s + (end.kind === 'tee' && end.host ? w(end.host) / 2 : 0), 0);
    const full = len(r);
    j[i].forEach((end) => {
      if (end.kind === 'corner') corners += 0.5; // each corner is seen from both runs
      if (end.kind === 'tee') tees += 1;
    });
    return {
      run: r,
      ends: [j[i][0].kind, j[i][1].kind],
      middle: full - take((h) => h.thick),
      footingMiddle: r.footing ? full - take((h) => (h.footing ? h.footing.width : h.thick)) : 0,
    };
  });
  return { runs: results, corners: Math.round(corners), tees, faces: findFaces(runs) };
}

// ---------------------------------------------------------------------------------------------
// Faces: split the runs where others meet them, then walk each area keeping the wall on the right.

interface HalfEdge {
  from: number;
  to: number;
  run: Run;
  used: boolean;
}

function findFaces(runs: Run[]): Face[] {
  const nodes: Pt[] = [];
  const nodeOf = (p: Pt) => {
    const k = nodes.findIndex((q) => near(p, q));
    if (k >= 0) return k;
    nodes.push(p);
    return nodes.length - 1;
  };
  runs.forEach((r) => {
    nodeOf(r.a);
    nodeOf(r.b);
  });
  const half: HalfEdge[] = [];
  for (const r of runs) {
    // Every node on this run, in order from a to b.
    const t = (p: Pt) => (horiz(r) ? (p.x - r.a.x) / (r.b.x - r.a.x) : (p.y - r.a.y) / (r.b.y - r.a.y));
    const on = nodes
      .map((p, k) => ({ p, k }))
      .filter(({ p }) => near(p, r.a) || near(p, r.b) || onInterior(p, r))
      .sort((u, v) => t(u.p) - t(v.p));
    for (let k = 1; k < on.length; k++) {
      half.push({ from: on[k - 1].k, to: on[k].k, run: r, used: false });
      half.push({ from: on[k].k, to: on[k - 1].k, run: r, used: false });
    }
  }
  const angle = (h: HalfEdge) => Math.atan2(nodes[h.to].y - nodes[h.from].y, nodes[h.to].x - nodes[h.from].x);
  const faces: Face[] = [];
  for (const start of half) {
    if (start.used) continue;
    const loop: HalfEdge[] = [];
    let h: HalfEdge | undefined = start;
    let guard = 0;
    while (h && !h.used && guard++ < 1000) {
      h.used = true;
      loop.push(h);
      // At the far node, turn as far right as possible (y down: clockwise walk keeps the face on the right).
      const back = Math.atan2(nodes[h.from].y - nodes[h.to].y, nodes[h.from].x - nodes[h.to].x);
      const outs: HalfEdge[] = half.filter((o) => o.from === h!.to && o.to !== h!.from);
      if (!outs.length) break;
      const turn = (o: HalfEdge) => {
        let d = angle(o) - back;
        while (d <= 0) d += 2 * Math.PI;
        return d;
      };
      h = outs.sort((a, b) => turn(b) - turn(a))[0];
    }
    if (loop.length < 3 || loop[loop.length - 1].to !== loop[0].from) continue;
    const middle = loop.map((e) => nodes[e.from]);
    if (signedArea(middle) <= 0) continue; // the outside of everything
    const clear = offsetIn(loop.map((e) => ({ a: nodes[e.from], b: nodes[e.to], d: e.run.thick / 2 })));
    faces.push({ middle, clear, clearArea: Math.abs(signedArea(clear)), rect: rectOf(clear) });
  }
  return faces;
}

/** Positive for clockwise with y down. */
function signedArea(pts: Pt[]): number {
  let a = 0;
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  });
  return a / 2;
}

/** Move each edge of a clockwise outline inward by its own distance and join them up. */
function offsetIn(edges: { a: Pt; b: Pt; d: number }[]): Pt[] {
  // Join straight runs of edges with the same offset into one edge.
  const merged: { a: Pt; b: Pt; d: number }[] = [];
  for (const e of edges) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.d - e.d) < EPS && Math.abs((last.b.x - last.a.x) * (e.b.y - e.a.y) - (last.b.y - last.a.y) * (e.b.x - e.a.x)) < EPS) last.b = e.b;
    else merged.push({ ...e });
  }
  if (merged.length > 1) {
    const f = merged[0];
    const l = merged[merged.length - 1];
    if (Math.abs(l.d - f.d) < EPS && Math.abs((l.b.x - l.a.x) * (f.b.y - f.a.y) - (l.b.y - l.a.y) * (f.b.x - f.a.x)) < EPS) {
      merged[0] = { a: l.a, b: f.b, d: f.d };
      merged.pop();
    }
  }
  // Inward (right of a clockwise walk, y down) normal of (dx, dy) is (−dy, dx).
  const lines = merged.map((e) => {
    const L = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y) || 1;
    const n = { x: -(e.b.y - e.a.y) / L, y: (e.b.x - e.a.x) / L };
    return { p: { x: e.a.x + n.x * e.d, y: e.a.y + n.y * e.d }, dir: { x: (e.b.x - e.a.x) / L, y: (e.b.y - e.a.y) / L } };
  });
  return lines.map((cur, i) => {
    const prev = lines[(i - 1 + lines.length) % lines.length];
    const cross = prev.dir.x * cur.dir.y - prev.dir.y * cur.dir.x;
    if (Math.abs(cross) < EPS) return cur.p;
    const t = ((cur.p.x - prev.p.x) * cur.dir.y - (cur.p.y - prev.p.y) * cur.dir.x) / cross;
    return { x: prev.p.x + prev.dir.x * t, y: prev.p.y + prev.dir.y * t };
  });
}

function rectOf(pts: Pt[]): { w: number; h: number } | null {
  if (pts.length !== 4) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  return Math.abs(Math.abs(signedArea(pts)) - w * h) < 1e-3 ? { w, h } : null;
}

/** The face a point falls in (smallest one that holds it). */
export function faceAt(faces: Face[], p: Pt): number {
  let best = -1;
  faces.forEach((f, i) => {
    if (inside(p, f.middle) && (best < 0 || Math.abs(signedArea(f.middle)) < Math.abs(signedArea(faces[best].middle)))) best = i;
  });
  return best;
}

function inside(p: Pt, poly: Pt[]): boolean {
  let c = false;
  for (let i = 0, k = poly.length - 1; i < poly.length; k = i++) {
    const a = poly[i];
    const b = poly[k];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
