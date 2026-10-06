// Reading a list the app saved (jobs, History, the calculator tape) without ever losing it.
//   - Nothing is written until the saved list has been read and merged with anything made meanwhile
//     (otherwise a save during start-up would write over everything on the phone).
//   - Saved text that can't be read is copied to its own key before anything new is saved, so it can
//     still be recovered.
//   - If the phone's storage can't be read at all, nothing is written over it this session.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

/** Everything waiting to be saved, saved now (the app is going to the background). */
const flushers = new Set<() => void>();
export const flushSaves = () => flushers.forEach((f) => f());
try {
  AppState.addEventListener('change', (state) => {
    if (state !== 'active') flushSaves();
  });
} catch {
  // tests, or no app state
}

/** The saved list; [] if there's none (or it was unreadable and has been set aside); null if storage couldn't be read. */
export async function readSavedList(key: string): Promise<unknown[] | null> {
  let text: string | null;
  try {
    text = await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
  if (!text) return [];
  try {
    const v: unknown = JSON.parse(text);
    if (Array.isArray(v)) return v;
  } catch {
    // fall through: keep a copy
  }
  try {
    await AsyncStorage.setItem(`${key}-unreadable-${Date.now()}`, text);
  } catch {
    return null; // couldn't keep a copy: don't write over it
  }
  return [];
}

/**
 * Saves after the list has been read; before that, remembers that a save is waiting. While you type,
 * saves wait for a short pause (writing everything on every key lags a big job); leaving the app saves
 * right away.
 */
export function saver(key: string, pauseMs = 300) {
  let ready = false;
  let waiting = false;
  let blocked = false;
  let pending: unknown[] | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (pending && ready && !blocked) AsyncStorage.setItem(key, JSON.stringify(pending)).catch(() => {});
    pending = null;
  };
  flushers.add(flush);
  return {
    save(list: unknown[]) {
      if (blocked) return;
      if (!ready) {
        waiting = true;
        return;
      }
      pending = list;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, pauseMs);
    },
    flush,
    /** Call once the saved list is merged in (or null if storage couldn't be read). */
    loaded(list: unknown[] | null) {
      if (list === null) {
        blocked = true;
        return;
      }
      ready = true;
      if (waiting) AsyncStorage.setItem(key, JSON.stringify(list)).catch(() => {});
      waiting = false;
    },
  };
}
