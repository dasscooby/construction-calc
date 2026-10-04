import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { RawValues, defaultRaw, restoreRaw } from '../tools/run';
import { Tool } from '../tools/types';
import { colors } from '../theme';
import ToolScreen from './ToolScreen';

export interface ToolGroup {
  heading?: string;
  tools: Tool[];
}

/** Open this tool with these numbers in the boxes (from History). `n` changes on every request. */
export interface OpenRequest {
  toolId: string;
  raw: RawValues;
  n: number;
}

interface Props {
  title: string;
  groups: ToolGroup[];
  active: boolean;
  onOpenHistory: () => void;
  request?: OpenRequest;
}

/** A tab's menu of tools. Tapping one opens it; numbers stay filled in, even after the app is closed. */
export default function ToolsTab({ title, groups, active, onOpenHistory, request }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [raws, setRaws] = useState<Record<string, RawValues>>({});
  const [loaded, setLoaded] = useState(false);
  const all = groups.flatMap((g) => g.tools);
  const tool = all.find((t) => t.id === openId);
  const saveKey = `tools-${title}`;

  useEffect(() => {
    AsyncStorage.getItem(saveKey)
      .then((text) => {
        if (!text) return;
        const saved = JSON.parse(text) as Record<string, unknown>;
        const restored: Record<string, RawValues> = {};
        for (const t of all) if (saved[t.id]) restored[t.id] = restoreRaw(t, saved[t.id]);
        setRaws(restored);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []); // load once

  useEffect(() => {
    if (loaded) AsyncStorage.setItem(saveKey, JSON.stringify(raws)).catch(() => {});
  }, [loaded, raws, saveKey]);

  useEffect(() => {
    if (!request) return;
    const t = all.find((x) => x.id === request.toolId);
    if (!t) return;
    setRaws((prev) => ({ ...prev, [t.id]: restoreRaw(t, request.raw) }));
    setOpenId(t.id);
  }, [request?.n]); // each new request

  if (tool) {
    return (
      <ToolScreen
        tool={tool}
        raw={raws[tool.id] ?? defaultRaw(tool)}
        onChange={(r) => setRaws((prev) => ({ ...prev, [tool.id]: r }))}
        onBack={() => setOpenId(null)}
        active={active}
      />
    );
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <View style={styles.titleRow}>
        <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit>
          {title}
        </Text>
        <Pressable onPress={onOpenHistory} style={styles.historyBtn} accessibilityRole="button">
          <Text style={styles.historyText}>History</Text>
        </Pressable>
      </View>
      {groups.map((g, gi) => (
        <View key={gi}>
          {g.heading ? <Text style={styles.heading}>{g.heading}</Text> : null}
          {g.tools.map((t) => (
            <Pressable
              key={t.id}
              onPress={() => setOpenId(t.id)}
              accessibilityRole="button"
              accessibilityLabel={t.title}
              style={({ pressed }) => [styles.item, pressed && styles.pressed]}
            >
              <View style={styles.itemText}>
                <Text style={styles.itemTitle}>{t.title}</Text>
                <Text style={styles.itemBlurb}>{t.blurb}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 14, paddingBottom: 30 },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  title: { flex: 1, fontSize: 34, fontWeight: '800', color: colors.text, marginLeft: 2 },
  historyBtn: { backgroundColor: colors.panel2, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9, marginLeft: 8 },
  historyText: { color: colors.accent, fontSize: 17, fontWeight: '700' },
  heading: { fontSize: 14, fontWeight: '700', color: colors.subtext, marginTop: 12, marginBottom: 6, marginLeft: 4, textTransform: 'uppercase', letterSpacing: 0.6 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 10,
    backgroundColor: colors.panel,
  },
  pressed: { backgroundColor: colors.panel2 },
  itemText: { flex: 1 },
  itemTitle: { fontSize: 19, fontWeight: '700', color: colors.text },
  itemBlurb: { fontSize: 14, color: colors.subtext, marginTop: 2 },
  chevron: { fontSize: 30, fontWeight: '400', color: colors.faint, marginLeft: 8 },
});
