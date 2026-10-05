import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { feel } from '../lib/feel';
import { colors, onThemeChange, themed } from '../theme';

export interface PickOption {
  key: string;
  label: string;
  sub?: string;
  group?: string;
}

/** A list that slides up from the bottom: tap one to pick it. Options can be grouped under headings. */
export default function PickSheet({
  visible,
  title,
  options,
  selected,
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: PickOption[];
  selected?: string;
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const groups: { name: string; options: PickOption[] }[] = [];
  for (const o of options) {
    const g = o.group ?? '';
    const last = groups[groups.length - 1];
    if (last && last.name === g) last.options.push(o);
    else groups.push({ name: g, options: [o] });
  }
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close">
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.head}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onClose} accessibilityRole="button" style={styles.done}>
              <Text style={styles.doneText}>Cancel</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {groups.map((g) => (
              <View key={g.name || 'all'}>
                {g.name ? <Text style={styles.group}>{g.name}</Text> : null}
                {g.options.map((o) => {
                  const on = o.key === selected;
                  return (
                    <Pressable
                      key={o.key}
                      onPress={() => {
                        feel.tap();
                        onPick(o.key);
                      }}
                      style={[styles.row, on && styles.rowOn]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={[styles.label, on && styles.labelOn]}>{o.label}</Text>
                      {o.sub ? <Text style={styles.sub}>{o.sub}</Text> : null}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const getStyles = themed(() => ({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%', paddingBottom: 30 },
  head: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  title: { flex: 1, fontSize: 19, fontWeight: '800', color: colors.text },
  done: { paddingHorizontal: 8, paddingVertical: 4 },
  doneText: { fontSize: 17, fontWeight: '700', color: colors.accent },
  list: { paddingHorizontal: 12 },
  group: { fontSize: 13, fontWeight: '800', color: colors.subtext, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 14, marginBottom: 6, marginLeft: 4 },
  row: { backgroundColor: colors.panel, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 6 },
  rowOn: { borderWidth: 2, borderColor: colors.accent },
  label: { fontSize: 17, fontWeight: '600', color: colors.text },
  labelOn: { color: colors.accent, fontWeight: '800' },
  sub: { fontSize: 14, color: colors.subtext, marginTop: 2 },
}));

// Rebuilt when the colors or text size change.
let styles = getStyles();
onThemeChange(() => {
  styles = getStyles();
});
