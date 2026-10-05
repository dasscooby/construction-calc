import { useState } from 'react';
import { LayoutChangeEvent, Pressable, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { feel } from '../lib/feel';
import type { Drawings } from '../report/report';
import { colors, onThemeChange, themed } from '../theme';

type Which = 'plan' | 'iso' | 'section' | 'house';
const LABELS: Record<Which, string> = { plan: 'Plan', iso: '3D', section: 'Edge', house: 'House' };

/** The viewBox's width ÷ height, so the drawing keeps its shape at any screen width. */
function aspect(svg: string): number {
  const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  return m ? Number(m[1]) / Number(m[2]) : 1.6;
}

/** Plan / 3D / Edge drawings under a tool's answers. */
export default function DrawingView({ drawings }: { drawings: Drawings }) {
  const [which, setWhich] = useState<Which>(drawings.plan ? 'plan' : 'iso');
  const [width, setWidth] = useState(0);
  const tabs = (['plan', 'iso', 'section', 'house'] as Which[]).filter((w) => drawings[w]);
  const shown = drawings[tabs.includes(which) ? which : tabs[0]]!;
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <View style={styles.wrap}>
      <View style={styles.tabs}>
        {tabs.map((w) => {
          const on = w === which;
          return (
            <Pressable
              key={w}
              onPress={() => {
                if (!on) feel.tap();
                setWhich(w);
              }}
              style={[styles.tab, on && styles.tabOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`Show ${LABELS[w]} drawing`}
            >
              <Text style={[styles.tabText, on && styles.tabTextOn]}>{LABELS[w]}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.drawing} onLayout={onLayout} accessibilityRole="image" accessibilityLabel={`${LABELS[which]} drawing`}>
        {width > 0 ? <SvgXml xml={shown} width={width} height={width / aspect(shown)} /> : null}
      </View>
    </View>
  );
}

const getStyles = themed(() => ({
  wrap: { marginBottom: 14 },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  tab: { backgroundColor: colors.panel2, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
  tabOn: { backgroundColor: colors.accent },
  tabText: { fontSize: 15, fontWeight: '700', color: colors.text },
  tabTextOn: { color: colors.accentText },
  drawing: { borderRadius: 14, overflow: 'hidden', backgroundColor: '#ffffff' },
}));

// Rebuilt when the colors or text size change.
let styles = getStyles();
onThemeChange(() => {
  styles = getStyles();
});
