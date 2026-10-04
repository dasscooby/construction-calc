// Web and Android: no Home Screen widget or Live Activity. iPhone uses bridge.ios.ts.

export type JobWidgetProps = { name: string; yards: string; cost: string; forms: string; accent: string };
export type PourProps = {
  job: string;
  trucksIn: number;
  trucks: number;
  yards: string;
  startEpochMs: number;
  done: boolean;
  accent: string;
};

export function updateJobWidget(_props: JobWidgetProps): void {}
export function showPour(_props: PourProps): boolean {
  return false;
}
export function endPour(_props: PourProps): void {}
export const liveActivitiesSupported = false;
