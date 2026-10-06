// New features reach the phone app as updates. The app checks when it opens and every time you come
// back to it; once one is downloaded, a bar at the top says "Update ready: tap to restart".

import { useEffect, useState } from 'react';
import { AppState, Platform, Pressable, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../theme';
import { flushSaves } from './savedList';

type U = typeof import('expo-updates');

const updates = (): U | null => {
  if (Platform.OS === 'web') return null;
  try {
    const u = require('expo-updates') as U;
    return u.isEnabled ? u : null;
  } catch {
    return null;
  }
};

export function UpdateBar() {
  const [ready, setReady] = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const U = updates();
    if (!U) return;
    let busy = false;
    const check = async () => {
      if (busy) return;
      busy = true;
      try {
        const r = await U.checkForUpdateAsync();
        if (r.isAvailable) {
          const f = await U.fetchUpdateAsync();
          if (f.isNew) setReady(true);
        }
      } catch {
        // no signal: try again next time
      }
      busy = false;
    };
    void check();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void check());
    return () => sub.remove();
  }, []);

  if (!ready) return null;
  return (
    <Pressable
      onPress={() => {
        // Save anything still waiting before the app restarts on the new version.
        flushSaves();
        void updates()?.reloadAsync().catch(() => {});
      }}
      accessibilityRole="button"
      style={{
        position: 'absolute',
        top: insets.top + 6,
        left: 12,
        right: 12,
        zIndex: 50,
        backgroundColor: colors.accent,
        borderRadius: 14,
        paddingVertical: 12,
        paddingHorizontal: 16,
        alignItems: 'center',
      }}
    >
      <Text style={{ fontSize: 16, fontWeight: '800', color: colors.accentText }}>Update ready: tap to restart</Text>
    </Pressable>
  );
}
