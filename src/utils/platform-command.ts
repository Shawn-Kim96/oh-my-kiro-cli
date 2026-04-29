import { spawnSync, type SpawnSyncReturns } from 'child_process';

export function runCommand(cmd: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result: SpawnSyncReturns<string> = spawnSync(cmd, args, { encoding: 'utf-8' });
  if (result.error) return { ok: false, stdout: '', stderr: result.error.message };
  return {
    ok: result.status === 0,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}
