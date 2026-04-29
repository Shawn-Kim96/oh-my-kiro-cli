import { readEvents, readMonitorSnapshot, writeMonitorSnapshot } from '../team/state.js';
import { displayMessage } from '../team/tmux-session.js';

export interface NotifyHookCallbacks {
  onTaskCompleted: (taskId: string, workerName: string, result: string) => void;
  onTaskFailed: (taskId: string, workerName: string, error: string) => void;
  onWorkerIdle: (workerName: string) => void;
  onAllWorkersIdle: () => void;
  onWorkerStopped: (workerName: string) => void;
  onDispatchFailed: (requestId: string, reason: string) => void;
}

export function notifyLeader(message: string): void {
  displayMessage(`kt: ${message}`);
}

export function startNotifyHook(
  teamName: string,
  _stateRoot: string,
  callbacks: NotifyHookCallbacks,
): { stop: () => void } {
  let lastPollAt = new Date().toISOString();
  let timer: ReturnType<typeof setInterval> | null = null;

  const poll = async () => {
    const snapshot = await readMonitorSnapshot(teamName);
    const notified = snapshot?.last_notified_events ?? {};

    const events = await readEvents(teamName, lastPollAt);
    if (events.length === 0) return;

    const idleWorkers = new Set<string>();

    for (const event of events) {
      const key = `${event.type}:${event.timestamp}`;
      if (notified[key]) continue;
      notified[key] = event.timestamp;

      const d = event.data;
      switch (event.type) {
        case 'task_completed':
          callbacks.onTaskCompleted(d['task_id'] as string, d['worker_name'] as string, (d['result'] as string) ?? '');
          break;
        case 'task_failed':
          callbacks.onTaskFailed(d['task_id'] as string, d['worker_name'] as string, (d['error'] as string) ?? '');
          break;
        case 'worker_idle':
          idleWorkers.add(d['worker_name'] as string);
          callbacks.onWorkerIdle(d['worker_name'] as string);
          break;
        case 'worker_stopped':
          callbacks.onWorkerStopped(d['worker_name'] as string);
          break;
        case 'dispatch_failed':
          callbacks.onDispatchFailed(d['request_id'] as string, (d['reason'] as string) ?? '');
          break;
      }
    }

    // Check if all workers reported idle in this batch
    if (idleWorkers.size > 0 && snapshot?.worker_states) {
      const allIdle = Object.values(snapshot.worker_states).every(s => s === 'idle');
      if (allIdle) callbacks.onAllWorkersIdle();
    }

    lastPollAt = events[events.length - 1]?.timestamp ?? lastPollAt;

    // Persist dedup state
    if (snapshot) {
      snapshot.last_notified_events = notified;
      snapshot.last_poll_at = lastPollAt;
      snapshot.updated_at = new Date().toISOString();
      await writeMonitorSnapshot(teamName, snapshot);
    }
  };

  timer = setInterval(() => { void poll(); }, 3000);

  return {
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
