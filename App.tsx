import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { HistoryEntry } from './src/lib/history';
import CalculatorScreen from './src/screens/CalculatorScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import ToolsTab, { OpenRequest, ToolGroup } from './src/screens/ToolsTab';
import { CONCRETE_GROUPS, ENGINEERING_GROUPS, REBAR_GROUPS, SITE_GROUPS } from './src/tools';
import { colors } from './src/theme';

const TABS = ['Calc', 'Concrete', 'Rebar', 'Site', 'Engineer'] as const;

// Tabs 1–4 are tool menus.
const TOOL_TABS: { title: string; groups: ToolGroup[] }[] = [
  { title: 'Concrete', groups: CONCRETE_GROUPS },
  { title: 'Rebar', groups: REBAR_GROUPS },
  { title: 'Site & Layout', groups: SITE_GROUPS },
  { title: 'Engineering', groups: ENGINEERING_GROUPS },
];

export default function App() {
  const [tab, setTab] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [request, setRequest] = useState<{ tab: number; req: OpenRequest } | null>(null);

  // From History: jump to the tool's tab and open it with the saved numbers.
  const openEntry = (e: HistoryEntry) => {
    const i = TOOL_TABS.findIndex((t) => t.groups.some((g) => g.tools.some((tool) => tool.id === e.toolId)));
    if (i < 0) return;
    setRequest({ tab: i + 1, req: { toolId: e.toolId, raw: e.raw, n: Date.now() } });
    setTab(i + 1);
    setShowHistory(false);
  };

  // All tabs stay mounted so numbers aren't lost when switching tabs.
  const screens = [
    <CalculatorScreen />,
    ...TOOL_TABS.map((t, i) => (
      <ToolsTab
        title={t.title}
        groups={t.groups}
        active={tab === i + 1 && !showHistory}
        onOpenHistory={() => setShowHistory(true)}
        request={request?.tab === i + 1 ? request.req : undefined}
      />
    )),
  ];

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
        <View style={styles.body}>
          {screens.map((screen, i) => (
            <View key={TABS[i]} style={[styles.screen, (i !== tab || showHistory) && styles.hidden]}>
              {screen}
            </View>
          ))}
          {showHistory && (
            <View style={styles.screen}>
              <HistoryScreen onClose={() => setShowHistory(false)} onOpen={openEntry} />
            </View>
          )}
        </View>
      </SafeAreaView>
      <SafeAreaView style={styles.tabBarWrap} edges={['bottom', 'left', 'right']}>
        <View style={styles.tabBar}>
          {TABS.map((name, i) => {
            const active = i === tab;
            return (
              <Pressable
                key={name}
                onPress={() => {
                  setTab(i);
                  setShowHistory(false);
                }}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={[styles.tab, active && styles.tabActive]}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1} maxFontSizeMultiplier={1.15}>
                  {name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
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
    marginHorizontal: 3,
    borderRadius: 999,
  },
  tabActive: { backgroundColor: colors.panel2 },
  tabText: { fontSize: 15, fontWeight: '600', color: colors.subtext },
  tabTextActive: { color: colors.accent, fontWeight: '800' },
});
