import { withScalingLock } from './state/locks.js';
import {
  readTeamConfig, saveTeamConfig, createTask, listTasks,
  appendEvent, readWorkerStatus,
} from './state.js';
import {
  spawnWorkerPane, waitForWorkerReady, killPane, isPaneAlive,
} from './tmux-session.js';
import { queueInboxInstruction } from './mcp-comm.js';
import { generateWorkerInbox, generateTriggerMessage } from './worker-bootstrap.js';
import { resolveAgent } from '../config/agent-mapping.js';
import { ktStateDir } from '../utils/paths.js';
import type { WorkerInfo } from './contracts.js';

export async function scaleUp(
  teamName: string,
  count: number,
  stateRoot: string,
  options?: { agentType?: string; tasks?: Array<{ subject: string; description: string }> },
): Promise<{ addedWorkers: WorkerInfo[]; newWorkerCount: number }> {
  return withScalingLock(teamName, async () => {
    const config = await readTeamConfig(teamName);
    if (!config) throw new Error(`Team not found: ${teamName}`);

    const agentType = options?.agentType ?? config.agent_type;
    const agent = resolveAgent(agentType);
    const addedWorkers: WorkerInfo[] = [];

    for (let i = 0; i < count; i++) {
      const idx = config.next_worker_index;
      const w: WorkerInfo = {
        name: `worker-${idx}`,
        index: idx,
        role: agentType,
        agent,
        pane_id: null,
        assigned_tasks: [],
        worker_cli: 'kiro-cli',
      };
      config.workers.push(w);
      config.next_worker_index++;
      addedWorkers.push(w);
    }
    config.worker_count = config.workers.length;
    await saveTeamConfig(teamName, config);

    // Spawn panes and wait for readiness
    for (const w of addedWorkers) {
      const paneId = spawnWorkerPane({
        teamName,
        workerName: w.name,
        agent: w.agent,
        cwd: config.leader_cwd,
        direction: 'v',
        targetPane: config.leader_pane_id ?? undefined,
      });
      w.pane_id = paneId;

      const workerInConfig = config.workers.find(cw => cw.name === w.name);
      if (workerInConfig) workerInConfig.pane_id = paneId;
    }
    await saveTeamConfig(teamName, config);

    for (const w of addedWorkers) {
      if (w.pane_id) await waitForWorkerReady(w.pane_id);
    }

    // Assign tasks if provided
    if (options?.tasks && options.tasks.length > 0) {
      for (let i = 0; i < addedWorkers.length && i < options.tasks.length; i++) {
        const w = addedWorkers[i]!;
        const t = options.tasks[i]!;
        const task = await createTask(teamName, { subject: t.subject, description: t.description });

        const inbox = generateWorkerInbox({
          teamName, workerName: w.name, role: w.role, agent: w.agent,
          tasks: [{ id: task.id, subject: task.subject, description: task.description, status: task.status }],
          stateRoot, leaderCwd: config.leader_cwd,
        });
        const trigger = generateTriggerMessage({ workerName: w.name, teamName, stateRoot });

        if (w.pane_id) {
          await queueInboxInstruction({
            teamName, workerName: w.name, workerIndex: w.index,
            paneId: w.pane_id, inbox, triggerMessage: trigger, stateRoot,
          });
        }
      }
    } else {
      // Auto-assign pending tasks
      const allTasks = await listTasks(teamName);
      const pending = allTasks.filter(t => t.status === 'pending');
      for (let i = 0; i < addedWorkers.length && i < pending.length; i++) {
        const w = addedWorkers[i]!;
        const task = pending[i]!;

        const inbox = generateWorkerInbox({
          teamName, workerName: w.name, role: w.role, agent: w.agent,
          tasks: [{ id: task.id, subject: task.subject, description: task.description, status: task.status }],
          stateRoot, leaderCwd: config.leader_cwd,
        });
        const trigger = generateTriggerMessage({ workerName: w.name, teamName, stateRoot });

        if (w.pane_id) {
          await queueInboxInstruction({
            teamName, workerName: w.name, workerIndex: w.index,
            paneId: w.pane_id, inbox, triggerMessage: trigger, stateRoot,
          });
        }
      }
    }

    await appendEvent(teamName, {
      type: 'team_started', timestamp: new Date().toISOString(),
      data: { action: 'scale_up', added: addedWorkers.map(w => w.name), new_count: config.workers.length },
    });

    return { addedWorkers, newWorkerCount: config.workers.length };
  });
}

export async function scaleDown(
  teamName: string,
  workerNames: string[],
  stateRoot: string,
): Promise<{ removedWorkers: string[]; newWorkerCount: number }> {
  return withScalingLock(teamName, async () => {
    const config = await readTeamConfig(teamName);
    if (!config) throw new Error(`Team not found: ${teamName}`);

    const removedWorkers: string[] = [];

    for (const name of workerNames) {
      const w = config.workers.find(cw => cw.name === name);
      if (!w) throw new Error(`Worker not found: ${name}`);

      const status = await readWorkerStatus(teamName, name);
      if (status?.state === 'working') {
        throw new Error(`Cannot remove ${name}: worker is busy (state=working)`);
      }

      // Release any in_progress task claims
      const { listTasks: lt, releaseTaskClaim } = await import('./state.js');
      const tasks = await lt(teamName);
      for (const t of tasks) {
        if (t.owner === name && t.status === 'in_progress' && t.claim_token) {
          await releaseTaskClaim(teamName, t.id, t.claim_token);
        }
      }

      if (w.pane_id) killPane(w.pane_id);

      config.workers = config.workers.filter(cw => cw.name !== name);
      removedWorkers.push(name);
    }

    config.worker_count = config.workers.length;
    await saveTeamConfig(teamName, config);

    for (const name of removedWorkers) {
      await appendEvent(teamName, {
        type: 'worker_stopped', timestamp: new Date().toISOString(),
        data: { worker: name, reason: 'scaled_down' },
      });
    }

    return { removedWorkers, newWorkerCount: config.workers.length };
  });
}
