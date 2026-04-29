import type { TeamPhase, TerminalPhase, PhaseState } from './contracts.js';

const TRANSITIONS: Record<TeamPhase, Array<TeamPhase | TerminalPhase>> = {
  exec:   ['verify'],
  verify: ['fix', 'complete', 'failed'],
  fix:    ['exec', 'verify', 'complete', 'failed'],
};

export function isTerminalPhase(phase: TeamPhase | TerminalPhase): phase is TerminalPhase {
  return phase === 'complete' || phase === 'failed' || phase === 'cancelled';
}

export function isValidTransition(from: TeamPhase, to: TeamPhase | TerminalPhase): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function createInitialPhaseState(maxFixAttempts = 3): PhaseState {
  return {
    current_phase: 'exec',
    max_fix_attempts: maxFixAttempts,
    current_fix_attempt: 0,
    transitions: [],
    updated_at: new Date().toISOString(),
  };
}

export function transitionPhase(
  state: PhaseState,
  to: TeamPhase | TerminalPhase,
  reason?: string,
): PhaseState {
  const from = state.current_phase;

  if (isTerminalPhase(from)) {
    throw new Error(`Cannot transition from terminal phase '${from}'`);
  }

  if (!isValidTransition(from, to)) {
    throw new Error(`Invalid transition: ${from} → ${to}`);
  }

  const now = new Date().toISOString();
  const entry = { from, to, at: now, ...(reason ? { reason } : {}) };

  let nextPhase: TeamPhase | TerminalPhase = to;
  let fixAttempt = state.current_fix_attempt;

  if (to === 'fix') {
    fixAttempt++;
    if (fixAttempt > state.max_fix_attempts) {
      nextPhase = 'failed';
      return {
        ...state,
        current_phase: 'failed',
        current_fix_attempt: fixAttempt,
        transitions: [
          ...state.transitions,
          entry,
          { from: 'fix', to: 'failed', at: now, reason: `max fix attempts (${state.max_fix_attempts}) exceeded` },
        ],
        updated_at: now,
      };
    }
  }

  return {
    ...state,
    current_phase: nextPhase,
    current_fix_attempt: fixAttempt,
    transitions: [...state.transitions, entry],
    updated_at: now,
  };
}
