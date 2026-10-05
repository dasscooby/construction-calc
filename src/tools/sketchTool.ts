// Layout Sketch: lines walked point to point (A → B → C ...), square turns unless you say otherwise.
// Pick any two points for the board or string line between them: its length, how far over and across,
// and the angle it meets the lines at. Shows where the shape would close back to A.

import { deg as degText, ftIn } from './format';
import { ChoiceField, ResultRow, SketchRow, Tool } from './types';

export interface Pt {
  x: number;
  y: number;
}

export const POINT_NAMES = 'ABCDEFGHIJKLMNOP'.split('');
export const pointName = (i: number) => POINT_NAMES[i] ?? `P${i + 1}`;

/** Heading of each line, degrees, measured clockwise from "right" (y points down, like the drawing). */
export function headings(rows: SketchRow[]): number[] {
  let h = 0;
  return rows.map((r, i) => {
    if (i > 0) h += r.turn === 'R' ? r.deg : r.turn === 'L' ? -r.deg : 0;
    return h;
  });
}

export function sketchPoints(rows: SketchRow[]): Pt[] {
  const pts: Pt[] = [{ x: 0, y: 0 }];
  headings(rows).forEach((h, i) => {
    const a = (h * Math.PI) / 180;
    const p = pts[pts.length - 1];
    pts.push({ x: p.x + rows[i].length * Math.cos(a), y: p.y + rows[i].length * Math.sin(a) });
  });
  return pts;
}

/** Angle between two directions, 0–180°. */
function between(ax: number, ay: number, bx: number, by: number): number {
  const c = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by));
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
}

/** Turn from one heading to another, −180..180 (+ = right). */
const turnBetween = (from: number, to: number) => {
  let t = to - from;
  while (t > 180) t -= 360;
  while (t <= -180) t += 360;
  return t;
};

const pointChoice = (key: string, label: string, def: string): ChoiceField => ({
  key,
  label,
  kind: 'choice',
  options: POINT_NAMES.map((p) => ({ value: p, label: p })),
  default: def,
});

const SIXTEENTH_FT = 1 / 192;

export const layoutSketch: Tool = {
  id: 'layout-sketch',
  title: 'Layout Sketch',
  blurb: 'Lines point to point: diagonals, angles, close it up',
  fields: [
    {
      key: 'lines',
      label: 'Lines',
      kind: 'sketch',
      help: 'Start at A. Give each line its length and which way it turns off the last one. Turns are square (90°) unless you type an angle.',
    },
    pointChoice('from', 'Measure from', 'A'),
    pointChoice('to', 'To', 'C'),
  ],
  compute: (inp) => {
    const rows = inp.sketch('lines');
    const pts = sketchPoints(rows);
    const last = pts.length - 1;
    const fi = POINT_NAMES.indexOf(inp.choice('from'));
    const ti = POINT_NAMES.indexOf(inp.choice('to'));
    if (fi > last || ti > last) return { error: `Point ${fi > last ? inp.choice('from') : inp.choice('to')} isn’t on the sketch yet. You have A to ${pointName(last)}.` };
    if (fi === ti) return { error: 'Pick two different points.' };

    const a = pts[fi];
    const b = pts[ti];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    const name = `${pointName(fi)} to ${pointName(ti)}`;
    const rowsOut: ResultRow[] = [{ label: name, value: ftIn(dist), big: true, note: 'Point to point' }];

    // How far over and across, measured along the first line (A–B) and square off it.
    const h0 = (headings(rows)[0] * Math.PI) / 180;
    const along = dx * Math.cos(h0) + dy * Math.sin(h0);
    const across = -dx * Math.sin(h0) + dy * Math.cos(h0);
    if (Math.abs(along) > SIXTEENTH_FT && Math.abs(across) > SIXTEENTH_FT) {
      rowsOut.push({ label: 'Over and across', value: `${ftIn(Math.abs(along))} × ${ftIn(Math.abs(across))}`, note: 'Along A–B, and square off it' });
    }

    // The angle the board meets a line at each end, and the saw setting to cut it to sit flat.
    const atEnd = (i: number, toward: Pt) => {
      const line = i < last ? { j: i + 1 } : { j: i - 1 };
      const p = pts[i];
      const q = pts[line.j];
      const ang = between(q.x - p.x, q.y - p.y, toward.x - p.x, toward.y - p.y);
      const meets = Math.min(ang, 180 - ang);
      return { text: `${pointName(i)}–${pointName(line.j)}`, ang: meets };
    };
    for (const [i, other] of [
      [fi, b],
      [ti, a],
    ] as const) {
      const e = atEnd(i, other);
      if (e.ang > 0.05 && e.ang < 89.95) {
        rowsOut.push({ label: `Angle at ${pointName(i)}`, value: degText(e.ang), note: `Off line ${e.text} · miter saw ${degText(90 - e.ang)}` });
      } else if (Math.abs(e.ang - 90) <= 0.05) {
        rowsOut.push({ label: `Angle at ${pointName(i)}`, value: '90°', note: `Square to line ${e.text}` });
      }
    }

    // Back to the start: closed, or the line that would close it.
    const measuringClose = (fi === 0 && ti === last) || (ti === 0 && fi === last);
    if (rows.length >= 2 && !measuringClose) {
      const end = pts[last];
      const gap = Math.hypot(end.x, end.y);
      if (gap < SIXTEENTH_FT) {
        rowsOut.push({ label: 'Closes', value: `Yes, back at A`, note: `${rows.length} lines` });
      } else {
        const hs = headings(rows);
        const closing = (Math.atan2(-end.y, -end.x) * 180) / Math.PI;
        const t = turnBetween(hs[hs.length - 1], closing);
        const turn = Math.abs(t) < 0.05 ? 'straight on' : `turn ${t > 0 ? 'right' : 'left'} ${degText(Math.abs(t))}`;
        rowsOut.push({ label: `${pointName(last)} back to A`, value: ftIn(gap), note: `To close it: ${turn} after ${pointName(last - 1)}–${pointName(last)}` });
      }
    }

    // Every diagonal, for checking a layout.
    // Closed: the last point is A again, and the last point before it sits next to A.
    const closed = rows.length >= 3 && Math.hypot(pts[last].x, pts[last].y) < SIXTEENTH_FT;
    const m = closed ? last : pts.length;
    const diags: string[] = [];
    for (let i = 0; i < m && m <= 9; i++) {
      for (let j = i + 2; j < m; j++) {
        if (closed && i === 0 && j === m - 1) continue; // a side, not a diagonal
        diags.push(`${pointName(i)}–${pointName(j)} ${ftIn(Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y))}`);
      }
    }
    if (diags.length > 1) rowsOut.push({ label: 'All diagonals', value: String(diags.length), note: diags.join(' · ') });
    rowsOut.push({ label: 'Total of the lines', value: ftIn(rows.reduce((s, r) => s + r.length, 0)) });
    return { rows: rowsOut };
  },
  notes: ['Measure each line on the same face (all inside, or all outside).'],
};
