import { Command } from 'commander';
import { assertNotepadSection, clearNotepad, readNotepad, writeNotepadSection } from '../knowledge/notepad.js';
import { printJson } from '../utils/json.js';

export function notepadCommand(): Command {
  const command = new Command('notepad')
    .description('Read and write kch notepad memory');

  command
    .command('read [section]')
    .option('--json', 'Print JSON')
    .action(async (section: string | undefined, opts: { json?: boolean }) => {
      const state = await readNotepad();
      if (section) {
        const selected = assertNotepadSection(section);
        if (opts.json) printJson({ section: selected, entries: state[selected] });
        else console.log(state[selected].join('\n'));
        return;
      }
      if (opts.json) printJson(state);
      else {
        for (const [name, entries] of Object.entries(state)) {
          console.log(`## ${name}`);
          console.log(entries.join('\n') || '_empty_');
          console.log('');
        }
      }
    });

  command
    .command('write <section> <content...>')
    .option('--replace', 'Replace the selected section instead of appending')
    .action(async (section: string, content: string[], opts: { replace?: boolean }) => {
      const selected = assertNotepadSection(section);
      await writeNotepadSection(selected, content.join(' '), { replace: opts.replace });
      printJson({ ok: true, section: selected });
    });

  command
    .command('clear')
    .action(async () => {
      await clearNotepad();
      printJson({ ok: true });
    });

  return command;
}
