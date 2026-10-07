// Engineer-style foundation drawings, once walls, footings and slab are put together:
//   - Foundation plan: black on white like a print. Hatched walls, the footing as dashed (hidden) lines
//     centered under them, the slab inside with its callout, dimension strings with tick marks,
//     a section-cut marker, a legend and a title block.
//   - Typical section: footing with its bars, the wall on it with verticals hooked into the footing,
//     the slab set down from the top of the wall with its steel, grade, sizes and callouts.
//   - 3D: footing, wall and slab together.

import { ftIn } from '../tools/format';
import { barSpots } from './footingDraw';
import { bounds, insetOutline, Pt } from './geometry';
import { addonLayout, Rect } from '../tools/addon';
import { paintOrder } from './layoutPlanDraw';

const n = (v: number) => Math.round(v * 10) / 10;
const esc = (s: string) => s.replace(/&/g, '+').replace(/</g, '‹').replace(/>/g, '›');
const FONT = 'font-family="Helvetica, Arial, sans-serif"';
/** 70' 0" → 70'-0" (how prints write it) */
const dim = (ft: number) => ftIn(ft).replace(/' /, "'-");
const inch = (v: number) => `${n(v)}"`;

export interface FoundationDraw {
  /** House outline (outside of the walls), walked clockwise, ft */
  outline: Pt[];
  wallIn: number;
  wallFt: number;
  /** "#4 VERT. @ 24\" O.C., #4 HORIZ. @ 24\" O.C." or '' */
  wallSteel: string;
  wallVert: { size: number; spacingIn: number } | null;
  wallHoriz: { size: number; spacingIn: number } | null;
  footing: { widthIn: number; depthIn: number; lines: number; barSize: number } | null;
  slab: { thickIn: number; dropIn: number; steel: string; bar: { size: number; spacingIn: number } | null; /** Slab ledge cut in the wall, in */ ledgeIn?: number } | null;
  vaporBarrier: boolean;
  /** Walls that change height: pieces of the outline, each at its height (from corner A clockwise) */
  runs?: { a: Pt; b: Pt; height: number; run: number }[];
  /** Add-ons sharing a wall with the house */
  addOns?: AddOnDraw[];
  title: string;
  job: string;
  company: string;
  date: string;
  kind: string;
}


// ---------------------------------------------------------------------------------------------
// Add-ons: walls built off one side of the house (sharing its wall), with walls inside them.

export interface AddOnDraw {
  /** Side of the outline it joins (from corner A, clockwise) */
  side: number;
  width: number;
  depth: number;
  inside: number;
  inFrom: number;
  wallFt: number;
  footing: { widthIn: number; depthIn: number } | null;
  /** A slab poured on its own in the add-on (in the widest bay) */
  pour: { thickIn: number; label: string; sqFt: number } | null;
}

interface PlacedAddOn {
  a: AddOnDraw;
  /** Local (u along the side, v out from the house) to plan */
  at: (u: number, v: number) => Pt;
  dir: Pt;
  out: Pt;
  walls: Pt[][];
  footings: Pt[][];
  pour: Pt[] | null;
  /** Outside corners of the add-on */
  box: Pt[];
  insideAt: number[];
}

/** Clockwise (y down): positive shoelace. */
const clockwise = (pts: Pt[]) => {
  let a = 0;
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  });
  return a >= 0 ? pts : [...pts].reverse();
};

function placeAddOns(d: FoundationDraw): PlacedAddOn[] {
  const t = d.wallIn / 12;
  const out: PlacedAddOn[] = [];
  for (const a of d.addOns ?? []) {
    const P = d.outline[a.side];
    const Q = d.outline[(a.side + 1) % d.outline.length];
    if (!P || !Q) continue;
    const len = Math.hypot(Q.x - P.x, Q.y - P.y) || 1;
    const dir = { x: (Q.x - P.x) / len, y: (Q.y - P.y) / len };
    const o = { x: dir.y, y: -dir.x }; // outward from a clockwise walk
    const at = (u: number, v: number) => ({ x: P.x + dir.x * u + o.x * v, y: P.y + dir.y * u + o.y * v });
    const rect = (r: Rect) => clockwise([at(r.u0, r.v0), at(r.u1, r.v0), at(r.u1, r.v1), at(r.u0, r.v1)]);
    const lay = (w: number) => addonLayout({ width: a.width, depth: a.depth, t, w, inside: a.inside, inFrom: a.inFrom });
    const wl = lay(t);
    if ('error' in wl) continue;
    const fl = a.footing ? lay(a.footing.widthIn / 12) : null;
    const widest = [...wl.bays].sort((x, y) => y.u1 - y.u0 - (x.u1 - x.u0))[0];
    out.push({
      a,
      at,
      dir,
      out: o,
      walls: wl.pieces.map(rect),
      footings: fl && !('error' in fl) ? fl.pieces.map(rect) : [],
      pour: a.pour && widest ? rect({ u0: widest.u0, v0: 0, u1: widest.u1, v1: a.depth - t }) : null,
      box: [at(0, 0), at(a.width, 0), at(a.width, a.depth), at(0, a.depth)],
      insideAt: wl.insideAt,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Foundation plan

export function foundationPlanSvg(d: FoundationDraw): string {
  const t = d.wallIn / 12;
  const fw = d.footing ? d.footing.widthIn / 12 : 0;
  const outer = d.outline;
  const inner = insetOutline(outer, t);
  const adds = placeAddOns(d);
  const b = bounds([...outer, ...adds.flatMap((x) => x.box)]);
  const W = 760;
  const pad = adds.length ? 120 : 95;
  const legendH = 150;
  const titleH = 76;
  const spanX = Math.max(b.maxX - b.minX, 1);
  const spanY = Math.max(b.maxY - b.minY, 1);
  const s = Math.min((W - 2 * pad) / spanX, 440 / spanY);
  const planH = spanY * s + 2 * pad;
  const H = Math.round(planH + legendH + titleH);
  const ox = (W - spanX * s) / 2;
  const X = (x: number) => n(ox + (x - b.minX) * s);
  const Y = (y: number) => n(pad + (y - b.minY) * s);
  const path = (pts: Pt[]) => `M${pts.map((p) => `${X(p.x)} ${Y(p.y)}`).join(' L')} Z`;
  const out: string[] = [];
  out.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  out.push(
    `<defs><pattern id="hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="9" stroke="#111" stroke-width="1.2"/></pattern>` +
      `<pattern id="dots" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1" fill="#9a9a9a"/><circle cx="9" cy="9" r="1" fill="#9a9a9a"/></pattern></defs>`,
  );
  out.push(`<rect class="dframe" x="6" y="6" width="${W - 12}" height="${H - 12}" fill="none" stroke="#111" stroke-width="2"/>`);

  // Slab inside the walls.
  if (d.slab) out.push(`<path d="${path(inner)}" fill="url(#dots)" stroke="none"/>`);
  // Footing: hidden lines, centered under the wall.
  if (d.footing) {
    const fo = insetOutline(outer, t / 2 - fw / 2);
    const fi = insetOutline(outer, t / 2 + fw / 2);
    for (const ring of [fo, fi]) out.push(`<path d="${path(ring)}" fill="none" stroke="#111" stroke-width="1.6" stroke-dasharray="12 7"/>`);
  }
  // Walls: hatched, heavy outline.
  out.push(`<path d="${path(outer)} ${path([...inner].reverse())}" fill="url(#hatch)" fill-rule="evenodd" stroke="#111" stroke-width="2.6"/>`);

  // Add-ons: the slab poured on its own, footings (hidden lines), then the walls, hatched.
  for (const x of adds) {
    if (x.pour) out.push(`<path d="${path(x.pour)}" fill="url(#dots)" stroke="#111" stroke-width="1" stroke-dasharray="3 4"/>`);
    for (const p of x.footings) out.push(`<path d="${path(p)}" fill="none" stroke="#111" stroke-width="1.6" stroke-dasharray="12 7"/>`);
    for (const p of x.walls) out.push(`<path d="${path(p)}" fill="url(#hatch)" stroke="#111" stroke-width="2.6"/>`);
  }

  // Walls that change height: each run labeled inside the wall line, a heavy tick where it changes.
  if (d.runs?.length) {
    const cxm = (b.minX + b.maxX) / 2;
    const cym = (b.minY + b.maxY) / 2;
    const longest = new Map<number, { a: Pt; b: Pt; height: number }>();
    for (const g of d.runs) {
      const cur = longest.get(g.run);
      if (!cur || Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y) > Math.hypot(cur.b.x - cur.a.x, cur.b.y - cur.a.y)) longest.set(g.run, g);
    }
    for (const g of longest.values()) {
      const mx = (g.a.x + g.b.x) / 2;
      const my = (g.a.y + g.b.y) / 2;
      const len = Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y) || 1;
      let nx = -(g.b.y - g.a.y) / len;
      let ny = (g.b.x - g.a.x) / len;
      if ((cxm - mx) * nx + (cym - my) * ny < 0) {
        nx = -nx;
        ny = -ny;
      }
      const tx = Number(X(mx)) + nx * (t * s + 18);
      const ty = Number(Y(my)) + ny * (t * s + 18);
      const vertical = Math.abs(g.b.x - g.a.x) < Math.abs(g.b.y - g.a.y);
      out.push(
        `<text x="${n(tx)}" y="${n(ty + (vertical ? 0 : 5))}" text-anchor="middle" ${FONT} font-size="14" font-weight="800" fill="#111"${vertical ? ` transform="rotate(-90 ${n(tx)} ${n(ty)})"` : ''}>${esc(`${dim(g.height)} WALL`)}</text>`,
      );
    }
    d.runs.forEach((g, i) => {
      if (i === 0 || d.runs![i - 1].run === g.run) return;
      const len = Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y) || 1;
      const nx = -(g.b.y - g.a.y) / len;
      const ny = (g.b.x - g.a.x) / len;
      out.push(`<line x1="${n(Number(X(g.a.x)) - nx * 10)}" y1="${n(Number(Y(g.a.y)) - ny * 10)}" x2="${n(Number(X(g.a.x)) + nx * (t * s + 10))}" y2="${n(Number(Y(g.a.y)) + ny * (t * s + 10))}" stroke="#111" stroke-width="4"/>`);
    });
  }

  // Dimension strings outside each side: extension lines, dimension line, tick marks, size.
  // The house itself (not its add-ons): dimension strings point away from it, the slab callout sits in it.
  const hb = bounds(outer);
  const cx = (hb.minX + hb.maxX) / 2;
  const cy = (hb.minY + hb.maxY) / 2;
  outer.forEach((p, i) => {
    const q = outer[(i + 1) % outer.length];
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    if (len < 0.5 || adds.some((x) => x.a.side === i)) return;
    let nx = (q.y - p.y) / len;
    let ny = -(q.x - p.x) / len;
    // Point the string away from the middle of the building.
    if ((((p.x + q.x) / 2 - cx) * nx + ((p.y + q.y) / 2 - cy) * ny) < 0) {
      nx = -nx;
      ny = -ny;
    }
    const off = 46 / s;
    const a = { x: p.x + nx * off, y: p.y + ny * off };
    const c = { x: q.x + nx * off, y: q.y + ny * off };
    const ext = (pt: Pt) =>
      `<line x1="${n(Number(X(pt.x)) + nx * 6)}" y1="${n(Number(Y(pt.y)) + ny * 6)}" x2="${n(Number(X(pt.x)) + nx * 54)}" y2="${n(Number(Y(pt.y)) + ny * 54)}" stroke="#111" stroke-width="0.9"/>`;
    out.push(ext(p), ext(q));
    out.push(`<line x1="${X(a.x)}" y1="${Y(a.y)}" x2="${X(c.x)}" y2="${Y(c.y)}" stroke="#111" stroke-width="1"/>`);
    for (const e of [a, c]) out.push(`<line x1="${n(Number(X(e.x)) - 6)}" y1="${n(Number(Y(e.y)) + 6)}" x2="${n(Number(X(e.x)) + 6)}" y2="${n(Number(Y(e.y)) - 6)}" stroke="#111" stroke-width="2"/>`);
    const mx = Number(X((a.x + c.x) / 2)) + nx * 16;
    const my = Number(Y((a.y + c.y) / 2)) + ny * 16;
    const vertical = Math.abs(q.x - p.x) < Math.abs(q.y - p.y);
    out.push(
      `<text x="${n(mx)}" y="${n(my + (vertical ? 0 : 7))}" text-anchor="middle" ${FONT} font-size="20" font-weight="700" fill="#111"${vertical ? ` transform="rotate(-90 ${n(mx)} ${n(my)})"` : ''}>${esc(dim(len))}</text>`,
    );
  });

  // Add-on sizes: how far it comes out (along its first side wall), and the bays along the far wall.
  const dimString = (p: Pt, q: Pt, nx: number, ny: number, offPx: number, label: string) => {
    const a = { x: p.x + (nx * offPx) / s, y: p.y + (ny * offPx) / s };
    const c = { x: q.x + (nx * offPx) / s, y: q.y + (ny * offPx) / s };
    for (const pt of [p, q]) out.push(`<line x1="${n(Number(X(pt.x)) + nx * 6)}" y1="${n(Number(Y(pt.y)) + ny * 6)}" x2="${n(Number(X(pt.x)) + nx * (offPx + 8))}" y2="${n(Number(Y(pt.y)) + ny * (offPx + 8))}" stroke="#111" stroke-width="0.9"/>`);
    out.push(`<line x1="${X(a.x)}" y1="${Y(a.y)}" x2="${X(c.x)}" y2="${Y(c.y)}" stroke="#111" stroke-width="1"/>`);
    for (const e of [a, c]) out.push(`<line x1="${n(Number(X(e.x)) - 6)}" y1="${n(Number(Y(e.y)) + 6)}" x2="${n(Number(X(e.x)) + 6)}" y2="${n(Number(Y(e.y)) - 6)}" stroke="#111" stroke-width="2"/>`);
    const mx = Number(X((a.x + c.x) / 2)) + nx * 14;
    const my = Number(Y((a.y + c.y) / 2)) + ny * 14;
    const vertical = Math.abs(q.x - p.x) < Math.abs(q.y - p.y);
    out.push(`<text x="${n(mx)}" y="${n(my + (vertical ? 0 : 6))}" text-anchor="middle" ${FONT} font-size="17" font-weight="700" fill="#111"${vertical ? ` transform="rotate(-90 ${n(mx)} ${n(my)})"` : ''}>${esc(label)}</text>`);
  };
  for (const x of adds) {
    const { a } = x;
    // Out from the house, beside the first side wall.
    dimString(x.at(0, 0), x.at(0, a.depth), -x.dir.x, -x.dir.y, 40, dim(a.depth));
    // Along the far wall: side to inside wall to inside wall ... to side, then the whole width.
    const marks = [0, ...x.insideAt, a.width];
    for (let i = 1; i < marks.length; i++) dimString(x.at(marks[i - 1], a.depth), x.at(marks[i], a.depth), x.out.x, x.out.y, 34, dim(marks[i] - marks[i - 1]));
    if (marks.length > 2) dimString(x.at(0, a.depth), x.at(a.width, a.depth), x.out.x, x.out.y, 72, dim(a.width));
    if (x.pour && a.pour) {
      const c = x.at(a.width / 2, a.depth / 2);
      const lines = [`${inch(a.pour.thickIn)} SLAB, 2ND POUR`, `${Math.round(a.pour.sqFt).toLocaleString()} SQ FT`, a.pour.label];
      lines.filter(Boolean).forEach((l, i) =>
        out.push(`<text x="${X(c.x)}" y="${n(Number(Y(c.y)) - 14 + i * 21)}" text-anchor="middle" ${FONT} font-size="${i === 0 ? 17 : 14}" font-weight="${i === 0 ? 800 : 600}" fill="#111">${esc(l)}</text>`),
      );
    }
  }

  // Section cut a third of the way along the first wall (across from the add-on, if there is one).
  {
    const si = adds.length ? (adds[0].a.side + 2) % outer.length : 0;
    const p = outer[si];
    const q = outer[(si + 1) % outer.length];
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const ux = (q.x - p.x) / len;
    const uy = (q.y - p.y) / len;
    const m = { x: p.x + ux * len * 0.33, y: p.y + uy * len * 0.33 };
    const inx = -uy; // toward the inside (right of a clockwise walk)
    const iny = ux;
    const from = { x: m.x - inx * (24 / s), y: m.y - iny * (24 / s) };
    const to = { x: m.x + inx * (t + 30 / s), y: m.y + iny * (t + 30 / s) };
    out.push(`<line x1="${X(from.x)}" y1="${Y(from.y)}" x2="${X(to.x)}" y2="${Y(to.y)}" stroke="#111" stroke-width="2.2" stroke-dasharray="16 5 3 5"/>`);
    const tag = { x: Number(X(to.x)) + inx * 20, y: Number(Y(to.y)) + iny * 20 };
    out.push(`<circle cx="${n(tag.x)}" cy="${n(tag.y)}" r="17" fill="#ffffff" stroke="#111" stroke-width="2"/>`);
    out.push(`<line x1="${n(tag.x - 17)}" y1="${n(tag.y)}" x2="${n(tag.x + 17)}" y2="${n(tag.y)}" stroke="#111" stroke-width="1.2"/>`);
    out.push(`<text x="${n(tag.x)}" y="${n(tag.y - 3)}" text-anchor="middle" ${FONT} font-size="14" font-weight="800" fill="#111">1</text>`);
    out.push(`<text x="${n(tag.x)}" y="${n(tag.y + 13)}" text-anchor="middle" ${FONT} font-size="10" font-weight="700" fill="#111">S1</text>`);
  }

  // Slab callout in the middle of the slab.
  if (d.slab) {
    const lines = [`${inch(d.slab.thickIn)} CONCRETE SLAB`, d.slab.steel, d.slab.dropIn > 0 ? `TOP ${inch(d.slab.dropIn)} BELOW TOP OF WALL` : '', d.vaporBarrier ? 'VAPOR BARRIER UNDER' : ''].filter(Boolean);
    const midY = Number(Y(cy)) - ((lines.length - 1) * 24) / 2;
    lines.forEach((l, i) =>
      out.push(`<text x="${X(cx)}" y="${n(midY + i * 24)}" text-anchor="middle" ${FONT} font-size="${i === 0 ? 20 : 17}" font-weight="${i === 0 ? 800 : 600}" fill="#111">${esc(l)}</text>`),
    );
  }

  // Legend.
  const ly = planH + 6;
  out.push(`<line x1="20" y1="${n(ly)}" x2="${W - 20}" y2="${n(ly)}" stroke="#111" stroke-width="1"/>`);
  const legend: [string, string][] = [
    [
      `<rect x="28" y="${n(ly + 14)}" width="44" height="18" fill="url(#hatch)" stroke="#111" stroke-width="1.5"/>`,
      `${inch(d.wallIn)} CONCRETE WALL, ${d.runs?.length ? 'HEIGHT VARIES (SEE PLAN)' : `${dim(d.wallFt)} TALL`}`,
    ],
  ];
  if (d.wallSteel) legend.push(['', `WALL STEEL: ${d.wallSteel}`]);
  if (d.footing) {
    legend.push([
      `<line x1="28" y1="${n(ly + 23 + 34)}" x2="72" y2="${n(ly + 23 + 34)}" stroke="#111" stroke-width="1.6" stroke-dasharray="12 7"/>`,
      `${inch(d.footing.widthIn)} W × ${inch(d.footing.depthIn)} D CONTINUOUS FOOTING${d.footing.lines ? `, (${d.footing.lines}) #${d.footing.barSize} CONT.` : ''}`,
    ]);
  }
  legend.push([
    `<circle cx="50" cy="${n(ly + 23 + legend.length * 34)}" r="11" fill="#fff" stroke="#111" stroke-width="1.6"/><text x="50" y="${n(ly + 28 + legend.length * 34)}" text-anchor="middle" ${FONT} font-size="12" font-weight="800">1</text>`,
    'SEE TYPICAL SECTION 1 / S1',
  ]);
  legend.forEach(([sym, text], i) => {
    out.push(sym);
    out.push(`<text x="86" y="${n(ly + 29 + i * 34)}" ${FONT} font-size="15" font-weight="600" fill="#111">${esc(text)}</text>`);
  });

  // Title block.
  const ty = H - titleH - 6;
  out.push(`<g class="tblock" data-h="${titleH + 6}">`);
  out.push(`<rect x="6" y="${n(ty)}" width="${W - 12}" height="${titleH}" fill="#ffffff" stroke="#111" stroke-width="2"/>`);
  out.push(`<line x1="${W * 0.55}" y1="${n(ty)}" x2="${W * 0.55}" y2="${n(ty + titleH)}" stroke="#111" stroke-width="1.5"/>`);
  out.push(`<text x="22" y="${n(ty + 34)}" ${FONT} font-size="24" font-weight="900" fill="#111">FOUNDATION PLAN</text>`);
  out.push(`<text x="22" y="${n(ty + 58)}" ${FONT} font-size="14" fill="#333">${esc(d.kind.toUpperCase())} · NOT TO SCALE</text>`);
  out.push(`<text x="${n(W * 0.55 + 16)}" y="${n(ty + 28)}" ${FONT} font-size="17" font-weight="800" fill="#111">${esc(d.job)}</text>`);
  out.push(`<text x="${n(W * 0.55 + 16)}" y="${n(ty + 50)}" ${FONT} font-size="13" fill="#333">${esc(d.company || '')}</text>`);
  out.push(`<text x="${n(W * 0.55 + 16)}" y="${n(ty + 68)}" ${FONT} font-size="13" fill="#333">${esc(d.date)} · SHEET S1</text>`);
  out.push('</g>');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Plan view">${out.join('')}</svg>`;
}

// ---------------------------------------------------------------------------------------------
// Typical section

/** Left edge of a footing centered under a wall, inches from the outside face of the wall. */
const fx0Of = (fw: number, t: number) => t / 2 - fw / 2;

export function foundationSectionSvg(d: FoundationDraw): string {
  const W = 760;
  const H = 620;
  const t = d.wallIn;
  const wallH = d.wallFt * 12;
  const fw = d.footing?.widthIn ?? t;
  const fd = d.footing?.depthIn ?? 0;
  const slabRun = 40; // inches of slab shown inside, then a break line
  const totalW = Math.max(fw, t) + slabRun + 12;
  const totalH = fd + wallH + 14;
  const k = Math.min(420 / (totalW + 40), 430 / totalH);
  // x: 0 = outside face of the wall, inside to the right; y: 0 = top of the wall, down positive.
  // Room on the left for the grade line and the height sizes.
  const left = 40 + (40 - Math.min(fx0Of(fw, t), 0)) * k;
  const top = 60;
  const X = (x: number) => n(left + x * k);
  const Y = (y: number) => n(top + y * k);
  const out: string[] = [`<rect width="${W}" height="${H}" fill="#ffffff"/>`];
  out.push(
    `<defs><pattern id="earth" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="14" stroke="#8a7a66" stroke-width="1"/></pattern>` +
      `<pattern id="conc" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="4" cy="5" r="1.1" fill="#888"/><circle cx="12" cy="12" r="0.9" fill="#888"/><path d="M9 3 l2 3 l-3 0z" fill="none" stroke="#999" stroke-width="0.7"/></pattern></defs>`,
  );
  out.push(`<rect x="6" y="6" width="${W - 12}" height="${H - 12}" fill="none" stroke="#111" stroke-width="2"/>`);

  const fx0 = fx0Of(fw, t); // footing centered under the wall
  const fy0 = wallH;
  const slabTop = d.slab ? d.slab.dropIn : 0;
  const slabBot = d.slab ? slabTop + d.slab.thickIn : 0;
  const right = t + slabRun;

  // Earth: outside below grade (8" below the top of the wall), and under the slab inside.
  const grade = 8;
  out.push(`<rect x="${X(fx0 - 30)}" y="${Y(grade)}" width="${n((-fx0 + 30) * k)}" height="${n((wallH + fd - grade + 6) * k)}" fill="url(#earth)"/>`);
  if (d.slab) out.push(`<rect x="${X(t)}" y="${Y(slabBot)}" width="${n(slabRun * k)}" height="${n((wallH + fd - slabBot + 6) * k)}" fill="url(#earth)"/>`);
  out.push(`<line x1="${X(fx0 - 30)}" y1="${Y(grade)}" x2="${X(0)}" y2="${Y(grade)}" stroke="#111" stroke-width="2"/>`);
  out.push(`<text x="${X(fx0 - 28)}" y="${n(Number(Y(grade)) - 8)}" ${FONT} font-size="14" font-weight="700" fill="#111">GRADE</text>`);

  // Concrete: footing, wall, slab.
  const conc = (x: number, y: number, w: number, h: number) =>
    out.push(`<rect x="${X(x)}" y="${Y(y)}" width="${n(w * k)}" height="${n(h * k)}" fill="#e6e3dc" stroke="#111" stroke-width="2.2"/><rect x="${X(x)}" y="${Y(y)}" width="${n(w * k)}" height="${n(h * k)}" fill="url(#conc)"/>`);
  if (d.footing) conc(fx0, fy0, fw, fd);
  // On a ledge the wall's slab side is cut back from the bottom of the slab to the top; the slab runs onto it.
  const ledge = d.slab?.ledgeIn && d.slab.ledgeIn < t ? d.slab.ledgeIn : 0;
  if (ledge) {
    const wallPts: [number, number][] = [[0, 0], [t - ledge, 0], [t - ledge, slabBot], [t, slabBot], [t, wallH], [0, wallH]];
    const pts = wallPts.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ');
    out.push(`<polygon points="${pts}" fill="#e6e3dc" stroke="#111" stroke-width="2.2"/><polygon points="${pts}" fill="url(#conc)"/>`);
  } else conc(0, 0, t, wallH);
  if (d.slab) {
    conc(t - ledge, slabTop, slabRun + ledge, d.slab.thickIn);
    // Break line where the drawing stops.
    const bx = Number(X(right));
    out.push(`<path d="M${bx} ${n(Number(Y(slabTop)) - 10)} L${bx} ${n(Number(Y((slabTop + slabBot) / 2)) - 6)} L${bx + 8} ${Y((slabTop + slabBot) / 2)} L${bx - 8} ${n(Number(Y((slabTop + slabBot) / 2)) + 6)} L${bx} ${n(Number(Y(slabBot)) + 10)}" fill="#fff" stroke="#111" stroke-width="1.6"/>`);
    if (d.vaporBarrier) out.push(`<line x1="${X(t)}" y1="${n(Number(Y(slabBot)) + 3)}" x2="${X(right)}" y2="${n(Number(Y(slabBot)) + 3)}" stroke="#111" stroke-width="1.5" stroke-dasharray="6 4"/>`);
  }

  // Steel.
  const red = '#b5371a';
  const dot = (x: number, y: number, size: number) => out.push(`<circle cx="${X(x)}" cy="${Y(y)}" r="${n(Math.max(4.5, (size / 8) * k * 0.55))}" fill="${red}"/>`);
  if (d.footing && d.footing.lines) for (const sp of barSpots(fw, fd, d.footing.lines)) dot(fx0 + sp.x, fy0 + sp.y, d.footing.barSize);
  if (d.wallVert) {
    const vx = t / 2;
    const hook = d.footing ? Math.min(12, fw / 2 - 3) : 0;
    const bottom = d.footing ? fy0 + fd - 3 : wallH - 3;
    out.push(
      `<path d="M${X(vx)} ${Y(3)} L${X(vx)} ${Y(bottom)}${hook > 0 ? ` L${X(vx + hook)} ${Y(bottom)}` : ''}" fill="none" stroke="${red}" stroke-width="${n(Math.max(3, (d.wallVert.size / 8) * k * 0.9))}" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
  }
  if (d.wallHoriz) {
    const count = Math.max(2, Math.ceil((wallH - 6) / d.wallHoriz.spacingIn - 1e-9) + 1);
    for (let i = 0; i < count; i++) dot(t / 2 - 1.2, 3 + ((wallH - 6) * i) / (count - 1), d.wallHoriz.size);
  }
  if (d.slab?.bar) {
    const ym = (slabTop + slabBot) / 2;
    out.push(`<line x1="${X(t + 3)}" y1="${Y(ym)}" x2="${X(right - 2)}" y2="${Y(ym)}" stroke="${red}" stroke-width="3"/>`);
    for (let x = t + 3; x < right - 2; x += d.slab.bar.spacingIn) dot(x, ym - 0.8, d.slab.bar.size);
  }

  // Sizes.
  const dimV = (x: number, y1: number, y2: number, label: string, side: 'L' | 'R') => {
    out.push(`<line x1="${X(x)}" y1="${Y(y1)}" x2="${X(x)}" y2="${Y(y2)}" stroke="#111" stroke-width="1"/>`);
    for (const y of [y1, y2]) out.push(`<line x1="${n(Number(X(x)) - 6)}" y1="${n(Number(Y(y)) + 6)}" x2="${n(Number(X(x)) + 6)}" y2="${n(Number(Y(y)) - 6)}" stroke="#111" stroke-width="2"/>`);
    out.push(`<text x="${n(Number(X(x)) + (side === 'L' ? -8 : 8))}" y="${n((Number(Y(y1)) + Number(Y(y2))) / 2 + 6)}" text-anchor="${side === 'L' ? 'end' : 'start'}" ${FONT} font-size="17" font-weight="700" fill="#111">${esc(label)}</text>`);
  };
  const dimH = (y: number, x1: number, x2: number, label: string) => {
    out.push(`<line x1="${X(x1)}" y1="${Y(y)}" x2="${X(x2)}" y2="${Y(y)}" stroke="#111" stroke-width="1"/>`);
    for (const x of [x1, x2]) out.push(`<line x1="${n(Number(X(x)) - 6)}" y1="${n(Number(Y(y)) + 6)}" x2="${n(Number(X(x)) + 6)}" y2="${n(Number(Y(y)) - 6)}" stroke="#111" stroke-width="2"/>`);
    out.push(`<text x="${n((Number(X(x1)) + Number(X(x2))) / 2)}" y="${n(Number(Y(y)) + (y > wallH ? 24 : -10))}" text-anchor="middle" ${FONT} font-size="17" font-weight="700" fill="#111">${esc(label)}</text>`);
  };
  dimH(-6, 0, t, inch(t));
  dimV(fx0 - 36, 0, wallH, dim(d.wallFt), 'L');
  if (d.footing) {
    dimH(fy0 + fd + 8, fx0, fx0 + fw, inch(fw));
    dimV(fx0 - 36, fy0, fy0 + fd, inch(fd), 'L');
  }
  if (d.slab && d.slab.dropIn > 0) dimV(right + 14, 0, slabTop, inch(d.slab.dropIn), 'R');
  if (d.slab) dimV(right + 14, slabTop, slabBot, inch(d.slab.thickIn), 'R');
  if (ledge && d.slab) {
    const y = slabBot + 4;
    out.push(`<line x1="${X(t - ledge)}" y1="${Y(slabBot)}" x2="${X(t - ledge)}" y2="${Y(y + 2)}" stroke="#111" stroke-width="0.8"/>`);
    out.push(`<line x1="${X(t - ledge)}" y1="${Y(y)}" x2="${X(t + 6)}" y2="${Y(y)}" stroke="#111" stroke-width="1"/>`);
    for (const x of [t - ledge, t]) out.push(`<line x1="${n(Number(X(x)) - 5)}" y1="${n(Number(Y(y)) + 5)}" x2="${n(Number(X(x)) + 5)}" y2="${n(Number(Y(y)) - 5)}" stroke="#111" stroke-width="2"/>`);
    out.push(`<text x="${n(Number(X(t + 6)) + 4)}" y="${n(Number(Y(y)) + 5)}" ${FONT} font-size="15" font-weight="700" fill="#111">${esc(inch(ledge))}</text>`);
  }
  if (d.slab && d.slab.dropIn > 0) out.push(`<line x1="${X(t)}" y1="${Y(0)}" x2="${X(right + 18)}" y2="${Y(0)}" stroke="#111" stroke-width="0.8" stroke-dasharray="4 4"/>`);

  // Callouts with leaders, stacked on the right.
  const notes: { at: Pt; text: string[] }[] = [];
  if (d.slab) notes.push({ at: { x: t + slabRun * 0.6, y: slabTop + 1 }, text: [`${inch(d.slab.thickIn)} CONCRETE SLAB`, d.slab.steel, d.slab.dropIn > 0 ? `TOP ${inch(d.slab.dropIn)} BELOW TOP OF WALL` : 'TOP FLUSH WITH TOP OF WALL'].filter(Boolean) });
  if (ledge && d.slab) notes.push({ at: { x: t - ledge / 2, y: slabBot - 0.5 }, text: [`${inch(ledge)} SLAB LEDGE`, `WALL ${inch(t - ledge)} ABOVE SLAB BOTTOM`] });
  notes.push({ at: { x: t * 0.7, y: wallH * 0.4 }, text: [`${inch(t)} CONCRETE WALL`, ...d.wallSteel.split(', ')].filter(Boolean) });
  if (d.footing) notes.push({ at: { x: fx0 + fw * 0.8, y: fy0 + fd * 0.5 }, text: [`${inch(fw)} × ${inch(fd)} CONT. FOOTING`, d.footing.lines ? `(${d.footing.lines}) #${d.footing.barSize} CONTINUOUS` : ''].filter(Boolean) });
  const nx = W - 236;
  notes.forEach((note, i) => {
    const ny = 190 + i * 115;
    out.push(`<polyline points="${X(note.at.x)},${Y(note.at.y)} ${nx - 14},${ny - 6} ${nx - 4},${ny - 6}" fill="none" stroke="#111" stroke-width="1.2"/>`);
    out.push(`<circle cx="${X(note.at.x)}" cy="${Y(note.at.y)}" r="3" fill="#111"/>`);
    note.text.forEach((l, j) => out.push(`<text x="${nx}" y="${n(ny + j * 20)}" ${FONT} font-size="${j === 0 ? 15 : 13}" font-weight="${j === 0 ? 800 : 500}" fill="#111">${esc(l)}</text>`));
  });

  out.push(`<line x1="20" y1="${H - 62}" x2="${W - 20}" y2="${H - 62}" stroke="#111" stroke-width="1.5"/>`);
  out.push(`<circle cx="44" cy="${H - 34}" r="18" fill="#fff" stroke="#111" stroke-width="2"/><line x1="26" y1="${H - 34}" x2="62" y2="${H - 34}" stroke="#111" stroke-width="1.2"/>`);
  out.push(`<text x="44" y="${H - 38}" text-anchor="middle" ${FONT} font-size="14" font-weight="800">1</text><text x="44" y="${H - 22}" text-anchor="middle" ${FONT} font-size="10" font-weight="700">S1</text>`);
  out.push(`<text x="74" y="${H - 28}" ${FONT} font-size="22" font-weight="900" fill="#111">TYPICAL SECTION</text>`);
  if (d.runs?.length) out.push(`<text x="74" y="${H - 10}" ${FONT} font-size="12" font-weight="700" fill="#333">TALLEST WALL SHOWN. HEIGHT VARIES, SEE PLAN.</text>`);
  out.push(`<text x="${W - 22}" y="${H - 28}" text-anchor="end" ${FONT} font-size="13" fill="#333">NOT TO SCALE · ${esc(d.job)}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Edge detail">${out.join('')}</svg>`;
}

// ---------------------------------------------------------------------------------------------
// 3D

const C30 = Math.cos(Math.PI / 6);

export function foundationIsoSvg(d: FoundationDraw): string {
  const t = d.wallIn / 12;
  const fw = d.footing ? d.footing.widthIn / 12 : 0;
  const fd = d.footing ? d.footing.depthIn / 12 : 0;
  const outer = d.outline;
  const inner = insetOutline(outer, t);
  const xs = outer.map((p) => p.x);
  const ys = outer.map((p) => p.y);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
  const realH = fd + d.wallFt;
  const z = Math.max(1, span / 5 / Math.max(realH, 0.5)); // stretch the height so it reads
  const Hf = fd * z;
  const Hw = d.wallFt * z;
  const top = Hf + Hw;
  const slabTop = d.slab ? top - (d.slab.dropIn / 12) * z : 0;
  const proj = (x: number, y: number, h: number) => ({ x: (x - y) * C30, y: (x + y) * 0.5 - h });
  const fo = d.footing ? insetOutline(outer, t / 2 - fw / 2) : outer;
  const fi = d.footing ? insetOutline(outer, t / 2 + fw / 2) : inner;
  const adds = placeAddOns(d);
  const all = [...fo, ...adds.flatMap((x) => x.box)].flatMap((p) => [proj(p.x, p.y, 0), proj(p.x, p.y, top)]);
  const minX = Math.min(...all.map((p) => p.x));
  const maxX = Math.max(...all.map((p) => p.x));
  const minY = Math.min(...all.map((p) => p.y));
  const maxY = Math.max(...all.map((p) => p.y));
  const W = 760;
  const pad = 34;
  const k = Math.min((W - 2 * pad) / (maxX - minX || 1), 420 / (maxY - minY || 1));
  const H = Math.round((maxY - minY) * k + 2 * pad + 20);
  const lx = (W - (maxX - minX) * k) / 2;
  const pt = (x: number, y: number, h: number) => {
    const q = proj(x, y, h);
    return `${n(lx + (q.x - minX) * k)},${n(pad + (q.y - minY) * k)}`;
  };
  const out: string[] = [`<rect width="${W}" height="${H}" fill="#f4f6f8"/>`];
  const face = (p: Pt, q: Pt, z0: number, z1: number, fill: string) =>
    `<polygon points="${pt(p.x, p.y, z0)} ${pt(q.x, q.y, z0)} ${pt(q.x, q.y, z1)} ${pt(p.x, p.y, z1)}" fill="${fill}" stroke="#55514b" stroke-width="0.9" stroke-linejoin="round"/>`;
  const ring = (o: Pt[], i: Pt[], h: number, fill: string) =>
    `<path d="M${o.map((p) => pt(p.x, p.y, h)).join(' L')} Z M${[...i].reverse().map((p) => pt(p.x, p.y, h)).join(' L')} Z" fill="${fill}" fill-rule="evenodd" stroke="#55514b" stroke-width="0.9"/>`;
  const edges = (ps: Pt[]) => ps.map((p, j) => ({ p, q: ps[(j + 1) % ps.length] }));
  const depth = (e: { p: Pt; q: Pt }) => e.p.x + e.p.y + e.q.x + e.q.y;
  // Outline walked clockwise (y down): outward normal (dy, −dx) faces the viewer when dy − dx > 0.
  const facing = (e: { p: Pt; q: Pt }) => e.q.y - e.p.y - (e.q.x - e.p.x) > 1e-9;
  const shade = (e: { p: Pt; q: Pt }, light: string, dark: string) => (e.q.y - e.p.y >= -(e.q.x - e.p.x) ? light : dark);

  // Add-ons: footings, the slab poured on its own, then the walls, nearest last. Drawn before the house
  // when they're behind it, after it when they're in front.
  const prism = (poly: Pt[], z0: number, z1: number, topFill: string, light: string, dark: string) => {
    for (const e of edges(poly).filter(facing).sort((a, b) => depth(a) - depth(b))) out.push(face(e.p, e.q, z0, z1, shade(e, light, dark)));
    out.push(`<polygon points="${poly.map((p) => pt(p.x, p.y, z1)).join(' ')}" fill="${topFill}" stroke="#55514b" stroke-width="0.9"/>`);
  };
  const mid = (ps: Pt[]) => ps.reduce((sum, p) => sum + p.x + p.y, 0) / ps.length;
  const drawAdd = (x: PlacedAddOn) => {
    const hf = x.a.footing ? (x.a.footing.depthIn / 12) * z : Hf;
    for (const p of paintOrder(x.footings).map((k) => x.footings[k])) prism(p, Hf - hf, Hf, '#cfcac1', '#b9b5ad', '#9a958d');
    if (x.pour && x.a.pour) out.push(`<polygon points="${x.pour.map((p) => pt(p.x, p.y, Hf + x.a.wallFt * z - ((d.slab?.dropIn ?? 0) / 12) * z)).join(' ')}" fill="#dedad2" stroke="#55514b" stroke-width="0.9"/>`);
    for (const p of paintOrder(x.walls).map((k) => x.walls[k])) prism(p, Hf, Hf + x.a.wallFt * z, '#ece9e3', '#c9c5bd', '#a9a49b');
  };
  const house = mid(outer);
  for (const x of adds) if (mid(x.box) < house) drawAdd(x);

  // 1. Footing: outside faces toward the viewer, then its top.
  if (d.footing) {
    for (const e of edges(fo).filter(facing).sort((a, b) => depth(a) - depth(b))) out.push(face(e.p, e.q, 0, Hf, shade(e, '#b9b5ad', '#9a958d')));
    out.push(ring(fo, fi, Hf, '#cfcac1'));
  }
  // 2. The far walls' inside faces (seen across the building), above the slab.
  for (const e of d.runs?.length ? [] : edges(inner).filter((e) => !facing(e) && e.q.x - e.p.x - (e.q.y - e.p.y) > 1e-9).sort((a, b) => depth(a) - depth(b))) {
    out.push(face(e.p, e.q, Hf, top, '#bdb8af'));
  }
  // 3. The slab inside, set down from the top of the wall.
  if (d.slab && !d.runs?.length) out.push(`<polygon points="${inner.map((p) => pt(p.x, p.y, slabTop)).join(' ')}" fill="#dedad2" stroke="#55514b" stroke-width="0.9"/>`);
  // 4. Top of the walls, then their outside faces toward the viewer.
  if (d.runs?.length) {
    // Walls that change height: each piece at its own height, with the step where it changes.
    const innerAt = (p: Pt, nx: number, ny: number) => {
      const v = outer.findIndex((o) => Math.hypot(o.x - p.x, o.y - p.y) < 1e-6);
      return v >= 0 ? inner[v] : { x: p.x + nx * t, y: p.y + ny * t };
    };
    const pieces = d.runs.map((g) => {
      const len = Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y) || 1;
      const nx = -(g.b.y - g.a.y) / len;
      const ny = (g.b.x - g.a.x) / len;
      return { ...g, ai: innerAt(g.a, nx, ny), bi: innerAt(g.b, nx, ny), h: Hf + g.height * z };
    });
    const d2 = (p: { a: Pt; b: Pt }) => p.a.x + p.a.y + p.b.x + p.b.y;
    for (const p of [...pieces].sort((u, v) => d2(u) - d2(v))) {
      const e = { p: p.ai, q: p.bi };
      if (e.q.x - e.p.x - (e.q.y - e.p.y) > 1e-9) out.push(face(p.ai, p.bi, Hf, p.h, '#bdb8af'));
    }
    if (d.slab) out.push(`<polygon points="${inner.map((p) => pt(p.x, p.y, Math.min(slabTop, Hf + Math.min(...pieces.map((q) => q.h - Hf)) - 0.01))).join(' ')}" fill="#dedad2" stroke="#55514b" stroke-width="0.9"/>`);
    for (const p of [...pieces].sort((u, v) => d2(u) - d2(v))) {
      out.push(`<polygon points="${pt(p.a.x, p.a.y, p.h)} ${pt(p.b.x, p.b.y, p.h)} ${pt(p.bi.x, p.bi.y, p.h)} ${pt(p.ai.x, p.ai.y, p.h)}" fill="#ece9e3" stroke="#55514b" stroke-width="0.9"/>`);
      if (facing({ p: p.a, q: p.b })) out.push(face(p.a, p.b, Hf, p.h, shade({ p: p.a, q: p.b }, '#c9c5bd', '#a9a49b')));
    }
    // The step where the height changes: the end of the taller piece.
    pieces.forEach((p, i) => {
      const prev = pieces[(i + pieces.length - 1) % pieces.length];
      if (prev.run === p.run || prev.h === p.h) return;
      const lo = Math.min(prev.h, p.h);
      const hi = Math.max(prev.h, p.h);
      out.push(`<polygon points="${pt(p.a.x, p.a.y, lo)} ${pt(p.ai.x, p.ai.y, lo)} ${pt(p.ai.x, p.ai.y, hi)} ${pt(p.a.x, p.a.y, hi)}" fill="#b3aea5" stroke="#55514b" stroke-width="0.9"/>`);
    });
  } else {
    out.push(ring(outer, inner, top, '#ece9e3'));
    for (const e of edges(outer).filter(facing).sort((a, b) => depth(a) - depth(b))) out.push(face(e.p, e.q, Hf, top, shade(e, '#c9c5bd', '#a9a49b')));
  }
  for (const x of adds) if (mid(x.box) >= house) drawAdd(x);
  if (z > 1.5) out.push(`<text x="${W - 14}" y="${H - 10}" text-anchor="end" ${FONT} font-size="12" fill="#666">Height stretched to show the footing, wall and slab</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="3D view">${out.join('')}</svg>`;
}
