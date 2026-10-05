// Seeing a job's walls, footings and slab as one foundation (basement, daylight basement, stem wall
// and slab, crawlspace) instead of separate pieces:
//   - footings whose run matches the wall's run are the footings under those walls,
//   - a slab whose size matches the walls is the slab inside them. Slabs are often measured to the
//     outside of the walls, but the pour is inside them: an 8" wall takes 16" off each way. The concrete
//     order uses the inside; the bid can use either.

import type { Job } from '../lib/jobs';
import { ftIn } from '../tools/format';
import { parseLength, parseNumber, RawLength, RawWallRow } from '../tools/run';
import { wallOutline } from './geometry';
import type { FiguredItem } from './report';

const firstNumber = (v: string) => {
  const m = v.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : 0;
};
const row = (f: FiguredItem, label: string) => (f.result.status === 'ok' ? f.result.result.rows.find((r) => r.label === label) : undefined);
const ok = (f: FiguredItem) => f.result.status === 'ok';
const close = (a: number, b: number, abs: number, pct: number) => Math.abs(a - b) <= Math.max(abs, (Math.max(a, b) * pct) / 100);

export type FoundationKind = 'Basement' | 'Daylight basement' | 'Stem wall and slab' | 'Crawlspace';

export interface Foundation {
  kind: FoundationKind;
  /** Wall Forms items (more than one when walls step down, like a daylight basement) */
  walls: FiguredItem[];
  footings: FiguredItem[];
  /** Beam & Footing Bars items whose run matches the walls */
  footingBars: FiguredItem[];
  slab: FiguredItem | null;
  thickFt: number;
  heightFt: number;
  /** Around the outside of the walls, ft */
  outsideFt: number;
  /** Along the middle of the walls (what footings and bars run), ft */
  centerFt: number;
  outsideArea: number;
  insideArea: number;
  /** Outside length and width when the walls are a plain rectangle */
  rect: { L: number; W: number } | null;
  /** The slab was measured to the outside of the walls */
  slabAtOutside: boolean;
  /** The slab's concrete order, as measured and as poured inside the walls (yd) */
  slabOrder: { asMeasured: number; inside: number } | null;
}

function shoelace(pts: { x: number; y: number }[]): number {
  let a = 0;
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  });
  return Math.abs(a) / 2;
}

export function findFoundation(items: FiguredItem[]): Foundation | null {
  const walls = items.filter((f) => f.tool.id === 'wall-forms' && ok(f));
  if (!walls.length) return null;
  // The wall item that closes into a building outline.
  let main: { f: FiguredItem; pts: { x: number; y: number }[]; rows: { length: number; ends: RawWallRow['ends'] }[] } | null = null;
  for (const f of walls) {
    const rows = ((f.item.raw.walls as RawWallRow[]) ?? []).map((r) => ({ length: parseLength(r.length) ?? 0, ends: r.ends })).filter((r) => r.length > 0);
    const o = wallOutline(rows);
    if (o?.closed) {
      const pts = o.points;
      const last = pts[pts.length - 1];
      // Drop a closing point that repeats the first corner.
      main = { f, pts: pts.length > 1 && Math.hypot(last.x - pts[0].x, last.y - pts[0].y) < 1e-6 ? pts.slice(0, -1) : pts, rows };
      break;
    }
  }
  const raw = (main?.f ?? walls[0]).item.raw;
  const t = (parseNumber(String(raw.thick)) ?? 8) / 12;
  const height = (f: FiguredItem) => (parseLength(f.item.raw.height1 as RawLength) ?? 0) + (parseLength(f.item.raw.height2 as RawLength) ?? 0);
  const heights = walls.map(height);
  const heightFt = Math.max(...heights);
  const outsideFt = main ? main.rows.reduce((s, r) => s + r.length, 0) : walls.reduce((s, f) => s + ((f.item.raw.walls as RawWallRow[]) ?? []).reduce((a, r) => a + (parseLength(r.length) ?? 0), 0), 0);
  // A closed foundation has 4 more outside corners than inside: the middle of the wall is 4 thicknesses shorter.
  const centerFt = main ? outsideFt - 4 * t : outsideFt;
  const outsideArea = main ? shoelace(main.pts) : 0;
  // Offsetting a square-cornered outline in by t: area − perimeter × t + 4t².
  const insideArea = main ? outsideArea - outsideFt * t + 4 * t * t : 0;
  const rect =
    main && main.rows.length === 4 && main.rows.every((r) => r.ends === 'oo') ? { L: main.rows[0].length, W: main.rows[1].length } : null;

  const runOf = (f: FiguredItem) => {
    if (f.tool.id === 'footings') {
      const mid = row(f, 'Along the middle');
      return mid ? firstNumber(mid.value) : (parseLength(f.item.raw.length as RawLength) ?? 0) * (Number(f.item.raw.qty) || 1);
    }
    if (f.tool.id === 'beam-bars') return parseLength(f.item.raw.run as RawLength) ?? 0;
    return 0;
  };
  const underWalls = (f: FiguredItem) => {
    const run = runOf(f);
    return run > 0 && (close(run, centerFt, 2, 3) || close(run, outsideFt, 2, 3));
  };
  const footings = items.filter((f) => f.tool.id === 'footings' && ok(f) && underWalls(f));
  const footingBars = items.filter((f) => f.tool.id === 'beam-bars' && ok(f) && underWalls(f));

  // A slab the size of the walls: measured to the outside, or already to the inside.
  let slab: FiguredItem | null = null;
  let slabAtOutside = false;
  if (main) {
    for (const f of items) {
      const a = row(f, 'Slab area');
      if (!ok(f) || !a) continue;
      const area = firstNumber(a.value);
      if (close(area, outsideArea, 4, 0.5)) {
        slab = f;
        slabAtOutside = true;
        break;
      }
      if (close(area, insideArea, 4, 0.5)) {
        slab = f;
        break;
      }
    }
  }

  let slabOrder: Foundation['slabOrder'] = null;
  if (slab && slabAtOutside) {
    const thick = parseLength(slab.item.raw.thick as RawLength) ?? 4 / 12;
    const waste = slab.item.raw.waste === '' ? 0 : parseNumber(String(slab.item.raw.waste)) ?? 10;
    const withWaste = firstNumber(row(slab, 'Cubic yards')?.value ?? '0');
    const asMeasured = firstNumber(row(slab, 'Order')?.value ?? '0');
    const less = ((outsideArea - insideArea) * thick * (1 + waste / 100)) / 27;
    slabOrder = { asMeasured, inside: Math.ceil(Math.max(0, withWaste - less) * 4 - 1e-9) / 4 };
  }

  // Walls alone aren't enough to call it a foundation: something has to line up with them.
  if (!footings.length && !footingBars.length && !slab) return null;
  const tall = heightFt >= 6;
  const stepped = walls.length > 1 && Math.max(...heights) - Math.min(...heights) >= 1;
  const anySlab = !!slab || items.some((f) => ok(f) && !!row(f, 'Slab area'));
  const kind: FoundationKind = tall ? (stepped ? 'Daylight basement' : 'Basement') : anySlab ? 'Stem wall and slab' : 'Crawlspace';
  return { kind, walls, footings, footingBars, slab, thickFt: t, heightFt, outsideFt, centerFt, outsideArea, insideArea, rect, slabAtOutside, slabOrder };
}

/** Plain sentences for the job screen and the crew sheet. */
export function foundationLines(f: Foundation, job?: Job): string[] {
  const t = Math.round(f.thickFt * 12);
  const lines = [`Walls: ${t}" thick, ${ftIn(f.heightFt)} tall, ${ftIn(f.outsideFt)} around the outside`];
  if (f.footings.length) lines.push(`Footings under the walls (${ftIn(f.centerFt)} along the middle of the walls)`);
  if (f.footingBars.length) lines.push('Footing bars run with the walls');
  if (f.slab) {
    if (f.slabAtOutside) {
      const inside = f.rect ? `${ftIn(f.rect.L - 2 * f.thickFt)} × ${ftIn(f.rect.W - 2 * f.thickFt)}` : '';
      lines.push(
        `Slab measured to the outside of the walls (${Math.round(f.outsideArea).toLocaleString()} sq ft). Inside the walls it's ${inside ? `${inside}, ` : ''}${Math.round(f.insideArea).toLocaleString()} sq ft: ${t * 2}" less each way.`,
      );
      if (f.slabOrder && f.slabOrder.inside < f.slabOrder.asMeasured) {
        lines.push(`Slab concrete is ordered for the inside: ${f.slabOrder.inside.toFixed(2)} yd, not ${f.slabOrder.asMeasured.toFixed(2)}.`);
      }
      if (job) lines.push(`Bid the slab at the ${job.slabBid === 'inside' ? 'inside (what you pour)' : 'outside (as measured)'}`);
    } else {
      lines.push('Slab inside the walls');
    }
  }
  return lines;
}
