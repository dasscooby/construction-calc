// The foundation layout editor: the plan on top (tap a wall or a bay), a run strip that never scrolls
// away, a big toolbar, and one step at a time below it: the main house, + Add-on (tap the wall it builds
// off, how far it comes out), + Inside walls (the bays between them, clear, wall face to wall face), and
// Slab & pours (tap the bays that get slab). Every step can be undone; nothing asks "are you sure".

import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { GestureResponderEvent, LayoutChangeEvent, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { feel } from '../lib/feel';
import { Job, jobStore } from '../lib/jobs';
import { addOnProblem, addedRuns, blankLayout, fmtFtIn, insideProblem, parseFtIn, putAddOn, removeAddOn, setBayLabel, setInside, setPour, Start, toggleSlab } from '../lib/layoutEdit';
import { AddOnSpec, bayName, buildLayout, fillBays, Layout, LayoutSpec, SIDE_NAME, Side, sideLength, SlabSpot } from '../report/foundationLayout';
import { layoutChildren, LayoutRaw, rollUp } from '../report/layoutItems';
import { graphPlanSvg, hitLayout, planFrame } from '../report/layoutPlanDraw';
import { insideCorners, PieceShape, PieceSpec } from '../report/layoutPieces';
import { dropPieceSteel, layoutSteel, LayoutRebar, NO_SLAB_STEEL, NO_STEPS_STEEL, noSteelYet, oldBars, OldBoxes, SlabSteel, spotKey, StepsSteel, WallSteel, withPieceSteel, withRebar } from '../report/layoutRebar';
import { faceAt } from '../report/wallGraph';
import { colors, onThemeChange, themed } from '../theme';

type Mode = 'idle' | 'main' | 'addon-pick' | 'addon-size' | 'inside' | 'slab' | 'piece' | 'rebar';

const SIDES: Side[] = ['left', 'top', 'right', 'bottom'];
const SIDE_SHORT: Record<Side, string> = { left: 'Left A–B', top: 'Back B–C', right: 'Right C–D', bottom: 'Front D–A' };
const MAIN_RUN: Record<Side, string> = { left: 'Main left A–B', top: 'Main back B–C', right: 'Main right C–D', bottom: 'Main front D–A' };

/** Order (yd) of each slab pour, from the pieces the layout figures as. */
function pourYards(raw: LayoutRaw): Record<number, number> {
  const out: Record<number, number> = {};
  for (const f of layoutChildren({ id: 'x', toolId: 'foundation-layout', title: '', label: '', raw: raw as never, at: 0 })) {
    const m = f.item.id.match(/:slab(\d+)$/);
    const order = f.result.status === 'ok' ? f.result.result.rows.find((r) => r.label === 'Order') : undefined;
    if (m && order) out[Number(m[1])] = Number(order.value.replace(/[^\d.]/g, ''));
  }
  return out;
}

export default function LayoutEditor({ job, start, preset, onClose }: { job: Job; start: Start | null; preset?: 'barn'; onClose: () => void }) {
  const existing = job.items.find((it) => it.toolId === 'foundation-layout');
  const initial: LayoutRaw = (existing?.raw as unknown as LayoutRaw) ?? { layout: start?.spec ?? blankLayout(), wall: start?.wall, footing: start?.footing, slab: start?.slab };
  const [raw, setRaw] = useState<LayoutRaw>(initial);
  const [undo, setUndo] = useState<LayoutSpec[]>([]);
  const [redo, setRedo] = useState<LayoutSpec[]>([]);
  const hasHouse = raw.layout.house.length > 0 && raw.layout.house.width > 0;
  const [mode, setMode] = useState<Mode>(hasHouse ? (preset === 'barn' ? 'addon-pick' : 'idle') : 'main');
  const [note, setNote] = useState<{ text: string; undoTo: LayoutSpec } | null>(null);
  const [showRuns, setShowRuns] = useState(false);
  const [pick, setPick] = useState<{ run?: number; face?: number }>({});
  const replaced = useRef(existing ? [] : start?.replace ?? []);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Work in progress for the step that's open (drawn live, saved on Done).
  const [draft, setDraft] = useState<LayoutSpec | null>(null);
  const spec = draft ?? raw.layout;
  const layout = useMemo<Layout | null>(() => (spec.house.length > 0 && spec.house.width > 0 ? buildLayout(spec) : null), [spec]);
  const yards = useMemo(() => (layout ? pourYards({ ...raw, layout: spec }) : {}), [raw, spec, layout]);

  /** Saves a finished step: keeps the old one for Undo and shows what changed. */
  const commit = (next: LayoutSpec, text?: string) => {
    const before = raw.layout;
    const r = { ...raw, layout: next };
    setRaw(r);
    setUndo((u) => [...u, before].slice(-50));
    setRedo([]);
    setDraft(null);
    jobStore.saveLayout(job.id, r as never, replaced.current);
    replaced.current = [];
    feel.success();
    if (text) {
      setNote({ text, undoTo: before });
      if (noteTimer.current) clearTimeout(noteTimer.current);
      noteTimer.current = setTimeout(() => setNote(null), 7000);
    }
  };
  const restore = (to: LayoutSpec, from: LayoutSpec, push: 'undo' | 'redo') => {
    const r = { ...raw, layout: to };
    setRaw(r);
    if (push === 'redo') setRedo((x) => [...x, from]);
    else setUndo((x) => [...x, from]);
    setDraft(null);
    setNote(null);
    jobStore.saveLayout(job.id, r as never);
    feel.tap();
  };
  const doUndo = () => {
    const prev = undo[undo.length - 1];
    if (!prev) return;
    setUndo((u) => u.slice(0, -1));
    restore(prev, raw.layout, 'redo');
  };
  const doRedo = () => {
    const next = redo[redo.length - 1];
    if (!next) return;
    setRedo((r) => r.slice(0, -1));
    restore(next, raw.layout, 'undo');
  };
  useEffect(() => () => {
    if (noteTimer.current) clearTimeout(noteTimer.current);
  }, []);

  // ---- the plan ----
  const [planW, setPlanW] = useState(0);
  const boltSpots = useMemo(() => {
    try {
      return layout?.spec.rebar ? layoutSteel(layout, layout.spec.rebar).bolts.runs.flatMap((b) => b.spots) : [];
    } catch {
      return [];
    }
  }, [layout]);
  const svg = useMemo(
    () => (layout ? graphPlanSvg(layout, { title: 'Foundation layout', job: job.name, company: '', date: '', pourYd: yards, highlight: pick, compact: true, bolts: boltSpots.length ? { spots: boltSpots, text: '' } : undefined }) : ''),
    [layout, job.name, yards, pick, boltSpots],
  );
  const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const vbW = vb ? Number(vb[1]) : 760;
  const vbH = vb ? Number(vb[2]) : 900;
  const onPlanTap = (e: GestureResponderEvent) => {
    if (!layout || !planW) return;
    const k = vbW / planW;
    const x = e.nativeEvent.locationX * k;
    const y = e.nativeEvent.locationY * k;
    if (mode === 'addon-pick') {
      // The main wall nearest the tap: a fat target, no fine aiming.
      const p = planFrame(layout).toPlan(x, y);
      const dist = (side: Side) => {
        const g = layout.graph.runs.find((r) => r.run.name === MAIN_RUN[side])?.run;
        if (!g) return Infinity;
        const tx = Math.max(Math.min(g.a.x, g.b.x), Math.min(Math.max(g.a.x, g.b.x), p.x));
        const ty = Math.max(Math.min(g.a.y, g.b.y), Math.min(Math.max(g.a.y, g.b.y), p.y));
        return Math.hypot(p.x - tx, p.y - ty);
      };
      pickWall([...SIDES].sort((u, v) => dist(u) - dist(v))[0]);
      return;
    }
    const hit = hitLayout(layout, x, y);
    if (mode === 'slab' && hit.face !== undefined) {
      const spot = spotOfFace(layout, hit.face);
      if (spot) toggleSlabAt(spot);
      return;
    }
    setPick(hit);
    if (hit.run !== undefined) setShowRuns(true);
  };

  // ---- + Add-on ----
  const [addon, setAddon] = useState<{ index?: number; side: Side; depth: string; part: boolean; from: string; width: string } | null>(null);
  const pickWall = (side: Side) => {
    feel.tap();
    setAddon({ side, depth: '', part: false, from: '', width: '' });
    setMode('addon-size');
  };
  const addonSpec = (): AddOnSpec | null => {
    if (!addon) return null;
    const wall = sideLength(spec, addon.side);
    const depth = parseFtIn(addon.depth) ?? 0;
    const from = addon.part ? parseFtIn(addon.from) ?? 0 : 0;
    const width = addon.part ? parseFtIn(addon.width) ?? Math.max(0, wall - from) : wall;
    const old = addon.index !== undefined ? raw.layout.addOns[addon.index] : undefined;
    return { ...(old ?? {}), side: addon.side, depth, from, width };
  };
  useEffect(() => {
    if (mode !== 'addon-size' || !addon) return;
    const a = addonSpec();
    const base = raw.layout;
    if (a && !addOnProblem(base, a)) setDraft(putAddOn(base, a, addon.index));
    else setDraft(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addon, mode]);
  const finishAddon = () => {
    const a = addonSpec();
    if (!a || addOnProblem(raw.layout, a)) return;
    const next = putAddOn(raw.layout, a, addon!.index);
    const added = addedRuns(raw.layout, next);
    commit(next, `Add-on in: ${fmtFtIn(added)} of wall${spec.footing ? ' and footing' : ''}. Its side walls tee into the main ${SIDE_NAME[a.side]} wall.`);
    setAddon(null);
    const idx = addon!.index ?? next.addOns.length - 1;
    setInsideIdx(idx);
    if (preset === 'barn') openInside(idx, next);
    else setMode('idle');
  };

  // ---- + Inside walls ----
  const [insideIdx, setInsideIdx] = useState(Math.max(0, raw.layout.addOns.length - 1));
  const [inside, setInsideState] = useState<{ dir: 'out' | 'across'; bays: string[]; same: boolean } | null>(null);
  const openInside = (i: number, base: LayoutSpec = raw.layout) => {
    const a = base.addOns[i];
    if (!a) return;
    setInsideIdx(i);
    const bays = a.bays && a.bays.length > 1 ? a.bays.map((b) => (b === null ? '' : fmtFtIn(b))) : ['', '', ''];
    const restAt = a.bays ? a.bays.findIndex((b) => b === null) : 1;
    setInsideState({ dir: a.inside ?? 'out', bays: bays.map((b, k) => (k === restAt ? 'rest' : b)), same: !a.bays || (a.bays.length > 2 && a.bays[0] === a.bays[a.bays.length - 1]) });
    setMode('inside');
  };
  const insideBays = (): (number | null)[] => (inside ? inside.bays.map((b) => (b === 'rest' || !b.trim() ? null : parseFtIn(b))) : []);
  const insideIssue = inside && raw.layout.addOns[insideIdx] ? insideProblem(raw.layout, insideIdx, inside.dir, insideBays()) : null;
  useEffect(() => {
    if (mode !== 'inside' || !inside || !raw.layout.addOns[insideIdx]) return;
    setDraft(insideIssue ? null : setInside(raw.layout, insideIdx, inside.dir, insideBays()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inside, mode, insideIdx]);
  const setBay = (k: number, v: string) => {
    if (!inside) return;
    const bays = [...inside.bays];
    bays[k] = v;
    // Same both ends: the first and last bays match.
    if (inside.same && bays.length > 2 && (k === 0 || k === bays.length - 1)) bays[k === 0 ? bays.length - 1 : 0] = v;
    setInsideState({ ...inside, bays });
  };
  const bayCount = (n: number) => {
    if (!inside) return;
    const count = Math.max(1, Math.min(8, n));
    const bays = Array.from({ length: count }, (_, k) => inside.bays[k] ?? '');
    if (!bays.includes('rest')) bays[Math.floor((count - 1) / 2)] = 'rest';
    setInsideState({ ...inside, bays });
  };
  const finishInside = () => {
    if (!inside || insideIssue) return;
    const before = raw.layout;
    const next = setInside(before, insideIdx, inside.dir, insideBays());
    const walls = Math.max(0, inside.bays.length - 1);
    commit(next, `${walls} inside wall${walls === 1 ? '' : 's'}: ${fmtFtIn(addedRuns(before, next))} of wall${spec.footing ? ' and footing' : ''}.`);
    setInsideState(null);
    setMode(preset === 'barn' ? 'slab' : 'idle');
  };

  // ---- Slab & pours ----
  const [dropText, setDropText] = useState(() => (raw.layout.slabDropIn !== undefined ? String(raw.layout.slabDropIn) : ''));
  const toggleSlabAt = (spot: SlabSpot) => {
    const next = toggleSlab(raw.layout, spot);
    const on = next.slabs.length > raw.layout.slabs.length;
    commit(next, on ? 'Slab added, its own pour.' : 'Slab taken out.');
  };

  // ---- Main ----
  const [main, setMain] = useState(() => ({
    length: hasHouse ? fmtFtIn(raw.layout.house.length) : '',
    width: hasHouse ? fmtFtIn(raw.layout.house.width) : '',
    wallT: String(Math.round(raw.layout.wall.thick * 12)),
    wallH: fmtFtIn(raw.layout.wall.height),
    footW: String(Math.round((raw.layout.footing?.width ?? 16 / 12) * 12)),
    footD: String(Math.round((raw.layout.footing?.depth ?? 10 / 12) * 12)),
    footing: !!raw.layout.footing,
    existing: !!raw.layout.existing,
    slab: hasHouse ? raw.layout.slabs.some((x) => x.at.in === 'main') : true,
  }));
  const mainSpec = (): LayoutSpec | null => {
    const L = parseFtIn(main.length);
    const W = parseFtIn(main.width);
    const t = Number(main.wallT) / 12;
    const h = parseFtIn(main.wallH);
    if (!L || !W || !(t > 0) || !h) return null;
    return {
      ...raw.layout,
      house: { length: L, width: W },
      wall: { thick: t, height: h },
      footing: main.footing ? { width: (Number(main.footW) || 16) / 12, depth: (Number(main.footD) || 10) / 12 } : null,
      existing: main.existing || undefined,
      // The main slab, one piece, on or off; slabs in add-on bays stay as they are.
      slabs: main.slab
        ? raw.layout.slabs.some((x) => x.at.in === 'main')
          ? raw.layout.slabs
          : [{ at: { in: 'main' }, thick: raw.layout.slabs[0]?.thick ?? 4 / 12 }, ...raw.layout.slabs]
        : raw.layout.slabs.filter((x) => x.at.in !== 'main'),
    };
  };
  const mainIssue = (() => {
    const s = mainSpec();
    if (!s) return 'Put in the length and width (outside), the wall size and height.';
    if (s.house.length <= 2 * s.wall.thick || s.house.width <= 2 * s.wall.thick) return 'The house is too small for that wall.';
    return null;
  })();
  const finishMain = () => {
    const s = mainSpec();
    if (!s || mainIssue) return;
    commit(s, `Main: ${fmtFtIn(s.house.length)} × ${fmtFtIn(s.house.width)}, ${fmtFtIn(2 * (s.house.length + s.house.width))} of wall${s.footing ? ' and footing' : ''}.`);
    setMode(preset === 'barn' ? 'addon-pick' : 'idle');
  };

  // ---- run strip ----
  const groups = layout ? [...new Set(layout.runs.map((r) => r.group))] : [];
  const strip = layout && groups.length === 1
    ? `${groups[0]} ${fmtFtIn(layout.totals.measured)} of wall${spec.footing ? ' and footing' : ''}${layout.runs.some((r) => r.existing) ? ' (existing)' : ''}`
    : layout
    ? `${groups.map((g) => `${g} ${fmtFtIn(layout.runs.filter((r) => r.group === g).reduce((s, r) => s + r.measured, 0))}${layout.runs.some((r) => r.group === g && r.existing) ? ' (existing)' : ''}`).join(' + ')} = ${fmtFtIn(layout.totals.measured)} wall${spec.footing ? ` · ${fmtFtIn(layout.totals.measured)} footing` : ''}`
    : 'Start with the main house';

  const btn = (label: string, onPress: () => void, opts: { on?: boolean; disabled?: boolean; label?: string } = {}) => (
    <Pressable
      key={label}
      onPress={() => {
        if (opts.disabled) return;
        feel.tap();
        onPress();
      }}
      style={[styles.tool, opts.on && styles.toolOn, opts.disabled && styles.toolOff]}
      accessibilityRole="button"
      accessibilityState={{ selected: !!opts.on, disabled: !!opts.disabled }}
      accessibilityLabel={opts.label ?? label}
    >
      <Text style={[styles.toolText, opts.on && styles.toolTextOn]}>{label}</Text>
    </Pressable>
  );
  const chip = (label: string, on: boolean, onPress: () => void, a11y?: string) => (
    <Pressable key={label} onPress={() => (feel.tap(), onPress())} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={a11y ?? label}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
  const done = (label: string, onPress: () => void, disabled: boolean) => (
    <View style={styles.doneRow}>
      <Pressable onPress={() => (setDraft(null), setMode('idle'), setAddon(null), setInsideState(null))} style={styles.cancel} accessibilityRole="button">
        <Text style={styles.cancelText}>Cancel</Text>
      </Pressable>
      <Pressable onPress={() => !disabled && onPress()} style={[styles.done, disabled && styles.toolOff]} accessibilityRole="button" accessibilityState={{ disabled }}>
        <Text style={styles.doneText}>{label}</Text>
      </Pressable>
    </View>
  );

  const addOnsHere = raw.layout.addOns;
  const a = addOnsHere[insideIdx];

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <Pressable onPress={onClose} style={styles.back} accessibilityRole="button" accessibilityLabel="Back to the job">
          <Text style={styles.backText}>‹ Job</Text>
        </Pressable>
        <Text style={styles.title}>Foundation layout</Text>
        <Pressable onPress={doUndo} style={[styles.hBtn, !undo.length && styles.toolOff]} accessibilityRole="button" accessibilityLabel="Undo">
          <Text style={styles.hBtnText}>↶ Undo</Text>
        </Pressable>
        <Pressable onPress={doRedo} style={[styles.hBtn, !redo.length && styles.toolOff]} accessibilityRole="button" accessibilityLabel="Redo">
          <Text style={styles.hBtnText}>↷</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" stickyHeaderIndices={[1]}>
        {/* 0: the plan */}
        <View onLayout={(e: LayoutChangeEvent) => setPlanW(e.nativeEvent.layout.width)}>
          {mode === 'addon-pick' ? <Text style={styles.banner}>Tap the wall it builds off</Text> : null}
          {mode === 'slab' ? <Text style={styles.banner}>Tap the bays that get slab</Text> : null}
          {layout && planW > 0 ? (
            <Pressable onPress={onPlanTap} accessibilityLabel="Foundation plan. Tap a wall or a bay." accessibilityRole="image">
              <SvgXml xml={svg} width={planW} height={(planW * vbH) / vbW} />
            </Pressable>
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>The plan draws itself as you put in sizes.</Text>
            </View>
          )}
        </View>

        {/* 1: run strip (sticks to the top) */}
        <View style={styles.stripWrap}>
          <Pressable onPress={() => layout && setShowRuns(true)} style={styles.strip} accessibilityRole="button" accessibilityLabel={`Runs: ${strip}. Tap for the run list.`}>
            <Text style={styles.stripText}>{strip}</Text>
            {layout ? <Text style={styles.stripMore}>Run list ›</Text> : null}
          </Pressable>
          <View style={styles.toolbar}>
            {btn('Main', () => setMode('main'), { on: mode === 'main' })}
            {btn('+ Add-on', () => setMode('addon-pick'), { on: mode === 'addon-pick' || mode === 'addon-size', disabled: !layout })}
            {btn('+ Inside walls', () => openInside(Math.min(insideIdx, addOnsHere.length - 1)), { on: mode === 'inside', disabled: !addOnsHere.length })}
            {btn('Slab & pours', () => setMode('slab'), { on: mode === 'slab', disabled: !layout })}
            {btn('+ Steps & pads', () => setMode('piece'), { on: mode === 'piece', disabled: !layout })}
            {btn('Rebar & bolts', () => setMode('rebar'), { on: mode === 'rebar', disabled: !layout })}
          </View>
        </View>

        <Text style={styles.rule}>Runs are measured outside to outside, each wall counted once. Yards use the middle of the wall, plus your waste.</Text>
        {layout?.problems.map((p) => (
          <Text key={p} style={styles.problem}>
            {p}
          </Text>
        ))}

        {/* ---- Main ---- */}
        {mode === 'main' ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Main house (outside)</Text>
            <View style={styles.row2}>
              <LenBox label="Length" value={main.length} onChange={(length) => setMain({ ...main, length })} autoFocus={!hasHouse} />
              <LenBox label="Width" value={main.width} onChange={(width) => setMain({ ...main, width })} />
            </View>
            <View style={styles.row2}>
              <NumBox label="Wall thick" unit="in" value={main.wallT} onChange={(wallT) => setMain({ ...main, wallT })} />
              <LenBox label="Wall height" value={main.wallH} onChange={(wallH) => setMain({ ...main, wallH })} />
            </View>
            <View style={styles.chips}>
              {chip('Footing under the walls', main.footing, () => setMain({ ...main, footing: true }))}
              {chip('No footing', !main.footing, () => setMain({ ...main, footing: false }))}
            </View>
            {main.footing ? (
              <View style={styles.row2}>
                <NumBox label="Footing wide" unit="in" value={main.footW} onChange={(footW) => setMain({ ...main, footW })} />
                <NumBox label="Footing deep" unit="in" value={main.footD} onChange={(footD) => setMain({ ...main, footD })} />
              </View>
            ) : null}
            <View style={styles.chips}>
              {chip('Slab in the house', main.slab, () => setMain({ ...main, slab: true }))}
              {chip('No slab', !main.slab, () => setMain({ ...main, slab: false }))}
            </View>
            <View style={styles.chips}>
              {chip('In this bid', !main.existing, () => setMain({ ...main, existing: false }))}
              {chip('Already there (not in bid)', main.existing, () => setMain({ ...main, existing: true }))}
            </View>
            {mainIssue ? <Text style={styles.help}>{mainIssue}</Text> : null}
            {done(hasHouse ? 'Done' : 'Next: add-ons', finishMain, !!mainIssue)}
          </View>
        ) : null}

        {/* ---- + Add-on: pick the wall ---- */}
        {mode === 'addon-pick' && layout ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Which main wall does it build off?</Text>
            <View style={styles.chips}>
              {SIDES.map((side) => chip(`${SIDE_SHORT[side]} ${fmtFtIn(sideLength(spec, side))}`, false, () => pickWall(side), `Builds off the ${SIDE_SHORT[side]} wall`))}
            </View>
            {addOnsHere.length ? (
              <>
                <Text style={styles.sub}>Or change one you have:</Text>
                {addOnsHere.map((o, i) => (
                  <View key={i} style={styles.listRow}>
                    <Text style={styles.listText}>
                      Add-on{addOnsHere.length > 1 ? ` ${i + 1}` : ''}: {fmtFtIn(o.width)} wide, out {fmtFtIn(o.depth)} off {SIDE_SHORT[o.side]}
                    </Text>
                    <Pressable
                      onPress={() => {
                        setAddon({ index: i, side: o.side, depth: fmtFtIn(o.depth), part: (o.from ?? 0) > 0 || o.width < sideLength(spec, o.side), from: fmtFtIn(o.from ?? 0), width: fmtFtIn(o.width) });
                        setMode('addon-size');
                      }}
                      style={styles.small}
                      accessibilityRole="button"
                    >
                      <Text style={styles.smallText}>Change</Text>
                    </Pressable>
                    <Pressable onPress={() => commit(removeAddOn(raw.layout, i), 'Add-on taken out.')} style={styles.small} accessibilityRole="button">
                      <Text style={[styles.smallText, styles.danger]}>Remove</Text>
                    </Pressable>
                  </View>
                ))}
              </>
            ) : null}
            {done('Close', () => setMode('idle'), false)}
          </View>
        ) : null}

        {/* ---- + Add-on: size ---- */}
        {mode === 'addon-size' && addon ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Off the main {SIDE_SHORT[addon.side]} wall</Text>
            <Text style={styles.sub}>Shared wall: already counted in Main.</Text>
            <LenBox label={`Comes out (from the outside of ${SIDE_SHORT[addon.side].split(' ')[1]})`} value={addon.depth} onChange={(depth) => setAddon({ ...addon, depth })} autoFocus wide />
            <View style={styles.chips}>
              {chip(`Full wall ${fmtFtIn(sideLength(spec, addon.side))}`, !addon.part, () => setAddon({ ...addon, part: false }))}
              {chip('Only part of it…', addon.part, () => setAddon({ ...addon, part: true }))}
            </View>
            {addon.part ? (
              <View style={styles.row2}>
                <LenBox label="From the corner" value={addon.from} onChange={(from) => setAddon({ ...addon, from })} />
                <LenBox label="Width" value={addon.width} onChange={(width) => setAddon({ ...addon, width })} />
              </View>
            ) : null}
            {(() => {
              const s = addonSpec();
              const p = s ? addOnProblem(raw.layout, s) : null;
              return p ? <Text style={styles.problem}>{p}</Text> : null;
            })()}
            {done('Done', finishAddon, (() => {
              const s = addonSpec();
              return !s || !!addOnProblem(raw.layout, s);
            })())}
          </View>
        ) : null}

        {/* ---- + Inside walls ---- */}
        {mode === 'inside' && inside && a ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Walls inside the add-on</Text>
            {addOnsHere.length > 1 ? <View style={styles.chips}>{addOnsHere.map((_, i) => chip(`Add-on ${i + 1}`, i === insideIdx, () => openInside(i)))}</View> : null}
            <View style={styles.chips}>
              {chip(`Front to back, ${fmtFtIn(a.depth)}`, inside.dir === 'out', () => setInsideState({ ...inside, dir: 'out' }), 'Walls run front to back, out from the main wall')}
              {chip(`Side to side, ${fmtFtIn(a.width)}`, inside.dir === 'across', () => setInsideState({ ...inside, dir: 'across' }), 'Walls run side to side, along the main wall')}
            </View>
            <View style={styles.countRow}>
              <Text style={styles.sub}>Inside walls</Text>
              <Pressable onPress={() => bayCount(inside.bays.length - 1)} style={styles.step} accessibilityRole="button" accessibilityLabel="One less inside wall">
                <Text style={styles.stepText}>−</Text>
              </Pressable>
              <Text style={styles.count}>{inside.bays.length - 1}</Text>
              <Pressable onPress={() => bayCount(inside.bays.length + 1)} style={styles.step} accessibilityRole="button" accessibilityLabel="One more inside wall">
                <Text style={styles.stepText}>+</Text>
              </Pressable>
            </View>
            <Text style={styles.sub}>
              Bays {inside.dir === 'out' ? 'across' : 'out'}, {bayWord(a, inside.dir)}, CLEAR (wall face to wall face):
            </Text>
            <View style={styles.bays}>
              {inside.bays.map((b, k) => {
                const fill = fillBays({ ...a, inside: inside.dir, bays: insideBays() }, spec.wall.thick);
                const isRest = b === 'rest';
                return (
                  <View key={k} style={styles.bay}>
                    {isRest ? (
                      <Pressable onPress={() => setBay(k, '')} style={[styles.box, styles.restBox]} accessibilityRole="button" accessibilityLabel={`Bay ${k + 1} is the rest, ${fmtFtIn(fill.widths[k])}. Tap to type it.`}>
                        <Text style={styles.calc}>rest</Text>
                      </Pressable>
                    ) : (
                      <TextInput
                        style={styles.box}
                        value={b}
                        onChangeText={(v) => setBay(k, v)}
                        placeholder="ft"
                        placeholderTextColor={colors.faint}
                        keyboardType="numbers-and-punctuation"
                        accessibilityLabel={`Bay ${k + 1} clear`}
                      />
                    )}
                    <Text style={[styles.bayCap, isRest && styles.calc]}>{Number.isFinite(fill.widths[k]) && fill.widths[k] > 0 ? fmtFtIn(fill.widths[k]) : '–'}</Text>
                  </View>
                );
              })}
            </View>
            <View style={styles.chips}>
              {chip('Same both ends', inside.same, () => setInsideState({ ...inside, same: !inside.same }))}
              {!inside.bays.includes('rest') ? chip('Make one "the rest"', false, () => setBay(Math.floor((inside.bays.length - 1) / 2), 'rest')) : null}
            </View>
            {insideIssue ? <Text style={styles.problem}>{insideIssue}</Text> : null}
            {done('Done', finishInside, !!insideIssue)}
          </View>
        ) : null}

        {/* ---- Steps & pads ---- */}
        {mode === 'piece' && layout ? (
          <PiecePanel
            layout={layout}
            onAdd={(p, text) => commit({ ...raw.layout, pieces: [...(raw.layout.pieces ?? []), p] }, text)}
            onRemove={(i) => commit(dropPieceSteel(raw.layout, i), 'Taken out.')}
            onClose={() => setMode('idle')}
            chip={chip}
          />
        ) : null}

        {/* ---- Slab & pours ---- */}
        {mode === 'slab' && layout ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Slab & pours</Text>
            {/* Slab 1: the main slab, one piece. */}
            <Text style={styles.sub}>Main slab (one piece, inside the house walls)</Text>
            <View style={styles.chips}>
              {chip('Main slab: yes', spec.slabs.some((s) => s.at.in === 'main'), () => !spec.slabs.some((s) => s.at.in === 'main') && toggleSlabAt({ in: 'main' }), 'Main slab in the house')}
              {chip('No main slab', !spec.slabs.some((s) => s.at.in === 'main'), () => spec.slabs.some((s) => s.at.in === 'main') && toggleSlabAt({ in: 'main' }), 'No main slab')}
            </View>
            {/* Where the slab sits in the wall: how far down, and the ledge cut into the wall for it. */}
            {spec.slabs.length ? (
              <>
                <View style={styles.row2}>
                  <NumBox
                    label="Top of slab below top of wall"
                    unit="in"
                    value={dropText}
                    onChange={setDropText}
                    onDone={() => {
                      const v = dropText.trim() === '' ? undefined : Math.max(0, Number(dropText) || 0);
                      if (v !== spec.slabDropIn) commit({ ...raw.layout, slabDropIn: v }, v === undefined ? 'Slab drop back to the usual.' : `Top of slab ${v}" below the top of the wall.`);
                    }}
                  />
                </View>
                <Text style={styles.sub}>Slab ledge: the wall is cut back from the bottom of the slab up, so the slab runs onto it</Text>
                <View style={styles.chips}>
                  {[0, 1, 2, 3].map((v) =>
                    chip(v ? `${v}" ledge` : 'No ledge', (spec.ledgeIn ?? 0) === v, () => commit({ ...raw.layout, ledgeIn: v }, v ? `${v}" slab ledge in the walls.` : 'No slab ledge.'), v ? `${v} inch slab ledge` : 'No slab ledge'),
                  )}
                </View>
              </>
            ) : null}
            {/* A second (third ...) slab goes in an add-on bay, its own pour unless you say otherwise. */}
            {layout.bays.length ? (
              <>
                <Text style={styles.sub}>+ Second slab: tap where it goes (on the plan, or here). It's its own pour.</Text>
                <View style={styles.chips}>
                  {layout.bays.flatMap((bs, ai) =>
                    bs.map((_, bi) => {
                      const on = spec.slabs.some((s) => s.at.in === 'addon' && s.at.addOn === ai && s.at.bay === bi);
                      const name = cap(`${addOnsHere.length > 1 ? `Add-on ${ai + 1} ` : ''}${bs.length > 1 ? bayName(bi, bs.length, addOnsHere[ai]) : 'add-on'}`);
                      return chip(`${on ? '✓ ' : '+ '}${name}`, on, () => toggleSlabAt({ in: 'addon', addOn: ai, bay: bi }), `Slab in the ${name}`);
                    }),
                  )}
                </View>
              </>
            ) : (
              <View style={styles.listRow}>
                <Text style={styles.help}>A second slab goes in an add-on. Add one, then come back here.</Text>
                <Pressable onPress={() => setMode('addon-pick')} style={styles.small} accessibilityRole="button">
                  <Text style={styles.smallText}>+ Add-on</Text>
                </Pressable>
              </View>
            )}
            {layout.slabs.map((sl) => {
              const yd = yards[sl.pour];
              const r = sl.face.rect;
              const first = layout.slabs[0];
              const own = !spec.slabs[sl.index].pour;
              return (
                <View key={sl.index} style={styles.slabRow}>
                  <Text style={styles.listText}>
                    Slab {sl.pour}: {sl.name}
                  </Text>
                  <Text style={styles.sub}>
                    {r ? `${fmtFtIn(r.w)} × ${fmtFtIn(r.h)} clear = ` : ''}
                    {Math.round(sl.face.clearArea).toLocaleString()} sq ft · {Math.round(sl.thick * 12)}" {yd ? `· ${yd} yd` : ''}
                  </Text>
                  {sl.index !== first.index ? (
                    <View style={styles.chips}>
                      {chip(`With Slab ${first.pour}`, !own, () => commit(setPour(raw.layout, sl.index, first.pour), `Poured with Slab ${first.pour}.`))}
                      {chip('Own pour', own, () => commit(setPour(raw.layout, sl.index, undefined), 'Its own pour.'))}
                    </View>
                  ) : null}
                </View>
              );
            })}
            {layout.bays.flatMap((bs, ai) =>
              bs.map((_, bi) => {
                if (spec.slabs.some((s) => s.at.in === 'addon' && s.at.addOn === ai && s.at.bay === bi)) return null;
                const key = `${ai}:${bi}`;
                const cur = spec.bayLabels?.[key] ?? '';
                return (
                  <View key={key} style={styles.slabRow}>
                    <Text style={styles.sub}>{cap(bs.length > 1 ? bayName(bi, bs.length, addOnsHere[ai]) : 'Add-on')}, no slab:</Text>
                    <View style={styles.chips}>
                      {['container pad', 'gravel', ''].map((lab) => chip(lab || 'nothing', cur === lab, () => commit(setBayLabel(raw.layout, ai, bi, lab))))}
                    </View>
                  </View>
                );
              }),
            )}
            <Text style={styles.panelTitle}>Pours</Text>
            {layout.pours.map((p, i) => (
              <Text key={p} style={styles.listText}>
                {i + 1}. {p}
              </Text>
            ))}
            <Text style={styles.help}>Each pour is a pump line on the bid (Pump truck: Each pour).</Text>
            {done('Done', () => setMode('idle'), false)}
          </View>
        ) : null}

        {/* ---- Rebar & bolts ---- */}
        {mode === 'rebar' && layout ? <RebarPanel layout={layout} old={raw} onSave={(s, text) => commit(s, text)} onClose={() => setMode('idle')} chip={chip} /> : null}

        {mode === 'idle' && layout ? (
          <View style={styles.panel}>
            <Text style={styles.help}>Tap a wall or a bay on the plan to see it in the run list. Use the buttons above to add on.</Text>
          </View>
        ) : null}
      </ScrollView>

      {note ? (
        <View style={styles.snack} accessibilityLiveRegion="polite">
          <Text style={styles.snackText}>{note.text}</Text>
          <Pressable
            onPress={() => {
              setUndo((u) => u.slice(0, -1));
              restore(note.undoTo, raw.layout, 'redo');
            }}
            style={styles.snackBtn}
            accessibilityRole="button"
          >
            <Text style={styles.snackBtnText}>UNDO</Text>
          </Pressable>
        </View>
      ) : null}

      {layout ? <RunList visible={showRuns} layout={layout} pick={pick} onPick={setPick} onClose={() => setShowRuns(false)} spec={raw.layout} onSave={(s, t) => commit(s, t)} /> : null}
    </View>
  );
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function bayWord(a: AddOnSpec, dir: 'out' | 'across'): string {
  const n = bayName(0, 3, { side: a.side, inside: dir });
  const m = bayName(2, 3, { side: a.side, inside: dir });
  return `${n.replace(' bay', '')} to ${m.replace(' bay', '')}`;
}

/** Which slab spot a face is: the main house, or a bay of an add-on. */
function spotOfFace(l: Layout, face: number): SlabSpot | null {
  const L = l.spec.house.length;
  const W = l.spec.house.width;
  if (faceAt(l.graph.faces, { x: L / 2, y: W / 2 }) === face) return { in: 'main' };
  for (const [ai, g] of l.addOnGeom.entries()) {
    const bi = g.seeds.findIndex((p) => faceAt(l.graph.faces, p) === face);
    if (bi >= 0) return { in: 'addon', addOn: ai, bay: bi };
  }
  return null;
}

/** The run list: grouped, rolled up, each run's ends; tap one to light it up and change its length. */
function RunList({
  visible,
  layout,
  pick,
  onPick,
  onClose,
  spec,
  onSave,
}: {
  visible: boolean;
  layout: Layout;
  pick: { run?: number };
  onPick: (p: { run?: number; face?: number }) => void;
  onClose: () => void;
  spec: LayoutSpec;
  onSave: (s: LayoutSpec, text: string) => void;
}) {
  const [edit, setEdit] = useState<{ run: number; text: string } | null>(null);
  const groups = [...new Set(layout.runs.map((r) => r.group))];
  /** What a run's length is in the layout, and how to change it. */
  const lengthOf = (i: number): { set: (ft: number) => LayoutSpec; why?: string } | null => {
    const r = layout.runs[i];
    if (r.group === 'Main') {
      const along = /back|front/.test(r.name);
      return { set: (ft) => ({ ...spec, house: along ? { ...spec.house, length: ft } : { ...spec.house, width: ft } }), why: along ? 'Changes the back and front' : 'Changes both sides' };
    }
    const n = r.group === 'Add-on' ? 0 : Number(r.group.split(' ')[1]) - 1;
    const a = spec.addOns[n];
    if (!a) return null;
    if (/ side$/.test(r.name)) return { set: (ft) => ({ ...spec, addOns: spec.addOns.map((o, k) => (k === n ? { ...o, depth: ft } : o)) }), why: 'How far it comes out (both sides)' };
    if (/ far$/.test(r.name)) return { set: (ft) => ({ ...spec, addOns: spec.addOns.map((o, k) => (k === n ? { ...o, width: ft } : o)) }), why: 'How wide it is' };
    return null;
  };
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close the run list">
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Run list</Text>
            <Pressable onPress={onClose} accessibilityRole="button" style={styles.sheetDone}>
              <Text style={styles.sheetDoneText}>Done</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.sheetBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.sub}>
              {layout.totals.corners} corners · {layout.totals.tees} tees
            </Text>
            {groups.map((g) => {
              const rs = layout.runs.map((r, i) => ({ r, i })).filter(({ r }) => r.group === g);
              const shares = g !== 'Main' ? spec.addOns[g === 'Add-on' ? 0 : Number(g.split(' ')[1]) - 1] : null;
              return (
                <View key={g}>
                  <Text style={styles.groupHead}>
                    {g}: {rollUp(rs.map(({ r }) => r))}
                    {rs.some(({ r }) => r.existing) ? ' (existing, not in bid)' : ''}
                  </Text>
                  {shares ? <Text style={styles.sub}>Shares {SIDE_SHORT[shares.side]}: 0' new</Text> : null}
                  {rs.map(({ r, i }) => {
                    const on = pick.run === i;
                    const editable = lengthOf(i);
                    return (
                      <View key={i}>
                        <Pressable
                          onPress={() => {
                            feel.tap();
                            onPick({ run: i });
                            setEdit(editable ? { run: i, text: fmtFtIn(r.measured) } : null);
                          }}
                          style={[styles.runRow, on && styles.runOn, r.existing && styles.runOld]}
                          accessibilityRole="button"
                          accessibilityLabel={`${r.name}, ${fmtFtIn(r.measured)}`}
                        >
                          <View style={styles.runMain}>
                            <Text style={styles.runName}>
                              {r.name}
                              {r.shared ? '  SHARED, counted once' : ''}
                            </Text>
                            <Text style={styles.runEnds}>Ends: {r.ends.join(' / ')}</Text>
                          </View>
                          <Text style={styles.runLen}>{fmtFtIn(r.measured)}</Text>
                        </Pressable>
                        {edit && edit.run === i && editable ? (
                          <View style={styles.editRow}>
                            <LenBox label={editable.why ?? 'Length'} value={edit.text} onChange={(text) => setEdit({ run: i, text })} autoFocus wide />
                            <Pressable
                              onPress={() => {
                                const ft = parseFtIn(edit.text);
                                if (!ft) return;
                                onSave(editable.set(ft), `${r.name}: ${fmtFtIn(ft)}.`);
                                setEdit(null);
                              }}
                              style={styles.done}
                              accessibilityRole="button"
                            >
                              <Text style={styles.doneText}>Set</Text>
                            </Pressable>
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              );
            })}
            <Text style={styles.calcLine}>
              Along the middle: {fmtFtIn(layout.totals.middle)} wall{layout.spec.footing ? ` / ${fmtFtIn(layout.totals.footingMiddle)} footing` : ''} (corners and tees counted once). Yards come from this plus
              your waste.
            </Text>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** A length box that takes 40, 40 6, 40-6 or 40'6" and shows what it read. */
/** Steps and pads: what it is, its shape, where it goes, its sizes; and the ones already on, to take off. */
function PiecePanel({
  layout,
  onAdd,
  onRemove,
  onClose,
  chip,
}: {
  layout: Layout;
  onAdd: (p: PieceSpec, text: string) => void;
  onRemove: (index: number) => void;
  onClose: () => void;
  chip: (label: string, on: boolean, onPress: () => void, a11y?: string) => React.ReactElement;
}) {
  const [kind, setKind] = useState<'steps' | 'pad'>('steps');
  const [shape, setShape] = useState<PieceShape>('half');
  const [wall, setWall] = useState(0);
  const [corner, setCorner] = useState(0);
  const [along, setAlong] = useState('');
  const [count, setCount] = useState('3');
  const [rise, setRise] = useState('7');
  const [tread, setTread] = useState('12');
  const [width, setWidth] = useState('');
  const [depth, setDepth] = useState('');
  const [diameter, setDiameter] = useState('');
  const [thick, setThick] = useState('4');
  const faces = layout.faceLines;
  const corners = insideCorners(layout.graph.outside);
  const face = faces[Math.min(wall, faces.length - 1)];
  const num = (v: string) => Number(v) || 0;
  const len = (v: string) => parseFtIn(v) ?? 0;
  const spec: PieceSpec = {
    kind,
    shape,
    ...(shape === 'quarter' ? { corner } : { wall: face?.ref, along: along.trim() ? len(along) : (face?.length ?? 0) / 2 }),
    ...(kind === 'steps' ? { steps: Math.round(num(count)), rise: num(rise) / 12, tread: num(tread) / 12 } : { thick: num(thick) / 12 }),
    ...(shape === 'square' ? { width: len(width), ...(kind === 'pad' ? { depth: len(depth) } : {}) } : { diameter: len(diameter) }),
  };
  // Check it the way the layout will: placed against this layout, any problem shown before it's added.
  const tryIt = buildLayout({ ...layout.spec, pieces: [spec] });
  const issue = tryIt.pieces[0]?.problem || tryIt.problems.find((p) => /^(Steps|Pad) 1/.test(p)) || '';
  const placed = tryIt.pieces[0];
  const shapes: [PieceShape, string][] = [['square', 'Square'], ['half', 'Half round'], ['full', 'Full round'], ['quarter', 'Quarter round']];
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Steps & pads</Text>
      <View style={styles.chips}>
        {chip('Steps', kind === 'steps', () => setKind('steps'))}
        {chip('Pad / landing', kind === 'pad', () => setKind('pad'))}
      </View>
      <View style={styles.chips}>{shapes.map(([v, lab]) => chip(lab, shape === v, () => setShape(v), `${lab} ${kind === 'steps' ? 'steps' : 'pad'}`))}</View>
      {shape === 'quarter' ? (
        corners.length ? (
          <>
            <Text style={styles.sub}>Which inside corner (its straight sides against the two walls)</Text>
            <View style={styles.chips}>{corners.map((_, i) => chip(`Corner ${i + 1}`, corner === i, () => setCorner(i)))}</View>
          </>
        ) : (
          <Text style={styles.help}>A quarter round goes in an inside corner, where an add-on meets the house. This layout has none.</Text>
        )
      ) : (
        <>
          <Text style={styles.sub}>Which wall (it goes outside it)</Text>
          <View style={styles.chips}>{faces.map((f, i) => chip(f.name, wall === i, () => setWall(i)))}</View>
          <View style={styles.row2}>
            <LenBox label={`Center, from ${face?.from ?? 'its end'} (wall ${fmtFtIn(face?.length ?? 0)})`} value={along} onChange={setAlong} />
          </View>
        </>
      )}
      {kind === 'steps' ? (
        <View style={styles.row2}>
          <NumBox label="Steps" unit="#" value={count} onChange={setCount} />
          <NumBox label="Rise" unit="in" value={rise} onChange={setRise} />
          <NumBox label="Tread" unit="in" value={tread} onChange={setTread} />
        </View>
      ) : (
        <View style={styles.row2}>
          <NumBox label="Thick" unit="in" value={thick} onChange={setThick} />
        </View>
      )}
      {shape === 'square' ? (
        <View style={styles.row2}>
          <LenBox label="Wide (along the wall)" value={width} onChange={setWidth} />
          {kind === 'pad' ? <LenBox label="Out from the wall" value={depth} onChange={setDepth} /> : null}
        </View>
      ) : (
        <View style={styles.row2}>
          <LenBox label={kind === 'steps' ? 'Main diameter (bottom step)' : 'Diameter'} value={diameter} onChange={setDiameter} />
        </View>
      )}
      {issue ? <Text style={styles.help}>{issue.replace(/^(Steps|Pad) 1:? ?/, '')}</Text> : placed ? <Text style={styles.help}>{`${placed.describe} · ${Math.round(placed.cuFt * 10) / 10} cu ft`}</Text> : null}
      {(layout.spec.pieces ?? []).length ? <Text style={styles.panelTitle}>On the layout</Text> : null}
      {layout.pieces.map((pc) => (
        <View key={pc.index} style={styles.listRow}>
          <Text style={styles.listText}>{`${pc.name}: ${pc.describe}`}</Text>
          <Pressable onPress={() => (feel.tap(), onRemove(pc.index))} style={styles.small} accessibilityRole="button" accessibilityLabel={`Take out ${pc.name}`}>
            <Text style={[styles.smallText, styles.danger]}>Remove</Text>
          </Pressable>
        </View>
      ))}
      <View style={styles.doneRow}>
        <Pressable onPress={onClose} style={styles.cancel} accessibilityRole="button">
          <Text style={styles.cancelText}>Done</Text>
        </Pressable>
        <Pressable
          onPress={() => !issue && placed && onAdd(spec, `${placed.describe} added, its own pour.`)}
          style={[styles.done, (!!issue || !placed) && styles.toolOff]}
          accessibilityRole="button"
          accessibilityState={{ disabled: !!issue || !placed }}
        >
          <Text style={styles.doneText}>{kind === 'steps' ? 'Add steps' : 'Add pad'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** A number box that keeps what you type and sets it when you leave the box. Blank = `blank`. */
function SetNum({ label, unit, value, onSet, blank = 0 }: { label: string; unit: string; value: number; onSet: (v: number) => void; blank?: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <NumBox
      label={label}
      unit={unit}
      value={text}
      onChange={setText}
      onDone={() => {
        const v = text.trim() === '' ? blank : Number(text);
        if (Number.isFinite(v) && v >= 0 && v !== value) onSet(v);
        else setText(String(value));
      }}
    />
  );
}

const SIZES = [3, 4, 5, 6];

/**
 * Rebar & bolts: nothing until you add it (the usual filled in, all changeable), then every piece and wall
 * its own, any of them set to none on purpose. Each change is a step you can undo.
 */
function RebarPanel({
  layout,
  old,
  onSave,
  onClose,
  chip,
}: {
  layout: Layout;
  old: OldBoxes;
  onSave: (next: LayoutSpec, text: string) => void;
  onClose: () => void;
  chip: (label: string, on: boolean, onPress: () => void, a11y?: string) => React.ReactElement;
}) {
  const spec = layout.spec;
  const r = spec.rebar;
  const [walls, setWalls] = useState(false);
  const steel = useMemo(() => {
    try {
      return r ? layoutSteel(layout, r) : null;
    } catch {
      return null;
    }
  }, [layout, r]);
  const missing = noSteelYet(layout, old);
  if (!r) {
    return (
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Rebar & bolts</Text>
        <Text style={styles.help}>
          {Object.values(oldBars(old)).some(Boolean) ? `Not set in the layout yet: ${missing.join(', ')}.` : 'No rebar or anchor bolts in this layout yet.'} Add them with the usual and change anything after: (2) #4 in the footing, #4 @ 24" up and along the walls, #4 @ 18" both ways in slabs and pads, a #4 in each step nose, 1/2" × 10" J-bolts at 6' on center.
        </Text>
        <Pressable onPress={() => (feel.success(), onSave(withRebar(spec, old), 'Rebar and bolts added. Change any of it below.'))} style={[styles.done, styles.bigBtn]} accessibilityRole="button">
          <Text style={styles.doneText}>Add rebar & bolts</Text>
        </Pressable>
        {!spec.rebarWarnOff ? (
          <Pressable onPress={() => onSave({ ...spec, rebarWarnOff: true }, 'No rebar on this one. The warning is put away.')} style={[styles.cancel, styles.bigBtn]} accessibilityRole="button">
            <Text style={styles.cancelText}>None on this job, stop asking</Text>
          </Pressable>
        ) : (
          <Text style={styles.help}>Set to no rebar on purpose.</Text>
        )}
        {doneBtn(onClose)}
      </View>
    );
  }
  const set = (next: Partial<LayoutRebar>, text: string) => onSave({ ...spec, rebar: { ...r, ...next } }, text);
  const size = (cur: number, onPick: (s: number) => void, none?: string) => (
    <View style={styles.chips}>
      {none ? chip(none, cur === 0, () => onPick(0)) : null}
      {SIZES.map((s) => chip(`#${s}`, cur === s, () => onPick(s), `Number ${s} bar`))}
    </View>
  );
  const slabBox = (cur: SlabSteel, put: (s: SlabSteel, text: string) => void, name: string) => (
    <>
      <View style={styles.chips}>
        {chip('Rebar grid', cur.kind === 'grid', () => put({ ...cur, kind: 'grid', chairsFt: cur.chairsFt || 3 }, `${name}: rebar grid.`))}
        {chip('Wire mesh', cur.kind === 'mesh', () => put({ ...cur, kind: 'mesh', chairsFt: cur.chairsFt || 3 }, `${name}: wire mesh.`))}
        {chip('None', cur.kind === 'none', () => put({ ...cur, kind: 'none', chairsFt: 0 }, `${name}: no steel.`))}
      </View>
      {cur.kind === 'grid' ? size(cur.size, (s) => put({ ...cur, size: s }, `${name}: #${s} bars.`)) : null}
      {cur.kind !== 'none' ? (
        <View style={styles.row2}>
          {cur.kind === 'grid' ? <SetNum label="On center" unit="in" value={cur.spacingIn} onSet={(v) => v > 0 && put({ ...cur, spacingIn: v }, `${name}: bars @ ${v}".`)} /> : null}
          <SetNum label="Chairs every (0 = none)" unit="ft" value={cur.chairsFt} onSet={(v) => put({ ...cur, chairsFt: v }, v ? `${name}: chairs every ${v}'.` : `${name}: no chairs.`)} />
        </View>
      ) : null}
    </>
  );
  const runs = layout.graph.runs.filter((_, i) => !layout.runs[i].existing);
  const wallOwn = (name: string) => r.walls?.[name] ?? {};
  const setWall = (name: string, w: WallSteel, text: string) => set({ walls: { ...(r.walls ?? {}), [name]: { ...wallOwn(name), ...w } } }, text);
  const sticks = new Map<number, number>();
  let lbs = 0;
  if (steel) {
    for (const p of [steel.footing, steel.walls, ...steel.slabs.values(), ...steel.pieces.values()]) {
      if (!p) continue;
      lbs += p.lb;
      for (const [k, v] of p.sticks) sticks.set(k, (sticks.get(k) ?? 0) + v);
    }
  }
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Rebar & bolts</Text>
      <Text style={styles.calcLine}>
        {steel
          ? `${[...sticks].sort((a, b) => a[0] - b[0]).map(([k, v]) => `#${k}: ${v.toLocaleString()} sticks × ${r.stockFt}'`).join(' · ') || 'No bars'} · ${Math.round(lbs).toLocaleString()} lb · ${steel.bolts.total} anchor bolts`
          : 'A vertical bar is longer than a stick. Pick a longer stick.'}
      </Text>
      {missing.length ? <Text style={styles.problem}>No rebar yet: {missing.join(', ')}</Text> : null}

      <Text style={styles.sub}>Sticks and laps</Text>
      <View style={styles.chips}>{[20, 30, 40, 60].map((v) => chip(`${v}' sticks`, r.stockFt === v, () => set({ stockFt: v }, `${v}' sticks.`)))}</View>
      <View style={styles.row2}>
        <SetNum label="Lap, bar diameters" unit="× bar" value={r.lapDia} onSet={(v) => v > 0 && set({ lapDia: v }, `Laps ${v} bar diameters (${(v / 2).toFixed(1).replace(/\.0$/, '')}" on a #4).`)} />
      </View>

      {spec.footing ? (
        <>
          <Text style={styles.groupHead}>Footing</Text>
          <View style={styles.chips}>{[0, 1, 2, 3, 4].map((v) => chip(v ? `(${v}) bars` : 'None', r.footing.bars === v, () => set({ footing: { ...r.footing, bars: v } }, v ? `(${v}) #${r.footing.size} in the footing.` : 'No footing bars.')))}</View>
          {r.footing.bars ? size(r.footing.size, (s) => set({ footing: { ...r.footing, size: s } }, `Footing bars #${s}.`)) : null}
          <Text style={styles.help}>Continuous, with an L-bar at every corner and tee and laps of {r.lapDia} bar diameters.</Text>
        </>
      ) : null}

      <Text style={styles.groupHead}>Walls: verticals</Text>
      {size(r.vert.size, (s) => set({ vert: { ...r.vert, size: s } }, `Verticals #${s}.`))}
      <View style={styles.row2}>
        <SetNum label="On center (0 = none)" unit="in" value={r.vert.spacingIn} onSet={(v) => set({ vert: { ...r.vert, spacingIn: v } }, v ? `Verticals @ ${v}".` : 'No verticals.')} />
      </View>
      <Text style={styles.help}>From a hook in the footing to 3" below the top of the wall{steel?.vertCutFt ? `: cut ${fmtFtIn(steel.vertCutFt)}` : ''}. Two at every corner, tee and end.</Text>

      <Text style={styles.groupHead}>Walls: horizontals</Text>
      <View style={styles.chips}>
        {chip('At a spacing', r.horiz.rows === 'spacing', () => set({ horiz: { ...r.horiz, rows: 'spacing' } }, 'Horizontal rows at a spacing.'))}
        {chip('Top + mid-height', r.horiz.rows === 'topMid', () => set({ horiz: { ...r.horiz, rows: 'topMid' } }, 'One at the top, one at mid-height.'))}
        {chip('Rows', r.horiz.rows === 'count', () => set({ horiz: { ...r.horiz, rows: 'count' } }, 'Horizontal rows by count.'))}
        {chip('None', r.horiz.rows === 'none', () => set({ horiz: { ...r.horiz, rows: 'none' } }, 'No horizontals.'))}
      </View>
      {r.horiz.rows !== 'none' ? size(r.horiz.size, (s) => set({ horiz: { ...r.horiz, size: s } }, `Horizontals #${s}.`)) : null}
      {r.horiz.rows === 'spacing' ? (
        <View style={styles.row2}>
          <SetNum label="Up the wall every" unit="in" value={r.horiz.spacingIn} onSet={(v) => v > 0 && set({ horiz: { ...r.horiz, spacingIn: v } }, `Horizontals every ${v}" up the wall.`)} />
        </View>
      ) : null}
      {r.horiz.rows === 'count' ? (
        <View style={styles.row2}>
          <SetNum label="Rows" unit="rows" value={r.horiz.count} onSet={(v) => set({ horiz: { ...r.horiz, count: Math.round(v) } }, `${Math.round(v)} rows.`)} />
        </View>
      ) : null}
      {steel && steel.rows ? <Text style={styles.help}>{steel.rows} rows of bars along every wall, an L-bar at each corner and tee, lapped.</Text> : null}

      {runs.some((x) => /inside/i.test(x.run.name)) ? (
        <>
          <Text style={styles.groupHead}>Inside walls</Text>
          <View style={styles.chips}>
            {chip('Same as outside', !r.inside, () => set({ inside: null }, 'Inside walls: same bars as outside.'))}
            {chip('Their own', !!r.inside, () => set({ inside: r.inside ?? { ...r.vert } }, 'Inside walls get their own verticals.'))}
          </View>
          {r.inside ? (
            <>
              {size(r.inside.size, (s) => set({ inside: { ...r.inside!, size: s } }, `Inside verticals #${s}.`))}
              <View style={styles.row2}>
                <SetNum label="Verticals on center (0 = none)" unit="in" value={r.inside.spacingIn} onSet={(v) => set({ inside: { ...r.inside!, spacingIn: v } }, v ? `Inside verticals @ ${v}".` : 'No verticals in the inside walls.')} />
              </View>
            </>
          ) : null}
        </>
      ) : null}

      <Text style={styles.groupHead}>Anchor bolts</Text>
      <View style={styles.chips}>
        {chip('Bolts', r.bolts.on, () => set({ bolts: { ...r.bolts, on: true } }, 'Anchor bolts on.'))}
        {chip('No bolts', !r.bolts.on, () => set({ bolts: { ...r.bolts, on: false } }, 'No anchor bolts.'))}
      </View>
      {r.bolts.on ? (
        <>
          <View style={styles.chips}>
            {['1/2" × 10" J-bolt', '5/8" × 10" J-bolt', '1/2" × 12" J-bolt', '5/8" × 12" J-bolt'].map((b) => chip(b, r.bolts.size === b, () => set({ bolts: { ...r.bolts, size: b } }, `${b}s.`)))}
          </View>
          <View style={styles.row2}>
            <SetNum label="On center, max" unit="ft" value={r.bolts.spacingFt} onSet={(v) => v > 0 && set({ bolts: { ...r.bolts, spacingFt: v } }, `Bolts ${v}' on center.`)} />
            <SetNum label="From corners and ends" unit="in" value={r.bolts.endIn} onSet={(v) => set({ bolts: { ...r.bolts, endIn: v } }, `Bolts within ${v}" of corners and ends.`)} />
          </View>
          {steel ? <Text style={styles.help}>{steel.bolts.total} bolts: {steel.bolts.runs.map((b) => `${b.name} ${b.count}`).join(', ')}.</Text> : null}
        </>
      ) : null}

      <Pressable onPress={() => setWalls(!walls)} style={styles.listRow} accessibilityRole="button">
        <Text style={styles.groupHead}>Each wall {walls ? '▾' : '›'}</Text>
      </Pressable>
      {walls
        ? runs.map((run) => {
            const w = wallOwn(run.run.name);
            const insideRun = /inside/i.test(run.run.name);
            const usual = insideRun && r.inside ? r.inside.spacingIn : r.vert.spacingIn;
            const b = steel?.bolts.runs.find((x) => x.name === run.run.name)?.count ?? 0;
            return (
              <View key={`${run.run.name}${run.run.a.x}${run.run.a.y}`} style={styles.slabRow}>
                <Text style={styles.listText}>
                  {run.run.name} {fmtFtIn(run.run.measured)}
                </Text>
                <View style={styles.chips}>
                  {chip(w.bolts === false ? 'No bolts' : `${b} bolts`, w.bolts !== false && r.bolts.on, () => setWall(run.run.name, { bolts: w.bolts === false }, w.bolts === false ? `${run.run.name}: bolts on.` : `${run.run.name}: no bolts.`), `Bolts on the ${run.run.name}`)}
                </View>
                <View style={styles.row2}>
                  <SetNum
                    label="Verticals on center (0 = none)"
                    unit="in"
                    value={w.vertSpacingIn ?? usual}
                    onSet={(v) => setWall(run.run.name, { vertSpacingIn: v === usual ? undefined : v }, v ? `${run.run.name}: verticals @ ${v}".` : `${run.run.name}: no verticals.`)}
                  />
                </View>
              </View>
            );
          })
        : null}

      {layout.slabs.length ? <Text style={styles.groupHead}>Slabs</Text> : null}
      {layout.slabs.map((sl) => {
        const key = spotKey(sl.at);
        const cur = r.slabs[key];
        const name = `Slab ${sl.pour}${layout.slabs.filter((x) => x.pour === sl.pour).length > 1 ? ` (${sl.name})` : ''}`;
        return (
          <View key={key} style={styles.slabRow}>
            <Text style={styles.listText}>
              {name}: {Math.round(sl.face.clearArea).toLocaleString()} sq ft
            </Text>
            {cur ? (
              slabBox(cur, (s, text) => set({ slabs: { ...r.slabs, [key]: s } }, text), name)
            ) : (
              <View style={styles.listRow}>
                <Text style={styles.problem}>No rebar yet</Text>
                <Pressable onPress={() => onSave(withPieceSteel(spec, { slab: sl.at }), `${name}: #4 @ 18" both ways.`)} style={styles.small} accessibilityRole="button">
                  <Text style={styles.smallText}>Add rebar</Text>
                </Pressable>
                <Pressable onPress={() => set({ slabs: { ...r.slabs, [key]: { ...NO_SLAB_STEEL } } }, `${name}: no steel.`)} style={styles.small} accessibilityRole="button">
                  <Text style={styles.smallText}>None</Text>
                </Pressable>
              </View>
            )}
          </View>
        );
      })}

      {layout.pieces.some((p) => p.layers.length) ? <Text style={styles.groupHead}>Steps & pads</Text> : null}
      {layout.pieces.map((pc, i) => {
        if (!pc.layers.length) return null;
        const cur = r.pieces[String(i)];
        const put = (v: SlabSteel | StepsSteel, text: string) => set({ pieces: { ...r.pieces, [String(i)]: v } }, text);
        const round = pc.spec.shape !== 'square';
        return (
          <View key={i} style={styles.slabRow}>
            <Text style={styles.listText}>{pc.name}</Text>
            {!cur ? (
              <View style={styles.listRow}>
                <Text style={styles.problem}>No rebar yet</Text>
                <Pressable onPress={() => onSave(withPieceSteel(spec, { piece: i }), `${pc.name}: rebar added.`)} style={styles.small} accessibilityRole="button">
                  <Text style={styles.smallText}>Add rebar</Text>
                </Pressable>
                <Pressable onPress={() => put(pc.spec.kind === 'steps' ? { ...NO_STEPS_STEEL } : { ...NO_SLAB_STEEL }, `${pc.name}: no steel.`)} style={styles.small} accessibilityRole="button">
                  <Text style={styles.smallText}>None</Text>
                </Pressable>
              </View>
            ) : pc.spec.kind === 'steps' && 'noseSize' in cur ? (
              <>
                <Text style={styles.sub}>Bar in each tread nose{round ? ', bent to the curve' : ''}</Text>
                {size(cur.noseSize, (s) => put({ ...cur, noseSize: s }, s ? `${pc.name}: #${s} in each nose.` : `${pc.name}: no nose bars.`), 'None')}
                <Text style={styles.sub}>Dowels into the wall</Text>
                {size(cur.dowelSize, (s) => put({ ...cur, dowelSize: s, dowelSpacingIn: s ? cur.dowelSpacingIn || 24 : 0 }, s ? `${pc.name}: #${s} dowels.` : `${pc.name}: no dowels.`), 'None')}
                {cur.dowelSize ? (
                  <View style={styles.row2}>
                    <SetNum label="On center (0 = none)" unit="in" value={cur.dowelSpacingIn} onSet={(v) => put({ ...cur, dowelSpacingIn: v }, v ? `${pc.name}: dowels @ ${v}".` : `${pc.name}: no dowels.`)} />
                    <SetNum label="Into the wall" unit="in" value={cur.dowelIn} onSet={(v) => v > 0 && put({ ...cur, dowelIn: v }, `${pc.name}: dowels ${v}" into the wall.`)} />
                  </View>
                ) : null}
              </>
            ) : 'kind' in cur ? (
              <>
                {slabBox(cur, put, pc.name)}
                {round && cur.kind === 'grid' ? <Text style={styles.help}>Plus a bar round the curved edge, bent to the curve.</Text> : null}
              </>
            ) : null}
          </View>
        );
      })}

      <Pressable
        onPress={() => onSave({ ...spec, rebar: undefined, rebarWarnOff: true }, 'Rebar and bolts taken out of the layout.')}
        style={styles.linkRow}
        accessibilityRole="button"
      >
        <Text style={[styles.smallText, styles.danger]}>Take all rebar and bolts out</Text>
      </Pressable>
      {doneBtn(onClose)}
    </View>
  );
}

const doneBtn = (onClose: () => void) => (
  <View style={styles.doneRow}>
    <Pressable onPress={onClose} style={styles.done} accessibilityRole="button">
      <Text style={styles.doneText}>Done</Text>
    </Pressable>
  </View>
);

function LenBox({ label, value, onChange, autoFocus, wide }: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean; wide?: boolean }) {
  const ft = parseFtIn(value);
  return (
    <View style={[styles.field, wide && styles.fieldWide]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder="40 or 40 6"
        placeholderTextColor={colors.faint}
        keyboardType="numbers-and-punctuation"
        autoFocus={autoFocus}
        accessibilityLabel={label}
      />
      <Text style={value.trim() && ft === null ? styles.bad : styles.calc}>{value.trim() ? (ft === null ? 'Type it like 40 or 40 6' : fmtFtIn(ft)) : ' '}</Text>
    </View>
  );
}

function NumBox({ label, unit, value, onChange, onDone }: { label: string; unit: string; value: string; onChange: (v: string) => void; onDone?: () => void }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {label} ({unit})
      </Text>
      <TextInput style={styles.input} value={value} onChangeText={onChange} onBlur={onDone} keyboardType="decimal-pad" accessibilityLabel={`${label}, ${unit}`} />
    </View>
  );
}

const getStyles = themed(() => ({
  page: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingTop: 8, paddingBottom: 6, gap: 6 },
  back: { paddingHorizontal: 8, paddingVertical: 10, minHeight: 44, justifyContent: 'center' },
  backText: { fontSize: 18, fontWeight: '700', color: colors.accent },
  title: { flex: 1, fontSize: 19, fontWeight: '800', color: colors.text },
  hBtn: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.panel2, minHeight: 44, justifyContent: 'center' },
  hBtnText: { fontSize: 16, fontWeight: '800', color: colors.text },
  content: { paddingHorizontal: 12, paddingBottom: 140 },
  banner: { backgroundColor: colors.accent, color: colors.accentText, fontSize: 17, fontWeight: '800', textAlign: 'center', paddingVertical: 10, borderRadius: 10, marginBottom: 6 },
  empty: { height: 160, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' },
  emptyText: { fontSize: 16, color: colors.subtext },
  stripWrap: { backgroundColor: colors.bg, paddingTop: 6 },
  strip: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.panel, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, minHeight: 52 },
  stripText: { flex: 1, fontSize: 17, fontWeight: '800', color: colors.text },
  stripMore: { fontSize: 15, fontWeight: '700', color: colors.accent, marginLeft: 8 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8, marginBottom: 6 },
  tool: { flexGrow: 1, minHeight: 52, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center' },
  toolOn: { backgroundColor: colors.accent },
  toolOff: { opacity: 0.4 },
  toolText: { fontSize: 17, fontWeight: '800', color: colors.text },
  toolTextOn: { color: colors.accentText },
  rule: { fontSize: 13, color: colors.subtext, marginVertical: 6, lineHeight: 18 },
  problem: { fontSize: 16, fontWeight: '700', color: colors.error, marginVertical: 6 },
  panel: { backgroundColor: colors.panel, borderRadius: 14, padding: 14, marginTop: 8 },
  panelTitle: { fontSize: 19, fontWeight: '800', color: colors.text, marginBottom: 8 },
  sub: { fontSize: 15, color: colors.subtext, marginBottom: 6 },
  help: { fontSize: 15, color: colors.subtext, marginVertical: 6, lineHeight: 20 },
  row2: { flexDirection: 'row', gap: 10 },
  field: { flex: 1, marginBottom: 8 },
  fieldWide: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto', alignSelf: 'stretch' },
  fieldLabel: { fontSize: 14, fontWeight: '700', color: colors.subtext, marginBottom: 4 },
  input: { backgroundColor: colors.bg, color: colors.text, fontSize: 22, fontWeight: '800', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, minHeight: 52, borderWidth: 1, borderColor: colors.border },
  calc: { fontSize: 15, color: colors.subtext, marginTop: 3, fontWeight: '600' },
  bad: { fontSize: 15, color: colors.error, marginTop: 3, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 6 },
  chip: { minHeight: 48, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.panel2, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.accent },
  chipText: { fontSize: 16, fontWeight: '700', color: colors.text },
  chipTextOn: { color: colors.accentText },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 6 },
  step: { width: 52, height: 52, borderRadius: 12, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 26, fontWeight: '800', color: colors.text },
  count: { fontSize: 24, fontWeight: '800', color: colors.text, minWidth: 28, textAlign: 'center' },
  bays: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  bay: { flexGrow: 1, flexBasis: 80, alignItems: 'center' },
  box: { alignSelf: 'stretch', backgroundColor: colors.bg, color: colors.text, fontSize: 20, fontWeight: '800', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 10, minHeight: 52, borderWidth: 1, borderColor: colors.border, textAlign: 'center', justifyContent: 'center' },
  restBox: { borderStyle: 'dashed', alignItems: 'center' },
  bayCap: { fontSize: 15, fontWeight: '800', color: colors.text, marginTop: 4 },
  doneRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  cancel: { flex: 1, minHeight: 52, borderRadius: 12, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 17, fontWeight: '800', color: colors.text },
  done: { flex: 2, minHeight: 52, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  doneText: { fontSize: 18, fontWeight: '800', color: colors.accentText },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 4 },
  listText: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.text },
  small: { paddingHorizontal: 12, minHeight: 44, borderRadius: 10, backgroundColor: colors.panel2, justifyContent: 'center' },
  smallText: { fontSize: 15, fontWeight: '800', color: colors.text },
  danger: { color: colors.danger },
  slabRow: { borderTopWidth: 0.5, borderTopColor: colors.border, paddingVertical: 8 },
  snack: { position: 'absolute', left: 12, right: 12, top: 64, backgroundColor: '#1b1b1b', borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: '#444' },
  snackText: { flex: 1, color: '#fff', fontSize: 16, fontWeight: '600' },
  snackBtn: { paddingHorizontal: 12, minHeight: 44, justifyContent: 'center' },
  snackBtnText: { color: colors.accent, fontSize: 17, fontWeight: '900' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85%', paddingBottom: 30 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  sheetTitle: { flex: 1, fontSize: 20, fontWeight: '800', color: colors.text },
  sheetDone: { paddingHorizontal: 8, minHeight: 44, justifyContent: 'center' },
  sheetDoneText: { fontSize: 17, fontWeight: '800', color: colors.accent },
  sheetBody: { paddingHorizontal: 14, paddingTop: 10 },
  groupHead: { fontSize: 17, fontWeight: '800', color: colors.text, marginTop: 12, marginBottom: 4 },
  runRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.panel, borderRadius: 12, padding: 12, marginBottom: 6, minHeight: 56 },
  runOn: { borderWidth: 2, borderColor: colors.accent },
  runOld: { opacity: 0.55 },
  runMain: { flex: 1 },
  runName: { fontSize: 16, fontWeight: '800', color: colors.text },
  runEnds: { fontSize: 13, color: colors.subtext, marginTop: 2 },
  runLen: { fontSize: 20, fontWeight: '800', color: colors.text, marginLeft: 8 },
  editRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 8 },
  calcLine: { fontSize: 14, color: colors.subtext, marginVertical: 14, lineHeight: 19 },
  bigBtn: { flex: 0, marginTop: 10 },
  linkRow: { minHeight: 44, justifyContent: 'center', marginTop: 10 },
}));

// Rebuilt when the colors or text size change.
let styles = getStyles();
onThemeChange(() => {
  styles = getStyles();
});
