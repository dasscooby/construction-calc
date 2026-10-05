jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../scanner', () => ({ scansForReport: async (uris: string[]) => uris.map(() => 'data:image/jpeg;base64,AAAA') }));

import { allJobs, jobStore } from '../jobs';
import { rowValue, runTool } from '../../tools/run';
import { slabLayout } from '../../tools/slabLayoutTool';
import { processPlanQueue, slabToRaw } from '../planReader';

test('a slab read off a plan opens in Slab Layout with the same numbers', () => {
  const raw = slabToRaw({
    name: 'Walk',
    sides: [
      { length_ft: 14, turn: 'R', radius_ft: 3, edge: 'form' },
      { length_ft: 14, turn: 'R', radius_ft: 0, edge: 'form' },
      { length_ft: 7, turn: 'R', radius_ft: 0, edge: 'slabDowels' },
      { length_ft: 7, turn: 'L', radius_ft: 0, edge: 'form' },
      { length_ft: 7, turn: 'R', radius_ft: 0, edge: 'form' },
      { length_ft: 7, turn: 'R', radius_ft: 0, edge: 'house' },
    ],
    thickness_in: 4,
    footing: { width_in: 12, depth_in: 16 },
    rebar: { size: 8, spacing_in: 18 },
    dowels: { size: 4, spacing_in: 24, length_in: 18 },
  });
  expect(raw.barSize).toBe('5'); // #8 isn't a slab bar choice: nearest one
  const r = runTool(slabLayout, raw);
  expect(rowValue(r, 'Slab area')).toBe('145.1 sq ft');
  expect(rowValue(r, 'Thickened edge')).toBe('1.52 cu yd');
});

test("feet and inches: 14.5 ft → 14' 6\"", () => {
  const raw = slabToRaw({ name: '', sides: [{ length_ft: 14.5, turn: 'R', radius_ft: 0, edge: 'form' }] });
  expect((raw.sides as { length: unknown }[])[0].length).toEqual({ ft: '14', in: '6' });
});

test('no signal: the plan waits in the job, then gets read when signal is back', async () => {
  const id = jobStore.create('Queue test');
  jobStore.queuePlan(id, { uri: 'file:///plan-1.jpg', mediaType: 'image/jpeg' });
  const job = () => allJobs().find((j) => j.id === id)!;

  globalThis.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
  await processPlanQueue();
  expect(job().planQueue).toHaveLength(1);
  expect(job().planFound).toBeUndefined();

  const slab = { name: 'Patio', sides: [{ length_ft: 10, turn: 'R', radius_ft: 0, edge: 'form' }] };
  globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ slabs: [slab], notes: ['6 mil vapor barrier'], unsure: [] }) });
  await processPlanQueue();
  expect(job().planQueue).toHaveLength(0);
  expect(job().planFound?.slabs[0].name).toBe('Patio');
  expect(job().planFound?.notes).toEqual(['6 mil vapor barrier']);
});

test('everything on a plan becomes a working tool: walls, footings + bars, piers, steps', () => {
  const { planItems } = require('../planReader') as typeof import('../planReader');
  const { ALL_TOOLS } = require('../../tools') as typeof import('../../tools');
  const items = planItems({
    slabs: [],
    walls: [
      {
        name: 'Foundation',
        // 30 x 20 with a 4 x 4 notch: R R R R L R... walked clockwise
        sides: [
          { length_ft: 30, turn: 'R' },
          { length_ft: 20, turn: 'R' },
          { length_ft: 26, turn: 'R' },
          { length_ft: 4, turn: 'L' },
          { length_ft: 4, turn: 'R' },
          { length_ft: 16, turn: 'R' },
        ],
        thickness_in: 8,
        height_in: 96,
      },
    ],
    footings: [{ name: 'Footing', length_ft: 100, width_in: 20, depth_in: 10, corners: 6, bars: { size: 4, count: 2 } }],
    piers: [{ name: 'Porch piers', shape: 'round', size_in: 12, depth_in: 36, count: 4 }],
    steps: [{ name: 'Front steps', steps: 3, rise_in: 7, run_in: 11, width_in: 48, landing_in: 36 }],
    notes: [],
    unsure: [],
  });
  expect(items.map((i) => i.toolId)).toEqual(['wall-forms', 'footings', 'beam-bars', 'piers', 'steps']);
  for (const it of items) {
    const tool = ALL_TOOLS.find((t) => t.id === it.toolId)!;
    expect(runTool(tool, it.raw).status).toBe('ok');
  }
  // Wall ends from the turns: the wall after the inside (left) corner and the one before it are outside + inside.
  const walls = items[0].raw.walls as { ends: string }[];
  expect(walls.map((w) => w.ends)).toEqual(['oo', 'oo', 'oo', 'oi', 'oi', 'oo']);
  // 8' wall: 4' panels with 4' stacked on top
  expect(items[0].raw.height1).toEqual({ ft: '4', in: '' });
  expect(items[0].raw.height2).toEqual({ ft: '4', in: '' });
});
