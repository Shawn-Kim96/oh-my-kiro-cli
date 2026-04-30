import { Command } from 'commander';
import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { resolveKiroCliCommand } from '../utils/kiro-cli.js';
import { runCommand } from '../utils/platform-command.js';
import { printJson } from '../utils/json.js';

function agentConfig(name: string, description: string, prompt: string): Record<string, unknown> {
  return {
    name,
    description,
    prompt,
    mcpServers: {},
    tools: ['read', 'write', 'shell', 'grep', 'glob', 'thinking', 'todo'],
    toolAliases: {},
    allowedTools: [],
    resources: [],
    hooks: {},
    toolsSettings: {},
    includeMcpJson: true,
    model: null,
  };
}

async function writeAgent(path: string, name: string, description: string, prompt: string, force: boolean): Promise<void> {
  if (existsSync(path) && !force) throw new Error(`Refusing to overwrite ${path}; pass --force`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(agentConfig(name, description, prompt), null, 2), 'utf-8');
}

export function agentsCommand(): Command {
  const command = new Command('agents')
    .description('Manage or inspect Kiro agent configs for kch');

  command
    .command('list')
    .option('--json', 'Print JSON')
    .action((opts: { json?: boolean }) => {
      const kiro = resolveKiroCliCommand();
      const result = runCommand(kiro, ['agent', 'list']);
      if (opts.json) printJson({ ok: result.ok, stdout: result.stdout, stderr: result.stderr });
      else {
        if (result.stdout) console.log(result.stdout);
        if (!result.ok) {
          console.error(result.stderr || `Failed to run ${kiro} agent list`);
          process.exitCode = 1;
        }
      }
    });

  command
    .command('validate <path>')
    .action((path: string) => {
      const result = runCommand(resolveKiroCliCommand(), ['agent', 'validate', path]);
      if (result.stdout) console.log(result.stdout);
      if (!result.ok) {
        console.error(result.stderr);
        process.exitCode = 1;
      }
    });

  command
    .command('init [target]')
    .description('Create workspace Kiro agents for kch-compatible public profiles')
    .option('--force', 'Overwrite existing agent files')
    .action(async (target: string | undefined, opts: { force?: boolean }) => {
      const root = resolve(target ?? process.cwd());
      const dir = join(root, '.kiro', 'agents');
      await mkdir(dir, { recursive: true });
      await writeAgent(
        join(dir, 'kch-executor.json'),
        'kch-executor',
        'kch executor agent for tmux worker sessions',
        'You are a kch worker. Follow the inbox instructions exactly, use kch api for task lifecycle updates, and do not spawn subagents.',
        Boolean(opts.force),
      );
      await writeAgent(
        join(dir, 'kch-planner.json'),
        'kch-planner',
        'kch planner agent for decomposing work',
        'You are a kch planning worker. Produce concise task decomposition, risks, and verification steps grounded in repository evidence.',
        Boolean(opts.force),
      );
      printJson({ ok: true, directory: dir, agents: ['kch-executor', 'kch-planner'] });
    });

  return command;
}
