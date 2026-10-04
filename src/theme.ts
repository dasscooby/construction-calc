// Apple-calculator style: round keys, big numbers, one accent color. Dark or light, and the accent and
// text size come from Settings. `colors` is updated in place, and every screen rebuilds its styles
// (see themed()) when the look changes.

import { ImageStyle, StyleSheet, TextStyle, ViewStyle } from 'react-native';

export type Mode = 'dark' | 'light';
export type AccentId = 'orange' | 'yellow' | 'blue' | 'green' | 'red' | 'purple';
export type TextSize = 'normal' | 'large' | 'xl';

const DARK = {
  bg: '#000000',
  text: '#FFFFFF',
  subtext: '#98989F',
  faint: '#636366',
  border: '#38383A', // thin separator lines
  panel: '#1C1C1E', // cards, inputs
  panel2: '#2C2C2E',
  lcd: '#000000',

  numKey: '#333333',
  numKeyText: '#FFFFFF',
  fnKey: '#1C1C1E',
  fnKeyText: '#FFFFFF',
  opKeyText: '#FFFFFF',
  lightKey: '#A5A5A5', // top row, like AC / ± / %
  lightKeyText: '#000000',
  lightText: '#FFFFFF',

  danger: '#FF453A',
  error: '#FF453A',
  warningBg: '#2B2210',
};

const LIGHT: typeof DARK = {
  bg: '#F2F2F7',
  text: '#000000',
  subtext: '#6C6C70',
  faint: '#AEAEB2',
  border: '#C6C6C8',
  panel: '#FFFFFF',
  panel2: '#E5E5EA',
  lcd: '#F2F2F7',

  numKey: '#FFFFFF',
  numKeyText: '#000000',
  fnKey: '#E5E5EA',
  fnKeyText: '#000000',
  opKeyText: '#FFFFFF',
  lightKey: '#D1D1D6',
  lightKeyText: '#000000',
  lightText: '#000000',

  danger: '#D70015',
  error: '#D70015',
  warningBg: '#FFF4DC',
};

/** Accent colors: [on dark, on light, text on top of the accent]. */
export const ACCENTS: Record<AccentId, { label: string; dark: string; light: string; on: string }> = {
  orange: { label: 'Orange', dark: '#FF9F0A', light: '#E07B00', on: '#000000' },
  yellow: { label: 'Safety yellow', dark: '#FFD60A', light: '#B38F00', on: '#000000' },
  blue: { label: 'Blue', dark: '#0A84FF', light: '#0062CC', on: '#FFFFFF' },
  green: { label: 'Green', dark: '#30D158', light: '#1E8E3E', on: '#000000' },
  red: { label: 'Red', dark: '#FF453A', light: '#D70015', on: '#FFFFFF' },
  purple: { label: 'Purple', dark: '#BF5AF2', light: '#8944AB', on: '#FFFFFF' },
};

export const TEXT_SIZES: Record<TextSize, { label: string; scale: number }> = {
  normal: { label: 'Normal', scale: 1 },
  large: { label: 'Large', scale: 1.15 },
  xl: { label: 'Extra large', scale: 1.3 },
};

function palette(mode: Mode, accent: AccentId) {
  const a = ACCENTS[accent];
  const base = mode === 'dark' ? DARK : LIGHT;
  const accentColor = mode === 'dark' ? a.dark : a.light;
  return {
    ...base,
    accent: accentColor,
    accentText: a.on,
    opKey: accentColor,
    opKeyText: a.on === '#000000' && mode === 'dark' ? '#FFFFFF' : a.on,
    subLabel: accentColor, // second-function labels above the keys
  };
}

export type Colors = ReturnType<typeof palette>;

/** The current colors. Read them at render time (or inside themed()), never copy them into a constant. */
export const colors: Colors = palette('dark', 'orange');
export let mode: Mode = 'dark';
let fontScale = 1;
let version = 0;
const listeners = new Set<() => void>();

export function applyTheme(next: { mode: Mode; accent: AccentId; textSize: TextSize }) {
  Object.assign(colors, palette(next.mode, next.accent));
  mode = next.mode;
  fontScale = TEXT_SIZES[next.textSize].scale;
  version++;
  listeners.forEach((l) => l());
}

export function onThemeChange(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const themeVersion = () => version;

type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

/** Multiply every fontSize and lineHeight (bigger text for the jobsite). */
function scaleFonts<T>(styles: T, k: number): T {
  if (k === 1) return styles;
  const out: Record<string, Record<string, unknown>> = {};
  for (const [name, style] of Object.entries(styles as Record<string, Record<string, unknown>>)) {
    const s = { ...style };
    if (typeof s.fontSize === 'number') s.fontSize = Math.round(s.fontSize * k);
    if (typeof s.lineHeight === 'number') s.lineHeight = Math.round(s.lineHeight * k);
    out[name] = s;
  }
  return out as T;
}

/**
 * Styles that follow the theme. Call the returned function during render:
 *   const getStyles = themed(() => ({ box: { backgroundColor: colors.panel } }));
 *   ...  const styles = getStyles();
 * Pass scaleText: false for screens laid out to an exact size (the calculator keypad).
 */
export function themed<T extends NamedStyles<T>>(make: () => T & NamedStyles<any>, { scaleText = true } = {}): () => T {
  let cache: T | null = null;
  let builtFor = -1;
  return () => {
    if (!cache || builtFor !== version) {
      cache = StyleSheet.create(scaleFonts(make(), scaleText ? fontScale : 1)) as unknown as T;
      builtFor = version;
    }
    return cache;
  };
}
