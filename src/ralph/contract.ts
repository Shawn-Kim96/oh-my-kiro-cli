export const RALPH_PHASES = ['starting', 'executing', 'verifying', 'fixing', 'complete', 'failed', 'cancelled'] as const;
export type RalphPhase = typeof RALPH_PHASES[number];

const PHASE_SET = new Set<string>(RALPH_PHASES);
const TERMINAL_PHASES = new Set<RalphPhase>(['complete', 'failed', 'cancelled']);

const PHASE_ALIASES: Record<string, RalphPhase> = {
  start: 'starting', started: 'starting',
  execute: 'executing', execution: 'executing',
  verify: 'verifying', verification: 'verifying',
  fix: 'fixing',
  completed: 'complete',
  fail: 'failed', error: 'failed',
  cancel: 'cancelled',
};

export interface RalphState {
  active: boolean;
  current_phase: RalphPhase;
  task_description: string;
  iteration: number;
  max_iterations: number;
  fix_attempts: number;
  max_fix_attempts: number;
  started_at: string;
  completed_at: string | null;
  evidence: RalphEvidence[];
  linked_team: string | null;
}

export interface RalphEvidence {
  phase: RalphPhase;
  iteration: number;
  command: string;
  output: string;
  pass: boolean;
  timestamp: string;
}

export function normalizeRalphPhase(raw: string): RalphPhase | null {
  const lower = raw.trim().toLowerCase();
  if (PHASE_SET.has(lower)) return lower as RalphPhase;
  return PHASE_ALIASES[lower] ?? null;
}

export function isTerminalRalphPhase(phase: RalphPhase): boolean {
  return TERMINAL_PHASES.has(phase);
}

export function validateRalphState(candidate: Record<string, unknown>): { ok: boolean; state?: RalphState; error?: string } {
  if (typeof candidate['current_phase'] !== 'string') {
    return { ok: false, error: 'current_phase must be a string' };
  }
  const phase = normalizeRalphPhase(candidate['current_phase']);
  if (!phase) {
    return { ok: false, error: `current_phase must be one of: ${RALPH_PHASES.join(', ')}` };
  }
  if (typeof candidate['active'] !== 'boolean') {
    return { ok: false, error: 'active must be a boolean' };
  }
  if (candidate['active'] && TERMINAL_PHASES.has(phase)) {
    return { ok: false, error: 'terminal phases require active=false' };
  }
  const iteration = candidate['iteration'];
  if (typeof iteration !== 'number' || !Number.isInteger(iteration) || iteration < 0) {
    return { ok: false, error: 'iteration must be a non-negative integer' };
  }
  const maxIter = candidate['max_iterations'];
  if (typeof maxIter !== 'number' || !Number.isInteger(maxIter) || maxIter <= 0) {
    return { ok: false, error: 'max_iterations must be a positive integer' };
  }

  return {
    ok: true,
    state: {
      active: candidate['active'] as boolean,
      current_phase: phase,
      task_description: (candidate['task_description'] as string) ?? '',
      iteration: iteration as number,
      max_iterations: maxIter as number,
      fix_attempts: (candidate['fix_attempts'] as number) ?? 0,
      max_fix_attempts: (candidate['max_fix_attempts'] as number) ?? 5,
      started_at: (candidate['started_at'] as string) ?? new Date().toISOString(),
      completed_at: (candidate['completed_at'] as string | null) ?? null,
      evidence: Array.isArray(candidate['evidence']) ? candidate['evidence'] as RalphEvidence[] : [],
      linked_team: (candidate['linked_team'] as string | null) ?? null,
    },
  };
}

export function createInitialRalphState(
  task: string,
  options?: { maxIterations?: number; maxFixAttempts?: number; linkedTeam?: string },
): RalphState {
  return {
    active: true,
    current_phase: 'starting',
    task_description: task,
    iteration: 0,
    max_iterations: options?.maxIterations ?? 50,
    fix_attempts: 0,
    max_fix_attempts: options?.maxFixAttempts ?? 5,
    started_at: new Date().toISOString(),
    completed_at: null,
    evidence: [],
    linked_team: options?.linkedTeam ?? null,
  };
}

export function transitionRalphPhase(state: RalphState, to: RalphPhase, _reason?: string): RalphState {
  if (isTerminalRalphPhase(state.current_phase)) {
    throw new Error(`Cannot transition from terminal phase '${state.current_phase}'`);
  }
  const now = new Date().toISOString();
  const next = { ...state, current_phase: to };

  if (to === 'fixing') {
    next.fix_attempts = state.fix_attempts + 1;
    if (next.fix_attempts > state.max_fix_attempts) {
      next.current_phase = 'failed';
      next.active = false;
      next.completed_at = now;
      return next;
    }
  }

  if (isTerminalRalphPhase(to)) {
    next.active = false;
    next.completed_at = now;
  }

  return next;
}
