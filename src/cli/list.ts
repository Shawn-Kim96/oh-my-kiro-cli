import { Command } from 'commander';
import { existsSync } from 'fs';
import { readdir, readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { printJson } from '../utils/json.js';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = join(dirname(__filename), '..', '..');

async function listSkillNames(): Promise<string[]> {
  const dir = join(repoRoot, 'skills');
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (existsSync(join(dir, entry.name, 'SKILL.md'))) result.push(entry.name);
  }
  return result.sort();
}

async function listPromptNames(): Promise<string[]> {
  const dir = join(repoRoot, 'src', 'prompts');
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => entry.name.replace(/\.md$/, ''))
    .sort();
}

async function skillDescription(name: string): Promise<string | null> {
  try {
    const content = await readFile(join(repoRoot, 'skills', name, 'SKILL.md'), 'utf-8');
    return content.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

export function listCommand(): Command {
  return new Command('list')
    .description('List packaged kch skills and prompts')
    .option('--json', 'Print JSON')
    .action(async (opts: { json?: boolean }) => {
      const skills = await Promise.all((await listSkillNames()).map(async name => ({ name, description: await skillDescription(name) })));
      const prompts = await listPromptNames();
      if (opts.json) {
        printJson({ skills, prompts });
        return;
      }
      console.log('Skills:');
      for (const skill of skills) console.log(`  ${skill.name}${skill.description ? ` - ${skill.description}` : ''}`);
      console.log('\nPrompts:');
      for (const prompt of prompts) console.log(`  ${prompt}`);
    });
}
