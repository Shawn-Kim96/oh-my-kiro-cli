import { readdir } from 'fs/promises';
import { join } from 'path';
import { routeTaskToRole } from './role-router.js';
import { resolveAgentReasoningEffort, type TeamReasoningEffort } from '../config/model-contract.js';

// ── Types ──

export type FollowupMode = 'team' | 'verify';

export interface FollowupAllocation {
  role: string;
  count: number;
  reason: string;
  reasoningEffort?: TeamReasoningEffort;
}

export interface FollowupLaunchHints {
  shellCommand: string;
  rationale: string;
}

export interface FollowupVerificationPlan {
  summary: string;
  checkpoints: string[];
}

export interface FollowupStaffingPlan {
  mode: FollowupMode;
  availableAgentTypes: string[];
  recommendedHeadcount: number;
  allocations: FollowupAllocation[];
  rosterSummary: string;
  staffingSummary: string;
  launchHints: FollowupLaunchHints;
  verificationPlan: FollowupVerificationPlan;
}

export interface BuildFollowupStaffingPlanOptions {
  workerCount?: number;
  fallbackRole?: string;
}

// ── Role Discovery ──

export async function resolveAvailableAgentTypes(projectRoot: string): Promise<string[]> {
  const dirs = [
    join(projectRoot, 'prompts'),
    join(projectRoot, '.kt', 'prompts'),
  ];
  const roles = new Set<string>();
  for (const dir of dirs) {
    try {
      const files = await readdir(dir);
      for (const f of files) {
        if (f.endsWith('.md')) roles.add(f.replace(/\.md$/, ''));
      }
    } catch { /* dir may not exist */ }
  }
  // Always include built-in roles
  for (const r of ['executor', 'explorer', 'planner', 'verifier', 'reviewer', 'debugger', 'writer', 'architect', 'build-fixer', 'test-engineer', 'designer', 'security-reviewer', 'code-simplifier', 'performance-reviewer', 'librarian', 'analyst', 'api-reviewer', 'critic', 'dependency-expert', 'git-master', 'information-architect', 'product-manager', 'product-analyst', 'qa-tester', 'quality-reviewer', 'style-reviewer', 'ux-researcher']) {
    roles.add(r);
  }
  return [...roles].sort();
}

// ── Helpers ──

function chooseAvailableRole(available: readonly string[], preferred: readonly string[], fallback: string): string {
  for (const r of preferred) {
    if (available.includes(r)) return r;
  }
  return available.includes(fallback) ? fallback : available[0] ?? fallback;
}

function mergeAllocation(allocations: FollowupAllocation[], role: string, count: number, reason: string): void {
  if (count <= 0) return;
  const effort = resolveAgentReasoningEffort(role);
  const existing = allocations.find(a => a.role === role && a.reason === reason && a.reasoningEffort === effort);
  if (existing) { existing.count += count; return; }
  allocations.push({ role, count, reason, reasoningEffort: effort });
}

function summarizeAllocations(allocations: readonly FollowupAllocation[]): string {
  return allocations.map(a => {
    const r = a.reasoningEffort ? `, ${a.reasoningEffort} reasoning` : '';
    return `${a.role} x${a.count} (${a.reason}${r})`;
  }).join('; ');
}

function pickSpecialistRole(task: string, available: readonly string[], fallback: string): string {
  const t = task.toLowerCase();
  if (/(security|auth|xss|injection|vulnerability)/.test(t)) return chooseAvailableRole(available, ['security-reviewer', 'architect'], fallback);
  if (/(debug|regression|root cause|stack trace)/.test(t)) return chooseAvailableRole(available, ['debugger', 'architect'], fallback);
  if (/(build|compile|tsc|type error|lint)/.test(t)) return chooseAvailableRole(available, ['build-fixer', 'debugger'], fallback);
  if (/(ui|ux|layout|css|responsive|design|frontend)/.test(t)) return chooseAvailableRole(available, ['designer'], fallback);
  if (/(readme|docs|documentation|changelog)/.test(t)) return chooseAvailableRole(available, ['writer'], fallback);
  return chooseAvailableRole(available, ['architect'], fallback);
}

function buildLaunchHints(mode: FollowupMode, task: string, headcount: number, fallbackRole: string): FollowupLaunchHints {
  const quoted = JSON.stringify(task);
  if (mode === 'team') {
    return {
      shellCommand: `kt team ${headcount}:${fallbackRole} ${quoted}`,
      rationale: 'Launch team with parallel workers for delivery and verification.',
    };
  }
  return {
    shellCommand: `kt team 1:verifier ${quoted}`,
    rationale: 'Launch single verifier for focused evidence collection.',
  };
}

function buildVerificationPlan(mode: FollowupMode, allocations: readonly FollowupAllocation[]): FollowupVerificationPlan {
  if (mode === 'team') {
    const qualityLane = allocations.find(a => a.reason.includes('verification'));
    return {
      summary: 'Team workers deliver in parallel, then verification lane closes with evidence and regression checks.',
      checkpoints: [
        `Launch via \`kt team ...\` so workers stay coordinated.`,
        `Keep ${qualityLane?.role ?? 'the verification lane'} focused on tests and evidence capture.`,
        'Reserve final review for acceptance-criteria validation.',
      ],
    };
  }
  return {
    summary: 'Single verifier collects evidence against acceptance criteria.',
    checkpoints: [
      'Run fresh verification commands before claiming completion.',
      'Keep evidence current with test/build output.',
      'Finish with sign-off reviewing completion evidence.',
    ],
  };
}

// ── Main ──

export function buildFollowupStaffingPlan(
  mode: FollowupMode,
  task: string,
  availableAgentTypes: readonly string[],
  options: BuildFollowupStaffingPlanOptions = {},
): FollowupStaffingPlan {
  const fallbackRole = options.fallbackRole ?? 'executor';
  const workerCount = Math.max(1, options.workerCount ?? (mode === 'team' ? 2 : 1));

  const primaryRoute = routeTaskToRole(task, task, mode === 'team' ? 'exec' : 'verify', fallbackRole);
  const primaryRole = chooseAvailableRole(availableAgentTypes, [primaryRoute.role], fallbackRole);
  const qualityRole = chooseAvailableRole(availableAgentTypes, ['test-engineer', 'verifier'], primaryRole);

  const allocations: FollowupAllocation[] = [];
  mergeAllocation(allocations, primaryRole, 1, mode === 'team' ? 'primary delivery lane' : 'primary implementation lane');

  if (mode === 'team') {
    if (workerCount >= 2) mergeAllocation(allocations, qualityRole, 1, 'verification + regression lane');
    if (workerCount >= 3) {
      const specialist = pickSpecialistRole(task, availableAgentTypes, primaryRole);
      mergeAllocation(allocations, specialist, 1, 'specialist support lane');
    }
    if (workerCount >= 4) mergeAllocation(allocations, primaryRole, workerCount - 3, 'extra implementation capacity');
  }

  return {
    mode,
    availableAgentTypes: [...availableAgentTypes],
    recommendedHeadcount: workerCount,
    allocations,
    rosterSummary: availableAgentTypes.join(', '),
    staffingSummary: summarizeAllocations(allocations),
    launchHints: buildLaunchHints(mode, task, workerCount, fallbackRole),
    verificationPlan: buildVerificationPlan(mode, allocations),
  };
}
