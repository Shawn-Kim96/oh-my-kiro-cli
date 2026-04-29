import type { WorkerInfo, TaskState } from './contracts.js';

export interface AllocationTaskInput {
  subject: string;
  description: string;
  role?: string;
  blocked_by?: string[];
  filePaths?: string[];
  domains?: string[];
}

export interface AllocationWorkerInput {
  name: string;
  role?: string;
}

export interface AllocationDecision {
  owner: string;
  reason: string;
}

interface WorkerAllocationState extends AllocationWorkerInput {
  assignedCount: number;
  primaryRole?: string;
  scopeHints: Set<string>;
}

const FILE_PATH_PATTERN = /(?:^|[\s("'])((?:src|scripts|docs|prompts|skills|templates|native|crates)\/[A-Za-z0-9._/-]+)/g;
const DOMAIN_STOP_WORDS = new Set([
  'a', 'an', 'and', 'the', 'for', 'with', 'into', 'from', 'then', 'than', 'that', 'this', 'those', 'these',
  'work', 'task', 'tasks', 'implement', 'implementation', 'continue', 'additional', 'update', 'fix', 'lane',
  'runtime', 'tests', 'test', 'worker', 'workers', 'leader', 'team', 'plan', 'approved', 'supporting',
  'needed', 'focus', 'prefer', 'plus', 'related', 'files', 'file', 'code', 'notify',
  'src', 'scripts', 'docs', 'prompts', 'skills', 'templates', 'native', 'crates', 'index', 'spec',
]);

function normalizeHint(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return normalized.length >= 3 ? normalized : null;
}

function collectPathHints(pathValue: string, target: Set<string>): void {
  const normalizedPath = normalizeHint(pathValue.replace(/^[./]+/, ''));
  if (!normalizedPath) return;
  target.add(`path:${normalizedPath}`);
  const basename = normalizedPath.split('/').pop() ?? normalizedPath;
  const basenameStem = basename.replace(/\.[^.]+$/, '');
  const normalizedStem = normalizeHint(basenameStem);
  if (normalizedStem) target.add(`domain:${normalizedStem}`);
}

function collectDomainHints(value: string, target: Set<string>): void {
  const words = value.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? [];
  for (const word of words) {
    if (!DOMAIN_STOP_WORDS.has(word)) target.add(`domain:${word}`);
  }
}

function extractTaskHints(task: AllocationTaskInput): Set<string> {
  const hints = new Set<string>();
  for (const pathValue of task.filePaths ?? []) collectPathHints(pathValue, hints);
  for (const domain of task.domains ?? []) collectDomainHints(domain, hints);
  const text = `${task.subject}\n${task.description}`;
  for (const match of text.matchAll(FILE_PATH_PATTERN)) {
    if (match[1]) collectPathHints(match[1], hints);
  }
  collectDomainHints(text, hints);
  return hints;
}

function countHintOverlap(taskHints: Set<string>, workerHints: Set<string>): number {
  let overlap = 0;
  for (const hint of taskHints) {
    if (workerHints.has(hint)) overlap += hint.startsWith('path:') ? 3 : 1;
  }
  return overlap;
}

function scoreWorker(
  task: AllocationTaskInput,
  worker: WorkerAllocationState,
  taskHints: Set<string>,
  uniformRolePool = false,
): number {
  let score = 0;
  const taskRole = task.role?.trim();
  if (!uniformRolePool) {
    if (taskRole && worker.primaryRole === taskRole) score += 18;
    if (taskRole && worker.role?.trim() === taskRole) score += 12;
    if (taskRole && !worker.primaryRole && worker.assignedCount === 0) score += 9;
  }
  const overlap = countHintOverlap(taskHints, worker.scopeHints);
  if (overlap > 0) score += overlap * 4;
  if (taskHints.size > 0 && overlap === 0 && worker.scopeHints.size > 0) score -= 3;
  score -= worker.assignedCount * 4;
  if ((task.blocked_by?.length ?? 0) > 0) score -= worker.assignedCount;
  return score;
}

export function chooseTaskOwner(
  task: AllocationTaskInput,
  workers: AllocationWorkerInput[],
  currentAssignments: Array<{ owner: string; role?: string; subject?: string; description?: string; filePaths?: string[]; domains?: string[] }>,
): AllocationDecision {
  if (workers.length === 0) throw new Error('at least one worker is required for allocation');
  const taskHints = extractTaskHints(task);
  const workerState = workers.map<WorkerAllocationState>((worker) => {
    const assigned = currentAssignments.filter((item) => item.owner === worker.name);
    const primaryRole = assigned.find((item) => item.role)?.role;
    const scopeHints = new Set<string>();
    for (const item of assigned) {
      const itemHints = extractTaskHints({
        subject: item.subject ?? '', description: item.description ?? '',
        role: item.role, filePaths: item.filePaths, domains: item.domains,
      });
      for (const hint of itemHints) scopeHints.add(hint);
    }
    return { ...worker, assignedCount: assigned.length, primaryRole, scopeHints };
  });
  const uniformRolePool = Boolean(task.role?.trim())
    && workerState.length > 0
    && workerState.every((w) => w.role?.trim() === task.role?.trim());
  const ranked = workerState
    .map((worker, index) => ({
      worker, index,
      score: scoreWorker(task, worker, taskHints, uniformRolePool),
      overlap: countHintOverlap(taskHints, worker.scopeHints),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.overlap !== a.overlap) return b.overlap - a.overlap;
      if (a.worker.assignedCount !== b.worker.assignedCount) return a.worker.assignedCount - b.worker.assignedCount;
      return a.index - b.index;
    });
  const selected = ranked[0]?.worker ?? workerState[0]!;
  const selectedOverlap = ranked[0]?.overlap ?? 0;
  const reasons: string[] = [];
  if (task.role && selected.primaryRole === task.role) reasons.push(`keeps ${task.role} work grouped`);
  else if (task.role && selected.role === task.role) reasons.push(`matches worker role ${selected.role}`);
  else reasons.push('balances current load');
  if (selectedOverlap > 0) reasons.push('preserves file/domain ownership');
  if ((task.blocked_by?.length ?? 0) > 0) reasons.push('keeps blocked work on a lighter lane');
  return { owner: selected.name, reason: reasons.join('; ') };
}

export function allocateTasksToWorkers<T extends AllocationTaskInput>(
  tasks: T[],
  workers: AllocationWorkerInput[],
): Array<T & { owner: string; allocation_reason: string }> {
  const assignments: Array<T & { owner: string; allocation_reason: string }> = [];
  for (const task of tasks) {
    const decision = chooseTaskOwner(task, workers, assignments);
    assignments.push({ ...task, owner: decision.owner, allocation_reason: decision.reason });
  }
  return assignments;
}

// Legacy compat: simple scoring for rebalance use
export interface AllocationScore {
  worker: WorkerInfo;
  score: number;
  reasons: string[];
}

export function scoreWorkerForTask(worker: WorkerInfo, _task: TaskState, allWorkers: WorkerInfo[]): AllocationScore {
  const reasons: string[] = [];
  let score = 0;
  if (worker.role === 'executor') { score += 10; reasons.push('role_match'); }
  const maxTasks = Math.max(1, ...allWorkers.map(w => w.assigned_tasks.length));
  if (worker.assigned_tasks.length < maxTasks) { score += 5; reasons.push('lower_load'); }
  if (worker.assigned_tasks.length === 0) { score += 2; reasons.push('idle'); }
  return { worker, score, reasons };
}

export function chooseWorkerForTask(task: TaskState, workers: WorkerInfo[]): WorkerInfo | null {
  if (workers.length === 0) return null;
  const scores = workers.map(w => scoreWorkerForTask(w, task, workers));
  scores.sort((a, b) => b.score - a.score);
  return scores[0]?.worker ?? null;
}
