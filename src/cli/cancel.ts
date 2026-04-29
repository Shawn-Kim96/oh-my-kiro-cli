import { Command } from 'commander';
import { readTeamConfig } from '../team/state.js';
import { gracefulShutdown } from '../team/runtime.js';
import type { TeamSession } from '../team/tmux-session.js';
import { latestTeamName } from './team-select.js';

async function cancelTeam(teamName: string, force?: boolean): Promise<void> {
  const config = await readTeamConfig(teamName);
  if (!config) {
    throw new Error(`Team not found: ${teamName}`);
  }

  const session: TeamSession = {
    name: teamName,
    workerCount: config.worker_count,
    cwd: config.leader_cwd,
    workerPaneIds: config.workers.map(w => w.pane_id).filter((id): id is string => id !== null),
    leaderPaneId: config.leader_pane_id ?? '',
    hudPaneId: config.hud_pane_id,
  };

  await gracefulShutdown(teamName, session, config.team_state_root, {
    reason: 'cli_cancel',
    force,
  });
}

export function cancelCommand(): Command {
  return new Command('cancel')
    .argument('[team-name]', 'Team name to cancel')
    .option('--force', 'Skip ACK wait, kill immediately')
    .action(async (teamName: string | undefined, opts: { force?: boolean }) => {
      try {
        if (teamName) {
          await cancelTeam(teamName, opts.force);
          return;
        }

        const latest = await latestTeamName();
        if (!latest) {
          console.log('No teams found.');
          return;
        }

        await cancelTeam(latest, opts.force);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });
}
