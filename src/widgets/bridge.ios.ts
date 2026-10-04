// iPhone: feeds the Home Screen widget and runs the pour Live Activity.
// (bridge.ts is the do-nothing version for web and Android.)

import JobWidget, { type JobWidgetProps } from './JobWidget';
import PourActivity, { type PourProps } from './PourActivity';

export type { JobWidgetProps, PourProps };

export function updateJobWidget(props: JobWidgetProps): void {
  try {
    JobWidget.updateSnapshot(props);
  } catch {
    // widgets not available (older app build)
  }
}

/** Start, update or finish the pour on the Lock Screen. Returns false if Live Activities aren't available. */
export function showPour(props: PourProps): boolean {
  try {
    const running = PourActivity.getInstances();
    if (running.length) {
      void Promise.all(running.map((a) => a.update(props))).catch(() => {});
    } else if (!props.done) {
      PourActivity.start(props);
    }
    return true;
  } catch {
    return false;
  }
}

export function endPour(props: PourProps): void {
  try {
    for (const a of PourActivity.getInstances()) {
      // Show "Pour done" for a bit, then let iOS take it down.
      void a.update(props).then(() => a.end('default')).catch(() => {});
    }
  } catch {
    // nothing running
  }
}

export const liveActivitiesSupported = true;
