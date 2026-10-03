import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { RawValues, defaultRaw, restoreRaw } from '../tools/run';
import { Tool } from '../tools/types';
import { colors } from '../theme';
import ToolScreen from './ToolScreen';

export interface ToolGroup {
  heading?: string;
  tools: Tool[];
}

/** A tab's menu of tools. Tapping one opens it; numbers stay filled in, even after the app is closed. */
export default function ToolsTab({ title, groups, active }: { title: string; groups: ToolGroup[]; active: boolean }) {
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

  // Android back button/gesture: leave the open tool before leaving the app.
  useEffect(() => {
    if (!active || !openId) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setOpenId(null);
      return true;
    });
    return () => sub.remove();
  }, [active, openId]);

  if (tool) {
    return (
      <ToolScreen
        tool={tool}
        raw={raws[tool.id] ?? defaultRaw(tool)}
        onChange={(r) => setRaws((prev) => ({ ...prev, [tool.id]: r }))}
        onBack={() => setOpenId(null)}
      />
    );
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{title}</Text>
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
  content: { padding: 12, paddingBottom: 30 },
  title: { fontSize: 30, fontWeight: '900', color: colors.text, marginBottom: 8, marginLeft: 4 },
  heading: { fontSize: 17, fontWeight: '900', color: colors.subtext, marginTop: 10, marginBottom: 6, marginLeft: 4 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 10,
    backgroundColor: colors.bg,
  },
  pressed: { backgroundColor: colors.panel },
  itemText: { flex: 1 },
  itemTitle: { fontSize: 21, fontWeight: '900', color: colors.text },
  itemBlurb: { fontSize: 15, color: colors.subtext, marginTop: 2 },
  chevron: { fontSize: 34, fontWeight: '700', color: colors.text, marginLeft: 8 },
});
