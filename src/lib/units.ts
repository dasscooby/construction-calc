// Every measurement is stored in inches: a length in inches, an area in square inches,
// a volume in cubic inches. "dim" says which one: 0 = plain number, 1 = length,
// 2 = area, 3 = volume. "show" remembers how the answer should be displayed.

export type Dim = 0 | 1 | 2 | 3;
export type LinUnit = 'yd' | 'ft' | 'in' | 'm' | 'cm' | 'mm';

export type Show =
  | 'ftin' | 'ftdec' | 'infrac' | 'indec' | 'yd' | 'm' | 'cm' | 'mm'
  | 'sqft' | 'sqin' | 'sqyd' | 'sqm' | 'sqcm' | 'sqmm'
  | 'cuyd' | 'cuft' | 'cuin' | 'cum' | 'cucm' | 'cumm' | 'bdft';

export interface Quantity {
  value: number;
  dim: Dim;
  show?: Show;
  /** Finest fraction typed (e.g. 64 after typing 1/64) so answers keep that precision */
  res?: number;
}

/** Fraction rounding: nearest 1/2 ... 1/64 inch */
export type Denom = 2 | 4 | 8 | 16 | 32 | 64;
export const DENOMS: Denom[] = [2, 4, 8, 16, 32, 64];

export const IN_PER_FT = 12;
export const CUFT_PER_CUYD = 27;
const IN_PER_M = 1 / 0.0254;

/** Inches in one of each linear unit */
export const LIN: Record<LinUnit, number> = {
  yd: 36,
  ft: 12,
  in: 1,
  m: IN_PER_M,
  cm: IN_PER_M / 100,
  mm: IN_PER_M / 1000,
};

export type Family = 'ft' | 'in' | 'yd' | 'metric';

interface ShowInfo {
  dim: Dim;
  /** inches (or sq in / cu in) in one display unit */
  per: number;
  word: string;
  family: Family;
}

export const SHOWS: Record<Show, ShowInfo> = {
  ftin: { dim: 1, per: 12, word: 'FEET', family: 'ft' },
  ftdec: { dim: 1, per: 12, word: 'FEET', family: 'ft' },
  infrac: { dim: 1, per: 1, word: 'INCH', family: 'in' },
  indec: { dim: 1, per: 1, word: 'INCH', family: 'in' },
  yd: { dim: 1, per: 36, word: 'YD', family: 'yd' },
  m: { dim: 1, per: LIN.m, word: 'M', family: 'metric' },
  cm: { dim: 1, per: LIN.cm, word: 'CM', family: 'metric' },
  mm: { dim: 1, per: LIN.mm, word: 'MM', family: 'metric' },
  sqft: { dim: 2, per: 144, word: 'SQ FEET', family: 'ft' },
  sqin: { dim: 2, per: 1, word: 'SQ INCH', family: 'in' },
  sqyd: { dim: 2, per: 1296, word: 'SQ YD', family: 'yd' },
  sqm: { dim: 2, per: LIN.m ** 2, word: 'SQ M', family: 'metric' },
  sqcm: { dim: 2, per: LIN.cm ** 2, word: 'SQ CM', family: 'metric' },
  sqmm: { dim: 2, per: LIN.mm ** 2, word: 'SQ MM', family: 'metric' },
  cuyd: { dim: 3, per: 46656, word: 'CU YD', family: 'yd' },
  cuft: { dim: 3, per: 1728, word: 'CU FEET', family: 'ft' },
  cuin: { dim: 3, per: 1, word: 'CU INCH', family: 'in' },
  cum: { dim: 3, per: LIN.m ** 3, word: 'CU M', family: 'metric' },
  cucm: { dim: 3, per: LIN.cm ** 3, word: 'CU CM', family: 'metric' },
  cumm: { dim: 3, per: LIN.mm ** 3, word: 'CU MM', family: 'metric' },
  bdft: { dim: 3, per: 144, word: 'BDFT', family: 'ft' },
};

export const SQ_SHOW: Record<LinUnit, Show> = { yd: 'sqyd', ft: 'sqft', in: 'sqin', m: 'sqm', cm: 'sqcm', mm: 'sqmm' };
export const CU_SHOW: Record<LinUnit, Show> = { yd: 'cuyd', ft: 'cuft', in: 'cuin', m: 'cum', cm: 'cucm', mm: 'cumm' };

/** m / cm / mm for a metric display, regardless of whether it is a length, area or volume */
export function metricBase(show: Show): 'm' | 'cm' | 'mm' {
  if (show.endsWith('mm')) return 'mm';
  if (show.endsWith('cm')) return 'cm';
  return 'm';
}

/** Rounds halves away from zero, even when floating point lands a hair under (4.95935 → 4.9594). */
export function fixed(n: number, decimals: number): string {
  const f = 10 ** decimals;
  const rounded = (Math.sign(n) * Math.round(Math.abs(n) * f + 1e-6)) / f;
  const s = rounded.toFixed(decimals);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
}

/** Fixed decimals with trailing zeros removed: 1.2300 → 1.23 (used by the concrete tabs) */
export function fmtNum(n: number, decimals = 4): string {
  if (!Number.isFinite(n)) return 'Error';
  let s = fixed(n, decimals);
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

/** Calculator-style number: 7 digits like the Construction Master LCD (1.555556, 261.0503, 27215.54). */
export function fmtCM(n: number): string {
  const abs = Math.abs(n);
  const intDigits = abs < 1 ? 1 : Math.floor(Math.log10(abs)) + 1;
  const s = fmtNum(n, Math.max(0, 7 - intDigits));
  return s.startsWith('-') ? `−${s.slice(1)}` : s;
}

export const MAX_DISPLAY = 19999999.99;

/** A piece of the display: a number with an optional unit word after it ("18" + "FEET"). */
export interface Seg {
  t: string;
  u?: string;
}

export function segText(segs: Seg[]): string {
  return segs.map((s) => (s.u ? `${s.t} ${s.u}` : s.t)).join(' ');
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function fraction(units: number, denom: number, reduce: boolean): string {
  if (!units) return '';
  const g = reduce ? gcd(units, denom) : 1;
  return `${units / g}/${denom / g}`;
}

/** 227.875 → 18 FEET 11-7/8 INCH */
export function formatFtIn(inches: number, denom: number, reduce = true): Seg[] {
  let units = Math.round(Math.abs(inches) * denom);
  const sign = inches < 0 && units ? '−' : '';
  const perFoot = 12 * denom;
  const ft = Math.floor(units / perFoot);
  units -= ft * perFoot;
  const whole = Math.floor(units / denom);
  const frac = fraction(units % denom, denom, reduce);
  return [
    { t: `${sign}${ft}`, u: 'FEET' },
    { t: frac ? `${whole}-${frac}` : `${whole}`, u: 'INCH' },
  ];
}

/** 3.931 → 3-15/16 INCH, 0.703 → 0-45/64 INCH */
export function formatInFrac(inches: number, denom: number, reduce = true): Seg[] {
  const units = Math.round(Math.abs(inches) * denom);
  const sign = inches < 0 && units ? '−' : '';
  const whole = Math.floor(units / denom);
  const frac = fraction(units % denom, denom, reduce);
  return [{ t: `${sign}${frac ? `${whole}-${frac}` : whole}`, u: 'INCH' }];
}
