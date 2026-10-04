// Haptics: little taps you feel on key presses, a buzz when something saves, a thud on errors.
// Phone app only (needs app 1.1+); turned off in Settings → Look → Key clicks.

import { Platform } from 'react-native';

import { settings } from './settings';

type Haptics = typeof import('expo-haptics');

let haptics: Haptics | null = null;
if (Platform.OS === 'ios' || Platform.OS === 'android') {
  try {
    haptics = require('expo-haptics') as Haptics;
  } catch {
    haptics = null; // an older app build without haptics
  }
}

const on = () => haptics !== null && settings.get().haptics;
const quiet = (p: Promise<void>) => p.catch(() => {});

export const feel = {
  /** Calculator keys */
  key() {
    if (on()) quiet(haptics!.impactAsync(haptics!.ImpactFeedbackStyle.Light));
  },
  /** Tabs, chips, picks */
  tap() {
    if (on()) quiet(haptics!.selectionAsync());
  },
  /** Saved, added to a job, shared */
  success() {
    if (on()) quiet(haptics!.notificationAsync(haptics!.NotificationFeedbackType.Success));
  },
  /** Calculator errors */
  error() {
    if (on()) quiet(haptics!.notificationAsync(haptics!.NotificationFeedbackType.Error));
  },
};
