// "Lay out the whole foundation" from a tool: jump to the Jobs tab, open the job, and open its
// foundation layout editor. The tool screen asks for it; the app switches tabs; the Jobs screen opens
// the job and the editor.

let pending: string | null = null;
const listeners = new Set<() => void>();

export const nav = {
  /** Open this job's foundation layout editor. */
  openLayout(jobId: string) {
    pending = jobId;
    listeners.forEach((l) => l());
  },
  /** The job waiting to have its layout opened (and forget it). */
  takeLayout(): string | null {
    const p = pending;
    pending = null;
    return p;
  },
  peekLayout: () => pending,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};
