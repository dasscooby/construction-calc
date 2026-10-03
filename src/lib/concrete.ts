import { CUFT_PER_CUYD, IN_PER_FT } from './units';

/** Pre-mixed bag sizes and how many cubic feet each one makes. */
export const BAGS = [
  { lb: 40, yieldCuFt: 0.3 },
  { lb: 60, yieldCuFt: 0.45 },
  { lb: 80, yieldCuFt: 0.6 },
] as const;

// All inputs below are in feet; results are cubic feet.

/** Slabs, footings and walls are all just boxes: length × width × depth. */
export function boxCuFt(lengthFt: number, widthFt: number, depthFt: number): number {
  return lengthFt * widthFt * depthFt;
}

/** Round columns / sonotubes. */
export function columnCuFt(diameterFt: number, heightFt: number, quantity: number): number {
  const r = diameterFt / 2;
  return Math.PI * r * r * heightFt * quantity;
}

/**
 * Solid stairs sitting on the ground. Step 1 is one rise tall, step 2 is two rises tall,
 * and so on, each one run deep and the full width.
 */
export function stepsCuFt(steps: number, riseFt: number, runFt: number, widthFt: number): number {
  return widthFt * runFt * riseFt * ((steps * (steps + 1)) / 2);
}

/** Square or rectangular columns. */
export function squareColumnCuFt(sideFt: number, heightFt: number, quantity: number): number {
  return sideFt * sideFt * heightFt * quantity;
}

/**
 * Belled (under-reamed) drilled pier: a straight shaft, then a cone-shaped bell that widens
 * out to the bell diameter, then a short straight "toe" at the very bottom.
 * The bell is a frustum: π·h/12 × (D² + D·d + d²).
 */
export function belledPierCuFt(
  shaftDiaFt: number,
  depthFt: number,
  bellDiaFt: number,
  bellHeightFt: number,
  toeFt: number,
): number {
  const shaftHeight = depthFt - bellHeightFt - toeFt;
  const shaft = (Math.PI / 4) * shaftDiaFt ** 2 * shaftHeight;
  const bell = ((Math.PI * bellHeightFt) / 12) * (bellDiaFt ** 2 + bellDiaFt * shaftDiaFt + shaftDiaFt ** 2);
  const toe = (Math.PI / 4) * bellDiaFt ** 2 * toeFt;
  return shaft + bell + toe;
}

/** Height of the sloped part of a bell whose sides are at this angle from horizontal (60° is common). */
export function bellHeightFt(shaftDiaFt: number, bellDiaFt: number, angleDeg = 60): number {
  return ((bellDiaFt - shaftDiaFt) / 2) * Math.tan((angleDeg * Math.PI) / 180);
}

/**
 * Turned-down (monolithic) slab beams: only the part of the beam BELOW the slab is extra concrete.
 * depth = total beam depth measured from the top of the slab.
 */
export function beamBelowSlabCuFt(lengthFt: number, widthFt: number, depthFt: number, slabFt: number): number {
  return lengthFt * widthFt * Math.max(0, depthFt - slabFt);
}

/**
 * A perimeter beam's centerline is shorter than the slab's outside perimeter. For any slab with
 * square corners, outside corners outnumber inside corners by 4, so centerline = perimeter − 4 × beam width.
 */
export function perimeterBeamCenterline(outsidePerimeterFt: number, beamWidthFt: number): number {
  return outsidePerimeterFt - 4 * beamWidthFt;
}

/** Ready-mix loads for an order: e.g. 25.75 yd with 10 yd trucks = 3 trucks, last one 5.75 yd. */
export function truckLoads(orderCuYd: number, truckCuYd: number): { trucks: number; lastLoad: number } {
  if (orderCuYd <= 0 || truckCuYd <= 0) return { trucks: 0, lastLoad: 0 };
  const trucks = Math.ceil(orderCuYd / truckCuYd - 1e-9);
  return { trucks, lastLoad: orderCuYd - (trucks - 1) * truckCuYd };
}

export interface ConcreteResult {
  baseCuFt: number;
  baseCuYd: number;
  cuFt: number;
  cuYd: number;
  /** Cubic yards with waste, rounded up to the nearest 1/4 yard for ordering */
  orderCuYd: number;
  bags: { lb: number; count: number }[];
}

// Tiny allowance so 1.25000000001 doesn't round up to 1.5 because of floating point.
const EPS = 1e-9;

export function roundUpQuarter(yards: number): number {
  return Math.ceil(yards * 4 - EPS) / 4 || 0; // `|| 0` turns -0 into 0
}

export function concreteResult(baseCuFt: number, wastePct: number): ConcreteResult {
  const cuFt = baseCuFt * (1 + wastePct / 100);
  const cuYd = cuFt / CUFT_PER_CUYD;
  return {
    baseCuFt,
    baseCuYd: baseCuFt / CUFT_PER_CUYD,
    cuFt,
    cuYd,
    orderCuYd: roundUpQuarter(cuYd),
    bags: BAGS.map((b) => ({ lb: b.lb, count: Math.max(0, Math.ceil(cuFt / b.yieldCuFt - EPS)) })),
  };
}

/**
 * Read an inches box. Accepts `6`, `6.5`, `6 1/2`, `6-1/2`, or `1/2`. Blank = 0.
 * Returns null if it can't be read.
 */
export function parseInchText(text: string): number | null {
  const s = text.trim();
  if (s === '') return 0;
  let m = s.match(/^(\d+(?:\.\d*)?|\.\d+)$/);
  if (m) return Number(m[1]);
  m = s.match(/^(\d+)[\s-]+(\d+)\s*\/\s*(\d+)$/);
  if (m) return Number(m[3]) === 0 ? null : Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m) return Number(m[2]) === 0 ? null : Number(m[1]) / Number(m[2]);
  return null;
}

/** Read a feet box. Accepts whole or decimal feet. Blank = 0. */
export function parseFeetText(text: string): number | null {
  const s = text.trim();
  if (s === '') return 0;
  return /^(\d+(?:\.\d*)?|\.\d+)$/.test(s) ? Number(s) : null;
}

/** Feet box + inches box → total feet. Null if both are blank or either can't be read. */
export function feetAndInches(ftText: string, inText: string): number | null {
  if (ftText.trim() === '' && inText.trim() === '') return null;
  const ft = parseFeetText(ftText);
  const inches = parseInchText(inText);
  if (ft === null || inches === null) return null;
  return ft + inches / IN_PER_FT;
}

/** Whole number like a step count or column quantity. */
export function parseCount(text: string): number | null {
  const s = text.trim();
  return /^\d+$/.test(s) ? Number(s) : null;
}

/** Waste percent. Blank = 0%. */
export function parsePercent(text: string): number | null {
  const s = text.trim();
  if (s === '') return 0;
  return /^(\d+(?:\.\d*)?|\.\d+)$/.test(s) ? Number(s) : null;
}
