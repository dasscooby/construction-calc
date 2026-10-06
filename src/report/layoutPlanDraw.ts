// Drawings of a foundation layout (wall runs, footings, slab areas), in the print style of the
// foundation plan: hatched walls, the footing as dashed hidden lines, each run labeled with its name
// and length as measured, slabs shaded with their pour callout, the bays dimensioned face to face, and
// a title block. The plan can light up one run or one area, and a tap can be turned into the run or
// area under it (hitLayout), so a screen can match the drawing to its list.
// Also a 3D view: footing, wall and slab pieces, nearest drawn last.

import { ftIn } from '../tools/format';
import type { Layout } from './foundationLayout';
import { faceAt, Pt, RunResult } from './wallGraph';

const n = (v: number) => Math.round(v * 10) / 10;
const esc = (s: string) => s.replace(/&/g, '+').replace(/</g, '‹').replace(/>/g, '›');
const FONT = 'font-family="Helvetica, Arial, sans-serif"';
/** 70' 0" → 70'-0" (how prints write it) */
const dim = (ft: number) => ftIn(ft).replace(/' /, "'-");
const inch = (ft: number) => `${n(ft * 12)}"`;
const HILITE = '#ff7a00';

export interface LayoutDrawInfo {
  title: string;
  job: string;
  company: string;
  date: string;
  /** Concrete ordered for each pour (yd), by pour number */
  pourYd?: Record<number, number>;
  /** Light up a run (index in layout.runs) or an area (index in layout.graph.faces) */
  highlight?: { run?: number; face?: number };
  /** Just the plan (no legend or title block), for the editor */
  compact?: boolean;
}

/** Plan scale and placement, shared by the drawing and the hit-test. */
export function planFrame(l: Layout) {
  const pts = l.graph.runs.flatMap((r) => wallRect(r));
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  const W = 760;
  const pad = 120;
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const s = Math.min((W - 2 * pad) / spanX, 520 / spanY);
  const ox = (W - spanX * s) / 2;
  const planH = spanY * s + 2 * pad;
  return {
    W,
    pad,
    s,
    planH,
    minX,
    minY,
    maxX,
    maxY,
    X: (x: number) => n(ox + (x - minX) * s),
    Y: (y: number) => n(pad + (y - minY) * s),
    /** Drawing point (in the SVG's own units) back to plan feet */
    toPlan: (px: number, py: number): Pt => ({ x: minX + (px - ox) / s, y: minY + (py - pad) / s }),
  };
}

const unit = (r: { a: Pt; b: Pt }) => {
  const L = Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y) || 1;
  return { x: (r.b.x - r.a.x) / L, y: (r.b.y - r.a.y) / L };
};

/** The body of a run as drawn: corners run out to the outside corner, tees stop where they meet. */
function bodyRect(r: RunResult, half: number, trim: [number, number]): Pt[] {
  const d = unit(r.run);
  const nrm = { x: -d.y, y: d.x };
  const ext = (k: 0 | 1) => (r.ends[k] === 'corner' ? half : -trim[k]);
  const a = { x: r.run.a.x - d.x * ext(0), y: r.run.a.y - d.y * ext(0) };
  const b = { x: r.run.b.x + d.x * ext(1), y: r.run.b.y + d.y * ext(1) };
  return [
    { x: a.x + nrm.x * half, y: a.y + nrm.y * half },
    { x: b.x + nrm.x * half, y: b.y + nrm.y * half },
    { x: b.x - nrm.x * half, y: b.y - nrm.y * half },
    { x: a.x - nrm.x * half, y: a.y - nrm.y * half },
  ];
}
const wallRect = (r: RunResult) => bodyRect(r, r.run.thick / 2, r.trim);
const footRect = (r: RunResult) => (r.run.footing ? bodyRect(r, r.run.footing.width / 2, r.footTrim) : null);

/** The run or area under a point of the drawing (SVG units), for tap-to-select. */
export function hitLayout(l: Layout, px: number, py: number): { run?: number; face?: number } {
  const f = planFrame(l);
  const p = f.toPlan(px, py);
  const slack = 14 / f.s; // a fingertip
  let best = -1;
  let bestD = Infinity;
  l.graph.runs.forEach((r, i) => {
    const d = unit(r.run);
    const L = Math.hypot(r.run.b.x - r.run.a.x, r.run.b.y - r.run.a.y);
    const along = (p.x - r.run.a.x) * d.x + (p.y - r.run.a.y) * d.y;
    const off = Math.abs((p.x - r.run.a.x) * -d.y + (p.y - r.run.a.y) * d.x);
    if (along < -r.run.thick / 2 || along > L + r.run.thick / 2) return;
    if (off <= r.run.thick / 2 + slack && off < bestD) {
      best = i;
      bestD = off;
    }
  });
  if (best >= 0) return { run: best };
  const face = faceAt(l.graph.faces, p);
  return face >= 0 ? { face } : {};
}

export function graphPlanSvg(l: Layout, info: LayoutDrawInfo): string {
  const F = planFrame(l);
  const { W, s, X, Y, planH } = F;
  const legendH = info.compact ? 0 : 24 + 32 * (2 + (l.spec.footing ? 1 : 0) + l.slabs.length);
  const titleH = info.compact ? 6 : 76;
  const H = Math.round(planH + legendH + titleH);
  const path = (pts: Pt[]) => `M${pts.map((p) => `${X(p.x)} ${Y(p.y)}`).join(' L')} Z`;
  const out: string[] = [];
  out.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  out.push(
    `<defs><pattern id="lhatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="9" stroke="#111" stroke-width="1.2"/></pattern>` +
      `<pattern id="ldots" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1" fill="#9a9a9a"/><circle cx="9" cy="9" r="1" fill="#9a9a9a"/></pattern></defs>`,
  );
  out.push(`<rect x="6" y="6" width="${W - 12}" height="${H - 12}" fill="none" stroke="#111" stroke-width="2"/>`);
  const hl = info.highlight ?? {};
  // On the phone the plan is about half size: bigger, shorter labels so they read in sunlight.
  const fs = info.compact ? 1.9 : 1;
  const ft = (v: number) => (info.compact ? dim(v).replace(/-0"$/, '') : dim(v));
  const slabFaces = new Map(l.slabs.map((sl) => [l.graph.faces.indexOf(sl.face), sl]));

  // Slabs: shaded inside the walls.
  l.graph.faces.forEach((face, i) => {
    if (slabFaces.has(i)) out.push(`<path d="${path(face.clear)}" fill="url(#ldots)" stroke="none"/>`);
    if (hl.face === i) out.push(`<path d="${path(face.clear)}" fill="${HILITE}" fill-opacity="0.22" stroke="${HILITE}" stroke-width="3"/>`);
  });
  // Footings: hidden lines.
  for (const r of l.graph.runs) {
    const fr = footRect(r);
    if (fr) out.push(`<path d="${path(fr)}" fill="none" stroke="#111" stroke-width="1.4" stroke-dasharray="11 7"/>`);
  }
  // Walls: one heavy outline around all of them (stroke under, fills over), hatched.
  const rects = l.graph.runs.map(wallRect);
  for (const r of rects) out.push(`<path d="${path(r)}" fill="none" stroke="#111" stroke-width="5" stroke-linejoin="miter"/>`);
  for (const r of rects) out.push(`<path d="${path(r)}" fill="#ffffff" stroke="none"/>`);
  rects.forEach((r, i) => out.push(`<path d="${path(r)}" fill="${l.runs[i].existing ? '#d9d9d9' : 'url(#lhatch)'}" stroke="none"/>`));
  if (hl.run !== undefined && rects[hl.run]) out.push(`<path d="${path(rects[hl.run])}" fill="${HILITE}" fill-opacity="0.75" stroke="${HILITE}" stroke-width="2"/>`);

  // Run labels: name and length as measured, beside each wall, on the side away from the middle (house
  // walls: away from the middle of the house, so a shared wall's label stays in the house; inside walls
  // land in the bay on their outer side).
  const cx = (F.minX + F.maxX) / 2;
  const cy = (F.minY + F.maxY) / 2;
  const hx = l.spec.house.length / 2;
  const hy = l.spec.house.width / 2;
  l.graph.runs.forEach((r, i) => {
    const d = unit(r.run);
    const mx = (r.run.a.x + r.run.b.x) / 2;
    const my = (r.run.a.y + r.run.b.y) / 2;
    let nx = -d.y;
    let ny = d.x;
    const inside = /inside/i.test(r.run.name);
    const info2 = l.runs[i];
    const [ox, oy] = info2.group === 'Main' ? [hx, hy] : [cx, cy];
    const away = (mx - ox) * nx + (my - oy) * ny;
    // A main wall an add-on builds off: its label goes inside the main house.
    const shared = info2.shared;
    if ((away < 0) !== shared) {
      nx = -nx;
      ny = -ny;
    }
    if (inside) {
      // Into the roomier bay beside it.
      const room = (sx: number, sy: number) => {
        const k = faceAt(l.graph.faces, { x: mx + sx * (r.run.thick / 2 + 1), y: my + sy * (r.run.thick / 2 + 1) });
        const f = l.graph.faces[k];
        if (!f) return 0;
        const xs = f.clear.map((p) => p.x);
        const ys = f.clear.map((p) => p.y);
        return Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      };
      if (room(-nx, -ny) > room(nx, ny)) {
        nx = -nx;
        ny = -ny;
      }
    }
    const gap = (r.run.thick / 2) * s + (inside ? 12 : 20) * fs;
    const tx = Number(X(mx)) + nx * gap;
    const ty = Number(Y(my)) + ny * gap;
    const vertical = Math.abs(d.x) < Math.abs(d.y);
    const name = info.compact ? r.run.name.replace(/^(Main|Add-on( \d+)?) /, '') : r.run.name;
    const text = `${name.toUpperCase()} ${ft(r.run.measured)}${info2.existing ? ' (EXISTING)' : ''}`;
    const on = hl.run === i;
    out.push(
      `<text x="${n(tx)}" y="${n(ty + (vertical ? 0 : 5))}" text-anchor="middle" ${FONT} font-size="${(inside ? 12 : 14) * fs}" font-weight="800" fill="${on ? HILITE : '#111'}"${vertical ? ` transform="rotate(-90 ${n(tx)} ${n(ty)})"` : ''}>${esc(text)}</text>`,
    );
  });

  // Bays, face to face, along each add-on's far wall.
  const dimString = (p: Pt, q: Pt, nx: number, ny: number, offPx: number, label: string) => {
    const a = { x: Number(X(p.x)) + nx * offPx, y: Number(Y(p.y)) + ny * offPx };
    const c = { x: Number(X(q.x)) + nx * offPx, y: Number(Y(q.y)) + ny * offPx };
    for (const pt of [p, q]) out.push(`<line x1="${n(Number(X(pt.x)) + nx * 4)}" y1="${n(Number(Y(pt.y)) + ny * 4)}" x2="${n(Number(X(pt.x)) + nx * (offPx + 8))}" y2="${n(Number(Y(pt.y)) + ny * (offPx + 8))}" stroke="#111" stroke-width="0.9"/>`);
    out.push(`<line x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(c.x)}" y2="${n(c.y)}" stroke="#111" stroke-width="1"/>`);
    for (const e of [a, c]) out.push(`<line x1="${n(e.x - 5)}" y1="${n(e.y + 5)}" x2="${n(e.x + 5)}" y2="${n(e.y - 5)}" stroke="#111" stroke-width="2"/>`);
    const vertical = Math.abs(q.x - p.x) < Math.abs(q.y - p.y);
    const mx = (a.x + c.x) / 2 + nx * 13 * fs;
    const my = (a.y + c.y) / 2 + ny * 13 * fs;
    out.push(`<text x="${n(mx)}" y="${n(my + (vertical ? 0 : 5))}" text-anchor="middle" ${FONT} font-size="${15 * fs}" font-weight="700" fill="#111"${vertical ? ` transform="rotate(-90 ${n(mx)} ${n(my)})"` : ''}>${esc(label)}</text>`);
  };
  for (const g of l.addOnGeom) {
    const marks = g.bays.marks;
    if (marks.length <= 2) continue;
    // Past the far wall (bays along the main wall) or past the end side wall (bays going out): each bay
    // from wall face to wall face.
    const along = g.bays.axis === 'u';
    const pt = (k: number) => (along ? g.at(k, g.depth) : g.at(g.from + g.width, k));
    const dir = along ? g.out : g.dir;
    for (let i = 0; i + 1 < marks.length; i += 2) dimString(pt(marks[i]), pt(marks[i + 1]), dir.x, dir.y, 52, ft(marks[i + 1] - marks[i]));
    const mid = pt((marks[0] + marks[marks.length - 1]) / 2);
    const vertical = along ? Math.abs(g.dir.x) < Math.abs(g.dir.y) : Math.abs(g.out.x) < Math.abs(g.out.y);
    const lx = Number(X(mid.x)) + dir.x * 92;
    const ly2 = Number(Y(mid.y)) + dir.y * 92;
    out.push(`<text x="${n(lx)}" y="${n(ly2 + (vertical ? 0 : 5))}" text-anchor="middle" ${FONT} font-size="${13 * fs}" font-weight="700" fill="#333"${vertical ? ` transform="rotate(-90 ${n(lx)} ${n(ly2)})"` : ''}>BAYS, CLEAR (FACE TO FACE)</text>`);
  }

  // Slab callouts.
  slabFaces.forEach((sl, i) => {
    const face = l.graph.faces[i];
    const xs = face.clear.map((p) => p.x);
    const ys = face.clear.map((p) => p.y);
    const c = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    const size = face.rect ? `${dim(face.rect.w)} × ${dim(face.rect.h)} CLEAR` : '';
    const yd = info.pourYd?.[sl.pour];
    const widthPx = (Math.max(...xs) - Math.min(...xs)) * s;
    const heightPx = (Math.max(...ys) - Math.min(...ys)) * s;
    const big = widthPx > 220 && !info.compact;
    // A narrow bay gets a one-line callout; the full one is on the legend's pour list.
    const small = Math.min(widthPx, heightPx) < 90;
    const full = [`${inch(sl.thick)} SLAB ${sl.pour}`, size, `${Math.round(face.clearArea).toLocaleString()} SQ FT${yd ? ` · ${yd} YD` : ''}`].filter(Boolean);
    const lines = small || info.compact ? [`SLAB ${sl.pour}`, ...(small ? [] : [`${Math.round(face.clearArea).toLocaleString()} SQ FT`])] : full;
    lines.forEach((t, k) =>
      out.push(
        `<text x="${X(c.x)}" y="${n(Number(Y(c.y)) - ((lines.length - 1) * (big ? 22 : 17) * fs) / 2 + k * (big ? 22 : 17) * fs + 5 * fs)}" text-anchor="middle" ${FONT} font-size="${(k === 0 ? (big ? 18 : 14) : big ? 15 : 12) * fs}" font-weight="${k === 0 ? 800 : 600}" fill="#111">${esc(t)}</text>`,
      ),
    );
  });

  if (info.compact) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Plan view">${out.join('')}</svg>`;

  // Legend.
  const spec = l.spec;
  const ly = planH + 4;
  out.push(`<line x1="20" y1="${n(ly)}" x2="${W - 20}" y2="${n(ly)}" stroke="#111" stroke-width="1"/>`);
  const legend: [string, string][] = [
    [`<rect x="28" y="${n(ly + 14)}" width="44" height="18" fill="url(#lhatch)" stroke="#111" stroke-width="1.5"/>`, `${inch(spec.wall.thick)} CONCRETE WALL, ${dim(spec.wall.height)} TALL · ${dim(l.totals.measured)} AS MEASURED`],
  ];
  if (spec.footing) {
    legend.push([
      `<line x1="28" y1="${n(ly + 23 + 32)}" x2="72" y2="${n(ly + 23 + 32)}" stroke="#111" stroke-width="1.6" stroke-dasharray="11 7"/>`,
      `${inch(spec.footing.width)} W × ${inch(spec.footing.depth)} D FOOTING UNDER EVERY WALL`,
    ]);
  }
  legend.push([`<rect x="28" y="${n(ly + 14 + legend.length * 32)}" width="44" height="18" fill="url(#ldots)" stroke="#111" stroke-width="1"/>`, 'SLAB · SIZES CLEAR, WALL FACE TO WALL FACE']);
  for (const sl of l.slabs) {
    const rect = sl.face.rect;
    const yd = info.pourYd?.[sl.pour];
    legend.push([
      '',
      `SLAB ${sl.pour}: ${sl.name.toUpperCase()}, ${inch(sl.thick)}${rect ? ` · ${dim(rect.w)} × ${dim(rect.h)} CLEAR` : ''} · ${Math.round(sl.face.clearArea).toLocaleString()} SQ FT${yd ? ` · ${yd} YD` : ''}`,
    ]);
  }
  legend.forEach(([sym, text], i) => {
    out.push(sym);
    out.push(`<text x="86" y="${n(ly + 29 + i * 32)}" ${FONT} font-size="14" font-weight="600" fill="#111">${esc(text)}</text>`);
  });

  // Title block.
  const ty = H - titleH - 6;
  out.push(`<rect x="6" y="${n(ty)}" width="${W - 12}" height="${titleH}" fill="#ffffff" stroke="#111" stroke-width="2"/>`);
  out.push(`<line x1="${n(W * 0.55)}" y1="${n(ty)}" x2="${n(W * 0.55)}" y2="${n(ty + titleH)}" stroke="#111" stroke-width="1.5"/>`);
  out.push(`<text x="22" y="${n(ty + 34)}" ${FONT} font-size="24" font-weight="900" fill="#111">FOUNDATION PLAN</text>`);
  out.push(`<text x="22" y="${n(ty + 58)}" ${FONT} font-size="14" fill="#333">${esc(info.title.toUpperCase())} · NOT TO SCALE</text>`);
  out.push(`<text x="${n(W * 0.55 + 16)}" y="${n(ty + 28)}" ${FONT} font-size="17" font-weight="800" fill="#111">${esc(info.job)}</text>`);
  out.push(`<text x="${n(W * 0.55 + 16)}" y="${n(ty + 50)}" ${FONT} font-size="13" fill="#333">${esc(info.company || '')}</text>`);
  out.push(`<text x="${n(W * 0.55 + 16)}" y="${n(ty + 68)}" ${FONT} font-size="13" fill="#333">${esc(info.date)} · SHEET S1</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Plan view">${out.join('')}</svg>`;
}

// ---------------------------------------------------------------------------------------------
// 3D

const C30 = Math.cos(Math.PI / 6);

/** Clockwise with y down (positive shoelace). */
const clockwise = (pts: Pt[]) => {
  let a = 0;
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  });
  return a >= 0 ? pts : [...pts].reverse();
};

export function graphIsoSvg(l: Layout, highlight: { run?: number; face?: number } = {}): string {
  const spec = l.spec;
  const fd = spec.footing ? spec.footing.depth : 0;
  const walls = l.graph.runs.map((r) => clockwise(wallRect(r)));
  const foots = l.graph.runs.map((r) => footRect(r)).map((f) => (f ? clockwise(f) : null));
  const all = [...walls, ...foots.filter((f): f is Pt[] => !!f)].flat();
  const span = Math.max(Math.max(...all.map((p) => p.x)) - Math.min(...all.map((p) => p.x)), Math.max(...all.map((p) => p.y)) - Math.min(...all.map((p) => p.y)), 1);
  const z = Math.max(1, span / 5 / Math.max(fd + spec.wall.height, 0.5)); // stretch the height so it reads
  const Hf = fd * z;
  const top = Hf + spec.wall.height * z;
  const slabT = l.slabs[0]?.thick ?? 4 / 12;
  const drop = spec.slabDropIn !== undefined ? spec.slabDropIn / 12 : spec.wall.height >= 6 ? spec.wall.height - slabT : 0;
  const slabTop = top - drop * z;
  const proj = (x: number, y: number, h: number) => ({ x: (x - y) * C30, y: (x + y) * 0.5 - h });
  const ps = all.flatMap((p) => [proj(p.x, p.y, 0), proj(p.x, p.y, top)]);
  const minX = Math.min(...ps.map((p) => p.x));
  const maxX = Math.max(...ps.map((p) => p.x));
  const minY = Math.min(...ps.map((p) => p.y));
  const maxY = Math.max(...ps.map((p) => p.y));
  const W = 760;
  const pad = 34;
  const k = Math.min((W - 2 * pad) / (maxX - minX || 1), 440 / (maxY - minY || 1));
  const H = Math.round((maxY - minY) * k + 2 * pad + 20);
  const lx = (W - (maxX - minX) * k) / 2;
  const pt = (x: number, y: number, h: number) => {
    const q = proj(x, y, h);
    return `${n(lx + (q.x - minX) * k)},${n(pad + (q.y - minY) * k)}`;
  };
  const out: string[] = [`<rect width="${W}" height="${H}" fill="#f4f6f8"/>`];
  const edges = (poly: Pt[]) => poly.map((p, j) => ({ p, q: poly[(j + 1) % poly.length] }));
  // Clockwise, y down: the outward normal (dy, −dx) faces the viewer when dy − dx > 0.
  const facing = (e: { p: Pt; q: Pt }) => e.q.y - e.p.y - (e.q.x - e.p.x) > 1e-9;
  const shade = (e: { p: Pt; q: Pt }, light: string, dark: string) => (e.q.y - e.p.y >= -(e.q.x - e.p.x) ? light : dark);
  const depth = (poly: Pt[]) => poly.reduce((sum, p) => sum + p.x + p.y, 0) / poly.length;
  const prism = (poly: Pt[], z0: number, z1: number, topFill: string, light: string, dark: string) => {
    for (const e of edges(poly).filter(facing).sort((a, b) => a.p.x + a.p.y + a.q.x + a.q.y - (b.p.x + b.p.y + b.q.x + b.q.y)))
      out.push(`<polygon points="${pt(e.p.x, e.p.y, z0)} ${pt(e.q.x, e.q.y, z0)} ${pt(e.q.x, e.q.y, z1)} ${pt(e.p.x, e.p.y, z1)}" fill="${shade(e, light, dark)}" stroke="#55514b" stroke-width="0.9" stroke-linejoin="round"/>`);
    out.push(`<polygon points="${poly.map((p) => pt(p.x, p.y, z1)).join(' ')}" fill="${topFill}" stroke="#55514b" stroke-width="0.9"/>`);
  };
  // Footings, then slabs, then walls; each set back to front.
  if (spec.footing) for (const f of foots.filter((x): x is Pt[] => !!x).sort((a, b) => depth(a) - depth(b))) prism(f, 0, Hf, '#cfcac1', '#b9b5ad', '#9a958d');
  for (const sl of l.slabs) {
    const i = l.graph.faces.indexOf(sl.face);
    out.push(`<polygon points="${clockwise(sl.face.clear).map((p) => pt(p.x, p.y, slabTop)).join(' ')}" fill="${highlight.face === i ? '#ffc58a' : '#dedad2'}" stroke="#55514b" stroke-width="0.9"/>`);
  }
  walls
    .map((w, i) => ({ w, i }))
    .sort((a, b) => depth(a.w) - depth(b.w))
    .forEach(({ w, i }) => (highlight.run === i ? prism(w, Hf, top, '#ffb366', '#ff9a40', '#e5822a') : prism(w, Hf, top, '#ece9e3', '#c9c5bd', '#a9a49b')));
  if (z > 1.5) out.push(`<text x="${W - 14}" y="${H - 10}" text-anchor="end" ${FONT} font-size="12" fill="#666">Height stretched to show the footing, walls and slabs</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="3D view">${out.join('')}</svg>`;
}
