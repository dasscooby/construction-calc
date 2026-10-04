jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { appendLines, CalcHistoryLine, MAX_LINES, newTapeLines } from '../calcHistory';
import { createState, press } from '../cm';

test('newTapeLines picks up just the lines added since last time', () => {
  let s = createState();
  for (const k of ['1', '2', '+', '3', '=']) s = press(s, k as never);
  expect(s.tapeCount).toBe(s.tape.length);
  const first = newTapeLines(s.tape, s.tapeCount, 0);
  expect(first.map((l) => l.tag)).toEqual(['', '+', 'TTL=']);
  const before = s.tapeCount;
  for (const k of ['×', '2', '=']) s = press(s, (k === '×' ? '*' : k) as never);
  expect(newTapeLines(s.tape, s.tapeCount, before).map((l) => l.tag)).toEqual(['', '×', 'TTL=']); // the running total goes on the tape first
  expect(newTapeLines(s.tape, s.tapeCount, s.tapeCount)).toEqual([]);
});

test(`history keeps the newest ${MAX_LINES} lines`, () => {
  const line = (i: number): CalcHistoryLine => ({ tag: '', text: String(i), at: i });
  const list = appendLines(Array.from({ length: MAX_LINES }, (_, i) => line(i)), [line(MAX_LINES), line(MAX_LINES + 1)]);
  expect(list).toHaveLength(MAX_LINES);
  expect(list[list.length - 1].text).toBe(String(MAX_LINES + 1));
  expect(list[0].text).toBe('2');
});
