// Reading a plan page: the picture or PDF goes to the app's server, which asks Claude what's on it,
// and comes back as slabs (walked side by side, like Slab Layout), rebar, dowels and notes.

import { Platform } from 'react-native';

import { slabLayout } from '../tools/slabLayoutTool';
import { defaultRaw, RawLength, RawOutlineRow, RawValues } from '../tools/run';
import type { EdgeKind } from '../tools/types';

export interface PlanSlab {
  name: string;
  sides: { length_ft: number; turn: 'R' | 'L'; radius_ft: number; edge: EdgeKind }[];
  thickness_in?: number | null;
  footing?: { width_in: number; depth_in: number } | null;
  rebar?: { size: number; spacing_in: number } | null;
  footing_bars?: { size: number; count: number } | null;
  dowels?: { size: number; spacing_in: number; length_in: number } | null;
}

export interface PlanRead {
  slabs: PlanSlab[];
  notes: string[];
  unsure: string[];
}

// The web app talks to its own site; the phone app to the live site.
const ENDPOINT = Platform.OS === 'web' ? '/.netlify/functions/read-plan' : 'https://construction-calc-7815.netlify.app/.netlify/functions/read-plan';

export async function readPlan(data: string, mediaType: string): Promise<PlanRead> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data, mediaType }) });
  } catch {
    throw new Error('No signal. Try again when you have service.');
  }
  const body = (await res.json().catch(() => ({}))) as Partial<PlanRead> & { error?: string };
  if (!res.ok) throw new Error(body.error ?? 'Couldn’t read the plan right now.');
  return {
    slabs: Array.isArray(body.slabs) ? body.slabs.filter((s) => Array.isArray(s?.sides)) : [],
    notes: Array.isArray(body.notes) ? body.notes.map(String) : [],
    unsure: Array.isArray(body.unsure) ? body.unsure.map(String) : [],
  };
}

/** Web: lets you pick a PDF or picture and hands back its contents (base64). Call from a tap. */
export function pickPlanFileWeb(): Promise<{ data: string; mediaType: string; name: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,image/jpeg,image/png,image/webp';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => {
        const url = String(reader.result);
        resolve({ data: url.slice(url.indexOf(',') + 1), mediaType: file.type || 'image/jpeg', name: file.name });
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

const len = (ft: number): RawLength => {
  if (!(ft > 0)) return { ft: '', in: '' };
  let whole = Math.floor(ft + 1e-9);
  let inch = Math.round((ft - whole) * 12 * 8) / 8;
  if (inch >= 12) {
    whole += 1;
    inch = 0;
  }
  return { ft: String(whole), in: inch ? String(inch) : '' };
};
const inches = (n: number | undefined | null): RawLength => ({ ft: '', in: n && n > 0 ? String(n) : '' });
/** Bar size the tool offers, nearest to what the plan says. */
const bar = (size: number, from: number, to: number) => String(Math.min(to, Math.max(from, Math.round(size))));

/** A slab from the plan as Slab Layout numbers; anything the plan didn't say keeps your usual numbers. */
export function slabToRaw(s: PlanSlab, base: RawValues = defaultRaw(slabLayout)): RawValues {
  const raw: RawValues = { ...base };
  raw.sides = s.sides.map(
    (side): RawOutlineRow => ({
      length: len(side.length_ft),
      turn: side.turn === 'L' ? 'L' : 'R',
      radius: len(side.radius_ft),
      edge: (['form', 'house', 'dowels', 'slab', 'slabDowels'] as EdgeKind[]).includes(side.edge) ? side.edge : 'form',
    }),
  );
  if (s.thickness_in) raw.thick = inches(s.thickness_in);
  if (s.footing?.width_in && s.footing.depth_in) {
    raw.footing = '1';
    raw.fWidth = inches(s.footing.width_in);
    raw.fDepth = inches(s.footing.depth_in);
  }
  if (s.rebar?.size) {
    raw.slabRebar = '1';
    raw.barSize = bar(s.rebar.size, 3, 5);
    if (s.rebar.spacing_in) raw.spacing = String(s.rebar.spacing_in);
  }
  if (s.footing_bars?.size && raw.footing === '1') {
    raw.footBars = '1';
    raw.fBarSize = bar(s.footing_bars.size, 4, 6);
    if (s.footing_bars.count) raw.fBars = String(s.footing_bars.count);
  }
  if (s.dowels?.size) {
    raw.dowelSize = bar(s.dowels.size, 4, 6);
    if (s.dowels.spacing_in) raw.dowelSpacing = String(s.dowels.spacing_in);
    if (s.dowels.length_in) raw.dowelLength = inches(s.dowels.length_in);
  }
  return raw;
}
