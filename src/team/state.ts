import { mkdir, readFile, appendFile, readdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { ktTeamDir, ktStateDir, ktWorkerDir } from '../utils/paths.js';
import { readJson, writeJson } from '../utils/safe-json.js';
import { withTaskClaimLock, withMailboxLock, withDispatchLock } from './state/locks.js';
import type {
  TeamConfig, WorkerIdentity, WorkerStatus, WorkerHeartbeat,
  TaskState, TaskStatus, MailboxMessage, DispatchRequest, DispatchStatus,
  TeamEvent, PhaseState, MonitorSnapshot, ShutdownRequest, ShutdownAck,
} from './contracts.js';
import { TASK_STATUS_TRANSITIONS } from './contracts.js';

// ── Paths ──
const teamConfigPath = (t: string) => join(ktTeamDir(t), 'config.json');
const phasePath = (t: string) => join(ktTeamDir(t), 'phase.json');
const monitorPath = (t: string) => join(ktTeamDir(t), 'monitor-snapshot.json');
const eventsPath = (t: string) => join(ktTeamDir(t), 'events.jsonl');
const taskPath = (t: string, id: string) => join(ktTeamDir(t), 'tasks', `task-${id}.json`);
const mailboxPath = (t: string, w: string) => join(ktTeamDir(t), 'mailbox', `${w}.json`);
const dispatchPath = (t: string) => join(ktTeamDir(t), 'dispatch', 'requests.json');
const shutdownReqPath = (t: string) => join(ktTeamDir(t), 'shutdown', 'request.json');
const shutdownAckPath = (t: string, w: string) => join(ktTeamDir(t), 'shutdown', 'acks', `${w}.json`);
const workerIdentityPath = (t: string, w: string) => join(ktWorkerDir(t, w), 'identity.json');
const workerInboxPath = (t: string, w: string) => join(ktWorkerDir(t, w), 'inbox.md');
const workerStatusPath = (t: string, w: string) => join(ktWorkerDir(t, w), 'status.json');
const workerHeartbeatPath = (t: string, w: string) => join(ktWorkerDir(t, w), 'heartbeat.json');

// ── Team ──
export async function initTeamState(config: TeamConfig): Promise<void> {
  const base = ktTeamDir(config.name);
  const dirs = [
    join(base, 'workers'),
    join(base, 'tasks'),
    join(base, 'mailbox'),
    join(base, 'dispatch'),
    join(base, 'shutdown', 'acks'),
  ];
  for (const d of dirs) await mkdir(d, { recursive: true });
  for (const w of config.workers) {
    await mkdir(ktWorkerDir(config.name, w.name), { recursive: true });
  }

  const now = new Date().toISOString();
  await writeJson(teamConfigPath(config.name), config);

  const phase: PhaseState = {
    current_phase: 'exec',
    max_fix_attempts: 3,
    current_fix_attempt: 0,
    transitions: [],
    updated_at: now,
  };
  await writeJson(phasePath(config.name), phase);

  const monitor: MonitorSnapshot = {
    last_notified_events: {},
    last_poll_at: now,
    worker_states: {},
    updated_at: now,
  };
  await writeJson(monitorPath(config.name), monitor);

  await writeFile(eventsPath(config.name), '', 'utf-8');
  await writeJson(dispatchPath(config.name), []);
}

export async function readTeamConfig(teamName: string): Promise<TeamConfig | null> {
  return readJson<TeamConfig>(teamConfigPath(teamName));
}

export async function saveTeamConfig(teamName: string, config: TeamConfig): Promise<void> {
  await writeJson(teamConfigPath(teamName), config);
}

export async function cleanupTeamState(teamName: string): Promise<void> {
  await rm(ktTeamDir(teamName), { recursive: true, force: true });
}

export async function listTeams(): Promise<string[]> {
  const teamsDir = join(ktStateDir(), 'teams');
  try {
    const entries = await readdir(teamsDir, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch { return []; }
}

// ── Phase ──
export async function readPhaseState(teamName: string): Promise<PhaseState | null> {
  return readJson<PhaseState>(phasePath(teamName));
}

export async function writePhaseState(teamName: string, phase: PhaseState): Promise<void> {
  await writeJson(phasePath(teamName), phase);
}

// ── Worker ──
export async function writeWorkerIdentity(teamName: string, workerName: string, identity: WorkerIdentity): Promise<void> {
  await writeJson(workerIdentityPath(teamName, workerName), identity);
}

export async function readWorkerIdentity(teamName: string, workerName: string): Promise<WorkerIdentity | null> {
  return readJson<WorkerIdentity>(workerIdentityPath(teamName, workerName));
}

export async function writeWorkerInbox(teamName: string, workerName: string, content: string): Promise<void> {
  const p = workerInboxPath(teamName, workerName);
  await mkdir(ktWorkerDir(teamName, workerName), { recursive: true });
  const tmp = p + '.tmp';
  await writeFile(tmp, content, 'utf-8');
  const { rename } = await import('fs/promises');
  await rename(tmp, p);
}

export async function readWorkerInbox(teamName: string, workerName: string): Promise<string | null> {
  try { return await readFile(workerInboxPath(teamName, workerName), 'utf-8'); }
  catch { return null; }
}

export async function readWorkerStatus(teamName: string, workerName: string): Promise<WorkerStatus | null> {
  return readJson<WorkerStatus>(workerStatusPath(teamName, workerName));
}

export async function writeWorkerStatus(teamName: string, workerName: string, status: WorkerStatus): Promise<void> {
  await writeJson(workerStatusPath(teamName, workerName), status);
}

export async function updateWorkerHeartbeat(teamName: string, workerName: string, turnCount?: number): Promise<void> {
  const existing = await readWorkerHeartbeat(teamName, workerName);
  const hb: WorkerHeartbeat = {
    last_seen: new Date().toISOString(),
    pid: process.pid,
    turn_count: turnCount ?? (existing ? existing.turn_count + 1 : 1),
  };
  await writeJson(workerHeartbeatPath(teamName, workerName), hb);
}

export async function readWorkerHeartbeat(teamName: string, workerName: string): Promise<WorkerHeartbeat | null> {
  return readJson<WorkerHeartbeat>(workerHeartbeatPath(teamName, workerName));
}

// ── Task ──
export async function createTask(teamName: string, task: { subject: string; description: string; blocked_by?: string[]; requires_code_change?: boolean; owner?: string; role?: string }): Promise<TaskState> {
  const config = await readTeamConfig(teamName);
  if (!config) throw new Error(`Team not found: ${teamName}`);

  const id = String(config.next_task_id);
  config.next_task_id++;
  await saveTeamConfig(teamName, config);

  const now = new Date().toISOString();
  const state: TaskState = {
    id,
    subject: task.subject,
    description: task.description,
    status: 'pending',
    owner: task.owner ?? null,
    claim_token: null,
    version: 1,
    blocked_by: task.blocked_by ?? [],
    requires_code_change: task.requires_code_change ?? false,
    role: task.role ?? null,
    result: null,
    error: null,
    created_at: now,
    updated_at: now,
  };
  await writeJson(taskPath(teamName, id), state);
  return state;
}

export async function readTask(teamName: string, taskId: string): Promise<TaskState | null> {
  return readJson<TaskState>(taskPath(teamName, taskId));
}

export async function listTasks(teamName: string): Promise<TaskState[]> {
  const dir = join(ktTeamDir(teamName), 'tasks');
  try {
    const files = await readdir(dir);
    const tasks: TaskState[] = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const t = await readJson<TaskState>(join(dir, f));
      if (t) tasks.push(t);
    }
    return tasks;
  } catch { return []; }
}

export async function claimTask(
  teamName: string, taskId: string, workerName: string, expectedVersion: number
): Promise<{ ok: boolean; claim_token?: string; version?: number; error?: string }> {
  return withTaskClaimLock(teamName, taskId, async () => {
    const task = await readTask(teamName, taskId);
    if (!task) return { ok: false, error: 'task_not_found' };
    if (task.version !== expectedVersion) return { ok: false, error: `expected_version_mismatch:current=${task.version}` };
    if (task.status !== 'pending' && task.status !== 'blocked') return { ok: false, error: `invalid_task_status:${task.status}` };
    if (task.owner !== null && task.owner !== workerName) return { ok: false, error: `task_owned_by:${task.owner}` };

    const token = randomUUID();
    task.owner = workerName;
    task.claim_token = token;
    task.status = 'in_progress';
    task.version++;
    task.updated_at = new Date().toISOString();
    await writeJson(taskPath(teamName, taskId), task);
    return { ok: true, claim_token: token, version: task.version };
  });
}

export async function transitionTaskStatus(
  teamName: string, taskId: string, from: TaskStatus, to: TaskStatus,
  claimToken: string, patch?: { result?: string; error?: string }
): Promise<{ ok: boolean; error?: string }> {
  return withTaskClaimLock(teamName, taskId, async () => {
    const task = await readTask(teamName, taskId);
    if (!task) return { ok: false, error: 'task_not_found' };
    if (!claimToken) return { ok: false, error: 'missing_claim_token' };
    if (task.status !== from) return { ok: false, error: `status_mismatch:current=${task.status}` };
    if (task.claim_token !== claimToken) return { ok: false, error: 'invalid_claim_token' };

    const allowed = TASK_STATUS_TRANSITIONS[from];
    if (!allowed.includes(to)) return { ok: false, error: `invalid_transition:${from}->${to}` };

    task.status = to;
    task.version++;
    task.updated_at = new Date().toISOString();
    if (patch?.result !== undefined) task.result = patch.result;
    if (patch?.error !== undefined) task.error = patch.error;
    if (to === 'completed' || to === 'failed') {
      task.owner = null;
      task.claim_token = null;
    }
    await writeJson(taskPath(teamName, taskId), task);
    return { ok: true };
  });
}

export async function releaseTaskClaim(
  teamName: string, taskId: string, claimToken: string
): Promise<{ ok: boolean; error?: string }> {
  return withTaskClaimLock(teamName, taskId, async () => {
    const task = await readTask(teamName, taskId);
    if (!task) return { ok: false, error: 'task_not_found' };
    if (!claimToken) return { ok: false, error: 'missing_claim_token' };
    if (task.claim_token !== claimToken) return { ok: false, error: 'invalid_claim_token' };

    task.status = 'pending';
    task.owner = null;
    task.claim_token = null;
    task.version++;
    task.updated_at = new Date().toISOString();
    await writeJson(taskPath(teamName, taskId), task);
    return { ok: true };
  });
}

export async function recordTaskQualityResult(
  teamName: string,
  taskId: string,
  result: { pass: boolean; issues: string[] },
): Promise<{ ok: boolean; error?: string }> {
  return withTaskClaimLock(teamName, taskId, async () => {
    const task = await readTask(teamName, taskId);
    if (!task) return { ok: false, error: 'task_not_found' };
    if (task.status !== 'completed') return { ok: false, error: `invalid_task_status:${task.status}` };

    task.quality_checked = true;
    task.quality_passed = result.pass;
    task.quality_issues = result.issues;
    task.updated_at = new Date().toISOString();

    if (!result.pass) {
      task.status = 'failed';
      task.error = `quality_gate:${result.issues.join('; ')}`;
    }

    await writeJson(taskPath(teamName, taskId), task);
    return { ok: true };
  });
}

// ── Mailbox ──
export async function sendMessage(
  teamName: string, fromWorker: string, toWorker: string, body: string
): Promise<MailboxMessage> {
  if (!fromWorker) throw new Error('from_worker is required');

  const msg: MailboxMessage = {
    message_id: randomUUID(),
    from_worker: fromWorker,
    to_worker: toWorker,
    body,
    created_at: new Date().toISOString(),
    delivered: false,
    notified: false,
  };

  await withMailboxLock(teamName, toWorker, async () => {
    const msgs = await readJson<MailboxMessage[]>(mailboxPath(teamName, toWorker)) ?? [];
    msgs.push(msg);
    await writeJson(mailboxPath(teamName, toWorker), msgs);
  });

  return msg;
}

export async function listMessages(teamName: string, workerName: string): Promise<MailboxMessage[]> {
  return await readJson<MailboxMessage[]>(mailboxPath(teamName, workerName)) ?? [];
}

export async function markMessageDelivered(teamName: string, workerName: string, messageId: string): Promise<void> {
  await withMailboxLock(teamName, workerName, async () => {
    const msgs = await readJson<MailboxMessage[]>(mailboxPath(teamName, workerName)) ?? [];
    const msg = msgs.find(m => m.message_id === messageId);
    if (msg) {
      msg.delivered = true;
      await writeJson(mailboxPath(teamName, workerName), msgs);
    }
  });
}

export async function markMessageNotified(teamName: string, workerName: string, messageId: string): Promise<void> {
  await withMailboxLock(teamName, workerName, async () => {
    const msgs = await readJson<MailboxMessage[]>(mailboxPath(teamName, workerName)) ?? [];
    const msg = msgs.find(m => m.message_id === messageId);
    if (msg) {
      msg.notified = true;
      await writeJson(mailboxPath(teamName, workerName), msgs);
    }
  });
}

// ── Dispatch ──
export async function enqueueDispatchRequest(
  teamName: string, request: Omit<DispatchRequest, 'request_id' | 'status' | 'created_at' | 'updated_at' | 'retry_count'>
): Promise<{ request: DispatchRequest; deduped: boolean }> {
  return withDispatchLock(teamName, async () => {
    const reqs = await readJson<DispatchRequest[]>(dispatchPath(teamName)) ?? [];

    const dup = reqs.find(r => r.status === 'pending' && r.to_worker === request.to_worker && r.kind === request.kind);
    if (dup) return { request: dup, deduped: true };

    const now = new Date().toISOString();
    const full: DispatchRequest = {
      ...request,
      request_id: randomUUID(),
      status: 'pending',
      retry_count: 0,
      created_at: now,
      updated_at: now,
    };
    reqs.push(full);
    await writeJson(dispatchPath(teamName), reqs);
    return { request: full, deduped: false };
  });
}

export async function readDispatchRequest(teamName: string, requestId: string): Promise<DispatchRequest | null> {
  const reqs = await readJson<DispatchRequest[]>(dispatchPath(teamName)) ?? [];
  return reqs.find(r => r.request_id === requestId) ?? null;
}

export async function listDispatchRequests(teamName: string): Promise<DispatchRequest[]> {
  return await readJson<DispatchRequest[]>(dispatchPath(teamName)) ?? [];
}

export async function transitionDispatchRequest(
  teamName: string, requestId: string, from: DispatchStatus, to: DispatchStatus,
  patch?: Partial<Pick<DispatchRequest, 'last_reason' | 'retry_count'>>
): Promise<void> {
  await withDispatchLock(teamName, async () => {
    const reqs = await readJson<DispatchRequest[]>(dispatchPath(teamName)) ?? [];
    const req = reqs.find(r => r.request_id === requestId);
    if (!req || req.status !== from) return;
    req.status = to;
    req.updated_at = new Date().toISOString();
    if (patch?.last_reason !== undefined) req.last_reason = patch.last_reason;
    if (patch?.retry_count !== undefined) req.retry_count = patch.retry_count;
    await writeJson(dispatchPath(teamName), reqs);
  });
}

export async function markDispatchRequestNotified(
  teamName: string, requestId: string,
  patch?: Partial<Pick<DispatchRequest, 'last_reason'>>
): Promise<void> {
  await transitionDispatchRequest(teamName, requestId, 'pending', 'notified', patch);
}

// ── Events ──
export async function appendEvent(teamName: string, event: TeamEvent): Promise<void> {
  const line = JSON.stringify(event) + '\n';
  await appendFile(eventsPath(teamName), line, 'utf-8');
}

export async function readEvents(teamName: string, since?: string): Promise<TeamEvent[]> {
  try {
    const content = await readFile(eventsPath(teamName), 'utf-8');
    const events: TeamEvent[] = content
      .split('\n')
      .filter(l => l.trim())
      .map(l => JSON.parse(l) as TeamEvent);
    if (since) return events.filter(e => e.timestamp > since);
    return events;
  } catch { return []; }
}

// ── Monitor ──
export async function readMonitorSnapshot(teamName: string): Promise<MonitorSnapshot | null> {
  return readJson<MonitorSnapshot>(monitorPath(teamName));
}

export async function writeMonitorSnapshot(teamName: string, snapshot: MonitorSnapshot): Promise<void> {
  await writeJson(monitorPath(teamName), snapshot);
}

// ── Shutdown ──
export async function writeShutdownRequest(teamName: string, request: ShutdownRequest): Promise<void> {
  await writeJson(shutdownReqPath(teamName), request);
}

export async function readShutdownRequest(teamName: string): Promise<ShutdownRequest | null> {
  return readJson<ShutdownRequest>(shutdownReqPath(teamName));
}

export async function writeShutdownAck(teamName: string, ack: ShutdownAck): Promise<void> {
  await writeJson(shutdownAckPath(teamName, ack.worker_name), ack);
}

export async function readShutdownAcks(teamName: string): Promise<ShutdownAck[]> {
  const dir = join(ktTeamDir(teamName), 'shutdown', 'acks');
  try {
    const files = await readdir(dir);
    const acks: ShutdownAck[] = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const a = await readJson<ShutdownAck>(join(dir, f));
      if (a) acks.push(a);
    }
    return acks;
  } catch { return []; }
}
