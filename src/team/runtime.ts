import {
  initTeamState, readTeamConfig, appendEvent, createTask, listTasks,
  readWorkerStatus, writeShutdownRequest, readShutdownAcks,
  writeWorkerInbox, writeMonitorSnapshot, listMessages,
} from './state.js';
import {
  isTmuxAvailable, isInsideTmux, createTeamSession, isPaneAlive,
  killPane, sendKeys, spawnWorkerPane, waitForWorkerReady,
} from './tmux-session.js';
import type { TeamSession } from './tmux-session.js';
import type { TeamConfig, WorkerInfo, MonitorSnapshot } from './contracts.js';
import { queueInboxInstruction, retryFailedDispatches, deliverPendingMailboxMessages } from './mcp-comm.js';
import { generateWorkerInbox, generateWorkerInboxLegacy, generateTriggerMessage, generateShutdownInbox } from './worker-bootstrap.js';
import type { TaskForInbox } from './worker-bootstrap.js';
import { resolveAgent } from '../config/agent-mapping.js';
import { ktStateDir } from '../utils/paths.js';
import { sleep } from '../utils/sleep.js';
import { buildRebalanceDecisions } from './rebalance-policy.js';
import type { RebalanceWorkerInput } from './rebalance-policy.js';
import {
  parseWorktreeMode, planWorktreeTarget, ensureWorktree, rollbackProvisionedWorktrees,
  mergeWorktreeChanges, isGitRepository,
} from './worktree.js';
import type { EnsureWorktreeResult, WorktreeMergeResult } from './worktree.js';
import { buildTeamExecutionPlan } from './task-decomposer.js';
import { routeTaskToRole } from './role-router.js';
import { interviewTask } from './interview.js';
import { triageTask } from './triage.js';
import { WikiStore } from '../knowledge/wiki.js';

function sanitizeTeamName(task: string): string {
  const slug = task.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20);
  const suffix = String(Date.now()).slice(-6);
  return `${slug || 'team'}-${suffix}`;
}

import { autoCheckpoint } from './checkpoint.js';

function captureTransition(teamName: string, from: string, to: string, reason?: string, cwd?: string): void {
  try {
    const wiki = new WikiStore(`team-${teamName}`);
    wiki.set(`transition-${Date.now()}`, { from, to, reason, timestamp: new Date().toISOString() });
  } catch { /* best-effort */ }
  // Auto-checkpoint: fire-and-forget git commit on phase transitions
  if (cwd) {
    autoCheckpoint(cwd, from, to, teamName).catch(() => { /* best-effort */ });
  }
}

export async function startTeam(options: {
  workerCount: number;
  agentType: string;
  task: string;
  cwd: string;
  cleanup?: boolean;
  worktreeMode?: import('./worktree.js').WorktreeMode;
  explicitAgentType?: boolean;
  explicitWorkerCount?: boolean;
}): Promise<void> {
  if (!isTmuxAvailable()) {
    console.error('Error: tmux is not installed or not in PATH');
    process.exitCode = 1;
    return;
  }
  if (!isInsideTmux()) {
    console.error('Error: must be running inside a tmux session');
    process.exitCode = 1;
    return;
  }

  const teamName = sanitizeTeamName(options.task);
  const stateRoot = ktStateDir();

  // ── Task Decomposition ──
  // Deep-interview: check for ambiguities (skip for PASS-triaged tasks)
  const triage = triageTask(options.task);
  if (triage.level !== 'PASS') {
    const interview = interviewTask(options.task);
    if (interview.ambiguities.length > 0) {
      console.log('\n⚠️  Clarification needed before starting team:\n');
      for (const q of interview.ambiguities) {
        console.log(`  • ${q}`);
      }
      console.log('\n  Tip: Be more specific about scope and acceptance criteria.\n');
    }
  }

  const explicitAgentType = options.explicitAgentType ?? false;
  const explicitWorkerCount = options.explicitWorkerCount ?? false;
  const executionPlan = buildTeamExecutionPlan(
    options.task,
    options.workerCount,
    options.agentType,
    explicitAgentType,
    explicitWorkerCount,
  );
  const effectiveWorkerCount = executionPlan.workerCount;

  console.log(`Task decomposition: ${executionPlan.tasks.length} subtask(s) → ${effectiveWorkerCount} worker(s)`);
  for (const t of executionPlan.tasks) {
    console.log(`  • [${t.role ?? 'executor'}] ${t.subject} → ${t.owner}`);
  }

  // ── Workers with differentiated roles ──
  // Determine each worker's role from their assigned tasks
  const workerRoleMap = new Map<string, string>();
  for (const t of executionPlan.tasks) {
    if (!workerRoleMap.has(t.owner)) {
      workerRoleMap.set(t.owner, t.role ?? options.agentType);
    }
  }

  const workers: WorkerInfo[] = [];
  for (let i = 0; i < effectiveWorkerCount; i++) {
    const workerName = `worker-${i}`;
    const role = workerRoleMap.get(workerName) ?? options.agentType;
    const agent = resolveAgent(role);
    workers.push({
      name: workerName,
      index: i,
      role,
      agent,
      pane_id: null,
      assigned_tasks: [],
      worker_cli: 'kiro-cli',
    });
  }

  // ── Worktree provisioning ──
  const worktreeMode = options.worktreeMode ?? { enabled: false };
  const worktreeResults: Array<EnsureWorktreeResult | { enabled: false }> = [];
  let baseRef = '';

  if (worktreeMode.enabled && isGitRepository(options.cwd)) {
    console.log('Provisioning worktrees for workers...');
    try {
      for (let i = 0; i < effectiveWorkerCount; i++) {
        const workerName = `worker-${i}`;
        const plan = planWorktreeTarget({ cwd: options.cwd, mode: worktreeMode, teamName, workerName });
        if (plan.enabled) baseRef = plan.baseRef;
        const result = ensureWorktree(plan);
        worktreeResults.push(result);
        if (result.enabled) console.log(`  ${workerName}: ${result.worktreePath} (${result.created ? 'created' : 'reused'})`);
      }
    } catch (err) {
      console.error(`Worktree provisioning failed: ${err instanceof Error ? err.message : err}`);
      await rollbackProvisionedWorktrees(worktreeResults);
      process.exitCode = 1;
      return;
    }
  }

  const config: TeamConfig = {
    name: teamName,
    task: options.task,
    agent_type: options.agentType,
    worker_count: effectiveWorkerCount,
    max_workers: Math.max(effectiveWorkerCount, 8),
    workers,
    created_at: new Date().toISOString(),
    tmux_target: '',
    leader_pane_id: null,
    hud_pane_id: null,
    next_task_id: 1,
    next_worker_index: effectiveWorkerCount,
    leader_cwd: options.cwd,
    team_state_root: stateRoot,
  };

  console.log(`Starting team: ${teamName}`);
  console.log(`Workers: ${effectiveWorkerCount} (${workers.map(w => `${w.name}:${w.role}`).join(', ')})`);

  await initTeamState(config);
  await appendEvent(teamName, { type: 'team_started', timestamp: new Date().toISOString(), data: { task: options.task, worker_count: effectiveWorkerCount } });

  // ── Create per-subtask tasks with owner and role ──
  const createdTasks = [];
  for (const planTask of executionPlan.tasks) {
    const task = await createTask(teamName, {
      subject: planTask.subject,
      description: planTask.description,
      owner: planTask.owner,
      role: planTask.role,
    });
    createdTasks.push(task);
    console.log(`Created task-${task.id}: [${planTask.role ?? 'executor'}] ${task.subject} → ${planTask.owner}`);
  }

  const session = await createTeamSession({
    teamName,
    workerCount: effectiveWorkerCount,
    workers: workers.map((w, i) => {
      const wt = worktreeResults[i];
      const workerCwd = wt && wt.enabled ? wt.worktreePath : options.cwd;
      return { name: w.name, agent: w.agent, cwd: workerCwd };
    }),
    cwd: options.cwd,
    stateRoot,
  });

  // Update config with pane IDs
  for (let i = 0; i < workers.length; i++) {
    const w = workers[i];
    if (w) w.pane_id = session.workerPaneIds[i] ?? null;
  }
  config.leader_pane_id = session.leaderPaneId;
  const { saveTeamConfig } = await import('./state.js');
  await saveTeamConfig(teamName, config);

  console.log('Workers spawned, generating differentiated inboxes...');

  // ── Per-worker differentiated inbox ──
  for (let i = 0; i < workers.length; i++) {
    const w = workers[i];
    const paneId = session.workerPaneIds[i];
    if (!w || !paneId) continue;

    // Filter tasks assigned to THIS worker
    const workerTasks: TaskForInbox[] = createdTasks
      .filter(t => t.owner === w.name)
      .map(t => ({
        id: t.id,
        subject: t.subject,
        description: t.description,
        status: t.status,
        role: t.role,
        blocked_by: t.blocked_by,
      }));

    const inbox = generateWorkerInbox({
      teamName,
      workerName: w.name,
      role: w.role,
      agent: w.agent,
      tasks: workerTasks,
      stateRoot,
      leaderCwd: options.cwd,
    });

    const trigger = generateTriggerMessage({ workerName: w.name, teamName, stateRoot });

    const outcome = await queueInboxInstruction({
      teamName,
      workerName: w.name,
      workerIndex: w.index,
      paneId,
      inbox,
      triggerMessage: trigger,
      stateRoot,
    });

    console.log(`  ${w.name} (${w.role}): ${workerTasks.length} task(s), dispatch ${outcome.ok ? '✓' : '✗'} (${outcome.reason})`);
  }

  let sigintCount = 0;
  const sigintHandler = async () => {
    sigintCount++;
    if (sigintCount === 1) {
      console.log('\nGraceful shutdown initiated (Ctrl+C again to force)...');
      await gracefulShutdown(teamName, session, stateRoot, { reason: 'user_interrupt' });
      process.exit(0);
    } else {
      console.log('\nForce shutdown...');
      await gracefulShutdown(teamName, session, stateRoot, { reason: 'user_interrupt', force: true });
      process.exit(1);
    }
  };
  process.on('SIGINT', sigintHandler);

  console.log(`\nTeam ${teamName} is running. Monitoring...`);
  await monitorTeam(teamName, session, stateRoot);

  process.removeListener('SIGINT', sigintHandler);

  // Report results
  const tasks = await listTasks(teamName);
  const completed = tasks.filter(t => t.status === 'completed');
  const failed = tasks.filter(t => t.status === 'failed');
  console.log(`\nTeam ${teamName} finished.`);
  console.log(`  Tasks: ${completed.length} completed, ${failed.length} failed, ${tasks.length} total`);
  for (const t of tasks) {
    console.log(`  task-${t.id} [${t.status}] (${t.role ?? 'executor'} → ${t.owner ?? 'unassigned'}): ${t.subject}${t.result ? ` → ${t.result}` : ''}${t.error ? ` ✗ ${t.error}` : ''}`);
  }

  // Worktree merge report
  if (worktreeMode.enabled && baseRef && isGitRepository(options.cwd)) {
    console.log('\nWorktree merge status:');
    for (let i = 0; i < worktreeResults.length; i++) {
      const wt = worktreeResults[i];
      if (!wt || !wt.enabled) continue;
      const workerName = `worker-${i}`;
      const result = mergeWorktreeChanges(options.cwd, wt.worktreePath, workerName, baseRef);
      const icon = result.success ? '✓' : '✗';
      console.log(`  ${icon} ${workerName}: ${result.strategy} (${result.commitCount} commits)${result.error ? ` — ${result.error}` : ''}`);
    }
  }

  if (options.cleanup) {
    const { cleanupTeamState } = await import('./state.js');
    await cleanupTeamState(teamName);
    console.log('Team state cleaned up.');
  }
}

export async function startTeamDetached(options: {
  workerCount: number;
  agentType: string;
  task: string;
  cwd: string;
  worktreeMode?: import('./worktree.js').WorktreeMode;
  explicitAgentType?: boolean;
  explicitWorkerCount?: boolean;
}): Promise<void> {
  if (!isTmuxAvailable()) { console.error('Error: tmux is not installed'); process.exitCode = 1; return; }
  if (!isInsideTmux()) { console.error('Error: must be inside tmux'); process.exitCode = 1; return; }

  const teamName = sanitizeTeamName(options.task);
  const stateRoot = ktStateDir();

  // ── Task Decomposition ──
  const executionPlan = buildTeamExecutionPlan(
    options.task,
    options.workerCount,
    options.agentType,
    options.explicitAgentType ?? false,
    options.explicitWorkerCount ?? false,
  );
  const effectiveWorkerCount = executionPlan.workerCount;

  const workerRoleMap = new Map<string, string>();
  for (const t of executionPlan.tasks) {
    if (!workerRoleMap.has(t.owner)) workerRoleMap.set(t.owner, t.role ?? options.agentType);
  }

  const workers: WorkerInfo[] = [];
  for (let i = 0; i < effectiveWorkerCount; i++) {
    const workerName = `worker-${i}`;
    const role = workerRoleMap.get(workerName) ?? options.agentType;
    workers.push({ name: workerName, index: i, role, agent: resolveAgent(role), pane_id: null, assigned_tasks: [], worker_cli: 'kiro-cli' });
  }

  const config: TeamConfig = {
    name: teamName, task: options.task, agent_type: options.agentType,
    worker_count: effectiveWorkerCount, max_workers: Math.max(effectiveWorkerCount, 8),
    workers, created_at: new Date().toISOString(), tmux_target: '',
    leader_pane_id: null, hud_pane_id: null, next_task_id: 1,
    next_worker_index: effectiveWorkerCount, leader_cwd: options.cwd, team_state_root: stateRoot,
  };

  await initTeamState(config);
  await appendEvent(teamName, { type: 'team_started', timestamp: new Date().toISOString(), data: { task: options.task } });

  const createdTasks = [];
  for (const planTask of executionPlan.tasks) {
    const task = await createTask(teamName, {
      subject: planTask.subject, description: planTask.description,
      owner: planTask.owner, role: planTask.role,
    });
    createdTasks.push(task);
  }

  const session = await createTeamSession({
    teamName, workerCount: effectiveWorkerCount,
    workers: workers.map(w => ({ name: w.name, agent: w.agent, cwd: options.cwd })),
    cwd: options.cwd, stateRoot,
  });

  for (let i = 0; i < workers.length; i++) {
    const w = workers[i];
    if (w) w.pane_id = session.workerPaneIds[i] ?? null;
  }
  config.leader_pane_id = session.leaderPaneId;
  const { saveTeamConfig } = await import('./state.js');
  await saveTeamConfig(teamName, config);

  for (let i = 0; i < workers.length; i++) {
    const w = workers[i];
    const paneId = session.workerPaneIds[i];
    if (!w || !paneId) continue;

    const workerTasks: TaskForInbox[] = createdTasks
      .filter(t => t.owner === w.name)
      .map(t => ({ id: t.id, subject: t.subject, description: t.description, status: t.status, role: t.role, blocked_by: t.blocked_by }));

    const inbox = generateWorkerInbox({
      teamName, workerName: w.name, role: w.role, agent: w.agent,
      tasks: workerTasks, stateRoot, leaderCwd: options.cwd,
    });
    const trigger = generateTriggerMessage({ workerName: w.name, teamName, stateRoot });
    await queueInboxInstruction({ teamName, workerName: w.name, workerIndex: w.index, paneId, inbox, triggerMessage: trigger, stateRoot });
  }

  console.log(JSON.stringify({ ok: true, team_name: teamName, workers: effectiveWorkerCount, tasks: createdTasks.length }));
}

export async function resumeTeam(teamName: string, stateRoot: string): Promise<void> {
  const config = await readTeamConfig(teamName);
  if (!config) throw new Error(`Team not found: ${teamName}`);

  const { readPhaseState } = await import('./state.js');
  const phase = await readPhaseState(teamName);
  const terminalPhases = new Set(['complete', 'failed', 'cancelled']);
  if (phase && terminalPhases.has(phase.current_phase)) {
    throw new Error(`Team ${teamName} already ${phase.current_phase}`);
  }

  if (!isTmuxAvailable()) throw new Error('tmux is not available');
  if (!isInsideTmux()) throw new Error('Must be inside a tmux session');

  const tasks = await listTasks(teamName);
  const pendingTasks = tasks.filter(t => t.status === 'pending');
  let pendingIdx = 0;

  for (const w of config.workers) {
    const alive = w.pane_id ? isPaneAlive(w.pane_id) : false;

    if (!alive) {
      for (const t of tasks) {
        if (t.owner === w.name && t.status === 'in_progress' && t.claim_token) {
          const { releaseTaskClaim } = await import('./state.js');
          await releaseTaskClaim(teamName, t.id, t.claim_token);
          pendingTasks.push({ ...t, status: 'pending', owner: null, claim_token: null });
        }
      }

      const paneId = spawnWorkerPane({
        teamName, workerName: w.name, agent: w.agent,
        cwd: config.leader_cwd, direction: 'v',
        targetPane: config.leader_pane_id ?? undefined,
      });
      w.pane_id = paneId;
      await waitForWorkerReady(paneId);

      if (pendingIdx < pendingTasks.length) {
        const task = pendingTasks[pendingIdx]!;
        pendingIdx++;
        const inbox = generateWorkerInboxLegacy({
          teamName, workerName: w.name, role: w.role, agent: w.agent,
          taskId: task.id, taskSubject: task.subject, taskDescription: task.description,
          stateRoot, leaderCwd: config.leader_cwd,
        });
        const trigger = generateTriggerMessage({ workerName: w.name, teamName, stateRoot });
        await queueInboxInstruction({
          teamName, workerName: w.name, workerIndex: w.index,
          paneId, inbox, triggerMessage: trigger, stateRoot,
        });
      }
    } else {
      const status = await readWorkerStatus(teamName, w.name);
      if (status?.state === 'idle' && pendingIdx < pendingTasks.length && w.pane_id) {
        const task = pendingTasks[pendingIdx]!;
        pendingIdx++;
        const inbox = generateWorkerInboxLegacy({
          teamName, workerName: w.name, role: w.role, agent: w.agent,
          taskId: task.id, taskSubject: task.subject, taskDescription: task.description,
          stateRoot, leaderCwd: config.leader_cwd,
        });
        const trigger = generateTriggerMessage({ workerName: w.name, teamName, stateRoot });
        await queueInboxInstruction({
          teamName, workerName: w.name, workerIndex: w.index,
          paneId: w.pane_id, inbox, triggerMessage: trigger, stateRoot,
        });
      }
    }
  }

  const { saveTeamConfig: save } = await import('./state.js');
  await save(teamName, config);

  const session: TeamSession = {
    name: teamName,
    workerCount: config.workers.length,
    cwd: config.leader_cwd,
    workerPaneIds: config.workers.map(w => w.pane_id ?? ''),
    leaderPaneId: config.leader_pane_id ?? '',
    hudPaneId: config.hud_pane_id,
  };

  console.log(`Resumed team ${teamName} with ${config.workers.length} workers. Monitoring...`);
  await monitorTeam(teamName, session, stateRoot);
}

export async function monitorTeam(
  teamName: string,
  session: TeamSession,
  stateRoot: string,
  options?: { pollIntervalMs?: number },
): Promise<void> {
  const pollMs = options?.pollIntervalMs ?? 5000;
  const config = await readTeamConfig(teamName);
  if (!config) return;

  let iteration = 0;
  while (true) {
    iteration++;

    // 1. Worker health check
    for (let i = 0; i < config.workers.length; i++) {
      const w = config.workers[i];
      const paneId = session.workerPaneIds[i];
      if (!w || !paneId) continue;
      if (!isPaneAlive(paneId)) {
        await appendEvent(teamName, { type: 'worker_stopped', timestamp: new Date().toISOString(), data: { worker: w.name } });
        if (iteration % 6 === 0) console.log(`  ⚠ ${w.name} pane is dead`);
      }
    }

    // 2. Task status check
    const tasks = await listTasks(teamName);
    for (const t of tasks) {
      if (t.status === 'completed') {
        await appendEvent(teamName, { type: 'task_completed', timestamp: new Date().toISOString(), data: { task_id: t.id } });
      }
      if (t.status === 'failed') {
        await appendEvent(teamName, { type: 'task_failed', timestamp: new Date().toISOString(), data: { task_id: t.id } });
      }
    }

    // 3. Dispatch reliability
    await retryFailedDispatches(teamName, stateRoot);
    const workerPanes = config.workers
      .map((w, i) => ({ name: w.name, paneId: session.workerPaneIds[i] ?? '' }))
      .filter(wp => wp.paneId);
    await deliverPendingMailboxMessages(teamName, stateRoot, workerPanes);

    // 3b. Rebalance
    const reclaimedTaskIds: string[] = [];
    for (const t of tasks) {
      if (t.status === 'pending' && !t.owner) reclaimedTaskIds.push(t.id);
    }

    const rebalanceWorkers: RebalanceWorkerInput[] = [];
    for (let i = 0; i < config.workers.length; i++) {
      const w = config.workers[i];
      if (!w) continue;
      const paneId = session.workerPaneIds[i];
      const alive = paneId ? isPaneAlive(paneId) : false;
      const status = await readWorkerStatus(teamName, w.name);
      rebalanceWorkers.push({
        ...w,
        alive,
        status: status ?? { state: 'idle', current_task_id: null, reason: null, updated_at: new Date().toISOString() },
      });
    }

    const decisions = buildRebalanceDecisions({ tasks, workers: rebalanceWorkers, reclaimedTaskIds });
    for (const decision of decisions) {
      const worker = config.workers.find(w => w.name === decision.workerName);
      const workerIdx = config.workers.findIndex(w => w.name === decision.workerName);
      const paneId = workerIdx >= 0 ? session.workerPaneIds[workerIdx] : undefined;
      const task = tasks.find(t => t.id === decision.taskId);
      if (!worker || !paneId || !task) continue;

      const inbox = generateWorkerInboxLegacy({
        teamName, workerName: worker.name, role: worker.role, agent: worker.agent,
        taskId: task.id, taskSubject: task.subject, taskDescription: task.description,
        stateRoot, leaderCwd: config.leader_cwd,
      });
      const trigger = generateTriggerMessage({ workerName: worker.name, teamName, stateRoot });
      await queueInboxInstruction({
        teamName, workerName: worker.name, workerIndex: worker.index,
        paneId, inbox, triggerMessage: trigger, stateRoot,
      });
      if (iteration % 6 === 0) console.log(`  ↻ rebalance: ${decision.workerName} → task-${decision.taskId} (${decision.reason})`);
    }

    // 4. Terminal check
    const allTasksTerminal = tasks.length > 0 && tasks.every(t => t.status === 'completed' || t.status === 'failed');
    if (allTasksTerminal) {
      let allWorkersIdle = true;
      for (const w of config.workers) {
        const status = await readWorkerStatus(teamName, w.name);
        if (status && status.state !== 'idle' && status.state !== 'done') {
          allWorkersIdle = false;
          break;
        }
      }
      if (allWorkersIdle) {
        console.log('All tasks terminal, all workers idle. Finishing.');
        // Auto-capture phase transition to wiki
        captureTransition(teamName, 'running', 'complete', 'all tasks terminal, all workers idle', config.leader_cwd);
        break;
      }
    }

    const anyAlive = session.workerPaneIds.some(id => isPaneAlive(id));
    if (!anyAlive) {
      console.log('All worker panes are dead. Finishing.');
      // Auto-capture phase transition to wiki
      captureTransition(teamName, 'running', 'failed', 'all worker panes dead', config.leader_cwd);
      break;
    }

    // 5. Progress log
    if (iteration % 6 === 0) {
      const summary = tasks.map(t => `task-${t.id}:${t.status}`).join(', ');
      console.log(`  [monitor] ${summary || 'no tasks'}`);
    }

    // 6. Save snapshot
    const snapshot: MonitorSnapshot = {
      last_notified_events: {},
      last_poll_at: new Date().toISOString(),
      worker_states: {},
      updated_at: new Date().toISOString(),
    };
    for (const w of config.workers) {
      const s = await readWorkerStatus(teamName, w.name);
      snapshot.worker_states[w.name] = s?.state ?? 'unknown';
    }
    await writeMonitorSnapshot(teamName, snapshot);

    await sleep(pollMs);
  }
}

export async function gracefulShutdown(
  teamName: string,
  session: TeamSession,
  stateRoot: string,
  options?: { reason?: string; force?: boolean; ackTimeoutMs?: number },
): Promise<void> {
  const reason = options?.reason ?? 'shutdown';
  const force = options?.force ?? false;
  const ackTimeoutMs = options?.ackTimeoutMs ?? 15000;

  await writeShutdownRequest(teamName, { requested_at: new Date().toISOString(), reason, force });
  await appendEvent(teamName, { type: 'team_shutdown', timestamp: new Date().toISOString(), data: { reason } });

  const config = await readTeamConfig(teamName);
  if (!config) return;

  for (let i = 0; i < config.workers.length; i++) {
    const w = config.workers[i];
    const paneId = session.workerPaneIds[i];
    if (!w || !paneId || !isPaneAlive(paneId)) continue;

    const shutdownInbox = generateShutdownInbox({ teamName, workerName: w.name, reason });
    await writeWorkerInbox(teamName, w.name, shutdownInbox);
    try { sendKeys(paneId, `SHUTDOWN: Read your inbox for shutdown instructions`); } catch { /* pane may be dead */ }
  }

  if (!force) {
    // Shutdown ACK protocol: workers can acknowledge via two channels:
    // 1. shutdown/acks/{worker}.json files (primary, via readShutdownAcks)
    // 2. mailbox/leader.json messages containing 'SHUTDOWN_ACK' (fallback)
    const deadline = Date.now() + ackTimeoutMs;
    while (Date.now() < deadline) {
      const acks = await readShutdownAcks(teamName);
      // Also check leader mailbox for SHUTDOWN_ACK messages
      const leaderMsgs = await listMessages(teamName, 'leader');
      const mailboxAcks = leaderMsgs.filter(m =>
        typeof m.body === 'string' && m.body.includes('SHUTDOWN_ACK')
      );
      const totalAcks = acks.length + mailboxAcks.length;
      if (totalAcks >= config.workers.length) break;
      await sleep(1000);
    }
  }

  for (const paneId of session.workerPaneIds) {
    try { killPane(paneId); } catch { /* ignore */ }
  }
  if (session.hudPaneId) {
    try { killPane(session.hudPaneId); } catch { /* ignore */ }
  }

  console.log(`Team ${teamName} shut down (${reason}).`);
  // Auto-capture phase transition to wiki
  captureTransition(teamName, 'running', 'shutdown', reason, config.leader_cwd);
}
