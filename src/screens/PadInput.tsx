import { useRef, useState } from 'react';
import { LayoutChangeEvent, PanResponder, Pressable, Text, View } from 'react-native';
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg';

import { feel } from '../lib/feel';
import type { RawLength, RawPad } from '../tools/run';
import { colors, onThemeChange, themed } from '../theme';

const name = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `P${i + 1}`);
const HIT = 24; // how close a tap has to be to a point, px
const ALIGN = 14; // a new point this close to lining up with another snaps in line with it

/**
 * The drawing pad. Tap to put down points; each tap draws a line from the last point (orange).
 * Tap a point to start from it, tap the orange point to lift the pen, tap another point to join them
 * (close the shape, add a brace). Drag a point to move it. Lengths go in the list below.
 */
export default function PadInput({
  value,
  onChange,
  LengthBox,
}: {
  value: RawPad;
  onChange: (v: RawPad) => void;
  LengthBox: (p: { value: RawLength; onChange: (v: RawLength) => void; label: string }) => React.ReactElement;
}) {
  const [width, setWidth] = useState(0);
  const height = 320;
  const [current, setCurrent] = useState<number | null>(value.points.length ? value.points.length - 1 : null);
  const [history, setHistory] = useState<RawPad[]>([]);
  // Points are kept in pad units (1000 across) so the sketch looks the same on any phone.
  const k = width ? width / 1000 : 1;
  const live = useRef({ value, current, k, onChange });
  live.current = { value, current, k, onChange };

  const save = (next: RawPad, keepHistory = true) => {
    if (keepHistory) setHistory((h) => [...h.slice(-30), live.current.value]);
    live.current.onChange(next);
  };

  const tap = (px: number, py: number) => {
    const { value: v, current: cur, k: kk } = live.current;
    const near = v.points.findIndex((p) => Math.hypot(p.x * kk - px, p.y * kk - py) <= HIT);
    if (near >= 0) {
      if (cur === null || cur === near) {
        setCurrent(cur === near ? null : near);
        feel.tap();
        return;
      }
      const exists = v.edges.some((e) => (e.a === cur && e.b === near) || (e.a === near && e.b === cur));
      if (!exists) save({ points: v.points, edges: [...v.edges, { a: cur, b: near, length: { ft: '', in: '' } }] });
      setCurrent(near);
      feel.tap();
      return;
    }
    // A new point; line it up with a nearby point so level and plumb lines draw clean.
    let x = px / kk;
    let y = py / kk;
    for (const p of v.points) {
      if (Math.abs(p.x - x) * kk <= ALIGN) x = p.x;
      if (Math.abs(p.y - y) * kk <= ALIGN) y = p.y;
    }
    const i = v.points.length;
    save({
      points: [...v.points, { x: Math.round(x), y: Math.round(y) }],
      edges: cur === null ? v.edges : [...v.edges, { a: cur, b: i, length: { ft: '', in: '' } }],
    });
    setCurrent(i);
    feel.tap();
  };

  const drag = useRef<{ i: number; moved: boolean; x0: number; y0: number } | null>(null);
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const { locationX: x, locationY: y } = e.nativeEvent;
        const { value: v, k: kk } = live.current;
        const i = v.points.findIndex((p) => Math.hypot(p.x * kk - x, p.y * kk - y) <= HIT);
        drag.current = { i, moved: false, x0: x, y0: y };
      },
      onPanResponderMove: (e, g) => {
        const d = drag.current;
        if (!d || d.i < 0) return;
        if (!d.moved && Math.hypot(g.dx, g.dy) < 8) return;
        if (!d.moved) setHistory((h) => [...h.slice(-30), live.current.value]);
        d.moved = true;
        const { value: v, k: kk } = live.current;
        const x = Math.round((d.x0 + g.dx) / kk);
        const y = Math.round((d.y0 + g.dy) / kk);
        live.current.onChange({ points: v.points.map((p, j) => (j === d.i ? { x, y } : p)), edges: v.edges });
      },
      onPanResponderRelease: (e, g) => {
        const d = drag.current;
        drag.current = null;
        if (d?.moved) return;
        if (Math.hypot(g.dx, g.dy) > 12) return; // a swipe, not a tap
        if (d) tap(d.x0, d.y0);
      },
    }),
  ).current;

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const setLength = (i: number, length: RawLength) => save({ points: value.points, edges: value.edges.map((e, j) => (j === i ? { ...e, length } : e)) }, false);
  const removeLine = (i: number) => {
    const edges = value.edges.filter((_, j) => j !== i);
    // Drop points nothing connects to any more (letters close up).
    const used = new Set(edges.flatMap((e) => [e.a, e.b]));
    const keep = value.points.map((_, j) => used.has(j) || j === current);
    const map = new Map<number, number>();
    let n = 0;
    keep.forEach((on, j) => on && map.set(j, n++));
    save({ points: value.points.filter((_, j) => keep[j]), edges: edges.map((e) => ({ ...e, a: map.get(e.a)!, b: map.get(e.b)! })) });
    setCurrent(current !== null && keep[current] ? map.get(current)! : null);
  };

  const grid: React.ReactElement[] = [];
  if (width) {
    for (let x = 50; x < 1000; x += 50) grid.push(<Line key={`x${x}`} x1={x * k} y1={0} x2={x * k} y2={height} stroke="#e8edf3" strokeWidth={1} />);
    for (let y = 50; y * k < height; y += 50) grid.push(<Line key={`y${y}`} x1={0} y1={y * k} x2={width} y2={y * k} stroke="#e8edf3" strokeWidth={1} />);
  }

  return (
    <View>
      <View style={styles.pad} onLayout={onLayout} {...responder.panHandlers} accessibilityLabel="Drawing pad">
        {width > 0 ? (
          <Svg width={width} height={height}>
            {grid}
            {value.edges.map((e, i) => {
              const p = value.points[e.a];
              const q = value.points[e.b];
              return <Line key={i} x1={p.x * k} y1={p.y * k} x2={q.x * k} y2={q.y * k} stroke="#1f3a5f" strokeWidth={4} strokeLinecap="round" />;
            })}
            {value.points.map((p, i) => (
              <Circle key={i} cx={p.x * k} cy={p.y * k} r={i === current ? 11 : 8} fill={i === current ? '#ff9f0a' : '#1f3a5f'} />
            ))}
            {value.points.map((p, i) => (
              <SvgText key={`t${i}`} x={p.x * k + 12} y={p.y * k - 10} fontSize={18} fontWeight="800" fill="#1f3a5f">
                {name(i)}
              </SvgText>
            ))}
          </Svg>
        ) : null}
        {!value.points.length ? <Text style={styles.hint}>Tap to start drawing</Text> : null}
      </View>
      <View style={styles.row}>
        <Pressable
          onPress={() => {
            const prev = history[history.length - 1];
            if (!prev) return;
            setHistory((h) => h.slice(0, -1));
            live.current.onChange(prev);
            setCurrent(prev.points.length ? Math.min(current ?? prev.points.length - 1, prev.points.length - 1) : null);
          }}
          disabled={!history.length}
          style={[styles.btn, !history.length && styles.off]}
          accessibilityRole="button"
        >
          <Text style={styles.btnText}>Undo</Text>
        </Pressable>
        <Pressable onPress={() => setCurrent(null)} disabled={current === null} style={[styles.btn, current === null && styles.off]} accessibilityRole="button">
          <Text style={styles.btnText}>Lift pen</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            save({ points: [], edges: [] });
            setCurrent(null);
          }}
          disabled={!value.points.length}
          style={[styles.btn, !value.points.length && styles.off]}
          accessibilityRole="button"
        >
          <Text style={styles.btnText}>Start over</Text>
        </Pressable>
      </View>
      {value.edges.length ? <Text style={styles.listHead}>Lengths you know (leave the rest blank)</Text> : null}
      {value.edges.map((e, i) => (
        <View key={`${e.a}-${e.b}-${i}`} style={styles.lineRow}>
          <Text style={styles.lineName}>
            {name(e.a)}–{name(e.b)}
          </Text>
          <View style={styles.lineBox}>
            <LengthBox value={e.length} onChange={(l) => setLength(i, l)} label={`${name(e.a)} to ${name(e.b)} length`} />
          </View>
          <Pressable onPress={() => removeLine(i)} style={styles.x} accessibilityRole="button" accessibilityLabel={`Remove line ${name(e.a)} to ${name(e.b)}`}>
            <Text style={styles.xText}>✕</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const getStyles = themed(() => ({
  pad: { height: 320, backgroundColor: '#ffffff', borderRadius: 14, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  hint: { position: 'absolute', fontSize: 17, color: '#8a96a1', fontWeight: '600' },
  row: { flexDirection: 'row', gap: 8, marginTop: 10, marginBottom: 6 },
  btn: { flex: 1, backgroundColor: colors.panel2, borderRadius: 12, paddingVertical: 11, alignItems: 'center' },
  btnText: { fontSize: 16, fontWeight: '700', color: colors.accent },
  off: { opacity: 0.4 },
  listHead: { fontSize: 15, fontWeight: '700', color: colors.subtext, marginTop: 10, marginBottom: 6 },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  lineName: { width: 48, fontSize: 18, fontWeight: '800', color: colors.text },
  lineBox: { flex: 1 },
  x: { paddingHorizontal: 10, paddingVertical: 10 },
  xText: { fontSize: 18, fontWeight: '700', color: colors.danger },
}));

// Rebuilt when the colors or text size change.
let styles = getStyles();
onThemeChange(() => {
  styles = getStyles();
});
