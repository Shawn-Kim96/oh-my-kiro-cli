import { execFileSync } from 'child_process';

export interface CheckpointResult {
  skipped: boolean;
  reason: string;
  commitHash?: string;
}

export async function autoCheckpoint(
  cwd: string,
  fromPhase: string,
  toPhase: string,
  teamName: string,
  options?: { enabled?: boolean },
): Promise<CheckpointResult> {
  if (!options?.enabled) {
    return { skipped: true, reason: 'checkpointing disabled' };
  }

  try {
    // Check if cwd is a git repo
    execFileSync('git', ['rev-parse', '--git-dir'], { cwd, stdio: 'pipe' });
  } catch {
    return { skipped: true, reason: 'not a git repository' };
  }

  try {
    // Check if there are changes to commit
    const status = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf-8' });
    if (!status.trim()) {
      return { skipped: true, reason: 'no changes to commit' };
    }

    // Stage and commit
    execFileSync('git', ['add', '-A'], { cwd, stdio: 'pipe' });
    const msg = `kch(${teamName}): auto-checkpoint ${fromPhase}\u2192${toPhase}`;
    execFileSync('git', ['commit', '-m', msg], { cwd, stdio: 'pipe' });
    const hash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd, encoding: 'utf-8' }).trim();
    return { skipped: false, reason: 'committed', commitHash: hash };
  } catch (err) {
    return { skipped: true, reason: `git error: ${err instanceof Error ? err.message : String(err)}` };
  }
}
