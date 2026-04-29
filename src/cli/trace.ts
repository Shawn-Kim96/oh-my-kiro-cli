import { Command } from 'commander';
import { readEvents } from '../team/state.js';
import { latestTeamName } from './team-select.js';

export function traceCommand(): Command {
  return new Command('trace')
    .argument('[team-name]', 'Team name (latest if omitted)')
    .option('--json', 'Output as JSON')
    .action(async (teamName: string | undefined, opts: { json?: boolean }) => {
      let name = teamName;
      if (!name) {
        const latest = await latestTeamName();
        if (!latest) {
          console.log('No teams found.');
          return;
        }
        name = latest;
      }
      if (!name) return;

      const events = await readEvents(name);
      if (opts.json) {
        console.log(JSON.stringify({ team: name, events }, null, 2));
        return;
      }

      console.log(`Trace: ${name}`);
      for (const event of events) {
        console.log(`${event.timestamp}  ${event.type}  ${JSON.stringify(event.data)}`);
      }
    });
}
