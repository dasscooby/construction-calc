// Rebar math: bar sizes, laps, hooks, how many bars fit, and how many stock bars to buy.
// Lengths are in FEET unless the name ends in "In" (inches).

/** Tiny allowance so 13.000000001 spaces doesn't round up to 14 because of floating point. */
const EPS = 1e-9;

export const LB_PER_TON = 2000;

/** One standard US rebar size. The bar number is the diameter in eighths of an inch (#4 = 4/8 = 1/2"). */
export interface Bar {
  size: number; // 4 means #4
  diaIn: number; // nominal diameter, inches
  areaSqIn: number; // cross-section area, square inches
  lbPerFt: number; // weight, pounds per foot
}

/**
 * Inch-pound bar sizes #3–#11.
 * Source: ASTM A615/A615M Table 1 (nominal weights and dimensions of deformed bars); the CRSI
 * Manual of Standard Practice and supplier charts list the same numbers. Checked 2026-10.
 */
export const BARS: readonly Bar[] = [
  { size: 3, diaIn: 0.375, areaSqIn: 0.11, lbPerFt: 0.376 },
  { size: 4, diaIn: 0.5, areaSqIn: 0.2, lbPerFt: 0.668 },
  { size: 5, diaIn: 0.625, areaSqIn: 0.31, lbPerFt: 1.043 },
  { size: 6, diaIn: 0.75, areaSqIn: 0.44, lbPerFt: 1.502 },
  { size: 7, diaIn: 0.875, areaSqIn: 0.6, lbPerFt: 2.044 },
  { size: 8, diaIn: 1.0, areaSqIn: 0.79, lbPerFt: 2.67 },
  { size: 9, diaIn: 1.128, areaSqIn: 1.0, lbPerFt: 3.4 },
  { size: 10, diaIn: 1.27, areaSqIn: 1.27, lbPerFt: 4.303 },
  { size: 11, diaIn: 1.41, areaSqIn: 1.56, lbPerFt: 5.313 },
];

/** getBar(5) or getBar('5') → the #5 bar. */
export function getBar(size: number | string): Bar {
  const n = Number(String(size).replace('#', ''));
  const bar = BARS.find((b) => b.size === n);
  if (!bar) throw new Error(`Unknown bar size #${size}`);
  return bar;
}

export const weightLb = (bar: Bar, ft: number) => ft * bar.lbPerFt;

// ---------------------------------------------------------------------------------------------
// Laps

/**
 * Lap used when the lap box is left blank: 40 bar diameters (#3 15", #4 20", #5 25", #6 30").
 * 40 diameters matches the IRC concrete-wall lap table for Grade 40 steel (IRC Table R608.5.4(1):
 * #4 20", #5 25", #6 30"). For Grade 60 steel that same table asks for about 60 diameters
 * (#4 30", #5 38", #6 45"). The plans always win.
 */
export const DEFAULT_LAP_DIAMETERS = 40;

/** Lap in inches: `diameters` bar diameters (40 unless told otherwise). */
export function lapIn(bar: Bar, diameters = DEFAULT_LAP_DIAMETERS): number {
  return bar.diaIn * diameters;
}

// ---------------------------------------------------------------------------------------------
// Counting things along a line

/**
 * How many bars (or chairs, ties, bolts) go along a distance with one at each end and none
 * farther apart than the spacing: spaces = distance ÷ spacing, rounded UP, plus one.
 * Use the same units for both numbers.
 *   234" at 18" = 13 spaces → 14 bars.   240" at 18" = 13.3 → 14 spaces → 15 bars.
 * Rounding up keeps the spacing at or under what was asked for, with the last bar at the far end.
 */
export function countAlong(distance: number, maxSpacing: number): number {
  if (!(maxSpacing > 0)) throw new Error('Spacing must be more than 0');
  if (distance <= 0) return 1;
  return Math.ceil(distance / maxSpacing - EPS) + 1;
}

/**
 * Anchor bolts or dowels along one wall: one within the end distance of each end, none farther
 * apart than the spacing, and never fewer than 2 (IRC R403.1.6: at least two bolts per plate section).
 *   30' wall, 6' spacing, 12" from the ends: (30 − 2) ÷ 6 = 4.67 → 5 spaces → 6 bolts.
 */
export function anchorsPerWall(wallFt: number, spacingFt: number, endFt: number): number {
  return Math.max(2, countAlong(wallFt - 2 * endFt, spacingFt));
}

// ---------------------------------------------------------------------------------------------
// Runs longer than one stock bar

/**
 * Stock bars laid end to end (lapped) to cover one run. Every bar after the first adds
 * (stock − lap) of reach, so pieces = (run − lap) ÷ (stock − lap), rounded up.
 *   50' run, 20' bars, 25" lap: (50 − 2.08) ÷ (20 − 2.08) = 2.67 → 3 bars, 2 laps.
 */
export function piecesPerRun(runFt: number, stockFt: number, lapFt: number): number {
  if (lapFt >= stockFt) throw new Error('The lap must be shorter than the stock bar');
  if (runFt <= stockFt + EPS) return 1;
  return Math.ceil((runFt - lapFt) / (stockFt - lapFt) - EPS);
}

export interface RunPlan {
  runFt: number;
  /** Stock bars in the run */
  pieces: number;
  /** pieces − 1 */
  laps: number;
  /** Steel in one run, laps included: run + laps × lap */
  barFt: number;
  /** The run is (pieces − 1) full stock bars plus one cut piece this long */
  tailFt: number;
}

export function planRun(runFt: number, stockFt: number, lapFt: number): RunPlan {
  const pieces = piecesPerRun(runFt, stockFt, lapFt);
  const laps = pieces - 1;
  const barFt = runFt + laps * lapFt;
  return { runFt, pieces, laps, barFt, tailFt: barFt - laps * stockFt };
}

export interface PieceGroup {
  lengthFt: number;
  count: number;
}

/**
 * Whole stock bars needed to cut a list of pieces (each piece no longer than a stock bar).
 * Longest pieces are cut first; a later piece is cut from the shortest leftover it fits in,
 * and a new stock bar is started only when no leftover is long enough.
 *   10 pieces of 6' from 20' bars: 3 per bar → 4 bars.
 */
export function sticksToCut(groups: PieceGroup[], stockFt: number): number {
  const leftovers: { ft: number; n: number }[] = [];
  let sticks = 0;
  const sorted = groups.filter((g) => g.count > 0 && g.lengthFt > EPS).sort((a, b) => b.lengthFt - a.lengthFt);
  for (const g of sorted) {
    const len = g.lengthFt;
    if (len > stockFt + EPS) throw new Error('A piece is longer than the stock bar');
    let need = g.count;
    const cut: { ft: number; n: number }[] = [];
    leftovers.sort((a, b) => a.ft - b.ft);
    for (const lo of leftovers) {
      if (need === 0) break;
      const per = Math.floor(lo.ft / len + EPS);
      if (per === 0 || lo.n === 0) continue;
      const used = Math.min(lo.n, Math.floor(need / per));
      if (used) {
        lo.n -= used;
        need -= used * per;
        cut.push({ ft: lo.ft - per * len, n: used });
      }
      if (need > 0 && need < per && lo.n > 0) {
        lo.n -= 1;
        cut.push({ ft: lo.ft - need * len, n: 1 });
        need = 0;
      }
    }
    if (need > 0) {
      const per = Math.floor(stockFt / len + EPS);
      const full = Math.floor(need / per);
      const rest = need - full * per;
      sticks += full + (rest ? 1 : 0);
      if (full) cut.push({ ft: stockFt - per * len, n: full });
      if (rest) cut.push({ ft: stockFt - rest * len, n: 1 });
    }
    for (const c of cut) if (c.ft > EPS) leftovers.push(c);
  }
  return sticks;
}

/** One way of cutting a stock bar, and how many stock bars get cut that way. */
export interface CutPattern {
  /** Piece lengths cut from one stock bar, longest first (inches) */
  piecesIn: number[];
  /** Stock bars cut this way */
  count: number;
  /** Left over from each stock bar (inches) */
  scrapIn: number;
}

/**
 * Cutting plan for a list of pieces (inches): longest pieces first, each one cut from the
 * stock bar whose leftover it fits most snugly ("best fit decreasing"), then identical bars
 * are grouped. Lengths are worked in 1/16" so 6' 8" pieces really do fit three to a 20' bar.
 *   10 × 12' and 10 × 8' from 20' bars → 10 bars cut 12' + 8', no scrap.
 */
export function cutPatterns(piecesIn: number[], stockIn: number): CutPattern[] {
  const stock = Math.round(stockIn * 16);
  const sorted = piecesIn.map((p) => Math.round(p * 16)).sort((a, b) => b - a);
  if (sorted.length && sorted[0] > stock) throw new Error('A piece is longer than the stock bar');
  const bars: { left: number; pieces: number[] }[] = [];
  for (const p of sorted) {
    let best: { left: number; pieces: number[] } | undefined;
    for (const b of bars) if (b.left >= p && (!best || b.left < best.left)) best = b;
    if (!best) {
      best = { left: stock, pieces: [] };
      bars.push(best);
    }
    best.pieces.push(p);
    best.left -= p;
  }
  const groups = new Map<string, CutPattern>();
  for (const b of bars) {
    const key = b.pieces.join(',');
    const g = groups.get(key);
    if (g) g.count += 1;
    else groups.set(key, { piecesIn: b.pieces.map((p) => p / 16), count: 1, scrapIn: b.left / 16 });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.scrapIn - b.scrapIn);
}

/** Fewest stock bars possible if every scrap could be lapped and used: total ÷ stock, rounded up. */
export function minSticks(totalFt: number, stockFt: number): number {
  return Math.max(0, Math.ceil(totalFt / stockFt - EPS));
}

// ---------------------------------------------------------------------------------------------
// Hooks and bends (ACI 318-19 Chapter 25; same values as ACI 318-14)

/**
 * Standard hooks on main bars – ACI 318-19 Table 25.3.1 (development of bars in tension):
 *   90° hook: straight extension past the bend = 12 bar diameters
 *   180° hook: 4 bar diameters, but at least 2-1/2"
 *   inside bend diameter: 6 bar diameters for #3–#8, 8 for #9–#11 (10 for #14 and #18)
 */
export const hook90ExtIn = (bar: Bar) => 12 * bar.diaIn;
export const hook180ExtIn = (bar: Bar) => Math.max(4 * bar.diaIn, 2.5);
export const minBendDiaIn = (bar: Bar) => (bar.size <= 8 ? 6 : bar.size <= 11 ? 8 : 10) * bar.diaIn;

export type TieHook = 90 | 135;

/**
 * Hooks on stirrups and ties – ACI 318-19 Table 25.3.2:
 *   #3–#5: 90° or 135° hook, extension = 6 bar diameters but at least 3" (#3 3", #4 3", #5 3-3/4");
 *          inside bend diameter 4 bar diameters
 *   #6–#8: 90° hook 12 bar diameters; 135° hook 6 bar diameters but at least 3";
 *          inside bend diameter 6 bar diameters
 */
export function tieHookExtIn(bar: Bar, hook: TieHook): number {
  if (bar.size > 8) throw new Error('ACI stirrup and tie hooks cover #3–#8');
  if (hook === 90 && bar.size >= 6) return 12 * bar.diaIn;
  return Math.max(6 * bar.diaIn, 3);
}

export const tieBendDiaIn = (bar: Bar) => (bar.size <= 5 ? 4 : 6) * bar.diaIn;

/**
 * Cut length of a closed rectangular tie: outside perimeter (beam width and depth minus the cover
 * on each side) plus one hook extension at each end.
 *   12" × 24" beam, 1-1/2" cover, #3, 135° hooks: 2 × 9 + 2 × 21 + 2 × 3 = 66" (5' 6").
 * For 135° hooks this lands within about 1/4" of the bar's true centerline length;
 * for 90° hooks it runs about 4 bar diameters long, which is on the safe side for ordering.
 */
export function tieCutLengthIn(widthIn: number, depthIn: number, coverIn: number, bar: Bar, hook: TieHook): number {
  const w = widthIn - 2 * coverIn;
  const d = depthIn - 2 * coverIn;
  return 2 * w + 2 * d + 2 * tieHookExtIn(bar, hook);
}

// ---------------------------------------------------------------------------------------------
// Slab grid

export interface SlabGridInput {
  lengthFt: number;
  widthFt: number;
  bar: Bar;
  spacingIn: number;
  coverIn: number;
  stockFt: number;
  lapIn: number;
  layers: number;
  /** 0 = don't count chairs */
  chairSpacingFt: number;
}

export interface BarSet extends RunPlan {
  /** Bars in this direction, per layer */
  count: number;
}

export interface SlabGridResult {
  /** Bars running the long way (parallel to the length), spread across the width */
  alongLength: BarSet;
  /** Bars running parallel to the width, spread along the length */
  alongWidth: BarSet;
  /** All layers */
  laps: number;
  totalFt: number;
  sticks: number;
  minSticks: number;
  lb: number;
  chairs: number;
}

/**
 * A mat of bars both ways. Bars stop at the edge cover; bar count = countAlong(the other side
 * minus cover both sides, spacing). Long runs are lapped (planRun). Everything × layers.
 */
export function slabGrid(s: SlabGridInput): SlabGridResult {
  const cover = s.coverIn / 12;
  const lapFt = s.lapIn / 12;
  const runL = s.lengthFt - 2 * cover;
  const runW = s.widthFt - 2 * cover;
  const alongLength: BarSet = { ...planRun(runL, s.stockFt, lapFt), count: countAlong(runW * 12, s.spacingIn) };
  const alongWidth: BarSet = { ...planRun(runW, s.stockFt, lapFt), count: countAlong(runL * 12, s.spacingIn) };
  const sets = [alongLength, alongWidth];

  const laps = s.layers * sets.reduce((sum, b) => sum + b.count * b.laps, 0);
  const totalFt = s.layers * sets.reduce((sum, b) => sum + b.count * b.barFt, 0);
  // Each run = (pieces − 1) full sticks + one cut piece, so there is one full stick per lap.
  // The cut pieces share sticks where they fit.
  const cutPieces = sets.map((b) => ({ lengthFt: b.tailFt, count: b.count * s.layers }));
  const chairs =
    s.chairSpacingFt > 0 ? countAlong(runL, s.chairSpacingFt) * countAlong(runW, s.chairSpacingFt) * s.layers : 0;

  return {
    alongLength,
    alongWidth,
    laps,
    totalFt,
    sticks: laps + sticksToCut(cutPieces, s.stockFt),
    minSticks: minSticks(totalFt, s.stockFt),
    lb: weightLb(s.bar, totalFt),
    chairs,
  };
}

// ---------------------------------------------------------------------------------------------
// Footing / beam longitudinal bars

export interface BeamBarsResult {
  /** One continuous bar line */
  run: RunPlan;
  continuousFt: number;
  /** All bar lines */
  laps: number;
  cornerBars: number;
  /** Each corner bar: two legs, each one lap long */
  cornerBarFt: number;
  cornerFt: number;
  totalFt: number;
  sticks: number;
  minSticks: number;
  lb: number;
}

/**
 * `lines` bars in the cross-section, each running the full run (lapped as one long line),
 * plus one corner bar per line at each corner (2 legs × lap).
 */
export function beamBars(runFt: number, lines: number, bar: Bar, stockFt: number, lapFt: number, corners: number): BeamBarsResult {
  const run = planRun(runFt, stockFt, lapFt);
  const continuousFt = lines * run.barFt;
  const cornerBars = corners * lines;
  const cornerBarFt = 2 * lapFt;
  const cornerFt = cornerBars * cornerBarFt;
  const totalFt = continuousFt + cornerFt;
  const sticks =
    lines * run.laps +
    sticksToCut(
      [
        { lengthFt: run.tailFt, count: lines },
        { lengthFt: cornerBarFt, count: cornerBars },
      ],
      stockFt,
    );
  return {
    run,
    continuousFt,
    laps: lines * run.laps,
    cornerBars,
    cornerBarFt,
    cornerFt,
    totalFt,
    sticks,
    minSticks: minSticks(totalFt, stockFt),
    lb: weightLb(bar, totalFt),
  };
}

// ---------------------------------------------------------------------------------------------
// Sheets and rolls

/** Sheets or rolls to cover an area when each one covers `eachSqFt` after overlaps (rounded up). */
export function piecesToCover(areaSqFt: number, eachSqFt: number): number {
  if (!(eachSqFt > 0)) throw new Error('Each piece must cover some area');
  return Math.max(0, Math.ceil(areaSqFt / eachSqFt - EPS));
}
