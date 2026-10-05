import { useState } from 'react';
import { LayoutChangeEvent, Pressable, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Line, Polygon, Text as SvgText } from 'react-native-svg';

import { feel } from '../lib/feel';
import { Job, jobStore } from '../lib/jobs';
import type { Foundation } from '../report/foundation';
import { splitOutline } from '../report/heightRuns';
import { ftIn } from '../tools/format';
import { parseLength, RawLength } from '../tools/run';
import { colors, onThemeChange, themed } from '../theme';

const COLORS = ['#ff9f0a', '#4aa3ff', '#3ddc84', '#ff5a5a', '#c38bff', '#ffd60a'];
const blank = (): RawLength => ({ ft: '', in: '' });
const fromFt = (ft: number): RawLength => {
  const whole = Math.floor(ft + 1e-9);
  const inch = Math.round((ft - whole) * 12 * 8) / 8;
  return { ft: String(whole), in: inch ? String(inch) : '' };
};
const letter = (i: number) => String.fromCharCode(65 + i);

/**
 * Walls that change height (daylight basement). Start at corner A, go clockwise along the outside,
 * and say how far each height runs; the rest of the way fills itself in.
 */
export default function HeightRuns({ job, f }: { job: Job; f: Foundation }) {
  const together = job.together!;
  const hs = together.heights;
  const [width, setWidth] = useState(0);
  const save = (heights: NonNullable<typeof together.heights> | undefined) => jobStore.edit(job.id, { together: { ...together, heights } });
  const full = f.heightFt;
  const used = f.runs ? [...new Set(f.runs.map((r) => r.height))] : [full];
  const quick = [...new Set([full, ...used, full / 2].map((h) => Math.round(h * 12) / 12))].filter((h) => h > 0).sort((a, b) => b - a);

  const toggle = (on: boolean) => {
    feel.tap();
    save(on ? { runs: [{ length: blank(), height: fromFt(full) }], rest: blank() } : undefined);
  };
  const setRun = (i: number, patch: Partial<{ length: RawLength; height: RawLength }>) =>
    hs && save({ ...hs, runs: hs.runs.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  // Where each entered run starts and ends, going around.
  let at = 0;
  const spans = (hs?.runs ?? []).map((r) => {
    const len = parseLength(r.length) ?? 0;
    const span = { from: at, to: at + len };
    at += len;
    return span;
  });
  const restLen = f.outsideFt - at;
  const distinct = f.runs ? [...new Set(f.runs.map((r) => r.height))].sort((a, b) => b - a) : [];
  const colorOf = (h: number) => COLORS[Math.max(0, distinct.indexOf(h)) % COLORS.length];

  return (
    <View style={styles.wrap}>
      <Text style={styles.head}>Wall height</Text>
      <View style={styles.chips}>
        <Pressable onPress={() => toggle(false)} style={[styles.chip, !hs && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: !hs }}>
          <Text style={[styles.chipText, !hs && styles.chipTextOn]}>Same all the way around</Text>
        </Pressable>
        <Pressable onPress={() => toggle(true)} style={[styles.chip, !!hs && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: !!hs }}>
          <Text style={[styles.chipText, !!hs && styles.chipTextOn]}>Changes (daylight basement)</Text>
        </Pressable>
      </View>

      {hs && f.outline ? (
        <>
          <Text style={styles.help}>Start at corner A and go clockwise (the arrow). Put in how far each height runs. The rest of the way fills itself in.</Text>
          <View style={styles.map} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} accessibilityLabel="Wall heights around the house">
            {width > 0 ? <HouseMap f={f} width={width} colorOf={colorOf} /> : null}
          </View>

          {hs.runs.map((r, i) => (
            <View key={i} style={styles.run}>
              <View style={styles.runHead}>
                <View style={[styles.swatch, { backgroundColor: colorOf(parseLength(r.height) ?? full) }]} />
                <Text style={styles.runTitle}>{i === 0 ? 'From A' : 'Next'}</Text>
                <Text style={styles.runSpan}>
                  {spans[i] && spans[i].to > spans[i].from ? `${ftIn(spans[i].from)} to ${ftIn(spans[i].to)} around` : ''}
                </Text>
                {hs.runs.length > 1 ? (
                  <Pressable onPress={() => save({ ...hs, runs: hs.runs.filter((_, j) => j !== i) })} style={styles.x} accessibilityRole="button" accessibilityLabel={`Remove height ${i + 1}`}>
                    <Text style={styles.xText}>✕</Text>
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.line}>
                <FtIn value={r.length} onChange={(length) => setRun(i, { length })} label={`Run ${i + 1} length`} />
                <Text style={styles.word}>of wall at</Text>
                <FtIn value={r.height} onChange={(height) => setRun(i, { height })} label={`Run ${i + 1} height`} />
              </View>
              <View style={styles.chips}>
                {quick.map((h) => (
                  <Pressable key={h} onPress={() => setRun(i, { height: fromFt(h) })} style={styles.small} accessibilityRole="button" accessibilityLabel={`Run ${i + 1} at ${ftIn(h)}`}>
                    <Text style={styles.smallText}>{ftIn(h)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}

          <Pressable
            onPress={() => {
              feel.tap();
              save({ ...hs, runs: [...hs.runs, { length: blank(), height: hs.rest.ft || hs.rest.in ? hs.rest : fromFt(full / 2) }] });
            }}
            style={styles.add}
            accessibilityRole="button"
          >
            <Text style={styles.addText}>+ Add a height change</Text>
          </Pressable>

          <View style={styles.run}>
            <View style={styles.runHead}>
              <View style={[styles.swatch, { backgroundColor: colorOf(parseLength(hs.rest) ?? full) }]} />
              <Text style={styles.runTitle}>The rest of the way</Text>
              <Text style={styles.runSpan}>{restLen > 0 ? `${ftIn(restLen)}, back to A` : ''}</Text>
            </View>
            <View style={styles.line}>
              <Text style={styles.word}>at</Text>
              <FtIn value={hs.rest} onChange={(rest) => save({ ...hs, rest })} label="The rest of the way height" placeholder={ftIn(full)} />
            </View>
            <View style={styles.chips}>
              {quick.map((h) => (
                <Pressable key={h} onPress={() => save({ ...hs, rest: fromFt(h) })} style={styles.small} accessibilityRole="button" accessibilityLabel={`The rest at ${ftIn(h)}`}>
                  <Text style={styles.smallText}>{ftIn(h)}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          {f.runsOver > 0 ? (
            <Text style={styles.warn}>
              That’s {ftIn(f.runsOver)} more than the walls go around ({ftIn(f.outsideFt)}). Shorten a run.
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

/** The house outline, each stretch colored by its wall height, corners lettered, start arrow at A. */
function HouseMap({ f, width, colorOf }: { f: Foundation; width: number; colorOf: (h: number) => string }) {
  const pts = f.outline!;
  const height = 230;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX || 1;
  const spanY = Math.max(...ys) - minY || 1;
  const pad = 34;
  const s = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
  const ox = (width - spanX * s) / 2;
  const oy = (height - spanY * s) / 2;
  const X = (x: number) => ox + (x - minX) * s;
  const Y = (y: number) => oy + (y - minY) * s;
  const segs = f.runs ? splitOutline(pts, f.runs) : [];
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  // Arrow at A pointing along the first wall (clockwise).
  const a = pts[0];
  const b = pts[1];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const tip = { x: X(a.x) + ux * 46, y: Y(a.y) + uy * 46 };
  return (
    <Svg width={width} height={height}>
      <Polygon points={pts.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ')} fill="#f1efe9" stroke="#c9c5bd" strokeWidth={2} />
      {segs.map((g, i) => (
        <Line key={i} x1={X(g.a.x)} y1={Y(g.a.y)} x2={X(g.b.x)} y2={Y(g.b.y)} stroke={colorOf(g.height)} strokeWidth={9} strokeLinecap="butt" />
      ))}
      {segs.map((g, i) =>
        i > 0 && segs[i - 1].run !== g.run ? <Circle key={`s${i}`} cx={X(g.a.x)} cy={Y(g.a.y)} r={7} fill="#111" /> : null,
      )}
      {f.runs
        ? f.runs.map((r, i) => {
            const mid = segs.filter((g) => g.run === i).sort((p, q) => Math.hypot(q.b.x - q.a.x, q.b.y - q.a.y) - Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y))[0];
            if (!mid) return null;
            const mx = (mid.a.x + mid.b.x) / 2;
            const my = (mid.a.y + mid.b.y) / 2;
            const d = Math.hypot(mx - cx, my - cy) || 1;
            return (
              <SvgText key={`t${i}`} x={X(mx) - ((mx - cx) / d) * 22} y={Y(my) - ((my - cy) / d) * 22 + 5} fontSize={13} fontWeight="800" fill="#333" textAnchor="middle">
                {ftIn(r.height)}
              </SvgText>
            );
          })
        : null}
      {pts.map((p, i) => {
        const d = Math.hypot(p.x - cx, p.y - cy) || 1;
        return (
          <SvgText key={`c${i}`} x={X(p.x) + ((p.x - cx) / d) * 18} y={Y(p.y) + ((p.y - cy) / d) * 18 + 6} fontSize={16} fontWeight="900" fill="#111" textAnchor="middle">
            {letter(i)}
          </SvgText>
        );
      })}
      <Circle cx={X(a.x)} cy={Y(a.y)} r={9} fill="#111" />
      <Line x1={X(a.x)} y1={Y(a.y)} x2={tip.x} y2={tip.y} stroke="#111" strokeWidth={3} />
      <Polygon
        points={`${tip.x + ux * 10},${tip.y + uy * 10} ${tip.x - uy * 7},${tip.y + ux * 7} ${tip.x + uy * 7},${tip.y - ux * 7}`}
        fill="#111"
      />
      <SvgText x={X(a.x) - uy * 26 + ux * 4} y={Y(a.y) + ux * 26 + 4} fontSize={12} fontWeight="800" fill="#111" textAnchor="middle">
        Start
      </SvgText>
    </Svg>
  );
}

/** Feet and inches boxes. */
function FtIn({ value, onChange, label, placeholder }: { value: RawLength; onChange: (v: RawLength) => void; label: string; placeholder?: string }) {
  return (
    <View style={styles.ftin}>
      <TextInput
        style={styles.box}
        value={value.ft}
        onChangeText={(ft) => onChange({ ...value, ft })}
        placeholder={placeholder ? placeholder.split("'")[0] : '0'}
        placeholderTextColor={colors.faint}
        keyboardType="decimal-pad"
        accessibilityLabel={`${label} feet`}
      />
      <Text style={styles.unit}>ft</Text>
      <TextInput
        style={[styles.box, styles.boxIn]}
        value={value.in}
        onChangeText={(inch) => onChange({ ...value, in: inch })}
        placeholder="0"
        placeholderTextColor={colors.faint}
        keyboardType="decimal-pad"
        accessibilityLabel={`${label} inches`}
      />
      <Text style={styles.unit}>in</Text>
    </View>
  );
}

const getStyles = themed(() => ({
  wrap: { marginTop: 12 },
  head: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: 6 },
  help: { fontSize: 14, color: colors.subtext, lineHeight: 19, marginVertical: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  chip: { backgroundColor: colors.panel2, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  chipOn: { backgroundColor: colors.accent },
  chipText: { fontSize: 15, fontWeight: '600', color: colors.text },
  chipTextOn: { color: colors.accentText, fontWeight: '800' },
  map: { height: 230, backgroundColor: '#ffffff', borderRadius: 14, overflow: 'hidden', marginBottom: 10 },
  run: { backgroundColor: colors.panel2, borderRadius: 14, padding: 12, marginBottom: 8 },
  runHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  swatch: { width: 16, height: 16, borderRadius: 4 },
  runTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  runSpan: { flex: 1, fontSize: 13, color: colors.subtext },
  line: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  word: { fontSize: 15, color: colors.text, fontWeight: '600' },
  ftin: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  box: { width: 54, backgroundColor: colors.panel, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 8, fontSize: 17, color: colors.text, textAlign: 'center' },
  boxIn: { width: 46 },
  unit: { fontSize: 13, color: colors.subtext, marginRight: 4 },
  small: { backgroundColor: colors.panel, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  smallText: { fontSize: 14, fontWeight: '700', color: colors.accent },
  add: { borderWidth: 1, borderColor: colors.faint, borderStyle: 'dashed', borderRadius: 12, padding: 12, alignItems: 'center', marginBottom: 8 },
  addText: { fontSize: 16, fontWeight: '700', color: colors.accent },
  x: { paddingHorizontal: 6 },
  xText: { fontSize: 17, fontWeight: '700', color: colors.danger },
  warn: { fontSize: 15, color: colors.error, marginTop: 4 },
}));

// Rebuilt when the colors or text size change.
let styles = getStyles();
onThemeChange(() => {
  styles = getStyles();
});
