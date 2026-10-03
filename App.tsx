import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import CalculatorScreen from './src/screens/CalculatorScreen';
import ToolsTab from './src/screens/ToolsTab';
import { CONCRETE_GROUPS, ENGINEERING_GROUPS, REBAR_GROUPS, SITE_GROUPS } from './src/tools';
import { colors } from './src/theme';

const TABS = ['Calc', 'Concrete', 'Rebar', 'Site', 'Engineer'] as const;

export default function App() {
  const [tab, setTab] = useState(0);

  // All tabs stay mounted so numbers aren't lost when switching tabs.
  const screens = [
    <CalculatorScreen />,
    <ToolsTab title="Concrete" groups={CONCRETE_GROUPS} active={tab === 1} />,
    <ToolsTab title="Rebar" groups={REBAR_GROUPS} active={tab === 2} />,
    <ToolsTab title="Site & Layout" groups={SITE_GROUPS} active={tab === 3} />,
    <ToolsTab title="Engineering" groups={ENGINEERING_GROUPS} active={tab === 4} />,
  ];

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
        <View style={styles.body}>
          {screens.map((screen, i) => (
            <View key={TABS[i]} style={[styles.screen, i !== tab && styles.hidden]}>
              {screen}
            </View>
          ))}
        </View>
      </SafeAreaView>
      <SafeAreaView style={styles.tabBarWrap} edges={['bottom', 'left', 'right']}>
        <View style={styles.tabBar}>
          {TABS.map((name, i) => {
            const active = i === tab;
            return (
              <Pressable
                key={name}
                onPress={() => setTab(i)}
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
  tabBarWrap: { backgroundColor: colors.bg, borderTopWidth: 3, borderTopColor: colors.border },
  tabBar: { flexDirection: 'row', height: 56 },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
    marginHorizontal: 2,
    borderRadius: 10,
  },
  tabActive: { backgroundColor: colors.accent },
  tabText: { fontSize: 15, fontWeight: '700', color: colors.subtext },
  tabTextActive: { color: colors.text, fontWeight: '900' },
});
