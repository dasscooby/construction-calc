// Formatting for tool results. Lengths use the usual tape notation: 16' 3-1/4"

import { fixed } from '../lib/units';

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function fracText(units: number, denom: number): string {
  if (!units) return '';
  const g = gcd(units, denom);
  return `${units / g}/${denom / g}`;
}

/** 16.2708 ft → 16' 3-1/4"   (rounded to the nearest 1/denom inch) */
export function ftIn(feet: number, denom = 16): string {
  let units = Math.round(Math.abs(feet) * 12 * denom);
  const sign = feet < 0 && units ? '−' : '';
  const ft = Math.floor(units / (12 * denom));
  units -= ft * 12 * denom;
  const whole = Math.floor(units / denom);
  const frac = fracText(units % denom, denom);
  return `${sign}${ft}' ${frac ? `${whole}-${frac}` : whole}"`;
}

/** 7.5 → 7-1/2"   0.75 → 3/4"   (rounded to the nearest 1/denom inch) */
export function inches(inch: number, denom = 16): string {
  const units = Math.round(Math.abs(inch) * denom);
  const sign = inch < 0 && units ? '−' : '';
  const whole = Math.floor(units / denom);
  const frac = fracText(units % denom, denom);
  if (!frac) return `${sign}${whole}"`;
  return whole ? `${sign}${whole}-${frac}"` : `${sign}${frac}"`;
}

/** Decimal with trailing zeros trimmed: dec(1.50) → "1.5", dec(2) → "2" */
export function dec(n: number, decimals = 2): string {
  let s = fixed(n, decimals);
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  if (s === '-0') s = '0';
  return s.startsWith('-') ? `−${s.slice(1)}` : s;
}

/** 12345.6 → "12,346"   commas(1234.5, 1) → "1,234.5" */
export function commas(n: number, decimals = 0): string {
  const s = fixed(Math.abs(n), decimals);
  const [int, frac] = s.split('.');
  const withCommas = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = n < 0 && Number(s) !== 0 ? '−' : '';
  return `${sign}${withCommas}${frac ? `.${frac}` : ''}`;
}

/** Like commas() but drops trailing zeros: 1200.0 → "1,200", 36.67 → "36.7" (1 decimal) */
export function commasTrim(n: number, decimals = 1): string {
  const s = commas(n, decimals);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

export const cuYd = (n: number) => `${dec(n, 2)} cu yd`;
export const cuFt = (n: number) => `${commasTrim(n, 1)} cu ft`;
export const sqFt = (n: number) => `${commasTrim(n, 1)} sq ft`;
export const lb = (n: number) => `${commas(n)} lb`;
export const tons = (n: number) => `${dec(n, 2)} tons`;
export const pct = (n: number, decimals = 1) => `${dec(n, decimals)}%`;
export const deg = (n: number) => `${dec(n, 2)}°`;
