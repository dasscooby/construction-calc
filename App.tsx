import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { StatusBar } from 'expo-status-bar';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { feel } from './src/lib/feel';
import { HistoryEntry } from './src/lib/history';
import { useJobs } from './src/lib/jobs';
import { syncWidgets } from './src/lib/jobSync';
import { TabId, useSettings } from './src/lib/settings';
import CalculatorScreen from './src/screens/CalculatorScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import JobsScreen from './src/screens/JobsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ToolsTab, { OpenRequest } from './src/screens/ToolsTab';
import { startPlanQueue } from './src/lib/planReader';
import { TABS } from './src/tabs';
import { migrateItem } from './src/tools';
import { colors, mode, onThemeChange, themed } from './src/theme';

// iPhone tab icons (SF Symbols). Web and Android show the names only.
const TAB_SYMBOLS: Record<TabId, string> = {
  calc: 'plus.forwardslash.minus',
  concrete: 'cube.fill',
  rebar: 'grid',
  site: 'mountain.2.fill',
  engineer: 'ruler.fill',
  jobs: 'folder.fill',
};
const SHOW_ICONS = Platform.OS === 'ios';
// iOS 26 Liquid Glass tab bar (back on after build 8 tested fine). Any trouble checking for glass
// falls back to the plain bar.
const GLASS_TAB_BAR = true;
const GLASS = (() => {
  try {
    return GLASS_TAB_BAR && Platform.OS === 'ios' && isLiquidGlassAvailable();
  } catch {
    return false; // no glass on this phone: plain tab bar
  }
})();

export default function App() {
  const prefs = useSettings();
  const jobs = useJobs();

  // Keep the Home Screen widget and any pour on the Lock Screen up to date (iPhone).
  useEffect(() => syncWidgets(jobs), [jobs, prefs.accent, prefs.mode]);
  // Plans picked with no signal get read once it's back.
  useEffect(() => startPlanQueue(), []);
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
  const openTool = (oldId: string, oldRaw: HistoryEntry['raw'], jobLink?: OpenRequest['jobLink']) => {
    const { toolId, raw } = migrateItem(oldId, oldRaw) as { toolId: string; raw: HistoryEntry['raw'] };
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
        onSend={(toolId, raw) => openTool(toolId, raw)}
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
      <SafeAreaView style={[styles.tabBarWrap, GLASS && styles.tabBarWrapGlass]} edges={['bottom', 'left', 'right']}>
        <TabBarBackground>
          {prefs.tabOrder.map((id) => {
            const active = id === tab && !overlay;
            return (
              <Pressable
                key={id}
                onPress={() => {
                  picked.current = true;
                  if (id !== tab || overlay) feel.tap();
                  setTab(id);
                  setOverlay(null);
                }}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={[styles.tab, active && styles.tabActive]}
              >
                {SHOW_ICONS && (
                  <SymbolView
                    name={TAB_SYMBOLS[id] as never}
                    size={21}
                    tintColor={active ? colors.accent : colors.subtext}
                    weight={active ? 'semibold' : 'regular'}
                  />
                )}
                <Text
                  style={[styles.tabText, SHOW_ICONS && styles.tabTextSmall, active && styles.tabTextActive]}
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.15}
                >
                  {TABS[id].name}
                </Text>
              </Pressable>
            );
          })}
        </TabBarBackground>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

/** The row of tabs: a floating glass pill on iOS 26, a plain bar everywhere else. */
function TabBarBackground({ children }: { children: React.ReactNode }) {
  if (GLASS) {
    return (
      <GlassView style={[styles.tabBar, styles.tabBarGlass]} glassEffectStyle="regular" isInteractive>
        {children}
      </GlassView>
    );
  }
  return <View style={styles.tabBar}>{children}</View>;
}

const getStyles = themed(() => ({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  screen: { flex: 1 },
  hidden: { display: 'none' },
  tabBarWrap: { backgroundColor: colors.panel, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  tabBarWrapGlass: { backgroundColor: colors.bg, borderTopWidth: 0 },
  tabBar: { flexDirection: 'row', height: SHOW_ICONS ? 60 : 56 },
  tabBarGlass: { marginHorizontal: 10, marginTop: 4, marginBottom: 2, borderRadius: 30, overflow: 'hidden' },
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
  tabTextSmall: { fontSize: 11, marginTop: 2 },
  tabTextActive: { color: colors.accent, fontWeight: '800' },
}), { scaleText: false });

// Rebuilt when the colors or text size change in Settings.
let styles = getStyles();
onThemeChange(() => {
  styles = getStyles();
});
