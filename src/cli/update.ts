import { Command } from 'commander';
import { spawnSync } from 'child_process';
import { printJson } from '../utils/json.js';

export function updateCommand(): Command {
  return new Command('update')
    .description('Check or apply a global kch package update')
    .option('--apply', 'Run npm install -g kiro-cli-hive@latest')
    .option('--json', 'Print JSON')
    .action((opts: { apply?: boolean; json?: boolean }) => {
      const command = 'npm';
      const args = opts.apply
        ? ['install', '-g', 'kiro-cli-hive@latest']
        : ['view', 'kiro-cli-hive', 'version'];
      const result = spawnSync(command, args, { encoding: 'utf-8' });
      const payload = {
        ok: !result.error && result.status === 0,
        applied: Boolean(opts.apply),
        command,
        args,
        stdout: result.stdout?.trim() ?? '',
        stderr: result.stderr?.trim() ?? '',
      };
      if (opts.json) printJson(payload);
      else {
        console.log(`${command} ${args.join(' ')}`);
        if (payload.stdout) console.log(payload.stdout);
        if (payload.stderr) console.error(payload.stderr);
        if (!opts.apply) console.log('Pass --apply to install the latest global package.');
      }
      if (!payload.ok) process.exitCode = result.status ?? 1;
    });
}
