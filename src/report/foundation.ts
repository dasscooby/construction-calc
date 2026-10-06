// Walls, footings and slab in the same job that go together as one foundation (basement, daylight
// basement, stem wall and slab, crawlspace). The app compares their sizes and suggests it; you check
// "They go together" before anything is grouped or adjusted.
//   - Walls (Wall Forms, or Footings & Walls set to Wall) give the house outline: the outside of the wall
//     is the house size.
//   - A footing is entered at the house size too; it runs centered under the wall, so its run is the
//     middle of the wall, a few inches in from the house edge.
//   - A slab measured to the house size is poured inside the walls: an 8" wall takes 16" off each way.
//     The concrete order uses the inside; the bid can use either.
//   - An add-on (Footings & Walls set to Add-on) shares a wall with the house: its width matches a
//     side of the house. Its walls inside tee into the walls they meet. A slab that fits in the add-on
//     is its own pour.

import type { Job } from '../lib/jobs';
import { ftIn } from '../tools/format';
import { parseLength, parseNumber, RawLength, RawWallRow } from '../tools/run';
import { wallOutline } from './geometry';
import { fullRuns, HeightRun } from './heightRuns';
import type { FiguredItem } from './report';

const firstNumber = (v: string) => {
  const m = v.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : 0;
};
const row = (f: FiguredItem, label: string) => (f.result.status === 'ok' ? f.result.result.rows.find((r) => r.label === label) : undefined);
const ok = (f: FiguredItem) => f.result.status === 'ok';
const close = (a: number, b: number, abs: number, pct: number) => Math.abs(a - b) <= Math.max(abs, (Math.max(a, b) * pct) / 100);

export type FoundationKind = 'Basement' | 'Daylight basement' | 'Stem wall and slab' | 'Crawlspace';

export interface AddOn {
  item: FiguredItem;
  kind: 'wall' | 'footing';
  /** Side of the house outline it joins (0 = from corner A) */
  side: number;
  width: number;
  depth: number;
  inside: number;
  inFrom: number;
}

export interface Foundation {
  kind: FoundationKind;
  /** Wall items (more than one when walls step down, like a daylight basement) */
  walls: FiguredItem[];
  footings: FiguredItem[];
  /** Beam & Footing Bars items whose run matches the walls */
  footingBars: FiguredItem[];
  slab: FiguredItem | null;
  /** Add-ons that share a wall with the house (walls and their footings) */
  addOns: AddOn[];
  /** Slabs poured on their own inside an add-on (second pour, third ...) */
  pours: FiguredItem[];
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
  /** The house outline (outside of the walls), walked clockwise, ft; null if the walls don't close */
  outline: { x: number; y: number }[] | null;
  /** The slab was measured to the house size (outside of the walls) */
  slabAtOutside: boolean;
  /** Top of slab below the top of the wall, inches */
  slabDropIn: number;
  /** The slab's concrete order, as measured and as poured inside the walls (yd) */
  slabOrder: { asMeasured: number; inside: number } | null;
  /** Walls that change height (daylight basement), all the way around; null if one height */
  runs: HeightRun[] | null;
  /** Feet the entered heights go past the walls (0 = fine) */
  runsOver: number;
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
  let heightFt = Math.max(...heights);
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
  const footings = items.filter((f) => f.tool.id === 'footings' && f.item.raw.kind !== 'wall' && f.item.raw.shape !== 'addon' && ok(f) && underWalls(f));
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

  // Add-ons whose width matches a side of the house (the side you picked, or the first that matches).
  const addOns: AddOn[] = [];
  if (main) {
    const sides = main.pts.map((p, i) => Math.hypot(main!.pts[(i + 1) % main!.pts.length].x - p.x, main!.pts[(i + 1) % main!.pts.length].y - p.y));
    for (const f of items) {
      const r = f.item.raw;
      if (f.tool.id !== 'footings' || r.shape !== 'addon' || !ok(f)) continue;
      const width = parseLength(r.aWidth as RawLength) ?? 0;
      const picked = Math.max(0, ['ab', 'bc', 'cd', 'da'].indexOf(String(r.side)));
      const fits = (i: number) => i < sides.length && close(sides[i], width, 1, 0);
      const side = fits(picked) ? picked : sides.findIndex((_, i) => fits(i));
      if (side < 0) continue;
      addOns.push({
        item: f,
        kind: r.kind === 'wall' ? 'wall' : 'footing',
        side,
        width,
        depth: parseLength(r.aDepth as RawLength) ?? 0,
        inside: parseNumber(String(r.inWalls ?? '')) ?? 0,
        inFrom: parseLength(r.inFrom as RawLength) ?? 0,
      });
    }
  }
  // Other slabs that fit inside an add-on: poured on their own.
  const room = addOns.filter((a) => a.kind === 'wall').reduce((s, a) => s + a.width * a.depth, 0);
  const pours = room
    ? items.filter((f) => f !== slab && ok(f) && f.tool.id === 'slab' && !!row(f, 'Slab area') && firstNumber(row(f, 'Slab area')!.value) <= room + 4)
    : [];

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

  const ids = [...walls, ...footings, ...footingBars, ...(slab ? [slab] : []), ...addOns.map((a) => a.item), ...pours].map((f) => f.item.id);
  const saved = job?.together?.ids ?? [];
  const confirmed = saved.length === ids.length && ids.every((id) => saved.includes(id));
  // Heights that change around the house (daylight basement), from corner A clockwise.
  let runs: HeightRun[] | null = null;
  let runsOver = 0;
  const hs = job?.together?.heights;
  if (hs && main) {
    const entered = hs.runs
      .map((r) => ({ length: parseLength(r.length) ?? 0, height: parseLength(r.height) ?? 0 }))
      .filter((r) => r.length > 0 && r.height > 0);
    const rest = parseLength(hs.rest) ?? 0;
    const full = fullRuns(outsideFt, entered, rest > 0 ? rest : heightFt);
    runs = full.runs;
    runsOver = full.over;
  }
  const varies = !!runs && new Set(runs.map((r) => r.height)).size > 1;
  if (runs) heightFt = Math.max(heightFt, ...runs.map((r) => r.height));
  const tall = heightFt >= 6;
  const stepped = varies || (walls.length > 1 && Math.max(...heights) - Math.min(...heights) >= 1);
  const anySlab = !!slab || items.some((f) => ok(f) && !!row(f, 'Slab area'));
  const kind: FoundationKind = tall ? (stepped ? 'Daylight basement' : 'Basement') : anySlab ? 'Stem wall and slab' : 'Crawlspace';
  // How far the top of the slab sits below the top of the wall. Blank: a basement slab sits down on the
  // footings (wall height − slab thickness); a stem wall slab at the top.
  const typed = (job?.together?.slabDropIn ?? '').trim();
  const slabThickIn = slab ? (parseLength(slab.item.raw.thick as RawLength) ?? 4 / 12) * 12 : 0;
  const slabDropIn = typed ? parseNumber(typed) ?? 0 : slab && tall ? Math.max(0, Math.round(heightFt * 12 - slabThickIn)) : 0;
  return {
    kind,
    walls,
    footings,
    footingBars,
    slab,
    addOns,
    pours,
    ids,
    confirmed,
    thickFt: t,
    heightFt,
    outsideFt,
    centerFt,
    outsideArea,
    insideArea,
    rect,
    outline: main?.pts ?? null,
    slabAtOutside,
    slabDropIn,
    slabOrder,
    runs,
    runsOver,
  };
}

/** The confirmed foundation (you checked "They go together"), or null. */
export const confirmedFoundation = (items: FiguredItem[], job?: Job): Foundation | null => {
  const f = findFoundation(items, job);
  return f?.confirmed ? f : null;
};

const SIDE_NAMES = ['top', 'right', 'bottom', 'left'];
/** "second pour", "third pour" ... (the first is the main slab) */
export const pourName = (i: number) => `${['second', 'third', 'fourth', 'fifth'][i] ?? `pour ${i + 2}`} pour`;

/** How many pours: footings, walls, the main slab and each slab poured on its own. */
export const pourCount = (f: Foundation) =>
  (f.footings.length || f.footingBars.length || f.addOns.some((a) => a.kind === 'footing') ? 1 : 0) + 1 + (f.slab ? 1 : 0) + f.pours.length;

/** What each piece is and its size, for the "do these go together?" check. */
export function foundationParts(f: Foundation): string[] {
  const t = Math.round(f.thickFt * 12);
  const house = f.rect ? `${ftIn(f.rect.L)} × ${ftIn(f.rect.W)}` : `${ftIn(f.outsideFt)} around`;
  const parts = [`Walls: ${house}, ${t}" thick, ${ftIn(f.heightFt)} tall`];
  for (const x of f.footings) parts.push(`Footing: ${x.item.label || 'Footings & Walls'} (runs ${ftIn(f.centerFt)} under the walls)`);
  for (const x of f.footingBars) parts.push(`Footing bars: ${x.item.label || 'Beam & Footing Bars'}`);
  if (f.slab) parts.push(`Slab: ${f.slab.item.label || f.slab.tool.title}, ${Math.round(f.slabAtOutside ? f.outsideArea : f.insideArea).toLocaleString()} sq ft (${f.slabAtOutside ? 'house size' : 'inside the walls'})`);
  for (const a of f.addOns) parts.push(`Add-on ${a.kind === 'wall' ? 'walls' : 'footing'}: ${ftIn(a.width)} × ${ftIn(a.depth)} on the ${SIDE_NAMES[a.side] ?? 'side'}${a.inside ? `, ${a.inside} inside wall${a.inside > 1 ? 's' : ''}` : ''}`);
  f.pours.forEach((p, i) => parts.push(`Slab, ${pourName(i)}: ${p.item.label || p.tool.title}, ${Math.round(firstNumber(row(p, 'Slab area')?.value ?? '0')).toLocaleString()} sq ft`));
  return parts;
}

/** Plain sentences for the job screen and the crew sheet, once you've said they go together. */
export function foundationLines(f: Foundation, job?: Job): string[] {
  const t = Math.round(f.thickFt * 12);
  const house = f.rect ? `${ftIn(f.rect.L)} × ${ftIn(f.rect.W)}` : `${ftIn(f.outsideFt)} around the outside`;
  const lines = [`Walls: ${house}, ${t}" thick, ${f.runs ? 'height changes' : `${ftIn(f.heightFt)} tall`}`];
  if (f.runs) {
    const by = new Map<number, number>();
    for (const r of f.runs) by.set(r.height, (by.get(r.height) ?? 0) + r.length);
    lines.push(`Wall heights: ${[...by].sort((a, b) => b[0] - a[0]).map(([h, l]) => `${ftIn(l)} at ${ftIn(h)}`).join(', ')}`);
  }
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
  for (const a of f.addOns) {
    const along = firstNumber(row(a.item, 'Along the middle')?.value ?? '0');
    lines.push(
      `Add-on ${a.kind === 'wall' ? 'walls' : 'footing'} on the ${SIDE_NAMES[a.side] ?? 'side'}: ${ftIn(a.width)} wide, out ${ftIn(a.depth)}${a.inside ? `, ${a.inside} wall${a.inside > 1 ? 's' : ''} inside` : ''}. Shares the house wall; ${ftIn(along)} along the middle, stopping where each wall tees in.`,
    );
  }
  f.pours.forEach((p, i) => {
    const order = row(p, 'Order')?.value;
    lines.push(`Slab, ${pourName(i)}: ${Math.round(firstNumber(row(p, 'Slab area')?.value ?? '0')).toLocaleString()} sq ft in the add-on${order ? `, ${order} ordered on its own` : ''}`);
  });
  return lines;
}
