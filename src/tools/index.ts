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
