// Safety net: if the app's code hits an error, show what went wrong instead of closing.
// The person can copy the message and send it, and tap to try again.

import { Component, ReactNode, useSyncExternalStore } from 'react';
import { Pressable, ScrollView, Share, Text, View } from 'react-native';

interface Caught {
  message: string;
  stack: string;
}

let caught: Caught | null = null;
const listeners = new Set<() => void>();

function report(e: unknown) {
  const err = e instanceof Error ? e : new Error(String(e));
  caught = { message: err.message, stack: (err.stack ?? '').split('\n').slice(0, 12).join('\n') };
  listeners.forEach((l) => l());
}

/** Catch errors that happen outside drawing the screen (timers, saved data loading, …) instead of closing the app. */
export function installCrashGuard() {
  const g = globalThis as unknown as { ErrorUtils?: { setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => void } };
  g.ErrorUtils?.setGlobalHandler((e) => report(e));
}

// On as soon as this file loads (index.ts loads it before the rest of the app).
installCrashGuard();

const useCaught = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => caught,
  );

function ErrorScreen({ error, onRetry }: { error: Caught; onRetry: () => void }) {
  const text = `Construction Calc error\n${error.message}\n\n${error.stack}`;
  return (
    <View style={{ flex: 1, backgroundColor: '#000', paddingTop: 70, paddingHorizontal: 20 }}>
      <Text style={{ color: '#FF9F0A', fontSize: 26, fontWeight: '800', marginBottom: 10 }}>Something broke</Text>
      <Text style={{ color: '#fff', fontSize: 17, marginBottom: 16, lineHeight: 23 }}>
        The app hit an error instead of closing. Tap Send to share this with the developer, then Try again.
      </Text>
      <ScrollView style={{ flex: 1, backgroundColor: '#1C1C1E', borderRadius: 14, padding: 12, marginBottom: 14 }}>
        <Text selectable style={{ color: '#fff', fontSize: 14, fontFamily: 'Menlo' }}>
          {text}
        </Text>
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 40 }}>
        <Pressable
          onPress={() => Share.share({ message: text }).catch(() => {})}
          style={{ flex: 1, backgroundColor: '#FF9F0A', borderRadius: 14, paddingVertical: 16, alignItems: 'center' }}
          accessibilityRole="button"
        >
          <Text style={{ color: '#000', fontSize: 18, fontWeight: '800' }}>Send</Text>
        </Pressable>
        <Pressable
          onPress={onRetry}
          style={{ flex: 1, backgroundColor: '#2C2C2E', borderRadius: 14, paddingVertical: 16, alignItems: 'center' }}
          accessibilityRole="button"
        >
          <Text style={{ color: '#FF9F0A', fontSize: 18, fontWeight: '800' }}>Try again</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Wraps the app: errors while drawing a screen, or reported by the global handler, show the error screen. */
export class CrashBoundary extends Component<{ children: ReactNode }, { error: Caught | null; n: number }> {
  state = { error: null as Caught | null, n: 0 };

  static getDerivedStateFromError(e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    return { error: { message: err.message, stack: (err.stack ?? '').split('\n').slice(0, 12).join('\n') } };
  }

  render() {
    return (
      <Outer
        boundaryError={this.state.error}
        retry={() => {
          caught = null;
          listeners.forEach((l) => l());
          this.setState((s) => ({ error: null, n: s.n + 1 }));
        }}
        key={this.state.n}
      >
        {this.props.children}
      </Outer>
    );
  }
}

function Outer({ boundaryError, retry, children }: { boundaryError: Caught | null; retry: () => void; children: ReactNode }) {
  const global = useCaught();
  const error = boundaryError ?? global;
  if (error) return <ErrorScreen error={error} onRetry={retry} />;
  return <>{children}</>;
}
