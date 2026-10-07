jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import type { Job } from '../../lib/jobs';
import { DEFAULT_SETTINGS } from '../../lib/settings';
import type { LayoutSpec } from '../foundationLayout';
import { LAYOUT_TOOL_ID, LayoutRaw } from '../layoutItems';
import { printOptions } from '../open';
import { Block, contentHeight, footerHtml, letterPortrait, paginate, PAPERS, paperOf } from '../pager';
import { buildPlanSet, sheetBox } from '../planSet';
import { figureItems } from '../report';

const pages = (html: string) => html.split('<section class="page').slice(1);

describe('pages', () => {
  const row = (i: number) => ({ html: `<tr><td>row ${i}</td></tr>`, h: 30 });

  test('a long table runs on with "(continued)" and its heads, a row never split, a footer on every page', () => {
    const avail = contentHeight(letterPortrait);
    const n = Math.ceil((avail * 2.5) / 30);
    const html = paginate(
      [{ kind: 'table', title: 'Scope of work', cls: 'scope', head: '<tr><th>What</th></tr>', headH: 34, rows: Array.from({ length: n }, (_, i) => row(i)) }],
      letterPortrait,
      (k, of) => footerHtml('Job · date', k, of),
    );
    const ps = pages(html);
    expect(ps.length).toBe(3);
    ps.forEach((p, i) => {
      expect(p).toContain(`Page ${i + 1} of 3`);
      expect(p).toContain('<tr><th>What</th></tr>');
      expect(p).toContain(i === 0 ? '<h2>Scope of work</h2>' : '<h2>Scope of work <span class="cont">(continued)</span></h2>');
    });
    // Every row once, in order.
    const rows = [...html.matchAll(/row (\d+)</g)].map((m) => Number(m[1]));
    expect(rows).toEqual(Array.from({ length: n }, (_, i) => i));
  });

  test('a section asked to start fresh starts on a new page; a block that will not fit moves whole', () => {
    const avail = contentHeight(letterPortrait);
    const blocks: Block[] = [
      { kind: 'block', html: 'A', h: avail - 100 },
      { kind: 'block', html: 'B', h: 150 },
      { kind: 'block', html: 'C', h: 10, newPage: true },
      { kind: 'sheet', html: 'D' },
    ];
    const ps = pages(paginate(blocks, letterPortrait, (k, of) => footerHtml('', k, of)));
    expect(ps.map((p) => p.match(/pagebody">([^<]*)</)![1])).toEqual(['A', 'B', 'C', 'D']);
  });

  test('a heading kept with what follows does not sit alone at the bottom of a page', () => {
    const avail = contentHeight(letterPortrait);
    const blocks: Block[] = [
      { kind: 'block', html: 'A', h: avail - 60 },
      { kind: 'block', html: 'H', h: 40, keepWithNext: true },
      { kind: 'block', html: 'T', h: 200 },
    ];
    const ps = pages(paginate(blocks, letterPortrait, () => ''));
    expect(ps.length).toBe(2);
    expect(ps[1]).toContain('HT');
  });
});

describe('paper sizes', () => {
  test('the PDF is made at the page size picked, no margins', () => {
    expect(printOptions('x')).toMatchObject({ width: 612, height: 792, margins: { left: 0, top: 0, right: 0, bottom: 0 } });
    const d = paperOf('arch-d');
    expect(printOptions('x', { wIn: d.hIn, hIn: d.wIn })).toMatchObject({ width: 2592, height: 1728 });
    expect(paperOf('nonsense').id).toBe('letter');
    expect(PAPERS.map((p) => p.id)).toEqual(['letter', 'tabloid', 'arch-c', 'ansi-d', 'arch-d']);
  });
});

describe('the plan set', () => {
  const spec: LayoutSpec = {
    house: { length: 70, width: 40 },
    wall: { thick: 8 / 12, height: 44 / 12 },
    footing: { width: 16 / 12, depth: 10 / 12 },
    addOns: [{ side: 'top', width: 70, depth: 40, bays: [10, null, 10] }],
    slabs: [{ at: { in: 'main' }, thick: 4 / 12 }],
  };
  const raw: LayoutRaw = { layout: spec, wall: { bars: '1', lines: '2', barSize: '4', vSpacing: '24' }, footing: { bars: '1', lines: '2', barSize: '4' } };
  const job: Job = {
    id: 'j',
    name: 'Test 4',
    address: '12 Ranch Rd',
    customer: 'Pat Smith\n555-0100',
    notes: '',
    createdAt: 0,
    items: [{ id: 'L', toolId: LAYOUT_TOOL_ID, title: 'Foundation layout', label: '', raw: raw as never, at: 0 }],
  };
  const settings = { ...DEFAULT_SETTINGS, company: { ...DEFAULT_SETTINGS.company, name: 'Acme Foundations' } };

  test.each(PAPERS.map((p) => [p.id]))('%s: a cover and one sheet per drawing, each with a title block, sideways at the paper size', (id) => {
    const paper = paperOf(id);
    const set = buildPlanSet(job, settings, figureItems(job), paper, new Date(2026, 9, 6));
    expect(set.sheets.map((sh) => sh.no)).toEqual(['S0', 'S1', 'S2', 'S3']);
    expect(set.sheets.map((sh) => sh.title)).toEqual(['Cover and notes', 'Foundation plan', '3D view', 'Typical section']);
    const ps = pages(set.html);
    expect(ps.length).toBe(4);
    ps.forEach((p, i) => {
      expect(p).toContain('class="tb"');
      expect(p).toContain(`<b>S${i}</b>`);
      expect(p).toContain(`Sheet ${i + 1} of 4`);
      expect(p).toContain('Not to scale');
      expect(p).toContain('Acme Foundations');
      expect(p).toContain('<b>Test 4</b>');
      expect(p).toContain('<b>Pat Smith</b>');
    });
    expect(ps.slice(1).every((p) => p.includes('<svg'))).toBe(true);
    // One title block per sheet: the drawing's own is taken off; the section's callout names its sheet.
    expect(set.html).not.toContain('SHEET S1');
    expect(ps[3]).toContain('>S3</text>');
    expect(set.html).toContain(`@page { size: ${paper.hIn}in ${paper.wIn}in; margin: 0; }`);
    const box = sheetBox(paper);
    expect([box.w, box.h]).toEqual([paper.hIn * 96, paper.wIn * 96]);
    // Svg ids are unique across the set.
    const ids = [...set.html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
