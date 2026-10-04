import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { HistoryEntry } from './src/lib/history';
import { TabId, useSettings } from './src/lib/settings';
import CalculatorScreen from './src/screens/CalculatorScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import JobsScreen from './src/screens/JobsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ToolsTab, { OpenRequest } from './src/screens/ToolsTab';
import { TABS } from './src/tabs';
import { colors, mode, onThemeChange, themed } from './src/theme';

export default function App() {
  const prefs = useSettings();
  const [tab, setTab] = useState<TabId>(prefs.tabOrder[0]);
  const [overlay, setOverlay] = useState<'history' | 'settings' | null>(null);
  const [request, setRequest] = useState<{ tab: TabId; req: OpenRequest } | null>(null);

  // Start on the first tab in your order (settings load a moment after the app opens).
  const picked = useRef(false);
  useEffect(() => {
    if (!picked.current) setTab(prefs.tabOrder[0]);
  }, [prefs.tabOrder[0]]);

  // Repaint everything when the colors or text size change.
  const [, setLook] = useState(0);
  useEffect(() => onThemeChange(() => setLook((n) => n + 1)), []);

  // From History or a job: jump to the tool's tab and open it with the saved numbers.
  const openTool = (toolId: string, raw: HistoryEntry['raw'], jobLink?: OpenRequest['jobLink']) => {
    const id = (Object.keys(TABS) as TabId[]).find((k) => TABS[k].groups?.some((g) => g.tools.some((t) => t.id === toolId)));
    if (!id) return;
    picked.current = true;
    setRequest({ tab: id, req: { toolId, raw, n: Date.now(), jobLink } });
    setTab(id);
    setOverlay(null);
  };
  const openEntry = (e: HistoryEntry) => openTool(e.toolId, e.raw);

  // All tabs stay mounted so numbers aren't lost when switching tabs.
  const screen = (id: TabId) => {
    const t = TABS[id];
    if (id === 'jobs') return <JobsScreen onOpenItem={(job, item) => openTool(item.toolId, item.raw, { jobId: job.id, itemId: item.id })} />;
    if (!t.groups) return <CalculatorScreen />;
    return (
      <ToolsTab
        title={t.title!}
        groups={t.groups}
        active={tab === id && !overlay}
        onOpenHistory={() => setOverlay('history')}
        onOpenSettings={() => setOverlay('settings')}
        request={request?.tab === id ? request.req : undefined}
      />
    );
  };

  return (
    <SafeAreaProvider>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
        <View style={styles.body}>
          {prefs.tabOrder.map((id) => (
            <View key={id} style={[styles.screen, (id !== tab || overlay) && styles.hidden]}>
              {screen(id)}
            </View>
          ))}
          {overlay === 'history' && (
            <View style={styles.screen}>
              <HistoryScreen onClose={() => setOverlay(null)} onOpen={openEntry} />
            </View>
          )}
          {overlay === 'settings' && (
            <View style={styles.screen}>
              <SettingsScreen onClose={() => setOverlay(null)} />
            </View>
          )}
        </View>
      </SafeAreaView>
      <SafeAreaView style={styles.tabBarWrap} edges={['bottom', 'left', 'right']}>
        <View style={styles.tabBar}>
          {prefs.tabOrder.map((id) => {
            const active = id === tab && !overlay;
            return (
              <Pressable
                key={id}
                onPress={() => {
                  picked.current = true;
                  setTab(id);
                  setOverlay(null);
                }}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={[styles.tab, active && styles.tabActive]}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1} maxFontSizeMultiplier={1.15}>
                  {TABS[id].name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const getStyles = themed(() => ({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  screen: { flex: 1 },
  hidden: { display: 'none' },
  tabBarWrap: { backgroundColor: colors.panel, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  tabBar: { flexDirection: 'row', height: 56 },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 6,
    marginHorizontal: 2,
    borderRadius: 999,
  },
  tabActive: { backgroundColor: colors.panel2 },
  tabText: { fontSize: 14, fontWeight: '600', color: colors.subtext },
  tabTextActive: { color: colors.accent, fontWeight: '800' },
}), { scaleText: false });

// Rebuilt when the colors or text size change in Settings.
let styles = getStyles();
onThemeChange(() => {
  styles = getStyles();
});
