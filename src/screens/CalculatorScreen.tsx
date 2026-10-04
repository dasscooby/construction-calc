import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useReducer, useRef, useState } from 'react';
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
import { calcHistory, newTapeLines, useCalcHistory } from '../lib/calcHistory';
import { dayLabel, timeLabel } from '../lib/history';
import { DENOMS } from '../lib/units';
import GoofyForeman, { ERRORS_FOR_FOREMAN } from './GoofyForeman';
import { colors, onThemeChange, themed } from '../theme';

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
  { k: 'tape', label: 'History', kind: 'util' },
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

/** Key colors, read fresh each time (they follow the theme). */
const keyColors = (kind: KeyKind): { bg: string; fg: string } =>
  ({
    fn: { bg: colors.fnKey, fg: colors.fnKeyText },
    num: { bg: colors.numKey, fg: colors.numKeyText },
    op: { bg: colors.opKey, fg: colors.opKeyText },
    conv: { bg: colors.lightKey, fg: colors.lightKeyText },
    clear: { bg: colors.lightKey, fg: colors.lightKeyText },
    util: { bg: colors.lightKey, fg: colors.lightKeyText },
  })[kind];

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

  // Everything that goes on the tape is also saved to History (kept across days).
  const tapeSeen = useRef(0);
  useEffect(() => {
    if (state.tapeCount < tapeSeen.current) tapeSeen.current = 0; // calculator was reset on startup
    calcHistory.add(newTapeLines(state.tape, state.tapeCount, tapeSeen.current));
    tapeSeen.current = state.tapeCount;
  }, [state.tapeCount]);

  // Rcl = / Conv = open the tape; Conv % opens preferences.
  useEffect(() => {
    if (state.ui) setModal(state.ui);
  }, [state.ui]);

  const v = view(state);
  const armed = state.prefix === 'conv';

  // Easter egg: every third error brings out the foreman.
  const [errors, setErrors] = useState(0);
  const [foreman, setForeman] = useState(false);
  const wasError = useRef(false);
  useEffect(() => {
    if (v.isError && !wasError.current) {
      const n = errors + 1;
      if (n >= ERRORS_FOR_FOREMAN) {
        setForeman(true);
        setErrors(0);
      } else setErrors(n);
    }
    wasError.current = v.isError;
  }, [v.isError]);

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

      <TapeModal visible={modal === 'tape'} onClose={() => setModal(null)} />
      <PrefsModal
        visible={modal === 'prefs'}
        state={state}
        onChange={(prefs) => dispatch({ type: 'prefs', prefs })}
        onClose={() => setModal(null)}
      />
      <GuideModal visible={modal === 'guide'} onClose={() => setModal(null)} />
      <GoofyForeman visible={foreman} onClose={() => setForeman(false)} />
    </View>
  );
}

// ---------- display ----------

function Lcd({ v }: { v: CalcView }) {
  const len = v.text.length;
  const size = len <= 9 ? 58 : len <= 13 ? 47 : len <= 17 ? 38 : len <= 21 ? 31 : 25;
  const unitSize = Math.max(13, Math.round(size * 0.36));
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
  const c = keyColors(def.kind);
  const lit = def.kind === 'conv' && armed; // Conv turns white with orange text, like a picked operator
  const fontSize = def.kind === 'num' ? 30 : def.label.length <= 2 ? 26 : def.label.length <= 4 ? 18 : 15;
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
          { backgroundColor: lit ? colors.text : c.bg, opacity: pressed ? 0.6 : 1 },
        ]}
      >
        <Text style={[styles.keyText, { color: lit ? colors.opKey : c.fg, fontSize }, def.kind === 'num' && styles.numText]} numberOfLines={1} maxFontSizeMultiplier={1.15}>
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

/** The tape, kept by day. Newest day first, lines in the order they were entered. */
function TapeModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const lines = useCalcHistory();
  const [confirm, setConfirm] = useState(false);
  const days: { label: string; lines: typeof lines }[] = [];
  for (const line of lines) {
    const label = dayLabel(line.at);
    if (days[days.length - 1]?.label !== label) days.push({ label, lines: [] });
    days[days.length - 1].lines.push(line);
  }
  days.reverse();
  return (
    <Sheet visible={visible} title="History" onClose={onClose}>
      {lines.length === 0 ? (
        <Text style={styles.para}>Nothing yet. Your entries and answers show up here and stay saved.</Text>
      ) : (
        days.map((d) => (
          <View key={d.label}>
            <Text style={styles.tapeDay}>{d.label}</Text>
            {d.lines.map((line, i) => (
              <View key={i} style={[styles.tapeRow, line.tag === 'TTL=' && styles.tapeTotal]}>
                <Text style={styles.tapeTag}>{line.tag}</Text>
                <Text style={styles.tapeText}>{line.text}</Text>
                {line.tag === 'TTL=' ? <Text style={styles.tapeTime}>{timeLabel(line.at)}</Text> : null}
              </View>
            ))}
          </View>
        ))
      )}
      {lines.length > 0 &&
        (confirm ? (
          <View style={styles.tapeConfirm}>
            <Pressable onPress={() => setConfirm(false)} style={styles.tapeBtn} accessibilityRole="button">
              <Text style={styles.tapeBtnText}>Keep it</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                calcHistory.clear();
                setConfirm(false);
              }}
              style={styles.tapeBtn}
              accessibilityRole="button"
            >
              <Text style={[styles.tapeBtnText, styles.tapeDanger]}>Delete all</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => setConfirm(true)} style={styles.tapeBtn} accessibilityRole="button">
            <Text style={[styles.tapeBtnText, styles.tapeDanger]}>Clear history</Text>
          </Pressable>
        ))}
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

const getStyles = themed(() => ({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 6, paddingTop: 4 },

  lcd: { backgroundColor: colors.lcd, paddingHorizontal: 12, paddingTop: 2, paddingBottom: 4 },
  lcdRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 20 },
  flags: { fontSize: 13, fontWeight: '800', color: colors.accent, marginRight: 8, letterSpacing: 1 },
  pending: { fontSize: 16, fontWeight: '400', color: colors.subtext, flexShrink: 1, textAlign: 'right' },
  lcdMain: { flexDirection: 'row', alignItems: 'flex-end', minHeight: 66 },
  lcdLabel: { fontSize: 15, fontWeight: '700', color: colors.accent, marginRight: 6, marginBottom: 10, maxWidth: 82 },
  lcdValue: { flex: 1, textAlign: 'right', color: colors.text, fontWeight: '300', fontVariant: ['tabular-nums'] },
  lcdUnit: { fontWeight: '500', color: colors.subtext },
  lcdError: { color: colors.error },
  info: { fontSize: 14, fontWeight: '500', color: colors.subtext, flexShrink: 1, marginRight: 8 },
  extra: { fontSize: 14, fontWeight: '600', color: colors.text, flexShrink: 1, textAlign: 'right' },

  topRow: { flexDirection: 'row', height: 46, marginTop: 4 },
  pad: { flex: 1, paddingBottom: 4 },
  row: { flex: 1, flexDirection: 'row' },
  keyWrap: { paddingHorizontal: 4, paddingBottom: 4 },
  sub: { fontSize: 11, fontWeight: '700', color: colors.subLabel, textAlign: 'center', height: 14, borderRadius: 7, overflow: 'hidden' },
  subArmed: { backgroundColor: colors.accent, color: colors.accentText },
  key: { flex: 1, borderRadius: 999, alignItems: 'center', justifyContent: 'center', minHeight: 34 },
  keyText: { fontWeight: '600' },
  numText: { fontWeight: '500' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.panel, borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: '88%' },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sheetTitle: { fontSize: 24, fontWeight: '800', color: colors.text },
  closeBtn: { backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 9 },
  closeText: { color: colors.accentText, fontSize: 17, fontWeight: '700' },
  sheetBody: { padding: 14, paddingBottom: 40 },
  para: { fontSize: 17, color: colors.text, lineHeight: 24 },
  guideItem: { marginBottom: 14 },
  guideTitle: { fontSize: 18, fontWeight: '800', color: colors.accent, marginBottom: 2 },
  tapeRow: { flexDirection: 'row', paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  tapeTotal: { backgroundColor: colors.panel2 },
  tapeTag: { width: 64, fontSize: 17, fontWeight: '700', color: colors.accent },
  tapeText: { flex: 1, fontSize: 20, fontWeight: '500', color: colors.text, textAlign: 'right' },
  tapeTime: { width: 72, fontSize: 13, color: colors.subtext, textAlign: 'right', alignSelf: 'center' },
  tapeDay: { fontSize: 14, fontWeight: '700', color: colors.subtext, marginTop: 14, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.6 },
  tapeConfirm: { flexDirection: 'row', gap: 10 },
  tapeBtn: { flex: 1, backgroundColor: colors.panel2, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  tapeBtnText: { fontSize: 17, fontWeight: '700', color: colors.accent },
  tapeDanger: { color: colors.danger },
  prefBlock: { marginBottom: 14 },
  prefTitle: { fontSize: 17, fontWeight: '700', color: colors.subtext, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { backgroundColor: colors.panel2, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, marginRight: 8, marginBottom: 8 },
  chipOn: { backgroundColor: colors.accent },
  chipText: { fontSize: 17, fontWeight: '600', color: colors.text },
  chipTextOn: { color: colors.accentText, fontWeight: '800' },
}), { scaleText: false });

// Rebuilt when the colors or text size change in Settings.
let styles = getStyles();
onThemeChange(() => {
  styles = getStyles();
});
