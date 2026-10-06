// Reading a plan page: the picture or PDF goes to the app's server, which asks Claude what's on it,
// and comes back as slabs (walked side by side, like Slab Layout), rebar, dowels and notes.

import { AppState, Platform } from 'react-native';

import { allJobs, jobStore } from './jobs';
import { deleteScanFile, scansForReport } from './scanner';

import { slabLayout } from '../tools/slabLayoutTool';
import { defaultRaw, RawLength, RawOutlineRow, RawValues } from '../tools/run';
import type { EdgeKind, WallEnds } from '../tools/types';

export interface PlanSlab {
  name: string;
  sides: { length_ft: number; turn: 'R' | 'L'; radius_ft: number; edge: EdgeKind }[];
  thickness_in?: number | null;
  footing?: { width_in: number; depth_in: number } | null;
  rebar?: { size: number; spacing_in: number } | null;
  footing_bars?: { size: number; count: number } | null;
  dowels?: { size: number; spacing_in: number; length_in: number } | null;
}

export interface PlanWall {
  name: string;
  sides: { length_ft: number; turn: 'R' | 'L' }[];
  thickness_in?: number | null;
  height_in?: number | null;
}
export interface PlanFooting {
  name: string;
  length_ft: number;
  width_in: number;
  depth_in: number;
  corners?: number | null;
  bars?: { size: number; count: number } | null;
}
export interface PlanPier {
  name: string;
  shape: 'round' | 'square';
  size_in: number;
  depth_in: number;
  count: number;
}
export interface PlanSteps {
  name: string;
  steps: number;
  rise_in: number;
  run_in: number;
  width_in: number;
  landing_in?: number | null;
}

export interface PlanRead {
  slabs: PlanSlab[];
  walls?: PlanWall[];
  footings?: PlanFooting[];
  piers?: PlanPier[];
  steps?: PlanSteps[];
  notes: string[];
  unsure: string[];
}

// The web app talks to its own site; the phone app to the live site.
const ENDPOINT = Platform.OS === 'web' ? '/.netlify/functions/read-plan' : 'https://construction-calc-7815.netlify.app/.netlify/functions/read-plan';

/** No signal: the plan waits and is read later. */
export class OfflineError extends Error {}

export async function readPlan(data: string, mediaType: string): Promise<PlanRead> {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.onLine === false) throw new OfflineError('No signal');
  let res: Response;
  try {
    res = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data, mediaType }) });
  } catch {
    throw new OfflineError('No signal');
  }
  // The offline web app answers 504 for anything it can't reach.
  if (res.status === 504) throw new OfflineError('No signal');
  const body = (await res.json().catch(() => ({}))) as Partial<PlanRead> & { error?: string };
  if (!res.ok) throw new Error(body.error ?? 'Couldn’t read the plan right now.');
  const list = <T>(v: unknown, ok: (x: T) => boolean): T[] => (Array.isArray(v) ? (v as T[]).filter((x) => x && ok(x)) : []);
  return {
    slabs: Array.isArray(body.slabs) ? body.slabs.filter((s) => Array.isArray(s?.sides)) : [],
    walls: list<PlanWall>(body.walls, (w) => Array.isArray(w.sides) && w.sides.length > 0),
    footings: list<PlanFooting>(body.footings, (f) => f.length_ft > 0 && f.width_in > 0 && f.depth_in > 0),
    piers: list<PlanPier>(body.piers, (p) => p.size_in > 0 && p.depth_in > 0 && p.count > 0),
    steps: list<PlanSteps>(body.steps, (s) => s.steps > 0 && s.rise_in > 0 && s.run_in > 0 && s.width_in > 0),
    notes: Array.isArray(body.notes) ? body.notes.map(String) : [],
    unsure: Array.isArray(body.unsure) ? body.unsure.map(String) : [],
  };
}

/** Web: lets you pick a PDF or picture and hands back its contents (base64). Call from a tap. */
export function pickPlanFileWeb(): Promise<{ data: string; mediaType: string; name: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,image/jpeg,image/png,image/webp';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => {
        const url = String(reader.result);
        resolve({ data: url.slice(url.indexOf(',') + 1), mediaType: file.type || 'image/jpeg', name: file.name });
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

const len = (ft: number): RawLength => {
  if (!(ft > 0)) return { ft: '', in: '' };
  let whole = Math.floor(ft + 1e-9);
  let inch = Math.round((ft - whole) * 12 * 8) / 8;
  if (inch >= 12) {
    whole += 1;
    inch = 0;
  }
  return { ft: String(whole), in: inch ? String(inch) : '' };
};
const inches = (n: number | undefined | null): RawLength => ({ ft: '', in: n && n > 0 ? String(n) : '' });
/** Bar size the tool offers, nearest to what the plan says. */
const bar = (size: number, from: number, to: number) => String(Math.min(to, Math.max(from, Math.round(size))));

/** A slab from the plan as Slab Layout numbers; anything the plan didn't say keeps your usual numbers. */
export function slabToRaw(s: PlanSlab, base: RawValues = defaultRaw(slabLayout)): RawValues {
  const raw: RawValues = { ...base };
  raw.sides = s.sides.map(
    (side): RawOutlineRow => ({
      length: len(side.length_ft),
      turn: side.turn === 'L' ? 'L' : 'R',
      radius: len(side.radius_ft),
      edge: (['form', 'house', 'dowels', 'slab', 'slabDowels'] as EdgeKind[]).includes(side.edge) ? side.edge : 'form',
    }),
  );
  if (s.thickness_in) raw.thick = inches(s.thickness_in);
  if (s.footing?.width_in && s.footing.depth_in) {
    raw.footing = '1';
    raw.fWidth = inches(s.footing.width_in);
    raw.fDepth = inches(s.footing.depth_in);
  }
  if (s.rebar?.size) {
    raw.slabRebar = '1';
    raw.barSize = bar(s.rebar.size, 3, 5);
    if (s.rebar.spacing_in) raw.spacing = String(s.rebar.spacing_in);
  }
  if (s.footing_bars?.size && raw.footing === '1') {
    raw.footBars = '1';
    raw.fBarSize = bar(s.footing_bars.size, 4, 6);
    if (s.footing_bars.count) raw.fBars = String(s.footing_bars.count);
  }
  if (s.dowels?.size) {
    raw.dowelSize = bar(s.dowels.size, 4, 6);
    if (s.dowels.spacing_in) raw.dowelSpacing = String(s.dowels.spacing_in);
    if (s.dowels.length_in) raw.dowelLength = inches(s.dowels.length_in);
  }
  return raw;
}

// ---- Waiting for signal ----------------------------------------------------------------------
// Web: a picked file waits in the browser's own storage (IndexedDB) until it's read.

const DB = 'plan-queue';
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function store<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction('files', mode).objectStore('files'));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export const savePendingFile = (id: string, data: string) => store('readwrite', (s) => s.put(data, id));
const loadPendingFile = (id: string) => store<string | undefined>('readonly', (s) => s.get(id) as IDBRequest<string | undefined>);
const dropPendingFile = (id: string) => store('readwrite', (s) => s.delete(id)).catch(() => {});

let running = false;

/** Reads every waiting plan it can. Stops at the first sign of no signal and tries again later. */
export async function processPlanQueue(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (const job of allJobs()) {
      for (const p of job.planQueue ?? []) {
        let data: string | undefined;
        if (p.uri) {
          const [url] = await scansForReport([p.uri]);
          data = url ? url.slice(url.indexOf(',') + 1) : undefined;
        } else {
          data = await loadPendingFile(p.id).catch(() => undefined);
        }
        if (!data) {
          jobStore.planDone(job.id, p.id, { error: 'A waiting plan was deleted before it could be read.' });
          continue;
        }
        try {
          const found = await readPlan(data, p.mediaType);
          jobStore.planDone(job.id, p.id, planItems(found).length || found.notes.length ? { found } : { error: 'Couldn’t find any concrete work on that page.' });
        } catch (e) {
          if (e instanceof OfflineError) return; // still no signal
          jobStore.planDone(job.id, p.id, { error: e instanceof Error ? e.message : 'Couldn’t read the plan.' });
        }
        if (!p.uri) void dropPendingFile(p.id);
        // A file picked from Files was copied in only to wait for signal: done with it now. Scanned pages
        // stay, they're the job's plans.
        else if (!(job.scans ?? []).includes(p.uri)) deleteScanFile(p.uri);
      }
    }
  } finally {
    running = false;
  }
}

/** Keeps trying waiting plans: when signal comes back, when the app opens, and every half minute. */
export function startPlanQueue(): () => void {
  const kick = () => void processPlanQueue();
  const timer = setInterval(() => {
    if (allJobs().some((j) => j.planQueue?.length)) kick();
  }, 30_000);
  const sub = AppState.addEventListener('change', (st) => st === 'active' && kick());
  if (Platform.OS === 'web' && typeof window !== 'undefined') window.addEventListener('online', kick);
  setTimeout(kick, 3000);
  return () => {
    clearInterval(timer);
    sub.remove();
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.removeEventListener('online', kick);
  };
}

// ---- Phone app: a PDF or file from Files, or a photo -------------------------------------------
// The picked file is kept with the job (Documents/jobs/<job id>/) so it can wait for signal.

type FS = typeof import('expo-file-system');
const MAX_BYTES = 4_500_000;
const TOO_BIG = 'That file is too big to read (over 4.5 MB). Try one page of the plans, or a picture of it.';
const READABLE = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

async function keepWithJob(jobId: string, srcUri: string, ext: string): Promise<string> {
  const { Directory, File, Paths } = require('expo-file-system') as FS;
  const dir = new Directory(Paths.document, 'jobs', jobId);
  dir.create({ intermediates: true, idempotent: true });
  const dest = new File(dir, `plan-${Date.now()}.${ext}`);
  await new File(srcUri).copy(dest);
  return dest.uri;
}

/** Files app: a PDF or a picture. Null if you back out. Throws with a plain message if it can't be used. */
export async function pickPlanFileNative(jobId: string): Promise<{ uri: string; mediaType: string } | null> {
  let DP: typeof import('expo-document-picker');
  try {
    DP = require('expo-document-picker');
  } catch {
    throw new Error('Picking a PDF needs the newest app version from TestFlight.');
  }
  const r = await DP.getDocumentAsync({ type: ['application/pdf', 'image/jpeg', 'image/png'], copyToCacheDirectory: true });
  if (r.canceled || !r.assets?.length) return null;
  const a = r.assets[0];
  const name = a.name.toLowerCase();
  const mediaType = a.mimeType ?? (name.endsWith('.pdf') ? 'application/pdf' : name.endsWith('.png') ? 'image/png' : 'image/jpeg');
  if (!READABLE.includes(mediaType)) throw new Error('Use a PDF or a picture (JPG or PNG).');
  if (a.size && a.size > MAX_BYTES) throw new Error(TOO_BIG);
  const ext = mediaType === 'application/pdf' ? 'pdf' : mediaType === 'image/png' ? 'png' : 'jpg';
  return { uri: await keepWithJob(jobId, a.uri, ext), mediaType };
}

/** Photos: a picture of the plans. */
export async function pickPlanPhotoNative(jobId: string): Promise<{ uri: string; mediaType: string } | null> {
  let IP: typeof import('expo-image-picker');
  try {
    IP = require('expo-image-picker');
  } catch {
    throw new Error('Picking a photo needs the newest app version from TestFlight.');
  }
  // Saved as JPEG (iPhone photos are often HEIC, which can't be read).
  const r = await IP.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
  if (r.canceled || !r.assets?.length) return null;
  const a = r.assets[0];
  if (a.fileSize && a.fileSize > MAX_BYTES) throw new Error(TOO_BIG);
  return { uri: await keepWithJob(jobId, a.uri, 'jpg'), mediaType: 'image/jpeg' };
}

/** Plain words for whatever went wrong while scanning or picking. */
export const pickError = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e);
  if (/permission|denied|not authorized/i.test(m)) return 'The app needs permission. Go to iPhone Settings → Construction Calc and turn on Camera and Photos.';
  if (/cancel/i.test(m)) return '';
  return m.length < 160 ? m : 'Something went wrong. Try again.';
};

// ---- Everything on the plan, as tools for the job ----------------------------------------------

/** One thing found on a plan, ready to add to a job as a tool. */
export interface PlanItem {
  key: string;
  label: string;
  /** e.g. "4 sides · 4" slab · #4 at 18"" */
  summary: string;
  toolId: string;
  title: string;
  raw: RawValues;
}

const toolRaw = (id: string): RawValues => {
  const { ALL_TOOLS } = require('../tools') as typeof import('../tools');
  const t = ALL_TOOLS.find((x) => x.id === id);
  return t ? defaultRaw(t) : {};
};
const n = (v: number) => String(Math.round(v * 100) / 100);
const ftText = (ft: number) => {
  const l = len(ft);
  return `${l.ft || 0}'${l.in ? ` ${l.in}"` : ''}`;
};

/** Wall panel rows for a wall height: up to 5' is one row; taller is 4' + the rest (5' + 5' at 10'). */
function panelRows(heightFt: number): [number, number] {
  if (heightFt <= 5 + 1e-9) return [heightFt, 0];
  const bottom = heightFt > 9 + 1e-9 ? 5 : 4;
  return [bottom, Math.min(5, heightFt - bottom)];
}

export function planItems(r: PlanRead): PlanItem[] {
  const items: PlanItem[] = [];
  r.slabs.forEach((s, i) => {
    const summary = [
      `${s.sides.length} sides`,
      s.thickness_in ? `${s.thickness_in}" slab` : '',
      s.footing ? `${s.footing.width_in}" × ${s.footing.depth_in}" edge` : '',
      s.rebar ? `#${s.rebar.size} at ${s.rebar.spacing_in}"` : '',
      s.dowels ? `#${s.dowels.size} dowels` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    items.push({ key: `slab${i}`, label: s.name || `Slab ${i + 1}`, summary, toolId: 'slab-layout', title: 'Slab Layout', raw: slabToRaw(s, toolRaw('slab-layout')) });
  });
  (r.walls ?? []).forEach((w, i) => {
    const N = w.sides.length;
    const corner = (k: number) => (w.sides[(k + N) % N].turn === 'R' ? 1 : 0);
    const walls = w.sides.map((side, k) => {
      const outside = corner(k - 1) + corner(k);
      return { length: len(side.length_ft), ends: (outside === 2 ? 'oo' : outside === 1 ? 'oi' : 'ii') as WallEnds };
    });
    const raw: RawValues = { ...toolRaw('wall-forms'), walls };
    if (w.thickness_in) raw.thick = n(w.thickness_in);
    if (w.height_in) {
      const [h1, h2] = panelRows(w.height_in / 12);
      raw.height1 = len(h1);
      raw.height2 = h2 > 0 ? len(h2) : { ft: '', in: '' };
    }
    const total = w.sides.reduce((a, s) => a + s.length_ft, 0);
    const summary = [`${N} walls, ${ftText(total)} around`, w.thickness_in ? `${w.thickness_in}" thick` : '', w.height_in ? `${ftText(w.height_in / 12)} tall` : ''].filter(Boolean).join(' · ');
    items.push({ key: `wall${i}`, label: w.name || 'Foundation walls', summary, toolId: 'wall-forms', title: 'Wall Forms', raw });
  });
  (r.footings ?? []).forEach((f, i) => {
    const raw: RawValues = { ...toolRaw('footings'), shape: 'run', length: len(f.length_ft), width: inches(f.width_in), depth: inches(f.depth_in), qty: '1' };
    items.push({
      key: `foot${i}`,
      label: f.name || 'Footings',
      summary: `${ftText(f.length_ft)} · ${f.width_in}" wide × ${f.depth_in}" thick`,
      toolId: 'footings',
      title: 'Footings & Walls',
      raw,
    });
    if (f.bars?.size && f.bars.count > 0) {
      const braw: RawValues = { ...toolRaw('beam-bars'), run: len(f.length_ft), bars: String(f.bars.count), barSize: bar(f.bars.size, 3, 8) };
      if (f.corners) braw.corners = String(f.corners);
      items.push({
        key: `fbar${i}`,
        label: `${f.name || 'Footing'} bars`,
        summary: `${f.bars.count} #${f.bars.size} along ${ftText(f.length_ft)}${f.corners ? `, ${f.corners} corners` : ''}`,
        toolId: 'beam-bars',
        title: 'Beam & Footing Bars',
        raw: braw,
      });
    }
  });
  (r.piers ?? []).forEach((p, i) => {
    const raw: RawValues = { ...toolRaw('piers'), shape: p.shape === 'square' ? 'square' : 'round', size: inches(p.size_in), height: inches(p.depth_in), qty: String(p.count) };
    items.push({ key: `pier${i}`, label: p.name || 'Piers', summary: `${p.count} × ${p.size_in}" ${p.shape}, ${p.depth_in}" deep`, toolId: 'piers', title: 'Piers & Columns', raw });
  });
  (r.steps ?? []).forEach((s, i) => {
    const raw: RawValues = { ...toolRaw('steps'), steps: String(s.steps), rise: inches(s.rise_in), run: inches(s.run_in), width: inches(s.width_in) };
    if (s.landing_in) raw.landing = inches(s.landing_in);
    items.push({ key: `step${i}`, label: s.name || 'Steps', summary: `${s.steps} steps, ${s.rise_in}" rise × ${s.run_in}" run, ${ftText(s.width_in / 12)} wide`, toolId: 'steps', title: 'Steps', raw });
  });
  return items;
}
