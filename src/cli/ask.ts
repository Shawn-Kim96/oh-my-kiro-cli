import { Command } from 'commander';
import { spawnSync } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { kchLogsDir } from '../utils/paths.js';
import { resolveKiroCliCommand } from '../utils/kiro-cli.js';
import { printJson } from '../utils/json.js';

function providerCommand(provider: string, prompt: string): { command: string; args: string[] } {
  switch (provider) {
    case 'claude':
      return { command: 'claude', args: ['-p', prompt] };
    case 'gemini':
      return { command: 'gemini', args: ['-p', prompt] };
    case 'kiro':
      return { command: resolveKiroCliCommand(), args: ['chat', '--no-interactive', prompt] };
    default:
      throw new Error(`Unknown provider: ${provider}. Expected claude, gemini, or kiro.`);
  }
}

export function askCommand(): Command {
  return new Command('ask')
    .description('Ask a local provider CLI and write an artifact')
    .argument('<provider>', 'claude, gemini, or kiro')
    .argument('<prompt...>')
    .option('--output <path>', 'Artifact path')
    .option('--timeout-ms <ms>', 'Timeout in milliseconds', '300000')
    .option('--dry-run', 'Print command without running it')
    .option('--json', 'Print JSON')
    .action(async (provider: string, promptParts: string[], opts: { output?: string; timeoutMs: string; dryRun?: boolean; json?: boolean }) => {
      const prompt = promptParts.join(' ');
      const planned = providerCommand(provider, prompt);
      const artifactPath = opts.output ?? join(kchLogsDir(), 'ask', `${provider}-${Date.now()}.md`);

      if (opts.dryRun) {
        const payload = { provider, command: planned.command, args: planned.args, artifactPath };
        if (opts.json) printJson(payload);
        else console.log(`${planned.command} ${planned.args.map(arg => JSON.stringify(arg)).join(' ')}`);
        return;
      }

      const result = spawnSync(planned.command, planned.args, {
        encoding: 'utf-8',
        timeout: Math.max(1000, parseInt(opts.timeoutMs, 10) || 300000),
      });
      const stdout = result.stdout ?? '';
      const stderr = result.stderr ?? '';
      await mkdir(dirname(artifactPath), { recursive: true });
      await writeFile(artifactPath, [
        `# kch ask ${provider}`,
        '',
        '## Prompt',
        prompt,
        '',
        '## Output',
        stdout,
        '',
        stderr ? `## Stderr\n${stderr}\n` : '',
      ].join('\n'), 'utf-8');
      const payload = {
        ok: !result.error && result.status === 0,
        provider,
        artifactPath,
        status: result.status,
        stderr,
      };
      if (opts.json) printJson(payload);
      else {
        console.log(`Artifact: ${artifactPath}`);
        if (stdout) console.log(stdout);
        if (stderr) console.error(stderr);
      }
      if (result.error || result.status !== 0) process.exitCode = result.status ?? 1;
    });
}
