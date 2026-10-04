// Turns a tool's boxes and answers into plain text for texting or emailing:
//
//   Slab – Construction Calc
//   Slab size: 40' 0" × 30' 0"
//   Thickness: 4"
//   ...
//   Cubic yards: 25.53 (With 10% waste)
//   Order: 25.75 yd

import { ftIn, inches } from './format';
import { RawArea, RawBarRow, RawLength, RawValues, RawWallRow, parseLength, parseNumber, RunResult } from './run';
import { Field, Tool } from './types';

const lengthText = (r: RawLength): string | null => {
  const ft = parseLength(r);
  if (ft === null || Number.isNaN(ft)) return null;
  return ft < 1 ? inches(ft * 12) : ftIn(ft); // 4" reads better than 0' 4"
};

/** What was typed in one field, or null if it was left blank. */
function fieldText(f: Field, v: RawValues[string]): string | null {
  switch (f.kind) {
    case 'length':
      return lengthText(v as RawLength);
    case 'number': {
      const t = (v as string).trim();
      if (!t || parseNumber(t, f.allowNegative) === null) return null;
      if (f.unit?.startsWith('$')) return `$${t}${f.unit.slice(1)}`;
      if (f.unit === '%') return `${t}%`;
      return f.unit ? `${t} ${f.unit}` : t;
    }
    case 'count':
      return (v as string).trim() || null;
    case 'choice':
      return f.options.find((o) => o.value === v)?.label ?? null;
    case 'areas': {
      const parts = (v as RawArea[])
        .map((a) => [lengthText(a.length), lengthText(a.width)])
        .filter(([l, w]) => l && w)
        .map(([l, w]) => `${l} × ${w}`);
      return parts.length ? parts.join(' + ') : null;
    }
    case 'barlist': {
      const parts = (v as RawBarRow[])
        .filter((r) => r.qty.trim() && lengthText(r.length))
        .map((r) => `${r.qty.trim()} – #${r.size} @ ${lengthText(r.length)}`);
      return parts.length ? parts.join(', ') : null;
    }
    case 'walls': {
      const parts = (v as RawWallRow[]).filter((r) => lengthText(r.length)).map((r) => `${lengthText(r.length)} (${WALL_ENDS_TEXT[r.ends]})`);
      return parts.length ? parts.join(', ') : null;
    }
  }
}

export const WALL_ENDS_TEXT = { oo: 'outside corners', oi: 'outside + inside corner', ii: 'inside corners' } as const;

export function shareText(tool: Tool, raw: RawValues, result: RunResult): string | null {
  if (result.status !== 'ok') return null;
  const lines = [`${tool.title} – Construction Calc`, ''];
  for (const f of tool.fields) {
    const t = fieldText(f, raw[f.key]);
    if (t !== null) lines.push(`${f.label}: ${t}`);
  }
  lines.push('');
  for (const w of result.result.warnings ?? []) lines.push(`⚠ ${w}`);
  for (const r of result.result.rows) lines.push(`${r.label}: ${r.value}${r.note ? ` (${r.note})` : ''}`);
  return lines.join('\n');
}
