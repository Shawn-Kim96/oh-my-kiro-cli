import { Command } from 'commander';
import { spawnSync } from 'child_process';
import { capturePane } from '../team/tmux-session.js';
import { printJson } from '../utils/json.js';

export function sparkshellCommand(): Command {
  return new Command('sparkshell')
    .description('Run a bounded shell command or capture a tmux pane')
    .argument('[command]')
    .argument('[args...]')
    .option('--tmux-pane <pane-id>', 'Capture a tmux pane instead of running a command')
    .option('--tail-lines <n>', 'Pane lines to capture', '120')
    .option('--json', 'Print JSON')
    .action((command: string | undefined, args: string[], opts: { tmuxPane?: string; tailLines: string; json?: boolean }) => {
      if (opts.tmuxPane) {
        const text = capturePane(opts.tmuxPane, Math.max(1, parseInt(opts.tailLines, 10) || 120));
        if (opts.json) printJson({ pane: opts.tmuxPane, text });
        else console.log(text);
        return;
      }
      if (!command) throw new Error('Command is required unless --tmux-pane is set.');
      const result = spawnSync(command, args, { encoding: 'utf-8' });
      if (opts.json) printJson({ status: result.status, stdout: result.stdout, stderr: result.stderr, error: result.error?.message });
      else {
        if (result.stdout) process.stdout.write(result.stdout);
        if (result.stderr) process.stderr.write(result.stderr);
      }
      if (result.error || result.status !== 0) process.exitCode = result.status ?? 1;
    });
}
