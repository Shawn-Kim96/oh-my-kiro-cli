import { join } from 'path';
import { readJson, writeJson } from '../utils/safe-json.js';
import { ktTeamDir } from '../utils/paths.js';

// ── Types ──

export type TaskApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface TaskApproval {
  taskId: string;
  status: TaskApprovalStatus;
  approver: string | null;
  reason: string | null;
  updatedAt: string;
}

export interface GovernancePolicy {
  requireApproval: boolean;
  autoApproveRoles: string[];
  maxPendingTasks: number;
}

export interface TeamGovernance {
  policy: GovernancePolicy;
  approvals: TaskApproval[];
}

// ── Defaults ──

export function defaultGovernancePolicy(): GovernancePolicy {
  return {
    requireApproval: false,
    autoApproveRoles: ['executor', 'explorer', 'writer', 'librarian'],
    maxPendingTasks: 10,
  };
}

// ── Paths ──

function approvalPath(teamName: string, taskId: string): string {
  return join(ktTeamDir(teamName), 'governance', `approval-${taskId}.json`);
}

function policyPath(teamName: string): string {
  return join(ktTeamDir(teamName), 'governance', 'policy.json');
}

// ── Read / Write ──

export async function writeTaskApproval(teamName: string, approval: TaskApproval): Promise<void> {
  await writeJson(approvalPath(teamName, approval.taskId), approval);
}

export async function readTaskApproval(teamName: string, taskId: string): Promise<TaskApproval | null> {
  return readJson<TaskApproval>(approvalPath(teamName, taskId));
}

export async function writeGovernancePolicy(teamName: string, policy: GovernancePolicy): Promise<void> {
  await writeJson(policyPath(teamName), policy);
}

export async function readGovernancePolicy(teamName: string): Promise<GovernancePolicy> {
  return await readJson<GovernancePolicy>(policyPath(teamName)) ?? defaultGovernancePolicy();
}

// ── Logic ──

export function shouldAutoApprove(policy: GovernancePolicy, role: string): boolean {
  if (!policy.requireApproval) return true;
  return policy.autoApproveRoles.includes(role);
}

export async function approveTask(teamName: string, taskId: string, approver: string, reason?: string): Promise<TaskApproval> {
  const approval: TaskApproval = {
    taskId,
    status: 'approved',
    approver,
    reason: reason ?? null,
    updatedAt: new Date().toISOString(),
  };
  await writeTaskApproval(teamName, approval);
  return approval;
}

export async function rejectTask(teamName: string, taskId: string, approver: string, reason: string): Promise<TaskApproval> {
  const approval: TaskApproval = {
    taskId,
    status: 'rejected',
    approver,
    reason,
    updatedAt: new Date().toISOString(),
  };
  await writeTaskApproval(teamName, approval);
  return approval;
}

export async function isTaskApproved(teamName: string, taskId: string, role: string): Promise<boolean> {
  const policy = await readGovernancePolicy(teamName);
  if (shouldAutoApprove(policy, role)) return true;
  const approval = await readTaskApproval(teamName, taskId);
  return approval?.status === 'approved';
}
