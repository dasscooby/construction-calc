// Jobs: a name, an address, and the calculations added to it (slab, rebar, wall forms ...).
// Each item keeps the numbers typed in, so the report always figures them fresh.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import type { RawValues } from '../tools/run';

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
  /** Who the bid and bill go to */
  customer?: string;
  /** Bid / bill lines */
  lines?: PriceLine[];
  /** Sales tax %, as typed */
  taxPct?: string;
  /** Already paid (deposit), dollars, as typed */
  paid?: string;
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
  setLines(jobId: string, lines: Omit<PriceLine, 'id'>[] | PriceLine[]) {
    update(jobId, (j) => ({ ...j, lines: lines.map((l) => ({ ...l, id: 'id' in l && l.id ? l.id : newId() })) }));
  },
  removeScan(jobId: string, uri: string) {
    update(jobId, (j) => ({ ...j, scans: (j.scans ?? []).filter((s) => s !== uri) }));
  },
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
