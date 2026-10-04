jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import type { Job } from '../../lib/jobs';
import { DEFAULT_SETTINGS } from '../../lib/settings';
import { ALL_TOOLS } from '../../tools';
import { defaultRaw, RawValues } from '../../tools/run';
import { buildReport, figureItems, jobTotals, numberIn, parseHeight } from '../report';

const raw = (toolId: string, patch: RawValues): RawValues => ({ ...defaultRaw(ALL_TOOLS.find((t) => t.id === toolId)!), ...patch });
const len = (ft: string, inch = '') => ({ ft, in: inch });

const job: Job = {
  id: 'j1',
  name: 'Smith shop',
  address: '12 Ranch Rd',
  notes: 'Pump truck at 7',
  createdAt: new Date(2026, 9, 4).getTime(),
  items: [
    {
      id: 'a',
      toolId: 'wall-forms',
      title: 'Wall Forms (Aluminum)',
      label: 'Foundation walls',
      at: 0,
      raw: raw('wall-forms', {
        walls: [
          { length: len('70'), ends: 'oo' },
          { length: len('29', '6'), ends: 'oo' },
          { length: len('74'), ends: 'oo' },
          { length: len('4'), ends: 'oo' },
          { length: len('4'), ends: 'oi' },
          { length: len('25', '6'), ends: 'oi' },
        ],
      }),
    },
    { id: 'b', toolId: 'slab', title: 'Slab', label: '', at: 0, raw: raw('slab', { areas: [{ length: len('70'), width: len('29', '6') }], price: '150' }) },
    { id: 'c', toolId: 'slab-rebar', title: 'Slab Rebar', label: '', at: 0, raw: raw('slab-rebar', { length: len('70'), width: len('29', '6') }) },
  ],
};

test('helpers', () => {
  expect(numberIn('$2,475.00')).toBe(2475);
  expect(numberIn('about 351')).toBe(351);
  expect(parseHeight(`5'4"`)).toBeCloseTo(5 + 4 / 12, 6);
  expect(parseHeight(`4'`)).toBe(4);
  expect(parseHeight(`4"`)).toBeCloseTo(1 / 3, 6);
  expect(parseHeight(`0' 4-1/2"`)).toBeCloseTo(4.5 / 12, 6);
});

test('totals add up across the job', () => {
  const items = figureItems(job);
  expect(items.every((i) => i.result.status === 'ok')).toBe(true);
  const t = jobTotals(items);
  // slab: 70 × 29.5 × 4" = 688.33 cu ft + 10% = 28.04 yd → order 28.25 at $150
  expect(t.concreteOrderYd).toBe(28.25);
  expect(t.concreteCost).toBe(4237.5);
  expect(t.wallConcreteYd).toBe(20.18);
  expect([...t.panels]).toEqual([[`2' × 4' panels`, 192]]);
  expect(t.fillers.get('14" fillers')).toBe(2);
  expect(t.fillers.get(`1' fillers`)).toBe(14);
  expect(t.insideCorners).toBe(6);
  expect(t.rebarLb).toBeGreaterThan(0);
  expect([...t.sticks.keys()]).toEqual([`#4 20' sticks`]);
});

test('report has the summary, plan, 3D view, details and notes', () => {
  const { html, text } = buildReport(job, { ...DEFAULT_SETTINGS, company: { name: 'Gaitan Concrete', phone: '', email: '', license: '' } });
  expect(html).toContain('<h1>Smith shop</h1>');
  expect(html).toContain('Order summary');
  expect(html).toContain('aria-label="Plan view"');
  expect(html).toContain('aria-label="3D view"');
  expect(html).toContain('Foundation walls');
  expect(html).toContain('Gaitan Concrete');
  expect(html).toContain("70' 0\"");
  expect(text).toContain('Concrete to order: 28.25 yd');
  expect(text).toContain('Concrete cost: $4,237.50');
  expect(text).toContain('NOTES\nPump truck at 7');
  expect(text.endsWith('Gaitan Concrete')).toBe(true);
});

test('a slab-only job still gets drawings; an empty job says so', () => {
  const slabOnly = { ...job, items: [job.items[1]] };
  expect(buildReport(slabOnly, DEFAULT_SETTINGS).html).toContain('aria-label="3D view"');
  expect(buildReport({ ...job, items: [] }, DEFAULT_SETTINGS).html).toContain('Nothing added to this job yet.');
});
