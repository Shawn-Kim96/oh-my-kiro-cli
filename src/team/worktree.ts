import { execFileSync, spawnSync } from 'child_process';
import { execFile as execFileCb } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { promisify } from 'util';

const execFilePromise = promisify(execFileCb);

// ── Types ──

export type WorktreeMode =
  | { enabled: false }
  | { enabled: true; detached: true; name: null }
  | { enabled: true; detached: false; name: string };

export interface ParsedWorktreeMode {
  mode: WorktreeMode;
  remainingArgs: string[];
}

export interface WorktreePlanInput {
  cwd: string;
  mode: WorktreeMode;
  teamName?: string;
  workerName?: string;
}

export interface PlannedWorktreeTarget {
  enabled: true;
  repoRoot: string;
  worktreePath: string;
  detached: boolean;
  baseRef: string;
  branchName: string | null;
}

export interface EnsureWorktreeResult {
  enabled: true;
  repoRoot: string;
  worktreePath: string;
  detached: boolean;
  branchName: string | null;
  created: boolean;
  reused: boolean;
  createdBranch: boolean;
}

export interface WorktreeMergeResult {
  workerName: string;
  worktreePath: string;
  strategy: 'cherry-pick' | 'merge' | 'skipped';
  success: boolean;
  conflictFiles: string[];
  commitCount: number;
  error: string | null;
}

interface GitWorktreeEntry {
  path: string;
  head: string;
  branchRef: string | null;
  detached: boolean;
}

// ── Git Helpers ──

function readGit(repoRoot: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) {
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
    throw new Error(stderr || `git ${args.join(' ')} failed`);
  }
  return (result.stdout ?? '').trim();
}

function sanitizePathToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'default';
}

export function isGitRepository(cwd: string): boolean {
  return spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf-8' }).status === 0;
}

function branchExists(repoRoot: string, branchName: string): boolean {
  return spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], { cwd: repoRoot, encoding: 'utf-8' }).status === 0;
}

function isWorktreeDirty(worktreePath: string): boolean {
  const result = spawnSync('git', ['status', '--porcelain'], { cwd: worktreePath, encoding: 'utf-8' });
  if (result.status !== 0) throw new Error(`worktree_status_failed:${worktreePath}`);
  return (result.stdout ?? '').trim() !== '';
}

function validateBranchName(repoRoot: string, branchName: string): void {
  const result = spawnSync('git', ['check-ref-format', '--branch', branchName], { cwd: repoRoot, encoding: 'utf-8' });
  if (result.status !== 0) throw new Error(`invalid_worktree_branch:${branchName}`);
}

export function readWorkspaceStatusLines(cwd: string): string[] {
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd, encoding: 'utf-8' });
  if (result.status !== 0) throw new Error(`workspace_status_failed:${cwd}`);
  return (result.stdout ?? '').split(/\r?\n/).map(l => l.trimEnd()).filter(Boolean);
}

export function assertCleanLeaderWorkspaceForWorkerWorktrees(cwd: string): void {
  const lines = readWorkspaceStatusLines(cwd);
  if (lines.length === 0) return;
  const preview = lines.slice(0, 8).join(' | ');
  throw new Error(`leader_workspace_dirty_for_worktrees:${resolve(cwd)}:${preview}:commit_or_stash_before_kt_team`);
}

// ── Worktree Listing ──

function listWorktrees(repoRoot: string): GitWorktreeEntry[] {
  const raw = readGit(repoRoot, ['worktree', 'list', '--porcelain']);
  if (!raw) return [];
  const entries: GitWorktreeEntry[] = [];
  for (const chunk of raw.split(/\n\n+/).map(c => c.trim()).filter(Boolean)) {
    const lines = chunk.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const wLine = lines.find(l => l.startsWith('worktree '));
    const hLine = lines.find(l => l.startsWith('HEAD '));
    const bLine = lines.find(l => l.startsWith('branch '));
    if (!wLine || !hLine) continue;
    entries.push({
      path: resolve(wLine.slice('worktree '.length)),
      head: hLine.slice('HEAD '.length).trim(),
      branchRef: bLine ? bLine.slice('branch '.length).trim() : null,
      detached: lines.includes('detached') || !bLine,
    });
  }
  return entries;
}

function findWorktreeByPath(entries: GitWorktreeEntry[], worktreePath: string): GitWorktreeEntry | null {
  const resolved = resolve(worktreePath);
  return entries.find(e => resolve(e.path) === resolved) ?? null;
}

function hasBranchInUse(entries: GitWorktreeEntry[], branchName: string, worktreePath: string): boolean {
  const ref = `refs/heads/${branchName}`;
  const resolved = resolve(worktreePath);
  return entries.some(e => e.branchRef === ref && resolve(e.path) !== resolved);
}

// ── Parse ──

export function parseWorktreeMode(args: string[]): ParsedWorktreeMode {
  let mode: WorktreeMode = { enabled: false };
  const remaining: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = String(args[i] ?? '');
    if (arg === '--worktree' || arg === '-w') {
      const next = args[i + 1];
      if (typeof next === 'string' && next.length > 0 && !next.startsWith('-') && !next.includes(':')) {
        mode = { enabled: true, detached: false, name: next };
        i += 1;
      } else {
        mode = { enabled: true, detached: true, name: null };
      }
      continue;
    }
    if (arg.startsWith('--worktree=')) {
      const v = arg.slice('--worktree='.length).trim();
      mode = v ? { enabled: true, detached: false, name: v } : { enabled: true, detached: true, name: null };
      continue;
    }
    remaining.push(args[i]!);
  }
  return { mode, remainingArgs: remaining };
}

// ── Plan & Ensure ──

function resolveBranchName(input: WorktreePlanInput): string | null {
  if (!input.mode.enabled || input.mode.detached) return null;
  const workerName = (input.workerName ?? '').trim();
  if (!workerName) throw new Error('team_worktree_worker_name_required');
  return `${input.mode.name}/${workerName}`;
}

function resolveWorktreePath(input: WorktreePlanInput, repoRoot: string): string {
  const teamName = sanitizePathToken(input.teamName ?? 'team');
  const workerName = sanitizePathToken(input.workerName ?? 'worker');
  return join(repoRoot, '.kt', 'team', teamName, 'worktrees', workerName);
}

export function planWorktreeTarget(input: WorktreePlanInput): PlannedWorktreeTarget | { enabled: false } {
  if (!input.mode.enabled) return { enabled: false };
  const repoRoot = readGit(input.cwd, ['rev-parse', '--show-toplevel']);
  const baseRef = readGit(repoRoot, ['rev-parse', 'HEAD']);
  const branchName = resolveBranchName(input);
  if (branchName) validateBranchName(repoRoot, branchName);
  return { enabled: true, repoRoot, worktreePath: resolveWorktreePath(input, repoRoot), detached: input.mode.detached, baseRef, branchName };
}

export function ensureWorktree(plan: PlannedWorktreeTarget | { enabled: false }): EnsureWorktreeResult | { enabled: false } {
  if (!plan.enabled) return { enabled: false };
  const allWorktrees = listWorktrees(plan.repoRoot);
  const existing = findWorktreeByPath(allWorktrees, plan.worktreePath);

  if (existing) {
    const expectedRef = plan.branchName ? `refs/heads/${plan.branchName}` : null;
    if (plan.detached) {
      if (!existing.detached || existing.head !== plan.baseRef) throw new Error(`worktree_target_mismatch:${plan.worktreePath}`);
    } else if (existing.branchRef !== expectedRef) {
      throw new Error(`worktree_target_mismatch:${plan.worktreePath}`);
    }
    if (isWorktreeDirty(plan.worktreePath)) throw new Error(`worktree_dirty:${plan.worktreePath}`);
    return { enabled: true, repoRoot: plan.repoRoot, worktreePath: resolve(plan.worktreePath), detached: plan.detached, branchName: plan.branchName, created: false, reused: true, createdBranch: false };
  }

  if (existsSync(plan.worktreePath)) throw new Error(`worktree_path_conflict:${plan.worktreePath}`);
  if (plan.branchName && hasBranchInUse(allWorktrees, plan.branchName, plan.worktreePath)) throw new Error(`branch_in_use:${plan.branchName}`);

  mkdirSync(dirname(plan.worktreePath), { recursive: true });
  const branchAlreadyExisted = plan.branchName ? branchExists(plan.repoRoot, plan.branchName) : false;

  const addArgs = ['worktree', 'add'];
  if (plan.detached) {
    addArgs.push('--detach', plan.worktreePath, plan.baseRef);
  } else if (branchAlreadyExisted) {
    addArgs.push(plan.worktreePath, plan.branchName!);
  } else {
    addArgs.push('-b', plan.branchName!, plan.worktreePath, plan.baseRef);
  }

  const result = spawnSync('git', addArgs, { cwd: plan.repoRoot, encoding: 'utf-8' });
  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').trim();
    if (plan.branchName && /already checked out|already used by worktree/i.test(stderr)) throw new Error(`branch_in_use:${plan.branchName}`);
    throw new Error(stderr || `worktree_add_failed:${addArgs.join(' ')}`);
  }

  return { enabled: true, repoRoot: plan.repoRoot, worktreePath: resolve(plan.worktreePath), detached: plan.detached, branchName: plan.branchName, created: true, reused: false, createdBranch: Boolean(plan.branchName && !branchAlreadyExisted) };
}

// ── Auto-commit dirty worktrees ──

export function autoCommitDirtyWorktree(worktreePath: string, workerName: string): boolean {
  if (!isWorktreeDirty(worktreePath)) return false;
  spawnSync('git', ['add', '-A'], { cwd: worktreePath, encoding: 'utf-8' });
  const result = spawnSync('git', ['commit', '-m', `kt: auto-commit ${workerName} before merge`], { cwd: worktreePath, encoding: 'utf-8' });
  return result.status === 0;
}

// ── Conflict Detection ──

function detectConflictFiles(repoRoot: string): string[] {
  const result = spawnSync('git', ['diff', '--name-only', '--diff-filter=U'], { cwd: repoRoot, encoding: 'utf-8' });
  if (result.status !== 0) return [];
  return (result.stdout ?? '').split(/\r?\n/).filter(Boolean);
}

// ── Cherry-pick Strategy ──

function getWorktreeCommits(repoRoot: string, baseRef: string, worktreePath: string): string[] {
  const result = spawnSync('git', ['log', '--format=%H', `${baseRef}..HEAD`], { cwd: worktreePath, encoding: 'utf-8' });
  if (result.status !== 0) return [];
  return (result.stdout ?? '').split(/\r?\n/).filter(Boolean).reverse();
}

export function mergeWorktreeChanges(
  repoRoot: string,
  worktreePath: string,
  workerName: string,
  baseRef: string,
): WorktreeMergeResult {
  // Auto-commit any dirty state first
  autoCommitDirtyWorktree(worktreePath, workerName);

  const commits = getWorktreeCommits(repoRoot, baseRef, worktreePath);
  if (commits.length === 0) {
    return { workerName, worktreePath, strategy: 'skipped', success: true, conflictFiles: [], commitCount: 0, error: null };
  }

  // Try cherry-pick strategy
  let allSuccess = true;
  let conflictFiles: string[] = [];

  for (const sha of commits) {
    const cp = spawnSync('git', ['cherry-pick', '--no-commit', sha], { cwd: repoRoot, encoding: 'utf-8' });
    if (cp.status !== 0) {
      conflictFiles = detectConflictFiles(repoRoot);
      if (conflictFiles.length > 0) {
        // Abort cherry-pick on conflict
        spawnSync('git', ['cherry-pick', '--abort'], { cwd: repoRoot, encoding: 'utf-8' });
        allSuccess = false;
        break;
      }
    }
    // Stage and commit the cherry-picked changes
    spawnSync('git', ['add', '-A'], { cwd: repoRoot, encoding: 'utf-8' });
    spawnSync('git', ['commit', '-m', `kt: cherry-pick ${workerName} (${sha.slice(0, 8)})`], { cwd: repoRoot, encoding: 'utf-8' });
  }

  return {
    workerName,
    worktreePath,
    strategy: 'cherry-pick',
    success: allSuccess,
    conflictFiles,
    commitCount: allSuccess ? commits.length : 0,
    error: allSuccess ? null : `conflict in ${conflictFiles.join(', ')}`,
  };
}

// ── Rollback ──

export async function rollbackProvisionedWorktrees(
  results: Array<EnsureWorktreeResult | { enabled: false }>,
): Promise<void> {
  const created = results
    .filter((r): r is EnsureWorktreeResult => r.enabled === true && r.created)
    .reverse();

  const errors: string[] = [];
  for (const result of created) {
    try {
      await execFilePromise('git', ['worktree', 'remove', '--force', result.worktreePath], { cwd: result.repoRoot, encoding: 'utf-8' });
    } catch (err: unknown) {
      const stderr = ((err as Record<string, unknown>).stderr as string ?? '').trim();
      errors.push(`remove:${result.worktreePath}:${stderr}`);
      continue;
    }
    if (!result.createdBranch || !result.branchName) continue;
    const entries = listWorktrees(result.repoRoot);
    if (hasBranchInUse(entries, result.branchName, result.worktreePath)) continue;
    try {
      await execFilePromise('git', ['branch', '-D', result.branchName], { cwd: result.repoRoot, encoding: 'utf-8' });
    } catch { /* branch may already be gone */ }
  }
  if (errors.length > 0) throw new Error(`worktree_rollback_failed:${errors.join(' | ')}`);
}
