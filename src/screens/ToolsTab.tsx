import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { settings, userDefaults, useSettings } from '../lib/settings';
import { RawValues, defaultRaw, restoreRaw } from '../tools/run';
import { Tool } from '../tools/types';
import { colors, onThemeChange, themed } from '../theme';
import ToolScreen from './ToolScreen';

export interface ToolGroup {
  heading?: string;
  tools: Tool[];
}

/** A tool opened from a job: "Save changes" writes back to this item. */
export interface JobLink {
  jobId: string;
  itemId: string;
}

/** Open this tool with these numbers in the boxes (from History or a job). `n` changes on every request. */
export interface OpenRequest {
  toolId: string;
  raw: RawValues;
  n: number;
  jobLink?: JobLink;
}

interface Props {
  title: string;
  groups: ToolGroup[];
  active: boolean;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  request?: OpenRequest;
  /** Open another tool (any tab) filled in with these numbers */
  onSend: (toolId: string, raw: RawValues) => void;
}

/** A tab's menu of tools. Tapping one opens it; numbers stay filled in, even after the app is closed. */
export default function ToolsTab({ title, groups, active, onOpenHistory, onOpenSettings, request, onSend }: Props) {
  const prefs = useSettings();
  const [openId, setOpenId] = useState<string | null>(null);
  const [raws, setRaws] = useState<Record<string, RawValues>>({});
  const [loaded, setLoaded] = useState(false);
  const [links, setLinks] = useState<Record<string, JobLink | undefined>>({});
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
    setLinks((prev) => ({ ...prev, [t.id]: request.jobLink }));
    setOpenId(t.id);
  }, [request?.n]); // each new request

  // Favorites on top, then each group without the hidden (and already-pinned) tools.
  const visible = (t: Tool) => !prefs.hidden.includes(t.id);
  const pinned = all.filter((t) => visible(t) && prefs.favorites.includes(t.id));
  const shown: ToolGroup[] = [
    ...(pinned.length ? [{ heading: 'Favorites', tools: pinned }] : []),
    ...groups
      .map((g) => ({ ...g, tools: g.tools.filter((t) => visible(t) && !prefs.favorites.includes(t.id)) }))
      .filter((g) => g.tools.length),
  ];
  // A group without a heading would run into Favorites, so give it the tab's name.
  if (pinned.length) for (const g of shown.slice(1)) g.heading = g.heading ?? `All ${title.toLowerCase()}`;
  const hiddenCount = all.filter((t) => !visible(t)).length;

  if (tool) {
    return (
      <ToolScreen
        tool={tool}
        raw={raws[tool.id] ?? defaultRaw(tool, userDefaults(tool, prefs))}
        onChange={(r) => setRaws((prev) => ({ ...prev, [tool.id]: r }))}
        onBack={() => setOpenId(null)}
        active={active}
        jobLink={links[tool.id]}
        onJobLink={(link) => setLinks((prev) => ({ ...prev, [tool.id]: link }))}
        onSend={onSend}
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
        <Pressable onPress={onOpenSettings} style={styles.historyBtn} accessibilityRole="button" accessibilityLabel="Settings">
          <Text style={styles.historyText}>⚙︎</Text>
        </Pressable>
      </View>
      {shown.map((g, gi) => (
        <View key={gi}>
          {g.heading ? <Text style={styles.heading}>{g.heading}</Text> : null}
          {g.tools.map((t) => {
            const fav = prefs.favorites.includes(t.id);
            return (
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
                <Pressable
                  onPress={() => settings.toggle('favorites', t.id)}
                  hitSlop={10}
                  style={styles.star}
                  accessibilityRole="button"
                  accessibilityLabel={fav ? `Unpin ${t.title}` : `Pin ${t.title} to the top`}
                >
                  <Text style={[styles.starText, fav && styles.starOn]}>{fav ? '★' : '☆'}</Text>
                </Pressable>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
      {hiddenCount > 0 && (
        <Pressable onPress={onOpenSettings} accessibilityRole="button">
          <Text style={styles.hiddenNote}>
            {hiddenCount} hidden {hiddenCount === 1 ? 'tool' : 'tools'} · Show in Settings
          </Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const getStyles = themed(() => ({
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
  star: { paddingHorizontal: 8, paddingVertical: 4 },
  starText: { fontSize: 24, color: colors.faint },
  starOn: { color: colors.accent },
  hiddenNote: { fontSize: 15, color: colors.subtext, textAlign: 'center', marginTop: 8 },
}));

// Rebuilt when the colors or text size change in Settings.
let styles = getStyles();
onThemeChange(() => {
  styles = getStyles();
});
