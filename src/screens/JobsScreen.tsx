import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';

import { dayLabel } from '../lib/history';
import { Job, JobItem, jobStore, useJobs } from '../lib/jobs';
import { useSettings } from '../lib/settings';
import { openReport } from '../report/open';
import { buildReport, figureItems, jobTotals } from '../report/report';
import { colors, onThemeChange, themed } from '../theme';

interface Props {
  /** Open a job's calculation in its tool, linked back to the job so changes can be saved to it */
  onOpenItem: (job: Job, item: JobItem) => void;
}

/** Jobs: each one collects calculations and turns them into a report with a plan, 3D view and order. */
export default function JobsScreen({ onOpenItem }: Props) {
  const jobs = useJobs();
  const [openId, setOpenId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const job = jobs.find((j) => j.id === openId);

  if (job) return <JobDetail job={job} onBack={() => setOpenId(null)} onOpenItem={(it) => onOpenItem(job, it)} />;

  const create = () => {
    setOpenId(jobStore.create(newName));
    setNewName('');
  };

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.bigTitle}>Jobs</Text>
      <Text style={styles.help}>Make a job, then use “Add to job” under any tool’s answers. The job turns it all into one report with a plan, a 3D view and the order.</Text>
      <View style={styles.newRow}>
        <TextInput
          style={styles.newInput}
          value={newName}
          onChangeText={setNewName}
          placeholder="New job name"
          placeholderTextColor={colors.faint}
          returnKeyType="done"
          onSubmitEditing={create}
          accessibilityLabel="New job name"
        />
        <Pressable onPress={create} style={styles.primary} accessibilityRole="button">
          <Text style={styles.primaryText}>+ New job</Text>
        </Pressable>
      </View>
      {jobs.length === 0 ? (
        <Text style={styles.empty}>No jobs yet.</Text>
      ) : (
        jobs.map((j) => (
          <Pressable key={j.id} onPress={() => setOpenId(j.id)} accessibilityRole="button" style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>{j.name}</Text>
              <Text style={styles.cardMeta}>{dayLabel(j.createdAt)}</Text>
            </View>
            {j.address ? <Text style={styles.cardSub}>{j.address}</Text> : null}
            <Text style={styles.cardSub}>
              {j.items.length} {j.items.length === 1 ? 'calculation' : 'calculations'}
            </Text>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

function JobDetail({ job, onBack, onOpenItem }: { job: Job; onBack: () => void; onOpenItem: (it: JobItem) => void }) {
  const prefs = useSettings();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const figured = useMemo(() => figureItems(job), [job]);
  const report = useMemo(() => buildReport(job, prefs), [job, prefs]);
  const summary = useMemo(() => {
    const t = jobTotals(figured);
    const rows: [string, string][] = [];
    if (t.concreteOrderYd) rows.push(['Concrete to order', `${t.concreteOrderYd.toFixed(2)} yd`]);
    if (t.concreteCost) rows.push(['Concrete cost', `$${t.concreteCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`]);
    if (t.rebarLb) rows.push(['Rebar', `${Math.round(t.rebarLb).toLocaleString()} lb`]);
    for (const [k, v] of t.panels) rows.push([k, v.toLocaleString()]);
    const fillers = [...t.fillers.values()].reduce((a, b) => a + b, 0);
    if (fillers) rows.push(['Fillers', fillers.toLocaleString()]);
    return rows;
  }, [figured]);

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.back} accessibilityRole="button">
          <Text style={styles.backText}>‹ Jobs</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextInput
          style={styles.nameInput}
          value={job.name}
          onChangeText={(name) => jobStore.edit(job.id, { name })}
          placeholder="Job name"
          placeholderTextColor={colors.faint}
          accessibilityLabel="Job name"
        />
        <TextInput
          style={styles.field}
          value={job.address}
          onChangeText={(address) => jobStore.edit(job.id, { address })}
          placeholder="Address (optional)"
          placeholderTextColor={colors.faint}
          accessibilityLabel="Address"
        />

        {summary.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.label}>Order summary</Text>
            {summary.map(([k, v]) => (
              <View key={k} style={styles.sumRow}>
                <Text style={styles.sumLabel}>{k}</Text>
                <Text style={styles.sumValue}>{v}</Text>
              </View>
            ))}
          </View>
        )}

        <Pressable
          onPress={() => openReport(report.html, report.text, job.name)}
          style={[styles.primary, styles.wide]}
          accessibilityRole="button"
        >
          <Text style={styles.primaryText}>View report / PDF</Text>
        </Pressable>
        <Pressable onPress={() => Share.share({ title: job.name, message: report.text }).catch(() => {})} style={styles.secondary} accessibilityRole="button">
          <Text style={styles.secondaryText}>Share as text</Text>
        </Pressable>

        <Text style={styles.section}>In this job</Text>
        {figured.length === 0 ? (
          <Text style={styles.help}>Nothing yet. Open any tool, fill it in, and tap “Add to job”.</Text>
        ) : (
          figured.map(({ item, tool, result }) => (
            <View key={item.id} style={styles.card}>
              <View style={styles.cardHead}>
                <TextInput
                  style={styles.itemLabel}
                  value={item.label}
                  onChangeText={(label) => jobStore.editItem(job.id, item.id, { label })}
                  placeholder={tool.title}
                  placeholderTextColor={colors.text}
                  accessibilityLabel={`Name for ${tool.title}`}
                />
              </View>
              {item.label ? <Text style={styles.cardSub}>{tool.title}</Text> : null}
              {result.status === 'ok' ? (
                result.result.rows
                  .filter((r) => r.big)
                  .map((r) => (
                    <View key={r.label} style={styles.sumRow}>
                      <Text style={styles.sumLabel}>{r.label.trim()}</Text>
                      <Text style={styles.sumValue}>{r.value}</Text>
                    </View>
                  ))
              ) : (
                <Text style={styles.warn}>Not finished: {result.message}</Text>
              )}
              <View style={styles.itemBtns}>
                <Pressable onPress={() => onOpenItem(item)} style={styles.smallBtn} accessibilityRole="button" accessibilityLabel={`Open ${item.label || tool.title}`}>
                  <Text style={styles.smallBtnText}>Open</Text>
                </Pressable>
                <Pressable
                  onPress={() => jobStore.removeItem(job.id, item.id)}
                  style={styles.smallBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${item.label || tool.title}`}
                >
                  <Text style={[styles.smallBtnText, styles.danger]}>Remove</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}

        <Text style={styles.section}>Notes</Text>
        <TextInput
          style={[styles.field, styles.notes]}
          value={job.notes}
          onChangeText={(notes) => jobStore.edit(job.id, { notes })}
          placeholder="Pump at 7, gate code, who to call…"
          placeholderTextColor={colors.faint}
          multiline
          accessibilityLabel="Notes"
        />

        {confirmDelete ? (
          <View style={styles.confirm}>
            <Text style={styles.confirmText}>Delete “{job.name}”? This can’t be undone.</Text>
            <View style={styles.itemBtns}>
              <Pressable onPress={() => setConfirmDelete(false)} style={[styles.secondary, styles.half]} accessibilityRole="button">
                <Text style={styles.secondaryText}>Keep it</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  jobStore.remove(job.id);
                  onBack();
                }}
                style={[styles.secondary, styles.half]}
                accessibilityRole="button"
              >
                <Text style={[styles.secondaryText, styles.danger]}>Delete job</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable onPress={() => setConfirmDelete(true)} style={styles.secondary} accessibilityRole="button">
            <Text style={[styles.secondaryText, styles.danger]}>Delete job</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const getStyles = themed(() => ({
  page: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 14, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  back: { paddingVertical: 10, paddingHorizontal: 8 },
  backText: { fontSize: 19, fontWeight: '600', color: colors.accent },
  bigTitle: { fontSize: 34, fontWeight: '800', color: colors.text, marginBottom: 6, marginLeft: 2 },
  help: { fontSize: 15, color: colors.subtext, marginBottom: 12, lineHeight: 21 },
  empty: { fontSize: 17, color: colors.subtext, textAlign: 'center', marginTop: 30 },
  newRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  newInput: { flex: 1, minWidth: 0, height: 50, backgroundColor: colors.panel, borderRadius: 14, paddingHorizontal: 14, fontSize: 18, color: colors.text },
  primary: { backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center' },
  primaryText: { fontSize: 17, fontWeight: '800', color: colors.accentText },
  wide: { marginBottom: 10 },
  secondary: { backgroundColor: colors.panel2, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginBottom: 12 },
  secondaryText: { fontSize: 17, fontWeight: '700', color: colors.accent },
  danger: { color: colors.danger },
  card: { backgroundColor: colors.panel, borderRadius: 16, padding: 14, marginBottom: 10 },
  pressed: { backgroundColor: colors.panel2 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  cardTitle: { fontSize: 19, fontWeight: '700', color: colors.text, flexShrink: 1 },
  cardMeta: { fontSize: 14, color: colors.subtext, marginLeft: 8 },
  cardSub: { fontSize: 14, color: colors.subtext, marginTop: 2 },
  nameInput: { fontSize: 28, fontWeight: '800', color: colors.text, paddingVertical: 6, marginBottom: 4 },
  field: { backgroundColor: colors.panel, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 17, color: colors.text, marginBottom: 12 },
  notes: { minHeight: 90, textAlignVertical: 'top' },
  label: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 6 },
  section: { fontSize: 14, fontWeight: '700', color: colors.subtext, marginTop: 14, marginBottom: 8, marginLeft: 4, textTransform: 'uppercase', letterSpacing: 0.6 },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingVertical: 4 },
  sumLabel: { fontSize: 15, color: colors.subtext, flexShrink: 1, marginRight: 8 },
  sumValue: { fontSize: 18, fontWeight: '600', color: colors.accent },
  itemLabel: { flex: 1, fontSize: 18, fontWeight: '700', color: colors.text, paddingVertical: 2 },
  warn: { fontSize: 15, color: colors.error, marginTop: 4 },
  itemBtns: { flexDirection: 'row', gap: 10, marginTop: 10 },
  smallBtn: { flex: 1, backgroundColor: colors.panel2, borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  smallBtnText: { fontSize: 16, fontWeight: '700', color: colors.accent },
  confirm: { backgroundColor: colors.panel, borderRadius: 16, padding: 14 },
  confirmText: { fontSize: 16, fontWeight: '600', color: colors.text, textAlign: 'center' },
  half: { flex: 1, marginBottom: 0 },
}));

// Rebuilt when the colors or text size change.
let styles = getStyles();
onThemeChange(() => {
  styles = getStyles();
});
