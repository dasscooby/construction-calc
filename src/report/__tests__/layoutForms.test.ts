import { ALL_TOOLS } from '../../tools';
import { defaultRaw, rowValue, runTool } from '../../tools/run';
import { buildLayout, LayoutSpec } from '../foundationLayout';
import { layoutForms } from '../layoutForms';

const t = 8 / 12;
const job: LayoutSpec = {
  house: { length: 70, width: 70 },
  wall: { thick: t, height: 4 },
  footing: { width: 16 / 12, depth: 10 / 12 },
  addOns: [{ side: 'top', width: 70, depth: 40, bays: [10, null, 10] }],
  slabs: [],
};

test('his job: wall face, contact area and corners match the hand count', () => {
  const f = layoutForms(buildLayout(job))!;
  // Outside 2 × (70 + 110) = 360'; rooms 4 × 68' 8" + 2 × 2 × (10' + 39' 4") + 2 × (47' 4" + 39' 4") = 645' 4".
  expect(Math.round(f.faceFt * 12)).toBe((1005 * 12 + 4));
  expect(Math.round(f.sfca)).toBe(4021);
  expect(f.outsideCorners).toBe(4);
  expect(f.insideCorners).toBe(16);
});

test('a plain rectangle counts exactly what the Wall Forms tool counts', () => {
  const tool = ALL_TOOLS.find((x) => x.id === 'wall-forms')!;
  const len = (ft: string) => ({ ft, in: '' });
  const r = runTool(tool, { ...defaultRaw(tool), walls: [30, 40, 30, 40].map((l) => ({ length: len(String(l)), ends: 'oo' })) as never, height1: len('4') });
  const f = layoutForms(buildLayout({ ...job, house: { length: 40, width: 30 }, addOns: [] }))!;
  expect(String(f.panels)).toBe(rowValue(r, `2' panels`));
  expect(String([...f.fillers.values()].reduce((a, b) => a + b, 0))).toBe(rowValue(r, 'Fillers'));
  expect(String(f.insideCorners)).toBe(rowValue(r, 'Inside corners (4×4)'));
});
