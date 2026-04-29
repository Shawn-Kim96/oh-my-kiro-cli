import type { TeamPhase } from './contracts.js';
import { resolveAgent } from '../config/agent-mapping.js';

export interface RoleRouterResult {
  role: string;
  agent: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

const ROLE_KEYWORDS: ReadonlyArray<{ role: string; keywords: readonly string[] }> = [
  { role: 'explorer', keywords: ['find', 'search', 'locate', 'grep', 'pattern', 'where', 'list all'] },
  { role: 'debugger', keywords: ['debug', 'investigate', 'root cause', 'bisect', 'diagnose', 'trace', 'stack trace'] },
  { role: 'writer', keywords: ['doc', 'readme', 'guide', 'changelog', 'documentation', 'api doc'] },
  { role: 'reviewer', keywords: ['review', 'audit', 'quality', 'lint', 'anti-pattern', 'code review'] },
  { role: 'frontend', keywords: ['ui', 'css', 'component', 'layout', 'responsive', 'tailwind', 'react'] },
  { role: 'librarian', keywords: ['research', 'documentation', 'api reference', 'best practice', 'example'] },
  { role: 'planner', keywords: ['plan', 'break down', 'decompose', 'task list', 'roadmap'] },
  { role: 'executor', keywords: ['implement', 'build', 'create', 'fix', 'ship', 'add', 'update', 'migrate'] },
  { role: 'analyst', keywords: ['requirements', 'analyze requirements', 'acceptance criteria', 'user story', 'scope'] },
  { role: 'api-reviewer', keywords: ['api design', 'endpoint', 'rest api', 'graphql', 'contract', 'schema', 'swagger'] },
  { role: 'critic', keywords: ['challenge', 'risk', 'assumption', 'devil', 'trade-off', 'failure mode'] },
  { role: 'dependency-expert', keywords: ['dependency', 'package version', 'vulnerability', 'upgrade', 'npm audit', 'outdated'] },
  { role: 'git-master', keywords: ['commit', 'rebase', 'merge', 'branch', 'cherry-pick', 'bisect', 'blame'] },
  { role: 'information-architect', keywords: ['organize', 'structure', 'taxonomy', 'hierarchy', 'navigation', 'categorize'] },
  { role: 'product-manager', keywords: ['product', 'user story', 'prioritize', 'mvp', 'roadmap', 'feature request'] },
  { role: 'product-analyst', keywords: ['feature gap', 'competitive', 'product analysis', 'feature inventory', 'maturity'] },
  { role: 'qa-tester', keywords: ['test plan', 'qa', 'regression', 'test case', 'defect', 'reproduce'] },
  { role: 'quality-reviewer', keywords: ['code quality', 'complexity', 'maintainability', 'code smell', 'duplication', 'solid'] },
  { role: 'style-reviewer', keywords: ['style', 'formatting', 'naming convention', 'lint', 'prettier', 'eslint'] },
  { role: 'ux-researcher', keywords: ['usability', 'user flow', 'ux', 'friction', 'onboarding', 'discoverability'] },
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
      bestAgent = resolveAgent(entry.role);
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
