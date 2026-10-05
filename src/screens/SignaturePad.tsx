import { useEffect, useRef, useState } from 'react';
import { LayoutChangeEvent, Modal, PanResponder, Pressable, Text, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { feel } from '../lib/feel';
import type { Signature } from '../lib/jobs';
import { colors, onThemeChange, themed } from '../theme';

const n = (v: number) => Math.round(v * 10) / 10;

/** Sign with a finger: name, signature box, Clear / Cancel / Done. */
export default function SignaturePad({
  visible,
  title,
  defaultName,
  onDone,
  onCancel,
}: {
  visible: boolean;
  title: string;
  defaultName?: string;
  onDone: (sig: Signature) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(defaultName ?? '');
  const [strokes, setStrokes] = useState<string[]>([]);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const current = useRef('');
  const [, redraw] = useState(0);
  // Each time it opens: a clean pad, with the customer's name filled in.
  useEffect(() => {
    if (!visible) return;
    setName(defaultName ?? '');
    setStrokes([]);
  }, [visible]);

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const { locationX: x, locationY: y } = e.nativeEvent;
        current.current = `M${n(x)} ${n(y)}`;
        redraw((k) => k + 1);
      },
      onPanResponderMove: (e) => {
        const { locationX: x, locationY: y } = e.nativeEvent;
        current.current += ` L${n(x)} ${n(y)}`;
        redraw((k) => k + 1);
      },
      onPanResponderRelease: () => {
        const d = current.current;
        current.current = '';
        // A tap is a dot: draw it as a tiny line so it shows.
        if (d) setStrokes((s) => [...s, d.includes('L') ? d : `${d} l0.5 0.5`]);
      },
    }),
  ).current;

  const onLayout = (e: LayoutChangeEvent) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
  const all = [...strokes, current.current].filter(Boolean);
  const ready = strokes.length > 0 && name.trim().length > 0;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{title}</Text>
          <TextInput
            style={styles.name}
            value={name}
            onChangeText={setName}
            placeholder="Printed name"
            placeholderTextColor={colors.faint}
            autoCapitalize="words"
            accessibilityLabel="Printed name"
          />
          <View style={styles.pad} onLayout={onLayout} {...responder.panHandlers} accessibilityLabel="Sign here">
            {box.w > 0 ? (
              <Svg width={box.w} height={box.h}>
                {all.map((d, i) => (
                  <Path key={i} d={d} stroke="#111111" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                ))}
              </Svg>
            ) : null}
            {!all.length ? <Text style={styles.hint}>Sign here with your finger</Text> : null}
            <View style={styles.signLine} pointerEvents="none" />
          </View>
          <View style={styles.row}>
            <Pressable onPress={() => setStrokes([])} style={styles.btn} accessibilityRole="button">
              <Text style={styles.btnText}>Clear</Text>
            </Pressable>
            <Pressable onPress={onCancel} style={styles.btn} accessibilityRole="button">
              <Text style={styles.btnText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                if (!ready) return;
                feel.success();
                onDone({ d: strokes.join(' '), w: Math.round(box.w), h: Math.round(box.h), name: name.trim(), at: Date.now() });
                setStrokes([]);
              }}
              disabled={!ready}
              style={[styles.btn, styles.done, !ready && styles.off]}
              accessibilityRole="button"
            >
              <Text style={[styles.btnText, styles.doneText]}>Done</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const getStyles = themed(() => ({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 34 },
  title: { fontSize: 20, fontWeight: '800', color: colors.text, marginBottom: 10 },
  name: { backgroundColor: colors.panel, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 18, color: colors.text, marginBottom: 10 },
  pad: { height: 200, backgroundColor: '#ffffff', borderRadius: 14, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  hint: { position: 'absolute', fontSize: 16, color: '#9a9a9a' },
  signLine: { position: 'absolute', left: 20, right: 20, bottom: 40, height: 1, backgroundColor: '#c8c8c8' },
  row: { flexDirection: 'row', gap: 10, marginTop: 12 },
  btn: { flex: 1, backgroundColor: colors.panel2, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  btnText: { fontSize: 17, fontWeight: '700', color: colors.accent },
  done: { backgroundColor: colors.accent },
  doneText: { color: colors.accentText },
  off: { opacity: 0.4 },
}));

// Rebuilt when the colors or text size change.
let styles = getStyles();
onThemeChange(() => {
  styles = getStyles();
});
