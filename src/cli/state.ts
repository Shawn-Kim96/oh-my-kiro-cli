import { Command } from 'commander';
import { existsSync } from 'fs';
import { mkdir, readFile, readdir, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { kchModeStateDir, kchModeStatePath } from '../utils/paths.js';
import { parseJsonObject, printJson } from '../utils/json.js';

async function readModeState(mode: string): Promise<Record<string, unknown> | null> {
  const path = kchModeStatePath(mode);
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, 'utf-8')) as Record<string, unknown>;
}

async function listModeStates(): Promise<Array<{ mode: string; state: Record<string, unknown> }>> {
  const dir = kchModeStateDir();
  if (!existsSync(dir)) return [];
  const result: Array<{ mode: string; state: Record<string, unknown> }> = [];
  for (const file of await readdir(dir)) {
    if (!file.endsWith('-state.json')) continue;
    const mode = file.replace(/-state\.json$/, '');
    try {
      result.push({ mode, state: JSON.parse(await readFile(join(dir, file), 'utf-8')) as Record<string, unknown> });
    } catch { /* skip unreadable state */ }
  }
  return result;
}

export function stateCommand(): Command {
  const command = new Command('state')
    .description('Read/write/list kch mode state');

  command
    .command('list')
    .option('--json', 'Print JSON')
    .action(async (opts: { json?: boolean }) => {
      const states = await listModeStates();
      const active_modes = states.filter(s => s.state['active']).map(s => s.mode);
      if (opts.json) {
        printJson({ active_modes, states });
        return;
      }
      if (states.length === 0) {
        console.log('No mode state found.');
        return;
      }
      for (const entry of states) {
        console.log(`${entry.mode}${entry.state['active'] ? ' active' : ''}`);
      }
    });

  command
    .command('read <mode>')
    .option('--json', 'Print JSON')
    .action(async (mode: string, opts: { json?: boolean }) => {
      const state = await readModeState(mode);
      if (opts.json) {
        printJson({ exists: Boolean(state), mode, state });
        return;
      }
      if (!state) {
        console.log(`No state for ${mode}.`);
        return;
      }
      printJson(state);
    });

  command
    .command('write <mode> <json>')
    .description('Merge a JSON object into a mode state file')
    .action(async (mode: string, json: string) => {
      const patch = parseJsonObject(json);
      const existing = await readModeState(mode) ?? {};
      const merged = { ...existing, ...patch, updated_at: new Date().toISOString() };
      await mkdir(kchModeStateDir(), { recursive: true });
      await writeFile(kchModeStatePath(mode), JSON.stringify(merged, null, 2), 'utf-8');
      printJson({ ok: true, mode, state: merged });
    });

  command
    .command('clear <mode>')
    .action(async (mode: string) => {
      const path = kchModeStatePath(mode);
      if (existsSync(path)) await unlink(path);
      printJson({ ok: true, cleared: mode });
    });

  return command;
}
