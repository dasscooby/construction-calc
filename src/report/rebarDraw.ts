// The footing and its steel in 3D, at a typical corner: the footing see-through, the bars running
// along it and bent around the corner, and the vertical dowels standing up out of it at their spacing,
// as tall as they go into the wall, with the wall above shown dashed. Sizes from the job's own rebar.

import { ftIn } from '../tools/format';
import { barSpots } from './footingDraw';

const n = (v: number) => Math.round(v * 10) / 10;
const FONT = 'font-family="Helvetica, Arial, sans-serif"';
const dim = (ft: number) => ftIn(ft).replace(/' /, "'-");
const inch = (v: number) => `${n(v)}"`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const C30 = Math.cos(Math.PI / 6);

export interface FootingSteel {
  wallIn: number;
  wallFt: number;
  footing: { widthIn: number; depthIn: number; lines: number; barSize: number };
  /** Vertical bars (dowels) up into the wall; null = none set */
  vert: { size: number; spacingIn: number } | null;
  job: string;
}

export function footingRebarSvg(d: FootingSteel): string {
  const W = 760;
  const H = 600;
  const fw = d.footing.widthIn;
  const fd = d.footing.depthIn;
  const t = d.wallIn;
  const wallH = d.wallFt * 12;
  const leg = Math.max(72, Math.min(120, (d.vert?.spacingIn ?? 24) * 4 + fw)); // each leg of the corner, in
  // x along the first leg, y along the second, z up from the top of the footing; the corner's outside at 0,0.
  const proj = (x: number, y: number, z: number) => ({ x: (x - y) * C30, y: (x + y) * 0.5 - z });
  const cornerPts = [
    [0, 0, -fd], [leg, 0, -fd], [0, leg, -fd], [leg, fw, -fd], [fw, leg, -fd],
    [0, 0, wallH], [leg, 0, wallH], [0, leg, wallH],
  ].map(([x, y, z]) => proj(x, y, z));
  const minX = Math.min(...cornerPts.map((p) => p.x));
  const maxX = Math.max(...cornerPts.map((p) => p.x));
  const minY = Math.min(...cornerPts.map((p) => p.y));
  const maxY = Math.max(...cornerPts.map((p) => p.y));
  const k = Math.min(430 / (maxX - minX), 440 / (maxY - minY));
  const ox = 40 - minX * k;
  const oy = 50 - minY * k;
  const P = (x: number, y: number, z: number) => {
    const q = proj(x, y, z);
    return `${n(ox + q.x * k)},${n(oy + q.y * k)}`;
  };
  const out: string[] = [`<rect width="${W}" height="${H}" fill="#ffffff"/>`, `<rect class="dframe" x="6" y="6" width="${W - 12}" height="${H - 12}" fill="none" stroke="#111" stroke-width="2"/>`];
  const poly = (pts: [number, number, number][], fill: string, stroke = '#55514b', extra = '') =>
    out.push(`<polygon points="${pts.map(([x, y, z]) => P(x, y, z)).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="1.2" stroke-linejoin="round" ${extra}/>`);
  const line = (a: [number, number, number], b: [number, number, number], stroke: string, w: number, extra = '') => out.push(`<line x1="${P(...a).split(',')[0]}" y1="${P(...a).split(',')[1]}" x2="${P(...b).split(',')[0]}" y2="${P(...b).split(',')[1]}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" ${extra}/>`);
  const path = (pts: [number, number, number][], stroke: string, w: number) => out.push(`<polyline points="${pts.map(([x, y, z]) => P(x, y, z)).join(' ')}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`);

  // The footing, an L, see-through so the steel shows: back faces, then the bars, then the front faces.
  const L: [number, number][] = [[0, 0], [leg, 0], [leg, fw], [fw, fw], [fw, leg], [0, leg]];
  const conc = '#d9d5cc';
  poly(L.map(([x, y]) => [x, y, -fd]), conc, '#9a958d', 'fill-opacity="0.35"');
  const red = '#b5371a';
  const barW = (size: number) => Math.max(2.4, (size / 8) * k * 0.9);
  // Footing bars: each at its spot in the section, along the first leg, round the corner, along the second.
  for (const sp of barSpots(fw, fd, d.footing.lines)) {
    const o = sp.x; // in from the outside face
    const z = -sp.y;
    path([[leg - 2, o, z], [o, o, z], [o, leg - 2, z]], red, barW(d.footing.barSize));
  }
  // Dowels: centered in the wall, from near the bottom of the footing (hooked) to near the top of the wall.
  const dowels: [number, number][] = [];
  if (d.vert) {
    const c = fw / 2; // footing centered under the wall
    for (let s = c; s <= leg - 3; s += d.vert.spacingIn) dowels.push([s, c]);
    for (let s = c + d.vert.spacingIn; s <= leg - 3; s += d.vert.spacingIn) dowels.push([c, s]);
    dowels.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
    const hook = Math.min(12, fw / 2 - 3);
    for (const [x, y] of dowels) {
      const onFirst = y === c;
      const foot: [number, number, number] = onFirst ? [x, y + hook, -fd + 3] : [x + hook, y, -fd + 3];
      path([foot, [x, y, -fd + 3], [x, y, wallH - 3]], red, barW(d.vert.size));
    }
  }
  // Front faces of the footing and its top, see-through.
  poly([[0, leg, -fd], [fw, leg, -fd], [fw, leg, 0], [0, leg, 0]], conc, '#7d786f', 'fill-opacity="0.45"');
  poly([[fw, fw, -fd], [fw, leg, -fd], [fw, leg, 0], [fw, fw, 0]], conc, '#7d786f', 'fill-opacity="0.45"');
  poly([[fw, fw, -fd], [leg, fw, -fd], [leg, fw, 0], [fw, fw, 0]], conc, '#7d786f', 'fill-opacity="0.45"');
  poly([[leg, 0, -fd], [leg, fw, -fd], [leg, fw, 0], [leg, 0, 0]], conc, '#7d786f', 'fill-opacity="0.45"');
  poly(L.map(([x, y]) => [x, y, 0]), conc, '#55514b', 'fill-opacity="0.3"');
  // The wall above, dashed, centered on the footing.
  const w0 = fw / 2 - t / 2;
  const w1 = fw / 2 + t / 2;
  const WL: [number, number][] = [[w0, w0], [leg, w0], [leg, w1], [w1, w1], [w1, leg], [w0, leg]];
  const dash = 'stroke-dasharray="7 5"';
  for (let i = 0; i < WL.length; i++) {
    const a = WL[i];
    const b = WL[(i + 1) % WL.length];
    line([a[0], a[1], wallH], [b[0], b[1], wallH], '#555', 1.2, dash);
  }
  for (const [x, y] of [[w1, w1], [leg, w1], [w1, leg], [leg, w0], [w0, leg]] as [number, number][]) line([x, y, 0], [x, y, wallH], '#555', 1.2, dash);

  // Callouts down the right side, with leaders.
  const notes: { at: [number, number, number]; text: string[] }[] = [];
  if (d.vert && dowels.length) {
    const [x, y] = dowels[Math.min(2, dowels.length - 1)];
    notes.push({ at: [x, y, wallH * 0.7], text: [`#${d.vert.size} VERTICAL @ ${inch(d.vert.spacingIn)} O.C.`, `${dim((wallH + fd - 6) / 12)} TALL, HOOKED IN THE FOOTING`, 'CENTERED IN THE WALL'] });
  } else notes.push({ at: [fw / 2, leg * 0.6, wallH * 0.5], text: ['NO VERTICAL BARS SET', 'SET THEM IN THE WALL BOXES'] });
  notes.push({ at: [leg * 0.55, fw / 2, -fd / 2], text: [d.footing.lines ? `(${d.footing.lines}) #${d.footing.barSize} CONTINUOUS` : 'NO FOOTING BARS SET', d.footing.lines ? 'BENT AROUND EVERY CORNER' : ''].filter(Boolean) });
  notes.push({ at: [fw, leg * 0.75, -fd * 0.5], text: [`${inch(fw)} × ${inch(fd)} FOOTING`, 'SHOWN SEE-THROUGH'] });
  notes.push({ at: [w1, leg * 0.75, wallH], text: [`${inch(t)} WALL ABOVE (DASHED)`, `${dim(d.wallFt)} TALL`] });
  const nx = W - 250;
  // Top to bottom in the order they point, so no two leaders cross.
  const placed = notes.map((note) => ({ note, a: P(...note.at).split(',').map(Number) })).sort((p, q) => p.a[1] - q.a[1]);
  placed.forEach(({ note, a: [ax, ay] }, i) => {
    const ny = 120 + i * 105;
    out.push(`<polyline points="${n(ax)},${n(ay)} ${nx - 14},${ny - 6} ${nx - 4},${ny - 6}" fill="none" stroke="#111" stroke-width="1.1"/><circle cx="${n(ax)}" cy="${n(ay)}" r="3" fill="#111"/>`);
    note.text.forEach((l, j) => out.push(`<text x="${nx}" y="${n(ny + j * 19)}" ${FONT} font-size="${j === 0 ? 15 : 13}" font-weight="${j === 0 ? 800 : 500}" fill="#111">${esc(l)}</text>`));
  });

  out.push(`<line x1="20" y1="${H - 62}" x2="${W - 20}" y2="${H - 62}" stroke="#111" stroke-width="1.5"/>`);
  out.push(`<text x="24" y="${H - 28}" ${FONT} font-size="22" font-weight="900" fill="#111">FOOTING &amp; DOWELS · TYPICAL CORNER</text>`);
  out.push(`<text x="${W - 22}" y="${H - 28}" text-anchor="end" ${FONT} font-size="13" fill="#333">NOT TO SCALE · ${esc(d.job)}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Footing and dowels">${out.join('')}</svg>`;
}
