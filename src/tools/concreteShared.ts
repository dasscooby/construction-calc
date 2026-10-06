// The order block every concrete tool ends with: waste, order (rounded up to 1/4 yd), trucks, cost, bags.

import { concreteResult, truckLoads } from '../lib/concrete';
import { commas, commasTrim, dec, ftIn, money } from './format';
import { Field, Inputs, ResultRow } from './types';

export const CUFT_PER_CUYD = 27;
const MAX_BAG_YD = 2;

// Every concrete tool ends with waste %, truck size and price.
export const ORDER_FIELDS: Field[] = [
  { key: 'waste', label: 'Waste', kind: 'number', unit: '%', default: '10', optional: true },
  { key: 'truck', label: 'Truck size', kind: 'number', unit: 'yd', default: '10', optional: true },
  { key: 'price', label: 'Price per yard', kind: 'number', unit: '$/yd', optional: true },
];

/**
 * A yellow "check this" when a size is far bigger than it should be, the usual slip being
 * inches typed in the feet box (a 4" slab entered as 4 ft). Nothing is changed, only flagged.
 */
export function tooBig(label: string, ft: number, maxFt: number): string | null {
  if (!(ft > maxFt)) return null;
  const whole = Math.abs(ft - Math.round(ft)) < 1e-9 && ft <= 48;
  return whole
    ? `${label} is ${ft} feet. Did you mean ${ft} inches? Inches go in the “in” box.`
    : `${label} is ${ftIn(ft)}. That’s bigger than usual. Check the number.`;
}

/** The standard answer block: yards with waste, order amount, trucks, bags, and the before-waste number. */
export function concreteRows(baseCuFt: number, inp: Inputs, bags = true): ResultRow[] {
  const waste = inp.num('waste');
  const r = concreteResult(baseCuFt, waste);
  const rows: ResultRow[] = [
    { label: 'Cubic yards', value: dec(r.cuYd, 2), big: true, note: `With ${dec(waste, 1)}% waste` },
    { label: 'Cubic feet', value: commasTrim(r.cuFt, 1) },
    { label: 'Order', value: `${r.orderCuYd.toFixed(2)} yd`, big: true, note: 'Rounded up to the next ¼ yard' },
  ];
  if (inp.num('price') > 0) {
    rows.push({ label: 'Concrete cost', value: money(r.orderCuYd * inp.num('price')), note: `${r.orderCuYd.toFixed(2)} yd × ${money(inp.num('price'))}` });
  }
  const truck = inp.num('truck');
  if (truck > 0 && r.orderCuYd > 0) {
    const t = truckLoads(r.orderCuYd, truck);
    rows.push({
      label: 'Trucks',
      value: t.trucks === 1 ? '1 truck' : `${t.trucks} trucks`,
      note: t.trucks === 1 ? `${dec(r.orderCuYd)} yd` : `${t.trucks - 1} full (${dec(truck)} yd) + last load ${dec(t.lastLoad)} yd`,
    });
  }
  // Bags only make sense on small pours; past 2 yards you're ordering a truck.
  if (bags && r.cuYd <= MAX_BAG_YD) {
    for (const b of r.bags.slice().reverse()) rows.push({ label: `${b.lb} lb bags`, value: commas(b.count) });
  }
  rows.push({ label: 'Before waste', value: `${dec(r.baseCuYd, 2)} cu yd`, note: `${commasTrim(r.baseCuFt, 1)} cu ft` });
  return rows;
}
