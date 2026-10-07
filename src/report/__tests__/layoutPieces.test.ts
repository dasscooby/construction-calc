jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import type { Job } from '../../lib/jobs';
import { DEFAULT_SETTINGS } from '../../lib/settings';
import { bidOptions } from '../bidOptions';
import { buildLayout, LayoutSpec } from '../foundationLayout';
import { LAYOUT_TOOL_ID, LayoutRaw } from '../layoutItems';
import { insideCorners, PieceSpec } from '../layoutPieces';
import { figureItems, jobDrawings } from '../report';

// Test 4: 70 × 70 house, 70 × 40 add-on off the back with 10' bays each side, 8" × 44" walls, 4" slabs.
const spec = (pieces: PieceSpec[], addOnWidth = 70): LayoutSpec => ({
  house: { length: 70, width: 70 },
  wall: { thick: 8 / 12, height: 44 / 12 },
  footing: { width: 16 / 12, depth: 10 / 12 },
  addOns: [{ side: 'top', width: addOnWidth, depth: 40, bays: addOnWidth === 70 ? [10, null, 10] : [null] }],
  slabs: [{ at: { in: 'main' }, thick: 4 / 12 }],
  pieces,
});
const job = (s: LayoutSpec): Job => ({
  id: 'j',
  name: 'Test 4',
  address: '',
  notes: '',
  createdAt: 0,
  order: { place: 'pump' } as never,
  items: [{ id: 'L', toolId: LAYOUT_TOOL_ID, title: 'Foundation layout', label: '', raw: { layout: s, wall: { bars: '1', lines: '2', barSize: '4', vSpacing: '24' }, footing: { bars: '1', lines: '2', barSize: '4' }, slab: { waste: '0' } } as LayoutRaw as never, at: 0 }],
});
const rowsOf = (j: Job, id: string) => {
  const f = figureItems(j).find((x) => x.item.id === id);
  if (!f || f.result.status !== 'ok') throw new Error(`${id}: ${f?.result.status}`);
  return f.result.result.rows;
};
const val = (j: Job, id: string, label: string) => rowsOf(j, id).find((r) => r.label === label)?.value;
const half: PieceSpec = { kind: 'steps', shape: 'half', wall: { main: 'bottom' }, along: 35, steps: 3, rise: 7 / 12, tread: 1, diameter: 10 };

describe('steps and pads on the layout', () => {
  test('half round steps on the front wall: the Steps tool numbers, its own pour, outside the wall', () => {
    const j = job(spec([half]));
    const l = buildLayout(j.items[0].raw.layout as never);
    expect(l.problems).toEqual([]);
    const pc = l.pieces[0];
    // 7/12 × π/8 × (10² + 8² + 6²) = 45.81 cu ft; curved form π/2 × 24 = 37.7 ft.
    expect(pc.cuFt).toBeCloseTo((7 / 12) * (Math.PI / 8) * 200, 6);
    expect(pc.curvedForm).toBeCloseTo((Math.PI / 2) * 24, 6);
    // On the front face (y = 70), bulging out the front (y > 70), centered 35' along from D (x = 70 → 35).
    const ys = pc.layers[0].poly.map((p) => p.y);
    expect(Math.min(...ys)).toBeCloseTo(70, 6);
    expect(Math.max(...ys)).toBeCloseTo(75, 6);
    expect(val(j, 'L:piece1', 'Cubic feet')).toBe('45.8');
    expect(val(j, 'L:piece1', 'Pour')).toBe('Pour 4'); // footings, walls, slab 1, then the steps
    expect(l.pours).toEqual(['Footings', 'Walls', 'Slab 1: Main slab', 'Steps 1']);
    // On the bid: its own line (one set) and a pump line for its pour.
    const src = bidOptions(figureItems(j), DEFAULT_SETTINGS, j);
    expect(src.find((x) => x.src === 'item:L:piece1')?.what).toBe('Steps 1: Half round steps: form and pour steps');
    expect(src.filter((x) => x.src.startsWith('pump:')).map((x) => x.what)).toContain('Pump truck: pour 4, steps 1');
  });

  test('full round steps sit touching the wall; a round pad and a square pad figure by area', () => {
    const full: PieceSpec = { ...half, shape: 'full' };
    const pad: PieceSpec = { kind: 'pad', shape: 'half', wall: { main: 'right' }, along: 20, diameter: 8, thick: 4 / 12 };
    const sq: PieceSpec = { kind: 'pad', shape: 'square', wall: { main: 'left' }, along: 35, width: 6, depth: 4, thick: 4 / 12 };
    const j = job(spec([full, pad, sq]));
    const l = buildLayout(j.items[0].raw.layout as never);
    expect(l.problems).toEqual([]);
    // Full: 7/12 × π/4 × 200 = 91.63 cu ft, its edge touching the front face.
    expect(l.pieces[0].cuFt).toBeCloseTo((7 / 12) * (Math.PI / 4) * 200, 6);
    expect(Math.min(...l.pieces[0].layers[0].poly.map((p) => p.y))).toBeCloseTo(70, 3);
    // Half round pad, 8' across, 4": π × 16 / 2 = 25.13 sq ft → 8.38 cu ft.
    expect(val(j, 'L:piece2', 'Slab area')).toBe('25.1 sq ft');
    expect(val(j, 'L:piece2', 'Cubic feet')).toBe('8.4');
    // Square pad 6' × 4' × 4" = 8 cu ft, three open edges 6 + 4 + 4 = 14 ft of form.
    expect(val(j, 'L:piece3', 'Cubic feet')).toBe('8');
    expect(val(j, 'L:piece3', 'Straight form')).toBe('14 ft');
    expect(l.pours.slice(-3)).toEqual(['Steps 1', 'Pad 1', 'Pad 2']);
  });

  test('a quarter round goes in an inside corner, its straight sides against the two walls', () => {
    // A 40' wide add-on off the back of the 70' house leaves one inside corner (add-on right wall to the back wall).
    const q: PieceSpec = { kind: 'steps', shape: 'quarter', corner: 0, steps: 3, rise: 7 / 12, tread: 1, diameter: 10 };
    const s = spec([q], 40);
    const l = buildLayout(s);
    expect(insideCorners(l.graph.outside)).toHaveLength(1);
    expect(l.problems).toEqual([]);
    // 7/12 × π/16 × 200 = 22.91 cu ft.
    expect(l.pieces[0].cuFt).toBeCloseTo((7 / 12) * (Math.PI / 16) * 200, 6);
    // In the corner at (40, 0): the add-on's right face is x = 40, the house's back face y = 0; the steps
    // are out to the right of one and above the other.
    const poly = l.pieces[0].layers[0].poly;
    expect(Math.min(...poly.map((p) => p.x))).toBeCloseTo(40, 6);
    expect(Math.max(...poly.map((p) => p.y))).toBeCloseTo(0, 6);
    // Test 4 itself (add-on as wide as the house) has no inside corner: the quarter round says so.
    const none = buildLayout(spec([q]));
    expect(none.problems[0]).toMatch(/inside corner/);
  });

  test('steps that would land inside the building are flagged, and the drawings show the pieces', () => {
    const inside: PieceSpec = { ...half, wall: { main: 'top' }, along: 35 }; // the back wall, under the add-on
    expect(buildLayout(spec([inside])).problems.join(' ')).toMatch(/inside the building/);
    const d = jobDrawings(job(spec([half])), figureItems(job(spec([half]))));
    expect(d?.plan).toContain('STEPS 1');
  });

  test('a layout saved before pieces opens the same', () => {
    const old = spec([]);
    delete old.pieces;
    const l = buildLayout(old);
    expect(l.pieces).toEqual([]);
    expect(l.pours).toEqual(['Footings', 'Walls', 'Slab 1: Main slab']);
  });
});
