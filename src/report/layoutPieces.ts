// Steps and pads placed on a foundation layout, outside the walls: square or round steps (half, full or
// quarter round, built off a main diameter, each step up 2 treads smaller), and pads or landings (square,
// half, full or quarter round, one thickness).
//
// Each one sits outside the outside face of the wall it's on, centered on the spot you give along that
// wall (from the wall's first end, outside). A full round sits touching the wall. A quarter round goes in
// an inside corner of the building (where two outside walls meet the way an add-on meets the house), its
// two straight sides against the two walls.

import { ROUND_PART, RoundKind } from '../tools/concreteTools';
import type { Pt } from './wallGraph';

export type PieceShape = 'square' | RoundKind;

/** The outside wall a piece is on: a main wall, or an add-on's first side, far wall or second side. */
export type WallRef = { main: 'top' | 'right' | 'bottom' | 'left' } | { addOn: number; wall: 'side1' | 'far' | 'side2' };

export interface PieceSpec {
  kind: 'steps' | 'pad';
  shape: PieceShape;
  /** Wall it's against (all but a quarter round) and the spot along it, ft from its first end, outside */
  wall?: WallRef;
  along?: number;
  /** A quarter round: which inside corner (in order round the building's outside) */
  corner?: number;
  /** Steps: how many, rise and tread each, ft */
  steps?: number;
  rise?: number;
  tread?: number;
  /** Square: across (along the wall), ft; a square pad's depth out from the wall, ft */
  width?: number;
  depth?: number;
  /** Round: the main diameter (the bottom step, or the pad), ft */
  diameter?: number;
  /** Pad thickness, ft */
  thick?: number;
}

/** An outside wall face: from its first end along u, the outside is o, this long. */
export interface FaceLine {
  ref: WallRef;
  name: string;
  /** Where "along" is measured from: "corner D", "the house", "its left end" */
  from: string;
  p0: Pt;
  u: Pt;
  o: Pt;
  length: number;
}

export interface PlacedPiece {
  index: number;
  spec: PieceSpec;
  /** "Steps 1", "Pad 2" */
  name: string;
  /** "Half round steps, 3 @ 7\" × 12\", 10' 0\" main diameter, on the Main front D–A" */
  describe: string;
  /** Each layer from the bottom: its outline in plan, and how tall (steps: one rise each; a pad: its thickness) */
  layers: { poly: Pt[]; h: number }[];
  cuFt: number;
  /** Top surface (treads and landing, or the pad), sq ft */
  topArea: number;
  /** Curved form, ft (each riser, or the pad's edge) */
  curvedForm: number;
  /** Straight form, ft (each riser's front and sides, or the pad's open edges) */
  straightForm: number;
  /** Something's wrong with it (the message), else '' */
  problem: string;
}

const add = (a: Pt, b: Pt, k = 1): Pt => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const dimText = (ft: number) => {
  const whole = Math.floor(ft + 1e-9);
  const inch = Math.round((ft - whole) * 12);
  return inch === 12 ? `${whole + 1}' 0"` : `${whole}' ${inch}"`;
};
const inchText = (ft: number) => `${Math.round(ft * 12 * 10) / 10}"`;

/** Points round an arc from angle a0 to a1 (radians), center c, radius r. */
function arc(c: Pt, r: number, a0: number, a1: number, segs: number): Pt[] {
  return Array.from({ length: segs + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / segs;
    return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
  });
}
const angle = (v: Pt) => Math.atan2(v.y, v.x);

/** A round outline (half against a face, full, or quarter in a corner) of diameter d. */
function roundPoly(kind: RoundKind, d: number, at: { c: Pt; o: Pt; u: Pt } | { c: Pt; a: Pt; b: Pt }): Pt[] {
  const r = d / 2;
  if ('a' in at) {
    // Quarter: from direction a round to direction b (90° apart), outside the corner.
    let a0 = angle(at.a);
    let a1 = angle(at.b);
    while (a1 < a0) a1 += 2 * Math.PI;
    if (a1 - a0 > Math.PI) [a0, a1] = [a1, a0 + 2 * Math.PI];
    return [at.c, ...arc(at.c, r, a0, a1, 24)];
  }
  if (kind === 'full') return arc(at.c, r, 0, 2 * Math.PI, 64).slice(0, -1);
  // Half: the flat side on the face, bulging out along o.
  const a0 = angle(at.u);
  const sweep = Math.sign(at.u.x * at.o.y - at.u.y * at.o.x) || 1;
  return arc(at.c, r, a0, a0 + sweep * Math.PI, 40);
}

/** The building's inside corners (where two outside walls meet with the outside between them, 90°). */
export function insideCorners(outside: Pt[] | null): { c: Pt; a: Pt; b: Pt }[] {
  if (!outside) return [];
  const n = outside.length;
  const s = Math.sign(outside.reduce((t, p, i) => t + p.x * outside[(i + 1) % n].y - outside[(i + 1) % n].x * p.y, 0)) || 1;
  const out: { c: Pt; a: Pt; b: Pt }[] = [];
  outside.forEach((v, i) => {
    const prev = outside[(i - 1 + n) % n];
    const next = outside[(i + 1) % n];
    const e1 = { x: v.x - prev.x, y: v.y - prev.y };
    const e2 = { x: next.x - v.x, y: next.y - v.y };
    const cross = e1.x * e2.y - e1.y * e2.x;
    // A turn against the way the outline goes round is an inside corner.
    if (cross * s < -1e-9) {
      const L1 = Math.hypot(e1.x, e1.y);
      const L2 = Math.hypot(e2.x, e2.y);
      out.push({ c: v, a: { x: -e1.x / L1, y: -e1.y / L1 }, b: { x: e2.x / L2, y: e2.y / L2 } });
    }
  });
  return out;
}

const insidePoly = (p: Pt, poly: Pt[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y)) inside = !inside;
  }
  return inside;
};

const areaOf = (pts: Pt[]) => Math.abs(pts.reduce((s, p, i) => s + p.x * pts[(i + 1) % pts.length].y - pts[(i + 1) % pts.length].x * p.y, 0) / 2);

/** Diameters bottom first: each step up 2 treads smaller. */
export const stepDiameters = (n: number, D: number, tread: number) => Array.from({ length: n }, (_, k) => D - 2 * k * tread);

export function placePieces(pieces: PieceSpec[], faces: FaceLine[], outside: Pt[] | null): PlacedPiece[] {
  const corners = insideCorners(outside);
  let steps = 0;
  let pads = 0;
  return pieces.map((spec, index) => {
    const name = spec.kind === 'steps' ? `Steps ${++steps}` : `Pad ${++pads}`;
    const face = spec.wall ? faces.find((f) => JSON.stringify(f.ref) === JSON.stringify(spec.wall)) : undefined;
    const quarter = spec.shape === 'quarter';
    const corner = quarter ? corners[spec.corner ?? 0] : undefined;
    const n = spec.kind === 'steps' ? Math.max(1, Math.round(spec.steps ?? 0)) : 1;
    const rise = spec.rise ?? 7 / 12;
    const tread = spec.tread ?? 1;
    const D = spec.diameter ?? 0;
    const shapeName = spec.shape === 'square' ? 'square' : `${{ half: 'half', full: 'full', quarter: 'quarter' }[spec.shape]} round`;
    const empty = (problem: string): PlacedPiece => ({ index, spec, name, describe: `${shapeName} ${spec.kind === 'steps' ? 'steps' : 'pad'}`, layers: [], cuFt: 0, topArea: 0, curvedForm: 0, straightForm: 0, problem });
    if (quarter && !corner) return empty(`${name}: a quarter round goes in an inside corner, and this layout has none there.`);
    if (!quarter && !face) return empty(`${name}: pick the wall it goes on.`);
    if (spec.kind === 'pad' && !((spec.thick ?? 0) > 0)) return empty(`${name}: put in how thick.`);
    if (spec.shape !== 'square' && !(D > 0)) return empty(`${name}: put in the main diameter.`);
    if (spec.shape === 'square' && !((spec.width ?? 0) > 0)) return empty(`${name}: put in how wide.`);
    if (spec.kind === 'pad' && spec.shape === 'square' && !((spec.depth ?? 0) > 0)) return empty(`${name}: put in how far out.`);
    const diameters = spec.kind === 'steps' ? stepDiameters(n, D, tread) : [D];
    if (spec.shape !== 'square' && diameters[diameters.length - 1] <= 0) return empty(`${name}: ${n} steps with ${inchText(tread)} treads need more than ${dimText(D)} across.`);

    const layers: { poly: Pt[]; h: number }[] = [];
    const h = spec.kind === 'steps' ? rise : spec.thick!;
    const along = Math.max(0, Math.min(face?.length ?? 0, spec.along ?? (face ? face.length / 2 : 0)));
    for (let k = 0; k < n; k++) {
      if (spec.shape === 'square') {
        const W = spec.width!;
        const out = spec.kind === 'steps' ? (n - k) * tread : spec.depth!;
        const c = add(face!.p0, face!.u, along);
        const a = add(c, face!.u, -W / 2);
        const b = add(c, face!.u, W / 2);
        layers.push({ poly: [a, b, add(b, face!.o, out), add(a, face!.o, out)], h });
      } else if (quarter) {
        layers.push({ poly: roundPoly('quarter', diameters[k], corner!), h });
      } else {
        const c0 = add(face!.p0, face!.u, along);
        const c = spec.shape === 'full' ? add(c0, face!.o, D / 2) : c0;
        layers.push({ poly: roundPoly(spec.shape as RoundKind, diameters[k], { c, o: face!.o, u: face!.u }), h });
      }
    }
    // Volume, top surface and forms, exact (not from the drawn outlines).
    const part = spec.shape === 'square' ? 0 : ROUND_PART[spec.shape as RoundKind];
    const footprint = (k: number) => (spec.shape === 'square' ? spec.width! * (spec.kind === 'steps' ? (n - k) * tread : spec.depth!) : (Math.PI * diameters[k] ** 2) / 4 * part);
    const cuFt = Array.from({ length: n }, (_, k) => footprint(k) * h).reduce((s, v) => s + v, 0);
    const topArea = footprint(0);
    let curvedForm = 0;
    let straightForm = 0;
    if (spec.shape === 'square') {
      // Steps: each riser across the front, and both sides of each layer; a pad: its three open edges.
      if (spec.kind === 'steps') straightForm = n * spec.width! + 2 * Array.from({ length: n }, (_, k) => (n - k) * tread).reduce((s, v) => s + v, 0);
      else straightForm = spec.width! + 2 * spec.depth!;
    } else curvedForm = diameters.reduce((s, d) => s + Math.PI * d * part, 0);
    // It has to be outside the building.
    const probe = layers[0]?.poly.reduce((s, p) => ({ x: s.x + p.x / layers[0].poly.length, y: s.y + p.y / layers[0].poly.length }), { x: 0, y: 0 });
    const inBuilding = probe && outside ? insidePoly(probe, outside) : false;
    const where = quarter ? `in inside corner ${(spec.corner ?? 0) + 1}` : `on the ${face!.name}, centered ${dimText(along)} from ${face!.from}`;
    const sizes =
      spec.kind === 'steps'
        ? `${n} @ ${inchText(rise)} × ${inchText(tread)}, ${spec.shape === 'square' ? `${dimText(spec.width!)} wide` : `${dimText(D)} main diameter`}`
        : `${inchText(spec.thick!)} thick, ${spec.shape === 'square' ? `${dimText(spec.width!)} × ${dimText(spec.depth!)}` : `${dimText(D)} across`}`;
    return {
      index,
      spec,
      name,
      describe: `${shapeName[0].toUpperCase()}${shapeName.slice(1)} ${spec.kind === 'steps' ? 'steps' : 'pad'}, ${sizes}, ${where}`,
      layers,
      cuFt,
      topArea,
      curvedForm,
      straightForm,
      problem: inBuilding ? `${name} lands inside the building. Pick another wall or spot.` : '',
    };
  });
}

/** Outline area of a piece's bottom layer (for checks). */
export const footprintArea = (p: PlacedPiece) => (p.layers[0] ? areaOf(p.layers[0].poly) : 0);
