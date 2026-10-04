// Construction calculator engine, modeled on the Construction Master 5 (model 4050).
// Everything here is a pure function of (state, key) so it can be tested key by key.

import {
  CU_SHOW,
  Denom,
  Dim,
  Family,
  LIN,
  LinUnit,
  MAX_DISPLAY,
  Quantity,
  SHOWS,
  SQ_SHOW,
  Seg,
  Show,
  fixed,
  fmtCM,
  formatFtIn,
  formatInFrac,
  metricBase,
  segText,
} from './units';

export type Op = '+' | '-' | '*' | '/';
export type Key =
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | 'frac' | 'back'
  | Op | '=' | '%' | 'sqrt' | 'm+' | 'rcl' | 'conv' | 'onc'
  | LinUnit | 'bdft' | 'weight'
  | 'pitch' | 'rise' | 'run' | 'diag' | 'hip' | 'stair' | 'circ' | 'rwall' | 'jack';

export const OP_SYMBOL: Record<Op, string> = { '+': '+', '-': '−', '*': '×', '/': '÷' };

export type PitchForm = 'inch' | 'deg' | 'pct' | 'slope';
export type WeightUnit = 'ton' | 'lb' | 'mton' | 'kg';
export type WtVolFmt = 'ton/cuyd' | 'lb/cuyd' | 'lb/cuft' | 'mton/cum' | 'kg/cum';
export type ErrCode = 'DIM' | 'DIV' | 'ENT' | 'OFL' | 'NONE';

export interface Prefs {
  denom: Denom;
  area: 'std' | 'sqft' | 'sqyd' | 'sqm';
  volume: 'std' | 'cuyd' | 'cuft' | 'cum';
  meters: 'fixed' | 'float';
  degrees: 'fixed' | 'float';
  fracMode: 'std' | 'const';
}

/** Values the calculator remembers until Clear All (Conv ×). */
export interface Stored {
  riserHt: number; // inches
  treadW: number; // inches
  oc: number; // inches
  wtVol: { value: number; fmt: WtVolFmt };
}

export const DEFAULT_PREFS: Prefs = {
  denom: 16,
  area: 'std',
  volume: 'std',
  meters: 'fixed',
  degrees: 'fixed',
  fracMode: 'std',
};

export const DEFAULT_STORED: Stored = {
  riserHt: 7.5,
  treadW: 10,
  oc: 16,
  wtVol: { value: 1.5, fmt: 'ton/cuyd' },
};

export interface EntryPart {
  text: string; // "12", "6.5", "3/4"
  unit: LinUnit;
  power: 1 | 2 | 3; // Feet Feet = square, Feet Feet Feet = cubic
}

/** What's being typed: e.g. 12 Feet 6 Inch 3/4 = parts [12 ft, 6 in] + frac "3" + digits "4" */
export interface Entry {
  parts: EntryPart[];
  digits: string;
  frac: string | null; // numerator once "/" is pressed; digits then holds the denominator
  neg: boolean;
  special?: number; // π
}

export type Display =
  | { kind: 'qty'; q: Quantity; label?: string; mark?: string; pct?: number }
  | { kind: 'pitch'; slope: number; form: PitchForm; ir?: boolean }
  | { kind: 'angle'; deg: number; label: string }
  | { kind: 'weight'; lb: number; unit: WeightUnit }
  | { kind: 'cost'; dollars: number }
  | { kind: 'wtvol'; value: number; fmt: WtVolFmt }
  | { kind: 'text'; text: string }
  | { kind: 'error'; code: ErrCode; hint: string };

type TriKey = 'pitch' | 'rise' | 'run' | 'diag';

export interface Tri {
  pitch?: number; // slope = rise ÷ run
  rise?: Quantity;
  run?: Quantity;
  diag?: Quantity;
  /** Entered values, oldest first. The last two entered solve the triangle. */
  order: TriKey[];
  irPitch?: number;
}

/** A function key pressed repeatedly steps through answers (Stair, Jack, Circ, ...). */
interface Seq {
  key: 'pitch' | 'circ' | 'hip' | 'jack' | 'irjack' | 'rwall' | 'stair' | 'weight' | 'weightEntry' | 'mem' | 'wtvol';
  i: number;
  base?: Quantity;
}

export interface TapeLine {
  tag: string;
  text: string;
}

export interface CalcState {
  entry: Entry | null;
  acc: Quantity | null;
  op: Op | null;
  display: Display;
  /** Display holds a value the user just entered or calculated, so Rise/Run/Circ/etc. will store it */
  fresh: boolean;
  prefix: 'conv' | 'rcl' | null;
  seq: Seq | null;
  tri: Tri;
  dia: Quantity | null;
  memory: { total: Quantity; count: number } | null;
  stored: Stored;
  prefs: Prefs;
  tempDenom: Denom | null;
  tape: TapeLine[];
  /** Lines ever put on the tape (the tape keeps only the last 50), so the screen can save new ones to History */
  tapeCount: number;
  lastKey: Key | null;
  oncCount: number;
  /** Asks the screen to open the tape or preferences */
  ui: 'tape' | 'prefs' | null;
}

const ZERO: Display = { kind: 'qty', q: { value: 0, dim: 0 } };

export function createState(prefs: Prefs = DEFAULT_PREFS, stored: Stored = DEFAULT_STORED, pitch?: number): CalcState {
  return {
    entry: null,
    acc: null,
    op: null,
    display: ZERO,
    fresh: false,
    prefix: null,
    seq: null,
    tri: pitch ? { pitch, order: ['pitch'] } : { order: [] },
    dia: null,
    memory: null,
    stored,
    prefs,
    tempDenom: null,
    tape: [],
    tapeCount: 0,
    lastKey: null,
    oncCount: 0,
    ui: null,
  };
}

export const initialState = createState();

// ---------- errors ----------

interface Fail {
  err: ErrCode;
  hint: string;
}

function isFail(x: unknown): x is Fail {
  return typeof x === 'object' && x !== null && 'err' in x;
}

function fail(s: CalcState, f: Fail): CalcState {
  return { ...s, entry: null, acc: null, op: null, display: { kind: 'error', code: f.err, hint: f.hint }, fresh: false, seq: null };
}

const NEED_TRIANGLE: Fail = { err: 'NONE', hint: 'Enter any 2 of Pitch, Rise, Run, Diag first.' };
const NEED_PITCH_RUN: Fail = { err: 'NONE', hint: 'Enter the Pitch and Run (or any 2 of Pitch, Rise, Run, Diag) first.' };
const NEED_LENGTHS: Fail = { err: 'DIM', hint: 'Use Feet or Inch on Rise, Run and Diag for this.' };

const DIM_NAME = ['a plain number', 'a length', 'an area', 'a volume'];

// ---------- unit bookkeeping ----------

const PRIORITY: Show[] = [
  'ftin', 'ftdec', 'yd', 'infrac', 'indec', 'm', 'cm', 'mm',
  'sqft', 'sqyd', 'sqin', 'sqm', 'sqcm', 'sqmm',
  'cuyd', 'cuft', 'bdft', 'cuin', 'cum', 'cucm', 'cumm',
];

function familyOf(q: Quantity): Family {
  return q.show ? SHOWS[q.show].family : 'ft';
}

/** Adding feet to inches shows feet; a metric + imperial sum keeps the first one's units. */
function mergeShow(a?: Show, b?: Show): Show | undefined {
  if (!a || !b) return a ?? b;
  const metric = (x: Show) => SHOWS[x].family === 'metric';
  if (metric(a) !== metric(b)) return a;
  return PRIORITY.indexOf(a) <= PRIORITY.indexOf(b) ? a : b;
}

function applyPref(show: Show, dim: Dim, prefs: Prefs): Show {
  if (dim === 2 && prefs.area !== 'std') return prefs.area;
  if (dim === 3 && prefs.volume !== 'std') return prefs.volume;
  return show;
}

function powerShow(family: Family, base: LinUnit, dim: 2 | 3): Show {
  if (family === 'in') return dim === 2 ? 'sqin' : 'cuin';
  if (family === 'yd') return dim === 2 ? 'sqyd' : 'cuyd';
  if (family === 'metric') return dim === 2 ? SQ_SHOW[base] : CU_SHOW[base];
  return dim === 2 ? 'sqft' : 'cuyd'; // feet: square feet, cubic yards (like the CM5)
}

/** Length × length: inches stay inches, feet give square feet and cubic yards, metric stays metric. */
function productShow(parts: Quantity[], dim: 2 | 3, prefs: Prefs): Show {
  const fams = parts.map(familyOf);
  let show: Show;
  if (fams.every((f) => f === 'in')) show = powerShow('in', 'in', dim);
  else if (fams.every((f) => f === 'yd')) show = powerShow('yd', 'yd', dim);
  else if (fams.every((f) => f === 'metric')) {
    const bases = parts.map((p) => metricBase(p.show!));
    show = powerShow('metric', bases.every((b) => b === bases[0]) ? bases[0] : 'm', dim);
  } else show = powerShow('ft', 'ft', dim);
  return applyPref(show, dim, prefs);
}

function lengthShowFor(q: Quantity): Show {
  const fam = familyOf(q);
  if (fam === 'in') return 'infrac';
  if (fam === 'yd') return 'yd';
  if (fam === 'metric') return metricBase(q.show!);
  return 'ftin';
}

function areaShowFor(q: Quantity, prefs: Prefs): Show {
  const fam = familyOf(q);
  const base = fam === 'metric' ? metricBase(q.show!) : 'ft';
  return applyPref(powerShow(fam === 'yd' ? 'yd' : fam, base, 2), 2, prefs);
}

function maxRes(a?: number, b?: number): number | undefined {
  const r = Math.max(a ?? 0, b ?? 0);
  return r || undefined;
}

export function applyOp(a: Quantity, op: Op, b: Quantity, prefs: Prefs): Quantity | Fail {
  let value = 0;
  let dim = 0;
  let show: Show | undefined;
  switch (op) {
    case '+':
    case '-':
      if (a.dim !== b.dim) return { err: 'DIM', hint: `Can't add or subtract ${DIM_NAME[a.dim]} and ${DIM_NAME[b.dim]}.` };
      value = op === '+' ? a.value + b.value : a.value - b.value;
      dim = a.dim;
      show = mergeShow(a.show, b.show);
      break;
    case '*':
      dim = a.dim + b.dim;
      if (dim > 3) return { err: 'DIM', hint: 'That would go past cubic units.' };
      value = a.value * b.value;
      show = a.dim === 0 ? b.show : b.dim === 0 ? a.show : productShow([a, b], dim as 2 | 3, prefs);
      break;
    case '/':
      if (b.value === 0) return { err: 'DIV', hint: "Can't divide by zero." };
      dim = a.dim - b.dim;
      if (dim < 0) return { err: 'DIM', hint: "Can't divide by a bigger unit (like feet ÷ square feet)." };
      value = a.value / b.value;
      if (b.dim === 0) show = a.show;
      else if (dim === 1) show = lengthShowFor(a);
      else if (dim === 2) show = areaShowFor(a, prefs);
      break;
  }
  if (!Number.isFinite(value)) return { err: 'OFL', hint: 'Number too big.' };
  return { value, dim: dim as Dim, show, res: maxRes(a.res, b.res) };
}

// ---------- typing numbers ----------

const METRIC: LinUnit[] = ['m', 'cm', 'mm'];
const ORDER: Record<string, number> = { yd: 0, ft: 1, in: 2 };
const POWER_SHOW = { 2: SQ_SHOW, 3: CU_SHOW } as const;

const newEntry = (): Entry => ({ parts: [], digits: '', frac: null, neg: false });
const isEmptyEntry = (e: Entry) => !e.parts.length && e.digits === '' && e.frac === null && e.special === undefined;

function typeInto(entry: Entry, key: string): Entry | null {
  const e = entry.special !== undefined ? newEntry() : entry; // typing replaces π
  const last = e.parts[e.parts.length - 1];
  if (last && last.power > 1) return null; // "130 Feet Feet" is finished
  if (/^\d$/.test(key)) {
    if (e.digits.replace('.', '').length >= 10) return null;
    return { ...e, digits: e.digits === '0' ? key : e.digits + key };
  }
  if (key === '.') {
    if (e.frac !== null || e.digits.includes('.')) return null;
    return { ...e, digits: (e.digits || '0') + '.' };
  }
  // fraction bar
  if (e.frac !== null || e.digits === '' || e.digits.includes('.')) return null;
  if (last && METRIC.includes(last.unit)) return null;
  return { ...e, frac: e.digits, digits: '' };
}

function addUnit(entry: Entry, unit: LinUnit, denom: Denom): Entry | null {
  let e = entry;
  if (e.special !== undefined) e = { ...newEntry(), digits: String(Number(e.special.toFixed(9))), neg: e.neg };
  const last = e.parts[e.parts.length - 1];
  const trailing = e.digits !== '' || e.frac !== null;
  if (!trailing) {
    // 130 Feet Feet = 130 square feet; 5 Yds Yds Yds = 5 cubic yards
    if (e.parts.length === 1 && last.unit === unit && last.power < 3) {
      return { ...e, parts: [{ ...last, power: (last.power + 1) as 2 | 3 }] };
    }
    return null;
  }
  if (last && last.power > 1) return null;
  if (METRIC.includes(unit)) {
    if (e.parts.length) return null;
  } else if (last) {
    if (METRIC.includes(last.unit) || ORDER[unit] <= ORDER[last.unit]) return null; // biggest unit first
    if (e.frac !== null && unit !== 'in') return null;
  }
  const text = e.frac !== null ? `${e.frac}/${e.digits || denom}` : e.digits;
  return { ...e, parts: [...e.parts, { text, unit, power: 1 }], digits: '', frac: null };
}

function backspaceEntry(e: Entry): Entry | null {
  if (e.special !== undefined) return null;
  let next: Entry;
  if (e.digits !== '') next = { ...e, digits: e.digits.slice(0, -1) };
  else if (e.frac !== null) next = { ...e, digits: e.frac, frac: null };
  else {
    const last = e.parts[e.parts.length - 1];
    if (!last) return null;
    const rest = e.parts.slice(0, -1);
    if (last.power > 1) next = { ...e, parts: [...rest, { ...last, power: (last.power - 1) as 1 | 2 }] };
    else if (last.text.includes('/')) {
      const [n, d] = last.text.split('/');
      next = { ...e, parts: rest, frac: n, digits: d };
    } else next = { ...e, parts: rest, digits: last.text };
  }
  return isEmptyEntry(next) ? null : next;
}

function partValue(text: string): number | null {
  if (text.includes('/')) {
    const [n, d] = text.split('/').map(Number);
    return d ? n / d : null;
  }
  const n = Number(text);
  return Number.isNaN(n) ? null : n;
}

function fracRes(den: number): number {
  return [2, 4, 8, 16, 32, 64].includes(den) ? den : 0;
}

/** Turn what was typed into a value. A fraction with no unit is inches (44/64 = 0-44/64 INCH). */
export function evalEntry(e: Entry, denom: Denom): Quantity | Fail {
  const sign = e.neg ? -1 : 1;
  const bad: Fail = { err: 'ENT', hint: 'Check the number you typed.' };
  if (e.special !== undefined) return { value: sign * e.special, dim: 0 };
  let total = 0;
  let res = 0;
  let isLen = false;
  for (const p of e.parts) {
    const n = partValue(p.text);
    if (n === null) return bad;
    if (p.text.includes('/')) res = Math.max(res, fracRes(Number(p.text.split('/')[1])));
    if (p.power > 1) {
      const power = p.power as 2 | 3;
      return { value: sign * n * LIN[p.unit] ** power, dim: power, show: POWER_SHOW[power][p.unit], res: res || undefined };
    }
    total += n * LIN[p.unit];
    isLen = true;
  }
  const last = e.parts[e.parts.length - 1];
  const trailing = e.digits !== '' || e.frac !== null;
  if (e.frac !== null) {
    const den = e.digits === '' ? denom : Number(e.digits);
    if (!den) return { err: 'ENT', hint: "A fraction can't have 0 on the bottom." };
    total += Number(e.frac) / den;
    res = Math.max(res, fracRes(den));
    isLen = true;
  } else if (e.digits !== '') {
    const n = Number(e.digits);
    if (Number.isNaN(n)) return bad;
    if (!last) return { value: sign * n, dim: 0 };
    if (last.unit !== 'ft' && last.unit !== 'yd') return { err: 'ENT', hint: 'Finish the fraction with / (like 6 Inch 1/2).' };
    total += n; // 12 Feet 6 = 12 feet 6 inches
  }
  if (!isLen) return bad;
  return { value: sign * total, dim: 1, show: entryShow(e, trailing), res: res || undefined };
}

function entryShow(e: Entry, trailing: boolean): Show {
  const first = e.parts[0];
  if (!first) return 'infrac';
  switch (first.unit) {
    case 'ft':
      return e.parts.length === 1 && !trailing && first.text.includes('.') ? 'ftdec' : 'ftin';
    case 'in':
      return 'infrac';
    case 'yd':
      return e.parts.length === 1 && !trailing ? 'yd' : 'ftin';
    default:
      return first.unit;
  }
}

const UNIT_WORD: Record<LinUnit, string> = { yd: 'YD', ft: 'FEET', in: 'INCH', m: 'M', cm: 'CM', mm: 'MM' };

/** How the entry looks while typing: 6 FEET 2-1/2 INCH */
export function entrySegs(e: Entry): Seg[] {
  if (e.special !== undefined) return [{ t: (e.neg ? '−' : '') + fmtCM(e.special) }];
  const segs: Seg[] = e.parts.map((p) => ({
    t: p.unit === 'in' && p.text.includes('/') ? `0-${p.text}` : p.text,
    u: p.power === 1 ? UNIT_WORD[p.unit] : `${p.power === 2 ? 'SQ' : 'CU'} ${UNIT_WORD[p.unit]}`,
  }));
  if (e.frac !== null) {
    const f = `${e.frac}/${e.digits}`;
    const last = e.parts[e.parts.length - 1];
    if (last && last.unit === 'in' && last.power === 1) {
      segs[segs.length - 1] = { t: `${segs[segs.length - 1].t}-${f}`, u: 'INCH' };
    } else segs.push({ t: `0-${f}`, u: 'INCH' });
  } else if (e.digits !== '') segs.push({ t: e.digits });
  if (!segs.length) segs.push({ t: '0' });
  if (e.neg) segs[0] = { ...segs[0], t: `−${segs[0].t}` };
  return segs;
}

// ---------- reading the display back as a number ----------

const LB_PER: Record<WeightUnit, number> = { ton: 2000, lb: 1, mton: 2204.6226218, kg: 2.2046226218 };
const WEIGHT_WORD: Record<WeightUnit, string> = { ton: 'Ton', lb: 'LB', mton: 'MET Ton', kg: 'kG' };
const WEIGHT_ORDER: WeightUnit[] = ['ton', 'lb', 'mton', 'kg'];
const WTVOL_ORDER: WtVolFmt[] = ['ton/cuyd', 'lb/cuyd', 'lb/cuft', 'mton/cum', 'kg/cum'];
const WTVOL_WORD: Record<WtVolFmt, string> = {
  'ton/cuyd': 'Ton Per CU YD',
  'lb/cuyd': 'LB Per CU YD',
  'lb/cuft': 'LB Per CU FEET',
  'mton/cum': 'MET Ton Per CU M',
  'kg/cum': 'kG Per CU M',
};

function lbPerCuIn(w: Stored['wtVol']): number {
  const cuInPerCuM = LIN.m ** 3;
  switch (w.fmt) {
    case 'ton/cuyd':
      return (w.value * 2000) / 46656;
    case 'lb/cuyd':
      return w.value / 46656;
    case 'lb/cuft':
      return w.value / 1728;
    case 'mton/cum':
      return (w.value * LB_PER.mton) / cuInPerCuM;
    case 'kg/cum':
      return (w.value * LB_PER.kg) / cuInPerCuM;
  }
}

/** The displayed answer as a value that can keep being used in math. */
export function valueOf(d: Display): Quantity | null {
  switch (d.kind) {
    case 'qty':
      return d.pct !== undefined ? { value: d.pct / 100, dim: 0 } : d.q;
    case 'pitch':
      if (d.form === 'inch') return { value: d.slope * 12, dim: 1, show: 'infrac' };
      if (d.form === 'deg') return { value: (Math.atan(d.slope) * 180) / Math.PI, dim: 0 };
      if (d.form === 'pct') return { value: d.slope * 100, dim: 0 };
      return { value: d.slope, dim: 0 };
    case 'angle':
      return { value: d.deg, dim: 0 };
    case 'weight':
      return { value: d.lb / LB_PER[d.unit], dim: 0 };
    case 'cost':
      return { value: d.dollars, dim: 0 };
    case 'wtvol':
      return { value: d.value, dim: 0 };
    default:
      return null;
  }
}

/** The number in the units shown (feet for FEET-INCH, board feet for BDFT, ...). */
function shownNumber(q: Quantity): number {
  return q.show ? q.value / SHOWS[q.show].per : q.value;
}

// ---------- formatting ----------

function denomFor(s: CalcState, q?: Quantity): number {
  return s.tempDenom ?? Math.max(s.prefs.denom, q?.res ?? 0);
}

function fmtDeg(deg: number, prefs: Prefs): string {
  return `${prefs.degrees === 'fixed' ? fixed(deg, 2) : fmtCM(deg)}°`;
}

export function formatQty(q: Quantity, prefs: Prefs, denom: number): Seg[] | null {
  const reduce = prefs.fracMode === 'std';
  const show = q.show ?? (q.dim === 1 ? 'ftin' : q.dim === 2 ? 'sqft' : q.dim === 3 ? 'cuyd' : undefined);
  if (!show || q.dim === 0) {
    if (Math.abs(q.value) > MAX_DISPLAY) return null;
    return [{ t: fmtCM(q.value) }];
  }
  const n = q.value / SHOWS[show].per;
  if (Math.abs(n) > MAX_DISPLAY) return null;
  if (show === 'ftin') return formatFtIn(q.value, denom, reduce);
  if (show === 'infrac') return formatInFrac(q.value, denom, reduce);
  const t = show === 'm' && prefs.meters === 'fixed' ? fixed(n, 3).replace('-', '−') : fmtCM(n);
  return [{ t, u: SHOWS[show].word }];
}

function qtyText(q: Quantity, s: CalcState): string {
  const segs = formatQty(q, s.prefs, denomFor(s, q));
  return segs ? segText(segs) : 'OFL';
}

function pushTape(s: CalcState, tag: string, text: string): CalcState {
  return { ...s, tape: [...s.tape, { tag, text }].slice(-50), tapeCount: s.tapeCount + 1 };
}

// ---------- getting the value a function key works on ----------

interface Input {
  q: Quantity;
  pct?: number;
  s: CalcState;
}

/** Typed entry (finishing any pending + − × ÷), else the display if it was just entered or calculated. */
function takeInput(s: CalcState): Input | Fail | null {
  if (s.entry) return finishEntry(s);
  if (s.fresh) {
    const q = valueOf(s.display);
    if (q) return { q, pct: s.display.kind === 'qty' ? s.display.pct : undefined, s: { ...s, fresh: false } };
  }
  return null;
}

/** Like takeInput, but falls back to whatever is on the display (for conversions, memory, √ ...). */
function currentValue(s: CalcState): Input | Fail | null {
  if (s.entry) return finishEntry(s);
  const q = valueOf(s.display);
  return q ? { q, s } : null;
}

function finishEntry(s: CalcState): Input | Fail {
  const v = evalEntry(s.entry!, s.prefs.denom);
  if (isFail(v)) return v;
  if (s.acc && s.op) {
    const r = applyOp(s.acc, s.op, v, s.prefs);
    if (isFail(r)) return r;
    let t = pushTape(s, OP_SYMBOL[s.op], qtyText(v, s));
    t = pushTape(t, 'TTL=', qtyText(r, s));
    return { q: r, s: { ...t, entry: null, acc: null, op: null } };
  }
  return { q: v, s: { ...s, entry: null } };
}

function show(s: CalcState, display: Display, fresh = false): CalcState {
  return { ...s, display, fresh };
}

// ---------- right triangle ----------

interface Solved {
  slope: number;
  rise: Quantity;
  run: Quantity;
  diag: Quantity;
}

function solveTri(tri: Tri): Solved | Fail {
  const known = tri.order.slice(-2);
  if (known.length < 2) return NEED_TRIANGLE;
  const lens = known.filter((k) => k !== 'pitch').map((k) => tri[k as 'rise' | 'run' | 'diag']!);
  if (lens.length === 2 && lens[0].dim !== lens[1].dim) {
    return { err: 'DIM', hint: 'Give Rise, Run and Diag the same kind of units (Feet/Inch).' };
  }
  const proto = lens[0];
  const has = (k: TriKey) => known.includes(k);
  const v = (k: 'rise' | 'run' | 'diag') => tri[k]!.value;
  const bad: Fail = { err: 'ENT', hint: "Those values can't make a right triangle." };
  let slope: number;
  let rise: number;
  let run: number;
  let diag: number;
  if (has('pitch')) {
    slope = tri.pitch!;
    if (has('rise')) {
      rise = v('rise');
      run = rise / slope;
    } else if (has('run')) {
      run = v('run');
      rise = run * slope;
    } else {
      diag = v('diag');
      run = diag / Math.sqrt(1 + slope * slope);
      rise = run * slope;
    }
  } else if (has('rise') && has('run')) {
    rise = v('rise');
    run = v('run');
    if (run === 0) return bad;
    slope = rise / run;
  } else if (has('rise')) {
    rise = v('rise');
    diag = v('diag');
    if (diag <= rise) return bad;
    run = Math.sqrt(diag * diag - rise * rise);
    slope = rise / run;
  } else {
    run = v('run');
    diag = v('diag');
    if (diag <= run) return bad;
    rise = Math.sqrt(diag * diag - run * run);
    slope = rise / run;
  }
  diag = Math.sqrt(rise * rise + run * run);
  if (!Number.isFinite(run) || !Number.isFinite(rise)) return bad;
  const res = lens.reduce<number | undefined>((r, q) => maxRes(r, q.res), undefined);
  const mk = (value: number): Quantity => ({ value, dim: proto.dim, show: proto.show, res });
  return { slope, rise: mk(rise), run: mk(run), diag: mk(diag) };
}

const TRI_LABEL = { rise: 'RISE', run: 'RUN', diag: 'DIAG' } as const;

function withTri(s: CalcState, key: TriKey, patch: Partial<Tri>): CalcState {
  return { ...s, tri: { ...s.tri, ...patch, order: [...s.tri.order.filter((k) => k !== key), key] } };
}

function triKey(s0: CalcState, key: 'rise' | 'run' | 'diag'): CalcState {
  const inp = takeInput(s0);
  if (isFail(inp)) return fail(s0, inp);
  if (inp) {
    if (inp.q.dim > 1) return fail(s0, { err: 'DIM', hint: `${TRI_LABEL[key]} must be a length.` });
    const patch: Partial<Tri> = {};
    patch[key] = inp.q;
    const s = withTri(inp.s, key, patch);
    return pushTape(show(s, { kind: 'qty', q: inp.q, label: TRI_LABEL[key] }), TRI_LABEL[key], qtyText(inp.q, s));
  }
  const sol = solveTri(s0.tri);
  if (isFail(sol)) return fail(s0, sol);
  const q = sol[key];
  return pushTape(show(s0, { kind: 'qty', q, label: TRI_LABEL[key] }), TRI_LABEL[key], qtyText(q, s0));
}

/** Pitch typed as 9 Inch, 30 (degrees), 75 % or (with Conv) a 0.75 ratio */
function readPitch(inp: Input, ratio: boolean): { slope: number; form: PitchForm } | Fail {
  const { q } = inp;
  const bad: Fail = { err: 'ENT', hint: 'Pitch must be more than 0 and less than 90°.' };
  let slope: number;
  let form: PitchForm;
  if (ratio) {
    if (q.dim !== 0) return { err: 'DIM', hint: 'A pitch ratio has no units (like 0.625).' };
    slope = q.value;
    form = 'slope';
  } else if (inp.pct !== undefined) {
    slope = inp.pct / 100;
    form = 'pct';
  } else if (q.dim === 1) {
    slope = q.value / 12;
    form = 'inch';
  } else if (q.dim === 0) {
    if (q.value <= 0 || q.value >= 90) return bad;
    slope = Math.tan((q.value * Math.PI) / 180);
    form = 'deg';
  } else return { err: 'DIM', hint: 'Enter pitch as inches of rise (9 Inch), degrees, or a percent.' };
  if (!(slope > 0) || !Number.isFinite(slope)) return bad;
  return { slope, form };
}

const PITCH_CYCLE: PitchForm[] = ['inch', 'deg', 'pct', 'slope'];

function pitchKey(s0: CalcState, prev: Seq | null, ratio: boolean): CalcState {
  const inp = takeInput(s0);
  if (isFail(inp)) return fail(s0, inp);
  if (inp) {
    const p = readPitch(inp, ratio);
    if (isFail(p)) return fail(s0, p);
    const s = withTri(inp.s, 'pitch', { pitch: p.slope });
    return { ...show(s, { kind: 'pitch', slope: p.slope, form: p.form }), seq: { key: 'pitch', i: 0 } };
  }
  if (prev?.key === 'pitch' && s0.display.kind === 'pitch') {
    const form = PITCH_CYCLE[(PITCH_CYCLE.indexOf(s0.display.form) + 1) % 4];
    return { ...show(s0, { ...s0.display, form }), seq: prev };
  }
  let slope: number | undefined;
  if (s0.tri.order.slice(-2).includes('pitch')) slope = s0.tri.pitch;
  else {
    const sol = solveTri(s0.tri);
    if (isFail(sol)) {
      if (s0.tri.pitch === undefined) return fail(s0, sol);
      slope = s0.tri.pitch;
    } else slope = sol.slope;
  }
  return { ...show(s0, { kind: 'pitch', slope: slope!, form: 'inch' }), seq: { key: 'pitch', i: 0 } };
}

function irPitchKey(s0: CalcState): CalcState {
  const inp = takeInput(s0);
  if (isFail(inp)) return fail(s0, inp);
  if (inp) {
    const p = readPitch(inp, false);
    if (isFail(p)) return fail(s0, p);
    const s = { ...inp.s, tri: { ...inp.s.tri, irPitch: p.slope } };
    return show(s, { kind: 'pitch', slope: p.slope, form: p.form, ir: true });
  }
  if (s0.tri.irPitch === undefined) {
    return fail(s0, { err: 'NONE', hint: 'Type the irregular pitch first, like 8 Inch, then Conv Hip/V.' });
  }
  return show(s0, { kind: 'pitch', slope: s0.tri.irPitch, form: 'inch', ir: true });
}

/** The common rafter's run and slope, needed by Hip/V, Jack and R/Wall. */
function rafter(s: CalcState): { sol: Solved } | Fail {
  const sol = solveTri(s.tri);
  if (isFail(sol)) return sol.err === 'NONE' ? NEED_PITCH_RUN : sol;
  if (sol.run.dim !== 1) return NEED_LENGTHS;
  return { sol };
}

function hipKey(s: CalcState, prev: Seq | null): CalcState {
  const r = rafter(s);
  if (isFail(r)) return fail(s, r);
  const { sol } = r;
  const ir = s.tri.irPitch;
  const label = ir ? 'IH/V' : 'H/V';
  const run1 = sol.run.value;
  const rise = sol.rise.value;
  const plan = ir ? Math.hypot(run1, rise / ir) : run1 * Math.SQRT2;
  if (prev?.key === 'hip' && prev.i === 1) {
    const deg = (Math.atan2(rise, plan) * 180) / Math.PI;
    return { ...show(s, { kind: 'angle', deg, label }), seq: { key: 'hip', i: 0 } };
  }
  const q: Quantity = { ...sol.run, value: Math.hypot(plan, rise) };
  return { ...pushTape(show(s, { kind: 'qty', q, label }), label, qtyText(q, s)), seq: { key: 'hip', i: 1 } };
}

function jackKey(s: CalcState, side: 'jack' | 'irjack', i: number): CalcState {
  const r = rafter(s);
  if (isFail(r)) return fail(s, r);
  const ir = s.tri.irPitch;
  if (side === 'irjack' && ir === undefined) {
    return fail(s, { err: 'NONE', hint: 'Enter the irregular pitch first (like 8 Inch, then Conv Hip/V).' });
  }
  const tag = side === 'jack' ? 'JK' : 'IJ';
  const oc = s.stored.oc;
  if (i === 0) {
    const q: Quantity = { value: oc, dim: 1, show: 'infrac' };
    return { ...show(s, { kind: 'qty', q, label: `${tag}OC` }), seq: { key: side, i: 1 } };
  }
  const { sol } = r;
  const run1 = sol.run.value;
  const run2 = ir ? sol.rise.value / ir : run1;
  // Regular-side jacks get shorter by o.c. × (run1 ÷ run2); irregular-side ones by o.c. × (run2 ÷ run1).
  const sideRun = side === 'jack' ? run1 : run2;
  const step = side === 'jack' ? (oc * run1) / run2 : (oc * run2) / run1;
  const slope = side === 'jack' ? sol.slope : ir!;
  const jackRun = sideRun - i * step;
  const done = jackRun <= 1e-9;
  const q: Quantity = { ...sol.run, value: done ? 0 : jackRun * Math.sqrt(1 + slope * slope) };
  const label = `${tag} ${i}`;
  return { ...pushTape(show(s, { kind: 'qty', q, label }), label, qtyText(q, s)), seq: done ? null : { key: side, i: i + 1 } };
}

function rwallKey(s0: CalcState, prev: Seq | null): CalcState {
  let s = s0;
  let i = 0;
  let base: Quantity | undefined;
  if (prev?.key === 'rwall') {
    i = prev.i;
    base = prev.base;
  } else {
    const inp = takeInput(s0);
    if (isFail(inp)) return fail(s0, inp);
    if (inp) {
      if (inp.q.dim !== 1) return fail(s0, { err: 'DIM', hint: 'The base must be a length (like 5 Feet).' });
      base = inp.q;
      s = inp.s;
    }
  }
  const r = rafter(s);
  if (isFail(r)) return fail(s0, r);
  const { sol } = r;
  const run = sol.run.value;
  const baseQ: Quantity = base ?? { value: 0, dim: 1, show: sol.run.show };
  const studs = Math.max(0, Math.ceil(run / s.stored.oc - 1e-9) - 1);
  let display: Display;
  if (i === 0) display = { kind: 'qty', q: { value: s.stored.oc, dim: 1, show: 'infrac' }, label: 'RWOC' };
  else if (i <= studs) {
    const q: Quantity = { ...sol.run, value: baseQ.value + (run - i * s.stored.oc) * sol.slope };
    display = { kind: 'qty', q, label: `RW ${i}` };
  } else if (i === studs + 1) display = { kind: 'qty', q: { ...baseQ, show: sol.run.show }, label: 'BASE' };
  else display = { kind: 'angle', deg: (Math.atan(sol.slope) * 180) / Math.PI, label: 'RW' };
  const next = i >= studs + 2 ? null : { key: 'rwall' as const, i: i + 1, base: baseQ };
  return { ...show(s, display), seq: next };
}

function stairKey(s: CalcState, prev: Seq | null): CalcState {
  const rise = s.tri.rise;
  if (!rise) {
    return fail(s, { err: 'NONE', hint: 'Enter the floor-to-floor Rise first (like 10 Feet 1 Inch Rise).' });
  }
  if (rise.dim !== 1 || (s.tri.run && s.tri.run.dim !== 1)) return fail(s, NEED_LENGTHS);
  const { riserHt, treadW } = s.stored;
  const d = s.prefs.denom;
  const round = (x: number) => Math.round(x * d) / d;
  const risers = Math.max(1, Math.round(rise.value / riserHt));
  const riser = rise.value / risers;
  const treads = risers - 1;
  const runQ = s.tri.run;
  const tread = runQ && treads ? runQ.value / treads : treadW;
  const totalRun = runQ ? runQ.value : treads * treadW;
  const rr = round(riser);
  const tr = round(tread);
  const inch = (value: number): Quantity => ({ value, dim: 1, show: 'infrac' });
  const len = (value: number): Quantity => ({ value, dim: 1, show: rise.show });
  const steps: Display[] = [
    { kind: 'qty', q: inch(riser), label: 'R-HT', mark: rr > riserHt + 1e-9 ? '▲' : undefined },
    { kind: 'qty', q: { value: risers, dim: 0 }, label: 'RSRS' },
    { kind: 'qty', q: inch(risers * rr - rise.value), label: 'R+/–' },
    { kind: 'qty', q: inch(tread), label: 'T-WD', mark: tr > treadW + 1e-9 ? '▲' : undefined },
    { kind: 'qty', q: { value: treads, dim: 0 }, label: 'TRDS' },
    { kind: 'qty', q: inch(runQ ? treads * tr - runQ.value : 0), label: 'T+/–' },
    { kind: 'qty', q: len(treads * Math.hypot(rr, tr)), label: 'STRG' },
    { kind: 'angle', deg: (Math.atan2(rr, tr) * 180) / Math.PI, label: 'INCL' },
    { kind: 'qty', q: len(totalRun), label: 'RUN' },
    { kind: 'qty', q: rise, label: 'RISE' },
    { kind: 'qty', q: inch(riserHt), label: 'R-HT' },
    { kind: 'qty', q: inch(treadW), label: 'T-WD' },
  ];
  const i = prev?.key === 'stair' ? prev.i : 0;
  return { ...show(s, steps[i]), seq: { key: 'stair', i: (i + 1) % steps.length } };
}

// ---------- circles ----------

function circKey(s0: CalcState, prev: Seq | null): CalcState {
  let s = s0;
  let i = 0;
  if (prev?.key === 'circ' && s.dia) i = prev.i;
  else {
    const inp = takeInput(s0);
    if (isFail(inp)) return fail(s0, inp);
    if (inp) {
      if (inp.q.dim > 1) return fail(s0, { err: 'DIM', hint: 'The diameter must be a length.' });
      s = { ...inp.s, dia: inp.q };
    } else if (!s.dia) return fail(s0, { err: 'NONE', hint: 'Type the diameter first, then press Circ.' });
  }
  const dia = s.dia!;
  let q = dia;
  let label = 'DIA';
  if (i === 1) {
    const value = (Math.PI * dia.value * dia.value) / 4;
    q = dia.dim === 1 ? { value, dim: 2, show: areaShowFor(dia, s.prefs) } : { value, dim: 0 };
    label = 'AREA';
  } else if (i === 2) {
    q = { ...dia, value: Math.PI * dia.value };
    label = 'CIRC';
  }
  let out = show(s, { kind: 'qty', q, label });
  if (i > 0) out = pushTape(out, label, qtyText(q, s));
  return { ...out, seq: { key: 'circ', i: (i + 1) % 3 } };
}

function arcKey(s0: CalcState): CalcState {
  if (!s0.dia) return fail(s0, { err: 'NONE', hint: 'Enter the diameter and press Circ first.' });
  const inp = takeInput(s0);
  if (isFail(inp)) return fail(s0, inp);
  if (!inp) return fail(s0, { err: 'NONE', hint: 'Type an arc length (or angle in degrees), then Conv Circ.' });
  const dia = s0.dia;
  const circumference = Math.PI * dia.value;
  if (inp.q.dim === 1 && dia.dim === 1) {
    return show(inp.s, { kind: 'angle', deg: (inp.q.value / circumference) * 360, label: 'ARC' });
  }
  if (inp.q.dim === 0) {
    return show(inp.s, { kind: 'qty', q: { ...dia, value: (circumference * inp.q.value) / 360 }, label: 'ARC' });
  }
  return fail(s0, { err: 'DIM', hint: 'Enter the arc as a length or an angle.' });
}

// ---------- conversions & misc ----------

function convertTo(s0: CalcState, unit: LinUnit): CalcState {
  const cv = currentValue(s0);
  if (isFail(cv)) return fail(s0, cv);
  if (!cv) return s0;
  let q = cv.q;
  let next: Show;
  if (q.dim === 0) {
    q = { value: q.value * LIN[unit], dim: 1 };
    next = unit === 'ft' ? 'ftin' : unit === 'in' ? 'infrac' : unit;
  } else if (q.dim === 1) {
    if (unit === 'ft') next = q.show === 'ftin' ? 'ftdec' : 'ftin';
    else if (unit === 'in') next = q.show === 'infrac' ? 'indec' : 'infrac';
    else next = unit;
  } else next = q.dim === 2 ? SQ_SHOW[unit] : CU_SHOW[unit];
  const label = !s0.entry && s0.display.kind === 'qty' ? s0.display.label : undefined;
  return show(cv.s, { kind: 'qty', q: { ...q, show: next }, label }, s0.fresh || !!s0.entry);
}

/** 2 × 4 × 16 Bd Ft = 10.66667 board feet (inches × inches × feet ÷ 12) */
function boardFeet(s0: CalcState): CalcState {
  const chain = !!(s0.entry && s0.acc && s0.op);
  const cv = currentValue(s0);
  if (isFail(cv)) return fail(s0, cv);
  if (!cv) return s0;
  let q = cv.q;
  if (q.dim === 0) {
    const bf = chain || (!s0.entry && s0.fresh) ? q.value / 12 : q.value; // a lone number is board feet
    q = { value: bf * 144, dim: 3, show: 'bdft' };
  } else if (q.dim === 3) q = { ...q, show: 'bdft' };
  else return fail(s0, { err: 'DIM', hint: 'Board feet needs a volume, or thickness × width × length.' });
  return pushTape(show(cv.s, { kind: 'qty', q }, true), 'BDFT', qtyText(q, s0));
}

function weightKey(s0: CalcState, prev: Seq | null, conv: boolean): CalcState {
  const d = s0.display;
  if (!s0.entry && d.kind === 'weight') {
    const unit = WEIGHT_ORDER[(WEIGHT_ORDER.indexOf(d.unit) + 1) % 4];
    if (!conv && prev?.key === 'weightEntry') {
      // still labeling a typed weight: 150 Weight Weight = 150 LB
      return { ...show(s0, { kind: 'weight', lb: (d.lb / LB_PER[d.unit]) * LB_PER[unit], unit }, true), seq: prev };
    }
    return { ...show(s0, { kind: 'weight', lb: d.lb, unit }, true), seq: { key: 'weight', i: 0 } };
  }
  const cv = currentValue(s0);
  if (isFail(cv)) return fail(s0, cv);
  if (!cv) return s0;
  if (cv.q.dim === 3) {
    const lb = cv.q.value * lbPerCuIn(s0.stored.wtVol);
    return { ...show(cv.s, { kind: 'weight', lb, unit: 'ton' }, true), seq: { key: 'weight', i: 0 } };
  }
  if (cv.q.dim === 0) {
    return { ...show(cv.s, { kind: 'weight', lb: cv.q.value * LB_PER.ton, unit: 'ton' }, true), seq: { key: 'weightEntry', i: 0 } };
  }
  return fail(s0, { err: 'DIM', hint: 'Weight needs a volume (like 20 Yds Yds Yds) or a number.' });
}

function wtVolKey(s0: CalcState): CalcState {
  const inp = takeInput(s0);
  if (isFail(inp)) return fail(s0, inp);
  if (inp) {
    if (inp.q.dim !== 0 || inp.q.value <= 0) return fail(s0, { err: 'ENT', hint: 'Type the weight per volume as a number.' });
    const wtVol = { value: inp.q.value, fmt: 'ton/cuyd' as WtVolFmt };
    return { ...show({ ...inp.s, stored: { ...inp.s.stored, wtVol } }, { kind: 'wtvol', ...wtVol }), seq: { key: 'wtvol', i: 0 } };
  }
  return show(s0, { kind: 'wtvol', ...s0.stored.wtVol });
}

function cycleWtVol(s: CalcState, prev: Seq): CalcState {
  const w = s.stored.wtVol;
  const wtVol = { value: w.value, fmt: WTVOL_ORDER[(WTVOL_ORDER.indexOf(w.fmt) + 1) % WTVOL_ORDER.length] };
  return { ...show({ ...s, stored: { ...s.stored, wtVol } }, { kind: 'wtvol', ...wtVol }), seq: prev };
}

const SETTING_LABEL = { riserHt: 'R-HT', treadW: 'T-WD', oc: 'o.c.' } as const;

function storeSetting(s0: CalcState, which: 'riserHt' | 'treadW' | 'oc'): CalcState {
  const inp = takeInput(s0);
  if (isFail(inp)) return fail(s0, inp);
  let s = s0;
  if (inp) {
    if (inp.q.dim > 1 || inp.q.value <= 0) return fail(s0, { err: 'ENT', hint: 'Type a length, like 8 Inch.' });
    const stored = { ...inp.s.stored };
    stored[which] = inp.q.value; // a plain number counts as inches
    s = { ...inp.s, stored };
  }
  const q: Quantity = { value: s.stored[which], dim: 1, show: 'infrac' };
  return show(s, { kind: 'qty', q, label: SETTING_LABEL[which] });
}

function costKey(s0: CalcState): CalcState {
  if (!(s0.entry && s0.acc && s0.op === '*')) {
    return fail(s0, { err: 'ENT', hint: 'For cost: quantity × price per unit, then Conv . (Cost).' });
  }
  const price = evalEntry(s0.entry, s0.prefs.denom);
  if (isFail(price)) return fail(s0, price);
  if (price.dim !== 0) return fail(s0, { err: 'DIM', hint: 'The price is a plain number.' });
  // Board feet are priced per thousand (MBM), like the Construction Master.
  const dollars = (shownNumber(s0.acc) * price.value) / (s0.acc.show === 'bdft' ? 1000 : 1);
  const s = { ...s0, entry: null, acc: null, op: null };
  return pushTape(show(s, { kind: 'cost', dollars }, true), '$', fixed(dollars, 2));
}

function unary(s0: CalcState, fn: 'sqrt' | 'sq' | 'inv'): CalcState {
  const cv = currentValue(s0);
  if (isFail(cv)) return fail(s0, cv);
  if (!cv) return s0;
  const { q } = cv;
  let r: Quantity;
  if (fn === 'sqrt') {
    if (q.value < 0) return fail(s0, { err: 'ENT', hint: "Can't take the square root of a negative." });
    if (q.dim === 0) r = { value: Math.sqrt(q.value), dim: 0 };
    else if (q.dim === 2) r = { value: Math.sqrt(q.value), dim: 1, show: lengthShowFor(q), res: q.res };
    else return fail(s0, { err: 'DIM', hint: 'Square root works on plain numbers and areas.' });
  } else if (fn === 'sq') {
    if (q.dim === 0) r = { value: q.value * q.value, dim: 0 };
    else if (q.dim === 1) r = { value: q.value * q.value, dim: 2, show: productShow([q, q], 2, s0.prefs), res: q.res };
    else return fail(s0, { err: 'DIM', hint: 'x² works on plain numbers and lengths.' });
  } else {
    if (q.dim !== 0) return fail(s0, { err: 'DIM', hint: '1/x works on plain numbers.' });
    if (q.value === 0) return fail(s0, { err: 'DIV', hint: "Can't divide by zero." });
    r = { value: 1 / q.value, dim: 0 };
  }
  return show(cv.s, { kind: 'qty', q: r }, true);
}

function toggleSign(s: CalcState): CalcState {
  if (s.entry) return { ...s, entry: { ...s.entry, neg: !s.entry.neg } };
  const d = s.display;
  if (d.kind === 'qty') return show(s, { ...d, q: { ...d.q, value: -d.q.value } }, s.fresh);
  const q = valueOf(d);
  return q ? show(s, { kind: 'qty', q: { ...q, value: -q.value } }, true) : s;
}

function percent(s0: CalcState): CalcState {
  if (!s0.entry) return s0;
  const b = evalEntry(s0.entry, s0.prefs.denom);
  if (isFail(b)) return fail(s0, b);
  if (b.dim !== 0) return fail(s0, { err: 'DIM', hint: 'A percent is a plain number.' });
  if (!(s0.acc && s0.op)) {
    return show({ ...s0, entry: null }, { kind: 'qty', q: { value: b.value / 100, dim: 0 }, pct: b.value }, true);
  }
  const a = s0.acc;
  const p = b.value / 100;
  let value = a.value;
  switch (s0.op) {
    case '+':
      value = a.value * (1 + p);
      break;
    case '-':
      value = a.value * (1 - p);
      break;
    case '*':
      value = a.value * p;
      break;
    case '/':
      if (p === 0) return fail(s0, { err: 'DIV', hint: "Can't divide by zero." });
      value = a.value / p;
      break;
  }
  const r: Quantity = { ...a, value };
  let s = pushTape(s0, OP_SYMBOL[s0.op], `${fmtCM(b.value)} %`);
  s = pushTape(s, 'TTL=', qtyText(r, s));
  return show({ ...s, entry: null, acc: null, op: null }, { kind: 'qty', q: r }, true);
}

function memAdd(s0: CalcState, sign: 1 | -1, prev: Seq | null): CalcState {
  const mem = s0.memory;
  if (sign > 0 && prev?.key === 'mem' && mem && !s0.entry) {
    // after Rcl M+: M+ shows the average, then the count, then the total again
    const step = prev.i;
    const display: Display =
      step === 1
        ? { kind: 'qty', q: { ...mem.total, value: mem.total.value / mem.count }, label: 'AVG' }
        : step === 2
          ? { kind: 'qty', q: { value: mem.count, dim: 0 }, label: 'CNT' }
          : { kind: 'qty', q: mem.total, label: 'TTL' };
    return { ...show(s0, display, true), seq: { key: 'mem', i: (step + 1) % 3 } };
  }
  const cv = currentValue(s0);
  if (isFail(cv)) return fail(s0, cv);
  if (!cv) return s0;
  const v = cv.q;
  if (mem && mem.total.dim !== v.dim) {
    return fail(s0, { err: 'DIM', hint: `Memory holds ${DIM_NAME[mem.total.dim]}; this is ${DIM_NAME[v.dim]}.` });
  }
  const total: Quantity = mem
    ? { ...mem.total, value: mem.total.value + sign * v.value, res: maxRes(mem.total.res, v.res) }
    : { ...v, value: sign * v.value };
  const label = sign > 0 ? 'M+' : 'M-';
  const s = { ...cv.s, memory: { total, count: (mem?.count ?? 0) + 1 } };
  return pushTape(show(s, { kind: 'qty', q: v, label }), label, qtyText(v, s));
}

function onClear(s: CalcState): CalcState {
  if (s.oncCount >= 2) {
    // second press: clear temporary values (the entered Pitch stays, like the CM5)
    const { pitch } = s.tri;
    return {
      ...s,
      entry: null,
      acc: null,
      op: null,
      display: ZERO,
      fresh: false,
      tempDenom: null,
      tri: pitch !== undefined ? { pitch, order: ['pitch'] } : { order: [] },
      dia: null,
    };
  }
  // first press with something typed: clear it (a pending + − × ÷ stays, like a "clear entry")
  if (s.entry && s.display.kind !== 'error') return { ...s, entry: null, display: ZERO, fresh: false };
  return { ...s, entry: null, acc: null, op: null, display: ZERO, fresh: false, tempDenom: null };
}

function clearAll(s: CalcState): CalcState {
  return { ...createState(s.prefs), tape: s.tape, tapeCount: s.tapeCount, display: { kind: 'text', text: 'ALL CLEARED' } };
}

function operator(s0: CalcState, op: Op): CalcState {
  if (s0.entry) {
    const v = evalEntry(s0.entry, s0.prefs.denom);
    if (isFail(v)) return fail(s0, v);
    let acc = v;
    if (s0.acc && s0.op) {
      const r = applyOp(s0.acc, s0.op, v, s0.prefs);
      if (isFail(r)) return fail(s0, r);
      acc = r;
    }
    const s = pushTape(s0, s0.op ? OP_SYMBOL[s0.op] : '', qtyText(v, s0));
    return { ...s, entry: null, acc, op, display: { kind: 'qty', q: acc }, fresh: false };
  }
  if (s0.acc && s0.op && showingAcc(s0)) return { ...s0, op }; // changed mind about the operator
  const v = valueOf(s0.display);
  if (!v) return s0;
  if (s0.acc && s0.op) {
    // a recalled or calculated value is the second number
    const r = applyOp(s0.acc, s0.op, v, s0.prefs);
    if (isFail(r)) return fail(s0, r);
    return { ...pushTape(s0, OP_SYMBOL[s0.op], qtyText(v, s0)), acc: r, op, display: { kind: 'qty', q: r }, fresh: false };
  }
  return { ...pushTape(s0, '', qtyText(v, s0)), acc: v, op, display: { kind: 'qty', q: v }, fresh: false };
}

function equals(s0: CalcState): CalcState {
  if (s0.entry) {
    const inp = finishEntry(s0);
    if (isFail(inp)) return fail(s0, inp);
    return show(inp.s, { kind: 'qty', q: inp.q }, true);
  }
  if (s0.acc && s0.op) {
    if (showingAcc(s0)) return show({ ...s0, acc: null, op: null }, { kind: 'qty', q: s0.acc }, true);
    const v = valueOf(s0.display);
    if (!v) return s0;
    const r = applyOp(s0.acc, s0.op, v, s0.prefs);
    if (isFail(r)) return fail(s0, r);
    let s = pushTape(s0, OP_SYMBOL[s0.op], qtyText(v, s0));
    s = pushTape(s, 'TTL=', qtyText(r, s));
    return show({ ...s, acc: null, op: null }, { kind: 'qty', q: r }, true);
  }
  return { ...s0, fresh: s0.display.kind !== 'error' };
}

const isOp = (k: Key | null): k is Op => k === '+' || k === '-' || k === '*' || k === '/';

/** True right after + − × ÷, when the display is just the running total (no second number yet). */
function showingAcc(s: CalcState): boolean {
  return isOp(s.lastKey) || (s.display.kind === 'qty' && s.display.q === s.acc);
}
const isUnit = (k: Key): k is LinUnit => k === 'yd' || k === 'ft' || k === 'in' || k === 'm' || k === 'cm' || k === 'mm';
const isTyping = (k: Key) => /^\d$/.test(k) || k === '.' || k === 'frac';

function typeKey(s: CalcState, key: Key): CalcState {
  const next = typeInto(s.entry ?? newEntry(), key);
  if (!next) return s;
  return { ...s, entry: next, fresh: false };
}

const TEMP_DENOM: Partial<Record<Key, Denom>> = { '1': 16, '2': 2, '3': 32, '4': 4, '6': 64, '8': 8 };

function convKey(s: CalcState, key: Key, prev: Seq | null): CalcState {
  if (isUnit(key)) return convertTo(s, key);
  switch (key) {
    case 'bdft':
      return boardFeet(s);
    case 'weight':
      return weightKey(s, prev, true);
    case 'pitch':
      return pitchKey(s, prev, true);
    case 'hip':
      return irPitchKey(s);
    case 'jack':
      return jackKey(s, 'irjack', 0);
    case 'circ':
      return arcKey(s);
    case '7':
      return storeSetting(s, 'riserHt');
    case '9':
      return storeSetting(s, 'treadW');
    case '5':
      return storeSetting(s, 'oc');
    case '0':
      return wtVolKey(s);
    case '/':
      return unary(s, 'inv');
    case '*':
      return clearAll(s);
    case '-':
      return toggleSign(s);
    case '+':
      return { ...s, entry: { ...newEntry(), special: Math.PI } };
    case 'sqrt':
      return unary(s, 'sq');
    case '.':
      return costKey(s);
    case 'm+':
      return memAdd(s, -1, prev);
    case 'rcl':
      return { ...s, memory: null };
    case '%':
      return { ...s, ui: 'prefs' };
    case '=':
      return { ...s, ui: 'tape' };
  }
  const temp = TEMP_DENOM[key];
  if (temp) {
    // Conv 1/2/3/4/6/8: show the answer in 16ths, halves, 32nds, quarters, 64ths or 8ths
    const cv = currentValue(s);
    if (!cv || isFail(cv)) return s;
    return { ...show(cv.s, s.entry ? { kind: 'qty', q: cv.q } : s.display, s.fresh), tempDenom: temp };
  }
  return plainKey(s, key, prev);
}

function rclKey(s: CalcState, key: Key, prev: Seq | null): CalcState {
  const inch = (value: number): Quantity => ({ value, dim: 1, show: 'infrac' });
  switch (key) {
    case 'rcl': {
      // Rcl Rcl: show the memory total and clear memory
      const total = s.memory?.total ?? { value: 0, dim: 0 };
      return show({ ...s, memory: null }, { kind: 'qty', q: total, label: 'M+' }, true);
    }
    case 'm+':
      if (!s.memory) return show(s, { kind: 'qty', q: { value: 0, dim: 0 }, label: 'TTL' }, true);
      return { ...show(s, { kind: 'qty', q: s.memory.total, label: 'TTL' }, true), seq: { key: 'mem', i: 1 } };
    case '=':
      return { ...s, ui: 'tape' };
    case 'pitch':
      if (s.tri.pitch === undefined) return fail(s, { err: 'NONE', hint: 'No pitch stored yet.' });
      return { ...show(s, { kind: 'pitch', slope: s.tri.pitch, form: 'inch' }), seq: { key: 'pitch', i: 0 } };
    case 'rise':
    case 'run':
    case 'diag': {
      const q = s.tri[key];
      if (q) return show(s, { kind: 'qty', q, label: TRI_LABEL[key] });
      return triKey({ ...s, entry: null, fresh: false }, key);
    }
    case 'hip':
      return irPitchKey({ ...s, entry: null, fresh: false });
    case 'stair':
    case '7':
      return show(s, { kind: 'qty', q: inch(s.stored.riserHt), label: 'R-HT' });
    case '9':
      return show(s, { kind: 'qty', q: inch(s.stored.treadW), label: 'T-WD' });
    case '5':
      return show(s, { kind: 'qty', q: inch(s.stored.oc), label: 'o.c.' });
    case '0':
      return show(s, { kind: 'wtvol', ...s.stored.wtVol });
    case 'circ':
      if (!s.dia) return fail(s, { err: 'NONE', hint: 'No diameter stored yet.' });
      return { ...show(s, { kind: 'qty', q: s.dia, label: 'DIA' }), seq: { key: 'circ', i: 1 } };
  }
  return plainKey(s, key, prev);
}

function plainKey(s: CalcState, key: Key, prev: Seq | null): CalcState {
  if (key === '0' && prev?.key === 'wtvol') return cycleWtVol(s, prev);
  if (isTyping(key)) return typeKey(s, key);
  if (isUnit(key)) {
    if (s.entry) {
      const next = addUnit(s.entry, key, s.prefs.denom);
      return next ? { ...s, entry: next } : s;
    }
    return convertTo(s, key);
  }
  if (isOp(key)) return operator(s, key);
  switch (key) {
    case 'back':
      return s.entry ? { ...s, entry: backspaceEntry(s.entry) } : s;
    case '=':
      return equals(s);
    case '%':
      return percent(s);
    case 'sqrt':
      return unary(s, 'sqrt');
    case 'm+':
      return memAdd(s, 1, prev);
    case 'onc':
      return onClear(s);
    case 'bdft':
      return boardFeet(s);
    case 'weight':
      return weightKey(s, prev, false);
    case 'pitch':
      return pitchKey(s, prev, false);
    case 'rise':
    case 'run':
    case 'diag':
      return triKey(s, key);
    case 'hip':
      return hipKey(s, prev);
    case 'jack':
      if (prev?.key === 'irjack') return jackKey(s, 'irjack', prev.i);
      return jackKey(s, 'jack', prev?.key === 'jack' ? prev.i : 0);
    case 'rwall':
      return rwallKey(s, prev);
    case 'stair':
      return stairKey(s, prev);
    case 'circ':
      return circKey(s, prev);
  }
  return s;
}

export function press(state: CalcState, key: Key): CalcState {
  const prev = state.seq;
  const prefix = state.prefix;
  let s: CalcState = {
    ...state,
    seq: null,
    prefix: null,
    ui: null,
    oncCount: key === 'onc' ? state.oncCount + 1 : 0,
  };
  if (s.display.kind === 'error' && !s.entry) {
    // after an error, On/C clears it and typing starts over; other keys are ignored
    if (key === 'onc') return { ...onClear({ ...s, oncCount: 1 }), lastKey: key };
    if (!isTyping(key)) return { ...state, prefix: null };
    s = { ...s, display: ZERO, acc: null, op: null };
  }
  let out: CalcState;
  if (prefix === 'conv') out = key === 'conv' ? { ...s, seq: prev } : convKey(s, key, prev);
  else if (prefix === 'rcl') out = key === 'conv' ? { ...s, prefix: 'conv', seq: prev } : rclKey(s, key, prev);
  else if (key === 'conv') out = { ...s, prefix: 'conv', seq: prev };
  else if (key === 'rcl') out = { ...s, prefix: 'rcl', seq: prev };
  else out = plainKey(s, key, prev);
  return { ...out, lastKey: key };
}

export function pressAll(keys: Key[], state: CalcState = initialState): CalcState {
  return keys.reduce(press, state);
}

export function setPrefs(s: CalcState, prefs: Prefs): CalcState {
  return { ...s, prefs };
}

// ---------- what the screen shows ----------

const INFO: Record<string, string> = {
  PTCH: 'Pitch (inches of rise per foot)',
  SLP: 'Slope (rise ÷ run)',
  '%GRD': 'Percent grade',
  IPCH: 'Irregular pitch',
  RISE: 'Rise',
  RUN: 'Run',
  DIAG: 'Diagonal / common rafter',
  'H/V': 'Hip/valley rafter',
  'IH/V': 'Irregular hip/valley rafter',
  JKOC: 'Jack spacing (on center)',
  IJOC: 'Irregular-side jack spacing',
  RWOC: 'Stud spacing (on center)',
  BASE: 'Base added to each stud',
  RW: 'Rake wall angle',
  'R-HT': 'Riser height',
  RSRS: 'Number of risers',
  'R+/–': 'Riser over/under',
  'T-WD': 'Tread width',
  TRDS: 'Number of treads',
  'T+/–': 'Tread over/under',
  STRG: 'Stringer length',
  INCL: 'Stair angle',
  DIA: 'Diameter',
  AREA: 'Circle area',
  CIRC: 'Circumference',
  ARC: 'Arc',
  'M+': 'Memory',
  'M-': 'Subtracted from memory',
  TTL: 'Memory total',
  AVG: 'Memory average',
  CNT: 'Memory count',
  'o.c.': 'On-center spacing',
  'wt/vol': 'Weight per volume',
  $: 'Total cost',
};

function infoFor(label: string): string {
  const m = label.match(/^(JK|IJ|RW) (\d+)$/);
  if (m) return `${m[1] === 'JK' ? 'Jack rafter' : m[1] === 'IJ' ? 'Irregular-side jack' : 'Rake wall stud'} ${m[2]}`;
  return INFO[label] ?? '';
}

export interface View {
  label: string;
  segs: Seg[];
  text: string;
  mark: string;
  info: string;
  extra: string;
  pending: string;
  flags: string[];
  isError: boolean;
}

const ERR_TEXT: Record<ErrCode, string> = {
  DIM: 'DIM Error',
  DIV: 'DIV Error',
  ENT: 'ENT Error',
  OFL: 'OFL Error',
  NONE: 'NEED DATA',
};

export function view(s: CalcState): View {
  let label = '';
  let segs: Seg[] = [];
  let mark = '';
  let extra = '';
  let info = '';
  let isError = false;
  const d = s.display;
  if (s.entry) segs = entrySegs(s.entry);
  else {
    switch (d.kind) {
      case 'qty': {
        label = d.label ?? '';
        mark = d.mark ?? '';
        if (d.pct !== undefined) segs = [{ t: fmtCM(d.pct), u: '%' }];
        else {
          const f = formatQty(d.q, s.prefs, denomFor(s, d.q));
          if (!f) {
            segs = [{ t: ERR_TEXT.OFL }];
            isError = true;
            break;
          }
          segs = f;
          if (d.q.dim === 3 && d.q.show !== 'cuft') extra = `= ${fmtCM(d.q.value / 1728)} CU FEET`;
          else if (d.q.dim === 3) extra = `= ${fmtCM(d.q.value / 46656)} CU YD`;
        }
        break;
      }
      case 'pitch': {
        const form = d.form;
        label = form === 'pct' ? '%GRD' : form === 'slope' ? 'SLP' : d.ir ? 'IPCH' : 'PTCH';
        const deg = (Math.atan(d.slope) * 180) / Math.PI;
        const inchSegs = formatInFrac(d.slope * 12, denomFor(s), s.prefs.fracMode === 'std');
        const parts: Record<PitchForm, string> = {
          inch: `${inchSegs[0].t} in 12`,
          deg: fmtDeg(deg, s.prefs),
          pct: `${fmtCM(d.slope * 100)}%`,
          slope: fmtCM(d.slope),
        };
        segs =
          form === 'inch'
            ? inchSegs
            : form === 'deg'
              ? [{ t: fmtDeg(deg, s.prefs) }]
              : [{ t: fmtCM(form === 'pct' ? d.slope * 100 : d.slope) }];
        extra = PITCH_CYCLE.filter((f) => f !== form && f !== 'slope').map((f) => parts[f]).join(' · ');
        break;
      }
      case 'angle':
        label = d.label;
        segs = [{ t: fmtDeg(d.deg, s.prefs) }];
        break;
      case 'weight':
        segs = [{ t: fmtCM(d.lb / LB_PER[d.unit]), u: WEIGHT_WORD[d.unit] }];
        info = 'Weight';
        break;
      case 'cost':
        label = '$';
        segs = [{ t: fixed(d.dollars, 2) }];
        break;
      case 'wtvol':
        label = 'wt/vol';
        segs = [{ t: fmtCM(d.value), u: WTVOL_WORD[d.fmt] }];
        break;
      case 'text':
        segs = [{ t: d.text }];
        break;
      case 'error':
        segs = [{ t: ERR_TEXT[d.code] }];
        info = d.hint;
        isError = true;
        break;
    }
  }
  if (!info && label) info = infoFor(label) + (mark ? ' (over your target)' : '');
  const flags: string[] = [];
  if (s.memory) flags.push('M');
  if (s.prefix === 'conv') flags.push('CONV');
  if (s.prefix === 'rcl') flags.push('RCL');
  if (s.tri.irPitch !== undefined) flags.push('IR');
  if (s.tempDenom) flags.push(`1/${s.tempDenom}`);
  const pending = s.acc && s.op ? `${qtyText(s.acc, s)} ${OP_SYMBOL[s.op]}` : '';
  return { label, segs, text: segText(segs), mark, info, extra, pending, flags, isError };
}
