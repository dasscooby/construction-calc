import { CONCRETE_TOOLS } from '../concreteTools';
import { REBAR_TOOLS } from '../rebarTools';
import { defaultRaw, runTool } from '../run';
import { shareText } from '../share';

const slab = CONCRETE_TOOLS.find((t) => t.id === 'slab')!;

test('slab share text lists what was typed and the answers', () => {
  const raw = {
    ...defaultRaw(slab),
    areas: [{ length: { ft: '40', in: '' }, width: { ft: '30', in: '6' } }],
    price: '150',
  };
  const text = shareText(slab, raw, runTool(slab, raw))!;
  expect(text.split('\n')[0]).toBe('Slab – Construction Calc');
  expect(text).toContain(`Slab size: 40' 0" × 30' 6"`);
  expect(text).toContain('Thickness: 4"');
  expect(text).toContain('Waste: 10%');
  expect(text).toContain('Price per yard: $150/yd');
  expect(text).toContain('Order: 16.75 yd (Rounded up to the next ¼ yard)');
  expect(text).toMatch(/Concrete cost: \$2,512\.50/);
});

test('nothing to share until the tool has an answer', () => {
  expect(shareText(slab, defaultRaw(slab), runTool(slab, defaultRaw(slab)))).toBeNull();
});

test('bar lists and choices read the way they were picked', () => {
  const cut = REBAR_TOOLS.find((t) => t.id === 'cut-list')!;
  const raw = { ...defaultRaw(cut), marks: [{ size: '5', qty: '12', length: { ft: '8', in: '6' } }] };
  const text = shareText(cut, raw, runTool(cut, raw));
  expect(text).toContain(`12 – #5 @ 8' 6"`);
});
