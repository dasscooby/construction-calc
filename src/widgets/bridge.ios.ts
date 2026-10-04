// iPhone: feeds the Home Screen widget and runs the pour Live Activity.
// (bridge.ts is the do-nothing version for web and Android.)
//
// The widget parts load only when the app build has them: builds made without the widget
// extension (no App Group set up yet) just skip this instead of crashing.

import type { JobWidgetProps } from './JobWidget';
import type { PourProps } from './PourActivity';

export type { JobWidgetProps, PourProps };

type JobWidgetT = typeof import('./JobWidget').default;
type PourActivityT = typeof import('./PourActivity').default;

let loaded: { JobWidget: JobWidgetT; PourActivity: PourActivityT } | null | undefined;

function widgets() {
  if (loaded === undefined) {
    try {
      loaded = {
        JobWidget: (require('./JobWidget') as typeof import('./JobWidget')).default,
        PourActivity: (require('./PourActivity') as typeof import('./PourActivity')).default,
      };
    } catch {
      loaded = null;
    }
  }
  return loaded;
}

export function updateJobWidget(props: JobWidgetProps): void {
  try {
    widgets()?.JobWidget.updateSnapshot(props);
  } catch {
    // widgets not available in this build
  }
}

/** Start, update or finish the pour on the Lock Screen. Returns false if Live Activities aren't available. */
export function showPour(props: PourProps): boolean {
  const w = widgets();
  if (!w) return false;
  try {
    const running = w.PourActivity.getInstances();
    if (running.length) {
      void Promise.all(running.map((a) => a.update(props))).catch(() => {});
    } else if (!props.done) {
      w.PourActivity.start(props);
    }
    return true;
  } catch {
    return false;
  }
}

export function endPour(props: PourProps): void {
  const w = widgets();
  if (!w) return;
  try {
    for (const a of w.PourActivity.getInstances()) {
      // Show "Pour done" for a bit, then let iOS take it down.
      void a.update(props).then(() => a.end('default')).catch(() => {});
    }
  } catch {
    // nothing running
  }
}

/** Live Activities need the widget extension, which this build may not have. */
export const liveActivitiesSupported = (() => {
  try {
    return require('expo-modules-core').requireOptionalNativeModule('ExpoWidgets') !== null;
  } catch {
    return false;
  }
})();
