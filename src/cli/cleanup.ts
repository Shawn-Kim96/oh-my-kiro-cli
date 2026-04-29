import { readdir, rm, stat } from 'fs/promises';
import { join } from 'path';
import { ktStateDir } from '../utils/paths.js';
import { readTeamConfig } from '../team/state.js';

export interface CleanupCandidate {
  path: string;
  reason: string;
}

const STALE_LOCK_MS = 30 * 60 * 1000;

async function existsDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function findCleanupCandidates(stateRoot = ktStateDir()): Promise<CleanupCandidate[]> {
  const candidates: CleanupCandidate[] = [];
  const teamsDir = join(stateRoot, 'teams');
  if (!(await existsDir(teamsDir))) return candidates;

  const teams = await readdir(teamsDir, { withFileTypes: true });
  for (const team of teams) {
    if (!team.isDirectory()) continue;
    const lockDir = join(teamsDir, team.name, '.locks');
    if (!(await existsDir(lockDir))) continue;

    const config = await readTeamConfig(team.name);
    const activeWorkers = config?.workers.some(w => w.pane_id) ?? true;
    const lockStats = await stat(lockDir);
    const lockAgeMs = Date.now() - lockStats.mtimeMs;

    if (!activeWorkers && lockAgeMs > STALE_LOCK_MS) {
      candidates.push({ path: lockDir, reason: `stale lock directory older than ${STALE_LOCK_MS}ms` });
    }
  }

  return candidates;
}

export async function runCleanup(options?: { dryRun?: boolean; apply?: boolean }): Promise<void> {
  const dryRun = options?.apply ? false : options?.dryRun ?? true;
  const candidates = await findCleanupCandidates();

  console.log(`${dryRun ? '[dry-run] ' : ''}kch cleanup`);
  if (candidates.length === 0) {
    console.log('  no cleanup candidates found');
    return;
  }

  for (const candidate of candidates) {
    if (dryRun) {
      console.log(`  would remove ${candidate.path} (${candidate.reason})`);
    } else {
      await rm(candidate.path, { recursive: true, force: true });
      console.log(`  removed ${candidate.path} (${candidate.reason})`);
    }
  }
}
