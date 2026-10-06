// The calculator's tape, kept on the phone across days (the tape itself only lasts while the app is open).

import { useSyncExternalStore } from 'react';

import { readSavedList, saver } from './savedList';

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

const store = saver(SAVE_KEY);

function set(next: CalcHistoryLine[]) {
  lines = next;
  listeners.forEach((l) => l());
  store.save(lines);
}

function load() {
  if (loaded) return;
  loaded = true;
  readSavedList(SAVE_KEY).then((saved) => {
    if (saved) {
      // Anything added before loading finished goes after what was saved.
      lines = appendLines((saved as CalcHistoryLine[]).filter((s) => s && typeof s === 'object'), lines);
      listeners.forEach((l) => l());
    }
    store.loaded(saved ? lines : null);
  });
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
