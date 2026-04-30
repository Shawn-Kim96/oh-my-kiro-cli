import { Command } from 'commander';
import { spawnSync } from 'child_process';
import { resolveKiroCliCommand } from '../utils/kiro-cli.js';
import { printJson } from '../utils/json.js';

export function execCommand(): Command {
  return new Command('exec')
    .description('Run Kiro CLI non-interactively')
    .argument('<prompt...>')
    .option('--agent <agent>', 'Kiro agent name')
    .option('--model <model>', 'Kiro model name')
    .option('--json', 'Print JSON metadata')
    .action((promptParts: string[], opts: { agent?: string; model?: string; json?: boolean }) => {
      const args = ['chat', '--no-interactive', '--trust-all-tools'];
      if (opts.model) args.push('--model', opts.model);
      if (opts.agent) args.push('--agent', opts.agent);
      args.push(promptParts.join(' '));

      const result = spawnSync(resolveKiroCliCommand(), args, { encoding: 'utf-8' });
      if (opts.json) {
        printJson({ status: result.status, stdout: result.stdout, stderr: result.stderr, error: result.error?.message });
      } else {
        if (result.stdout) process.stdout.write(result.stdout);
        if (result.stderr) process.stderr.write(result.stderr);
      }
      if (result.error || result.status !== 0) process.exitCode = result.status ?? 1;
    });
}
