// Layout tools: squaring a slab or form, decimal feet ↔ feet-inches, and poly vapor barrier.

import { piecesToCover } from '../lib/rebar';
import { fixed } from '../lib/units';
import { commas, ftIn, inches, sqFt } from './format';
import { ResultRow, Tool } from './types';

/** True if showing these inches to the nearest 1/16" had to round them. */
const roundedOnTape = (inch: number) => Math.abs(inch * 16 - Math.round(inch * 16)) > 1e-6;

/** Diagonals within this many inches of each other count as square. */
const SQUARE_WITHIN_IN = 1 / 8;

/** Biggest whole-foot 3-4-5 that fits: 3 × k on the short side, 4 × k on the long side. */
function triangleSize(lengthFt: number, widthFt: number): number {
  const short = Math.min(lengthFt, widthFt);
  const long = Math.max(lengthFt, widthFt);
  return Math.max(1, Math.floor(Math.min(short / 3, long / 4) + 1e-9));
}

const squaring: Tool = {
  id: 'squaring',
  title: 'Squaring',
  blurb: 'Diagonal for square corners, check your diagonals, 3-4-5',
  fields: [
    { key: 'length', label: 'Length', kind: 'length' },
    { key: 'width', label: 'Width', kind: 'length' },
    { key: 'diag1', label: 'Diagonal 1 (measured)', kind: 'length', optional: true },
    { key: 'diag2', label: 'Diagonal 2 (measured)', kind: 'length', optional: true },
  ],
  compute: (inp) => {
    const lengthFt = inp.len('length');
    const widthFt = inp.len('width');
    if (lengthFt <= 0 || widthFt <= 0) return { error: 'Length and width must be more than 0.' };

    const diag = Math.hypot(lengthFt, widthFt);
    const rows: ResultRow[] = [{ label: 'Diagonal', value: ftIn(diag), big: true, note: 'Both diagonals should read this' }];
    const warnings: string[] = [];

    const has1 = inp.has('diag1');
    const has2 = inp.has('diag2');
    const d1 = inp.len('diag1');
    const d2 = inp.len('diag2');
    if (has1 && has2) {
      // Compare the way a tape reads: to the nearest 1/16", so the verdict and the number agree.
      const sixteenths = Math.round(Math.abs(d1 - d2) * 12 * 16);
      const diffText = inches(sixteenths / 16);
      const square = sixteenths <= SQUARE_WITHIN_IN * 16;
      rows.push({
        label: 'Check',
        value: square ? 'Square' : `Out ${diffText}`,
        big: true,
        note: square ? 'Diagonals within 1/8"' : `Diagonal ${d1 > d2 ? 1 : 2} is long. Rack it until they match.`,
      });
    } else if (has1 || has2) {
      warnings.push('Measure both diagonals to check for square.');
    }
    const longSide = Math.max(lengthFt, widthFt);
    if ((has1 && d1 <= longSide) || (has2 && d2 <= longSide)) {
      warnings.push('A diagonal can’t be shorter than a side. Check the measurements.');
    }

    const k = triangleSize(lengthFt, widthFt);
    rows.push({ label: '3-4-5', value: `${3 * k}' – ${4 * k}' – ${5 * k}'`, note: `${3 * k}' on the short side, ${4 * k}' on the long side, ${5 * k}' across` });
    return { rows, warnings };
  },
  notes: ['Both diagonals the same = square.'],
};

const feetConverter: Tool = {
  id: 'feet-converter',
  title: 'Decimal Feet ↔ Feet-Inches',
  blurb: 'Plan decimals to tape measure, and back',
  fields: [
    { key: 'decimalFeet', label: 'Decimal feet', kind: 'number', unit: 'ft', optional: true, allowNegative: true, help: 'Like 12.37' },
    { key: 'feetInches', label: 'Feet-inches', kind: 'length', optional: true },
  ],
  compute: (inp) => {
    const hasDec = inp.has('decimalFeet');
    const hasFtIn = inp.has('feetInches');
    if (!hasDec && !hasFtIn) return { error: 'Enter decimal feet or feet-inches.' };
    if (hasDec && hasFtIn) return { error: 'Fill in just one box. Clear the other one.' };

    if (hasDec) {
      const ft = inp.num('decimalFeet');
      return {
        rows: [
          { label: 'Feet-inches', value: ftIn(ft), big: true, note: roundedOnTape(ft * 12) ? 'Nearest 1/16"' : undefined },
          { label: 'Inches', value: inches(ft * 12) },
        ],
      };
    }

    const ft = inp.len('feetInches');
    return {
      rows: [
        { label: 'Decimal feet', value: `${fixed(ft, 2)} ft`, big: true, note: `${fixed(ft, 3)} ft` },
        { label: 'Inches', value: inches(ft * 12) },
      ],
    };
  },
  notes: ['0.1 ft ≈ 1-3/16" and 0.01 ft ≈ 1/8".'],
};

const vaporBarrier: Tool = {
  id: 'vapor-barrier',
  title: 'Vapor Barrier (Poly)',
  blurb: 'Rolls of poly under a slab',
  fields: [
    { key: 'areas', label: 'Area', kind: 'areas', help: 'Add more areas for odd shapes' },
    {
      key: 'rollWidth',
      label: 'Roll width',
      kind: 'choice',
      options: [10, 12, 20, 32].map((n) => ({ value: String(n), label: `${n}'` })),
      default: '20',
    },
    { key: 'rollLength', label: 'Roll length', kind: 'number', unit: 'ft', default: '100' },
    { key: 'overlap', label: 'Overlap', kind: 'number', unit: 'in', default: '6' },
  ],
  compute: (inp) => {
    const area = inp.areas('areas').reduce((sum, r) => sum + r.length * r.width, 0);
    const widthFt = Number(inp.choice('rollWidth'));
    const lengthFt = inp.num('rollLength');
    const overlapFt = inp.num('overlap') / 12;
    if (area <= 0) return { error: 'The area must be more than 0.' };
    if (lengthFt <= 0) return { error: 'Roll length must be more than 0.' };
    if (overlapFt >= widthFt) return { error: `The overlap must be less than ${widthFt}'.` };

    const each = (widthFt - overlapFt) * lengthFt;
    return {
      rows: [
        { label: 'Area', value: sqFt(area) },
        { label: 'Rolls', value: commas(piecesToCover(area, each)), big: true, note: `Each covers ${sqFt(each)} after overlap` },
      ],
    };
  },
  notes: ['Nothing added for running it up the sides or over footings.'],
};

export const LAYOUT_TOOLS: Tool[] = [squaring, feetConverter, vaporBarrier];
