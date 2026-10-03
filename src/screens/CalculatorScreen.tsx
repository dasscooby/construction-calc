import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useReducer, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  CalcState,
  DEFAULT_PREFS,
  DEFAULT_STORED,
  Key,
  Prefs,
  Stored,
  View as CalcView,
  createState,
  press,
  setPrefs,
  view,
} from '../lib/cm';
import { DENOMS } from '../lib/units';
import { colors } from '../theme';

// ---------- keypad layout (same as the Construction Master 5) ----------

type KeyKind = 'fn' | 'num' | 'op' | 'conv' | 'clear' | 'util';
type SheetName = 'tape' | 'prefs' | 'guide';

interface KeyDef {
  k: Key | SheetName;
  label: string;
  sub?: string; // second function, reached with Conv first
  kind: KeyKind;
  flex?: number;
}

const fn = (k: Key, label: string, sub?: string): KeyDef => ({ k, label, sub, kind: 'fn' });
const num = (k: Key, sub?: string): KeyDef => ({ k, label: k === '.' ? '•' : k, sub, kind: 'num' });
const op = (k: Key, label: string, sub?: string): KeyDef => ({ k, label, sub, kind: 'op' });

const TOP_ROW: KeyDef[] = [
  { k: 'guide', label: 'Guide', kind: 'util' },
  { k: 'tape', label: 'Tape', kind: 'util' },
  { k: 'prefs', label: 'Prefs', kind: 'util' },
  { k: 'onc', label: 'On/C', kind: 'clear', flex: 2 },
];

const ROWS: KeyDef[][] = [
  [fn('pitch', 'Pitch'), fn('rise', 'Rise'), fn('run', 'Run'), fn('diag', 'Diag'), fn('hip', 'Hip/V', 'Ir/Pitch')],
  [fn('bdft', 'Bd Ft'), fn('stair', 'Stair'), fn('circ', 'Circ', 'Arc'), fn('rwall', 'R/Wall'), fn('jack', 'Jack', 'Ir/Jack')],
  [fn('m', 'm'), fn('cm', 'cm'), fn('mm', 'mm'), fn('weight', 'Weight'), fn('sqrt', '√x', 'x²')],
  [fn('yd', 'Yds'), fn('ft', 'Feet'), fn('in', 'Inch'), fn('frac', '/'), fn('back', '⌫')],
  [{ k: 'conv', label: 'Conv', kind: 'conv' }, num('7', 'Riser Ht'), num('8'), num('9', 'Tread W'), op('/', '÷', '1/x')],
  [fn('rcl', 'Rcl', 'M-R/C'), num('4'), num('5', 'o.c.'), num('6'), op('*', '×', 'Clear All')],
  [fn('m+', 'M+', 'M−'), num('1'), num('2'), num('3'), op('-', '−', '+/−')],
  [fn('%', '%', 'Prefs'), num('0', 'wt/vol'), num('.', 'Cost'), op('=', '=', 'Tape'), op('+', '+', 'π')],
];

const KEY_COLORS: Record<KeyKind, { bg: string; fg: string }> = {
  fn: { bg: colors.fnKey, fg: colors.lightText },
  num: { bg: colors.numKey, fg: colors.numKeyText },
  op: { bg: colors.opKey, fg: colors.lightText },
  conv: { bg: colors.convKey, fg: colors.text },
  clear: { bg: colors.clearKey, fg: colors.lightText },
  util: { bg: colors.utilKey, fg: colors.lightText },
};

// ---------- state + saving settings on the phone ----------

const SAVE_KEY = 'cm5-settings-v1';

type Action =
  | { type: 'key'; key: Key }
  | { type: 'prefs'; prefs: Prefs }
  | { type: 'load'; prefs: Prefs; stored: Stored; pitch?: number };

function reducer(s: CalcState, a: Action): CalcState {
  switch (a.type) {
    case 'key':
      return press(s, a.key);
    case 'prefs':
      return setPrefs(s, a.prefs);
    case 'load':
      return createState(a.prefs, a.stored, a.pitch);
  }
}

export default function CalculatorScreen() {
  const [state, dispatch] = useReducer(reducer, undefined, () => createState());
  const [loaded, setLoaded] = useState(false);
  const [modal, setModal] = useState<SheetName | null>(null);

  // Load saved preferences, stored values and pitch.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(SAVE_KEY);
        if (raw) {
          const saved = JSON.parse(raw);
          dispatch({
            type: 'load',
            prefs: { ...DEFAULT_PREFS, ...saved.prefs },
            stored: { ...DEFAULT_STORED, ...saved.stored },
            pitch: typeof saved.pitch === 'number' ? saved.pitch : undefined,
          });
        } else {
          const oldDenom = await AsyncStorage.getItem('roundDenom'); // setting from the first version
          if (oldDenom === '8' || oldDenom === '4') {
            dispatch({ type: 'load', prefs: { ...DEFAULT_PREFS, denom: Number(oldDenom) as 8 | 4 }, stored: DEFAULT_STORED });
          }
        }
      } catch {
        // start with defaults
      }
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const data = JSON.stringify({ prefs: state.prefs, stored: state.stored, pitch: state.tri.pitch });
    AsyncStorage.setItem(SAVE_KEY, data).catch(() => {});
  }, [loaded, state.prefs, state.stored, state.tri.pitch]);

  // Rcl = / Conv = open the tape; Conv % opens preferences.
  useEffect(() => {
    if (state.ui) setModal(state.ui);
  }, [state.ui]);

  const v = view(state);
  const armed = state.prefix === 'conv';

  const onKey = (k: KeyDef['k']) => {
    if (k === 'guide' || k === 'tape' || k === 'prefs') setModal(k);
    else dispatch({ type: 'key', key: k });
  };

  return (
    <View style={styles.container}>
      <Lcd v={v} />
      <View style={styles.topRow}>
        {TOP_ROW.map((d) => (
          <CalcKey key={d.k} def={d} armed={false} onPress={() => onKey(d.k)} compact />
        ))}
      </View>
      <View style={styles.pad}>
        {ROWS.map((row, r) => (
          <View key={r} style={styles.row}>
            {row.map((d) => (
              <CalcKey key={d.k} def={d} armed={armed} onPress={() => onKey(d.k)} />
            ))}
          </View>
        ))}
      </View>

      <TapeModal visible={modal === 'tape'} state={state} onClose={() => setModal(null)} />
      <PrefsModal
        visible={modal === 'prefs'}
        state={state}
        onChange={(prefs) => dispatch({ type: 'prefs', prefs })}
        onClose={() => setModal(null)}
      />
      <GuideModal visible={modal === 'guide'} onClose={() => setModal(null)} />
    </View>
  );
}

// ---------- display ----------

function Lcd({ v }: { v: CalcView }) {
  const len = v.text.length;
  const size = len <= 9 ? 46 : len <= 13 ? 40 : len <= 17 ? 33 : len <= 21 ? 27 : 22;
  const unitSize = Math.max(13, Math.round(size * 0.42));
  return (
    <View style={styles.lcd}>
      <View style={styles.lcdRow}>
        <Text style={styles.flags}>{v.flags.join('  ') || ' '}</Text>
        <Text style={styles.pending} numberOfLines={1}>
          {v.pending}
        </Text>
      </View>
      <View style={styles.lcdMain}>
        <Text style={styles.lcdLabel} numberOfLines={1}>
          {v.label}
          {v.mark ? ` ${v.mark}` : ''}
        </Text>
        <Text
          style={[styles.lcdValue, v.isError && styles.lcdError]}
          numberOfLines={1}
          adjustsFontSizeToFit
          accessibilityLiveRegion="polite"
        >
          {v.segs.map((sg, i) => (
            <Text key={i}>
              {i > 0 ? ' ' : ''}
              <Text style={{ fontSize: size }}>{sg.t}</Text>
              {sg.u ? <Text style={[styles.lcdUnit, { fontSize: unitSize }]}> {sg.u}</Text> : null}
            </Text>
          ))}
        </Text>
      </View>
      <View style={styles.lcdRow}>
        <Text style={[styles.info, v.isError && styles.lcdError]} numberOfLines={1}>
          {v.info || ' '}
        </Text>
        <Text style={styles.extra} numberOfLines={1}>
          {v.extra}
        </Text>
      </View>
    </View>
  );
}

// ---------- keys ----------

function CalcKey({
  def,
  armed,
  onPress,
  compact,
}: {
  def: KeyDef;
  armed: boolean;
  onPress: () => void;
  compact?: boolean;
}) {
  const c = KEY_COLORS[def.kind];
  const fontSize = def.kind === 'num' ? 28 : def.label.length <= 2 ? 26 : def.label.length <= 4 ? 18 : 15;
  return (
    <View style={[styles.keyWrap, { flex: def.flex ?? 1 }]}>
      {!compact && (
        <Text style={[styles.sub, armed && def.sub ? styles.subArmed : null]} numberOfLines={1} maxFontSizeMultiplier={1}>
          {def.sub ?? ' '}
        </Text>
      )}
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={def.k === 'back' ? 'Backspace' : def.label}
        style={({ pressed }) => [
          styles.key,
          { backgroundColor: c.bg, opacity: pressed ? 0.55 : 1 },
          def.kind === 'conv' && armed ? styles.convArmed : null,
        ]}
      >
        <Text style={[styles.keyText, { color: c.fg, fontSize }]} numberOfLines={1} maxFontSizeMultiplier={1.15}>
          {def.label}
        </Text>
      </Pressable>
    </View>
  );
}

// ---------- pop-ups ----------

function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Pressable onPress={onClose} style={styles.closeBtn} accessibilityRole="button">
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.sheetBody}>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function TapeModal({ visible, state, onClose }: { visible: boolean; state: CalcState; onClose: () => void }) {
  return (
    <Sheet visible={visible} title="Tape" onClose={onClose}>
      {state.tape.length === 0 ? (
        <Text style={styles.para}>Nothing yet. Your entries and answers show up here.</Text>
      ) : (
        state.tape.map((line, i) => (
          <View key={i} style={[styles.tapeRow, line.tag === 'TTL=' && styles.tapeTotal]}>
            <Text style={styles.tapeTag}>{line.tag}</Text>
            <Text style={styles.tapeText}>{line.text}</Text>
          </View>
        ))
      )}
    </Sheet>
  );
}

function Choice<T extends string | number>({
  title,
  value,
  options,
  onPick,
}: {
  title: string;
  value: T;
  options: [T, string][];
  onPick: (v: T) => void;
}) {
  return (
    <View style={styles.prefBlock}>
      <Text style={styles.prefTitle}>{title}</Text>
      <View style={styles.chips}>
        {options.map(([val, label]) => (
          <Pressable
            key={String(val)}
            onPress={() => onPick(val)}
            accessibilityRole="button"
            accessibilityState={{ selected: val === value }}
            style={[styles.chip, val === value && styles.chipOn]}
          >
            <Text style={[styles.chipText, val === value && styles.chipTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function PrefsModal({
  visible,
  state,
  onChange,
  onClose,
}: {
  visible: boolean;
  state: CalcState;
  onChange: (p: Prefs) => void;
  onClose: () => void;
}) {
  const p = state.prefs;
  const set = <K extends keyof Prefs>(k: K, val: Prefs[K]) => onChange({ ...p, [k]: val });
  const s = state.stored;
  const inches = (n: number) => {
    const whole = Math.floor(n);
    const sixteenths = Math.round((n - whole) * 16);
    return sixteenths ? `${whole} ${sixteenths / gcd(sixteenths, 16)}/${16 / gcd(sixteenths, 16)}"` : `${whole}"`;
  };
  return (
    <Sheet visible={visible} title="Preferences" onClose={onClose}>
      <Choice title="Round fractions to" value={p.denom} options={DENOMS.map((d) => [d, `1/${d}"`])} onPick={(d) => set('denom', d)} />
      <Choice
        title="Area answers"
        value={p.area}
        options={[['std', 'Standard'], ['sqft', 'Sq Feet'], ['sqyd', 'Sq Yards'], ['sqm', 'Sq Meters']]}
        onPick={(v) => set('area', v)}
      />
      <Choice
        title="Volume answers"
        value={p.volume}
        options={[['std', 'Standard'], ['cuyd', 'Cu Yards'], ['cuft', 'Cu Feet'], ['cum', 'Cu Meters']]}
        onPick={(v) => set('volume', v)}
      />
      <Choice title="Meters" value={p.meters} options={[['fixed', '0.000'], ['float', 'All digits']]} onPick={(v) => set('meters', v)} />
      <Choice title="Degrees" value={p.degrees} options={[['fixed', '0.00°'], ['float', 'All digits']]} onPick={(v) => set('degrees', v)} />
      <Choice
        title="Fractions"
        value={p.fracMode}
        options={[['std', 'Reduced (1/2)'], ['const', 'Always 16ths (8/16)']]}
        onPick={(v) => set('fracMode', v)}
      />
      <Text style={styles.prefTitle}>Stored values</Text>
      <Text style={styles.para}>
        Riser height {inches(s.riserHt)} · Tread width {inches(s.treadW)} · On-center {inches(s.oc)} · Weight per volume{' '}
        {s.wtVol.value} {s.wtVol.fmt.replace('/', ' per ')}
      </Text>
      <Text style={styles.para}>
        Change these with Conv: type a size then Conv 7 (riser), Conv 9 (tread), Conv 5 (on-center), or Conv 0 (weight per volume).
        Conv × (Clear All) puts them back to 7 1/2", 10", 16" and 1.5 tons per cubic yard.
      </Text>
    </Sheet>
  );
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

const GUIDE: [string, string][] = [
  ['Typing measurements', '12 Feet 6 Inch 3 / 4 enters 12\' 6-3/4". Enter feet, then inches, then the fraction. A fraction by itself is inches (3/4 = 3/4"). Leave off the bottom number and it uses 16ths (3/ = 3/16").'],
  ['Square and cubic', 'Press a unit key two or three times: 130 Feet Feet = 130 sq ft, 5 Yds Yds Yds = 5 cu yd, 33 m m = 33 sq m.'],
  ['Math with dimensions', 'Feet × Feet gives square feet, × another length gives cubic yards (the line under the answer shows cubic feet). Length ÷ length gives a plain number.'],
  ['Converting', 'Conv then a unit key: Conv Yds, Conv Inch, Conv m, Conv cm, Conv mm. Conv Feet switches between feet-inches and decimal feet; Conv Inch between fractional and decimal inches. Works for square and cubic too.'],
  ['Percent', '2.78 Yds Yds Yds + 10 % adds 10% waste. 1575 × 25 % = 393.75.'],
  ['Right triangles & rafters', 'Enter any two of Pitch, Rise, Run, Diag (type the value, then press the key), then press the one you want. Pitch can be 9 Inch (9/12), 30 (degrees), 75 % (grade), or 0.75 Conv Pitch (ratio). Press Pitch again to see it in other forms.'],
  ['Hip/valley & jacks', 'After Pitch and Run: Hip/V gives the hip/valley length (again: its angle). Jack shows the spacing, then each jack rafter, longest first. For an irregular hip, type the other pitch and press Conv Hip/V, then Hip/V and Conv Jack.'],
  ['Rake wall', 'Enter Rise and Run (or Pitch and Run), then press R/Wall over and over: spacing, each stud, base, and wall angle. Type a base height before R/Wall to add it to every stud.'],
  ['Stairs', 'Enter the floor-to-floor Rise (and the Run if you have one), then keep pressing Stair: riser height, number of risers, over/under, tread width, treads, stringer, angle. Default target riser is 7 1/2" (change: 8 Inch Conv 7) and tread 10" (change: 11 Inch Conv 9).'],
  ['Circles', 'Type the diameter and press Circ, then Circ again for area and again for circumference. Arc: after Circ, type an arc length (or angle) and press Conv Circ.'],
  ['Board feet & cost', '2 × 4 × 16 Bd Ft = 10.67 board feet (inches × inches × feet). Cost: quantity × price, then Conv • (Cost). Board feet are priced per 1,000.'],
  ['Weight', 'With a volume showing, press Weight for tons, again for pounds, metric tons and kilograms. Default 1.5 tons per cubic yard; change it with a number then Conv 0, and press 0 again to switch its units.'],
  ['Memory', 'M+ adds the display, Conv M+ subtracts. Rcl M+ shows the total (M+ again: average, then count). Rcl Rcl shows the total and clears memory.'],
  ['Fractions', 'Conv 1 / 2 / 3 / 4 / 6 / 8 shows the answer in 16ths / halves / 32nds / quarters / 64ths / 8ths. Prefs sets the normal rounding.'],
  ['Clearing', 'On/C once clears what you typed; twice clears stored rise/run (your pitch stays). Conv × (Clear All) clears everything including memory and stored values.'],
  ['Other Conv keys', 'Conv ÷ = 1/x · Conv − = +/− · Conv + = π · Conv √x = x² · Rcl or Conv = opens the tape · Conv % opens Prefs.'],
];

function GuideModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Sheet visible={visible} title="How to use" onClose={onClose}>
      {GUIDE.map(([title, body]) => (
        <View key={title} style={styles.guideItem}>
          <Text style={styles.guideTitle}>{title}</Text>
          <Text style={styles.para}>{body}</Text>
        </View>
      ))}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 5, paddingTop: 6 },

  lcd: {
    backgroundColor: colors.lcd,
    borderWidth: 3,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginHorizontal: 3,
  },
  lcdRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 20 },
  flags: { fontSize: 14, fontWeight: '900', color: colors.text, marginRight: 8 },
  pending: { fontSize: 15, fontWeight: '700', color: colors.subtext, flexShrink: 1, textAlign: 'right' },
  lcdMain: { flexDirection: 'row', alignItems: 'center', minHeight: 54 },
  lcdLabel: { fontSize: 17, fontWeight: '900', color: colors.text, marginRight: 6, maxWidth: 82 },
  lcdValue: { flex: 1, textAlign: 'right', color: colors.text, fontWeight: '800', fontVariant: ['tabular-nums'] },
  lcdUnit: { fontWeight: '900' },
  lcdError: { color: colors.error },
  info: { fontSize: 14, fontWeight: '700', color: colors.subtext, flexShrink: 1, marginRight: 8 },
  extra: { fontSize: 14, fontWeight: '800', color: colors.text, flexShrink: 1, textAlign: 'right' },

  topRow: { flexDirection: 'row', height: 46, marginTop: 4 },
  pad: { flex: 1, paddingBottom: 2 },
  row: { flex: 1, flexDirection: 'row' },
  keyWrap: { paddingHorizontal: 3, paddingBottom: 3 },
  sub: { fontSize: 11, fontWeight: '800', color: colors.subLabel, textAlign: 'center', height: 14, borderRadius: 4, overflow: 'hidden' },
  subArmed: { backgroundColor: colors.convKey, color: colors.text },
  key: { flex: 1, borderRadius: 9, alignItems: 'center', justifyContent: 'center', minHeight: 34 },
  convArmed: { borderWidth: 4, borderColor: colors.text },
  keyText: { fontWeight: '800' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '88%' },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
  },
  sheetTitle: { fontSize: 24, fontWeight: '900', color: colors.text },
  closeBtn: { backgroundColor: colors.text, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10 },
  closeText: { color: colors.bg, fontSize: 18, fontWeight: '800' },
  sheetBody: { padding: 14, paddingBottom: 40 },
  para: { fontSize: 17, color: colors.text, lineHeight: 24 },
  guideItem: { marginBottom: 14 },
  guideTitle: { fontSize: 19, fontWeight: '900', color: colors.text, marginBottom: 2 },
  tapeRow: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#DDD' },
  tapeTotal: { backgroundColor: colors.panel },
  tapeTag: { width: 64, fontSize: 18, fontWeight: '900', color: colors.subtext },
  tapeText: { flex: 1, fontSize: 20, fontWeight: '800', color: colors.text, textAlign: 'right' },
  prefBlock: { marginBottom: 14 },
  prefTitle: { fontSize: 18, fontWeight: '900', color: colors.text, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginRight: 8,
    marginBottom: 8,
  },
  chipOn: { backgroundColor: colors.convKey },
  chipText: { fontSize: 17, fontWeight: '700', color: colors.text },
  chipTextOn: { fontWeight: '900' },
});
