import type { TaskState, WorkerStatus } from './contracts.js';
import { chooseWorkerForTask } from './allocation-policy.js';
import type { WorkerInfo } from './contracts.js';

// ── Types ──

export interface RebalanceWorkerInput extends WorkerInfo {
  alive: boolean;
  status: WorkerStatus;
}

export interface RebalanceDecision {
  type: 'assign';
  taskId: string;
  workerName: string;
  reason: string;
}

export interface RebalancePolicyInput {
  tasks: TaskState[];
  workers: RebalanceWorkerInput[];
  reclaimedTaskIds: string[];
}

// ── Helpers ──

function hasCompletedDependencies(task: TaskState, taskById: Map<string, TaskState>): boolean {
  if (task.blocked_by.length === 0) return true;
  return task.blocked_by.every(id => taskById.get(id)?.status === 'completed');
}

function isWorkerAvailable(worker: RebalanceWorkerInput): boolean {
  return worker.alive && (worker.status.state === 'idle' || worker.status.state === 'done');
}

// ── Main ──

export function buildRebalanceDecisions(input: RebalancePolicyInput): RebalanceDecision[] {
  const taskById = new Map(input.tasks.map(t => [t.id, t] as const));
  const liveWorkers = input.workers.filter(isWorkerAvailable);
  if (liveWorkers.length === 0) return [];

  const unownedPending = input.tasks
    .filter(t => t.status === 'pending' && !t.owner)
    .filter(t => hasCompletedDependencies(t, taskById))
    .sort((a, b) => {
      const aReclaimed = input.reclaimedTaskIds.includes(a.id) ? 0 : 1;
      const bReclaimed = input.reclaimedTaskIds.includes(b.id) ? 0 : 1;
      if (aReclaimed !== bReclaimed) return aReclaimed - bReclaimed;
      return Number(a.id) - Number(b.id);
    });

  const decisions: RebalanceDecision[] = [];
  const claimed = new Set<string>();

  // Track in-flight assignments for load balancing
  const busyWorkerNames = new Set(
    input.tasks.filter(t => t.owner && t.status === 'in_progress').map(t => t.owner!),
  );

  for (const task of unownedPending) {
    if (claimed.has(task.id)) continue;

    // Filter to workers not already assigned in this round
    const candidates = liveWorkers.filter(w => !busyWorkerNames.has(w.name));
    if (candidates.length === 0) break;

    const chosen = chooseWorkerForTask(task, candidates);
    if (!chosen) continue;

    decisions.push({
      type: 'assign',
      taskId: task.id,
      workerName: chosen.name,
      reason: input.reclaimedTaskIds.includes(task.id)
        ? `reclaimed work ready; assigned to ${chosen.name}`
        : `idle worker pickup; assigned to ${chosen.name}`,
    });

    busyWorkerNames.add(chosen.name);
    claimed.add(task.id);
  }

  return decisions;
}
