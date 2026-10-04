// Keeps the iPhone Home Screen widget and the pour Live Activity in step with your jobs.
// Does nothing on web and Android (see src/widgets/bridge.ts).

import { dec, money } from '../tools/format';
import { colors } from '../theme';
import { endPour, showPour, updateJobWidget } from '../widgets/bridge';
import { Job, latestJob, yardsIn } from './jobs';
import { figureItems, jobTotals } from '../report/report';

let lastWidget = '';
const pourShown = new Map<string, string>();

export function syncWidgets(jobs: Job[]): void {
  const job = latestJob(jobs);
  const t = job ? jobTotals(figureItems(job)) : null;
  const panels = t ? [...t.panels.values()].reduce((a, b) => a + b, 0) : 0;
  const fillers = t ? [...t.fillers.values()].reduce((a, b) => a + b, 0) : 0;
  const widget = {
    name: job?.name ?? '',
    yards: t?.concreteOrderYd ? `${dec(t.concreteOrderYd, 2)} yd` : '',
    cost: t?.concreteCost ? money(t.concreteCost) : '',
    forms: panels ? `${panels} panels · ${fillers} fillers` : '',
    accent: colors.accent,
  };
  const key = JSON.stringify(widget);
  if (key !== lastWidget) {
    lastWidget = key;
    updateJobWidget(widget);
  }

  // Pours: show/update while running, finish once when done.
  for (const j of jobs) {
    if (!j.pour) continue;
    const p = j.pour;
    const props = {
      job: j.name,
      trucksIn: p.trucksIn,
      trucks: p.trucks,
      yards: `${dec(yardsIn(p), 2)} of ${dec(p.totalYd, 2)} yd`,
      startEpochMs: p.startedAt,
      done: p.done,
      accent: colors.accent,
    };
    const k = JSON.stringify(props);
    if (pourShown.get(j.id) === k) continue;
    pourShown.set(j.id, k);
    if (p.done) endPour(props);
    else showPour(props);
  }
}
