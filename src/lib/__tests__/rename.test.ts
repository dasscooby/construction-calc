jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { DEFAULT_SETTINGS } from '../settings';
import { backupText } from '../backup';
import { allJobs, jobStore } from '../jobs';
import { buildBid } from '../../report/billing';
import { buildReport, figureItems } from '../../report/report';

test('renaming a job changes only its name', () => {
  const id = jobStore.create('Test 4');
  jobStore.addItem(id, { toolId: 'slab', title: 'Slab', raw: {} });
  jobStore.edit(id, { customer: 'Tracey' });
  const before = allJobs().find((j) => j.id === id)!;
  const count = allJobs().length;
  expect(jobStore.rename(id, '  Tracey   shop  ')).toBe(true);
  const after = allJobs().find((j) => j.id === id)!;
  expect(after.name).toBe('Tracey shop');
  expect(after.id).toBe(before.id);
  expect(after.items).toEqual(before.items);
  expect(after.customer).toBe('Tracey');
  expect(allJobs().length).toBe(count); // no copy made, none lost
  // The new name is on the bid, the crew sheet and in a backup.
  expect(buildBid(after, DEFAULT_SETTINGS, figureItems(after)).html).toContain('Tracey shop');
  expect(buildReport(after, DEFAULT_SETTINGS, { crew: true }).html).toContain('Tracey shop');
  expect(backupText(allJobs())).toContain('"name": "Tracey shop"');
});

test('a blank name is refused and the old name stays', () => {
  const id = jobStore.create('Garage');
  expect(jobStore.rename(id, '   ')).toBe(false);
  expect(allJobs().find((j) => j.id === id)!.name).toBe('Garage');
  expect(jobStore.rename('no-such-job', 'X')).toBe(false);
});
