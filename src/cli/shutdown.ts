import { Command } from 'commander';
import { readTeamConfig } from '../team/state.js';
import { gracefulShutdown } from '../team/runtime.js';
import type { TeamSession } from '../team/tmux-session.js';

export function shutdownCommand(): Command {
  return new Command('shutdown')
    .argument('<team-name>', 'Team name to shut down')
    .option('--force', 'Skip ACK wait, kill immediately')
    .action(async (teamName: string, opts: { force?: boolean }) => {
      const config = await readTeamConfig(teamName);
      if (!config) {
        console.error(`Team not found: ${teamName}`);
        process.exitCode = 1;
        return;
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
        reason: 'cli_shutdown',
        force: opts.force,
      });
    });
}
