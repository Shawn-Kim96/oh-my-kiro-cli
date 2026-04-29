import type { TeamPhase, TerminalPhase, PhaseState } from './contracts.js';
import { createInitialPhaseState, transitionPhase, isTerminalPhase, isValidTransition } from './orchestrator.js';

export function inferPhaseFromTaskCounts(
  counts: { pending: number; blocked: number; in_progress: number; completed: number; failed: number },
  options?: { verificationPending?: boolean },
): TeamPhase | TerminalPhase {
  const allTerminal = counts.pending === 0 && counts.blocked === 0 && counts.in_progress === 0;

  if (allTerminal && counts.failed === 0) {
    return options?.verificationPending ? 'verify' : 'complete';
  }
  if (allTerminal && counts.failed > 0) return 'fix';
  return 'exec';
}

export function buildTransitionPath(
  from: TeamPhase | TerminalPhase,
  to: TeamPhase | TerminalPhase,
): Array<TeamPhase | TerminalPhase> {
  if (from === to) return [];
  if (isTerminalPhase(from)) return [];

  if (!isTerminalPhase(from) && isValidTransition(from, to)) return [to];

  // Multi-hop: exec→fix or exec→complete/failed go through verify
  if (from === 'exec') {
    if (to === 'fix') return ['verify', 'fix'];
    if (to === 'complete' || to === 'failed') return ['verify', to];
  }

  return [to];
}

export function reconcilePhaseState(
  persisted: PhaseState | null,
  target: TeamPhase | TerminalPhase,
): PhaseState {
  if (!persisted) {
    let state = createInitialPhaseState();
    if (target === 'exec') return state;
    const path = buildTransitionPath('exec', target);
    for (const step of path) {
      state = transitionPhase(state, step, 'reconciliation');
    }
    return state;
  }

  if (persisted.current_phase === target) {
    return { ...persisted, updated_at: new Date().toISOString() };
  }

  if (isTerminalPhase(persisted.current_phase)) {
    if (isTerminalPhase(target)) return { ...persisted, updated_at: new Date().toISOString() };
    // Reopen: create fresh state and transition to target
    let state = createInitialPhaseState(persisted.max_fix_attempts);
    state = {
      ...state,
      transitions: [...persisted.transitions],
      current_fix_attempt: persisted.current_fix_attempt,
    };
    if (target === 'exec') return { ...state, updated_at: new Date().toISOString() };
    const path = buildTransitionPath('exec', target);
    for (const step of path) {
      state = transitionPhase(state, step, 'reopen');
    }
    return state;
  }

  const path = buildTransitionPath(persisted.current_phase, target);
  let state = persisted;
  for (const step of path) {
    state = transitionPhase(state, step, 'reconciliation');
  }
  return state;
}
