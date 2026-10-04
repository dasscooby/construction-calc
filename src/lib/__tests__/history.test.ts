jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { addEntry, dayLabel, HistoryEntry, MAX_ENTRIES, timeLabel } from '../history';

const entry = (id: string, toolId: string, raw: Record<string, string>): HistoryEntry => ({
  id,
  toolId,
  title: toolId,
  at: 0,
  raw,
  main: [],
  text: '',
});

describe('addEntry', () => {
  test('newest goes on top', () => {
    const list = addEntry([entry('1', 'slab', { a: '1' })], entry('2', 'piers', { a: '1' }));
    expect(list.map((e) => e.id)).toEqual(['2', '1']);
  });

  test('same tool with the same numbers replaces the old copy', () => {
    const list = [entry('1', 'slab', { a: '1' }), entry('2', 'piers', { a: '5' })];
    expect(addEntry(list, entry('3', 'slab', { a: '1' })).map((e) => e.id)).toEqual(['3', '2']);
    expect(addEntry(list, entry('3', 'slab', { a: '2' })).map((e) => e.id)).toEqual(['3', '1', '2']);
  });

  test(`keeps at most ${MAX_ENTRIES}`, () => {
    let list: HistoryEntry[] = [];
    for (let i = 0; i < MAX_ENTRIES + 5; i++) list = addEntry(list, entry(String(i), 'slab', { a: String(i) }));
    expect(list).toHaveLength(MAX_ENTRIES);
    expect(list[0].id).toBe(String(MAX_ENTRIES + 4));
  });
});

describe('labels', () => {
  const now = new Date(2026, 9, 4, 9, 30).getTime(); // Sun, Oct 4 2026

  test('day', () => {
    expect(dayLabel(new Date(2026, 9, 4, 6, 0).getTime(), now)).toBe('Today');
    expect(dayLabel(new Date(2026, 9, 3, 23, 0).getTime(), now)).toBe('Yesterday');
    expect(dayLabel(new Date(2026, 8, 28, 12, 0).getTime(), now)).toBe('Mon, Sep 28');
    expect(dayLabel(new Date(2025, 11, 31, 12, 0).getTime(), now)).toBe('Wed, Dec 31, 2025');
  });

  test('time', () => {
    expect(timeLabel(new Date(2026, 9, 4, 7, 5).getTime())).toBe('7:05 AM');
    expect(timeLabel(new Date(2026, 9, 4, 0, 0).getTime())).toBe('12:00 AM');
    expect(timeLabel(new Date(2026, 9, 4, 13, 45).getTime())).toBe('1:45 PM');
  });
});
