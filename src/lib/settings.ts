// The person's settings: look, starting numbers for the tools, company info, and which tools show where.
// Kept on the phone. Changing the look repaints the app right away.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import { DEFAULT_DOCS, DOC_COLORS, DOC_FONTS, DocSettings } from '../report/docStyle';
import { AccentId, ACCENTS, applyTheme, Mode, TEXT_SIZES, TextSize } from '../theme';
import type { RawValues } from '../tools/run';
import type { Tool } from '../tools/types';

export const TAB_IDS = ['calc', 'concrete', 'rebar', 'site', 'engineer', 'jobs'] as const;
export type TabId = (typeof TAB_IDS)[number];

export interface Settings {
  mode: Mode;
  accent: AccentId;
  textSize: TextSize;
  /** Key clicks you can feel (phone app) */
  haptics: boolean;
  /** Starting numbers, as typed. Blank = the tool's own default. */
  defaults: {
    waste: string;
    truck: string;
    price: string;
    slabThick: string;
    wallThick: string;
    spacing: string;
    lap: string;
    stockLength: string;
  };
  company: { name: string; phone: string; email: string; license: string };
  /** How bids, bills and crew sheets look */
  docs: DocSettings;
  /** Your usual prices, as typed; "Fill in from job" uses them. Blank = leave it for you. */
  prices: {
    slabSqFt: string;
    wallFt: string;
    footingFt: string;
    pierEa: string;
    stepsSet: string;
    rebarLb: string;
    laborJob: string;
    excavYd: string;
    baseTon: string;
    barrierSqFt: string;
    dowelEa: string;
    /** Anchor bolts, set in the wet wall */
    boltEa: string;
    pumpPour: string;
    /** Sales tax %, put on every new bid */
    taxPct: string;
    /** Deposit to start, % of the bid */
    depositPct: string;
    /** Days to pay the final bill; blank = due on receipt */
    termsDays: string;
  };
  /** Who you order concrete from */
  supplier: { name: string; phone: string; psi: string };
  favorites: string[];
  hidden: string[];
  tabOrder: TabId[];
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'dark',
  accent: 'orange',
  textSize: 'normal',
  haptics: true,
  defaults: { waste: '', truck: '', price: '', slabThick: '', wallThick: '', spacing: '', lap: '', stockLength: '' },
  company: { name: '', phone: '', email: '', license: '' },
  docs: DEFAULT_DOCS,
  prices: {
    slabSqFt: '',
    wallFt: '',
    footingFt: '',
    pierEa: '',
    stepsSet: '',
    rebarLb: '',
    laborJob: '',
    excavYd: '',
    baseTon: '',
    barrierSqFt: '',
    dowelEa: '',
    boltEa: '',
    pumpPour: '',
    taxPct: '',
    depositPct: '',
    termsDays: '',
  },
  supplier: { name: '', phone: '', psi: '3000' },
  favorites: [],
  hidden: [],
  tabOrder: [...TAB_IDS],
};

/** Saved settings from an older version (or junk) → a complete, valid Settings. */
export function cleanSettings(saved: unknown): Settings {
  const s = (typeof saved === 'object' && saved !== null ? saved : {}) as Partial<Settings>;
  const strings = <T extends Record<string, string>>(base: T, v: unknown): T => {
    const out = { ...base };
    if (typeof v === 'object' && v !== null) {
      for (const k of Object.keys(base) as (keyof T)[]) {
        const x = (v as Record<string, unknown>)[k as string];
        if (typeof x === 'string') out[k] = x as T[keyof T];
      }
    }
    return out;
  };
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const order = ids(s.tabOrder).filter((t): t is TabId => (TAB_IDS as readonly string[]).includes(t));
  return {
    mode: s.mode === 'light' ? 'light' : 'dark',
    accent: s.accent && s.accent in ACCENTS ? s.accent : 'orange',
    textSize: s.textSize && s.textSize in TEXT_SIZES ? s.textSize : 'normal',
    haptics: s.haptics !== false,
    defaults: strings(DEFAULT_SETTINGS.defaults, s.defaults),
    company: strings(DEFAULT_SETTINGS.company, s.company),
    docs: (() => {
      const d = strings({ ...DEFAULT_DOCS }, s.docs) as DocSettings;
      return {
        ...d,
        color: d.color in DOC_COLORS ? d.color : DEFAULT_DOCS.color,
        font: d.font in DOC_FONTS ? d.font : DEFAULT_DOCS.font,
        header: d.header === 'center' ? 'center' : 'side',
      };
    })(),
    prices: strings(DEFAULT_SETTINGS.prices, s.prices),
    supplier: strings(DEFAULT_SETTINGS.supplier, s.supplier),
    favorites: ids(s.favorites),
    hidden: ids(s.hidden),
    // Keep their order, and add any tab they don't have saved (new tabs in an update).
    tabOrder: [...new Set([...order, ...TAB_IDS])],
  };
}

/** The boxes a fresh tool starts with, from My defaults. Only boxes this tool has, and only ones filled in. */
export function userDefaults(tool: Tool, s: Settings): RawValues {
  const d = s.defaults;
  const out: RawValues = {};
  for (const f of tool.fields) {
    const set = (v: string) => {
      if (v.trim()) out[f.key] = v.trim();
    };
    if (f.key === 'waste' && f.kind === 'number') set(d.waste);
    else if (f.key === 'truck' && f.kind === 'number') set(d.truck);
    else if (f.key === 'price' && f.kind === 'number') set(d.price);
    else if (f.key === 'lap' && f.kind === 'number') set(d.lap);
    else if (f.key === 'spacing' && f.kind === 'number' && tool.id === 'slab-rebar') set(d.spacing);
    else if (f.key === 'stockLength' && f.kind === 'choice' && f.options.some((o) => o.value === d.stockLength)) out[f.key] = d.stockLength;
    else if (f.key === 'thick' && f.kind === 'number' && tool.id === 'wall-forms') set(d.wallThick);
    else if (f.key === 'thick' && f.kind === 'length' && d.slabThick.trim()) out[f.key] = { ft: '', in: d.slabThick.trim() };
  }
  return out;
}

/** "Smith Concrete · (406) 555-1234 · bob@smith.com · Lic #1234", or '' if nothing is filled in. */
export function companyLine(s: Settings): string {
  const c = s.company;
  return [c.name, c.phone, c.email, c.license && `Lic #${c.license.replace(/^#/, '')}`].map((x) => x.trim()).filter(Boolean).join(' · ');
}

// ---------- one shared copy for the whole app ----------

const SAVE_KEY = 'settings-v1';
let current: Settings = DEFAULT_SETTINGS;
let loaded = false;
const listeners = new Set<() => void>();

function publish(next: Settings, save = true) {
  const lookChanged = next.mode !== current.mode || next.accent !== current.accent || next.textSize !== current.textSize;
  current = next;
  if (lookChanged) applyTheme(next);
  listeners.forEach((l) => l());
  if (save) AsyncStorage.setItem(SAVE_KEY, JSON.stringify(next)).catch(() => {});
}

export function loadSettings() {
  if (loaded) return;
  loaded = true;
  AsyncStorage.getItem(SAVE_KEY)
    .then((text) => {
      if (text) publish(cleanSettings(JSON.parse(text)), false);
    })
    .catch(() => {});
}

export const settings = {
  get: () => current,
  update(patch: Partial<Settings>) {
    publish({ ...current, ...patch });
  },
  toggle(list: 'favorites' | 'hidden', toolId: string) {
    const has = current[list].includes(toolId);
    publish({ ...current, [list]: has ? current[list].filter((x) => x !== toolId) : [...current[list], toolId] });
  },
};

export function useSettings(): Settings {
  loadSettings();
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
