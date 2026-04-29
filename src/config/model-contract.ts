// ── Types ──

export type TeamReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

export interface ParsedWorkerLaunchArgs {
  passthrough: string[];
  reasoningOverride: string | null;
  modelOverride: string | null;
}

// ── Constants ──

const LOW_COMPLEXITY_AGENT_TYPES = new Set([
  'explorer',
  'writer',
  'style-reviewer',
  'librarian',
]);

const ROLE_REASONING_MAP: Record<string, TeamReasoningEffort> = {
  executor: 'medium',
  explorer: 'low',
  planner: 'high',
  verifier: 'medium',
  reviewer: 'high',
  debugger: 'high',
  writer: 'low',
  architect: 'xhigh',
  'build-fixer': 'medium',
  'test-engineer': 'medium',
  designer: 'medium',
  'security-reviewer': 'high',
  'code-simplifier': 'medium',
  'performance-reviewer': 'high',
  librarian: 'low',
};

// ── Reasoning Effort ──

export function resolveAgentReasoningEffort(agentType?: string): TeamReasoningEffort | undefined {
  if (!agentType || agentType.trim() === '') return undefined;
  return ROLE_REASONING_MAP[agentType.trim().toLowerCase()];
}

export function isLowComplexityAgentType(agentType?: string): boolean {
  if (!agentType) return false;
  const normalized = agentType.trim().toLowerCase();
  if (normalized === '') return false;
  if (normalized.endsWith('-low')) return true;
  return LOW_COMPLEXITY_AGENT_TYPES.has(normalized);
}

// ── Launch Args ──

function isValidModelValue(value: string): boolean {
  return value.trim().length > 0 && !value.startsWith('-');
}

export function parseWorkerLaunchArgs(args: string[]): ParsedWorkerLaunchArgs {
  const passthrough: string[] = [];
  let reasoningOverride: string | null = null;
  let modelOverride: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === '--model') {
      const next = args[i + 1];
      if (typeof next === 'string' && isValidModelValue(next)) {
        modelOverride = next.trim();
        i += 1;
      }
      continue;
    }
    if (arg.startsWith('--model=')) {
      const v = arg.slice('--model='.length).trim();
      if (isValidModelValue(v)) modelOverride = v;
      continue;
    }
    if (arg === '--reasoning') {
      const next = args[i + 1];
      if (typeof next === 'string' && isValidEffort(next)) {
        reasoningOverride = next.trim();
        i += 1;
      }
      continue;
    }
    passthrough.push(arg);
  }

  return { passthrough, reasoningOverride, modelOverride };
}

function isValidEffort(value: string): boolean {
  return ['low', 'medium', 'high', 'xhigh'].includes(value.trim().toLowerCase());
}

export function normalizeTeamWorkerLaunchArgs(
  args: string[],
  preferredModel?: string,
  preferredReasoning?: TeamReasoningEffort,
): string[] {
  const parsed = parseWorkerLaunchArgs(args);
  const normalized = [...parsed.passthrough];

  // kiro-cli flags
  normalized.push('--trust-all-tools');

  const model = preferredModel ?? parsed.modelOverride;
  if (model) normalized.push('--model', model);

  const reasoning = parsed.reasoningOverride ?? preferredReasoning;
  if (reasoning) normalized.push('--reasoning', reasoning);

  return normalized;
}

export function resolveWorkerLaunchFlags(role: string, extraArgs: string[] = []): string[] {
  const effort = resolveAgentReasoningEffort(role);
  return normalizeTeamWorkerLaunchArgs(extraArgs, undefined, effort);
}

export function resolveModelRouteFlags(modelRoute: 'fast' | 'standard' | 'reasoning'): string[] {
  // Map triage model route to kiro-cli flags
  // Note: kiro-cli model selection support is unverified.
  // Returns empty array as safe default until confirmed.
  const routeMap: Record<string, string | null> = {
    fast: null,        // use default model (fastest)
    standard: null,    // use default model
    reasoning: null,   // use default model (would be frontier when supported)
  };
  const model = routeMap[modelRoute];
  return model ? ['--model', model] : [];
}
