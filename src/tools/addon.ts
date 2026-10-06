// An add-on that shares a wall with the main foundation: three new outside walls (side, far, side)
// built off the outside of an existing wall, plus walls inside it that run from the existing wall
// to the far wall (container walls, stalls). Inside walls and the add-on's side walls tee into
// the walls they meet, so their run stops at the face (walls) or the edge (footings) of what they meet.
//
// Local layout: u along the shared wall from its first corner, v out from the existing wall's outside
// face. The existing wall sits at v = −t … 0. Sizes are outside to outside; inside walls are placed by
// their middle.

export interface AddonInput {
  /** Along the shared wall, outside to outside, ft */
  width: number;
  /** Out from the existing wall's outside face to the outside of the far wall, ft */
  depth: number;
  /** Wall thickness, ft */
  t: number;
  /** Width of what's being figured: the wall itself (= t), or the footing under it, ft */
  w: number;
  /** Walls inside it */
  inside: number;
  /** Outside of the side wall to the middle of the first inside wall, ft (0 = spaced evenly) */
  inFrom: number;
}

export interface Rect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface AddonLayout {
  /** As you'd measure it: side + far + side walls on the outside, plus each inside wall's length, ft */
  asMeasuredFt: number;
  /** Outside walls only (side + far + side), ft */
  outsideFt: number;
  /** What the concrete and bars follow: along the middle, stopping at what each tee meets, ft */
  centerFt: number;
  /** The two far corners */
  corners: number;
  /** Ends that tee into another wall: 2 side walls into the existing wall, 2 for each inside wall */
  tees: number;
  /** Middle of each inside wall, ft from the first corner */
  insideAt: number[];
  /** The pieces, for drawings (u, v in ft) */
  pieces: Rect[];
  /** The bays between walls, inside faces (u0 … u1), ft */
  bays: { u0: number; u1: number }[];
}

/** Where the inside walls go: the first and last this far in from each side, the rest evenly between. */
export function insidePositions(width: number, count: number, inFrom: number): number[] {
  if (count <= 0) return [];
  if (!(inFrom > 0)) return Array.from({ length: count }, (_, i) => (width * (i + 1)) / (count + 1));
  if (count === 1) return [inFrom];
  const a = inFrom;
  const b = width - inFrom;
  return Array.from({ length: count }, (_, i) => a + ((b - a) * i) / (count - 1));
}

export function addonLayout(a: AddonInput): AddonLayout | { error: string } {
  const { width: W, depth: D, t, w } = a;
  if (!(W > 0 && D > 0)) return { error: 'Enter the add-on width and how far it comes out.' };
  if (W <= 2 * Math.max(t, w) || D <= Math.max(t, w)) return { error: 'The add-on is too small for that thickness.' };
  const insideAt = insidePositions(W, a.inside, a.inFrom);
  const edges = [t / 2, ...insideAt, W - t / 2];
  for (let i = 1; i < edges.length; i++) {
    if (edges[i] - edges[i - 1] < Math.max(t, w)) return { error: 'The inside walls are too close to each other or to the side walls.' };
  }
  // The existing wall's middle is at v = −t/2; its footing (or the wall) edge at −t/2 + w/2.
  const vStart = -t / 2 + w / 2;
  const vFarMid = D - t / 2;
  const side = vFarMid - vStart; // D − w/2
  const far = W - t; // middle to middle of the side walls
  const inside = vFarMid - w / 2 - vStart; // D − w
  const pieces: Rect[] = [
    { u0: t / 2 - w / 2, v0: vStart, u1: t / 2 + w / 2, v1: vFarMid + w / 2 },
    { u0: W - t / 2 - w / 2, v0: vStart, u1: W - t / 2 + w / 2, v1: vFarMid + w / 2 },
    { u0: t / 2 + w / 2, v0: vFarMid - w / 2, u1: W - t / 2 - w / 2, v1: vFarMid + w / 2 },
    ...insideAt.map((c) => ({ u0: c - w / 2, v0: vStart, u1: c + w / 2, v1: vFarMid - w / 2 })),
  ];
  const faces = [t, ...insideAt.flatMap((c) => [c - t / 2, c + t / 2]), W - t];
  const bays: { u0: number; u1: number }[] = [];
  for (let i = 0; i < faces.length; i += 2) bays.push({ u0: faces[i], u1: faces[i + 1] });
  return {
    asMeasuredFt: 2 * D + W + a.inside * D,
    outsideFt: 2 * D + W,
    centerFt: 2 * side + far + a.inside * inside,
    corners: 2,
    tees: 2 + 2 * a.inside,
    insideAt,
    pieces,
    bays,
  };
}
