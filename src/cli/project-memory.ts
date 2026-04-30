import { Command } from 'commander';
import { addProjectDirective, addProjectNote, mergeProjectMemory, readProjectMemory } from '../knowledge/project-memory.js';
import { parseJsonObject, printJson } from '../utils/json.js';

export function projectMemoryCommand(): Command {
  const command = new Command('project-memory')
    .description('Read and write persistent project memory');

  command
    .command('read [section]')
    .option('--json', 'Print JSON')
    .action(async (section: string | undefined, opts: { json?: boolean }) => {
      const memory = await readProjectMemory();
      const value = section ? (memory as unknown as Record<string, unknown>)[section] : memory;
      if (opts.json) printJson(value ?? null);
      else printJson(value ?? null);
    });

  command
    .command('write <json>')
    .description('Merge a JSON object into project memory')
    .action(async (json: string) => {
      const memory = await mergeProjectMemory(parseJsonObject(json));
      printJson({ ok: true, memory });
    });

  command
    .command('note <category> <content...>')
    .action(async (category: string, content: string[]) => {
      const memory = await addProjectNote(category, content.join(' '));
      printJson({ ok: true, category, count: memory.notes[category]?.length ?? 0 });
    });

  command
    .command('directive <content...>')
    .option('--priority <priority>', 'normal or high', 'normal')
    .option('--context <context>', 'Optional directive context')
    .action(async (content: string[], opts: { priority: string; context?: string }) => {
      const priority = opts.priority === 'high' ? 'high' : 'normal';
      const memory = await addProjectDirective(content.join(' '), { priority, context: opts.context });
      printJson({ ok: true, count: memory.directives.length });
    });

  return command;
}
