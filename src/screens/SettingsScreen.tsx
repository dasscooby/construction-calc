import { useEffect, useState } from 'react';
import { BackHandler, Image, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import type { Job } from '../lib/jobs';
import { companyLine, Settings, settings, TabId, useSettings } from '../lib/settings';
import { buildBid, buildBill } from '../report/billing';
import { DEFAULT_NOTICE, DOC_COLORS, DOC_FONTS, DocColor, DocFont, DocKind } from '../report/docStyle';
import { deleteFile, photosAvailable, pickLogo } from '../lib/media';
import { pickError } from '../lib/planReader';
import { sendDoc } from './JobsScreen';
import { buildReport } from '../report/report';
import { TABS } from '../tabs';
import { AccentId, ACCENTS, colors, onThemeChange, TEXT_SIZES, TextSize, themed } from '../theme';

const NUM_KEYBOARD = Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default';

/** Look, My defaults, Company, and My tools. Everything saves as you go. */
export default function SettingsScreen({ onClose }: { onClose: () => void }) {
  const s = useSettings();

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  const setDefault = (key: keyof Settings['defaults'], v: string) => settings.update({ defaults: { ...s.defaults, [key]: v } });
  const setCompany = (key: keyof Settings['company'], v: string) => settings.update({ company: { ...s.company, [key]: v } });
  const setPrice = (key: keyof Settings['prices'], v: string) => settings.update({ prices: { ...s.prices, [key]: v } });
  const setSupplier = (key: keyof Settings['supplier'], v: string) => settings.update({ supplier: { ...s.supplier, [key]: v } });
  const moveTab = (i: number, by: -1 | 1) => {
    const order = [...s.tabOrder];
    const j = i + by;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    settings.update({ tabOrder: order });
  };
  const footer = companyLine(s);
  const setDocs = (patch: Partial<Settings['docs']>) => settings.update({ docs: { ...s.docs, ...patch } });
  // A made-up job to see how the documents look.
  const sample: Job = {
    id: 'sample',
    name: 'Sample job',
    address: '123 Main St',
    notes: 'Pump at 7. Gate code 1234.',
    createdAt: Date.now(),
    items: [],
    customer: 'Customer name\n456 Oak Ave',
    lines: [
      { id: '1', desc: 'Garage slab: form, pour and finish', qty: '600', unit: 'sq ft', price: '8.50' },
      { id: '2', desc: 'Rebar, cut, bent and tied', qty: '650', unit: 'lb', price: '1.25' },
    ],
    taxPct: '',
    paid: '1000',
  };
  const preview = (kind: DocKind) =>
    sendDoc(
      null,
      s,
      (m) => (kind === 'bid' ? buildBid(sample, s, [], undefined, m) : kind === 'bill' ? buildBill(sample, s, [], undefined, m) : buildReport(sample, s, { crew: true, logo: m.logo })),
      kind === 'bid' ? 'Sample bid' : kind === 'bill' ? 'Sample bill' : 'Sample crew sheet',
    );
  const [logoError, setLogoError] = useState('');
  const canLogo = photosAvailable();
  const addLogo = async () => {
    setLogoError('');
    try {
      const logo = await pickLogo();
      if (!logo) return;
      deleteFile(s.docs.logo);
      setDocs({ logo });
    } catch (e) {
      setLogoError(pickError(e));
    }
  };

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <Pressable onPress={onClose} style={styles.back} accessibilityRole="button">
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Settings</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {/* ---------------- Look ---------------- */}
        <Text style={styles.section}>Look</Text>
        <View style={styles.card}>
          <Text style={styles.label}>Screen</Text>
          <Chips
            value={s.mode}
            options={[
              ['dark', 'Dark'],
              ['light', 'Light'],
            ]}
            onPick={(mode) => settings.update({ mode })}
          />
          <Text style={styles.label}>Color</Text>
          <View style={styles.swatches}>
            {(Object.keys(ACCENTS) as AccentId[]).map((id) => {
              const a = ACCENTS[id];
              const on = s.accent === id;
              return (
                <Pressable
                  key={id}
                  onPress={() => settings.update({ accent: id })}
                  accessibilityRole="button"
                  accessibilityLabel={a.label}
                  accessibilityState={{ selected: on }}
                  style={[styles.swatch, { backgroundColor: s.mode === 'dark' ? a.dark : a.light }, on && styles.swatchOn]}
                >
                  {on ? <Text style={[styles.check, { color: a.on }]}>✓</Text> : null}
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.label}>Text size</Text>
          <Chips
            value={s.textSize}
            options={(Object.keys(TEXT_SIZES) as TextSize[]).map((k) => [k, TEXT_SIZES[k].label])}
            onPick={(textSize) => settings.update({ textSize })}
          />
          {Platform.OS !== 'web' && (
            <>
              <Text style={styles.label}>Key clicks</Text>
              <Chips
                value={s.haptics ? 'on' : 'off'}
                options={[
                  ['on', 'On'],
                  ['off', 'Off'],
                ]}
                onPick={(v) => settings.update({ haptics: v === 'on' })}
              />
            </>
          )}
        </View>

        {/* ---------------- Defaults ---------------- */}
        <Text style={styles.section}>My defaults</Text>
        <Text style={styles.sectionHelp}>New tools start with these. Blank = the app's usual number. Tools you've already filled in keep their numbers until you tap Clear.</Text>
        <View style={styles.card}>
          <Field label="Waste" unit="%" value={s.defaults.waste} placeholder="10" onChange={(v) => setDefault('waste', v)} />
          <Field label="Truck size" unit="yd" value={s.defaults.truck} placeholder="10" onChange={(v) => setDefault('truck', v)} />
          <Field label="Price per yard" unit="$/yd" value={s.defaults.price} placeholder="none" onChange={(v) => setDefault('price', v)} />
          <Field label="Slab thickness" unit="in" value={s.defaults.slabThick} placeholder="4" onChange={(v) => setDefault('slabThick', v)} />
          <Field label="Wall thickness" unit="in" value={s.defaults.wallThick} placeholder="8" onChange={(v) => setDefault('wallThick', v)} />
          <Field label="Slab rebar on center" unit="in" value={s.defaults.spacing} placeholder="18" onChange={(v) => setDefault('spacing', v)} />
          <Field label="Lap" unit="in" value={s.defaults.lap} placeholder="by bar size" onChange={(v) => setDefault('lap', v)} />
          <Text style={styles.label}>Rebar stick length</Text>
          <Chips
            value={s.defaults.stockLength}
            options={[
              ['', 'Usual (20\')'],
              ['20', "20'"],
              ['30', "30'"],
              ['40', "40'"],
              ['60', "60'"],
            ]}
            onPick={(v) => setDefault('stockLength', v)}
          />
        </View>

        {/* ---------------- Company ---------------- */}
        <Text style={styles.section}>Company</Text>
        <Text style={styles.sectionHelp}>Goes at the bottom of everything you share, and on job reports.</Text>
        <View style={styles.card}>
          <Field label="Company name" value={s.company.name} placeholder="Smith Concrete" onChange={(v) => setCompany('name', v)} text />
          <Field label="Phone" value={s.company.phone} placeholder="(406) 555-1234" onChange={(v) => setCompany('phone', v)} text keyboard="phone-pad" />
          <Field label="Email" value={s.company.email} placeholder="you@example.com" onChange={(v) => setCompany('email', v)} text keyboard="email-address" />
          <Field label="License #" value={s.company.license} placeholder="optional" onChange={(v) => setCompany('license', v)} text />
          {footer ? <Text style={styles.preview}>Shows as: {footer}</Text> : null}
        </View>

        {/* ---------------- Price book ---------------- */}
        <Text style={styles.section}>Price book</Text>
        <Text style={styles.sectionHelp}>Your usual prices. “Fill in from job” on a bid uses them. Blank = you type it each time.</Text>
        <View style={styles.card}>
          <Field label="Slab (form, pour, finish)" unit="$/sq ft" value={s.prices.slabSqFt} placeholder="none" onChange={(v) => setPrice('slabSqFt', v)} />
          <Field label="Walls" unit="$/ft" value={s.prices.wallFt} placeholder="none" onChange={(v) => setPrice('wallFt', v)} />
          <Field label="Footings" unit="$/ft" value={s.prices.footingFt} placeholder="none" onChange={(v) => setPrice('footingFt', v)} />
          <Field label="Piers" unit="$ each" value={s.prices.pierEa} placeholder="none" onChange={(v) => setPrice('pierEa', v)} />
          <Field label="Steps" unit="$/set" value={s.prices.stepsSet} placeholder="none" onChange={(v) => setPrice('stepsSet', v)} />
          <Field label="Rebar" unit="$/lb" value={s.prices.rebarLb} placeholder="none" onChange={(v) => setPrice('rebarLb', v)} />
          <Field label="Labor" unit="$/job" value={s.prices.laborJob} placeholder="none" onChange={(v) => setPrice('laborJob', v)} />
          <Field label="Excavation" unit="$/yd" value={s.prices.excavYd} placeholder="none" onChange={(v) => setPrice('excavYd', v)} />
          <Field label="Base rock" unit="$/ton" value={s.prices.baseTon} placeholder="none" onChange={(v) => setPrice('baseTon', v)} />
          <Field label="Vapor barrier" unit="$/sq ft" value={s.prices.barrierSqFt} placeholder="none" onChange={(v) => setPrice('barrierSqFt', v)} />
          <Field label="Dowels" unit="$ each" value={s.prices.dowelEa} placeholder="none" onChange={(v) => setPrice('dowelEa', v)} />
          <Field label="Pump truck" unit="$/pour" value={s.prices.pumpPour} placeholder="none" onChange={(v) => setPrice('pumpPour', v)} />
          <Text style={styles.label}>Bids and bills</Text>
          <Field label="Sales tax" unit="%" value={s.prices.taxPct} placeholder="0" onChange={(v) => setPrice('taxPct', v)} />
          <Field label="Deposit to start" unit="%" value={s.prices.depositPct} placeholder="none" onChange={(v) => setPrice('depositPct', v)} />
          <Field label="Days to pay the bill" unit="days" value={s.prices.termsDays} placeholder="on receipt" onChange={(v) => setPrice('termsDays', v)} />
          <Text style={styles.preview}>Concrete uses “Price per yard” from My defaults.</Text>
        </View>

        {/* ---------------- Supplier ---------------- */}
        <Text style={styles.section}>Concrete supplier</Text>
        <Text style={styles.sectionHelp}>For texting your concrete order from a job.</Text>
        <View style={styles.card}>
          <Field label="Supplier" value={s.supplier.name} placeholder="Ready-mix plant" onChange={(v) => setSupplier('name', v)} text />
          <Field label="Order phone" value={s.supplier.phone} placeholder="(406) 555-0000" onChange={(v) => setSupplier('phone', v)} text keyboard="phone-pad" />
          <Field label="Usual PSI" value={s.supplier.psi} placeholder="3000" onChange={(v) => setSupplier('psi', v)} />
        </View>

        {/* ---------------- Documents ---------------- */}
        <Text style={styles.section}>Documents</Text>
        <Text style={styles.sectionHelp}>How your bids, bills and crew sheets look.</Text>
        <View style={styles.card}>
          <Text style={styles.label}>Logo</Text>
          {s.docs.logo ? <Image source={{ uri: s.docs.logo }} style={styles.logo} resizeMode="contain" accessibilityLabel="Your logo" /> : null}
          {canLogo ? (
            <View style={styles.chips}>
              <Pressable onPress={() => void addLogo()} style={styles.chip} accessibilityRole="button">
                <Text style={styles.chipText}>{s.docs.logo ? 'Change logo' : 'Add logo'}</Text>
              </Pressable>
              {s.docs.logo ? (
                <Pressable
                  onPress={() => {
                    deleteFile(s.docs.logo);
                    setDocs({ logo: '' });
                  }}
                  style={styles.chip}
                  accessibilityRole="button"
                >
                  <Text style={styles.chipText}>Remove</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <Text style={styles.preview}>Adding a logo needs the newest app version from TestFlight.</Text>
          )}
          {logoError ? <Text style={styles.preview}>{logoError}</Text> : null}
          <Text style={styles.label}>Color</Text>
          <View style={styles.swatches}>
            {(Object.keys(DOC_COLORS) as DocColor[]).map((id) => {
              const on = s.docs.color === id;
              return (
                <Pressable
                  key={id}
                  onPress={() => setDocs({ color: id })}
                  accessibilityRole="button"
                  accessibilityLabel={`Document color ${DOC_COLORS[id].label}`}
                  accessibilityState={{ selected: on }}
                  style={[styles.swatch, { backgroundColor: DOC_COLORS[id].hex }, on && styles.swatchOn]}
                >
                  {on ? <Text style={[styles.check, { color: '#ffffff' }]}>✓</Text> : null}
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.label}>Font</Text>
          <Chips value={s.docs.font} options={(Object.keys(DOC_FONTS) as DocFont[]).map((k) => [k, DOC_FONTS[k].label])} onPick={(font) => setDocs({ font })} />
          <Text style={styles.label}>Company name</Text>
          <Chips
            value={s.docs.header}
            options={[
              ['side', 'Top left'],
              ['center', 'Centered'],
            ]}
            onPick={(header) => setDocs({ header })}
          />
          {(
            [
              ['crew', 'Crew sheet notice'],
              ['bid', 'Bid notice'],
              ['bill', 'Bill notice'],
              ['change', 'Change order notice'],
            ] as [DocKind, string][]
          ).map(([kind, label]) => {
            const k = `${kind}Notice` as const;
            return (
              <View key={kind}>
                <View style={styles.noticeHead}>
                  <Text style={styles.label}>{label}</Text>
                  {s.docs[k] ? (
                    <Pressable onPress={() => setDocs({ [k]: '' })} accessibilityRole="button" accessibilityLabel={`Reset ${label}`}>
                      <Text style={styles.resetText}>Reset</Text>
                    </Pressable>
                  ) : null}
                </View>
                <TextInput
                  style={styles.notice}
                  value={s.docs[k] || DEFAULT_NOTICE[kind]}
                  onChangeText={(v) => setDocs({ [k]: v === DEFAULT_NOTICE[kind] ? '' : v })}
                  multiline
                  accessibilityLabel={label}
                />
              </View>
            );
          })}
          <Text style={styles.label}>See how they look</Text>
          <View style={styles.chips}>
            {(
              [
                ['bid', 'Bid'],
                ['bill', 'Bill'],
                ['crew', 'Crew sheet'],
              ] as [DocKind, string][]
            ).map(([kind, label]) => (
              <Pressable key={kind} onPress={() => preview(kind)} style={styles.chip} accessibilityRole="button" accessibilityLabel={`Preview ${label}`}>
                <Text style={styles.chipText}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* ---------------- My tools ---------------- */}
        <Text style={styles.section}>My tools</Text>
        <Text style={styles.sectionHelp}>★ pins a tool to the top of its tab. You can also tap the ☆ next to any tool.</Text>
        <View style={styles.card}>
          <Text style={styles.label}>Tab order</Text>
          {s.tabOrder.map((id, i) => (
            <View key={id} style={styles.orderRow}>
              <Text style={styles.orderName}>{TABS[id].name}</Text>
              <Arrow label="Move up" text="↑" disabled={i === 0} onPress={() => moveTab(i, -1)} />
              <Arrow label="Move down" text="↓" disabled={i === s.tabOrder.length - 1} onPress={() => moveTab(i, 1)} />
            </View>
          ))}
        </View>
        {s.tabOrder
          .filter((id): id is Exclude<TabId, 'calc'> => !!TABS[id].groups)
          .map((id) => (
            <View key={id} style={styles.card}>
              <Text style={styles.label}>{TABS[id].title}</Text>
              {TABS[id].groups!.flatMap((g) => g.tools).map((t) => {
                const fav = s.favorites.includes(t.id);
                const hidden = s.hidden.includes(t.id);
                return (
                  <View key={t.id} style={styles.toolRow}>
                    <Text style={[styles.toolName, hidden && styles.toolHidden]} numberOfLines={1}>
                      {t.title}
                    </Text>
                    <Pressable
                      onPress={() => settings.toggle('favorites', t.id)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`${fav ? 'Unpin' : 'Pin'} ${t.title}`}
                      style={styles.toolBtn}
                    >
                      <Text style={[styles.star, fav && styles.on]}>{fav ? '★' : '☆'}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => settings.toggle('hidden', t.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`${hidden ? 'Show' : 'Hide'} ${t.title}`}
                      style={[styles.pill, hidden && styles.pillOn]}
                    >
                      <Text style={[styles.pillText, hidden && styles.pillTextOn]}>{hidden ? 'Hidden' : 'Showing'}</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          ))}
      </ScrollView>
    </View>
  );
}

function Chips<T extends string>({ value, options, onPick }: { value: T; options: [T, string][]; onPick: (v: T) => void }) {
  return (
    <View style={styles.chips}>
      {options.map(([v, label]) => {
        const on = v === value;
        return (
          <Pressable
            key={v}
            onPress={() => onPick(v)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[styles.chip, on && styles.chipOn]}
          >
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Field({
  label,
  unit,
  value,
  placeholder,
  onChange,
  text,
  keyboard,
}: {
  label: string;
  unit?: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  text?: boolean;
  keyboard?: 'phone-pad' | 'email-address';
}) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, text && styles.inputWide]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        keyboardType={keyboard ?? (text ? 'default' : NUM_KEYBOARD)}
        autoCapitalize={keyboard === 'email-address' ? 'none' : text ? 'words' : 'none'}
        autoCorrect={false}
        returnKeyType="done"
        accessibilityLabel={label}
      />
      {unit ? <Text style={styles.unit}>{unit}</Text> : null}
    </View>
  );
}

function Arrow({ label, text, disabled, onPress }: { label: string; text: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.arrow, disabled && styles.arrowOff]}
    >
      <Text style={styles.arrowText}>{text}</Text>
    </Pressable>
  );
}

const getStyles = themed(() => ({
  page: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  back: { paddingVertical: 10, paddingHorizontal: 8, minWidth: 90 },
  backText: { fontSize: 19, fontWeight: '600', color: colors.accent },
  title: { flex: 1, fontSize: 20, fontWeight: '700', color: colors.text, textAlign: 'center' },
  content: { padding: 14, paddingBottom: 40 },
  section: { fontSize: 14, fontWeight: '700', color: colors.subtext, marginTop: 16, marginBottom: 6, marginLeft: 4, textTransform: 'uppercase', letterSpacing: 0.6 },
  sectionHelp: { fontSize: 14, color: colors.subtext, marginBottom: 8, marginLeft: 4, lineHeight: 19 },
  card: { backgroundColor: colors.panel, borderRadius: 16, padding: 14, marginBottom: 10 },
  label: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 8, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 },
  chip: { backgroundColor: colors.panel2, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10, marginRight: 8, marginBottom: 8 },
  chipOn: { backgroundColor: colors.accent },
  chipText: { fontSize: 16, fontWeight: '600', color: colors.text },
  chipTextOn: { color: colors.accentText, fontWeight: '800' },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 },
  swatch: { width: 44, height: 44, borderRadius: 22, marginRight: 12, marginBottom: 8, alignItems: 'center', justifyContent: 'center' },
  swatchOn: { borderWidth: 3, borderColor: colors.text },
  check: { fontSize: 20, fontWeight: '900' },
  fieldRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  fieldLabel: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.text },
  input: {
    width: 110,
    height: 44,
    backgroundColor: colors.panel2,
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 18,
    color: colors.text,
    textAlign: 'right',
  },
  inputWide: { width: 190, textAlign: 'left' },
  unit: { width: 44, paddingLeft: 8, fontSize: 15, color: colors.subtext },
  preview: { fontSize: 14, color: colors.subtext, marginTop: 4 },
  logo: { width: 200, height: 80, backgroundColor: '#ffffff', borderRadius: 10, marginBottom: 8 },
  noticeHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 8 },
  resetText: { fontSize: 15, fontWeight: '700', color: colors.accent },
  notice: { backgroundColor: colors.panel2, borderRadius: 12, padding: 12, fontSize: 15, lineHeight: 20, color: colors.text, minHeight: 90, textAlignVertical: 'top' },
  orderRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  orderName: { flex: 1, fontSize: 17, color: colors.text },
  arrow: { width: 44, height: 40, borderRadius: 10, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  arrowOff: { opacity: 0.3 },
  arrowText: { fontSize: 20, fontWeight: '700', color: colors.accent },
  toolRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  toolName: { flex: 1, fontSize: 16, color: colors.text },
  toolHidden: { color: colors.faint, textDecorationLine: 'line-through' },
  toolBtn: { paddingHorizontal: 10 },
  star: { fontSize: 24, color: colors.faint },
  on: { color: colors.accent },
  pill: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: colors.panel2, minWidth: 84, alignItems: 'center' },
  pillOn: { backgroundColor: colors.border },
  pillText: { fontSize: 14, fontWeight: '700', color: colors.text },
  pillTextOn: { color: colors.subtext },
}));

// Rebuilt when the colors or text size change.
let styles = getStyles();
onThemeChange(() => {
  styles = getStyles();
});
