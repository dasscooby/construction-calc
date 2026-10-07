// Laying a document out on real pages, like a book or a plan set: each section can start on a fresh
// page, a row or a block is never cut by a page break, a table that runs long carries on under its
// heading with "(continued)" and its column heads again, and every page ends with a footer (job, date,
// "Page X of Y"). Heights are estimated from the text (on the high side), so a page is never overfilled;
// if something is still taller than a page it gets a page to itself and runs on rather than being cut.

/** CSS pixels per inch (what browsers and the PDF maker use) */
export const PX_PER_IN = 96;

export interface Paper {
  id: PaperId;
  label: string;
  /** Portrait size, inches */
  wIn: number;
  hIn: number;
}

export type PaperId = 'letter' | 'tabloid' | 'arch-c' | 'ansi-d' | 'arch-d';

export const PAPERS: Paper[] = [
  { id: 'letter', label: 'Letter 8½ × 11', wIn: 8.5, hIn: 11 },
  { id: 'tabloid', label: 'Tabloid 11 × 17', wIn: 11, hIn: 17 },
  { id: 'arch-c', label: '18 × 24', wIn: 18, hIn: 24 },
  { id: 'ansi-d', label: 'ANSI D 22 × 34', wIn: 22, hIn: 34 },
  { id: 'arch-d', label: 'Blueprint 24 × 36', wIn: 24, hIn: 36 },
];

export const paperOf = (id: string | undefined): Paper => PAPERS.find((p) => p.id === id) ?? PAPERS[0];

export interface PageBox {
  /** Page size, CSS px */
  w: number;
  h: number;
  /** Margin all round, px */
  margin: number;
  /** Footer band at the bottom, px */
  footer: number;
}

export const letterPortrait: PageBox = { w: 8.5 * PX_PER_IN, h: 11 * PX_PER_IN, margin: 0.5 * PX_PER_IN, footer: 30 };

/** Room for content on a page, px */
export const contentHeight = (p: PageBox) => p.h - 2 - 2 * p.margin - p.footer;
export const contentWidth = (p: PageBox) => p.w - 2 * p.margin;

/** Height of text set in a box this wide: lines × line height (Helvetica, on the generous side). */
export function textHeight(text: string, fontPx: number, widthPx: number, lineHeight = 1.4): number {
  const perLine = Math.max(1, Math.floor(widthPx / (fontPx * 0.56)));
  const lines = String(text)
    .split('\n')
    .reduce((n, part) => n + Math.max(1, Math.ceil(part.length / perLine)), 0);
  return lines * fontPx * lineHeight;
}

export type Block =
  /** A piece kept whole */
  | { kind: 'block'; html: string; h: number; newPage?: boolean; keepWithNext?: boolean }
  /** A table that can run across pages, a row at a time */
  | {
      kind: 'table';
      /** Heading over it ('' for none); on the pages it runs onto: "<title or contTitle> (continued)" */
      title: string;
      contTitle?: string;
      /** Table class */
      cls: string;
      /** Column heads row (<tr>…</tr>), repeated on every page it runs onto; '' for none */
      head: string;
      headH: number;
      rows: { html: string; h: number }[];
      newPage?: boolean;
    }
  /** A whole page (a drawing sheet) */
  | { kind: 'sheet'; html: string };

const TITLE_H = 44;

interface Page {
  html: string[];
  used: number;
  sheet?: boolean;
}

/** The pages' HTML (each a .page box), footer on each: footer(page number, page count). */
export function paginate(blocks: Block[], box: PageBox, footer: (n: number, of: number) => string): string {
  const avail = contentHeight(box);
  const pages: Page[] = [{ html: [], used: 0 }];
  const cur = () => pages[pages.length - 1];
  const fresh = () => {
    if (cur().used > 0 || cur().sheet) pages.push({ html: [], used: 0 });
  };
  blocks.forEach((b, i) => {
    if (b.kind === 'sheet') {
      fresh();
      cur().html.push(b.html);
      cur().sheet = true;
      cur().used = avail;
      return;
    }
    if (b.newPage) fresh();
    if (b.kind === 'block') {
      // Kept with what follows: needs room for itself and the start of the next piece.
      const next = blocks[i + 1];
      const nextMin = b.keepWithNext && next && next.kind !== 'sheet' ? (next.kind === 'table' ? TITLE_H + next.headH + (next.rows[0]?.h ?? 0) : Math.min(next.h, 80)) : 0;
      if (cur().used > 0 && cur().used + b.h + nextMin > avail) fresh();
      cur().html.push(b.html);
      cur().used += b.h;
      return;
    }
    // A table: its title and heads plus at least one row together, then row by row.
    const titleH = b.title ? TITLE_H : 0;
    const first = titleH + b.headH + (b.rows[0]?.h ?? 0);
    if (cur().used > 0 && cur().used + first > avail) fresh();
    let open = false;
    let continued = false;
    const start = () => {
      const heading = continued ? `<h2>${b.title || b.contTitle || ''} <span class="cont">(continued)</span></h2>` : b.title ? `<h2>${b.title}</h2>` : '';
      cur().html.push(`${heading}<table class="${b.cls}">${b.head}`);
      cur().used += (heading ? TITLE_H : 0) + b.headH;
      open = true;
    };
    const close = () => {
      if (open) cur().html.push('</table>');
      open = false;
    };
    start();
    for (const r of b.rows) {
      if (cur().used + r.h > avail && cur().used > titleH + b.headH + TITLE_H) {
        close();
        fresh();
        continued = true;
        start();
      }
      cur().html.push(r.html);
      cur().used += r.h;
    }
    close();
  });
  const n = pages.length;
  return pages
    .map(
      (p, i) =>
        `<section class="page${p.sheet ? ' sheetpage' : ''}" style="width:${box.w}px;height:${box.h - 2}px;padding:${box.margin}px ${box.margin}px ${box.margin + box.footer}px">` +
        `<div class="pagebody">${p.html.join('')}</div><div class="pagefoot" style="left:${box.margin}px;right:${box.margin}px;bottom:${box.margin * 0.6}px">${footer(i + 1, n)}</div></section>`,
    )
    .join('');
}

/** Page styles: fixed-size pages with a gap between them on screen, one per sheet of paper when printed. */
export function pageCss(box: PageBox): string {
  return `
  @page { size: ${box.w / PX_PER_IN}in ${box.h / PX_PER_IN}in; margin: 0; }
  html { background: #8a8a8a; }
  body { margin: 0; padding: 12px 0; }
  .page { position: relative; box-sizing: border-box; margin: 0 auto 12px; background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,.35); overflow: hidden; -webkit-print-color-adjust: exact; print-color-adjust: exact; break-after: page; page-break-after: always; }
  .page:last-child { break-after: auto; page-break-after: auto; }
  /* (A page is a fixed box a hair short of the paper, so the break after it lands on the paper's edge in any
     print engine; the iPhone's ignores "don't split" on rows, so nothing relies on that.) */
  .pagebody > * { break-inside: avoid; page-break-inside: avoid; }
  .pagefoot { position: absolute; display: flex; justify-content: space-between; gap: 12px; font-size: 11px; color: #555; border-top: 1px solid #bbb; padding-top: 6px; }
  .cont { font-weight: 400; color: #777; text-transform: none; letter-spacing: 0; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  @media print { html { background: #fff; } body { padding: 0; } .page { margin: 0; box-shadow: none; } .print { display: none; } }`;
}

/** "Test 4 · Oct 6, 2026" on the left, "Page 2 of 5" on the right. */
export const footerHtml = (left: string, n: number, of: number) => `<span>${left}</span><span>Page ${n} of ${of}</span>`;

/** A drawing on a page of its own: a title bar, then the drawing as big as fits (it keeps its shape). */
export function drawingPage(svg: string, title: string, right: string, box: PageBox): Block {
  const h = contentHeight(box) - 46;
  return {
    kind: 'sheet',
    html: `<div class="dhead"><b>${title}</b><span>${right}</span></div><div class="fit" style="height:${h}px">${svg}</div>`,
  };
}

export const drawingCss = `
  .dhead { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #111; padding-bottom: 6px; margin-bottom: 10px; font-size: 13px; color: #333; }
  .dhead b { font-size: 17px; text-transform: uppercase; letter-spacing: .06em; color: #111; }
  .fit { display: flex; align-items: center; justify-content: center; border: 1px solid #ccc; border-radius: 8px; overflow: hidden; }
  .fit svg { display: block; width: 100%; height: 100%; }`;
