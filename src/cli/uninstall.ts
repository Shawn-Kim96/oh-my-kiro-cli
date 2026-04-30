import { Command } from 'commander';
import { rm } from 'fs/promises';
import { kchStateDir } from '../utils/paths.js';
import { printJson } from '../utils/json.js';

export function uninstallCommand(): Command {
  return new Command('uninstall')
    .description('Remove kch runtime state with explicit --apply')
    .option('--purge', 'Remove the entire kch state root')
    .option('--apply', 'Actually remove files')
    .option('--json', 'Print JSON')
    .action(async (opts: { purge?: boolean; apply?: boolean; json?: boolean }) => {
      const stateRoot = kchStateDir();
      const targets = opts.purge
        ? [stateRoot]
        : ['jobs', 'logs', 'state'].map(name => `${stateRoot}/${name}`);
      if (opts.apply) {
        for (const target of targets) await rm(target, { recursive: true, force: true });
      }
      const payload = { ok: true, applied: Boolean(opts.apply), targets };
      if (opts.json) printJson(payload);
      else {
        console.log(`${opts.apply ? 'Removed' : 'Would remove'}:`);
        for (const target of targets) console.log(`  ${target}`);
        if (!opts.apply) console.log('Pass --apply to remove these files.');
      }
    });
}
