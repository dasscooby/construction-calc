import { useMemo } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { RawArea, RawBarRow, RawLength, RawValue, RawValues, RunResult, defaultRaw, runTool } from '../tools/run';
import { BarListField, Field, Tool } from '../tools/types';
import { colors } from '../theme';

// iPhone keyboard with numbers plus space, "/", "-" and "." so 6 1/2 and -0.35 can be typed.
const NUM_KEYBOARD = Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default';

interface Props {
  tool: Tool;
  raw: RawValues;
  onChange: (raw: RawValues) => void;
  onBack: () => void;
}

export default function ToolScreen({ tool, raw, onChange, onBack }: Props) {
  const result = useMemo(() => runTool(tool, raw), [tool, raw]);
  const set = (key: string, value: RawValue) => onChange({ ...raw, [key]: value });
  const clear = () => {
    onChange(defaultRaw(tool));
    Keyboard.dismiss();
  };

  const main = result.status === 'ok' ? result.result.rows.filter((r) => r.big).slice(0, 2) : [];
  const hasInches = tool.fields.some((f) => f.kind === 'length' || f.kind === 'areas' || f.kind === 'barlist');
  const titleSize = tool.title.length > 22 ? 16 : tool.title.length > 16 ? 18 : 22;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.back} accessibilityRole="button" accessibilityLabel="Back">
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <Text style={[styles.title, { fontSize: titleSize }]} numberOfLines={1}>
          {tool.title}
        </Text>
        <Pressable onPress={clear} style={styles.clearBtn} accessibilityRole="button">
          <Text style={styles.clearText}>Clear</Text>
        </Pressable>
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {tool.fields.map((f) => (
          <FieldInput key={f.key} field={f} value={raw[f.key]} onChange={(v) => set(f.key, v)} />
        ))}
        {hasInches && <Text style={styles.hint}>Inches can be 6, 6.5, or 6 1/2</Text>}
        <Results result={result} />
        {tool.notes?.map((n, i) => (
          <Text key={i} style={styles.note}>
            • {n}
          </Text>
        ))}
      </ScrollView>

      {/* Main answer stays in view while typing */}
      <View style={styles.footer}>
        {main.length ? (
          main.map((r) => (
            <View key={r.label} style={styles.footerItem}>
              <Text style={styles.footerLabel} numberOfLines={1}>
                {r.label}
              </Text>
              <Text style={styles.footerValue} numberOfLines={1} adjustsFontSizeToFit>
                {r.value}
              </Text>
            </View>
          ))
        ) : (
          <Text style={styles.footerMsg} numberOfLines={2}>
            {result.status === 'ok' ? 'See results above' : result.message}
          </Text>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function Results({ result }: { result: RunResult }) {
  if (result.status !== 'ok') {
    return (
      <View style={styles.results}>
        <Text style={[styles.empty, result.status === 'invalid' && styles.errorText]}>{result.message}</Text>
      </View>
    );
  }
  const { rows, warnings } = result.result;
  return (
    <>
      {warnings?.map((w, i) => (
        <View key={i} style={styles.warning}>
          <Text style={styles.warningText}>⚠ {w}</Text>
        </View>
      ))}
      <View style={styles.results}>
        {rows.map((r, i) => (
          <View key={`${r.label}-${i}`} style={styles.resultRow}>
            <View style={styles.resultLine}>
              <Text style={[styles.resultLabel, r.big && styles.bigLabel]}>{r.label}</Text>
              <Text style={[styles.resultValue, r.big && styles.bigValue]}>{r.value}</Text>
            </View>
            {r.note ? <Text style={styles.resultNote}>{r.note}</Text> : null}
          </View>
        ))}
      </View>
    </>
  );
}

function FieldInput({ field, value, onChange }: { field: Field; value: RawValue; onChange: (v: RawValue) => void }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {field.label}
        {field.optional ? <Text style={styles.optional}>  optional</Text> : null}
      </Text>
      {field.help ? <Text style={styles.help}>{field.help}</Text> : null}
      {field.kind === 'length' && <LengthInput value={value as RawLength} onChange={onChange} label={field.label} />}
      {field.kind === 'number' && (
        <View style={styles.inputRow}>
          <Box value={value as string} onChange={onChange} keyboard={NUM_KEYBOARD} label={field.label} />
          <Text style={styles.unit} numberOfLines={2}>
            {field.unit ?? ''}
          </Text>
        </View>
      )}
      {field.kind === 'count' && (
        <View style={styles.inputRow}>
          <Box value={value as string} onChange={onChange} keyboard="number-pad" label={field.label} />
          <View style={styles.unitSpacer} />
        </View>
      )}
      {field.kind === 'choice' && (
        <View style={styles.chips}>
          {field.options.map((o) => {
            const on = o.value === value;
            return (
              <Pressable
                key={o.value}
                onPress={() => onChange(o.value)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={[styles.chip, on && styles.chipOn]}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
      {field.kind === 'areas' && <AreasInput value={value as RawArea[]} onChange={onChange} />}
      {field.kind === 'barlist' && <BarListInput field={field} value={value as RawBarRow[]} onChange={onChange} />}
    </View>
  );
}

function Box({
  value,
  onChange,
  keyboard,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  keyboard: 'numbers-and-punctuation' | 'number-pad' | 'default';
  label: string;
}) {
  return (
    <TextInput
      style={styles.input}
      value={value}
      onChangeText={onChange}
      keyboardType={keyboard}
      returnKeyType="done"
      placeholder="0"
      placeholderTextColor="#888"
      accessibilityLabel={label}
      autoCorrect={false}
    />
  );
}

function LengthInput({ value, onChange, label }: { value: RawLength; onChange: (v: RawLength) => void; label: string }) {
  return (
    <View style={styles.inputRow}>
      <Box value={value.ft} onChange={(ft) => onChange({ ...value, ft })} keyboard={NUM_KEYBOARD} label={`${label} feet`} />
      <Text style={styles.unit}>ft</Text>
      <Box value={value.in} onChange={(inch) => onChange({ ...value, in: inch })} keyboard={NUM_KEYBOARD} label={`${label} inches`} />
      <Text style={styles.unit}>in</Text>
    </View>
  );
}

const emptyLength = (): RawLength => ({ ft: '', in: '' });

function AreasInput({ value, onChange }: { value: RawArea[]; onChange: (v: RawArea[]) => void }) {
  const update = (i: number, patch: Partial<RawArea>) => onChange(value.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  return (
    <View>
      {value.map((a, i) => (
        <View key={i} style={styles.area}>
          <View style={styles.areaHead}>
            <Text style={styles.areaTitle}>{value.length > 1 ? `Area ${i + 1}` : 'Length'}</Text>
            {value.length > 1 && (
              <Pressable
                onPress={() => onChange(value.filter((_, j) => j !== i))}
                style={styles.removeBtn}
                accessibilityRole="button"
                accessibilityLabel={`Remove area ${i + 1}`}
              >
                <Text style={styles.removeText}>Remove</Text>
              </Pressable>
            )}
          </View>
          {value.length > 1 && <Text style={styles.areaSub}>Length</Text>}
          <LengthInput value={a.length} onChange={(length) => update(i, { length })} label={`Area ${i + 1} length`} />
          <Text style={styles.areaSub}>Width</Text>
          <LengthInput value={a.width} onChange={(width) => update(i, { width })} label={`Area ${i + 1} width`} />
        </View>
      ))}
      <Pressable
        onPress={() => onChange([...value, { length: emptyLength(), width: emptyLength() }])}
        style={styles.addBtn}
        accessibilityRole="button"
      >
        <Text style={styles.addText}>+ Add another area</Text>
      </Pressable>
    </View>
  );
}

function BarListInput({ field, value, onChange }: { field: BarListField; value: RawBarRow[]; onChange: (v: RawBarRow[]) => void }) {
  const update = (i: number, patch: Partial<RawBarRow>) => onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => onChange([...value, { size: value[value.length - 1]?.size ?? field.defaultSize, qty: '', length: emptyLength() }]);
  return (
    <View>
      {value.map((r, i) => (
        <View key={i} style={styles.area}>
          <View style={styles.areaHead}>
            <Text style={styles.areaTitle}>Mark {i + 1}</Text>
            {value.length > 1 && (
              <Pressable
                onPress={() => onChange(value.filter((_, j) => j !== i))}
                style={styles.removeBtn}
                accessibilityRole="button"
                accessibilityLabel={`Remove mark ${i + 1}`}
              >
                <Text style={styles.removeText}>Remove</Text>
              </Pressable>
            )}
          </View>
          <View style={styles.chips}>
            {field.sizes.map((size) => {
              const on = size === r.size;
              return (
                <Pressable
                  key={size}
                  onPress={() => update(i, { size })}
                  accessibilityRole="button"
                  accessibilityLabel={`Mark ${i + 1} #${size}`}
                  accessibilityState={{ selected: on }}
                  style={[styles.chip, styles.chipSmall, on && styles.chipOn]}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>#{size}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.areaSub}>How many</Text>
          <View style={styles.inputRow}>
            <Box value={r.qty} onChange={(qty) => update(i, { qty })} keyboard="number-pad" label={`Mark ${i + 1} how many`} />
            <View style={styles.unitSpacer} />
          </View>
          <Text style={styles.areaSub}>Cut length</Text>
          <LengthInput value={r.length} onChange={(length) => update(i, { length })} label={`Mark ${i + 1} length`} />
        </View>
      ))}
      <Pressable onPress={add} style={styles.addBtn} accessibilityRole="button">
        <Text style={styles.addText}>+ Add another bar mark</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  back: { paddingVertical: 10, paddingHorizontal: 8 },
  backText: { fontSize: 20, fontWeight: '800', color: colors.opKey },
  title: { flex: 1, fontSize: 22, fontWeight: '900', color: colors.text, textAlign: 'center', marginHorizontal: 4 },
  clearBtn: { backgroundColor: colors.clearKey, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  clearText: { color: colors.lightText, fontSize: 18, fontWeight: '800' },
  content: { padding: 14, paddingBottom: 30 },

  field: { marginBottom: 14 },
  label: { fontSize: 19, fontWeight: '800', color: colors.text, marginBottom: 4 },
  optional: { fontSize: 14, fontWeight: '600', color: colors.subtext },
  help: { fontSize: 15, color: colors.subtext, marginBottom: 6 },
  inputRow: { flexDirection: 'row', alignItems: 'center' },
  input: {
    flex: 1,
    minWidth: 0,
    width: 0,
    height: 56,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    backgroundColor: colors.bg,
  },
  unit: { fontSize: 17, fontWeight: '700', color: colors.text, width: 66, paddingLeft: 8 },
  unitSpacer: { width: 66 },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: colors.bg,
  },
  chipSmall: { paddingHorizontal: 11, paddingVertical: 8, marginRight: 6, marginBottom: 6 },
  chipOn: { backgroundColor: colors.convKey },
  chipText: { fontSize: 18, fontWeight: '700', color: colors.text },
  chipTextOn: { fontWeight: '900' },

  area: { borderWidth: 2, borderColor: '#BBB', borderRadius: 10, padding: 10, marginBottom: 8 },
  areaHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  areaTitle: { fontSize: 17, fontWeight: '800', color: colors.text, marginBottom: 4 },
  areaSub: { fontSize: 17, fontWeight: '800', color: colors.text, marginTop: 8, marginBottom: 4 },
  removeBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 2, borderColor: colors.clearKey },
  removeText: { color: colors.clearKey, fontWeight: '800', fontSize: 15 },
  addBtn: { borderWidth: 2, borderColor: colors.border, borderStyle: 'dashed', borderRadius: 10, padding: 12, alignItems: 'center' },
  addText: { fontSize: 18, fontWeight: '800', color: colors.text },

  hint: { fontSize: 15, color: colors.subtext, marginBottom: 10 },
  warning: { backgroundColor: '#FFF3C4', borderWidth: 2, borderColor: '#B7791F', borderRadius: 10, padding: 10, marginBottom: 10 },
  warningText: { fontSize: 17, fontWeight: '700', color: colors.text },
  results: {
    backgroundColor: colors.panel,
    borderWidth: 3,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  resultRow: { paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#D6D6D6' },
  resultLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  resultLabel: { fontSize: 18, fontWeight: '600', color: colors.text, flexShrink: 1, marginRight: 10 },
  resultValue: { fontSize: 21, fontWeight: '800', color: colors.text, textAlign: 'right', flexShrink: 0, maxWidth: '64%' },
  bigLabel: { fontSize: 20, fontWeight: '900' },
  bigValue: { fontSize: 30 },
  resultNote: { fontSize: 15, color: colors.subtext, marginTop: 2 },
  empty: { fontSize: 19, fontWeight: '700', color: colors.text, textAlign: 'center', paddingVertical: 14 },
  errorText: { color: colors.error },
  note: { fontSize: 15, color: colors.subtext, marginBottom: 6, lineHeight: 21 },

  footer: {
    flexDirection: 'row',
    borderTopWidth: 3,
    borderTopColor: colors.border,
    backgroundColor: colors.lcd,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 62,
    alignItems: 'center',
  },
  footerItem: { flex: 1, marginHorizontal: 4 },
  footerLabel: { fontSize: 14, fontWeight: '800', color: colors.subtext },
  footerValue: { fontSize: 26, fontWeight: '900', color: colors.text },
  footerMsg: { flex: 1, fontSize: 17, fontWeight: '700', color: colors.text, textAlign: 'center' },
});
