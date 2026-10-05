// Walls, footings and slab in the same job that go together as one foundation (basement, daylight
// basement, stem wall and slab, crawlspace). The app compares their sizes and suggests it; you check
// "They go together" before anything is grouped or adjusted.
//   - Walls (Wall Forms, or Footings & Walls set to Wall) give the house outline: the outside of the wall
//     is the house size.
//   - A footing is entered at the house size too; it runs centered under the wall, so its run is the
//     middle of the wall, a few inches in from the house edge.
//   - A slab measured to the house size is poured inside the walls: an 8" wall takes 16" off each way.
//     The concrete order uses the inside; the bid can use either.

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
  /** Wall items (more than one when walls step down, like a daylight basement) */
  walls: FiguredItem[];
  footings: FiguredItem[];
  /** Beam & Footing Bars items whose run matches the walls */
  footingBars: FiguredItem[];
  slab: FiguredItem | null;
  /** Every item that goes together */
  ids: string[];
  /** You checked "They go together" (for these exact items) */
  confirmed: boolean;
  thickFt: number;
  heightFt: number;
  /** Around the outside of the walls (the house), ft */
  outsideFt: number;
  /** Along the middle of the walls (what footings and bars run), ft */
  centerFt: number;
  outsideArea: number;
  insideArea: number;
  /** House length and width when it's a plain rectangle */
  rect: { L: number; W: number } | null;
  /** The slab was measured to the house size (outside of the walls) */
  slabAtOutside: boolean;
  /** Top of slab below the top of the wall, inches */
  slabDropIn: number;
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

type WallRows = { length: number; ends: RawWallRow['ends'] }[];

/** A wall item's outline rows, thickness and height (Wall Forms, or Footings & Walls set to Wall). */
function wallInfo(f: FiguredItem): { rows: WallRows; thickFt: number; heightFt: number } | null {
  const raw = f.item.raw;
  const len = (v: unknown) => parseLength(v as RawLength) ?? 0;
  const fromWalls = (): WallRows => ((raw.walls as RawWallRow[]) ?? []).map((r) => ({ length: parseLength(r.length) ?? 0, ends: r.ends })).filter((r) => r.length > 0);
  if (f.tool.id === 'wall-forms') {
    return { rows: fromWalls(), thickFt: (parseNumber(String(raw.thick)) ?? 8) / 12, heightFt: len(raw.height1) + len(raw.height2) };
  }
  if (f.tool.id === 'footings' && raw.kind === 'wall' && (raw.shape === 'rect' || raw.shape === 'odd')) {
    const rows = raw.shape === 'rect' ? [len(raw.bLength), len(raw.bWidth), len(raw.bLength), len(raw.bWidth)].map((length) => ({ length, ends: 'oo' as const })) : fromWalls();
    return { rows, thickFt: len(raw.width), heightFt: len(raw.depth) };
  }
  return null;
}

export function findFoundation(items: FiguredItem[], job?: Job): Foundation | null {
  const walls = items.filter((f) => ok(f) && wallInfo(f));
  if (!walls.length) return null;
  // The wall item that closes into the house outline.
  let main: { f: FiguredItem; pts: { x: number; y: number }[]; rows: WallRows; thickFt: number } | null = null;
  for (const f of walls) {
    const w = wallInfo(f)!;
    const o = wallOutline(w.rows);
    if (o?.closed) {
      const pts = o.points;
      const last = pts[pts.length - 1];
      // Drop a closing point that repeats the first corner.
      main = { f, pts: pts.length > 1 && Math.hypot(last.x - pts[0].x, last.y - pts[0].y) < 1e-6 ? pts.slice(0, -1) : pts, rows: w.rows, thickFt: w.thickFt };
      break;
    }
  }
  const t = main?.thickFt ?? wallInfo(walls[0])!.thickFt;
  const heights = walls.map((f) => wallInfo(f)!.heightFt);
  const heightFt = Math.max(...heights);
  const outsideFt = main ? main.rows.reduce((s, r) => s + r.length, 0) : walls.reduce((s, f) => s + wallInfo(f)!.rows.reduce((a, r) => a + r.length, 0), 0);
  // A closed foundation has 4 more outside corners than inside: the middle of the wall is 4 thicknesses shorter.
  const centerFt = main ? outsideFt - 4 * t : outsideFt;
  const outsideArea = main ? shoelace(main.pts) : 0;
  // Offsetting a square-cornered outline in by t: area − perimeter × t + 4t².
  const insideArea = main ? outsideArea - outsideFt * t + 4 * t * t : 0;
  const rect = main && main.rows.length === 4 && main.rows.every((r) => r.ends === 'oo') ? { L: main.rows[0].length, W: main.rows[1].length } : null;

  // Footings: their run (the middle, under the wall) or the house size they were entered at.
  const runOf = (f: FiguredItem) => {
    if (f.tool.id === 'footings') {
      const mid = row(f, 'Along the middle');
      return mid ? firstNumber(mid.value) : (parseLength(f.item.raw.length as RawLength) ?? 0) * (Number(f.item.raw.qty) || 1);
    }
    if (f.tool.id === 'beam-bars') return parseLength(f.item.raw.run as RawLength) ?? 0;
    return 0;
  };
  const houseOf = (f: FiguredItem) => {
    const h = row(f, 'House, around the outside');
    return h ? firstNumber(h.value) : 0;
  };
  const underWalls = (f: FiguredItem) => {
    const run = runOf(f);
    return (run > 0 && (close(run, centerFt, 2, 3) || close(run, outsideFt, 2, 3))) || close(houseOf(f), outsideFt, 1, 0.5);
  };
  const footings = items.filter((f) => f.tool.id === 'footings' && f.item.raw.kind !== 'wall' && ok(f) && underWalls(f));
  const footingBars = items.filter((f) => f.tool.id === 'beam-bars' && ok(f) && underWalls(f));

  // A slab the size of the house (measured to the outside of the walls), or of the inside.
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

  // Walls alone aren't a foundation: something has to line up with them.
  if (!footings.length && !footingBars.length && !slab) return null;

  let slabOrder: Foundation['slabOrder'] = null;
  if (slab && slabAtOutside) {
    const thick = parseLength(slab.item.raw.thick as RawLength) ?? 4 / 12;
    const waste = slab.item.raw.waste === '' ? 0 : parseNumber(String(slab.item.raw.waste)) ?? 10;
    const withWaste = firstNumber(row(slab, 'Cubic yards')?.value ?? '0');
    const asMeasured = firstNumber(row(slab, 'Order')?.value ?? '0');
    const less = ((outsideArea - insideArea) * thick * (1 + waste / 100)) / 27;
    slabOrder = { asMeasured, inside: Math.ceil(Math.max(0, withWaste - less) * 4 - 1e-9) / 4 };
  }

  const ids = [...walls, ...footings, ...footingBars, ...(slab ? [slab] : [])].map((f) => f.item.id);
  const saved = job?.together?.ids ?? [];
  const confirmed = saved.length === ids.length && ids.every((id) => saved.includes(id));
  const tall = heightFt >= 6;
  const stepped = walls.length > 1 && Math.max(...heights) - Math.min(...heights) >= 1;
  const anySlab = !!slab || items.some((f) => ok(f) && !!row(f, 'Slab area'));
  const kind: FoundationKind = tall ? (stepped ? 'Daylight basement' : 'Basement') : anySlab ? 'Stem wall and slab' : 'Crawlspace';
  const slabDropIn = parseNumber(job?.together?.slabDropIn ?? '') ?? 0;
  return {
    kind,
    walls,
    footings,
    footingBars,
    slab,
    ids,
    confirmed,
    thickFt: t,
    heightFt,
    outsideFt,
    centerFt,
    outsideArea,
    insideArea,
    rect,
    slabAtOutside,
    slabDropIn,
    slabOrder,
  };
}

/** The confirmed foundation (you checked "They go together"), or null. */
export const confirmedFoundation = (items: FiguredItem[], job?: Job): Foundation | null => {
  const f = findFoundation(items, job);
  return f?.confirmed ? f : null;
};

/** What each piece is and its size, for the "do these go together?" check. */
export function foundationParts(f: Foundation): string[] {
  const t = Math.round(f.thickFt * 12);
  const house = f.rect ? `${ftIn(f.rect.L)} × ${ftIn(f.rect.W)}` : `${ftIn(f.outsideFt)} around`;
  const parts = [`Walls: ${house}, ${t}" thick, ${ftIn(f.heightFt)} tall`];
  for (const x of f.footings) parts.push(`Footing: ${x.item.label || 'Footings & Walls'} (runs ${ftIn(f.centerFt)} under the walls)`);
  for (const x of f.footingBars) parts.push(`Footing bars: ${x.item.label || 'Beam & Footing Bars'}`);
  if (f.slab) parts.push(`Slab: ${f.slab.item.label || f.slab.tool.title}, ${Math.round(f.slabAtOutside ? f.outsideArea : f.insideArea).toLocaleString()} sq ft (${f.slabAtOutside ? 'house size' : 'inside the walls'})`);
  return parts;
}

/** Plain sentences for the job screen and the crew sheet, once you've said they go together. */
export function foundationLines(f: Foundation, job?: Job): string[] {
  const t = Math.round(f.thickFt * 12);
  const house = f.rect ? `${ftIn(f.rect.L)} × ${ftIn(f.rect.W)}` : `${ftIn(f.outsideFt)} around the outside`;
  const lines = [`Walls: ${house}, ${t}" thick, ${ftIn(f.heightFt)} tall`];
  if (f.footings.length) lines.push(`Footings centered under the walls: ${ftIn(f.centerFt)} along the middle, in from the house edge`);
  if (f.footingBars.length) lines.push('Footing bars run with the walls');
  if (f.slab) {
    if (f.slabAtOutside) {
      const inside = f.rect ? `${ftIn(f.rect.L - 2 * f.thickFt)} × ${ftIn(f.rect.W - 2 * f.thickFt)}` : '';
      lines.push(
        `Slab measured to the house (${Math.round(f.outsideArea).toLocaleString()} sq ft). Inside the walls it's ${inside ? `${inside}, ` : ''}${Math.round(f.insideArea).toLocaleString()} sq ft: ${t * 2}" less each way.`,
      );
      if (f.slabOrder && f.slabOrder.inside < f.slabOrder.asMeasured) {
        lines.push(`Slab concrete is ordered for the inside: ${f.slabOrder.inside.toFixed(2)} yd, not ${f.slabOrder.asMeasured.toFixed(2)}.`);
      }
    } else {
      lines.push('Slab inside the walls');
    }
    if (f.slabDropIn > 0) lines.push(`Top of slab ${f.slabDropIn}" below the top of the wall`);
    if (job && f.slabAtOutside) lines.push(`Bid the slab at the ${job.slabBid === 'inside' ? 'inside (what you pour)' : 'house size (as measured)'}`);
  }
  return lines;
}
