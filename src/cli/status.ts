import { Command } from 'commander';
import { readTeamConfig, listTeams, listTasks, readWorkerStatus } from '../team/state.js';

export function statusCommand(): Command {
  return new Command('status')
    .argument('[team-name]', 'Team name (latest if omitted)')
    .option('--json', 'Output as JSON')
    .action(async (teamName: string | undefined, opts: { json?: boolean }) => {
      let name = teamName;
      if (!name) {
        const teams = await listTeams();
        if (teams.length === 0) {
          console.log('No teams found.');
          return;
        }
        teams.sort();
        name = teams[teams.length - 1];
      }
      if (!name) { console.log('No teams found.'); return; }

      const config = await readTeamConfig(name);
      if (!config) {
        console.error(`Team not found: ${name}`);
        process.exitCode = 1;
        return;
      }

      const tasks = await listTasks(name);
      const workerStatuses: Array<{ name: string; state: string; task: string | null }> = [];
      for (const w of config.workers) {
        const s = await readWorkerStatus(name, w.name);
        workerStatuses.push({ name: w.name, state: s?.state ?? 'unknown', task: s?.current_task_id ?? null });
      }

      if (opts.json) {
        console.log(JSON.stringify({ team: name, created_at: config.created_at, workers: workerStatuses, tasks }, null, 2));
        return;
      }

      console.log(`Team: ${name}`);
      console.log(`Created: ${config.created_at}`);
      console.log(`Task: ${config.task}\n`);

      console.log('Workers:');
      for (const ws of workerStatuses) {
        console.log(`  ${ws.name}  ${ws.state}${ws.task ? `  task-${ws.task}` : ''}`);
      }

      console.log('\nTasks:');
      for (const t of tasks) {
        console.log(`  task-${t.id}  [${t.status}]  ${t.subject}${t.owner ? `  (${t.owner})` : ''}`);
      }
    });
}
