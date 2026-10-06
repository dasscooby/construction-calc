// Backing up every job to one file, and bringing a backup back. Jobs only live on the phone, so this is
// the way to keep them safe or move them to a new phone. A restore never changes a job you already
// have: jobs that aren't on the phone are added, the same job is skipped, and a job that has changed
// since the backup comes back as a copy next to yours.
// Plan pages, photos and the logo are files on the phone and don't come along.

import { Platform } from 'react-native';

import type { Job } from './jobs';

type FS = typeof import('expo-file-system');

const KIND = 'construction-calc-jobs';

export function backupText(jobs: Job[], now = new Date()): string {
  return JSON.stringify({ kind: KIND, version: 1, savedAt: now.toISOString(), jobs }, null, 1);
}

export interface MergeResult {
  jobs: Job[];
  added: number;
  copies: number;
  same: number;
  /** Why it couldn't be read, or '' */
  problem: string;
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Jobs from a backup put next to the ones on the phone. Nothing on the phone is changed. */
export function mergeBackup(current: Job[], text: string): MergeResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { jobs: current, added: 0, copies: 0, same: 0, problem: "That file isn't a jobs backup (it couldn't be read)." };
  }
  const list = Array.isArray(data) ? data : (data as { kind?: string; jobs?: unknown })?.kind === KIND ? (data as { jobs: unknown }).jobs : null;
  if (!Array.isArray(list)) return { jobs: current, added: 0, copies: 0, same: 0, problem: "That file isn't a jobs backup from this app." };
  const out = [...current];
  let added = 0;
  let copies = 0;
  let same = 0;
  for (const raw of list) {
    if (!raw || typeof raw !== 'object' || !(raw as Job).id) continue;
    const j = raw as Job;
    const tidy: Job = { ...j, name: j.name ?? 'Job', address: j.address ?? '', notes: j.notes ?? '', items: Array.isArray(j.items) ? j.items : [] };
    const mine = out.find((x) => x.id === j.id);
    if (!mine) {
      out.push(tidy);
      added++;
    } else if (JSON.stringify({ ...mine, touchedAt: 0 }) === JSON.stringify({ ...tidy, touchedAt: 0 })) {
      same++;
    } else {
      out.push({ ...tidy, id: newId(), name: `${tidy.name} (from backup)` });
      copies++;
    }
  }
  return { jobs: out, added, copies, same, problem: '' };
}

/** "Added 3 jobs. 1 came back as a copy. 2 were already here." */
export function mergeSummary(r: MergeResult): string {
  if (r.problem) return r.problem;
  const parts = [`Added ${r.added} job${r.added === 1 ? '' : 's'}.`];
  if (r.copies) parts.push(`${r.copies} had changed since the backup and came back as a copy next to yours.`);
  if (r.same) parts.push(`${r.same} ${r.same === 1 ? 'was' : 'were'} already here.`);
  return parts.join(' ');
}

const fileName = (now = new Date()) => `jobs-backup-${now.toISOString().slice(0, 10)}.json`;

/** Saves the backup file and opens Share, so it can go to Files, iCloud Drive, email or a text. */
export async function shareBackup(jobs: Job[]): Promise<void> {
  const text = backupText(jobs);
  if (Platform.OS === 'web') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = fileName();
    a.click();
    return;
  }
  const { File, Paths } = require('expo-file-system') as FS;
  const Sharing = require('expo-sharing') as typeof import('expo-sharing');
  const f = new File(Paths.cache, fileName());
  if (f.exists) f.delete();
  f.create();
  f.write(text);
  await Sharing.shareAsync(f.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Back up all jobs' });
}

/** Picks a backup file and returns its text (null if cancelled). */
export async function pickBackup(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        file.text().then(resolve, () => resolve(null));
      };
      input.click();
    });
  }
  const DP = require('expo-document-picker') as typeof import('expo-document-picker');
  const r = await DP.getDocumentAsync({ type: ['application/json', 'public.json', '*/*'], copyToCacheDirectory: true });
  if (r.canceled || !r.assets?.[0]) return null;
  const { File } = require('expo-file-system') as FS;
  return new File(r.assets[0].uri).text();
}
