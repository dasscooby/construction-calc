// One look for every drawing, the way the foundation plan does it: a white sheet, black linework,
// steel in red, a border, and a title bar. Plans and sections get the frame; 3D views keep their
// light background and use the same steel color.

export const INK = '#111111';
export const STEEL = '#b5371a';
export const STEEL_DARK = '#7a1f0c';
const FONT = 'font-family="Helvetica, Arial, sans-serif"';

/**
 * Turns the old blue-blueprint colors into print colors in one pass (each color is swapped once,
 * so a white that became the background isn't turned black again).
 */
const SWAP: Record<string, string> = {
  '#0b4f8a': '#ffffff',
  '#0d4a8a': '#ffffff',
  '#ffffff': INK,
  '#fff': INK,
  '#ffb347': STEEL,
  '#ff7a00': STEEL,
  '#e05a00': STEEL,
  '#cfe3ff': '#555555',
  '#cfe0f5': '#444444',
  '#9ec5ff': '#555555',
  '#c3cbd2': '#8a8a8a',
  '#3ddc84': '#1a7f37',
  '#ff5a5a': '#c62828',
  '#ff8a8a': '#c62828',
  'rgba(255,255,255,0.22)': 'rgba(0,0,0,0.07)',
  'rgba(255,255,255,0.18)': 'rgba(0,0,0,0.08)',
  'rgba(255,255,255,0.16)': 'rgba(0,0,0,0.04)',
  'rgba(255,255,255,0.08)': 'rgba(0,0,0,0.04)',
  'rgba(200,220,255,0.10)': 'rgba(0,0,0,0.04)',
};
const SWAP_RE = new RegExp(Object.keys(SWAP).map((k) => k.replace(/[().]/g, '\\$&')).join('|'), 'gi');

export const printColors = (svg: string) => svg.replace(SWAP_RE, (m) => SWAP[m.toLowerCase()] ?? m);

/**
 * Adds the sheet border and a title bar at the bottom (title on the left, a note on the right),
 * making the drawing taller to fit it.
 */
export function withTitleBar(svg: string, title: string, note = 'NOT TO SCALE'): string {
  const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!m) return svg;
  const W = Number(m[1]);
  const H0 = Number(m[2]);
  const bar = 58;
  const H = H0 + bar;
  const open = svg.indexOf('>') + 1;
  const head = svg.slice(0, open).replace(m[0], `viewBox="0 0 ${W} ${H}"`);
  const body = svg.slice(open, svg.lastIndexOf('</svg>'));
  const esc = (s: string) => s.replace(/&/g, '+').replace(/</g, '‹').replace(/>/g, '›');
  const frame =
    `<rect x="6" y="6" width="${W - 12}" height="${H - 12}" fill="none" stroke="${INK}" stroke-width="2"/>` +
    `<line x1="6" y1="${H0}" x2="${W - 6}" y2="${H0}" stroke="${INK}" stroke-width="1.5"/>` +
    `<text x="22" y="${H0 + 36}" ${FONT} font-size="20" font-weight="900" fill="${INK}">${esc(title.toUpperCase())}</text>` +
    `<text x="${W - 22}" y="${H0 + 36}" text-anchor="end" ${FONT} font-size="12" fill="#333">${esc(note)}</text>`;
  return `${head}<rect width="${W}" height="${H}" fill="#ffffff"/>${body}${frame}</svg>`;
}
