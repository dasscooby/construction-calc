// Wall Forms from a foundation layout: panels, fillers and corners for every wall face, using the same
// rules as the Wall Forms tool (checked against the crew's Advance-panel job):
//   - outside faces run all the way around the building; at an outside corner each face gets a 1' piece,
//     at an inside corner it stops 4" short (the 4×4 inside corner)
//   - inside faces run around each room and bay; every corner there is a 4×4 inside corner, which is
//     also where an inside wall tees in
// The rest of each face is panels, then fillers, then a wood strip for an odd inch.

import { layoutFace, stackFor, tiesPerJoint } from '../tools/concreteTools';
import { commas, ftIn } from '../tools/format';
import type { ResultRow } from '../tools/types';
import type { Layout } from './foundationLayout';
import type { Pt } from './wallGraph';

const OC_PIECE_IN = 12;
const INSIDE_CORNER_IN = 4;

export interface FormsSetup {
  /** Panel width, in */
  panelIn: number;
  /** Panel heights stacked, in (4' = [48]; 4' + 4' = [48, 48]) */
  heightsIn: number[];
  /** Fillers you carry, in */
  fillers: number[];
}

export const DEFAULT_FORMS: FormsSetup = { panelIn: 24, heightsIn: [48], fillers: [14, 12, 8, 6] };

export interface LayoutForms {
  faceFt: number;
  /** Square feet of contact area (both faces × wall height) */
  sfca: number;
  outsideCorners: number;
  insideCorners: number;
  panels: number;
  /** Rows of panels on each column */
  stack: number[];
  fillers: Map<number, number>;
  woodStrips: number;
  ties: number;
  /** Each face run: where it is and what goes on it */
  faces: { where: string; lengthIn: number; panels: number; fillers: number[]; woodIn: number }[];
}

/** Corners of a clockwise outline: true = turns right (convex), false = turns left. */
function turns(pts: Pt[]): boolean[] {
  return pts.map((p, i) => {
    const a = pts[(i - 1 + pts.length) % pts.length];
    const b = pts[(i + 1) % pts.length];
    return (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x) > 0;
  });
}

/** Drops corners where the outline runs straight on. */
function corners(pts: Pt[]): Pt[] {
  return pts.filter((p, i) => {
    const a = pts[(i - 1 + pts.length) % pts.length];
    const b = pts[(i + 1) % pts.length];
    return Math.abs((p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x)) > 1e-6;
  });
}

export function layoutForms(l: Layout, setup: FormsSetup = DEFAULT_FORMS): LayoutForms | null {
  const outside = l.graph.outside;
  if (!outside) return null;
  const stock = new Map(setup.fillers.map((f) => [f, Infinity]));
  const hIn = Math.round(l.spec.wall.height * 12);
  const { stack } = stackFor(hIn, setup.heightsIn);
  const tallIn = stack.reduce((s, r) => s + setup.heightsIn[r], 0);
  const out: LayoutForms = { faceFt: 0, sfca: 0, outsideCorners: 0, insideCorners: 0, panels: 0, stack, fillers: new Map(), woodStrips: 0, ties: 0, faces: [] };
  const addFillers = (list: number[]) => list.forEach((f) => out.fillers.set(f, (out.fillers.get(f) ?? 0) + 1));
  const doLoop = (loop: Pt[], where: string, isOutside: boolean) => {
    const pts = corners(loop);
    const convex = turns(pts);
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length];
      const lenIn = Math.round(Math.hypot(q.x - p.x, q.y - p.y) * 12 * 16) / 16;
      out.faceFt += lenIn / 12;
      // What each end of this face takes before the panels start.
      const endTake = (c: boolean) => (isOutside ? (c ? OC_PIECE_IN : INSIDE_CORNER_IN) : c ? INSIDE_CORNER_IN : 0);
      const ends = [convex[i], convex[(i + 1) % pts.length]];
      const lead = isOutside ? ends.filter((c) => c).map(() => OC_PIECE_IN) : [];
      const run = lenIn - endTake(ends[0]) - endTake(ends[1]);
      const face = layoutFace(run, setup.panelIn, stock);
      out.panels += face.panels;
      addFillers([...lead, ...face.fillers]);
      if (face.woodIn) out.woodStrips++;
      if (isOutside) out.ties += (face.panels + face.fillers.length + lead.length + 1) * tiesPerJoint(tallIn);
      out.faces.push({ where, lengthIn: lenIn, panels: face.panels, fillers: [...lead, ...face.fillers], woodIn: face.woodIn });
    });
    for (const c of convex) {
      if (isOutside && c) out.outsideCorners++;
      else if (!isOutside && !c) out.outsideCorners++; // a corner sticking into a room
      else out.insideCorners++;
    }
  };
  doLoop(outside, 'Outside', true);
  l.graph.faces.forEach((f, i) => doLoop(f.clear, roomName(l, i), false));
  out.sfca = out.faceFt * l.spec.wall.height;
  return out;
}

function roomName(l: Layout, i: number): string {
  const sl = l.slabs.find((s) => l.graph.faces.indexOf(s.face) === i);
  return sl ? sl.name.replace(/ slab/, '') : `Area ${i + 1}`;
}

/** The forms as result rows, the way the Wall Forms tool shows them (the job's load list reads these). */
export function formsRows(f: LayoutForms, setup: FormsSetup = DEFAULT_FORMS): ResultRow[] {
  const rows = f.stack.length;
  const heightText = (inch: number) => (inch % 12 ? `${Math.floor(inch / 12)}'${inch % 12}"` : `${inch / 12}'`);
  const tall = f.stack.reduce((s, r) => s + setup.heightsIn[r], 0);
  const panelText = `${setup.panelIn / 12}'`;
  const fillerText = (inch: number) => (inch === 12 ? `1'` : `${inch}"`);
  const out: ResultRow[] = [
    { label: 'Wall height', value: heightText(tall) },
    {
      label: `${panelText} panels`,
      value: commas(f.panels * rows),
      big: true,
      note: [rows > 1 ? f.stack.map((r) => `${commas(f.panels)} × ${heightText(setup.heightsIn[r])}`).join(' + ') : '', `${ftIn(f.faceFt)} of wall face · ${commas(Math.round(f.sfca))} sq ft of contact`]
        .filter(Boolean)
        .join('\n'),
    },
    { label: 'Fillers', value: commas([...f.fillers.values()].reduce((s, n) => s + n, 0) * rows), big: true, note: rows > 1 ? 'of each height' : undefined },
  ];
  for (const [size, n] of [...f.fillers.entries()].sort((a, b) => b[0] - a[0])) out.push({ label: `${fillerText(size)} fillers`, value: commas(n * rows) });
  out.push({ label: 'Inside corners (4×4)', value: commas(f.insideCorners * rows), note: `${f.outsideCorners} outside + ${f.insideCorners} inside corners on the layout` });
  if (f.woodStrips) out.push({ label: 'Wood strips', value: commas(f.woodStrips * rows), note: '1" where a face comes out to an odd inch' });
  out.push({ label: 'Ties', value: `about ${commas(f.ties)}`, note: `${tiesPerJoint(tall)} per joint (one every 16")` });
  return out;
}

