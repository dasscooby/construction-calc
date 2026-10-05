import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';

import { feel } from '../lib/feel';
import { dayLabel, timeLabel } from '../lib/history';
import { Job, JobItem, jobStore, PriceLine, useJobs, yardsIn } from '../lib/jobs';
import { deleteJobScans, deleteScanFile, scanPages, scannerAvailable, scansForReport } from '../lib/scanner';
import { pickError, pickPlanFileNative, pickPlanFileWeb, pickPlanPhotoNative, planItems, processPlanQueue, savePendingFile } from '../lib/planReader';
import { asDataUris, deleteFile, photosAvailable, pickJobPhotos } from '../lib/media';
import { Settings, useSettings } from '../lib/settings';
import type { DocMedia } from '../report/docStyle';
import { dec } from '../tools/format';
import { liveActivitiesSupported } from '../widgets/bridge';
import { openReport } from '../report/open';
import { buildBid, buildBill, buildChange, lineAmount, priceTotals } from '../report/billing';
import { bidOptions, lineFor, refreshLines, UNITS } from '../report/bidOptions';
import PickSheet from './PickSheet';
import SignaturePad from './SignaturePad';
import { orderText, PLACE_TEXT, sendOrder } from '../lib/order';
import { dayName, fetchForecast, pourWarnings } from '../lib/weather';
import type { ConcreteOrder } from '../lib/jobs';
import { buildReport, figureItems, FiguredItem, foundationDrawings, jobTotals } from '../report/report';
import DrawingView from './DrawingView';
import HeightRuns from './HeightRuns';
import { findFoundation, foundationLines, foundationParts } from '../report/foundation';
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
  const totals = useMemo(() => jobTotals(figured, job), [figured, job]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const canScan = useMemo(scannerAvailable, []);
  const viewReport = () => sendDoc(job, prefs, (m) => buildReport(job, prefs, { crew: true, ...m }), job.name);
  const [photoError, setPhotoError] = useState('');
  const canPhoto = useMemo(() => Platform.OS !== 'web' && photosAvailable(), []);
  const addPhotos = async () => {
    setPhotoError('');
    try {
      const uris = await pickJobPhotos(job.id);
      if (uris.length) {
        jobStore.addPhotos(job.id, uris);
        feel.success();
      }
    } catch (e) {
      setPhotoError(pickError(e));
    }
  };
  const scan = async () => {
    setScanning(true);
    setScanError('');
    try {
      const pages = await scanPages(job.id);
      if (pages.length) {
        jobStore.addScans(job.id, pages);
        feel.success();
      }
    } catch (e) {
      setScanError(pickError(e));
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

        <FoundationCard job={job} figured={figured} />

        <Text style={styles.section}>Send out</Text>
        <Pressable onPress={viewReport} style={[styles.primary, styles.wide]} accessibilityRole="button">
          <Text style={styles.primaryText}>Crew sheet</Text>
          <Text style={styles.primarySub}>Plans, drawings, load list, notes. No prices.</Text>
        </Pressable>
        <View style={styles.sendRow}>
          <Pressable
            onPress={() => sendDoc(job, prefs, (m) => buildBid(job, prefs, figured, undefined, m), `${job.name} bid`)}
            style={[styles.secondary, styles.half]}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryText}>Bid</Text>
          </Pressable>
          <Pressable
            onPress={() => sendDoc(job, prefs, (m) => buildBill(job, prefs, figured, undefined, m), `${job.name} bill`)}
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

        <OrderCard job={job} yd={totals.concreteOrderYd} />
        <WeatherCard job={job} />
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
            {scanError ? <Text style={styles.warn}>{scanError}</Text> : null}
          </>
        )}

        {canPhoto || (job.photos?.length ?? 0) > 0 ? (
          <>
            <Text style={styles.section}>Photos</Text>
            {job.photos?.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scans}>
                {job.photos.map((uri, i) => (
                  <Pressable
                    key={uri}
                    onPress={() => {
                      jobStore.removePhoto(job.id, uri);
                      deleteFile(uri);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete photo ${i + 1}`}
                    style={styles.scanThumb}
                  >
                    <Image source={{ uri }} style={styles.photoImg} resizeMode="cover" />
                    <Text style={styles.scanLabel}>Tap to delete</Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
            {canPhoto ? (
              <Pressable onPress={() => void addPhotos()} style={styles.secondary} accessibilityRole="button">
                <Text style={styles.secondaryText}>Add photos</Text>
              </Pressable>
            ) : null}
            {photoError ? <Text style={styles.warn}>{photoError}</Text> : null}
            {job.photos?.length ? <Text style={styles.help}>Photos go on the crew sheet.</Text> : null}
          </>
        ) : null}

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
  const [added, setAdded] = useState<string[]>([]);
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
  const readScan = (uri: string, mediaType = 'image/jpeg') => {
    jobStore.queuePlan(job.id, { uri, mediaType });
    void processPlanQueue();
  };
  const [busy, setBusy] = useState(false);
  const canScan = useMemo(scannerAvailable, []);
  // Phone app: scan, pick a PDF/file, or pick a photo; whatever comes back is saved with the job and read.
  const phone = async (how: 'scan' | 'file' | 'photo') => {
    setBusy(true);
    jobStore.setPlanFound(job.id, found); // clears an old error
    try {
      if (how === 'scan') {
        const pages = await scanPages(job.id);
        if (pages.length) {
          jobStore.addScans(job.id, pages);
          pages.forEach((uri) => jobStore.queuePlan(job.id, { uri, mediaType: 'image/jpeg' }));
          void processPlanQueue();
        }
      } else {
        const picked = how === 'file' ? await pickPlanFileNative(job.id) : await pickPlanPhotoNative(job.id);
        if (picked) readScan(picked.uri, picked.mediaType);
      }
    } catch (e) {
      const msg = pickError(e);
      if (msg) jobStore.planDone(job.id, '', { error: msg });
    }
    setBusy(false);
  };
  const scans = job.scans ?? [];
  const items = useMemo(() => (found ? planItems(found) : []), [found]);
  const add = (it: (typeof items)[number]) => {
    feel.tap();
    jobStore.addItem(job.id, { toolId: it.toolId, title: it.title, label: it.label, raw: it.raw });
    setAdded((x) => [...x, it.key]);
  };
  // Everything on the plan into the job, so the order summary and "Fill in from job" on the bid have it all.
  const addAll = () => {
    const todo = items.filter((it) => !added.includes(it.key));
    todo.forEach((it) => jobStore.addItem(job.id, { toolId: it.toolId, title: it.title, label: it.label, raw: it.raw }));
    setAdded((x) => [...x, ...todo.map((it) => it.key)]);
    feel.success();
  };

  return (
    <>
      <Text style={styles.section}>Read a plan</Text>
      {Platform.OS === 'web' ? (
        <Pressable onPress={() => void pickWeb()} style={styles.secondary} accessibilityRole="button">
          <Text style={styles.secondaryText}>Pick a PDF or picture</Text>
        </Pressable>
      ) : (
        <>
          <View style={styles.sendRow}>
            {canScan ? (
              <Pressable onPress={() => void phone('scan')} disabled={busy} style={[styles.smallBtn, styles.readBtn]} accessibilityRole="button">
                <Text style={styles.smallBtnText}>Scan a plan</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={() => void phone('file')} disabled={busy} style={[styles.smallBtn, styles.readBtn]} accessibilityRole="button">
              <Text style={styles.smallBtnText}>PDF or file</Text>
            </Pressable>
            <Pressable onPress={() => void phone('photo')} disabled={busy} style={[styles.smallBtn, styles.readBtn]} accessibilityRole="button">
              <Text style={styles.smallBtnText}>Photo</Text>
            </Pressable>
          </View>
          {scans.length ? (
            <>
              <Text style={styles.help}>Or read a page you already scanned:</Text>
              <View style={styles.sendRow}>
                {scans.slice(0, 4).map((uri, i) => (
                  <Pressable key={uri} onPress={() => readScan(uri)} style={[styles.smallBtn, styles.readBtn]} accessibilityRole="button">
                    <Text style={styles.smallBtnText}>Page {i + 1}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}
        </>
      )}
      {waiting ? (
        <Text style={styles.help}>
          Reading {waiting === 1 ? 'the plan' : `${waiting} plans`}… No signal? It’s saved and gets read as soon as you have service.
        </Text>
      ) : null}
      {error ? <Text style={styles.warn}>{error}</Text> : null}
      {found && (items.length > 0 || found.notes.length > 0) ? (
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
          {items.filter((it) => !added.includes(it.key)).length > 1 ? (
            <Pressable onPress={addAll} style={[styles.primary, styles.lineGap]} accessibilityRole="button">
              <Text style={styles.primaryText}>Add everything to the job</Text>
            </Pressable>
          ) : null}
          {items.map((it) => (
            <View key={it.key} style={styles.line}>
              <Text style={styles.cardTitle}>{it.label}</Text>
              <Text style={styles.cardSub}>
                {it.title} · {it.summary}
              </Text>
              <Pressable onPress={() => add(it)} disabled={added.includes(it.key)} style={[styles.smallBtn, styles.lineGap]} accessibilityRole="button">
                <Text style={styles.smallBtnText}>{added.includes(it.key) ? 'Added to the job. Open it to check.' : 'Add to job'}</Text>
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

/**
 * Makes a document with your logo (and, on the phone, the job's photos and scanned plans) and opens it.
 * Web: everything is already in memory, so it opens straight from the tap (Safari only allows that).
 */
export function sendDoc(job: Job | null, s: Settings, make: (m: DocMedia) => { html: string; text: string }, title: string): void {
  if (Platform.OS === 'web') {
    const r = make({ logo: s.docs.logo || undefined });
    openReport(r.html, r.text, title);
    return;
  }
  void (async () => {
    const [logo] = s.docs.logo ? await asDataUris([s.docs.logo]) : [];
    const photos = job?.photos?.length ? await asDataUris(job.photos) : [];
    const scans = job?.scans?.length ? await scansForReport(job.scans) : [];
    const r = make({ logo, photos, scans });
    openReport(r.html, r.text, title);
  })();
}

/** Walls, footings and slab that make one foundation, and how the slab is bid. */
function FoundationCard({ job, figured }: { job: Job; figured: FiguredItem[] }) {
  const prefs = useSettings();
  const f = useMemo(() => findFoundation(figured, job), [figured, job]);
  const drawings = useMemo(() => (f?.confirmed ? foundationDrawings(job, figured, prefs.company.name) : null), [f, job, figured, prefs.company.name]);
  if (!f) return null;
  const lines = foundationLines(f).filter((l) => !l.startsWith('Bid the slab'));
  const toggle = () => {
    feel.tap();
    jobStore.edit(job.id, { together: f.confirmed ? undefined : { ids: f.ids, slabDropIn: job.together?.slabDropIn ?? '' } });
  };
  if (!f.confirmed) {
    return (
      <View style={styles.card}>
        <Text style={styles.label}>These look like they go together</Text>
        {foundationParts(f).map((l) => (
          <Text key={l} style={styles.fndLine}>
            • {l}
          </Text>
        ))}
        <Pressable onPress={toggle} style={[styles.checkRow, styles.lineGap]} accessibilityRole="checkbox" accessibilityState={{ checked: false }}>
          <View style={styles.checkBox} />
          <Text style={styles.checkText}>They go together ({f.kind.toLowerCase()})</Text>
        </Pressable>
        <Text style={styles.help}>Check it and the slab is figured inside the walls, the footings under them, and the bid groups them.</Text>
      </View>
    );
  }
  const chip = (on: boolean, label: string, onPress: () => void) => (
    <Pressable key={label} onPress={onPress} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
  const inside = job.slabBid === 'inside';
  return (
    <View style={styles.card}>
      <Pressable onPress={toggle} style={styles.checkRow} accessibilityRole="checkbox" accessibilityState={{ checked: true }}>
        <View style={[styles.checkBox, styles.checkOn]}>
          <Text style={styles.checkMark}>✓</Text>
        </View>
        <Text style={styles.label}>Foundation: {f.kind}</Text>
      </Pressable>
      {lines.map((l) => (
        <Text key={l} style={styles.fndLine}>
          • {l}
        </Text>
      ))}
      {f.slab ? (
        <View style={[styles.sumRow, styles.lineGap]}>
          <Text style={styles.sumLabel}>Top of slab below top of wall</Text>
          <View style={styles.dropBox}>
            <TextInput
              style={[styles.lineInput, styles.dropInput]}
              value={job.together?.slabDropIn ?? ''}
              onChangeText={(slabDropIn) => jobStore.edit(job.id, { together: { ids: f.ids, slabDropIn } })}
              placeholder={String(f.slabDropIn)}
              placeholderTextColor={colors.faint}
              keyboardType="decimal-pad"
              accessibilityLabel="Top of slab below top of wall, inches"
            />
            <Text style={styles.sumLabel}>in</Text>
          </View>
        </View>
      ) : null}
      {f.outline ? <HeightRuns job={job} f={f} /> : null}
      {drawings ? (
        <View style={styles.lineGap}>
          <DrawingView drawings={drawings} />
        </View>
      ) : null}
      {f.slab && f.slabAtOutside ? (
        <>
          <Text style={[styles.cardSub, styles.lineGap]}>Bid the slab at</Text>
          <View style={styles.chipRow}>
            {chip(!inside, 'House size (as measured)', () => jobStore.edit(job.id, { slabBid: 'outside' }))}
            {chip(inside, 'Inside (what you pour)', () => jobStore.edit(job.id, { slabBid: 'inside' }))}
          </View>
        </>
      ) : null}
    </View>
  );
}

/** The concrete order: PSI, how it goes in, when; one tap texts it to the supplier. */
function OrderCard({ job, yd }: { job: Job; yd: number }) {
  const prefs = useSettings();
  const [open, setOpen] = useState(false);
  if (!yd) return null;
  const o: ConcreteOrder = job.order ?? { psi: prefs.supplier.psi || '3000', place: 'chute', when: '' };
  const set = (patch: Partial<ConcreteOrder>) => jobStore.setOrder(job.id, { ...o, ...patch });
  const chip = (on: boolean, label: string, onPress: () => void) => (
    <Pressable key={label} onPress={onPress} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} style={styles.secondary} accessibilityRole="button">
        <Text style={styles.secondaryText}>Order concrete ({yd.toFixed(2)} yd)</Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.card}>
      <Text style={styles.label}>Order concrete: {yd.toFixed(2)} yd</Text>
      <Text style={styles.cardSub}>PSI</Text>
      <View style={styles.chipRow}>{['2500', '3000', '3500', '4000', '4500'].map((p) => chip(o.psi === p, p, () => set({ psi: p })))}</View>
      <Text style={styles.cardSub}>How it goes in</Text>
      <View style={styles.chipRow}>{(Object.keys(PLACE_TEXT) as ConcreteOrder['place'][]).map((k) => chip(o.place === k, PLACE_TEXT[k], () => set({ place: k })))}</View>
      <TextInput
        style={[styles.field, styles.lineGap]}
        value={o.when}
        onChangeText={(when) => set({ when })}
        placeholder="When (Tue 7 am)"
        placeholderTextColor={colors.faint}
        accessibilityLabel="When"
      />
      <Pressable
        onPress={() => {
          feel.tap();
          void sendOrder(prefs.supplier.phone, orderText(job, prefs, yd, o));
        }}
        style={styles.primary}
        accessibilityRole="button"
      >
        <Text style={styles.primaryText}>{prefs.supplier.phone ? `Text ${prefs.supplier.name || 'the supplier'}` : 'Send the order'}</Text>
      </Pressable>
      {!prefs.supplier.phone ? <Text style={[styles.help, styles.lineGap]}>Add your supplier’s number in Settings to text it straight to them.</Text> : null}
    </View>
  );
}

/** 7-day forecast for the job address, with what to watch for on a pour day. */
function WeatherCard({ job }: { job: Job }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const f = job.weather;
  const check = async () => {
    setBusy(true);
    setError('');
    try {
      jobStore.setWeather(job.id, await fetchForecast(job.address));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Weather isn’t available right now.');
    }
    setBusy(false);
  };
  if (!job.address.trim()) return null;
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.label}>Pour-day weather</Text>
        <Pressable onPress={() => void check()} disabled={busy} accessibilityRole="button" accessibilityLabel="Check the weather">
          <Text style={styles.smallBtnText}>{busy ? 'Checking…' : f ? 'Refresh' : 'Check'}</Text>
        </Pressable>
      </View>
      {f ? (
        <>
          <Text style={styles.cardSub}>
            {f.place} · {new Date(f.at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
          </Text>
          {f.days.map((d) => {
            const warn = pourWarnings(d);
            return (
              <View key={d.date} style={styles.line}>
                <View style={styles.sumRow}>
                  <Text style={styles.dayName}>{dayName(d.date)}</Text>
                  <Text style={styles.dayNums}>
                    {d.hi}° / {d.lo}° · rain {d.rain}% · wind {d.wind}
                  </Text>
                </View>
                {warn.length ? warn.map((w) => <Text key={w} style={styles.warn}>{w}</Text>) : <Text style={styles.goodDay}>Good for pouring</Text>}
              </View>
            );
          })}
        </>
      ) : (
        <Text style={styles.help}>Tap Check for the 7-day forecast at the job.</Text>
      )}
      {error ? <Text style={styles.warn}>{error}</Text> : null}
    </View>
  );
}

/** Customer and price lines for the bid and the final bill. */
function Prices({ job, figured }: { job: Job; figured: FiguredItem[] }) {
  const prefs = useSettings();
  const lines = job.lines ?? [];
  const m = priceTotals(job);
  const withChanges = priceTotals(job, true);
  const changes = job.changes ?? [];
  // Who's signing: the bid, or one change order.
  const [signing, setSigning] = useState<{ change?: string } | null>(null);
  const firstName = (job.customer ?? '').split('\n')[0].trim();

  // What each line can be, found in the job. Lines you tied to the job keep today's numbers.
  const sources = useMemo(() => bidOptions(figured, prefs, job), [figured, prefs, job]);
  useEffect(() => {
    const next = refreshLines(lines, sources);
    if (next.some((l, i) => l !== lines[i])) jobStore.setLines(job.id, next);
  }, [sources]);
  const [picking, setPicking] = useState<{ kind: 'what' | 'measure' | 'unit'; line: number | 'new' } | null>(null);
  const depositPct = Number(prefs.prices.depositPct.replace(/[%\s]/g, '')) || 0;
  const deposit = Math.round(m.total * depositPct) / 100;
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
        {lines.length === 0 ? <Text style={styles.help}>Tap + Add a line, then pick what it is. The list comes from this job.</Text> : null}
        {lines.map((l, i) => {
          const src = sources.find((x) => x.src === l.src);
          const meas = src?.measures.find((x) => x.id === l.measure);
          return (
            <View key={l.id} style={styles.line}>
              <View style={styles.lineTop}>
                <Pressable onPress={() => setPicking({ kind: 'what', line: i })} style={[styles.dropdown, styles.lineDesc]} accessibilityRole="button" accessibilityLabel={`Line ${i + 1} what it is`}>
                  <Text style={styles.dropText} numberOfLines={1}>
                    {src && src.src !== 'other' ? src.what : 'Something else'}
                  </Text>
                  <Text style={styles.dropArrow}>▾</Text>
                </Pressable>
                <Pressable onPress={() => jobStore.setLines(job.id, lines.filter((_, j) => j !== i))} style={styles.lineX} accessibilityRole="button" accessibilityLabel={`Remove line ${i + 1}`}>
                  <Text style={[styles.smallBtnText, styles.danger]}>✕</Text>
                </Pressable>
              </View>
              <View style={styles.lineTop}>{box(l.desc, (desc) => setLine(i, { desc }), 'Wording on the bid', `Line ${i + 1} wording`, styles.lineDesc, false)}</View>
              {src && src.measures.length ? (
                <View style={styles.lineTop}>
                  <Pressable onPress={() => setPicking({ kind: 'measure', line: i })} style={[styles.dropdown, styles.lineDesc]} accessibilityRole="button" accessibilityLabel={`Line ${i + 1} measured by`}>
                    <Text style={styles.dropText} numberOfLines={1}>
                      {meas ? meas.label : 'My own number'}
                    </Text>
                    <Text style={styles.dropArrow}>▾</Text>
                  </Pressable>
                </View>
              ) : null}
              <View style={styles.lineTop}>
                {box(l.qty, (qty) => setLine(i, { qty, measure: undefined }), 'Qty', `Line ${i + 1} quantity`, styles.lineQty)}
                <Pressable onPress={() => setPicking({ kind: 'unit', line: i })} style={[styles.dropdown, styles.lineUnit]} accessibilityRole="button" accessibilityLabel={`Line ${i + 1} unit`}>
                  <Text style={styles.dropText} numberOfLines={1}>
                    {l.unit || 'unit'}
                  </Text>
                  <Text style={styles.dropArrow}>▾</Text>
                </Pressable>
                {box(l.price, (price) => setLine(i, { price }), '$ each', `Line ${i + 1} price`, styles.linePrice)}
                <Text style={styles.lineAmt} numberOfLines={1}>
                  {money(lineAmount(l))}
                </Text>
              </View>
              {meas ? <Text style={styles.linked}>From the job: updates when the job changes</Text> : null}
            </View>
          );
        })}
        <Pressable onPress={() => setPicking({ kind: 'what', line: 'new' })} style={styles.addLine} accessibilityRole="button">
          <Text style={styles.addLineText}>+ Add a line</Text>
        </Pressable>
        <PickSheet
          visible={!!picking}
          title={picking?.kind === 'what' ? 'What is it?' : picking?.kind === 'measure' ? 'Measured by' : 'Unit'}
          options={
            picking?.kind === 'what'
              ? sources.map((x) => ({ key: x.src, label: x.src === 'other' ? 'Something else (type it in)' : x.what, sub: x.measures[0]?.label, group: x.group }))
              : picking?.kind === 'measure'
                ? [
                    ...(sources.find((x) => typeof picking.line === 'number' && x.src === lines[picking.line]?.src)?.measures ?? []).map((x) => ({ key: x.id, label: x.label })),
                    { key: '__own', label: 'My own number' },
                  ]
                : UNITS.map((u) => ({ key: u, label: u }))
          }
          selected={
            picking && typeof picking.line === 'number'
              ? picking.kind === 'what'
                ? lines[picking.line]?.src ?? 'other'
                : picking.kind === 'measure'
                  ? lines[picking.line]?.measure ?? '__own'
                  : lines[picking.line]?.unit
              : undefined
          }
          onClose={() => setPicking(null)}
          onPick={(key) => {
            if (!picking) return;
            const i = picking.line;
            if (picking.kind === 'what') {
              const src = sources.find((x) => x.src === key)!;
              const fresh = lineFor(src);
              if (i === 'new') jobStore.setLines(job.id, [...lines, { id: '', ...fresh }]);
              else setLine(i, { ...fresh, price: fresh.price || lines[i].price });
              if (!job.taxPct && prefs.prices.taxPct) jobStore.edit(job.id, { taxPct: prefs.prices.taxPct });
            } else if (typeof i === 'number') {
              const l = lines[i];
              const src = sources.find((x) => x.src === l.src);
              if (picking.kind === 'measure') {
                const m = src?.measures.find((x) => x.id === key);
                if (!m) setLine(i, { measure: undefined });
                else {
                  const fresh = lineFor(src!, m.id);
                  setLine(i, { measure: m.id, qty: fresh.qty, unit: m.unit, price: l.unit === m.unit ? l.price : fresh.price || l.price });
                }
              } else {
                setLine(i, { unit: key, price: l.price || src?.prices[key] || '' });
              }
            }
            setPicking(null);
          }}
        />
        <View style={[styles.sumRow, styles.lineGap]}>
          <Text style={styles.sumLabel}>Tax %</Text>
          {box(job.taxPct ?? '', (taxPct) => jobStore.edit(job.id, { taxPct }), '0', 'Tax percent', styles.lineQty)}
        </View>
        <View style={styles.sumRow}>
          <Text style={styles.sumLabel}>Paid so far (deposit)</Text>
          {box(job.paid ?? '', (paid) => jobStore.edit(job.id, { paid }), '$0', 'Paid so far', styles.linePrice)}
        </View>
        {lines.length ? (
          <View style={styles.itemBtns}>
            {deposit > 0 && !withChanges.paid ? (
              <Pressable onPress={() => jobStore.edit(job.id, { paid: deposit.toFixed(2) })} style={styles.smallBtn} accessibilityRole="button">
                <Text style={styles.smallBtnText}>Deposit received ({money(deposit)})</Text>
              </Pressable>
            ) : null}
            {withChanges.balance > 0.004 ? (
              <Pressable onPress={() => jobStore.edit(job.id, { paid: withChanges.total.toFixed(2) })} style={styles.smallBtn} accessibilityRole="button">
                <Text style={styles.smallBtnText}>Paid in full</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        <View style={[styles.sumRow, styles.lineGap]}>
          <Text style={styles.sumLabel}>Bid total</Text>
          <Text style={styles.sumValue}>{money(m.total)}</Text>
        </View>
        {withChanges.total !== m.total ? (
          <View style={styles.sumRow}>
            <Text style={styles.sumLabel}>With change orders</Text>
            <Text style={styles.sumValue}>{money(withChanges.total)}</Text>
          </View>
        ) : null}
        {withChanges.paid ? (
          <View style={styles.sumRow}>
            <Text style={styles.sumLabel}>Balance due</Text>
            <Text style={styles.sumValue}>{money(withChanges.balance)}</Text>
          </View>
        ) : null}
        {job.signature ? (
          <View style={[styles.sumRow, styles.lineGap]}>
            <Text style={styles.signedText}>
              ✓ Bid signed by {job.signature.name}, {new Date(job.signature.at).toLocaleDateString()}
            </Text>
            <Pressable onPress={() => jobStore.sign(job.id, undefined)} accessibilityRole="button" accessibilityLabel="Remove the bid signature">
              <Text style={[styles.smallBtnText, styles.danger]}>Remove</Text>
            </Pressable>
          </View>
        ) : lines.length ? (
          <Pressable onPress={() => setSigning({})} style={[styles.smallBtn, styles.lineGap]} accessibilityRole="button">
            <Text style={styles.smallBtnText}>Customer signs the bid</Text>
          </Pressable>
        ) : null}
      </View>

      <Text style={styles.section}>Change orders</Text>
      <View style={styles.card}>
        {changes.length === 0 ? <Text style={styles.help}>Extra work after the bid. Each one prints for the customer to sign and goes on the final bill.</Text> : null}
        {changes.map((c) => (
          <View key={c.id} style={styles.line}>
            <Text style={styles.cardSub}>Change order #{c.no}</Text>
            <View style={styles.lineTop}>
              {box(c.desc, (desc) => jobStore.editChange(job.id, c.id, { desc }), 'What changed', `Change order ${c.no} description`, styles.lineDesc, false)}
              <Pressable onPress={() => jobStore.removeChange(job.id, c.id)} style={styles.lineX} accessibilityRole="button" accessibilityLabel={`Remove change order ${c.no}`}>
                <Text style={[styles.smallBtnText, styles.danger]}>✕</Text>
              </Pressable>
            </View>
            <View style={styles.lineTop}>
              {box(c.qty, (qty) => jobStore.editChange(job.id, c.id, { qty }), 'Qty', `Change order ${c.no} quantity`, styles.lineQty)}
              {box(c.unit, (unit) => jobStore.editChange(job.id, c.id, { unit }), 'unit', `Change order ${c.no} unit`, styles.lineUnit, false)}
              {box(c.price, (price) => jobStore.editChange(job.id, c.id, { price }), '$ each', `Change order ${c.no} price`, styles.linePrice)}
              <Text style={styles.lineAmt} numberOfLines={1}>
                {money(lineAmount(c))}
              </Text>
            </View>
            <View style={styles.itemBtns}>
              <Pressable
                onPress={() => sendDoc(job, prefs, (md) => buildChange(job, prefs, c, undefined, md), `${job.name} change order ${c.no}`)}
                style={styles.smallBtn}
                accessibilityRole="button"
              >
                <Text style={styles.smallBtnText}>Print</Text>
              </Pressable>
              {c.signature ? (
                <Pressable onPress={() => jobStore.editChange(job.id, c.id, { signature: undefined })} style={styles.smallBtn} accessibilityRole="button">
                  <Text style={styles.signedText}>✓ {c.signature.name}</Text>
                </Pressable>
              ) : (
                <Pressable onPress={() => setSigning({ change: c.id })} style={styles.smallBtn} accessibilityRole="button">
                  <Text style={styles.smallBtnText}>Sign</Text>
                </Pressable>
              )}
            </View>
          </View>
        ))}
        <Pressable onPress={() => jobStore.addChange(job.id)} style={[styles.smallBtn, styles.lineGap]} accessibilityRole="button">
          <Text style={styles.smallBtnText}>+ Add change order</Text>
        </Pressable>
      </View>

      <SignaturePad
        visible={!!signing}
        title={signing?.change ? `Approve change order #${changes.find((c) => c.id === signing.change)?.no ?? ''}` : 'Accept the bid'}
        defaultName={firstName}
        onCancel={() => setSigning(null)}
        onDone={(sig) => {
          if (signing?.change) jobStore.editChange(job.id, signing.change, { signature: sig });
          else jobStore.sign(job.id, sig);
          setSigning(null);
        }}
      />
    </>
  );
}

const getStyles = themed(() => ({
  primarySub: { fontSize: 13, color: colors.accentText, opacity: 0.8, marginTop: 2 },
  sendRow: { flexDirection: 'row', gap: 10 },
  dropdown: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.panel2, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9 },
  dropText: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  dropArrow: { fontSize: 15, color: colors.accent, marginLeft: 4 },
  linked: { fontSize: 12, color: colors.subtext, marginTop: 4 },
  addLine: { borderWidth: 1, borderColor: colors.faint, borderStyle: 'dashed', borderRadius: 12, padding: 12, alignItems: 'center', marginTop: 10 },
  addLineText: { fontSize: 16, fontWeight: '700', color: colors.accent },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkBox: { width: 28, height: 28, borderRadius: 8, borderWidth: 2, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.accent },
  checkMark: { fontSize: 18, fontWeight: '900', color: colors.accentText },
  checkText: { flex: 1, fontSize: 17, fontWeight: '700', color: colors.text },
  dropBox: { flexDirection: 'row', alignItems: 'center', gap: 6, width: 100 },
  dropInput: { width: 64 },
  fndLine: { fontSize: 15, color: colors.text, lineHeight: 21, marginBottom: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6, marginBottom: 8 },
  chip: { backgroundColor: colors.panel2, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  chipOn: { backgroundColor: colors.accent },
  chipText: { fontSize: 15, fontWeight: '600', color: colors.text },
  chipTextOn: { color: colors.accentText, fontWeight: '800' },
  dayName: { fontSize: 16, fontWeight: '700', color: colors.text },
  dayNums: { fontSize: 15, color: colors.subtext },
  goodDay: { fontSize: 14, color: colors.subtext, marginTop: 2 },
  signedText: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.accent },
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
  photoImg: { width: 130, height: 130, borderRadius: 10, backgroundColor: colors.panel2 },
  scanImg: { width: 130, height: 170, borderRadius: 10, backgroundColor: colors.panel2 },
  scanLabel: { fontSize: 12, color: colors.subtext, marginTop: 4 },
}));

// Rebuilt when the colors or text size change.
let styles = getStyles();
onThemeChange(() => {
  styles = getStyles();
});
