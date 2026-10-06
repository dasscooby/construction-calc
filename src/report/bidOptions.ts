// What a bid or bill line can be, found in the job: each piece (slab, walls, footings, piers ...),
// its rebar, the concrete, a pump, labor, or something else. Each has the ways it can be measured
// (walls around the outside or along the middle, slab at the house size or inside the walls,
// concrete ordered or delivered ...). You pick; nothing is filled in on its own.

import type { Job, PriceLine } from '../lib/jobs';
import type { Settings } from '../lib/settings';
import { dec } from '../tools/format';
import { parseLength, parseNumber, RawLength, RawWallRow } from '../tools/run';
import { deliveredYd } from './billing';
import { confirmedFoundation, Foundation, pourCount, pourName } from './foundation';
import { builtItems, FiguredItem, itemRebarLb, jobTotals, numberIn, pieceName, steelItems } from './report';

export interface BidMeasure {
  id: string;
  label: string;
  qty: number;
  unit: string;
}

export interface BidSource {
  src: string;
  /** The wording it starts with on the bid */
  what: string;
  /** Heading in the list */
  group: string;
  measures: BidMeasure[];
  /** Price book price, by unit */
  prices: Record<string, string>;
}

/** "footings, walls, slab, second pour" */
const pourList = (f: Foundation) =>
  [f.footings.length || f.footingBars.length || f.addOns.some((a) => a.kind === 'footing') ? 'footings' : '', 'walls', f.slab ? 'slab' : '', ...f.pours.map((_, i) => pourName(i))]
    .filter(Boolean)
    .join(', ');

/** "footings, walls, slab 1, slab 2" from a layout's pieces */
const layoutPourList = (items: FiguredItem[]) =>
  items
    .filter((x) => /:(footings|walls|slab\d+)$/.test(x.item.id))
    .map((x) => (x.item.id.endsWith(':footings') ? 'footings' : x.item.id.endsWith(':walls') ? 'walls' : `slab ${x.item.id.match(/slab(\d+)$/)![1]}`))
    .join(', ');

export const UNITS = ['sq ft', 'ft', 'yd', 'lb', 'tons', 'ea', 'set', 'job', 'pour', 'hr', 'day', 'lump sum'];

const num = (v: string | undefined) => {
  const n = parseNumber((v ?? '').replace(/[$,%\s]/g, ''));
  return n !== null && Number.isFinite(n) ? n : 0;
};
const price = (v: string | undefined) => (v && num(v) ? dec(num(v), 2) : '');

export function bidOptions(items: FiguredItem[], s: Settings, job?: Job): BidSource[] {
  const out: BidSource[] = [];
  const p = s.prices;
  const fnd = confirmedFoundation(items, job);
  const built = builtItems(items, job).items;
  const rowOf = (f: FiguredItem, label: string) => (f.result.status === 'ok' ? f.result.result.rows.find((r) => r.label === label) : undefined);
  const val = (f: FiguredItem, label: string) => {
    const r = rowOf(f, label);
    return r ? numberIn(r.value) : 0;
  };
  const ft = (v: unknown) => parseLength(v as RawLength) ?? 0;

  for (const f0 of items) {
    if (f0.result.status !== 'ok' || f0.item.id.endsWith(':forms')) continue;
    const f = built.find((b) => b.item.id === f0.item.id) ?? f0;
    const name = pieceName(f0, items, job);
    const src = `item:${f.item.id}`;
    const raw = f.item.raw;
    const concrete = val(f, 'Order');
    const conc: BidMeasure[] = concrete ? [{ id: 'concrete', label: `Concrete in it (${dec(concrete, 2)} yd ordered)`, qty: concrete, unit: 'yd' }] : [];
    const tool = f.tool.id;
    const area = rowOf(f0, 'Slab area');
    if (area) {
      const ms: BidMeasure[] = [];
      const outside = rowOf(f0, 'To the outside of the walls');
      if (outside) {
        // A slab in a foundation layout: bid at the size to the outside of its walls, or what's poured.
        ms.push({ id: 'house', label: `To the outside of the walls (${Math.round(numberIn(outside.value)).toLocaleString()} sq ft)`, qty: numberIn(outside.value), unit: 'sq ft' });
        ms.push({ id: 'inside', label: `Inside the walls, what's poured (${Math.round(numberIn(area.value)).toLocaleString()} sq ft)`, qty: numberIn(area.value), unit: 'sq ft' });
      } else if (fnd?.slab?.item.id === f.item.id && fnd.slabAtOutside) {
        ms.push({ id: 'house', label: `At the house size (${Math.round(fnd.outsideArea).toLocaleString()} sq ft)`, qty: fnd.outsideArea, unit: 'sq ft' });
        ms.push({ id: 'inside', label: `Inside the walls (${Math.round(fnd.insideArea).toLocaleString()} sq ft)`, qty: fnd.insideArea, unit: 'sq ft' });
      } else {
        ms.push({ id: 'area', label: `Area (${Math.round(numberIn(area.value)).toLocaleString()} sq ft)`, qty: numberIn(area.value), unit: 'sq ft' });
      }
      out.push({ src, what: `${name}: pour and finish`, group: 'Slabs', measures: [...ms, ...conc], prices: { 'sq ft': price(p.slabSqFt) } });
    } else if (tool === 'wall-forms' || (tool === 'footings' && raw.kind === 'wall')) {
      const around =
        tool === 'wall-forms'
          ? ((raw.walls as RawWallRow[]) ?? []).reduce((a, w) => a + ft(w.length), 0)
          : val(f0, 'House, around the outside') || val(f0, 'As measured') || ft(raw.length) * (Number(raw.qty) || 1);
      const t = tool === 'wall-forms' ? (num(String(raw.thick)) || 8) / 12 : ft(raw.width);
      const middle = (tool === 'footings' && val(f0, 'Along the middle')) || Math.max(0, around - 4 * t);
      const h = fnd?.walls.some((w) => w.item.id === f.item.id) && fnd.runs ? fnd.runs.reduce((s2, r) => s2 + r.length * r.height, 0) / Math.max(1, around) : tool === 'wall-forms' ? ft(raw.height1) + ft(raw.height2) : ft(raw.depth);
      const concreteYd = tool === 'wall-forms' ? val(f, 'Concrete in the wall') : concrete;
      out.push({
        src,
        what: `${name}: form and pour`,
        group: 'Walls',
        measures: [
          { id: 'around', label: `${raw.shape === 'addon' ? 'As measured' : 'Around the outside'} (${dec(around, 1)} ft)`, qty: around, unit: 'ft' },
          { id: 'middle', label: `Along the middle (${dec(middle, 1)} ft)`, qty: middle, unit: 'ft' },
          { id: 'face', label: `Wall face, both sides (${Math.round(around * h * 2).toLocaleString()} sq ft)`, qty: around * h * 2, unit: 'sq ft' },
          ...(concreteYd ? [{ id: 'concrete', label: `Concrete in it (${dec(concreteYd, 2)} yd)`, qty: concreteYd, unit: 'yd' }] : []),
        ],
        prices: { ft: price(p.wallFt) },
      });
    } else if (tool === 'footings') {
      const run = val(f0, 'Along the middle') || ft(raw.length) * (Number(raw.qty) || 1);
      out.push({ src, what: `${name}: dig, form and pour`, group: 'Footings', measures: [{ id: 'run', label: `Run (${dec(run, 1)} ft)`, qty: run, unit: 'ft' }, ...conc], prices: { ft: price(p.footingFt) } });
    } else if (tool === 'piers') {
      const n = Number(raw.qty) || 1;
      out.push({ src, what: `${name}: drill and pour`, group: 'Piers and steps', measures: [{ id: 'count', label: `How many (${n})`, qty: n, unit: 'ea' }, ...conc], prices: { ea: price(p.pierEa) } });
    } else if (tool === 'steps') {
      out.push({ src, what: `${name}: form and pour steps`, group: 'Piers and steps', measures: [{ id: 'set', label: 'One set', qty: 1, unit: 'set' }, ...conc], prices: { set: price(p.stepsSet) } });
    } else if (tool === 'excavation') {
      out.push({
        src,
        what: `${name}: dig and haul`,
        group: 'Site work',
        measures: [
          { id: 'bank', label: `In the ground (${dec(val(f, 'In the ground'), 2)} yd)`, qty: val(f, 'In the ground'), unit: 'yd' },
          { id: 'loose', label: `Loose, to haul (${dec(val(f, 'Loose (to haul)'), 2)} yd)`, qty: val(f, 'Loose (to haul)'), unit: 'yd' },
        ],
        prices: { yd: price(p.excavYd) },
      });
    } else if (tool === 'fill-base') {
      out.push({
        src,
        what: `${name}: placed and compacted`,
        group: 'Site work',
        measures: [
          { id: 'tons', label: `Tons (${dec(val(f, 'Tons'), 1)})`, qty: val(f, 'Tons'), unit: 'tons' },
          { id: 'yd', label: `Yards loose (${dec(val(f, 'Order (loose)'), 2)})`, qty: val(f, 'Order (loose)'), unit: 'yd' },
        ],
        prices: { tons: price(p.baseTon) },
      });
    } else if (tool === 'vapor-barrier') {
      out.push({
        src,
        what: 'Vapor barrier',
        group: 'Site work',
        measures: [
          { id: 'area', label: `Area (${Math.round(val(f, 'Area')).toLocaleString()} sq ft)`, qty: val(f, 'Area'), unit: 'sq ft' },
          { id: 'rolls', label: `Rolls (${val(f, 'Rolls')})`, qty: val(f, 'Rolls'), unit: 'ea' },
        ],
        prices: { 'sq ft': price(p.barrierSqFt) },
      });
    } else if (tool === 'dowels') {
      out.push({ src, what: `${name}: drilled and set`, group: 'Rebar and dowels', measures: [{ id: 'count', label: `How many (${val(f, 'Total')})`, qty: val(f, 'Total'), unit: 'ea' }], prices: { ea: price(p.dowelEa) } });
    }
    const dowels = rowOf(f, 'Dowels');
    if (dowels) {
      out.push({ src: `${src}:dowels`, what: `${name}: dowels drilled and epoxied`, group: 'Rebar and dowels', measures: [{ id: 'count', label: `How many (${numberIn(dowels.value)})`, qty: numberIn(dowels.value), unit: 'ea' }], prices: { ea: price(p.dowelEa) } });
    }
  }

  for (const f of steelItems(built)) {
    const lb = itemRebarLb(f);
    if (!lb) continue;
    const sticks = f.result.status === 'ok' ? f.result.result.rows.filter((r) => /^#\d+ sticks$|^Sticks to order$/.test(r.label)).reduce((a, r) => a + numberIn(r.value), 0) : 0;
    out.push({
      src: `item:${f.item.id}:rebar`,
      what: `${pieceName(f, items, job)}: rebar, cut, bent and tied`,
      group: 'Rebar and dowels',
      measures: [
        { id: 'lb', label: `Weight (${Math.round(lb).toLocaleString()} lb)`, qty: Math.round(lb), unit: 'lb' },
        { id: 'tons', label: `Tons (${dec(lb / 2000, 2)})`, qty: lb / 2000, unit: 'tons' },
        ...(sticks ? [{ id: 'sticks', label: `Sticks (${sticks})`, qty: sticks, unit: 'ea' }] : []),
      ],
      prices: { lb: price(p.rebarLb) },
    });
  }

  const t = jobTotals(items, job);
  const delivered = deliveredYd(job);
  const perYd = price(s.defaults.price) || (t.concreteCost && t.concreteOrderYd ? dec(t.concreteCost / t.concreteOrderYd, 2) : '');
  if (t.concreteOrderYd || delivered !== null) {
    out.push({
      src: 'concrete',
      what: 'Concrete',
      group: 'Concrete and pump',
      measures: [
        ...(t.concreteOrderYd ? [{ id: 'ordered', label: `Ordered (${dec(t.concreteOrderYd, 2)} yd)`, qty: t.concreteOrderYd, unit: 'yd' }] : []),
        ...(delivered !== null ? [{ id: 'delivered', label: `Delivered (${dec(delivered, 2)} yd)`, qty: delivered, unit: 'yd' }] : []),
      ],
      prices: { yd: perYd },
    });
  }
  // A foundation layout knows its pours: footings, walls, each slab pour.
  const layoutPours = items.filter((x) => /:(footings|walls|slab\d+)$/.test(x.item.id)).length;
  const pours = layoutPours || (fnd ? pourCount(fnd) : 1);
  if (layoutPours > 1) {
    layoutPourList(items)
      .split(', ')
      .forEach((name, i) =>
        out.push({
          src: `pump:${i + 1}`,
          what: `Pump truck: pour ${i + 1}, ${name}`,
          group: 'Concrete and pump',
          measures: [{ id: 'pour', label: 'One pour', qty: 1, unit: 'pour' }],
          prices: { pour: price(p.pumpPour) },
        }),
      );
  }
  out.push({
    src: 'pump',
    what: 'Pump truck',
    group: 'Concrete and pump',
    measures: [
      { id: 'pour', label: 'One pour', qty: 1, unit: 'pour' },
      ...(pours > 1 ? [{ id: 'pours', label: `Each pour (${pours}${layoutPours ? `: ${layoutPourList(items)}` : fnd ? `: ${pourList(fnd)}` : ''})`, qty: pours, unit: 'pour' }] : []),
    ],
    prices: { pour: price(p.pumpPour) },
  });
  out.push({
    src: 'labor',
    what: 'Labor',
    group: 'Labor and other',
    measures: [
      { id: 'job', label: 'The whole job', qty: 1, unit: 'job' },
      { id: 'hr', label: 'By the hour', qty: 0, unit: 'hr' },
      { id: 'day', label: 'By the day', qty: 0, unit: 'day' },
    ],
    prices: { job: price(p.laborJob) },
  });
  out.push({ src: 'other', what: '', group: 'Labor and other', measures: [], prices: {} });
  return out;
}

/**
 * A line for every part of the job that isn't on the bid yet (what you tap "+ Add every part of the job"
 * for): each measured the usual way, a pump for each pour, labor and "something else" left out.
 */
export function missingLines(sources: BidSource[], lines: { src?: string }[]): Omit<PriceLine, 'id'>[] {
  const have = new Set(lines.map((l) => l.src).filter(Boolean));
  return sources
    // With a pump line for each pour, the one-line "Pump truck" isn't offered too.
    .filter((s) => s.src !== 'other' && s.src !== 'labor' && !have.has(s.src) && s.measures.length)
    .filter((s) => !(s.src === 'pump' && sources.some((x) => x.src.startsWith('pump:'))) && !(s.src.startsWith('pump:') && have.has('pump')))
    .map((s) => lineFor(s));
}

const SLAB_SIZE: Record<string, string> = { house: 'house size, to the outside of the walls', inside: 'poured, inside the walls', concrete: 'concrete' };

/**
 * Lines made before the foundation layout took over a piece (the old wall, footing or slab is hidden, so
 * its line would bill with yesterday's name and numbers) move to the layout's piece: same price, the
 * layout's wording and today's quantity.
 */
export function remapLines(lines: PriceLine[], job: Job, sources: BidSource[]): PriceLine[] {
  const layout = job.items.find((it) => it.toolId === 'foundation-layout');
  if (!layout) return lines;
  const have = new Set(sources.map((s) => s.src));
  return lines.map((l) => {
    const m = l.src?.match(/^item:([^:]+)(:rebar|:dowels)?$/);
    if (!m || have.has(l.src!)) return l;
    const old = job.items.find((it) => it.id === m[1]);
    if (!old || old.replacedBy !== layout.id) return l;
    const kind = old.toolId === 'slab' || old.toolId === 'slab-layout' ? 'slab1' : old.toolId === 'wall-forms' || old.raw.kind === 'wall' ? 'walls' : 'footings';
    const src = `item:${layout.id}:${kind}${m[2] ?? ''}`;
    const to = sources.find((s) => s.src === src);
    if (!to) return l;
    const fresh = lineFor(to, to.measures.some((x) => x.id === l.measure) ? l.measure : undefined);
    return { ...l, ...fresh, price: l.price || fresh.price, id: l.id };
  });
}

/** A new line for a picked source and measure: wording, quantity, unit and the price book price. */
export function lineFor(source: BidSource, measureId?: string): Omit<PriceLine, 'id'> {
  const m = source.measures.find((x) => x.id === measureId) ?? source.measures[0];
  if (!m) return { desc: source.what, qty: '1', unit: '', price: '', src: source.src === 'other' ? undefined : source.src };
  // A slab line says which size it bills.
  const size = source.group === 'Slabs' ? SLAB_SIZE[m.id] : undefined;
  return {
    desc: size ? `${source.what} (${size})` : source.what,
    qty: m.qty ? dec(m.qty, m.unit === 'ea' || m.unit === 'lb' ? 0 : 2) : '',
    unit: m.unit,
    price: source.prices[m.unit] ?? '',
    src: source.src,
    measure: m.id,
  };
}

/** Lines you tied to the job get today's quantity; everything else stays as you have it. */
export function refreshLines(lines: PriceLine[], sources: BidSource[]): PriceLine[] {
  return lines.map((l) => {
    if (!l.src || !l.measure) return l;
    const m = sources.find((s) => s.src === l.src)?.measures.find((x) => x.id === l.measure);
    if (!m || !m.qty) return l;
    const qty = dec(m.qty, m.unit === 'ea' || m.unit === 'lb' ? 0 : 2);
    return qty === l.qty && m.unit === l.unit ? l : { ...l, qty, unit: m.unit };
  });
}
