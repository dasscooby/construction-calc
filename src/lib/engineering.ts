// Engineering checks: footing size from soil bearing, concrete cylinder breaks,
// post-tension elongation, and concrete form pressure.
// These are field CHECKS and planning numbers, not designs. Every code rule below
// names where it comes from so it can be looked up.

import { IN_PER_FT } from './units';

// Tiny allowance so 24.0000000001" doesn't round up to 25" because of floating point.
const EPS = 1e-9;

// ============================================================ Footing size (soil bearing)
// The soil under a footing can carry a certain pressure (pounds per square foot).
// Footing area needed = load ÷ (allowable soil pressure − the footing's own weight).
// Same method as textbook examples, e.g. Wight, "Reinforced Concrete: Mechanics and
// Design" 7th ed., Example 15-1: (10 + 12.5 kip/ft) ÷ (5000 − 150 − 4 × 120 psf) = 5.15 ft → 62".

/** Normal-weight concrete, pounds per cubic foot */
export const CONCRETE_PCF = 150;

/** 2021 IRC R403.1.1: concrete footings at least 12" wide and 6" thick */
export const IRC_MIN_FOOTING_WIDTH_IN = 12;
export const IRC_MIN_FOOTING_THICKNESS_IN = 6;

/** 2021 IRC Section R401.4.1, Table R401.4.1 "Presumptive load-bearing values of foundation materials" */
export const IRC_PRESUMPTIVE_BEARING_PSF = [
  { material: 'Crystalline bedrock', psf: 12000 },
  { material: 'Sedimentary and foliated rock', psf: 4000 },
  { material: 'Sandy gravel and/or gravel (GW, GP)', psf: 3000 },
  { material: 'Sand, silty sand, clayey sand, silty gravel, clayey gravel (SW, SP, SM, SC, GM, GC)', psf: 2000 },
  { material: 'Clay, sandy clay, silty clay, clayey silt, silt, sandy silt (CL, ML, MH, CH)', psf: 1500 },
] as const;

/** Weight of the footing itself, per square foot of footing: 150 pcf × thickness */
export function footingSelfWeightPsf(thicknessFt: number): number {
  return CONCRETE_PCF * thicknessFt;
}

/** Soil bearing left over to carry the building load */
export function netBearingPsf(allowablePsf: number, thicknessFt = 0): number {
  return allowablePsf - footingSelfWeightPsf(thicknessFt);
}

/** Wall (continuous) footing: width in feet = pounds per foot of wall ÷ net bearing */
export function wallFootingWidthFt(loadPlf: number, netPsf: number): number {
  return loadPlf / netPsf;
}

/** Square pad: side in feet = √(total pounds ÷ net bearing) */
export function padFootingSideFt(loadLb: number, netPsf: number): number {
  return Math.sqrt(loadLb / netPsf);
}

/** Feet → whole inches, always rounded UP (17.1" → 18") */
export function roundUpToInch(feet: number): number {
  return Math.ceil(feet * IN_PER_FT - EPS);
}

/** Actual soil pressure under a footing = load ÷ footing area + the footing's own weight */
export function soilPressurePsf(load: number, areaSqFt: number, thicknessFt = 0): number {
  return load / areaSqFt + footingSelfWeightPsf(thicknessFt);
}

// ==================================================================== Cylinder breaks
// Strength = break load ÷ area of the cylinder end (ASTM C39 / AASHTO T 22; Caltrans
// California Test 521 §G: "express the result to the nearest 10 psi").
// ACI 318-19 26.12.1.1(a): one "strength test" = average of at least TWO 6×12 cylinders
// or at least THREE 4×8 cylinders, from the same sample, at 28 days (or the age on the plans).
// ACI 318-19 26.12.3.1: concrete is acceptable when
//   (a) every average of 3 consecutive strength tests ≥ f′c, and
//   (b) no single strength test is below f′c by more than 500 psi (f′c ≤ 5000 psi),
//       or by more than 0.10 f′c (f′c > 5000 psi).
// (Same rules in NRMCA CIP 35 and Concrete International, Feb. 2022, "Expect Compressive
// Strength Test Results Less Than Specified Strength on Every Project".)

export type CylinderSize = '4x8' | '6x12';

/** Nominal cylinder diameters, inches (labs use the measured diameter) */
export const CYLINDER_DIAMETER_IN: Record<CylinderSize, number> = { '4x8': 4, '6x12': 6 };

/** ACI 318-19 26.12.1.1(a): cylinders needed for one strength test */
export const CYLINDERS_PER_TEST: Record<CylinderSize, number> = { '4x8': 3, '6x12': 2 };

/** End area of a cylinder, square inches: π × d² ÷ 4.  4" → 12.57, 6" → 28.27 */
export function cylinderAreaSqIn(diameterIn: number): number {
  return (Math.PI * diameterIn * diameterIn) / 4;
}

/** Compressive strength, psi = break load (lb) ÷ end area (sq in) */
export function cylinderPsi(loadLb: number, diameterIn: number): number {
  return loadLb / cylinderAreaSqIn(diameterIn);
}

/** Strength reports are rounded to the nearest 10 psi (ASTM C39) */
export function nearest10(psi: number): number {
  return Math.round(psi / 10) * 10;
}

/** ACI 318-19 26.12.3.1(b): the lowest a single strength test may be */
export function singleTestLimitPsi(fcPsi: number): number {
  return fcPsi <= 5000 ? fcPsi - 500 : 0.9 * fcPsi;
}

export function average(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** How far apart companion cylinders broke: (highest − lowest) ÷ average, in percent */
export function spreadPct(values: number[]): number {
  return ((Math.max(...values) - Math.min(...values)) / average(values)) * 100;
}

/**
 * ASTM C39 precision, 6×12 cylinders made in the field: acceptable range (high − low, % of average)
 * is 8.0% for 2 cylinders and 9.5% for 3 (FHWA-HRT-05-057, AASHTO T 22 item 4; NRMCA CIP 35).
 */
export const C39_RANGE_6X12_FIELD_PCT: Record<number, number> = { 2: 8.0, 3: 9.5 };

// ================================================================ Post-tension elongation
// Elastic stretch of a tendon: Δ = P × L ÷ (A × E)   (PTI FAQ No. 6, "Field Elongation
// Measurements", 2007). This simple version uses the jacking force over the whole length:
// it ignores friction (which lowers the force along the tendon) and wedge seating loss
// (about 1/4" per PTI Technical Note 16), so shop-drawing elongations are usually a bit less.
// Tolerance: ACI 318-19 26.10.2(e)-(f) — a difference of more than 7% between the force found
// from elongation and from the calibrated gauge "shall be ascertained and corrected" (PTI FAQ 6
// and Technical Note 16 quote this as ±7% of the calculated elongation). PTI's slab-on-ground
// committee allows ±10% for residential slab-on-ground tendons (PTI FAQ No. 6).

/** Elongation in inches. force kips, length feet, area sq in, E ksi. */
export function ptElongationIn(forceKips: number, lengthFt: number, areaSqIn: number, eKsi: number): number {
  return (forceKips * lengthFt * IN_PER_FT) / (areaSqIn * eKsi);
}

/** (measured − target) ÷ target, in percent. +3 means 3% long. */
export function percentDiff(measured: number, target: number): number {
  return ((measured - target) / target) * 100;
}

/** Don't jack past 0.80 × 270 ksi = 216 ksi on Grade 270 strand (PTI FAQ No. 6) */
export const MAX_JACKING_STRESS_KSI = 0.8 * 270;

/** PTI Technical Note 16: tendons shorter than about 35 ft are "short" — seating loss dominates */
export const SHORT_TENDON_FT = 35;

// ===================================================================== Form pressure
// ACI 347R-14 "Guide to Formwork for Concrete" (reapproved 2021 as ACI PRC-347-14), 4.2.2.
// Inch-pound units: CCP = lateral pressure (psf), w = unit weight (pcf), h = depth of
// fresh concrete (ft), R = rate of placement (ft/h), T = concrete temperature (°F).
//
//   Eq. 4.2.2.1a(a)  CCP = w·h                                       (full liquid head)
//   Eq. 4.2.2.1a(b)  CCPmax = Cc·Cw·[150 + 9,000·R/T]
//   Eq. 4.2.2.1a(c)  CCPmax = Cc·Cw·[150 + 43,400/T + 2,800·R/T]
//   (b) and (c): minimum 600·Cw psf, but never more than w·h.
//
// Table 4.2.2.1a(a) — which equation:
//   slump > 7 in. (after all admixtures)  ........................ (a)
//   slump ≤ 7 in. but internal vibration deeper than 4 ft  ...... (a)
//   slump ≤ 7 in., vibration ≤ 4 ft:
//     column (no plan dimension over 6.5 ft), any rate  ........... (b)
//     wall ≤ 14 ft tall, R < 7 ft/h  .............................. (b)
//     wall > 14 ft tall, R < 7 ft/h  .............................. (c)
//     wall, R = 7 to 15 ft/h  ...................................... (c)
//     wall, R > 15 ft/h  ........................................... (a)
// 4.2.2.2: self-consolidating concrete (SCC) → full liquid head unless proven by measurement.
// 4.2.2.4: pumped in from the base of the form → full liquid head + at least 25% for pump surge.

export type FormElement = 'wall' | 'column';
/** plain = Type I, II or III only. blend = other cement types (e.g. Type IL) or blends with < 40% fly ash / < 70% slag. highScm = ≥ 40% fly ash or ≥ 70% slag. */
export type Binder = 'plain' | 'blend' | 'highScm';
/** normal = slump ≤ 7" and vibrated no deeper than 4 ft. liquid = SCC, slump > 7", or deeper vibration. pumped = pumped from the bottom. */
export type Placement = 'normal' | 'liquid' | 'pumped';

/**
 * ACI 347R-14 Table 4.2.2.1a(b), chemistry coefficient Cc:
 *   Types I, II, III without retarder 1.0 · with retarder 1.2
 *   Other types / blends (< 70% slag, < 40% fly ash) without retarder 1.2 · with retarder 1.4
 *   Blends with more than 70% slag or 40% fly ash: 1.4 (the table gives one value for these)
 * A "retarder" is any admixture that delays set: retarder, retarding water reducer,
 * retarding mid-range or high-range water reducer (superplasticizer).
 */
export function chemistryCoefficient(binder: Binder, retarder: boolean): number {
  switch (binder) {
    case 'plain':
      return retarder ? 1.2 : 1.0;
    case 'blend':
      return retarder ? 1.4 : 1.2;
    case 'highScm':
      return 1.4;
  }
}

/** ACI 347R-14 Table 4.2.2.1a(c), unit weight coefficient Cw (w in pcf) */
export function unitWeightCoefficient(w: number): number {
  if (w < 140) return Math.max(0.8, 0.5 * (1 + w / 145));
  if (w <= 150) return 1.0;
  return w / 145;
}

/** What set the design pressure */
export type PressureCase =
  | 'eqB' // Eq. 4.2.2.1a(b)
  | 'eqC' // Eq. 4.2.2.1a(c)
  | 'minimum' // 600·Cw floor
  | 'liquidCap' // equation was higher than w·h, so w·h
  | 'liquidMix' // SCC / slump > 7" / deep vibration → w·h
  | 'liquidRate' // wall poured faster than 15 ft/h → w·h
  | 'pumped'; // pumped from the base → 1.25·w·h

export interface FormPressureInput {
  element: FormElement;
  heightFt: number;
  rateFtPerHr: number;
  tempF: number;
  unitWeightPcf: number;
  /** chemistry coefficient from chemistryCoefficient() */
  cc: number;
  placement: Placement;
}

export interface FormPressureResult {
  /** Design maximum lateral pressure, psf */
  pressurePsf: number;
  /** Full liquid head w·h, psf (for comparison) */
  hydrostaticPsf: number;
  /** What the ACI equation gave before the min/max limits (null when it doesn't apply) */
  equationPsf: number | null;
  /** 600·Cw */
  minimumPsf: number;
  governs: PressureCase;
  cw: number;
  /** How far down from the top of the fresh concrete the max pressure is reached: Pmax ÷ w (capped at h) */
  depthToMaxFt: number;
}

export function formPressure(i: FormPressureInput): FormPressureResult {
  const cw = unitWeightCoefficient(i.unitWeightPcf);
  const hydrostaticPsf = i.unitWeightPcf * i.heightFt; // w·h
  const minimumPsf = 600 * cw;
  const liquid = (governs: PressureCase, pressurePsf = hydrostaticPsf): FormPressureResult => ({
    pressurePsf,
    hydrostaticPsf,
    equationPsf: null,
    minimumPsf,
    governs,
    cw,
    depthToMaxFt: i.heightFt,
  });

  if (i.placement === 'pumped') return liquid('pumped', 1.25 * hydrostaticPsf); // 4.2.2.4
  if (i.placement === 'liquid') return liquid('liquidMix'); // Table 4.2.2.1a(a), 4.2.2.2
  if (i.element === 'wall' && i.rateFtPerHr > 15) return liquid('liquidRate'); // Table 4.2.2.1a(a)

  const R = i.rateFtPerHr;
  const T = i.tempF;
  const useB = i.element === 'column' || (R < 7 && i.heightFt <= 14);
  const equationPsf = useB
    ? i.cc * cw * (150 + (9000 * R) / T) // Eq. 4.2.2.1a(b)
    : i.cc * cw * (150 + 43400 / T + (2800 * R) / T); // Eq. 4.2.2.1a(c)

  let pressurePsf = equationPsf;
  let governs: PressureCase = useB ? 'eqB' : 'eqC';
  if (pressurePsf < minimumPsf) {
    pressurePsf = minimumPsf;
    governs = 'minimum';
  }
  if (pressurePsf > hydrostaticPsf) {
    pressurePsf = hydrostaticPsf; // "in no case greater than w·h"
    governs = 'liquidCap';
  }
  return {
    pressurePsf,
    hydrostaticPsf,
    equationPsf,
    minimumPsf,
    governs,
    cw,
    depthToMaxFt: Math.min(i.heightFt, pressurePsf / i.unitWeightPcf),
  };
}
