// Reads the text in a tool's boxes, checks it, and runs compute().
// The screen and the tests both use runTool().

import { BarRow, ComputeOutput, Field, Inputs, Rect, Tool, ToolResult, WallEnds, WallRow } from './types';

export type RawLength = { ft: string; in: string };
export type RawArea = { length: RawLength; width: RawLength };
export type RawBarRow = { size: string; qty: string; length: RawLength };
export type RawWallRow = { length: RawLength; ends: WallEnds };
export type RawValue = string | RawLength | RawArea[] | RawBarRow[] | RawWallRow[];

export const WALL_ENDS: WallEnds[] = ['oo', 'oi', 'ii'];
export type RawValues = Record<string, RawValue>;

/** Accepts 12, 12.5, .5, 1/4, 1 1/2, 1-1/2 (and a leading minus if allowed). Commas are ignored. */
export function parseNumber(text: string, allowNegative = false): number | null {
  let s = text.trim().replace(/,/g, '');
  let sign = 1;
  if (s.startsWith('-') || s.startsWith('−')) {
    if (!allowNegative) return null;
    sign = -1;
    s = s.slice(1).trim();
  }
  let m = s.match(/^(\d+(?:\.\d*)?|\.\d+)$/);
  if (m) return sign * Number(m[1]);
  m = s.match(/^(\d+)(?:\s+|\s*-\s*)(\d+)\s*\/\s*(\d+)$/);
  if (m) return Number(m[3]) ? sign * (Number(m[1]) + Number(m[2]) / Number(m[3])) : null;
  m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m) return Number(m[2]) ? (sign * Number(m[1])) / Number(m[2]) : null;
  return null;
}

const blankLength = (r: RawLength) => r.ft.trim() === '' && r.in.trim() === '';

/** Feet + inches boxes → feet. null if blank, NaN if it can't be read. */
export function parseLength(r: RawLength): number | null {
  if (blankLength(r)) return null;
  const ft = r.ft.trim() === '' ? 0 : parseNumber(r.ft);
  const inch = r.in.trim() === '' ? 0 : parseNumber(r.in);
  if (ft === null || inch === null) return NaN;
  return ft + inch / 12;
}

export const emptyLength = (): RawLength => ({ ft: '', in: '' });

export function defaultRaw(tool: Tool): RawValues {
  const raw: RawValues = {};
  for (const f of tool.fields) {
    switch (f.kind) {
      case 'length':
        raw[f.key] = { ft: f.default?.ft ?? '', in: f.default?.in ?? '' };
        break;
      case 'areas':
        raw[f.key] = [{ length: emptyLength(), width: emptyLength() }];
        break;
      case 'barlist':
        raw[f.key] = [{ size: f.defaultSize, qty: '', length: emptyLength() }];
        break;
      case 'walls':
        raw[f.key] = [{ length: emptyLength(), ends: 'oo' }];
        break;
      case 'choice':
        raw[f.key] = f.default;
        break;
      case 'multi':
        raw[f.key] = f.default.join(',');
        break;
      default:
        raw[f.key] = f.default ?? '';
    }
  }
  return raw;
}

const isRawLength = (v: unknown): v is RawLength =>
  typeof v === 'object' && v !== null && typeof (v as RawLength).ft === 'string' && typeof (v as RawLength).in === 'string';

/** Saved box text from an earlier session, checked against the tool's current fields (bad or old values fall back to defaults). */
export function restoreRaw(tool: Tool, saved: unknown): RawValues {
  const raw = defaultRaw(tool);
  if (typeof saved !== 'object' || saved === null) return raw;
  const s = saved as Record<string, unknown>;
  for (const f of tool.fields) {
    const v = s[f.key];
    if (f.kind === 'length' && isRawLength(v)) raw[f.key] = v;
    else if (f.kind === 'areas' && Array.isArray(v) && v.length && v.every((a) => isRawLength(a?.length) && isRawLength(a?.width))) {
      raw[f.key] = v as RawArea[];
    } else if (
      f.kind === 'barlist' &&
      Array.isArray(v) &&
      v.length &&
      v.every((r) => f.sizes.includes(r?.size) && typeof r?.qty === 'string' && isRawLength(r?.length))
    ) {
      raw[f.key] = v as RawBarRow[];
    } else if (f.kind === 'walls' && Array.isArray(v) && v.length && v.every((r) => isRawLength(r?.length) && WALL_ENDS.includes(r?.ends))) {
      raw[f.key] = v as RawWallRow[];
    } else if (f.kind === 'choice' && f.options.some((o) => o.value === v)) raw[f.key] = v as string;
    else if (f.kind === 'multi' && typeof v === 'string' && v.split(',').every((x) => x === '' || f.options.some((o) => o.value === x))) {
      raw[f.key] = v;
    }
    else if ((f.kind === 'number' || f.kind === 'count') && typeof v === 'string') raw[f.key] = v;
  }
  return raw;
}

export type RunResult =
  | { status: 'ok'; result: ToolResult }
  | { status: 'missing'; message: string }
  | { status: 'invalid'; message: string };

type Parsed = number | string | string[] | Rect[] | BarRow[] | WallRow[] | null;

/**
 * Test-friendly inputs are allowed too: a number for a length field means feet,
 * a number for a number/count field is used as-is, areas can be [[length, width], ...] in feet,
 * bar lists can be [[size, how many, length in feet], ...], and walls [[length in feet, 'oo' | 'oi' | 'ii'], ...].
 */
export type LooseValue = RawValue | number | [number, number][] | [string, number, number][] | [number, WallEnds][];

function normalize(f: Field, v: LooseValue | undefined): RawValue | undefined {
  if (v === undefined) return undefined;
  if (typeof v === 'number') return f.kind === 'length' ? { ft: String(v), in: '' } : String(v);
  if (f.kind === 'areas' && Array.isArray(v) && v.length && Array.isArray(v[0])) {
    return (v as [number, number][]).map(([l, w]) => ({
      length: { ft: String(l), in: '' },
      width: { ft: String(w), in: '' },
    }));
  }
  if (f.kind === 'walls' && Array.isArray(v) && v.length && Array.isArray(v[0])) {
    return (v as [number, WallEnds][]).map(([ft, ends]) => ({ length: { ft: String(ft), in: '' }, ends }));
  }
  if (f.kind === 'barlist' && Array.isArray(v) && v.length && Array.isArray(v[0])) {
    return (v as [string, number, number][]).map(([size, qty, ft]) => ({ size, qty: String(qty), length: { ft: String(ft), in: '' } }));
  }
  return v as RawValue;
}

export function runTool(tool: Tool, values: Record<string, LooseValue>): RunResult {
  const raw: RawValues = { ...defaultRaw(tool) };
  for (const f of tool.fields) {
    const v = normalize(f, values[f.key]);
    if (v !== undefined) raw[f.key] = v;
  }

  const parsed: Record<string, Parsed> = {};
  for (const f of tool.fields) {
    const v = raw[f.key];
    let value: Parsed = null;
    let blank = false;
    switch (f.kind) {
      case 'length': {
        const n = parseLength(v as RawLength);
        if (n === null) blank = true;
        else if (Number.isNaN(n)) return { status: 'invalid', message: `Check ${f.label}` };
        else value = n;
        break;
      }
      case 'number': {
        const text = v as string;
        if (text.trim() === '') blank = true;
        else {
          const n = parseNumber(text, f.allowNegative);
          if (n === null) return { status: 'invalid', message: `Check ${f.label}` };
          value = n;
        }
        break;
      }
      case 'count': {
        const text = (v as string).trim();
        if (text === '') blank = true;
        else if (!/^\d+$/.test(text)) return { status: 'invalid', message: `${f.label} must be a whole number` };
        else value = Number(text);
        break;
      }
      case 'choice':
        value = v as string;
        break;
      case 'multi': {
        const picked = (v as string).split(',').filter(Boolean);
        const order = f.options.map((o) => o.value);
        if (picked.length) value = order.filter((o) => picked.includes(o));
        else blank = true;
        break;
      }
      case 'areas': {
        const rects: Rect[] = [];
        for (const [i, a] of (v as RawArea[]).entries()) {
          if (blankLength(a.length) && blankLength(a.width)) continue;
          const l = parseLength(a.length);
          const w = parseLength(a.width);
          if (l === null || w === null) return { status: 'missing', message: `Enter both sides of area ${i + 1}` };
          if (Number.isNaN(l) || Number.isNaN(w)) return { status: 'invalid', message: `Check area ${i + 1}` };
          rects.push({ length: l, width: w });
        }
        if (rects.length) value = rects;
        else blank = true;
        break;
      }
      case 'barlist': {
        const rows: BarRow[] = [];
        for (const [i, r] of (v as RawBarRow[]).entries()) {
          const qtyText = r.qty.trim();
          if (qtyText === '' && blankLength(r.length)) continue; // empty row
          if (qtyText === '') return { status: 'missing', message: `Enter how many for mark ${i + 1}` };
          if (!/^\d+$/.test(qtyText) || Number(qtyText) < 1) return { status: 'invalid', message: `How many for mark ${i + 1} must be a whole number` };
          const len = parseLength(r.length);
          if (len === null) return { status: 'missing', message: `Enter the length of mark ${i + 1}` };
          if (Number.isNaN(len) || len <= 0) return { status: 'invalid', message: `Check the length of mark ${i + 1}` };
          rows.push({ size: r.size, qty: Number(qtyText), length: len });
        }
        if (rows.length) value = rows;
        else blank = true;
        break;
      }
      case 'walls': {
        const rows: WallRow[] = [];
        for (const [i, r] of (v as RawWallRow[]).entries()) {
          const len = parseLength(r.length);
          if (len === null) continue; // empty row
          if (Number.isNaN(len) || len <= 0) return { status: 'invalid', message: `Check the length of wall ${i + 1}` };
          rows.push({ length: len, ends: r.ends });
        }
        if (rows.length) value = rows;
        else blank = true;
        break;
      }
    }
    if (blank && !f.optional) return { status: 'missing', message: `${f.kind === 'multi' ? 'Pick' : 'Enter'} ${f.label.toLowerCase()}` };
    parsed[f.key] = value;
  }

  const get = (key: string) => {
    if (!(key in parsed)) throw new Error(`Tool ${tool.id} has no field "${key}"`);
    return parsed[key];
  };
  const inputs: Inputs = {
    len: (k) => (get(k) as number | null) ?? 0,
    num: (k) => (get(k) as number | null) ?? 0,
    count: (k) => (get(k) as number | null) ?? 0,
    choice: (k) => get(k) as string,
    picks: (k) => (get(k) as string[] | null) ?? [],
    areas: (k) => (get(k) as Rect[] | null) ?? [],
    bars: (k) => (get(k) as BarRow[] | null) ?? [],
    walls: (k) => (get(k) as WallRow[] | null) ?? [],
    has: (k) => get(k) !== null,
  };

  const out: ComputeOutput = tool.compute(inputs);
  if ('error' in out) return { status: 'invalid', message: out.error };
  return { status: 'ok', result: out };
}

/** For tests: the value text of the row with this label (throws if the tool didn't run). */
export function rowValue(r: RunResult, label: string): string | undefined {
  if (r.status !== 'ok') throw new Error(`tool did not run: ${r.status} – ${r.message}`);
  return r.result.rows.find((row) => row.label === label)?.value;
}
