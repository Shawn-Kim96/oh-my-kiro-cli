import { readTeamConfig, readWorkerStatus, listTasks, listDispatchRequests, listMessages } from '../team/state.js';
import { isPaneAlive } from '../team/tmux-session.js';

export interface HudWorkerState {
  name: string;
  state: string;
  taskId: string | null;
  alive: boolean;
}

export interface HudState {
  teamName: string;
  phase: string;
  workers: HudWorkerState[];
  tasks: { total: number; completed: number; failed: number; in_progress: number; pending: number; blocked: number };
  dispatch: { ok: number; failed: number; pending: number };
  mailbox: { pending: number };
  elapsed: number;
  updatedAt: string;
}

export async function collectHudState(teamName: string, _stateRoot: string): Promise<HudState> {
  const config = await readTeamConfig(teamName);
  const now = new Date().toISOString();

  if (!config) {
    return {
      teamName, phase: 'unknown', workers: [],
      tasks: { total: 0, completed: 0, failed: 0, in_progress: 0, pending: 0, blocked: 0 },
      dispatch: { ok: 0, failed: 0, pending: 0 },
      mailbox: { pending: 0 },
      elapsed: 0, updatedAt: now,
    };
  }

  // Workers
  const workers: HudWorkerState[] = [];
  for (const w of config.workers) {
    const status = await readWorkerStatus(teamName, w.name);
    const alive = w.pane_id ? isPaneAlive(w.pane_id) : false;
    workers.push({
      name: w.name,
      state: alive ? (status?.state ?? 'idle') : 'dead',
      taskId: status?.current_task_id ?? null,
      alive,
    });
  }

  // Tasks
  const allTasks = await listTasks(teamName);
  const tasks = { total: allTasks.length, completed: 0, failed: 0, in_progress: 0, pending: 0, blocked: 0 };
  for (const t of allTasks) {
    if (t.status === 'completed') tasks.completed++;
    else if (t.status === 'failed') tasks.failed++;
    else if (t.status === 'in_progress') tasks.in_progress++;
    else if (t.status === 'pending') tasks.pending++;
    else if (t.status === 'blocked') tasks.blocked++;
  }

  // Dispatch
  const reqs = await listDispatchRequests(teamName);
  const dispatch = { ok: 0, failed: 0, pending: 0 };
  for (const r of reqs) {
    if (r.status === 'delivered' || r.status === 'notified') dispatch.ok++;
    else if (r.status === 'failed') dispatch.failed++;
    else if (r.status === 'pending') dispatch.pending++;
  }

  // Mailbox — count undelivered messages across all workers
  let mailboxPending = 0;
  for (const w of config.workers) {
    const msgs = await listMessages(teamName, w.name);
    mailboxPending += msgs.filter(m => !m.delivered).length;
  }

  // Elapsed
  const elapsed = Math.floor((Date.now() - new Date(config.created_at).getTime()) / 1000);

  return {
    teamName,
    phase: 'exec', // read from phase file if available
    workers,
    tasks,
    dispatch,
    mailbox: { pending: mailboxPending },
    elapsed,
    updatedAt: now,
  };
}
