import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';

import { feel } from '../lib/feel';
import { dayLabel, timeLabel } from '../lib/history';
import { Job, JobItem, jobStore, PriceLine, useJobs, yardsIn } from '../lib/jobs';
import { deleteJobScans, deleteScanFile, scanPages, scannerAvailable, scansForReport } from '../lib/scanner';
import { pickPlanFileWeb, PlanSlab, processPlanQueue, savePendingFile, slabToRaw } from '../lib/planReader';
import { useSettings } from '../lib/settings';
import { dec } from '../tools/format';
import { liveActivitiesSupported } from '../widgets/bridge';
import { openReport } from '../report/open';
import { buildBid, buildBill, lineAmount, priceTotals, suggestLines } from '../report/billing';
import { buildReport, figureItems, FiguredItem, jobTotals } from '../report/report';
import { money } from '../tools/format';
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
  const report = useMemo(() => buildReport(job, prefs, { crew: true }), [job, prefs]);
  const totals = useMemo(() => jobTotals(figured), [figured]);
  const [scanning, setScanning] = useState(false);
  const canScan = useMemo(scannerAvailable, []);
  const viewReport = () => {
    // Phone app: put the scanned plan pages in the PDF too.
    if (Platform.OS !== 'web' && job.scans?.length) {
      void scansForReport(job.scans).then((scans) => {
        const r = buildReport(job, prefs, { scans, crew: true });
        openReport(r.html, r.text, job.name);
      });
    } else openReport(report.html, report.text, job.name);
  };
  const scan = async () => {
    setScanning(true);
    try {
      const pages = await scanPages(job.id);
      if (pages.length) {
        jobStore.addScans(job.id, pages);
        feel.success();
      }
    } catch {
      // cancelled or no camera permission
    }
    setScanning(false);
  };
  const summary = useMemo(() => {
    const t = totals;
    const rows: [string, string][] = [];
    if (t.concreteOrderYd) rows.push(['Concrete to order', `${t.concreteOrderYd.toFixed(2)} yd`]);
    if (t.concreteCost) rows.push(['Concrete cost', `$${t.concreteCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`]);
    if (t.rebarLb) rows.push(['Rebar', `${Math.round(t.rebarLb).toLocaleString()} lb`]);
    for (const [k, v] of t.panels) rows.push([k, v.toLocaleString()]);
    const fillers = [...t.fillers.values()].reduce((a, b) => a + b, 0);
    if (fillers) rows.push(['Fillers', fillers.toLocaleString()]);
    return rows;
  }, [totals]);

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

        <Text style={styles.section}>Send out</Text>
        <Pressable onPress={viewReport} style={[styles.primary, styles.wide]} accessibilityRole="button">
          <Text style={styles.primaryText}>Crew sheet</Text>
          <Text style={styles.primarySub}>Plans, drawings, load list, notes. No prices.</Text>
        </Pressable>
        <View style={styles.sendRow}>
          <Pressable
            onPress={() => {
              const r = buildBid(job, prefs, figured);
              openReport(r.html, r.text, `${job.name} bid`);
            }}
            style={[styles.secondary, styles.half]}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryText}>Bid</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              const r = buildBill(job, prefs, figured);
              openReport(r.html, r.text, `${job.name} bill`);
            }}
            style={[styles.secondary, styles.half]}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryText}>Final bill</Text>
          </Pressable>
        </View>
        <Pressable onPress={() => Share.share({ title: job.name, message: report.text }).catch(() => {})} style={styles.linkBtn} accessibilityRole="button">
          <Text style={styles.linkText}>Text the crew sheet instead</Text>
        </Pressable>

        <Prices job={job} figured={figured} />

        <PourCard job={job} orderYd={totals.concreteOrderYd} truckYd={Number(prefs.defaults.truck) || 10} />

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

        <PlanReader job={job} />

        {(canScan || (job.scans?.length ?? 0) > 0) && (
          <>
            <Text style={styles.section}>Plans</Text>
            {job.scans?.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scans}>
                {job.scans.map((uri, i) => (
                  <Pressable
                    key={uri}
                    onPress={() => {
                      jobStore.removeScan(job.id, uri);
                      deleteScanFile(uri);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete plan page ${i + 1}`}
                    style={styles.scanThumb}
                  >
                    <Image source={{ uri }} style={styles.scanImg} resizeMode="cover" />
                    <Text style={styles.scanLabel}>Page {i + 1} · tap to delete</Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
            {canScan && (
              <Pressable onPress={scan} disabled={scanning} style={styles.secondary} accessibilityRole="button">
                <Text style={styles.secondaryText}>{scanning ? 'Scanning…' : 'Scan plans'}</Text>
              </Pressable>
            )}
          </>
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
                  deleteJobScans(job.id);
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

/** Pour tracker: count trucks in. On iPhone it also shows on the Lock Screen and Dynamic Island. */
function PourCard({ job, orderYd, truckYd }: { job: Job; orderYd: number; truckYd: number }) {
  const p = job.pour;
  if (!p) {
    if (!orderYd) return null;
    const trucks = Math.max(1, Math.ceil(orderYd / truckYd - 1e-9));
    return (
      <View style={styles.card}>
        <Text style={styles.label}>Pour</Text>
        <Text style={styles.cardSub}>
          {dec(orderYd, 2)} yd · {trucks} {trucks === 1 ? 'truck' : 'trucks'} at {dec(truckYd)} yd
          {liveActivitiesSupported ? ' · shows on your Lock Screen' : ''}
        </Text>
        <Pressable
          onPress={() => {
            jobStore.startPour(job.id, orderYd, truckYd);
            feel.success();
          }}
          style={[styles.primary, styles.pourBtn]}
          accessibilityRole="button"
        >
          <Text style={styles.primaryText}>Start pour</Text>
        </Pressable>
      </View>
    );
  }
  const mins = Math.round((Date.now() - p.startedAt) / 60000);
  return (
    <View style={styles.card}>
      <Text style={styles.label}>{p.done ? 'Pour done' : 'Pouring'}</Text>
      <Text style={styles.pourBig}>
        {p.done ? `${p.trucksIn} ${p.trucksIn === 1 ? 'truck' : 'trucks'}` : `Truck ${Math.min(p.trucksIn + 1, p.trucks)} of ${p.trucks}`}
      </Text>
      <Text style={styles.cardSub}>
        {dec(yardsIn(p), 2)} of {dec(p.totalYd, 2)} yd in · started {timeLabel(p.startedAt)}
        {p.done ? '' : ` · ${mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`}`}
      </Text>
      {p.done ? (
        <Pressable onPress={() => jobStore.clearPour(job.id)} style={[styles.secondary, styles.pourBtn]} accessibilityRole="button">
          <Text style={styles.secondaryText}>Clear</Text>
        </Pressable>
      ) : (
        <>
          <Pressable
            onPress={() => {
              jobStore.countTruck(job.id, 1);
              feel.success();
            }}
            style={[styles.primary, styles.pourBtn]}
            accessibilityRole="button"
          >
            <Text style={styles.primaryText}>Truck in</Text>
          </Pressable>
          <View style={styles.itemBtns}>
            <Pressable onPress={() => jobStore.countTruck(job.id, -1)} style={styles.smallBtn} accessibilityRole="button">
              <Text style={styles.smallBtnText}>Undo</Text>
            </Pressable>
            <Pressable onPress={() => jobStore.finishPour(job.id)} style={styles.smallBtn} accessibilityRole="button">
              <Text style={styles.smallBtnText}>Finish pour</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

/**
 * Read a plan: pick a PDF or picture (web) or one of the scanned pages (phone app), and the slabs
 * on it come back ready to add to the job as Slab Layouts.
 */
function PlanReader({ job }: { job: Job }) {
  // Every plan goes in the job's queue first, so with no signal it waits and is read later.
  const [added, setAdded] = useState<number[]>([]);
  const found = job.planFound;
  const error = job.planError ?? '';
  const waiting = job.planQueue?.length ?? 0;
  const seen = useRef(found?.slabs.length ?? 0);
  useEffect(() => {
    if ((found?.slabs.length ?? 0) > seen.current) feel.success();
    seen.current = found?.slabs.length ?? 0;
  }, [found?.slabs.length]);
  const pickWeb = async () => {
    const file = await pickPlanFileWeb();
    if (!file) return;
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    try {
      await savePendingFile(id, file.data);
    } catch {
      jobStore.planDone(job.id, '', { error: 'Couldn’t save that file on this phone. Try a smaller one.' });
      return;
    }
    jobStore.queuePlan(job.id, { id, mediaType: file.mediaType });
    void processPlanQueue();
  };
  const readScan = (uri: string) => {
    jobStore.queuePlan(job.id, { uri, mediaType: 'image/jpeg' });
    void processPlanQueue();
  };
  const scans = job.scans ?? [];
  const summary = (s: PlanSlab) =>
    [
      `${s.sides.length} sides`,
      s.thickness_in ? `${s.thickness_in}" slab` : '',
      s.footing ? `${s.footing.width_in}" × ${s.footing.depth_in}" edge` : '',
      s.rebar ? `#${s.rebar.size} at ${s.rebar.spacing_in}"` : '',
      s.dowels ? `#${s.dowels.size} dowels` : '',
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <>
      <Text style={styles.section}>Read a plan</Text>
      {Platform.OS === 'web' ? (
        <Pressable onPress={() => void pickWeb()} style={styles.secondary} accessibilityRole="button">
          <Text style={styles.secondaryText}>Pick a PDF or picture</Text>
        </Pressable>
      ) : scans.length ? (
        <View style={styles.sendRow}>
          {scans.slice(0, 4).map((uri, i) => (
            <Pressable key={uri} onPress={() => readScan(uri)} style={[styles.smallBtn, styles.readBtn]} accessibilityRole="button">
              <Text style={styles.smallBtnText}>Page {i + 1}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Text style={styles.help}>Scan the plans below, then come back here to read them.</Text>
      )}
      {waiting ? (
        <Text style={styles.help}>
          Reading {waiting === 1 ? 'the plan' : `${waiting} plans`}… No signal? It’s saved and gets read as soon as you have service.
        </Text>
      ) : null}
      {error ? <Text style={styles.warn}>{error}</Text> : null}
      {found && (found.slabs.length > 0 || found.notes.length > 0) ? (
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.label}>On the plan</Text>
            <Pressable
              onPress={() => {
                jobStore.setPlanFound(job.id, undefined);
                setAdded([]);
              }}
              accessibilityRole="button"
              accessibilityLabel="Clear what the plan said"
            >
              <Text style={styles.smallBtnText}>Clear</Text>
            </Pressable>
          </View>
          {found.slabs.map((s, i) => (
            <View key={i} style={styles.line}>
              <Text style={styles.cardTitle}>{s.name || `Slab ${i + 1}`}</Text>
              <Text style={styles.cardSub}>{summary(s)}</Text>
              <Pressable
                onPress={() => {
                  feel.tap();
                  jobStore.addItem(job.id, { toolId: 'slab-layout', title: 'Slab Layout', label: s.name || `Slab ${i + 1}`, raw: slabToRaw(s) });
                  setAdded((a) => [...a, i]);
                }}
                disabled={added.includes(i)}
                style={[styles.smallBtn, styles.lineGap]}
                accessibilityRole="button"
              >
                <Text style={styles.smallBtnText}>{added.includes(i) ? 'Added. Open it below to check.' : 'Add to job'}</Text>
              </Pressable>
            </View>
          ))}
          {found.notes.length ? (
            <View style={styles.line}>
              {found.notes.map((n, i) => (
                <Text key={i} style={styles.cardSub}>
                  • {n}
                </Text>
              ))}
              <Pressable
                onPress={() => {
                  jobStore.edit(job.id, { notes: [job.notes.trim(), ...found.notes.map((n) => `• ${n}`)].filter(Boolean).join('\n') });
                  jobStore.setPlanFound(job.id, { ...found, notes: [] });
                }}
                style={[styles.smallBtn, styles.lineGap]}
                accessibilityRole="button"
              >
                <Text style={styles.smallBtnText}>Add to notes</Text>
              </Pressable>
            </View>
          ) : null}
          {found.unsure.length ? <Text style={styles.warn}>Check these: {found.unsure.join(' · ')}</Text> : null}
        </View>
      ) : null}
    </>
  );
}

/** Customer and price lines for the bid and the final bill. */
function Prices({ job, figured }: { job: Job; figured: FiguredItem[] }) {
  const lines = job.lines ?? [];
  const m = priceTotals(job);
  const setLine = (i: number, patch: Partial<PriceLine>) => jobStore.setLines(job.id, lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const box = (value: string, onChange: (v: string) => void, placeholder: string, a11y: string, style: object, numeric = true) => (
    <TextInput
      style={[styles.lineInput, style]}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={colors.faint}
      keyboardType={numeric ? 'decimal-pad' : 'default'}
      accessibilityLabel={a11y}
    />
  );
  return (
    <>
      <Text style={styles.section}>Bid and bill</Text>
      <TextInput
        style={[styles.field, styles.customer]}
        value={job.customer ?? ''}
        onChangeText={(customer) => jobStore.edit(job.id, { customer })}
        placeholder="Customer name, address, phone"
        placeholderTextColor={colors.faint}
        multiline
        accessibilityLabel="Customer"
      />
      <View style={styles.card}>
        {lines.length === 0 ? <Text style={styles.help}>Add what you’re charging for. “Fill in from job” starts the list from your numbers.</Text> : null}
        {lines.map((l, i) => (
          <View key={l.id} style={styles.line}>
            <View style={styles.lineTop}>
              {box(l.desc, (desc) => setLine(i, { desc }), 'What', `Line ${i + 1} description`, styles.lineDesc, false)}
              <Pressable
                onPress={() => jobStore.setLines(job.id, lines.filter((_, j) => j !== i))}
                style={styles.lineX}
                accessibilityRole="button"
                accessibilityLabel={`Remove line ${i + 1}`}
              >
                <Text style={[styles.smallBtnText, styles.danger]}>✕</Text>
              </Pressable>
            </View>
            <View style={styles.lineTop}>
              {box(l.qty, (qty) => setLine(i, { qty }), 'Qty', `Line ${i + 1} quantity`, styles.lineQty)}
              {box(l.unit, (unit) => setLine(i, { unit }), 'unit', `Line ${i + 1} unit`, styles.lineUnit, false)}
              {box(l.price, (price) => setLine(i, { price }), '$ each', `Line ${i + 1} price`, styles.linePrice)}
              <Text style={styles.lineAmt} numberOfLines={1}>
                {money(lineAmount(l))}
              </Text>
            </View>
          </View>
        ))}
        <View style={styles.itemBtns}>
          <Pressable
            onPress={() => jobStore.setLines(job.id, [...lines, { id: '', desc: '', qty: '1', unit: '', price: '' }])}
            style={styles.smallBtn}
            accessibilityRole="button"
          >
            <Text style={styles.smallBtnText}>+ Add line</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              feel.tap();
              jobStore.setLines(job.id, [...lines, ...suggestLines(figured)]);
            }}
            style={styles.smallBtn}
            accessibilityRole="button"
          >
            <Text style={styles.smallBtnText}>Fill in from job</Text>
          </Pressable>
        </View>
        <View style={[styles.sumRow, styles.lineGap]}>
          <Text style={styles.sumLabel}>Tax %</Text>
          {box(job.taxPct ?? '', (taxPct) => jobStore.edit(job.id, { taxPct }), '0', 'Tax percent', styles.lineQty)}
        </View>
        <View style={styles.sumRow}>
          <Text style={styles.sumLabel}>Paid so far (deposit)</Text>
          {box(job.paid ?? '', (paid) => jobStore.edit(job.id, { paid }), '$0', 'Paid so far', styles.linePrice)}
        </View>
        <View style={[styles.sumRow, styles.lineGap]}>
          <Text style={styles.sumLabel}>Total</Text>
          <Text style={styles.sumValue}>{money(m.total)}</Text>
        </View>
        {m.paid ? (
          <View style={styles.sumRow}>
            <Text style={styles.sumLabel}>Balance due</Text>
            <Text style={styles.sumValue}>{money(m.balance)}</Text>
          </View>
        ) : null}
      </View>
    </>
  );
}

const getStyles = themed(() => ({
  primarySub: { fontSize: 13, color: colors.accentText, opacity: 0.8, marginTop: 2 },
  sendRow: { flexDirection: 'row', gap: 10 },
  linkBtn: { alignItems: 'center', paddingVertical: 6, marginBottom: 6 },
  linkText: { fontSize: 15, color: colors.subtext, textDecorationLine: 'underline' },
  customer: { minHeight: 70, textAlignVertical: 'top' },
  line: { borderBottomWidth: 0.5, borderBottomColor: colors.border, paddingVertical: 8 },
  lineTop: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  lineInput: { backgroundColor: colors.panel2, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 16, color: colors.text },
  lineDesc: { flex: 1, minWidth: 0 },
  lineQty: { width: 70 },
  lineUnit: { width: 64 },
  linePrice: { width: 88 },
  lineAmt: { flex: 1, minWidth: 0, textAlign: 'right', fontSize: 16, fontWeight: '700', color: colors.text },
  lineX: { paddingHorizontal: 10, paddingVertical: 8 },
  lineGap: { marginTop: 10 },
  readBtn: { marginBottom: 12 },
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
  pourBtn: { marginTop: 12 },
  pourBig: { fontSize: 28, fontWeight: '300', color: colors.accent, marginVertical: 2 },
  scans: { gap: 10, paddingBottom: 10 },
  scanThumb: { width: 130 },
  scanImg: { width: 130, height: 170, borderRadius: 10, backgroundColor: colors.panel2 },
  scanLabel: { fontSize: 12, color: colors.subtext, marginTop: 4 },
}));

// Rebuilt when the colors or text size change.
let styles = getStyles();
onThemeChange(() => {
  styles = getStyles();
});
