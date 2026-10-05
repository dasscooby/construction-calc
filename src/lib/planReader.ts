// Reading a plan page: the picture or PDF goes to the app's server, which asks Claude what's on it,
// and comes back as slabs (walked side by side, like Slab Layout), rebar, dowels and notes.

import { AppState, Platform } from 'react-native';

import { allJobs, jobStore } from './jobs';
import { scansForReport } from './scanner';

import { slabLayout } from '../tools/slabLayoutTool';
import { defaultRaw, RawLength, RawOutlineRow, RawValues } from '../tools/run';
import type { EdgeKind } from '../tools/types';

export interface PlanSlab {
  name: string;
  sides: { length_ft: number; turn: 'R' | 'L'; radius_ft: number; edge: EdgeKind }[];
  thickness_in?: number | null;
  footing?: { width_in: number; depth_in: number } | null;
  rebar?: { size: number; spacing_in: number } | null;
  footing_bars?: { size: number; count: number } | null;
  dowels?: { size: number; spacing_in: number; length_in: number } | null;
}

export interface PlanRead {
  slabs: PlanSlab[];
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
  return {
    slabs: Array.isArray(body.slabs) ? body.slabs.filter((s) => Array.isArray(s?.sides)) : [],
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
          jobStore.planDone(job.id, p.id, found.slabs.length || found.notes.length ? { found } : { error: 'Couldn’t find slab sizes on that page.' });
        } catch (e) {
          if (e instanceof OfflineError) return; // still no signal
          jobStore.planDone(job.id, p.id, { error: e instanceof Error ? e.message : 'Couldn’t read the plan.' });
        }
        if (!p.uri) void dropPendingFile(p.id);
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
