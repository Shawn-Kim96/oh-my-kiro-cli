import type { WorkerInfo } from '../team/contracts.js';
import { readWorkerStatus, listTasks } from '../team/state.js';
import { sendKeys } from '../team/tmux-session.js';
import { notifyLeader } from './notify-hook.js';

export interface IdleNudgeTracker {
  workerName: string;
  idleSince: string;
  nudgeCount: number;
  lastNudgeAt: string | null;
}

interface IdleNudgeOptions {
  idleThresholdMs: number;
  maxNudges: number;
}

const DEFAULT_OPTIONS: IdleNudgeOptions = {
  idleThresholdMs: 120000,
  maxNudges: 3,
};

const trackers = new Map<string, IdleNudgeTracker>();

export async function checkIdleNudges(
  teamName: string,
  _stateRoot: string,
  workers: WorkerInfo[],
  options?: Partial<IdleNudgeOptions>,
): Promise<Array<{ workerName: string; action: 'nudge' | 'escalate' }>> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const tasks = await listTasks(teamName);
  const hasPending = tasks.some(t => t.status === 'pending');
  const allTerminal = tasks.every(t => t.status === 'completed' || t.status === 'failed');
  const results: Array<{ workerName: string; action: 'nudge' | 'escalate' }> = [];

  const idleWorkers: string[] = [];

  for (const w of workers) {
    const status = await readWorkerStatus(teamName, w.name);
    if (!status || status.state !== 'idle') {
      trackers.delete(w.name);
      continue;
    }

    idleWorkers.push(w.name);

    let tracker = trackers.get(w.name);
    if (!tracker) {
      tracker = { workerName: w.name, idleSince: status.updated_at, nudgeCount: 0, lastNudgeAt: null };
      trackers.set(w.name, tracker);
    }

    const idleDuration = Date.now() - new Date(tracker.idleSince).getTime();
    if (idleDuration < opts.idleThresholdMs || !hasPending) continue;

    if (tracker.nudgeCount >= opts.maxNudges) {
      results.push({ workerName: w.name, action: 'escalate' });
    } else {
      results.push({ workerName: w.name, action: 'nudge' });
    }
  }

  // Team-wide checks
  if (idleWorkers.length === workers.length && workers.length > 0) {
    if (hasPending) {
      notifyLeader('All workers idle but tasks remain');
    } else if (allTerminal && tasks.length > 0) {
      notifyLeader('All work complete, ready for shutdown');
    }
  }

  return results;
}

export function executeNudge(workerName: string, paneId: string): void {
  const tracker = trackers.get(workerName);
  sendKeys(paneId, 'You have pending tasks. Check your inbox.');
  if (tracker) {
    tracker.nudgeCount++;
    tracker.lastNudgeAt = new Date().toISOString();
  }
}

export function executeEscalate(workerName: string): void {
  const tracker = trackers.get(workerName);
  const count = tracker?.nudgeCount ?? 0;
  notifyLeader(`${workerName} is unresponsive after ${count} nudges`);
}
