// A red bar when saving on the phone fails (usually the phone is out of space), so nothing is lost
// without anyone knowing.

import { useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { onSaveProblem, saveProblem } from './savedList';

export function SaveProblemBar() {
  const problem = useSyncExternalStore(onSaveProblem, saveProblem, saveProblem);
  const insets = useSafeAreaInsets();
  if (!problem) return null;
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, paddingTop: insets.top + 6, paddingBottom: 10, paddingHorizontal: 16, backgroundColor: '#c0261b' }} accessibilityRole="alert">
      <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>{problem}</Text>
    </View>
  );
}
