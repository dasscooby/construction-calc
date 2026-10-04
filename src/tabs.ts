// The bottom tabs: tab-bar name and, for tool tabs, the menu title and its tools.

import type { TabId } from './lib/settings';
import type { ToolGroup } from './screens/ToolsTab';
import { CONCRETE_GROUPS, ENGINEERING_GROUPS, REBAR_GROUPS, SITE_GROUPS } from './tools';

export const TABS: Record<TabId, { name: string; title?: string; groups?: ToolGroup[] }> = {
  calc: { name: 'Calc' },
  concrete: { name: 'Concrete', title: 'Concrete', groups: CONCRETE_GROUPS },
  rebar: { name: 'Rebar', title: 'Rebar', groups: REBAR_GROUPS },
  site: { name: 'Site', title: 'Site & Layout', groups: SITE_GROUPS },
  engineer: { name: 'Engineer', title: 'Engineering', groups: ENGINEERING_GROUPS },
  jobs: { name: 'Jobs' },
};
