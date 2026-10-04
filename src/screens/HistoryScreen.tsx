import { useEffect, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { dayLabel, history, HistoryEntry, timeLabel, useHistory } from '../lib/history';
import { colors, onThemeChange, themed } from '../theme';
import { ShareButton } from './ToolScreen';

interface Props {
  onClose: () => void;
  /** Open the saved numbers back up in their tool */
  onOpen: (entry: HistoryEntry) => void;
}

/** Every saved calculation, newest first. Tap one to see it all, share it, or open it in the tool again. */
export default function HistoryScreen({ onClose, onOpen }: Props) {
  const entries = useHistory();
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const open = entries.find((e) => e.id === openId);

  // Android back: close the detail, then History.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (openId) setOpenId(null);
      else onClose();
      return true;
    });
    return () => sub.remove();
  }, [openId, onClose]);

  if (open) {
    return (
      <View style={styles.page}>
        <Header left="‹ History" onLeft={() => setOpenId(null)} title={open.title} />
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.when}>
            {dayLabel(open.at)} · {timeLabel(open.at)}
          </Text>
          <View style={styles.card}>
            <Text style={styles.fullText} selectable>
              {open.text.split('\n').slice(2).join('\n')}
            </Text>
          </View>
          <ShareButton text={open.text} />
          <Pressable onPress={() => onOpen(open)} style={styles.wideBtn} accessibilityRole="button">
            <Text style={styles.wideBtnText}>Open in {open.title}</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              history.remove(open.id);
              setOpenId(null);
            }}
            style={styles.wideBtn}
            accessibilityRole="button"
          >
            <Text style={[styles.wideBtnText, styles.danger]}>Delete</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // Group by day: Today, Yesterday, Mon, Sep 28 ...
  const days: { label: string; items: HistoryEntry[] }[] = [];
  for (const e of entries) {
    const label = dayLabel(e.at);
    if (days[days.length - 1]?.label !== label) days.push({ label, items: [] });
    days[days.length - 1].items.push(e);
  }

  return (
    <View style={styles.page}>
      <Header left="‹ Back" onLeft={onClose} title="History" />
      <ScrollView contentContainerStyle={styles.content}>
        {entries.length === 0 ? (
          <Text style={styles.empty}>Nothing saved yet.{'\n'}Use a tool and tap Back. Your numbers show up here.</Text>
        ) : (
          days.map((d) => (
            <View key={d.label}>
              <Text style={styles.day}>{d.label}</Text>
              {d.items.map((e) => (
                <Pressable
                  key={e.id}
                  onPress={() => setOpenId(e.id)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.item, pressed && styles.pressed]}
                >
                  <View style={styles.itemHead}>
                    <Text style={styles.itemTitle}>{e.title}</Text>
                    <Text style={styles.itemTime}>{timeLabel(e.at)}</Text>
                  </View>
                  {e.main.map((m) => (
                    <View key={m.label} style={styles.mainRow}>
                      <Text style={styles.mainLabel} numberOfLines={1}>
                        {m.label}
                      </Text>
                      <Text style={styles.mainValue} numberOfLines={1}>
                        {m.value}
                      </Text>
                    </View>
                  ))}
                </Pressable>
              ))}
            </View>
          ))
        )}
        {entries.length > 0 &&
          (confirmClear ? (
            <View style={styles.confirm}>
              <Text style={styles.confirmText}>Delete all {entries.length} saved calculations?</Text>
              <View style={styles.confirmRow}>
                <Pressable onPress={() => setConfirmClear(false)} style={[styles.wideBtn, styles.half]} accessibilityRole="button">
                  <Text style={styles.wideBtnText}>Keep them</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    history.clear();
                    setConfirmClear(false);
                  }}
                  style={[styles.wideBtn, styles.half]}
                  accessibilityRole="button"
                >
                  <Text style={[styles.wideBtnText, styles.danger]}>Delete all</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable onPress={() => setConfirmClear(true)} style={styles.wideBtn} accessibilityRole="button">
              <Text style={[styles.wideBtnText, styles.danger]}>Clear history</Text>
            </Pressable>
          ))}
      </ScrollView>
    </View>
  );
}

function Header({ left, onLeft, title }: { left: string; onLeft: () => void; title: string }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onLeft} style={styles.back} accessibilityRole="button">
        <Text style={styles.backText}>{left}</Text>
      </Pressable>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.back} />
    </View>
  );
}

const hairline = StyleSheet.hairlineWidth;

const getStyles = themed(() => ({
  page: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: hairline,
    borderBottomColor: colors.border,
  },
  back: { paddingVertical: 10, paddingHorizontal: 8, minWidth: 96 },
  backText: { fontSize: 19, fontWeight: '600', color: colors.accent },
  title: { flex: 1, fontSize: 20, fontWeight: '700', color: colors.text, textAlign: 'center' },
  content: { padding: 14, paddingBottom: 30 },
  empty: { fontSize: 18, color: colors.subtext, textAlign: 'center', marginTop: 40, lineHeight: 26 },
  day: { fontSize: 14, fontWeight: '700', color: colors.subtext, marginTop: 8, marginBottom: 6, marginLeft: 4, textTransform: 'uppercase', letterSpacing: 0.6 },
  item: { backgroundColor: colors.panel, borderRadius: 16, padding: 14, marginBottom: 10 },
  pressed: { backgroundColor: colors.panel2 },
  itemHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 },
  itemTitle: { fontSize: 19, fontWeight: '700', color: colors.text, flexShrink: 1 },
  itemTime: { fontSize: 14, color: colors.subtext, marginLeft: 8 },
  mainRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 2 },
  mainLabel: { fontSize: 15, color: colors.subtext, flexShrink: 1, marginRight: 8 },
  mainValue: { fontSize: 20, fontWeight: '500', color: colors.accent },
  when: { fontSize: 15, color: colors.subtext, marginBottom: 10 },
  card: { backgroundColor: colors.panel, borderRadius: 16, padding: 14, marginBottom: 14 },
  fullText: { fontSize: 16, color: colors.text, lineHeight: 24 },
  wideBtn: { backgroundColor: colors.panel2, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginBottom: 12 },
  wideBtnText: { fontSize: 17, fontWeight: '700', color: colors.accent },
  danger: { color: colors.danger },
  confirm: { backgroundColor: colors.panel, borderRadius: 16, padding: 14, marginTop: 4 },
  confirmText: { fontSize: 17, fontWeight: '600', color: colors.text, textAlign: 'center', marginBottom: 12 },
  confirmRow: { flexDirection: 'row', gap: 10 },
  half: { flex: 1, marginBottom: 0 },
}));

// Rebuilt when the colors or text size change in Settings.
let styles = getStyles();
onThemeChange(() => {
  styles = getStyles();
});
