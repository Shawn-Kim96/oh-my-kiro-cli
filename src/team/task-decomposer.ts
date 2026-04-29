import { routeTaskToRole } from './role-router.js';
import { allocateTasksToWorkers, type AllocationTaskInput, type AllocationWorkerInput } from './allocation-policy.js';
import { triageTask } from './triage.js';

type DecompositionStrategy = 'numbered' | 'bulleted' | 'conjunction' | 'atomic';

interface DecompositionCandidate {
  subject: string;
  description: string;
}

interface DecompositionPlan {
  strategy: DecompositionStrategy;
  subtasks: DecompositionCandidate[];
}

export interface TeamExecutionPlan {
  workerCount: number;
  tasks: Array<{ subject: string; description: string; owner: string; role?: string }>;
}

const BULLET_LINE_PATTERN = /^(?:[-*•]|(?:\[\s?[xX]?\]))\s+(.+)$/;
const FILE_REFERENCE_PATTERN = /(?:^|[\s`'"])([\/A-Za-z0-9_./-]+\.[A-Za-z0-9]+)(?=$|[\s`'",;:])/g;
const CODE_SYMBOL_PATTERN = /[`'][A-Za-z_][A-Za-z0-9_.-]*[`']/g;
const PARALLELIZATION_SIGNAL = /\b(?:acceptance criteria|cross[\s-]cutting|independent|in parallel|separately|verification|verify|tests?|docs?|documentation|benchmarks?|migration|rollout)\b/i;
const ACTIONABLE_TASK_PREFIX = /^(?:add|analy(?:se|ze)|audit|benchmark|build|clean(?:\s+up)?|create|debug|design|document|draft|fix|implement|improve|investigate|migrate|optimi(?:s|z)e|profile|refactor|repair|research|review|ship|summari(?:s|z)e|test|update|validate|verify|write)\b/i;
const TASK_LABEL_PREFIX = /^(?:task|step|phase|part)\s+[\w-]+(?:\s+[\w-]+)?$/i;
const ANALYSIS_TASK_PREFIX = /^(?:analy(?:se|ze)|audit|assess|evaluate|explore|investigate|research|review|study|summari(?:s|z)e)\b/i;
const ANALYSIS_DELIVERABLE_SIGNAL = /\b(?:actionable recommendations?|evidence(?: pointers?)?|findings?|issue|operator|report|root cause|summary|user impact|write-?up)\b/i;
const CONTEXTUAL_DECOMPOSITION_CLAUSE = /\b(?:focusing on|focus on|including|covers?|covering|with|while|without|ensuring|suitable for|root cause|user impact|evidence pointers|actionable recommendations)\b/i;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function countDistinctMatches(text: string, pattern: RegExp): number {
  const matches = new Set<string>();
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  for (const match of text.matchAll(new RegExp(pattern.source, flags))) {
    const value = (match[1] ?? match[0] ?? '').trim().toLowerCase();
    if (value) matches.add(value);
  }
  return matches.size;
}

function classifyTaskSize(task: string): 'small' | 'medium' | 'large' {
  const words = countWords(task);
  if (words <= 10) return 'small';
  if (words <= 30) return 'medium';
  return 'large';
}

function hasAtomicParallelizationSignals(task: string, size: 'small' | 'medium' | 'large'): boolean {
  const fileRefCount = countDistinctMatches(task, FILE_REFERENCE_PATTERN);
  const symbolRefCount = countDistinctMatches(task, CODE_SYMBOL_PATTERN);
  if (fileRefCount >= 2) return true;
  if (fileRefCount >= 1 && symbolRefCount >= 1) return true;
  if (PARALLELIZATION_SIGNAL.test(task) && size === 'large') return true;
  return size === 'large' && countWords(task) >= 24;
}

function looksLikeLowConfidenceAnalysisTask(task: string): boolean {
  const normalized = task.trim();
  return ANALYSIS_TASK_PREFIX.test(normalized)
    && (ANALYSIS_DELIVERABLE_SIGNAL.test(normalized)
      || countWords(normalized) > 18
      || CONTEXTUAL_DECOMPOSITION_CLAUSE.test(normalized));
}

function looksLikeStandaloneWeakSubtask(part: string): boolean {
  const normalized = part.trim().replace(/^[*-]\s*/, '');
  return ACTIONABLE_TASK_PREFIX.test(normalized) || TASK_LABEL_PREFIX.test(normalized);
}

function canSafelySplitWeakTaskList(task: string, parts: string[]): boolean {
  if (parts.length < 2) return false;
  if (countWords(task) > 18) return false;
  if (CONTEXTUAL_DECOMPOSITION_CLAUSE.test(task)) return false;
  return parts.every((part) => countWords(part) <= 8 && looksLikeStandaloneWeakSubtask(part));
}

export function splitTaskString(task: string): DecompositionPlan {
  // 1. Numbered list: "1. foo 2. bar" or "1) foo 2) bar"
  const numberedPattern = /(?:^|\s)(\d+)[.)]\s+/g;
  const numberedMatches = [...task.matchAll(numberedPattern)];
  if (numberedMatches.length >= 2) {
    const parts: DecompositionCandidate[] = [];
    for (let i = 0; i < numberedMatches.length; i++) {
      const prefixLen = numberedMatches[i]![0].length;
      const contentStart = numberedMatches[i]!.index! + prefixLen;
      const end = i + 1 < numberedMatches.length ? numberedMatches[i + 1]!.index! : task.length;
      const text = task.slice(contentStart, end).trim();
      if (text) parts.push({ subject: text.slice(0, 80), description: text });
    }
    if (parts.length >= 2) return { strategy: 'numbered', subtasks: parts };
  }

  // 2. Bulleted list
  const bulletParts = task
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .map((line) => line.match(BULLET_LINE_PATTERN)?.[1]?.trim() ?? '')
    .filter((line) => line.length > 0);
  if (bulletParts.length >= 2) {
    return {
      strategy: 'bulleted',
      subtasks: bulletParts.map((part) => ({ subject: part.slice(0, 80), description: part })),
    };
  }

  // 3. Strong conjunction: semicolons
  const strongParts = task.split(/;\s+/).map(s => s.trim()).filter(s => s.length > 0);
  if (strongParts.length >= 2) {
    return {
      strategy: 'conjunction',
      subtasks: strongParts.map((part) => ({ subject: part.slice(0, 80), description: part })),
    };
  }

  // 4. Weak conjunction: commas / "and" (only for flat task lists)
  const weakParts = task.split(/(?:,\s+and\s+|,\s+|\s+and\s+)/i).map(s => s.trim()).filter(s => s.length > 0);
  if (canSafelySplitWeakTaskList(task, weakParts)) {
    return {
      strategy: 'conjunction',
      subtasks: weakParts.map((part) => ({ subject: part.slice(0, 80), description: part })),
    };
  }

  // 5. Atomic fallback
  return {
    strategy: 'atomic',
    subtasks: [{ subject: task.slice(0, 80), description: task }],
  };
}

export function createAspectSubtasks(
  task: string,
  workerCount: number,
): DecompositionCandidate[] {
  const aspects: DecompositionCandidate[] = [
    { subject: `Implement: ${task}`.slice(0, 80), description: `Implement the core functionality for: ${task}` },
    { subject: `Test: ${task}`.slice(0, 80), description: `Write tests and verify: ${task}` },
    { subject: `Review and document: ${task}`.slice(0, 80), description: `Review code quality and update documentation for: ${task}` },
  ];
  const result = aspects.slice(0, workerCount);
  while (result.length < workerCount) {
    const idx = result.length - aspects.length;
    result.push({
      subject: `Additional work (${idx + 1}): ${task}`.slice(0, 80),
      description: `Continue implementation work on: ${task}`,
    });
  }
  return result;
}

export function resolveTeamFanoutLimit(
  task: string,
  requestedWorkerCount: number,
  explicitAgentType: boolean,
  explicitWorkerCount: boolean,
  plan: DecompositionPlan,
): number {
  if (requestedWorkerCount <= 1 || explicitAgentType || explicitWorkerCount || plan.strategy === 'numbered' || plan.strategy === 'bulleted') {
    return requestedWorkerCount;
  }
  const size = classifyTaskSize(task);
  if (plan.strategy === 'atomic') {
    if (looksLikeLowConfidenceAnalysisTask(task)) return 1;
    if (size === 'small') {
      const proseHeavy = countWords(task) > 18 || CONTEXTUAL_DECOMPOSITION_CLAUSE.test(task);
      if (!proseHeavy) return 1;
    }
    if (!hasAtomicParallelizationSignals(task, size)) return 1;
  }
  if (plan.strategy === 'conjunction' && size !== 'large') {
    return Math.min(requestedWorkerCount, Math.max(2, plan.subtasks.length));
  }
  return requestedWorkerCount;
}

export function buildTeamExecutionPlan(
  task: string,
  workerCount: number,
  agentType: string,
  explicitAgentType: boolean,
  explicitWorkerCount = false,
): TeamExecutionPlan {
  // Advisory triage: PASS skips decomposition, LIGHT caps subtasks
  const triage = triageTask(task);
  if (triage.level === 'PASS') {
    const role = explicitAgentType ? agentType : 'executor';
    return {
      workerCount: 1,
      tasks: [{ subject: task, description: task, owner: 'worker-0', role }],
    };
  }

  const plan = splitTaskString(task);
  const effectiveWorkerCount = resolveTeamFanoutLimit(task, workerCount, explicitAgentType, explicitWorkerCount, plan);
  const fallbackRole = !explicitAgentType && agentType === 'executor' ? 'executor' : agentType;

  let subtasks = plan.subtasks;
  const usedAspectSubtasks = subtasks.length <= 1 && effectiveWorkerCount > 1;
  if (usedAspectSubtasks) {
    subtasks = createAspectSubtasks(task, effectiveWorkerCount);
  }

  const tasksWithRoles = subtasks.map((st) => {
    if (explicitAgentType) return { ...st, role: agentType };
    const result = routeTaskToRole(st.subject, st.description, null, fallbackRole);
    return { ...st, role: result.role };
  });

  // If aspect subtasks all got the same role, distribute round-robin
  const normalizedRoles = new Set(tasksWithRoles.map((t) => (t.role ?? '').trim()));
  if (usedAspectSubtasks && tasksWithRoles.length > 1 && normalizedRoles.size <= 1) {
    return {
      workerCount: effectiveWorkerCount,
      tasks: tasksWithRoles.map((t, i) => ({ ...t, owner: `worker-${i % effectiveWorkerCount}` })),
    };
  }

  // Use allocation policy for proper distribution
  const workers: AllocationWorkerInput[] = Array.from({ length: effectiveWorkerCount }, (_, i) => ({
    name: `worker-${i}`,
    role: explicitAgentType ? agentType : undefined,
  }));
  const allocated = allocateTasksToWorkers(
    tasksWithRoles.map(t => ({ subject: t.subject, description: t.description, role: t.role })),
    workers,
  );

  return {
    workerCount: effectiveWorkerCount,
    tasks: allocated.map(({ allocation_reason: _, ...t }) => t),
  };
}
