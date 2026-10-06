// Editing a foundation layout, one step at a time, the way the editor screen does it: start from the
// main house already in the job, build an add-on off one of its walls, put walls inside it by the bays
// between them, and drop slabs into bays. Every step returns a new layout (nothing changes in place),
// so the screen can undo by keeping the old one. Also the feet-and-inches box: 40, 40 6, 40-6, 40'6".

import type { FiguredItem } from '../report/report';
import { AddOnSpec, buildLayout, fillBays, LayoutSpec, SIDE_NAME, sideLength, Side, SlabSpot } from '../report/foundationLayout';
import { findFoundation } from '../report/foundation';
import { parseLength, RawLength, RawValues } from '../tools/run';
import type { Job } from './jobs';

/** "40" → 40, "40 6" / "40-6" / "40'6" / "40' 6\"" → 40.5, "6\"" → 0.5, "40.5" → 40.5. Null if it isn't a length. */
export function parseFtIn(text: string): number | null {
  const s = text.trim().replace(/[”″]/g, '"').replace(/[’′]/g, "'");
  if (!s) return null;
  let m = s.match(/^(\d+(?:\.\d+)?)\s*"$/);
  if (m) return Number(m[1]) / 12;
  m = s.match(/^(\d+(?:\.\d+)?)\s*'?$/);
  if (m) return Number(m[1]);
  m = s.match(/^(\d+)\s*(?:'\s*-?\s*|-|\s+)(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+))?\s*"?$/);
  if (m) return Number(m[1]) + (Number(m[2]) + (m[3] ? Number(m[3]) / Number(m[4]) : 0)) / 12;
  return null;
}

/** 47.333 → 47' 4"   10 → 10'   0.5 → 6" (no decimals, to the nearest 1/4") */
export function fmtFtIn(ft: number): string {
  if (!Number.isFinite(ft)) return '';
  const neg = ft < 0;
  let whole = Math.floor(Math.abs(ft) + 1e-9);
  let q = Math.round((Math.abs(ft) - whole) * 48); // quarter inches
  if (q >= 48) {
    whole += 1;
    q = 0;
  }
  const inch = Math.floor(q / 4);
  const frac = ['', '¼', '½', '¾'][q % 4];
  const inText = inch || frac ? `${inch || ''}${frac}"` : '';
  const text = whole ? `${whole}'${inText ? ` ${inText}` : ''}` : inText || `0'`;
  return neg ? `−${text}` : text;
}

const ftOf = (v: unknown) => parseLength(v as RawLength) ?? 0;

/** Where a new layout starts: the main house already in the job, and which items it takes the place of. */
export interface Start {
  spec: LayoutSpec;
  wall: RawValues;
  footing: RawValues;
  slab: RawValues;
  replace: string[];
  /** "70' × 70' stem wall" */
  label: string;
}

const REBAR_KEYS = ['bars', 'lines', 'barSize', 'vSpacing', 'stockLength', 'lap', 'waste', 'truck', 'price'];
const pick = (raw: RawValues, keys: string[]) => Object.fromEntries(keys.filter((k) => raw[k] !== undefined).map((k) => [k, raw[k]]));

/** A blank layout, sized from the defaults (8" × 4' wall, 16" × 10" footing, 4" slab). */
export function blankLayout(): LayoutSpec {
  return { house: { length: 0, width: 0 }, wall: { thick: 8 / 12, height: 4 }, footing: { width: 16 / 12, depth: 10 / 12 }, addOns: [], slabs: [] };
}

/**
 * The main house from what's in the job: a rectangle wall (Footings & Walls), its footing and slab, or
 * the foundation you said goes together. Null if there's no rectangle house to start from.
 */
export function startFromJob(items: FiguredItem[], job: Job): Start | null {
  const ok = (f: FiguredItem) => f.result.status === 'ok';
  const wall = items.find((f) => ok(f) && f.tool.id === 'footings' && f.item.raw.kind === 'wall' && f.item.raw.shape === 'rect');
  const fnd = findFoundation(items, job);
  const rect = fnd?.rect ?? (wall ? { L: ftOf(wall.item.raw.bLength), W: ftOf(wall.item.raw.bWidth) } : null);
  if (!rect || !(rect.L > 0 && rect.W > 0)) return null;
  const wallItem = fnd?.walls[0] ?? wall;
  const footing = fnd?.footings[0] ?? items.find((f) => ok(f) && f.tool.id === 'footings' && f.item.raw.kind !== 'wall' && f.item.raw.shape === 'rect');
  const slab = fnd?.slab ?? null;
  const spec = blankLayout();
  spec.house = { length: rect.L, width: rect.W };
  if (wallItem) {
    const r = wallItem.item.raw;
    if (wallItem.tool.id === 'wall-forms') spec.wall = { thick: (Number(r.thick) || 8) / 12, height: ftOf(r.height1) + ftOf(r.height2) || 4 };
    else spec.wall = { thick: ftOf(r.width) || 8 / 12, height: ftOf(r.depth) || 4 };
  }
  spec.footing = footing ? { width: ftOf(footing.item.raw.width) || 16 / 12, depth: ftOf(footing.item.raw.depth) || 10 / 12 } : spec.footing;
  if (slab) spec.slabs = [{ at: { in: 'main' }, thick: ftOf(slab.item.raw.thick) || 4 / 12 }];
  if (job.together?.slabDropIn?.trim()) spec.slabDropIn = Number(job.together.slabDropIn) || 0;
  const replace = [wallItem, footing, slab, ...(fnd ? [...fnd.footings, ...fnd.footingBars] : [])].filter((f): f is FiguredItem => !!f).map((f) => f.item.id);
  const kind = fnd?.kind ?? (spec.wall.height >= 6 ? 'basement' : 'stem wall');
  return {
    spec,
    wall: wallItem ? pick(wallItem.item.raw, REBAR_KEYS) : {},
    footing: footing ? pick(footing.item.raw, REBAR_KEYS) : {},
    slab: slab ? pick(slab.item.raw, ['slabRebar', 'pickBars', 'barSize', 'spacing', 'waste', 'truck', 'price']) : {},
    replace: [...new Set(replace)],
    label: `${fmtFtIn(rect.L)} × ${fmtFtIn(rect.W)} ${kind.toLowerCase()}`,
  };
}

/** Why an add-on won't fit on that wall, in plain words; null if it fits. */
export function addOnProblem(spec: LayoutSpec, a: AddOnSpec): string | null {
  const wall = sideLength(spec, a.side);
  const from = a.from ?? 0;
  const t = spec.wall.thick;
  if (!(a.depth > 0)) return 'Put in how far it comes out.';
  if (!(a.width > 0)) return 'Put in how wide it is.';
  if (a.depth <= 2 * t) return `It has to come out more than ${fmtFtIn(2 * t)} to fit its walls.`;
  if (a.width <= 2 * t) return `It has to be wider than ${fmtFtIn(2 * t)} to fit its walls.`;
  if (from < 0 || from >= wall - 2 * t) return `It has to start on the wall: the main ${SIDE_NAME[a.side]} wall is ${fmtFtIn(wall)} long.`;
  if (from + a.width > wall + 1 / 96) return `The main ${SIDE_NAME[a.side]} wall is only ${fmtFtIn(wall)}. Starting ${fmtFtIn(from)} in, it can be up to ${fmtFtIn(Math.max(0, wall - from))} wide.`;
  if (spec.addOns.some((o) => o !== a && o.side === a.side && from < (o.from ?? 0) + o.width && (o.from ?? 0) < from + a.width)) return 'There is already an add-on on that part of the wall.';
  return null;
}

/** Adds an add-on (or replaces add-on `index`). Slabs in the old one's bays are dropped if the bays change. */
export function putAddOn(spec: LayoutSpec, a: AddOnSpec, index?: number): LayoutSpec {
  if (index === undefined) return { ...spec, addOns: [...spec.addOns, a] };
  return { ...spec, addOns: spec.addOns.map((o, i) => (i === index ? a : o)) };
}

export function removeAddOn(spec: LayoutSpec, index: number): LayoutSpec {
  return {
    ...spec,
    addOns: spec.addOns.filter((_, i) => i !== index),
    slabs: spec.slabs
      .filter((s) => !(s.at.in === 'addon' && s.at.addOn === index))
      .map((s) => (s.at.in === 'addon' && s.at.addOn > index ? { ...s, at: { ...s.at, addOn: s.at.addOn - 1 } } : s)),
  };
}

/**
 * Walls inside add-on `index`: which way they run and the bays between them (clear, wall face to wall
 * face; null = the rest). Slabs in bays that no longer exist are dropped.
 */
export function setInside(spec: LayoutSpec, index: number, inside: 'out' | 'across', bays: (number | null)[]): LayoutSpec {
  const next = putAddOn(spec, { ...spec.addOns[index], inside, bays }, index);
  return { ...next, slabs: next.slabs.filter((s) => !(s.at.in === 'addon' && s.at.addOn === index && s.at.bay >= bays.length)) };
}

/** Why those inside walls don't fit, in plain words; null if they do. */
export function insideProblem(spec: LayoutSpec, index: number, inside: 'out' | 'across', bays: (number | null)[]): string | null {
  const a = { ...spec.addOns[index], inside, bays };
  const f = fillBays(a, spec.wall.thick);
  if (f.over > 0) return `Those bays come to ${fmtFtIn(f.room + f.over)}, but there's only ${fmtFtIn(f.room)} clear. Make one smaller or leave one blank.`;
  if (f.over < 0) return `Those bays come to ${fmtFtIn(f.room + f.over)}, but there's ${fmtFtIn(f.room)} clear. Leave one blank for the rest.`;
  if (f.widths.some((w) => w <= 0)) return `There's no room left for the blank bay. Clear room is ${fmtFtIn(f.room)}.`;
  return null;
}

const sameSpot = (a: SlabSpot, b: SlabSpot) => (a.in === 'main' ? b.in === 'main' : b.in === 'addon' && a.addOn === b.addOn && a.bay === b.bay);

/** Slab in a bay (or the main house) on or off. A new one is its own pour, as thick as the others. */
export function toggleSlab(spec: LayoutSpec, at: SlabSpot): LayoutSpec {
  if (spec.slabs.some((s) => sameSpot(s.at, at))) return { ...spec, slabs: spec.slabs.filter((s) => !sameSpot(s.at, at)) };
  const thick = spec.slabs[0]?.thick ?? 4 / 12;
  return { ...spec, slabs: [...spec.slabs, { at, thick }] };
}

/** Pour a slab with another slab's pour (its pour number), or on its own (undefined). */
export function setPour(spec: LayoutSpec, index: number, pour: number | undefined): LayoutSpec {
  return { ...spec, slabs: spec.slabs.map((s, i) => (i === index ? { ...s, pour } : s)) };
}

export function setBayLabel(spec: LayoutSpec, addOn: number, bay: number, label: string): LayoutSpec {
  const labels = { ...(spec.bayLabels ?? {}) };
  if (label) labels[`${addOn}:${bay}`] = label;
  else delete labels[`${addOn}:${bay}`];
  return { ...spec, bayLabels: labels };
}

/** What a step added, for the "UNDO" note: "150' of wall and footing". */
export function addedRuns(before: LayoutSpec, after: LayoutSpec): number {
  const len = (s: LayoutSpec) => (s.house.length > 0 && s.house.width > 0 ? buildLayout(s).totals.measured : 0);
  return Math.round((len(after) - len(before)) * 96) / 96;
}

export type { Side };
