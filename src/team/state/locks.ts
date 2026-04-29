import { mkdir, rmdir, stat, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { ktStateDir, ktTeamDir } from '../../utils/paths.js';
import { sleep } from '../../utils/sleep.js';

const STALE_THRESHOLD_MS = 30_000;
const POLL_INTERVAL_MS = 100;

export async function staleLockThreshold(lockPath: string): Promise<number> {
  try {
    // lockPath is <state-root>/teams/{teamName}/.locks/{lockName}
    const parts = lockPath.split('/');
    const locksIdx = parts.indexOf('.locks');
    if (locksIdx < 1) return STALE_THRESHOLD_MS;
    const teamName = parts[locksIdx - 1]!;
    const lockName = parts[locksIdx + 1];
    if (!lockName) return STALE_THRESHOLD_MS;

    // Extract worker name from lock name
    let workerName: string | null = null;
    if (lockName.startsWith('task-')) {
      // task-{taskId} — can't directly map to worker, skip
      return STALE_THRESHOLD_MS;
    } else if (lockName.startsWith('mailbox-worker-')) {
      // mailbox-worker-{N} → worker-{N}
      workerName = lockName.replace('mailbox-', '');
    } else if (lockName.startsWith('mailbox-')) {
      workerName = lockName.replace('mailbox-', '');
    }

    if (!workerName) return STALE_THRESHOLD_MS;

    const heartbeatPath = join(ktStateDir(), 'teams', teamName, 'workers', workerName, 'heartbeat.json');
    const raw = await readFile(heartbeatPath, 'utf-8');
    const hb = JSON.parse(raw) as { last_seen?: string };
    if (!hb.last_seen) return STALE_THRESHOLD_MS;

    const lastSeen = new Date(hb.last_seen).getTime();
    if (Date.now() - lastSeen < 60_000) return 120_000;
    return STALE_THRESHOLD_MS;
  } catch {
    return STALE_THRESHOLD_MS;
  }
}

async function isStale(lockPath: string): Promise<boolean> {
  try {
    const s = await stat(lockPath);
    const threshold = await staleLockThreshold(lockPath);
    return Date.now() - s.mtimeMs > threshold;
  } catch {
    return false;
  }
}

async function acquireLock(lockPath: string): Promise<boolean> {
  try {
    await mkdir(dirname(lockPath), { recursive: true });
    await mkdir(lockPath, { recursive: false });
    return true;
  } catch {
    return false;
  }
}

async function releaseLock(lockPath: string): Promise<void> {
  try { await rmdir(lockPath); } catch { /* ignore */ }
}

export async function withFileLock<T>(lockPath: string, fn: () => Promise<T>, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await acquireLock(lockPath)) {
      try { return await fn(); } finally { await releaseLock(lockPath); }
    }
    if (await isStale(lockPath)) {
      await releaseLock(lockPath);
      continue;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Lock timeout: ${lockPath}`);
}

function lockDir(teamName: string, name: string): string {
  return join(ktTeamDir(teamName), '.locks', name);
}

export function withTeamLock<T>(teamName: string, fn: () => Promise<T>): Promise<T> {
  return withFileLock(lockDir(teamName, 'team'), fn);
}

export function withTaskClaimLock<T>(teamName: string, taskId: string, fn: () => Promise<T>): Promise<T> {
  return withFileLock(lockDir(teamName, `task-${taskId}`), fn);
}

export function withMailboxLock<T>(teamName: string, workerName: string, fn: () => Promise<T>): Promise<T> {
  return withFileLock(lockDir(teamName, `mailbox-${workerName}`), fn);
}

export function withScalingLock<T>(teamName: string, fn: () => Promise<T>): Promise<T> {
  return withFileLock(lockDir(teamName, 'scaling'), fn);
}

export function withDispatchLock<T>(teamName: string, fn: () => Promise<T>): Promise<T> {
  return withFileLock(lockDir(teamName, 'dispatch'), fn);
}
