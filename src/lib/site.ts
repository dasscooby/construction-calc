// Site work math: slope & fall, laser-level grade shots, digging, and fill / base rock.
// Lengths are in FEET unless the name says otherwise (…In = inches, …CuYd = cubic yards).

import { CUFT_PER_CUYD, IN_PER_FT } from './units';

// Tiny allowance so 21.0000000001 truckloads doesn't round up to 22 because of floating point.
const EPS = 1e-9;

// ------------------------------------------------------------------ Slope & fall
// A slope is kept as a plain ratio: rise ÷ run (feet per foot, inches per inch...).
//   1/4" per foot = 0.25 ÷ 12 = 0.02083 = 2.08%      1:12 ramp = 1 ÷ 12 = 8.33%
// Run is measured level (horizontal), the way a level or laser reads it.

/** Inches of fall per foot → ratio. 1/4 → 0.020833 */
export function slopeFromInPerFt(inPerFt: number): number {
  return inPerFt / IN_PER_FT;
}

/** Percent grade → ratio. 2 → 0.02 */
export function slopeFromPercent(percent: number): number {
  return percent / 100;
}

/** Drop and run (same units) → ratio. 6" over 10 ft: 0.5 ÷ 10 = 0.05 */
export function slopeFromDrop(dropFt: number, runFt: number): number {
  return dropFt / runFt;
}

/** Ratio → inches of fall per foot */
export function slopeInPerFt(slope: number): number {
  return slope * IN_PER_FT;
}

/** Ratio → percent grade */
export function slopePercent(slope: number): number {
  return slope * 100;
}

/** Ratio → angle above level, in degrees (tan angle = rise ÷ run) */
export function slopeDegrees(slope: number): number {
  return (Math.atan(slope) * 180) / Math.PI;
}

/** The X in "1 : X" (1 of rise for X of run). 1/4" per ft → 48. Level ground → Infinity. */
export function slopeRatioX(slope: number): number {
  return slope === 0 ? Infinity : 1 / slope;
}

/** Fall (feet) over a level distance (feet) */
export function dropOverRun(runFt: number, slope: number): number {
  return runFt * slope;
}

// ------------------------------------------------------- Grade rod & elevations
// Plain differential leveling with a builder's level or laser:
//   Height of instrument  HI = benchmark elevation + rod reading on the benchmark (backsight)
//   Elevation of any spot    = HI − rod reading on that spot
// So the rod reading you WANT at a target grade is HI − target elevation.
// A smaller reading than that means the ground is high (cut); a bigger one means low (fill).

/** HI = benchmark elevation + backsight rod reading */
export function heightOfInstrument(benchmarkElev: number, backsight: number): number {
  return benchmarkElev + backsight;
}

/** The rod reading that puts the bottom of the rod at this elevation: HI − elevation */
export function rodReadingFor(hi: number, elevation: number): number {
  return hi - elevation;
}

/** Elevation of a spot from its rod reading: HI − reading */
export function elevationFromRod(hi: number, rodReading: number): number {
  return hi - rodReading;
}

/** Ground minus target. Positive = CUT (ground is high), negative = FILL (ground is low). */
export function cutFill(groundElev: number, targetElev: number): number {
  return groundElev - targetElev;
}

// ------------------------------------------------------------------- Excavation
// Bank yards = dirt in the ground. Loose yards = the same dirt after it's dug and fluffed up
// (what a truck hauls): loose = bank × (1 + swell %).

/**
 * Bank (in-the-ground) cubic yards for rectangular holes with straight, vertical sides.
 * overDigFt is added to EACH side of the length and the width (working room around forms).
 */
export function excavationBankCuYd(
  lengthFt: number,
  widthFt: number,
  depthFt: number,
  quantity = 1,
  overDigFt = 0,
): number {
  const l = lengthFt + 2 * overDigFt;
  const w = widthFt + 2 * overDigFt;
  return (l * w * depthFt * quantity) / CUFT_PER_CUYD;
}

/** Dug dirt takes more room: loose = bank × (1 + swell%/100). 100 bank yd at 25% = 125 loose yd. */
export function looseFromBank(bankCuYd: number, swellPct: number): number {
  return bankCuYd * (1 + swellPct / 100);
}

/** Whole truckloads, rounded up (20.1 loads → 21). Works for yards or tons. */
export function loadsNeeded(amount: number, perTruck: number): number {
  if (amount <= 0 || perTruck <= 0) return 0;
  return Math.max(0, Math.ceil(amount / perTruck - EPS));
}

// --------------------------------------------------------------- Fill & base rock
// Rock, sand and fill are spread loose and then compacted, so you order MORE loose
// material than the finished (compacted) volume:
//   compacted yd = area × compacted depth ÷ 27
//   loose yd     = compacted yd × (1 + compaction allowance %)
//   tons         = loose yd × tons per loose yd

export interface FillBaseResult {
  compactedCuYd: number;
  looseCuYd: number;
  tons: number;
  /** tons ÷ compacted yards: handy to compare with a supplier's or DOT's number */
  tonsPerCompactedCuYd: number;
}

export function fillBase(
  areaSqFt: number,
  compactedDepthFt: number,
  allowancePct: number,
  tonsPerLooseCuYd: number,
): FillBaseResult {
  const compactedCuYd = (areaSqFt * compactedDepthFt) / CUFT_PER_CUYD;
  const looseCuYd = compactedCuYd * (1 + allowancePct / 100);
  const tons = looseCuYd * tonsPerLooseCuYd;
  return {
    compactedCuYd,
    looseCuYd,
    tons,
    tonsPerCompactedCuYd: tonsPerLooseCuYd * (1 + allowancePct / 100),
  };
}
