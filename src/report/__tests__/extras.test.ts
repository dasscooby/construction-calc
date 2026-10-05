jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import type { Job } from '../../lib/jobs';
import { orderText } from '../../lib/order';
import { DEFAULT_SETTINGS } from '../../lib/settings';
import { pourWarnings } from '../../lib/weather';
import { ALL_TOOLS } from '../../tools';
import { defaultRaw } from '../../tools/run';
import { buildBid, buildBill, buildChange, priceTotals, signBlock, suggestLines } from '../billing';
import { figureItems } from '../report';

const raw = (id: string, patch: object) => ({ ...defaultRaw(ALL_TOOLS.find((t) => t.id === id)!), ...patch });
const len = (ft: string) => ({ ft, in: '' });

const job: Job = {
  id: 'abc',
  name: 'Smith garage',
  address: '12 Ranch Rd, Billings MT',
  notes: '',
  createdAt: new Date(2026, 9, 4).getTime(),
  customer: 'Bob Smith',
  items: [
    { id: 's', toolId: 'slab', title: 'Slab', label: '', at: 0, raw: raw('slab', { areas: [{ length: len('30'), width: len('20') }] }) },
    { id: 'p', toolId: 'piers', title: 'Piers', label: 'Porch piers', at: 0, raw: raw('piers', { size: { ft: '', in: '12' }, height: { ft: '3', in: '' }, qty: '4' }) },
  ],
  lines: [{ id: '1', desc: 'Slab', qty: '600', unit: 'sq ft', price: '8' }],
  paid: '1000',
  changes: [
    { id: 'c1', no: 1, desc: 'Extra 10 ft of footing', qty: '10', unit: 'ft', price: '30', at: 0 },
    { id: 'c2', no: 2, desc: 'Pump truck', qty: '1', unit: 'day', price: '450', at: 0 },
  ],
};

test('price book fills in the bid lines; blank prices are left for you', () => {
  const s = { ...DEFAULT_SETTINGS, prices: { ...DEFAULT_SETTINGS.prices, slabSqFt: '8.5', pierEa: '$125', laborJob: '' }, defaults: { ...DEFAULT_SETTINGS.defaults, price: '160' } };
  const lines = suggestLines(figureItems(job), s);
  expect(lines.find((l) => l.unit === 'sq ft')!.price).toBe('8.5');
  expect(lines.find((l) => l.desc.startsWith('Porch piers'))).toMatchObject({ qty: '4', unit: 'ea', price: '125' });
  expect(lines.find((l) => l.desc === 'Concrete')!.price).toBe('160');
  expect(lines.find((l) => l.desc === 'Labor')!.price).toBe('');
});

test('change orders: not on the bid, on the final bill, and each prints with the running contract total', () => {
  // Bid 600 × 8 = 4,800. Changes 300 + 450 = 750. Bill 5,550 − 1,000 paid = 4,550.
  expect(priceTotals(job).total).toBe(4800);
  expect(priceTotals(job, true).total).toBe(5550);
  const bid = buildBid(job, DEFAULT_SETTINGS, figureItems(job)).html;
  expect(bid).not.toContain('Change order #');
  const bill = buildBill(job, DEFAULT_SETTINGS, figureItems(job));
  expect(bill.html).toContain('Change order #1: Extra 10 ft of footing');
  expect(bill.text).toContain('Balance due: $4,550.00');
  const co2 = buildChange(job, DEFAULT_SETTINGS, job.changes![1]).html;
  expect(co2).toContain('CHANGE ORDER');
  expect(co2).toContain('$4,800.00'); // original
  expect(co2).toContain('$300.00'); // earlier change
  expect(co2).toContain('$5,550.00'); // new total
  expect(co2).toContain('This change order modifies the original agreement');
});

test('signatures: blank lines to sign by hand, or the finger signature with name and date', () => {
  expect(signBlock('Accepted by')).toContain('Accepted by</div>');
  const sig = { d: 'M10 10 L50 40', w: 300, h: 120, name: 'Bob Smith', at: new Date(2026, 9, 5).getTime() };
  const html = signBlock('Accepted by', sig);
  expect(html).toContain('<path d="M10 10 L50 40"');
  expect(html).toContain('Accepted by: Bob Smith');
  expect(buildBid({ ...job, signature: sig }, DEFAULT_SETTINGS, figureItems(job)).html).toContain('viewBox="0 0 300 120"');
});

test('concrete order text', () => {
  const s = { ...DEFAULT_SETTINGS, company: { ...DEFAULT_SETTINGS.company, name: 'Gaitan Concrete', phone: '(406) 555-1234' } };
  expect(orderText(job, s, 10.25, { psi: '3000', place: 'pump', when: 'Tue 7 am' })).toBe(
    'Concrete order – Gaitan Concrete\nJob: Smith garage, 12 Ranch Rd, Billings MT\n10.25 yd, 3000 PSI\nPump truck\nWhen: Tue 7 am\nCall or text: (406) 555-1234',
  );
});

test('pour-day warnings: hot, cold, freezing, rain, wind', () => {
  expect(pourWarnings({ date: '', hi: 75, lo: 50, rain: 10, wind: 8 })).toEqual([]);
  expect(pourWarnings({ date: '', hi: 95, lo: 70, rain: 0, wind: 5 })[0]).toMatch(/^Hot/);
  expect(pourWarnings({ date: '', hi: 50, lo: 38, rain: 0, wind: 5 })[0]).toMatch(/^Cold night/);
  expect(pourWarnings({ date: '', hi: 40, lo: 25, rain: 0, wind: 5 })[0]).toMatch(/^Freezing/);
  expect(pourWarnings({ date: '', hi: 70, lo: 50, rain: 60, wind: 25 })).toEqual(['Rain likely. Have plastic ready.', 'Windy: the top dries fast.']);
});
