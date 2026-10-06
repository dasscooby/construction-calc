jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import AsyncStorage from '@react-native-async-storage/async-storage';

import { readSavedList, saver } from '../savedList';

beforeEach(() => AsyncStorage.clear());

test('a saved list reads back', async () => {
  await AsyncStorage.setItem('k', JSON.stringify([{ id: 'a' }]));
  expect(await readSavedList('k')).toEqual([{ id: 'a' }]);
  expect(await readSavedList('none')).toEqual([]);
});

test('text that cannot be read is kept under its own key, not thrown away', async () => {
  await AsyncStorage.setItem('k', '{not json');
  expect(await readSavedList('k')).toEqual([]);
  const keys = await AsyncStorage.getAllKeys();
  const copy = keys.find((x) => x.startsWith('k-unreadable-'))!;
  expect(await AsyncStorage.getItem(copy)).toBe('{not json');
});

test('a save before the list is read waits, then writes the merged list', async () => {
  await AsyncStorage.setItem('k', JSON.stringify([{ id: 'old' }]));
  const s = saver('k');
  s.save([{ id: 'new' }]); // made while the app was starting
  await new Promise((r) => setTimeout(r, 0));
  expect(JSON.parse((await AsyncStorage.getItem('k'))!)).toEqual([{ id: 'old' }]); // not written over
  const saved = (await readSavedList('k'))!;
  s.loaded([{ id: 'new' }, ...saved]);
  await new Promise((r) => setTimeout(r, 0));
  expect(JSON.parse((await AsyncStorage.getItem('k'))!)).toEqual([{ id: 'new' }, { id: 'old' }]);
});

test('if storage cannot be read, nothing is written over it', async () => {
  await AsyncStorage.setItem('k', JSON.stringify([{ id: 'old' }]));
  (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(() => Promise.reject(new Error('disk')));
  const s = saver('k');
  s.loaded(await readSavedList('k'));
  s.save([{ id: 'new' }]);
  await new Promise((r) => setTimeout(r, 0));
  expect(JSON.parse((await AsyncStorage.getItem('k'))!)).toEqual([{ id: 'old' }]);
});
