const AGENT_MAP: Record<string, string> = {
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

export function resolveAgent(agentType: string): string {
  return AGENT_MAP[agentType] ?? AGENT_MAP['default']!;
}

export function parseSpec(spec: string | undefined): { workerCount: number; agentType: string } {
  if (!spec) return { workerCount: 1, agentType: 'executor' };
  if (spec.includes(':')) {
    const [countStr, role] = spec.split(':');
    return { workerCount: Math.max(1, parseInt(countStr ?? '1', 10) || 1), agentType: role ?? 'executor' };
  }
  return { workerCount: Math.max(1, parseInt(spec, 10) || 1), agentType: 'executor' };
}
