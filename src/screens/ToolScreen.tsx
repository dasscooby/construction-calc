import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  isShown,
  RawArea,
  RawBarRow,
  RawLength,
  RawStockRow,
  RawValue,
  RawValues,
  RawWallRow,
  RunResult,
  WALL_ENDS,
  defaultRaw,
  runTool,
} from '../tools/run';
import { feel } from '../lib/feel';
import { history } from '../lib/history';
import { jobStore, useJobs } from '../lib/jobs';
import { companyLine, userDefaults, useSettings } from '../lib/settings';
import { shareText } from '../tools/share';
import { BarListField, Field, Tool } from '../tools/types';
import { colors, onThemeChange, themed } from '../theme';
import type { JobLink } from './ToolsTab';

const SHARE_LABEL = Platform.OS === 'ios' ? 'Share or save to Notes' : 'Share these numbers';

// iPhone keyboard with numbers plus space, "/", "-" and "." so 6 1/2 and -0.35 can be typed.
const NUM_KEYBOARD = Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default';

interface Props {
  tool: Tool;
  raw: RawValues;
  onChange: (raw: RawValues) => void;
  onBack: () => void;
  /** This tab is showing (the Android back button only acts on the tab you're looking at) */
  active: boolean;
  /** Opened from a job (or just added to one): changes can be saved back to it */
  jobLink?: JobLink;
  onJobLink: (link: JobLink | undefined) => void;
}

export default function ToolScreen({ tool, raw, onChange, onBack, active, jobLink, onJobLink }: Props) {
  const prefs = useSettings();
  const result = useMemo(() => runTool(tool, raw), [tool, raw]);
  const set = (key: string, value: RawValue) => onChange({ ...raw, [key]: value });
  const clear = () => {
    // Clear the job, keep what you own.
    const fresh = defaultRaw(tool, userDefaults(tool, prefs));
    for (const f of tool.fields) if (f.sticky) fresh[f.key] = raw[f.key];
    onChange(fresh);
    Keyboard.dismiss();
  };

  const main = result.status === 'ok' ? result.result.rows.filter((r) => r.big).slice(0, 2) : [];
  const text = shareText(tool, raw, result, companyLine(prefs));
  // Anything with an answer goes into History when you leave the tool or share it.
  const save = () => {
    if (!text) return;
    history.add({ toolId: tool.id, title: tool.title, raw, main: main.map((r) => ({ label: r.label, value: r.value })), text });
  };
  const back = () => {
    save();
    onBack();
  };
  const backRef = useRef(back);
  backRef.current = back;

  // Android back button/gesture: leave the tool (saving it) before leaving the app.
  useEffect(() => {
    if (!active) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      backRef.current();
      return true;
    });
    return () => sub.remove();
  }, [active]);
  const hasInches = tool.fields.some((f) => f.kind === 'length' || f.kind === 'areas' || f.kind === 'barlist' || f.kind === 'walls');
  const titleSize = tool.title.length > 22 ? 16 : tool.title.length > 16 ? 18 : 22;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <Pressable onPress={back} style={styles.back} accessibilityRole="button" accessibilityLabel="Back">
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
        {tool.fields
          .filter((f) => isShown(f, raw))
          .map((f) => (
            <FieldInput key={f.key} field={f} value={raw[f.key]} onChange={(v) => set(f.key, v)} />
          ))}
        {hasInches && <Text style={styles.hint}>Inches can be 6, 6.5, or 6 1/2</Text>}
        <Results result={result} />
        <ShareButton text={text} onShare={save} />
        {text ? <JobButtons tool={tool} raw={raw} title={tool.title} jobLink={jobLink} onJobLink={onJobLink} /> : null}
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

/** Opens the phone's share menu: text, email, or (iPhone) Apple Notes. On a computer with no share menu, copies instead. */
export function ShareButton({ text, onShare }: { text: string | null; onShare?: () => void }) {
  const [copied, setCopied] = useState(false);
  if (!text) return null;
  const share = async () => {
    onShare?.();
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (Platform.OS === 'web' && !nav?.share) {
      if (!nav?.clipboard) return;
      await nav.clipboard.writeText(text).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      return;
    }
    await Share.share({ message: text }).catch(() => {}); // closing the share menu isn't an error
  };
  return (
    <Pressable onPress={share} style={({ pressed }) => [styles.shareBtn, pressed && styles.sharePressed]} accessibilityRole="button">
      <Text style={styles.shareText}>{copied ? 'Copied ✓' : SHARE_LABEL}</Text>
    </Pressable>
  );
}

/** "Add to job", or "Save changes to <job>" when this tool was opened from a job. */
function JobButtons({
  tool,
  raw,
  title,
  jobLink,
  onJobLink,
}: {
  tool: Tool;
  raw: RawValues;
  title: string;
  jobLink?: JobLink;
  onJobLink: (link: JobLink | undefined) => void;
}) {
  const jobs = useJobs();
  const [picking, setPicking] = useState(false);
  const [newName, setNewName] = useState('');
  const [done, setDone] = useState('');
  const linkedJob = jobLink && jobs.find((j) => j.id === jobLink.jobId && j.items.some((it) => it.id === jobLink.itemId));
  const flash = (msg: string) => {
    setDone(msg);
    setTimeout(() => setDone(''), 2200);
  };
  const addTo = (jobId: string, name: string) => {
    jobStore.addItem(jobId, { toolId: tool.id, title, raw });
    feel.success();
    setPicking(false);
    setNewName('');
    flash(`Added to ${name} ✓`);
  };

  return (
    <View>
      {linkedJob ? (
        <Pressable
          onPress={() => {
            jobStore.editItem(linkedJob.id, jobLink!.itemId, { raw, toolId: tool.id, title: tool.title });
            feel.success();
            flash(`Saved to ${linkedJob.name} ✓`);
          }}
          style={({ pressed }) => [styles.shareBtn, pressed && styles.sharePressed]}
          accessibilityRole="button"
        >
          <Text style={styles.shareText}>{done || `Save changes to ${linkedJob.name}`}</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={() => setPicking(true)} style={({ pressed }) => [styles.shareBtn, pressed && styles.sharePressed]} accessibilityRole="button">
        <Text style={styles.shareText}>{!linkedJob && done ? done : linkedJob ? 'Add to another job' : 'Add to job'}</Text>
      </Pressable>

      <Modal visible={picking} transparent animationType="slide" onRequestClose={() => setPicking(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Add to job</Text>
              <Pressable onPress={() => setPicking(false)} style={styles.clearBtn} accessibilityRole="button">
                <Text style={styles.clearText}>Cancel</Text>
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetBody}>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  value={newName}
                  onChangeText={setNewName}
                  placeholder="New job name"
                  placeholderTextColor={colors.faint}
                  accessibilityLabel="New job name"
                  returnKeyType="done"
                />
                <Pressable
                  onPress={() => {
                    const name = newName.trim() || 'New job';
                    const id = jobStore.create(name);
                    addTo(id, name);
                  }}
                  style={styles.newJobBtn}
                  accessibilityRole="button"
                >
                  <Text style={styles.newJobText}>+ New</Text>
                </Pressable>
              </View>
              {jobs.map((j) => (
                <Pressable
                  key={j.id}
                  onPress={() => addTo(j.id, j.name)}
                  style={({ pressed }) => [styles.jobRow, pressed && styles.sharePressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`Add to ${j.name}`}
                >
                  <Text style={styles.jobName}>{j.name}</Text>
                  <Text style={styles.jobMeta}>{j.items.length} in it</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
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
  if (field.kind === 'toggle') {
    const on = value === '1';
    return (
      <Pressable
        onPress={() => {
          feel.tap();
          onChange(on ? '' : '1');
        }}
        style={[styles.toggleRow, on && styles.toggleRowOn]}
        accessibilityRole="switch"
        accessibilityState={{ checked: on }}
        accessibilityLabel={field.label}
      >
        <View style={styles.toggleText}>
          <Text style={styles.label}>{field.label}</Text>
          {field.help ? <Text style={styles.help}>{field.help}</Text> : null}
        </View>
        <Switch
          value={on}
          onValueChange={(v) => {
            feel.tap();
            onChange(v ? '1' : '');
          }}
          trackColor={{ true: colors.accent, false: colors.panel2 }}
          thumbColor="#FFFFFF"
          {...{ activeThumbColor: '#FFFFFF' }}
          accessibilityLabel={field.label}
        />
      </Pressable>
    );
  }
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
                onPress={() => {
                  if (o.value !== value) feel.tap();
                  onChange(o.value);
                }}
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
      {field.kind === 'multi' && (
        <View style={styles.chips}>
          {field.options.map((o) => {
            const picked = (value as string).split(',').filter(Boolean);
            const on = picked.includes(o.value);
            const toggle = () => onChange((on ? picked.filter((x) => x !== o.value) : [...picked, o.value]).join(','));
            return (
              <Pressable
                key={o.value}
                onPress={toggle}
                accessibilityRole="checkbox"
                accessibilityLabel={`${field.label} ${o.label}`}
                accessibilityState={{ checked: on }}
                style={[styles.chip, styles.chipSmall, on && styles.chipOn]}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
      {field.kind === 'areas' && <AreasInput value={value as RawArea[]} onChange={onChange} />}
      {field.kind === 'barlist' && <BarListInput field={field} value={value as RawBarRow[]} onChange={onChange} />}
      {field.kind === 'walls' && <WallsInput value={value as RawWallRow[]} onChange={onChange} />}
      {field.kind === 'stock' && <StockInput value={value as RawStockRow[]} onChange={onChange} label={field.label} />}
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
      placeholderTextColor={colors.faint}
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

const ENDS_LABEL: Record<RawWallRow['ends'], string> = { oo: 'Outside both ends', oi: 'Outside + inside', ii: 'Inside both ends' };

function WallsInput({ value, onChange }: { value: RawWallRow[]; onChange: (v: RawWallRow[]) => void }) {
  const update = (i: number, patch: Partial<RawWallRow>) => onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <View>
      {value.map((r, i) => (
        <View key={i} style={styles.area}>
          <View style={styles.areaHead}>
            <Text style={styles.areaTitle}>Wall {i + 1}</Text>
            {value.length > 1 && (
              <Pressable
                onPress={() => onChange(value.filter((_, j) => j !== i))}
                style={styles.removeBtn}
                accessibilityRole="button"
                accessibilityLabel={`Remove wall ${i + 1}`}
              >
                <Text style={styles.removeText}>Remove</Text>
              </Pressable>
            )}
          </View>
          <LengthInput value={r.length} onChange={(length) => update(i, { length })} label={`Wall ${i + 1} length`} />
          <Text style={styles.areaSub}>Corners at the ends</Text>
          <View style={styles.chips}>
            {WALL_ENDS.map((ends) => {
              const on = ends === r.ends;
              return (
                <Pressable
                  key={ends}
                  onPress={() => update(i, { ends })}
                  accessibilityRole="button"
                  accessibilityLabel={`Wall ${i + 1} ${ENDS_LABEL[ends]}`}
                  accessibilityState={{ selected: on }}
                  style={[styles.chip, styles.chipSmall, on && styles.chipOn]}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{ENDS_LABEL[ends]}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
      <Pressable
        onPress={() => onChange([...value, { length: emptyLength(), ends: value[value.length - 1]?.ends ?? 'oo' }])}
        style={styles.addBtn}
        accessibilityRole="button"
      >
        <Text style={styles.addText}>+ Add another wall</Text>
      </Pressable>
    </View>
  );
}

/** Size + how many rows, e.g. fillers you own. */
function StockInput({ value, onChange, label }: { value: RawStockRow[]; onChange: (v: RawStockRow[]) => void; label: string }) {
  const update = (i: number, patch: Partial<RawStockRow>) => onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <View>
      <View style={styles.stockHead}>
        <Text style={[styles.areaSub, styles.stockCol]}>Width (in)</Text>
        <Text style={[styles.areaSub, styles.stockCol]}>How many</Text>
        <View style={styles.stockRemove} />
      </View>
      {value.map((r, i) => (
        <View key={i} style={styles.stockRow}>
          <View style={styles.stockCol}>
            <Box value={r.size} onChange={(size) => update(i, { size })} keyboard={NUM_KEYBOARD} label={`${label} row ${i + 1} width`} />
          </View>
          <View style={styles.stockCol}>
            <TextInput
              style={styles.input}
              value={r.qty}
              onChangeText={(qty) => update(i, { qty })}
              keyboardType="number-pad"
              returnKeyType="done"
              placeholder="plenty"
              placeholderTextColor={colors.faint}
              accessibilityLabel={`${label} row ${i + 1} how many`}
            />
          </View>
          <Pressable
            onPress={() => onChange(value.filter((_, j) => j !== i))}
            style={styles.stockRemove}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${label} row ${i + 1}`}
          >
            <Text style={styles.removeText}>✕</Text>
          </Pressable>
        </View>
      ))}
      <Pressable onPress={() => onChange([...value, { size: '', qty: '' }])} style={styles.addBtn} accessibilityRole="button">
        <Text style={styles.addText}>+ Add a size</Text>
      </Pressable>
    </View>
  );
}

const hairline = StyleSheet.hairlineWidth;

const getStyles = themed(() => ({
  flex: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: hairline,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  back: { paddingVertical: 10, paddingHorizontal: 8 },
  backText: { fontSize: 19, fontWeight: '600', color: colors.accent },
  title: { flex: 1, fontSize: 22, fontWeight: '700', color: colors.text, textAlign: 'center', marginHorizontal: 4 },
  clearBtn: { backgroundColor: colors.panel2, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
  clearText: { color: colors.accent, fontSize: 17, fontWeight: '700' },
  content: { padding: 14, paddingBottom: 30 },

  field: { marginBottom: 16 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 16,
    marginTop: 4,
  },
  toggleRowOn: { borderWidth: 1, borderColor: colors.accent },
  toggleText: { flex: 1, marginRight: 10 },
  label: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 4 },
  optional: { fontSize: 13, fontWeight: '500', color: colors.subtext },
  help: { fontSize: 14, color: colors.subtext, marginBottom: 6 },
  inputRow: { flexDirection: 'row', alignItems: 'center' },
  input: {
    flex: 1,
    minWidth: 0,
    width: 0,
    height: 54,
    backgroundColor: colors.panel,
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    fontSize: 24,
    fontWeight: '500',
    color: colors.text,
  },
  unit: { fontSize: 16, fontWeight: '600', color: colors.subtext, width: 66, paddingLeft: 8 },
  unitSpacer: { width: 66 },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    backgroundColor: colors.panel,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginRight: 8,
    marginBottom: 8,
  },
  chipSmall: { paddingHorizontal: 13, paddingVertical: 8, marginRight: 6, marginBottom: 6 },
  chipOn: { backgroundColor: colors.accent },
  chipText: { fontSize: 17, fontWeight: '600', color: colors.text },
  chipTextOn: { color: colors.accentText, fontWeight: '800' },

  area: { backgroundColor: colors.bg, borderWidth: hairline, borderColor: colors.border, borderRadius: 16, padding: 12, marginBottom: 10 },
  areaHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  areaTitle: { fontSize: 16, fontWeight: '700', color: colors.accent, marginBottom: 4 },
  areaSub: { fontSize: 16, fontWeight: '600', color: colors.text, marginTop: 8, marginBottom: 4 },
  removeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.panel2 },
  removeText: { color: colors.danger, fontWeight: '700', fontSize: 15 },
  stockHead: { flexDirection: 'row', gap: 8 },
  stockRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  stockCol: { flex: 1, minWidth: 0, flexDirection: 'row' },
  stockRemove: { width: 36, alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  addBtn: { borderWidth: 1, borderColor: colors.faint, borderStyle: 'dashed', borderRadius: 14, padding: 12, alignItems: 'center' },
  addText: { fontSize: 17, fontWeight: '700', color: colors.accent },

  hint: { fontSize: 14, color: colors.subtext, marginBottom: 10 },
  warning: { backgroundColor: colors.warningBg, borderWidth: 1, borderColor: colors.accent, borderRadius: 14, padding: 12, marginBottom: 10 },
  warningText: { fontSize: 16, fontWeight: '600', color: colors.text },
  results: { backgroundColor: colors.panel, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 6, marginBottom: 12 },
  resultRow: { paddingVertical: 9, borderBottomWidth: hairline, borderBottomColor: colors.border },
  resultLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  resultLabel: { fontSize: 17, fontWeight: '500', color: colors.text, flexShrink: 1, marginRight: 10 },
  resultValue: { fontSize: 20, fontWeight: '600', color: colors.text, textAlign: 'right', flexShrink: 0, maxWidth: '64%' },
  bigLabel: { fontSize: 19, fontWeight: '700' },
  bigValue: { fontSize: 32, fontWeight: '300', color: colors.accent },
  resultNote: { fontSize: 14, color: colors.subtext, marginTop: 2 },
  empty: { fontSize: 18, fontWeight: '600', color: colors.subtext, textAlign: 'center', paddingVertical: 14 },
  errorText: { color: colors.error },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.panel, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '75%' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: hairline, borderBottomColor: colors.border },
  sheetTitle: { fontSize: 22, fontWeight: '800', color: colors.text },
  sheetBody: { padding: 16, paddingBottom: 40 },
  newJobBtn: { backgroundColor: colors.accent, borderRadius: 14, height: 54, paddingHorizontal: 16, justifyContent: 'center', marginLeft: 8 },
  newJobText: { fontSize: 17, fontWeight: '800', color: colors.accentText },
  jobRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.panel2, borderRadius: 14, padding: 14, marginTop: 10 },
  jobName: { fontSize: 18, fontWeight: '700', color: colors.text, flexShrink: 1 },
  jobMeta: { fontSize: 14, color: colors.subtext, marginLeft: 8 },
  shareBtn: { backgroundColor: colors.panel2, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginBottom: 14 },
  sharePressed: { opacity: 0.7 },
  shareText: { fontSize: 17, fontWeight: '700', color: colors.accent },
  note: { fontSize: 14, color: colors.subtext, marginBottom: 6, lineHeight: 20 },

  footer: {
    flexDirection: 'row',
    borderTopWidth: hairline,
    borderTopColor: colors.border,
    backgroundColor: colors.panel,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 62,
    alignItems: 'center',
  },
  footerItem: { flex: 1, marginHorizontal: 4 },
  footerLabel: { fontSize: 13, fontWeight: '600', color: colors.subtext },
  footerValue: { fontSize: 28, fontWeight: '300', color: colors.accent },
  footerMsg: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.subtext, textAlign: 'center' },
}));

// Rebuilt when the colors or text size change in Settings.
let styles = getStyles();
onThemeChange(() => {
  styles = getStyles();
});
