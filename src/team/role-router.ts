import type { TeamPhase } from './contracts.js';
import { resolveAgent } from '../config/agent-mapping.js';

export interface RoleRouterResult {
  role: string;
  agent: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

const ROLE_KEYWORDS: ReadonlyArray<{ role: string; agent: string; keywords: readonly string[] }> = [
  { role: 'explorer',  agent: 'yolo-explorer',           keywords: ['find', 'search', 'locate', 'grep', 'pattern', 'where', 'list all'] },
  { role: 'debugger',  agent: 'yolo-oracle',             keywords: ['debug', 'investigate', 'root cause', 'bisect', 'diagnose', 'trace', 'stack trace'] },
  { role: 'writer',    agent: 'yolo-document-writer',    keywords: ['doc', 'readme', 'guide', 'changelog', 'documentation', 'api doc'] },
  { role: 'reviewer',  agent: 'yolo-momus',              keywords: ['review', 'audit', 'quality', 'lint', 'anti-pattern', 'code review'] },
  { role: 'frontend',  agent: 'yolo-frontend-specialist', keywords: ['ui', 'css', 'component', 'layout', 'responsive', 'tailwind', 'react'] },
  { role: 'librarian', agent: 'yolo-librarian',          keywords: ['research', 'documentation', 'api reference', 'best practice', 'example'] },
  { role: 'planner',   agent: 'yolo-planner',            keywords: ['plan', 'break down', 'decompose', 'task list', 'roadmap'] },
  { role: 'executor',  agent: 'yolo-general',            keywords: ['implement', 'build', 'create', 'fix', 'ship', 'add', 'update', 'migrate'] },
  { role: 'analyst',  agent: 'yolo-general',            keywords: ['requirements', 'analyze requirements', 'acceptance criteria', 'user story', 'scope'] },
  { role: 'api-reviewer', agent: 'yolo-momus',          keywords: ['api design', 'endpoint', 'rest api', 'graphql', 'contract', 'schema', 'swagger'] },
  { role: 'critic',   agent: 'yolo-oracle',             keywords: ['challenge', 'risk', 'assumption', 'devil', 'trade-off', 'failure mode'] },
  { role: 'dependency-expert', agent: 'yolo-librarian',  keywords: ['dependency', 'package version', 'vulnerability', 'upgrade', 'npm audit', 'outdated'] },
  { role: 'git-master', agent: 'yolo-general',          keywords: ['commit', 'rebase', 'merge', 'branch', 'cherry-pick', 'bisect', 'blame'] },
  { role: 'information-architect', agent: 'yolo-planner', keywords: ['organize', 'structure', 'taxonomy', 'hierarchy', 'navigation', 'categorize'] },
  { role: 'product-manager', agent: 'yolo-planner',     keywords: ['product', 'user story', 'prioritize', 'mvp', 'roadmap', 'feature request'] },
  { role: 'product-analyst', agent: 'yolo-general',     keywords: ['feature gap', 'competitive', 'product analysis', 'feature inventory', 'maturity'] },
  { role: 'qa-tester', agent: 'yolo-general',           keywords: ['test plan', 'qa', 'regression', 'test case', 'defect', 'reproduce'] },
  { role: 'quality-reviewer', agent: 'yolo-momus',      keywords: ['code quality', 'complexity', 'maintainability', 'code smell', 'duplication', 'solid'] },
  { role: 'style-reviewer', agent: 'yolo-momus',        keywords: ['style', 'formatting', 'naming convention', 'lint', 'prettier', 'eslint'] },
  { role: 'ux-researcher', agent: 'yolo-frontend-specialist', keywords: ['usability', 'user flow', 'ux', 'friction', 'onboarding', 'discoverability'] },
];

export function getPhaseDefaultRoles(phase: TeamPhase): string[] {
  switch (phase) {
    case 'exec':   return ['executor', 'frontend'];
    case 'verify': return ['reviewer', 'explorer'];
    case 'fix':    return ['debugger', 'executor'];
  }
}

export function routeTaskToRole(
  taskSubject: string,
  taskDescription: string,
  phase: TeamPhase | null,
  fallbackRole: string,
): RoleRouterResult {
  const subjectLower = taskSubject.toLowerCase();
  const descLower = taskDescription.toLowerCase();

  let bestRole = '';
  let bestAgent = '';
  let bestScore = 0;

  for (const entry of ROLE_KEYWORDS) {
    let score = 0;
    for (const kw of entry.keywords) {
      if (subjectLower.includes(kw)) score += 2;
      if (descLower.includes(kw)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestRole = entry.role;
      bestAgent = entry.agent;
    }
  }

  if (bestScore >= 2) {
    return { role: bestRole, agent: bestAgent, confidence: 'high', reason: `score ${bestScore} for '${bestRole}'` };
  }
  if (bestScore === 1) {
    return { role: bestRole, agent: bestAgent, confidence: 'medium', reason: `score ${bestScore} for '${bestRole}'` };
  }

  // No matches — use phase defaults or fallback
  if (phase) {
    const defaults = getPhaseDefaultRoles(phase);
    const defaultRole = defaults[0]!;
    return { role: defaultRole, agent: resolveAgent(defaultRole), confidence: 'low', reason: `no keyword match, phase default '${defaultRole}'` };
  }

  return { role: fallbackRole, agent: resolveAgent(fallbackRole), confidence: 'low', reason: `no keyword match, using fallback '${fallbackRole}'` };
}
