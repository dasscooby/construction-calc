// Jobs: a name, an address, and the calculations added to it (slab, rebar, wall forms ...).
// Each item keeps the numbers typed in, so the report always figures them fresh.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import type { RawValues } from '../tools/run';
import type { PlanRead } from './planReader';

/** A plan picked with no signal, read when the phone is back online. */
export interface PendingPlan {
  id: string;
  mediaType: string;
  /** Phone app: the scanned page file. Web: the file waits in the browser's storage under `id`. */
  uri?: string;
  at: number;
}

export interface JobItem {
  id: string;
  toolId: string;
  title: string;
  /** Optional name like "Garage slab" or "North footing" */
  label: string;
  raw: RawValues;
  at: number;
}

/** A pour in progress: trucks counted in as they arrive. */
export interface Pour {
  startedAt: number;
  trucksIn: number;
  trucks: number;
  totalYd: number;
  truckYd: number;
  done: boolean;
}

/** One line on a bid or bill, kept as typed. */
export interface PriceLine {
  id: string;
  desc: string;
  qty: string;
  unit: string;
  /** Price per unit, dollars */
  price: string;
  /** Where the line came from in the job ("concrete", "item:<id>" ...), so it can stay in sync. Blank = typed by you. */
  src?: string;
}

/** A finger signature: the strokes as an SVG path, in a box w × h. */
export interface Signature {
  d: string;
  w: number;
  h: number;
  name: string;
  at: number;
}

/** Extra work after the bid, priced and signed on its own, added to the final bill. */
export interface ChangeOrder {
  id: string;
  no: number;
  desc: string;
  qty: string;
  unit: string;
  price: string;
  at: number;
  signature?: Signature;
}

/** The concrete order to text the supplier. */
export interface ConcreteOrder {
  psi: string;
  place: 'chute' | 'pump' | 'buggy';
  when: string;
}

/** Last forecast for the job's address. */
export interface Forecast {
  at: number;
  place: string;
  days: { date: string; hi: number; lo: number; rain: number; wind: number }[];
}

export interface Job {
  id: string;
  name: string;
  address: string;
  notes: string;
  createdAt: number;
  /** Last time anything in the job changed (the widget shows the latest job) */
  touchedAt?: number;
  items: JobItem[];
  pour?: Pour;
  /** Scanned plan pages: image files saved on the phone */
  scans?: string[];
  /** Job photos: image files saved on the phone (crew sheet) */
  photos?: string[];
  /** Who the bid and bill go to */
  customer?: string;
  /** Bid / bill lines */
  lines?: PriceLine[];
  /** Sales tax %, as typed */
  taxPct?: string;
  /** Already paid (deposit), dollars, as typed */
  paid?: string;
  /** The customer's signature accepting the bid */
  signature?: Signature;
  changes?: ChangeOrder[];
  order?: ConcreteOrder;
  weather?: Forecast;
  /** Plans waiting for signal to be read */
  planQueue?: PendingPlan[];
  /** What the plans said (cleared when you're done with it) */
  planFound?: PlanRead;
  /** Last plan that couldn't be read, and why */
  planError?: string;
}

const SAVE_KEY = 'jobs-v1';
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

let jobs: Job[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function set(next: Job[]) {
  jobs = next;
  listeners.forEach((l) => l());
  AsyncStorage.setItem(SAVE_KEY, JSON.stringify(jobs)).catch(() => {});
}

function load() {
  if (loaded) return;
  loaded = true;
  AsyncStorage.getItem(SAVE_KEY)
    .then((text) => {
      const saved = text ? (JSON.parse(text) as Job[]) : [];
      if (!Array.isArray(saved)) return;
      jobs = [...jobs, ...saved.filter((s) => s?.id && !jobs.some((j) => j.id === s.id))];
      listeners.forEach((l) => l());
    })
    .catch(() => {});
}

const update = (id: string, fn: (j: Job) => Job) => set(jobs.map((j) => (j.id === id ? { ...fn(j), touchedAt: Date.now() } : j)));

export const jobStore = {
  /** Makes a job and returns its id. Newest jobs go first. */
  create(name: string): string {
    load();
    const now = Date.now();
    const job: Job = { id: newId(), name: name.trim() || 'New job', address: '', notes: '', createdAt: now, touchedAt: now, items: [] };
    set([job, ...jobs]);
    return job.id;
  },
  edit(id: string, patch: Partial<Pick<Job, 'name' | 'address' | 'notes' | 'customer' | 'taxPct' | 'paid'>>) {
    update(id, (j) => ({ ...j, ...patch }));
  },
  remove(id: string) {
    set(jobs.filter((j) => j.id !== id));
  },
  addItem(jobId: string, item: Omit<JobItem, 'id' | 'at' | 'label'> & { label?: string }) {
    update(jobId, (j) => ({ ...j, items: [...j.items, { ...item, label: item.label ?? '', id: newId(), at: Date.now() }] }));
  },
  editItem(jobId: string, itemId: string, patch: Partial<Pick<JobItem, 'label' | 'raw' | 'toolId' | 'title'>>) {
    update(jobId, (j) => ({ ...j, items: j.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)) }));
  },
  removeItem(jobId: string, itemId: string) {
    update(jobId, (j) => ({ ...j, items: j.items.filter((it) => it.id !== itemId) }));
  },
  startPour(jobId: string, totalYd: number, truckYd: number) {
    const trucks = Math.max(1, Math.ceil(totalYd / truckYd - 1e-9));
    update(jobId, (j) => ({ ...j, pour: { startedAt: Date.now(), trucksIn: 0, trucks, totalYd, truckYd, done: false } }));
  },
  /** +1 when a truck is in (−1 to undo). Adds a truck if more show up than planned. */
  countTruck(jobId: string, by: 1 | -1) {
    update(jobId, (j) => {
      if (!j.pour) return j;
      const trucksIn = Math.max(0, j.pour.trucksIn + by);
      return { ...j, pour: { ...j.pour, trucksIn, trucks: Math.max(j.pour.trucks, trucksIn) } };
    });
  },
  finishPour(jobId: string) {
    update(jobId, (j) => (j.pour ? { ...j, pour: { ...j.pour, done: true } } : j));
  },
  clearPour(jobId: string) {
    update(jobId, (j) => ({ ...j, pour: undefined }));
  },
  addScans(jobId: string, uris: string[]) {
    update(jobId, (j) => ({ ...j, scans: [...(j.scans ?? []), ...uris] }));
  },
  sign(jobId: string, signature: Signature | undefined) {
    update(jobId, (j) => ({ ...j, signature }));
  },
  addChange(jobId: string) {
    update(jobId, (j) => {
      const changes = j.changes ?? [];
      const no = changes.reduce((a, c) => Math.max(a, c.no), 0) + 1;
      return { ...j, changes: [...changes, { id: newId(), no, desc: '', qty: '1', unit: '', price: '', at: Date.now() }] };
    });
  },
  editChange(jobId: string, id: string, patch: Partial<Omit<ChangeOrder, 'id' | 'no'>>) {
    update(jobId, (j) => ({ ...j, changes: (j.changes ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  },
  removeChange(jobId: string, id: string) {
    update(jobId, (j) => ({ ...j, changes: (j.changes ?? []).filter((c) => c.id !== id) }));
  },
  setOrder(jobId: string, order: ConcreteOrder) {
    update(jobId, (j) => ({ ...j, order }));
  },
  setWeather(jobId: string, weather: Forecast) {
    // Not a change you made: don't bump the job to the top of the widget.
    set(jobs.map((j) => (j.id === jobId ? { ...j, weather } : j)));
  },
  setLines(jobId: string, lines: Omit<PriceLine, 'id'>[] | PriceLine[]) {
    update(jobId, (j) => ({ ...j, lines: lines.map((l) => ({ ...l, id: 'id' in l && l.id ? l.id : newId() })) }));
  },
  queuePlan(jobId: string, p: Omit<PendingPlan, 'id' | 'at'> & { id?: string }) {
    update(jobId, (j) => ({ ...j, planError: undefined, planQueue: [...(j.planQueue ?? []), { ...p, id: p.id ?? newId(), at: Date.now() }] }));
  },
  /** A queued plan is done: drop it and keep what it said (or why it failed). */
  planDone(jobId: string, planId: string, out: { found?: PlanRead; error?: string }) {
    update(jobId, (j) => {
      const prev = j.planFound;
      const both = <T>(a: T[] | undefined, b: T[] | undefined): T[] => [...(a ?? []), ...(b ?? [])];
      const f = out.found;
      const found: PlanRead | undefined = f
        ? {
            slabs: both(prev?.slabs, f.slabs),
            walls: both(prev?.walls, f.walls),
            footings: both(prev?.footings, f.footings),
            piers: both(prev?.piers, f.piers),
            steps: both(prev?.steps, f.steps),
            notes: both(prev?.notes, f.notes),
            unsure: both(prev?.unsure, f.unsure),
          }
        : prev;
      return { ...j, planQueue: (j.planQueue ?? []).filter((p) => p.id !== planId), planFound: found, planError: out.error };
    });
  },
  setPlanFound(jobId: string, found: PlanRead | undefined) {
    update(jobId, (j) => ({ ...j, planFound: found, planError: undefined }));
  },
  addPhotos(jobId: string, uris: string[]) {
    update(jobId, (j) => ({ ...j, photos: [...(j.photos ?? []), ...uris] }));
  },
  removePhoto(jobId: string, uri: string) {
    update(jobId, (j) => ({ ...j, photos: (j.photos ?? []).filter((p) => p !== uri) }));
  },
  removeScan(jobId: string, uri: string) {
    update(jobId, (j) => ({ ...j, scans: (j.scans ?? []).filter((s) => s !== uri) }));
  },
};

/** Every job, right now (outside of a screen). */
export const allJobs = (): Job[] => {
  load();
  return jobs;
};

/** The job changed most recently (what the widget shows). */
export const latestJob = (list: Job[]): Job | undefined =>
  list.reduce<Job | undefined>((best, j) => (!best || (j.touchedAt ?? j.createdAt) > (best.touchedAt ?? best.createdAt) ? j : best), undefined);

/** "Truck 2 of 3" math for the pour: yards in so far (the last truck may be short). */
export const yardsIn = (p: Pour) => Math.min(p.totalYd, p.trucksIn * p.truckYd);

export function useJobs(): Job[] {
  load();
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => jobs,
  );
}
