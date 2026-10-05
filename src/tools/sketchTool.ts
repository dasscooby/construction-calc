// Layout Sketch: draw the layout with your finger, type the lengths you know, and the app squares it
// up: lines drawn close to level or plumb become level or plumb, corners close to square become square,
// and angled lines (braces, cut corners) just take their length and run point to point.
// Lines you didn't measure are figured from the ones you did.

import { solvePad } from '../lib/padSolve';
import { deg as degText, ftIn } from './format';
import { ResultRow, Tool } from './types';

export const pointName = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `P${i + 1}`);
export const lineName = (a: number, b: number) => `${pointName(a)}–${pointName(b)}`;

export const layoutSketch: Tool = {
  id: 'layout-sketch',
  title: 'Layout Sketch',
  blurb: 'Draw it, add the lengths, it squares it up',
  fields: [
    {
      key: 'sketch',
      label: 'Draw it',
      kind: 'pad',
      help: 'Tap to put down points. Each tap draws a line from the last point. Tap a point to start from it, or to close the shape. Then type the lengths you know.',
    },
  ],
  compute: (inp) => {
    const pad = inp.pad('sketch');
    if (!pad || !pad.edges.length) return { error: 'Draw your lines on the pad.' };
    if (!pad.edges.some((e) => e.length)) return { error: 'Type the length of at least one line.' };
    const s = solvePad(pad.points, pad.edges);
    const P = s.points;
    const rows: ResultRow[] = [];
    const warnings: string[] = [];

    s.edges.forEach((e, i) => {
      const name = lineName(e.a, e.b);
      let note = e.measured ? 'Measured' : e.sure ? 'Figured from your measurements' : 'From your sketch. Measure it to be exact.';
      // Angled lines: the angle it meets the next line at, and the saw setting to cut it to sit flat.
      const held = e.axis || s.square.some(([x, y]) => x === i || y === i);
      if (!held) {
        const other = s.edges.find((o, j) => j !== i && (o.a === e.a || o.b === e.a));
        if (other) {
          const far = other.a === e.a ? other.b : other.a;
          const ux = P[e.b].x - P[e.a].x;
          const uy = P[e.b].y - P[e.a].y;
          const vx = P[far].x - P[e.a].x;
          const vy = P[far].y - P[e.a].y;
          const c = (ux * vx + uy * vy) / ((Math.hypot(ux, uy) || 1) * (Math.hypot(vx, vy) || 1));
          const ang = (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
          const meets = Math.min(ang, 180 - ang);
          if (meets > 0.05 && meets < 89.95) note += ` · ${degText(meets)} off ${lineName(e.a, far)} · miter saw ${degText(90 - meets)}`;
        }
      }
      rows.push({ label: name, value: ftIn(e.length), note, big: !e.measured && e.sure });
    });

    for (const m of s.misfit) {
      const e = s.edges[m.edge];
      warnings.push(
        `The lengths don’t fit together: ${lineName(e.a, e.b)} works out to ${ftIn(e.length)}, not ${ftIn(e.length - m.off)}. Check that measurement, or whether a corner isn’t square.`,
      );
    }
    if (s.edges.some((e) => !e.measured && !e.sure)) warnings.push('Some lines are only from your sketch. Measure one more line and they’ll be exact.');

    // Lines with no answer yet go first, so the one you're after is on top.
    rows.sort((x, y) => Number(!!y.big) - Number(!!x.big));
    const total = s.edges.reduce((t, e) => t + e.length, 0);
    rows.push({ label: 'All lines together', value: ftIn(total) });
    return { rows, warnings };
  },
  notes: ['Lines drawn close to level or plumb come out exactly level or plumb. Corners drawn close to square come out square.'],
};
