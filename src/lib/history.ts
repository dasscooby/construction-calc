// Saved calculations from the tool screens. Kept on the phone, newest first, shared by every tab.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import type { RawValues } from '../tools/run';

export interface HistoryEntry {
  id: string;
  toolId: string;
  title: string;
  /** When it was saved (ms since 1970) */
  at: number;
  /** The text in the boxes, so it can be opened back up in the tool */
  raw: RawValues;
  /** The main answers, shown in the list */
  main: { label: string; value: string }[];
  /** Everything, as shared: inputs and answers */
  text: string;
}

export const MAX_ENTRIES = 200;
const SAVE_KEY = 'history-v1';

/**
 * Put a new entry on top. If the newest entry for the same tool has the same numbers typed in,
 * it's replaced instead (backing out of a tool twice doesn't make two copies).
 */
export function addEntry(list: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const same = (e: HistoryEntry) => e.toolId === entry.toolId && JSON.stringify(e.raw) === JSON.stringify(entry.raw);
  const rest = list.filter((e) => !same(e));
  return [entry, ...rest].slice(0, MAX_ENTRIES);
}

/** "Today", "Yesterday", or "Mon, Oct 3" */
export function dayLabel(at: number, now = Date.now()): string {
  const d = new Date(at);
  const start = (t: number) => {
    const x = new Date(t);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  };
  const days = Math.round((start(now) - start(at)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  const year = d.getFullYear() === new Date(now).getFullYear() ? '' : `, ${d.getFullYear()}`;
  return `${weekday}, ${month} ${d.getDate()}${year}`;
}

/** "7:05 AM" */
export function timeLabel(at: number): string {
  const d = new Date(at);
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

// ---------- one shared list for the whole app ----------

let entries: HistoryEntry[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function set(next: HistoryEntry[]) {
  entries = next;
  listeners.forEach((l) => l());
  AsyncStorage.setItem(SAVE_KEY, JSON.stringify(entries)).catch(() => {});
}

function load() {
  if (loaded) return;
  loaded = true;
  AsyncStorage.getItem(SAVE_KEY)
    .then((text) => {
      const saved = text ? (JSON.parse(text) as HistoryEntry[]) : [];
      if (!Array.isArray(saved)) return;
      // Anything saved before loading finished goes on top of what was on the phone.
      entries = [...entries, ...saved.filter((s) => !entries.some((e) => e.id === s.id))].slice(0, MAX_ENTRIES);
      listeners.forEach((l) => l());
    })
    .catch(() => {});
}

export const history = {
  add(entry: Omit<HistoryEntry, 'id' | 'at'>) {
    load();
    const at = Date.now();
    set(addEntry(entries, { ...entry, at, id: `${at}-${Math.random().toString(36).slice(2, 8)}` }));
  },
  remove(id: string) {
    set(entries.filter((e) => e.id !== id));
  },
  clear() {
    set([]);
  },
};

export function useHistory(): HistoryEntry[] {
  load();
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => entries,
  );
}
