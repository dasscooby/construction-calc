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

export interface Job {
  id: string;
  name: string;
  address: string;
  notes: string;
  createdAt: number;
  items: JobItem[];
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

const update = (id: string, fn: (j: Job) => Job) => set(jobs.map((j) => (j.id === id ? fn(j) : j)));

export const jobStore = {
  /** Makes a job and returns its id. Newest jobs go first. */
  create(name: string): string {
    load();
    const job: Job = { id: newId(), name: name.trim() || 'New job', address: '', notes: '', createdAt: Date.now(), items: [] };
    set([job, ...jobs]);
    return job.id;
  },
  edit(id: string, patch: Partial<Pick<Job, 'name' | 'address' | 'notes'>>) {
    update(id, (j) => ({ ...j, ...patch }));
  },
  remove(id: string) {
    set(jobs.filter((j) => j.id !== id));
  },
  addItem(jobId: string, item: Omit<JobItem, 'id' | 'at' | 'label'> & { label?: string }) {
    update(jobId, (j) => ({ ...j, items: [...j.items, { ...item, label: item.label ?? '', id: newId(), at: Date.now() }] }));
  },
  editItem(jobId: string, itemId: string, patch: Partial<Pick<JobItem, 'label' | 'raw'>>) {
    update(jobId, (j) => ({ ...j, items: j.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)) }));
  },
  removeItem(jobId: string, itemId: string) {
    update(jobId, (j) => ({ ...j, items: j.items.filter((it) => it.id !== itemId) }));
  },
};

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
