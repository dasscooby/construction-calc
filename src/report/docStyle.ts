// How bids, bills and crew sheets look: color, font, header layout, and the formal notice at the bottom.
// Set in Settings → Documents; blank notices use the standard wording below.

export const DOC_COLORS = {
  black: { label: 'Black', hex: '#111111' },
  navy: { label: 'Navy', hex: '#1f3a5f' },
  forest: { label: 'Green', hex: '#2f5233' },
  brick: { label: 'Brick', hex: '#8a2e1c' },
  orange: { label: 'Orange', hex: '#c25e00' },
  slate: { label: 'Slate', hex: '#4a5560' },
} as const;
export type DocColor = keyof typeof DOC_COLORS;

export const DOC_FONTS = {
  clean: { label: 'Clean', css: "-apple-system, Helvetica, Arial, sans-serif" },
  classic: { label: 'Classic', css: "Georgia, 'Times New Roman', Times, serif" },
  modern: { label: 'Modern', css: "'Avenir Next', Avenir, 'Segoe UI', Roboto, sans-serif" },
} as const;
export type DocFont = keyof typeof DOC_FONTS;

export type DocHeader = 'side' | 'center';
export type DocKind = 'crew' | 'bid' | 'bill';

export interface DocSettings {
  color: DocColor;
  font: DocFont;
  header: DocHeader;
  /** Notice at the bottom of each document; blank = the standard wording */
  crewNotice: string;
  bidNotice: string;
  billNotice: string;
  /** Company logo: a picture file on the phone, or a data URI on the web. '' = none */
  logo: string;
}

export const DEFAULT_DOCS: DocSettings = { color: 'black', font: 'clean', header: 'side', crewNotice: '', bidNotice: '', billNotice: '', logo: '' };

/** Pictures that go in a document, as data URIs (loaded before the document is made). */
export interface DocMedia {
  logo?: string;
  /** Job photos (crew sheet) */
  photos?: string[];
  /** Scanned plan pages (crew sheet) */
  scans?: string[];
}

export const logoHtml = (logo?: string) => (logo ? `<img class="logo" src="${logo}" alt="Logo">` : '');

export const DEFAULT_NOTICE: Record<DocKind, string> = {
  crew:
    'Quantities shown are field estimates for ordering and layout. Verify all dimensions against the approved plans before placing concrete. The approved plans and the engineer’s specifications govern.',
  bid:
    'This proposal is valid for 30 days from the date above. Pricing covers only the work described. Changes, additional work, or unforeseen site conditions will be billed separately upon written approval. Acceptance of this proposal authorizes the work as described.',
  bill: 'Payment is due upon receipt unless otherwise agreed in writing. Please reference the invoice number with your payment. Thank you for your business.',
};

const key = (kind: DocKind) => `${kind}Notice` as const;

export const noticeText = (kind: DocKind, d: DocSettings) => d[key(kind)].trim() || DEFAULT_NOTICE[kind];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const noticeHtml = (kind: DocKind, d: DocSettings) => `<div class="notice">${esc(noticeText(kind, d)).replace(/\n/g, '<br>')}</div>`;

/** Extra CSS laid over a document's own styles. */
export function docCss(d: DocSettings): string {
  const ink = DOC_COLORS[d.color]?.hex ?? DOC_COLORS.black.hex;
  const font = DOC_FONTS[d.font]?.css ?? DOC_FONTS.clean.css;
  return `
  body { font-family: ${font}; }
  h1, h2, .doc h1, .co b { color: ${ink}; }
  .top { border-bottom-color: ${ink} !important; }
  th { border-bottom-color: ${ink} !important; color: ${ink}; }
  .sum tr.total td { border-top-color: ${ink} !important; }
  .kind { color: ${ink}; }
  .logo { display: block; max-height: 72px; max-width: 220px; margin-bottom: 6px; }
  .photos { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .photos img { width: 100%; border-radius: 6px; border: 1px solid #ccc; break-inside: avoid; }
  .notice { margin-top: 30px; padding-top: 10px; border-top: 1px solid #bbb; font-size: 10.5px; line-height: 1.5; color: #555; text-align: justify; break-inside: avoid; }
  ${
    d.header === 'center'
      ? `.top { flex-direction: column; align-items: center; text-align: center; }
  .top > div { text-align: center !important; }
  .top .co .logo, .top .logo { margin-left: auto; margin-right: auto; }
  .co { order: -1; }`
      : ''
  }`;
}
