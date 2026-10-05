// Reads the text in a tool's boxes, checks it, and runs compute().
// The screen and the tests both use runTool().

import { BarRow, ComputeOutput, EdgeKind, Field, Inputs, OutlineRow, PadValue, Rect, StockRow, Tool, ToolResult, WallEnds, WallRow } from './types';

export type RawLength = { ft: string; in: string };
export type RawArea = { length: RawLength; width: RawLength };
export type RawBarRow = { size: string; qty: string; length: RawLength };
export type RawWallRow = { length: RawLength; ends: WallEnds };
export type RawStockRow = { size: string; qty: string };
export type RawOutlineRow = { length: RawLength; turn: 'R' | 'L'; radius: RawLength; edge: EdgeKind };
export const EDGE_KINDS: EdgeKind[] = ['form', 'house', 'dowels', 'slab', 'slabDowels'];
export type RawPad = { points: { x: number; y: number }[]; edges: { a: number; b: number; length: RawLength }[] };
export type RawValue = string | RawLength | RawArea[] | RawBarRow[] | RawWallRow[] | RawStockRow[] | RawOutlineRow[] | RawPad;

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

/** A saved sketch: numbers for points, lines between real points, lengths as typed. */
export function isRawPad(v: unknown): v is RawPad {
  if (!v || typeof v !== 'object') return false;
  const p = v as RawPad;
  if (!Array.isArray(p.points) || !Array.isArray(p.edges)) return false;
  const n = p.points.length;
  return (
    p.points.every((q) => Number.isFinite(q?.x) && Number.isFinite(q?.y)) &&
    p.edges.every((e) => Number.isInteger(e?.a) && Number.isInteger(e?.b) && e.a >= 0 && e.b >= 0 && e.a < n && e.b < n && e.a !== e.b && isRawLength(e.length))
  );
}

/** The boxes a fresh tool starts with. `overrides` (from My defaults) replaces any of them. */
export function defaultRaw(tool: Tool, overrides: RawValues = {}): RawValues {
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
      case 'stock':
        raw[f.key] = f.defaultSizes.map((size) => ({ size, qty: '' }));
        break;
      case 'toggle':
        raw[f.key] = f.default ? '1' : '';
        break;
      case 'outline':
        raw[f.key] = [{ length: emptyLength(), turn: 'R', radius: emptyLength(), edge: 'form' }];
        break;
      case 'pad':
        raw[f.key] = { points: [], edges: [] };
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
  for (const f of tool.fields) if (f.key in overrides) raw[f.key] = overrides[f.key];
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
    } else if (f.kind === 'stock' && Array.isArray(v) && v.every((r) => typeof r?.size === 'string' && typeof r?.qty === 'string')) {
      raw[f.key] = v as RawStockRow[];
    } else if (f.kind === 'choice' && f.options.some((o) => o.value === v)) raw[f.key] = v as string;
    else if (f.kind === 'toggle' && (v === '1' || v === '')) raw[f.key] = v;
    else if (
      f.kind === 'outline' &&
      Array.isArray(v) &&
      v.length &&
      v.every((r) => isRawLength(r?.length) && isRawLength(r?.radius) && (r?.turn === 'R' || r?.turn === 'L') && EDGE_KINDS.includes(r?.edge))
    ) {
      raw[f.key] = v as RawOutlineRow[];
    } else if (f.kind === 'pad' && isRawPad(v)) {
      raw[f.key] = v;
    }
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

type Parsed = number | string | string[] | Rect[] | BarRow[] | WallRow[] | StockRow[] | OutlineRow[] | PadValue | null;

/**
 * Test-friendly inputs are allowed too: a number for a length field means feet,
 * a number for a number/count field is used as-is, areas can be [[length, width], ...] in feet,
 * bar lists can be [[size, how many, length in feet], ...], walls [[length in feet, 'oo' | 'oi' | 'ii'], ...],
 * and stock [[size in inches, how many or null], ...].
 */
export type LooseValue =
  | RawValue
  | number
  | [number, number][]
  | [string, number, number][]
  | [number, WallEnds][]
  | [number, number | null][]
  | [number, 'R' | 'L', number, EdgeKind][]
  | { points: [number, number][]; edges: [number, number, number | null][] };

function normalize(f: Field, v: LooseValue | boolean | undefined): RawValue | undefined {
  if (v === undefined) return undefined;
  if (typeof v === 'boolean') return v ? '1' : '';
  if (typeof v === 'number') return f.kind === 'length' ? { ft: String(v), in: '' } : String(v);
  if (f.kind === 'areas' && Array.isArray(v) && v.length && Array.isArray(v[0])) {
    return (v as [number, number][]).map(([l, w]) => ({
      length: { ft: String(l), in: '' },
      width: { ft: String(w), in: '' },
    }));
  }
  if (f.kind === 'pad' && v && typeof v === 'object' && !Array.isArray(v) && 'points' in v && Array.isArray((v as { points: unknown[] }).points[0])) {
    // Tests: { points: [[x, y], ...], edges: [[a, b, ft or null], ...] }
    const t = v as unknown as { points: [number, number][]; edges: [number, number, number | null][] };
    return {
      points: t.points.map(([x, y]) => ({ x, y })),
      edges: t.edges.map(([a, b, ft]) => ({ a, b, length: { ft: ft === null ? '' : String(ft), in: '' } })),
    };
  }
  if (f.kind === 'outline' && Array.isArray(v) && v.length && Array.isArray(v[0])) {
    return (v as unknown as [number, 'R' | 'L', number, EdgeKind][]).map(([ft, turn, r, edge]) => ({
      length: { ft: String(ft), in: '' },
      turn,
      radius: { ft: r ? String(r) : '', in: '' },
      edge,
    }));
  }
  if (f.kind === 'stock' && Array.isArray(v) && v.length && Array.isArray(v[0])) {
    return (v as [number, number | null][]).map(([size, qty]) => ({ size: String(size), qty: qty === null ? '' : String(qty) }));
  }
  if (f.kind === 'walls' && Array.isArray(v) && v.length && Array.isArray(v[0])) {
    return (v as [number, WallEnds][]).map(([ft, ends]) => ({ length: { ft: String(ft), in: '' }, ends }));
  }
  if (f.kind === 'barlist' && Array.isArray(v) && v.length && Array.isArray(v[0])) {
    return (v as [string, number, number][]).map(([size, qty, ft]) => ({ size, qty: String(qty), length: { ft: String(ft), in: '' } }));
  }
  return v as RawValue;
}

/** Fields hidden behind a switch that's off. */
/** 'footing' = that switch is on; 'shape=rect' = that choice is picked. */
const condition = (k: string, raw: RawValues) => {
  const eq = k.indexOf('=');
  return eq < 0 ? raw[k] === '1' : raw[k.slice(0, eq)] === k.slice(eq + 1);
};

export function isShown(f: Field, raw: RawValues): boolean {
  return (!f.showIf || f.showIf.every((k) => condition(k, raw))) && (!f.showIfAny || f.showIfAny.some((k) => condition(k, raw)));
}

export function runTool(tool: Tool, values: Record<string, LooseValue | boolean>): RunResult {
  const raw: RawValues = { ...defaultRaw(tool) };
  for (const f of tool.fields) {
    const v = normalize(f, values[f.key]);
    if (v !== undefined) raw[f.key] = v;
  }

  const parsed: Record<string, Parsed> = {};
  for (const f of tool.fields) {
    const v = raw[f.key];
    if (!isShown(f, raw)) {
      parsed[f.key] = null; // switched off: treated as blank
      continue;
    }
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
      case 'toggle':
        value = v === '1' ? 'on' : null;
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
      case 'pad': {
        const pad = v as RawPad;
        const edges: PadValue['edges'] = [];
        for (const e of pad.edges) {
          const len = parseLength(e.length);
          const name = `${String.fromCharCode(65 + e.a)}–${String.fromCharCode(65 + e.b)}`;
          if (len !== null && (Number.isNaN(len) || len <= 0)) return { status: 'invalid', message: `Check the length of ${name}` };
          edges.push({ a: e.a, b: e.b, length: len });
        }
        if (edges.length) value = { points: pad.points, edges };
        else blank = true;
        break;
      }
      case 'outline': {
        const rows: OutlineRow[] = [];
        for (const [i, r] of (v as RawOutlineRow[]).entries()) {
          const len = parseLength(r.length);
          if (len === null) continue; // empty row
          if (Number.isNaN(len) || len <= 0) return { status: 'invalid', message: `Check the length of side ${i + 1}` };
          const rad = parseLength(r.radius);
          if (rad !== null && (Number.isNaN(rad) || rad < 0)) return { status: 'invalid', message: `Check the radius at the end of side ${i + 1}` };
          rows.push({ length: len, turn: r.turn, radius: rad ?? 0, edge: r.edge });
        }
        if (rows.length) value = rows;
        else blank = true;
        break;
      }
      case 'stock': {
        const rows: StockRow[] = [];
        for (const r of v as RawStockRow[]) {
          const sizeText = r.size.trim();
          const qtyText = r.qty.trim();
          if (sizeText === '') continue; // empty row
          const size = parseNumber(sizeText);
          if (size === null || size <= 0) return { status: 'invalid', message: `Check the size ${sizeText}` };
          if (qtyText !== '' && !/^\d+$/.test(qtyText)) return { status: 'invalid', message: `How many ${sizeText}" must be a whole number` };
          rows.push({ size, qty: qtyText === '' ? null : Number(qtyText) });
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
    if (blank && !f.optional && f.kind !== 'toggle') return { status: 'missing', message: `${f.kind === 'multi' ? 'Pick' : 'Enter'} ${f.label.toLowerCase()}` };
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
    stock: (k) => (get(k) as StockRow[] | null) ?? [],
    outline: (k) => (get(k) as OutlineRow[] | null) ?? [],
    pad: (k) => get(k) as PadValue | null,
    has: (k) => get(k) !== null,
    on: (k) => get(k) === 'on',
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
