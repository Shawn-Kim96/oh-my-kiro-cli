import type { WorkerInfo } from '../team/contracts.js';
import { capturePane, isPaneAlive } from '../team/tmux-session.js';
import { updateWorkerHeartbeat, readWorkerHeartbeat } from '../team/state.js';

export interface HeartbeatMonitorOptions {
  intervalMs: number;
  staleThresholdMs: number;
}

interface HeartbeatCallbacks {
  onStale: (workerName: string, lastSeen: string) => void;
  onDead: (workerName: string) => void;
  onRecovered: (workerName: string) => void;
}

const DEFAULT_OPTIONS: HeartbeatMonitorOptions = {
  intervalMs: 10000,
  staleThresholdMs: 60000,
};

export function startHeartbeatMonitor(
  teamName: string,
  _stateRoot: string,
  workers: WorkerInfo[],
  options: Partial<HeartbeatMonitorOptions>,
  callbacks: HeartbeatCallbacks,
): { stop: () => void } {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const previousCaptures = new Map<string, string>();
  const deadWorkers = new Set<string>();
  let timer: ReturnType<typeof setInterval> | null = null;

  const poll = async () => {
    for (const w of workers) {
      if (!w.pane_id) continue;

      // Check if pane is alive
      if (!isPaneAlive(w.pane_id)) {
        if (!deadWorkers.has(w.name)) {
          deadWorkers.add(w.name);
          callbacks.onDead(w.name);
        }
        continue;
      }

      // Pane recovered from dead
      if (deadWorkers.has(w.name)) {
        deadWorkers.delete(w.name);
        callbacks.onRecovered(w.name);
      }

      // Capture and compare
      const capture = capturePane(w.pane_id, 5);
      const prev = previousCaptures.get(w.name);
      previousCaptures.set(w.name, capture);

      if (prev !== undefined && capture !== prev) {
        // Activity detected
        await updateWorkerHeartbeat(teamName, w.name);
        continue;
      }

      // Check staleness
      const hb = await readWorkerHeartbeat(teamName, w.name);
      if (hb) {
        const age = Date.now() - new Date(hb.last_seen).getTime();
        if (age > opts.staleThresholdMs) {
          callbacks.onStale(w.name, hb.last_seen);
        }
      }
    }
  };

  timer = setInterval(() => { void poll(); }, opts.intervalMs);

  return {
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
