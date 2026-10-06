jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { ALL_TOOLS } from '../../tools';
import { defaultRaw, RawValues } from '../../tools/run';
import { buildLayout } from '../../report/foundationLayout';
import { figureItems } from '../../report/report';
import type { Job } from '../jobs';
import { addOnProblem, fmtFtIn, insideProblem, parseFtIn, putAddOn, setInside, setPour, startFromJob, toggleSlab } from '../layoutEdit';

const raw = (id: string, patch: RawValues): RawValues => ({ ...defaultRaw(ALL_TOOLS.find((t) => t.id === id)!), ...patch });
const len = (ft: string, inch = '') => ({ ft, in: inch });

test('the feet-and-inches box takes it the way you say it', () => {
  expect(parseFtIn('40')).toBe(40);
  expect(parseFtIn('40 6')).toBe(40.5);
  expect(parseFtIn('40-6')).toBe(40.5);
  expect(parseFtIn(`40'6"`)).toBe(40.5);
  expect(parseFtIn(`40' 6`)).toBe(40.5);
  expect(parseFtIn('6"')).toBe(0.5);
  expect(parseFtIn('10.5')).toBe(10.5);
  expect(parseFtIn('47 4 1/2')).toBeCloseTo(47 + 4.5 / 12);
  expect(parseFtIn('abc')).toBeNull();
  expect(parseFtIn('')).toBeNull();
  expect(fmtFtIn(47 + 4 / 12)).toBe(`47' 4"`);
  expect(fmtFtIn(10)).toBe(`10'`);
  expect(fmtFtIn(0.5)).toBe(`6"`);
  expect(fmtFtIn(1 + 4.25 / 12)).toBe(`1' 4¼"`);
});

// His stem wall job as it is on his phone: 70 × 70 stem wall, footing and slab, said to go together.
const job: Job = {
  id: 'j',
  name: 'Stem wall',
  address: '',
  notes: '',
  createdAt: 0,
  items: [
    { id: 'w', toolId: 'footings', title: '', label: '', at: 0, raw: raw('footings', { kind: 'wall', shape: 'rect', bLength: len('70'), bWidth: len('70'), depth: len('4'), width: len('', '8'), bars: '1' }) },
    { id: 'f', toolId: 'footings', title: '', label: '', at: 0, raw: raw('footings', { kind: 'footing', shape: 'rect', bLength: len('70'), bWidth: len('70'), depth: len('', '10'), width: len('', '16'), wallOn: '8' }) },
    { id: 's', toolId: 'slab', title: '', label: '', at: 0, raw: raw('slab', { areas: [{ length: len('70'), width: len('70') }] as never }) },
  ],
  together: { ids: ['w', 'f', 's'], slabDropIn: '8' },
};

test('starting from the stem wall already in the job', () => {
  const s = startFromJob(figureItems(job), job)!;
  expect(s.label).toBe(`70' × 70' stem wall and slab`);
  expect(s.spec.house).toEqual({ length: 70, width: 70 });
  expect(s.spec.wall).toEqual({ thick: 8 / 12, height: 4 });
  expect(s.spec.footing).toEqual({ width: 16 / 12, depth: 10 / 12 });
  expect(s.spec.slabs).toEqual([{ at: { in: 'main' }, thick: 4 / 12 }]);
  expect(s.spec.slabDropIn).toBe(8);
  expect(s.replace.sort()).toEqual(['f', 's', 'w']);
  expect(s.wall.bars).toBe('1');
});

test('his job, step by step: tap the back wall, 40 out, 10 | rest | 10, slab in the middle bay', () => {
  let spec = startFromJob(figureItems(job), job)!.spec;
  const a = { side: 'top' as const, width: 70, depth: parseFtIn('40')! };
  expect(addOnProblem(spec, a)).toBeNull();
  spec = putAddOn(spec, a);
  expect(insideProblem(spec, 0, 'out', [10, null, 10])).toBeNull();
  spec = setInside(spec, 0, 'out', [10, null, 10]);
  spec = toggleSlab(spec, { in: 'addon', addOn: 0, bay: 1 });
  const l = buildLayout(spec);
  expect(l.problems).toEqual([]);
  expect(l.totals.measured).toBe(510);
  expect(l.bays[0].map((b) => fmtFtIn(b.w))).toEqual([`10'`, `47' 4"`, `10'`]);
  expect(l.pours).toEqual(['Footings', 'Walls', 'Slab 1: Main slab', 'Slab 2: Add-on slab, middle bay']);
  // Poured with the main slab instead: one slab pour.
  const together = buildLayout(setPour(spec, 1, 1));
  expect(together.pours).toEqual(['Footings', 'Walls', 'Slab 1: Main slab + Add-on slab, middle bay']);
});

test('things that do not fit are refused in plain words, nothing broken is drawn', () => {
  const spec = startFromJob(figureItems(job), job)!.spec;
  expect(addOnProblem(spec, { side: 'top', width: 80, depth: 40 })).toBe(`The main back B–C wall is only 70'. Starting 0' in, it can be up to 70' wide.`);
  expect(addOnProblem(spec, { side: 'top', width: 70, depth: 0 })).toBe('Put in how far it comes out.');
  const withAdd = putAddOn(spec, { side: 'top', width: 70, depth: 40 });
  expect(addOnProblem(withAdd, { side: 'top', width: 20, depth: 10, from: 10 })).toBe('There is already an add-on on that part of the wall.');
  expect(insideProblem(withAdd, 0, 'out', [40, null, 40])).toBe(`Those bays come to 80', but there's only 67' 4" clear. Make one smaller or leave one blank.`);
  expect(insideProblem(withAdd, 0, 'out', [10, 10, 10])).toBe(`Those bays come to 30', but there's 67' 4" clear. Leave one blank for the rest.`);
});

test('the main house can already be there: its walls are drawn but not in the bid', () => {
  let spec = startFromJob(figureItems(job), job)!.spec;
  spec = { ...putAddOn(spec, { side: 'top', width: 70, depth: 40 }), existing: true };
  const l = buildLayout(spec);
  expect(l.totals.measured).toBe(150);
  expect(l.runs.find((r) => r.name === 'Add-on side')!.ends.join(' / ')).toBe('straight on / corner');
});
