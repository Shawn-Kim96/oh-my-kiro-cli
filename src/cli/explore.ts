import { Command } from 'commander';
import { spawnSync } from 'child_process';

export function exploreCommand(): Command {
  return new Command('explore')
    .argument('<query>', 'Literal text or regex to search for')
    .option('--cwd <dir>', 'Working directory', process.cwd())
    .option('--files', 'List matching files only')
    .description('Read-only repository search using rg')
    .action((query: string, opts: { cwd: string; files?: boolean }) => {
      const args = opts.files
        ? ['-l', query]
        : ['-n', '--hidden', '-g', '!node_modules', '-g', '!dist', query];
      const result = spawnSync('rg', args, { cwd: opts.cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });

      if (result.error) {
        console.error(`Error: rg failed: ${result.error.message}`);
        process.exitCode = 1;
        return;
      }
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      process.exitCode = result.status === 1 ? 0 : (result.status ?? 0);
    });
}
