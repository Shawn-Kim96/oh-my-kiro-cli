import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { ktStateDir } from '../utils/paths.js';

const STATE_DIRS = ['teams', 'logs', 'wiki', 'ralph', 'state', 'jobs', 'plans'];

export async function runSetup(options?: { dryRun?: boolean }): Promise<void> {
  const stateRoot = ktStateDir();
  const dryRun = Boolean(options?.dryRun);

  console.log(`${dryRun ? '[dry-run] ' : ''}kch setup`);
  console.log(`State root: ${stateRoot}`);

  for (const dir of STATE_DIRS) {
    const path = join(stateRoot, dir);
    if (dryRun) {
      console.log(`  would ensure ${path}`);
    } else {
      await mkdir(path, { recursive: true });
      console.log(`  ensured ${path}`);
    }
  }

  const readmePath = join(stateRoot, 'README.md');
  if (dryRun) {
    console.log(`  would write ${readmePath}`);
  } else if (!existsSync(readmePath)) {
    await writeFile(readmePath, '# kch state\n\nManaged state for kiro-cli-hive.\n', 'utf-8');
    console.log(`  wrote ${readmePath}`);
  }
}
