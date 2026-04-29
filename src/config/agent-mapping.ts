const INTERNAL_AGENT_MAP: Record<string, string> = {
  executor: 'yolo-general',
  explorer: 'yolo-explorer',
  planner: 'yolo-planner',
  verifier: 'yolo-general',
  reviewer: 'yolo-momus',
  debugger: 'yolo-oracle',
  writer: 'yolo-document-writer',
  librarian: 'yolo-librarian',
  frontend: 'yolo-frontend-specialist',
  analyst: 'yolo-general',
  'api-reviewer': 'yolo-momus',
  critic: 'yolo-oracle',
  'dependency-expert': 'yolo-librarian',
  'git-master': 'yolo-general',
  'information-architect': 'yolo-planner',
  'product-manager': 'yolo-planner',
  'product-analyst': 'yolo-general',
  'qa-tester': 'yolo-general',
  'quality-reviewer': 'yolo-momus',
  'style-reviewer': 'yolo-momus',
  'ux-researcher': 'yolo-frontend-specialist',
  default: 'yolo-general',
};

const PUBLIC_AGENT_MAP: Record<string, string> = {
  planner: 'kiro_planner',
  'information-architect': 'kiro_planner',
  'product-manager': 'kiro_planner',
  default: 'kiro_default',
};

function envKeyForRole(agentType: string): string {
  return `KCH_AGENT_${agentType.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

function activeAgentMap(): Record<string, string> {
  const profile = (process.env['KCH_AGENT_PROFILE'] ?? 'internal').trim().toLowerCase();
  if (profile === 'public' || profile === 'kiro') return PUBLIC_AGENT_MAP;
  return INTERNAL_AGENT_MAP;
}

export function resolveAgent(agentType: string): string {
  const roleOverride = process.env[envKeyForRole(agentType)]?.trim();
  if (roleOverride) return roleOverride;

  const defaultOverride = process.env['KCH_DEFAULT_AGENT']?.trim();
  const map = activeAgentMap();
  return map[agentType] ?? defaultOverride ?? map['default']!;
}

export function parseSpec(spec: string | undefined): { workerCount: number; agentType: string } {
  if (!spec) return { workerCount: 1, agentType: 'executor' };
  if (spec.includes(':')) {
    const [countStr, role] = spec.split(':');
    return { workerCount: Math.max(1, parseInt(countStr ?? '1', 10) || 1), agentType: role ?? 'executor' };
  }
  return { workerCount: Math.max(1, parseInt(spec, 10) || 1), agentType: 'executor' };
}
