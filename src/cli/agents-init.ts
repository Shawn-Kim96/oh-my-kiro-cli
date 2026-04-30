import { Command } from 'commander';
import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { printJson } from '../utils/json.js';

const AGENTS_TEMPLATE = `# kch Workspace Guidance

This repository can be coordinated with kiro-cli-hive through \`kch\`.

- Use \`kch team N:role "task"\` for durable tmux-backed worker sessions.
- Workers must read their inbox and update lifecycle through \`kch api\`.
- Use \`KCH_AGENT_PROFILE=public\` for stock Kiro CLI, or the default internal profile for Amazon yolo agents.
- Do not use Kiro subagents for durable team orchestration.
`;

export function agentsInitCommand(name = 'agents-init'): Command {
  return new Command(name)
    .description('Bootstrap lightweight AGENTS.md guidance for kch')
    .argument('[path]', 'Target directory', process.cwd())
    .option('--force', 'Overwrite existing AGENTS.md')
    .action(async (target: string, opts: { force?: boolean }) => {
      const root = resolve(target);
      const path = join(root, 'AGENTS.md');
      if (existsSync(path) && !opts.force) {
        throw new Error(`Refusing to overwrite ${path}; pass --force`);
      }
      await mkdir(root, { recursive: true });
      await writeFile(path, AGENTS_TEMPLATE, 'utf-8');
      printJson({ ok: true, path });
    });
}
