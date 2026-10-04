// The calculator's tape, kept on the phone across days (the tape itself only lasts while the app is open).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import type { TapeLine } from './cm';

export interface CalcHistoryLine extends TapeLine {
  /** When it went on the tape (ms since 1970) */
  at: number;
}

export const MAX_LINES = 1000;
const SAVE_KEY = 'calc-history-v1';

/** Add lines at the end, keeping the newest MAX_LINES. */
export function appendLines(list: CalcHistoryLine[], lines: CalcHistoryLine[]): CalcHistoryLine[] {
  return [...list, ...lines].slice(-MAX_LINES);
}

/**
 * Lines added to the tape since the last look: the tape keeps only its last 50 lines,
 * so this works from the running count of lines ever added.
 */
export function newTapeLines(tape: TapeLine[], count: number, lastCount: number): TapeLine[] {
  const n = Math.min(count - lastCount, tape.length);
  return n > 0 ? tape.slice(-n) : [];
}

let lines: CalcHistoryLine[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function set(next: CalcHistoryLine[]) {
  lines = next;
  listeners.forEach((l) => l());
  AsyncStorage.setItem(SAVE_KEY, JSON.stringify(lines)).catch(() => {});
}

function load() {
  if (loaded) return;
  loaded = true;
  AsyncStorage.getItem(SAVE_KEY)
    .then((text) => {
      const saved = text ? (JSON.parse(text) as CalcHistoryLine[]) : [];
      if (!Array.isArray(saved)) return;
      // Anything added before loading finished goes after what was saved.
      lines = appendLines(saved, lines);
      listeners.forEach((l) => l());
    })
    .catch(() => {});
}

export const calcHistory = {
  add(tapeLines: TapeLine[]) {
    load();
    if (!tapeLines.length) return;
    const at = Date.now();
    set(appendLines(lines, tapeLines.map((l) => ({ ...l, at }))));
  },
  clear() {
    set([]);
  },
};

export function useCalcHistory(): CalcHistoryLine[] {
  load();
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => lines,
  );
}
