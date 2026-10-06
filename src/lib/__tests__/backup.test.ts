import type { Job } from '../jobs';
import { backupText, mergeBackup, mergeSummary } from '../backup';

const job = (id: string, name: string, extra: Partial<Job> = {}): Job => ({ id, name, address: '', notes: '', createdAt: 1, items: [], ...extra });

test('a backup restores onto an empty phone', () => {
  const text = backupText([job('a', 'Stem wall'), job('b', 'Garage')]);
  const r = mergeBackup([], text);
  expect(r.jobs.map((j) => j.name)).toEqual(['Stem wall', 'Garage']);
  expect(mergeSummary(r)).toBe('Added 2 jobs.');
});

test('a restore never changes a job already on the phone', () => {
  const mine = [job('a', 'Stem wall', { notes: 'changed today' }), job('b', 'Garage')];
  const text = backupText([job('a', 'Stem wall'), job('b', 'Garage'), job('c', 'Shop')]);
  const r = mergeBackup(mine, text);
  expect(r.jobs[0]).toBe(mine[0]); // untouched
  expect(r.jobs.map((j) => j.name)).toEqual(['Stem wall', 'Garage', 'Stem wall (from backup)', 'Shop']);
  expect(r.jobs[2].id).not.toBe('a');
  expect(mergeSummary(r)).toBe('Added 1 job. 1 had changed since the backup and came back as a copy next to yours. 1 was already here.');
});

test('a file that is not a backup is refused and nothing changes', () => {
  const mine = [job('a', 'Stem wall')];
  expect(mergeBackup(mine, '{oops').problem).toMatch(/couldn't be read/);
  expect(mergeBackup(mine, JSON.stringify({ hello: 1 })).problem).toMatch(/isn't a jobs backup/);
  expect(mergeBackup(mine, '{oops').jobs).toBe(mine);
});

test('a saved list of jobs (older backups) also restores, and broken entries are skipped', () => {
  const r = mergeBackup([], JSON.stringify([job('a', 'A'), null, { name: 'no id' }, { id: 'b' }]));
  expect(r.jobs.map((j) => [j.id, j.name, j.items])).toEqual([
    ['a', 'A', []],
    ['b', 'Job', []],
  ]);
});
