// Which tools show up on which tab.

import type { ToolGroup } from '../screens/ToolsTab';
import { CONCRETE_TOOLS } from './concreteTools';
import { ENGINEERING_TOOLS } from './engineeringTools';
import { LAYOUT_TOOLS } from './layoutTools';
import { REBAR_TOOLS } from './rebarTools';
import { SITE_TOOLS } from './siteTools';

export const CONCRETE_GROUPS: ToolGroup[] = [{ tools: CONCRETE_TOOLS }];
export const REBAR_GROUPS: ToolGroup[] = [{ tools: REBAR_TOOLS }];
export const SITE_GROUPS: ToolGroup[] = [
  { heading: 'Grade & dirt', tools: SITE_TOOLS },
  { heading: 'Layout', tools: LAYOUT_TOOLS },
];
export const ENGINEERING_GROUPS: ToolGroup[] = [{ tools: ENGINEERING_TOOLS }];

/** Every tool, for looking one up by id (History, jobs). */
export const ALL_TOOLS = [...CONCRETE_TOOLS, ...REBAR_TOOLS, ...SITE_TOOLS, ...LAYOUT_TOOLS, ...ENGINEERING_TOOLS];

/**
 * Saved calculations from tools that were replaced: Slab + Beams became Slab with its
 * "Exterior footing" (and "Interior footings") switches on.
 */
export function migrateItem(toolId: string, raw: Record<string, unknown>): { toolId: string; raw: Record<string, unknown> } {
  // An item saved with no boxes at all opens with the tool's defaults instead of crashing.
  if (!raw || typeof raw !== 'object') raw = {};
  if (toolId === 'footings' && raw && typeof raw === 'object' && raw.shape === undefined) return { toolId, raw: { ...raw, shape: 'run' } };
  if (toolId !== 'slab-beams') return { toolId, raw };
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const interior = str(raw.interior).trim();
  return {
    toolId: 'slab',
    raw: {
      ...raw,
      footing: '1',
      fWidth: raw.pWidth,
      fDepth: raw.pDepth,
      fPerim: str(raw.perim),
      interior: interior ? '1' : '',
      iLength: interior,
    },
  };
}
