jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { CONCRETE_TOOLS } from '../../tools/concreteTools';
import { REBAR_TOOLS } from '../../tools/rebarTools';
import { defaultRaw, runTool, rowValue } from '../../tools/run';
import { shareText } from '../../tools/share';
import { cleanSettings, companyLine, DEFAULT_SETTINGS, Settings, TAB_IDS, userDefaults } from '../settings';

const tool = (id: string) => [...CONCRETE_TOOLS, ...REBAR_TOOLS].find((t) => t.id === id)!;
const withDefaults = (d: Partial<Settings['defaults']>): Settings => ({ ...DEFAULT_SETTINGS, defaults: { ...DEFAULT_SETTINGS.defaults, ...d } });

describe('cleanSettings', () => {
  test('junk or nothing gives the defaults', () => {
    expect(cleanSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(cleanSettings({ mode: 'neon', accent: 'plaid', textSize: 'huge', favorites: [1, 'slab'] }).favorites).toEqual(['slab']);
  });

  test('keeps a saved tab order and adds any tab it is missing', () => {
    expect(cleanSettings({ tabOrder: ['rebar', 'calc', 'nope'] }).tabOrder).toEqual(['rebar', 'calc', ...TAB_IDS.filter((t) => t !== 'rebar' && t !== 'calc')]);
  });
});

describe('My defaults', () => {
  test('a fresh slab starts with my waste, truck, price and thickness', () => {
    const s = withDefaults({ waste: '8', truck: '11', price: '165', slabThick: '5' });
    const raw = defaultRaw(tool('slab'), userDefaults(tool('slab'), s));
    expect(raw.waste).toBe('8');
    expect(raw.truck).toBe('11');
    expect(raw.price).toBe('165');
    expect(raw.thick).toEqual({ ft: '', in: '5' });
    // 10 × 10 × 5" = 41.67 cu ft + 8% = 45 cu ft = 1.67 yd → order 1.75 → × $165
    expect(rowValue(runTool(tool('slab'), { ...raw, areas: [[10, 10]] }), 'Concrete cost')).toBe('$288.75');
  });

  test('wall thickness goes to Wall Forms only; rebar gets stick length, on center and lap', () => {
    const s = withDefaults({ wallThick: '10', slabThick: '6', stockLength: '40', spacing: '12', lap: '30' });
    expect(userDefaults(tool('wall-forms'), s).thick).toBe('10');
    const rebar = userDefaults(tool('slab-rebar'), s);
    expect(rebar).toMatchObject({ stockLength: '40', spacing: '12', lap: '30' });
    expect(userDefaults(tool('slab'), withDefaults({ stockLength: '25' }))).toEqual({}); // not a stick length option, and slab has none
  });

  test('blank defaults change nothing', () => {
    expect(userDefaults(tool('slab'), DEFAULT_SETTINGS)).toEqual({});
  });
});

test('company line goes at the bottom of shared numbers', () => {
  const s: Settings = { ...DEFAULT_SETTINGS, company: { name: 'Smith Concrete', phone: '(406) 555-1234', email: '', license: '#123' } };
  expect(companyLine(s)).toBe('Smith Concrete · (406) 555-1234 · Lic #123');
  const raw = { ...defaultRaw(tool('slab')), areas: [{ length: { ft: '10', in: '' }, width: { ft: '10', in: '' } }] };
  const text = shareText(tool('slab'), raw, runTool(tool('slab'), raw), companyLine(s))!;
  expect(text.endsWith('\n\nSmith Concrete · (406) 555-1234 · Lic #123')).toBe(true);
  expect(companyLine(DEFAULT_SETTINGS)).toBe('');
});

test('document settings: junk falls back to the standard look, notices kept', () => {
  const s = cleanSettings({ docs: { color: 'purple', font: 'comic', header: 'sideways', billNotice: 'Net 30' } });
  expect(s.docs).toMatchObject({ color: 'black', font: 'clean', header: 'side', billNotice: 'Net 30', bidNotice: '' });
});
