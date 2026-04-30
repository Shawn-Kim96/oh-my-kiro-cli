import { Command } from 'commander';
import { runDoctor } from './doctor.js';
import { apiCommand } from './api.js';
import { statusCommand } from './status.js';
import { shutdownCommand } from './shutdown.js';
import { cancelCommand } from './cancel.js';
import { runSetup } from './setup.js';
import { runCleanup } from './cleanup.js';
import { traceCommand } from './trace.js';
import { exploreCommand } from './explore.js';
import { listCommand } from './list.js';
import { versionCommand } from './version.js';
import { stateCommand } from './state.js';
import { notepadCommand } from './notepad.js';
import { projectMemoryCommand } from './project-memory.js';
import { wikiCommand } from './wiki.js';
import { deepInterviewCommand } from './deep-interview.js';
import { researchCommand } from './research.js';
import { reasoningCommand } from './reasoning.js';
import { startTeam, startTeamDetached, resumeTeam } from '../team/runtime.js';
import { scaleUp, scaleDown } from '../team/scaling.js';
import { parseSpec } from '../config/agent-mapping.js';
import { collectHudState } from '../hud/state.js';
import { renderHud } from '../hud/render.js';
import { ktStateDir } from '../utils/paths.js';
import { sleep } from '../utils/sleep.js';
import { resolveAvailableAgentTypes, buildFollowupStaffingPlan } from '../team/followup-planner.js';
import type { FollowupMode } from '../team/followup-planner.js';
import { startRalph } from '../ralph/runtime.js';
import { notify, loadNotificationConfig } from '../notifications/notifier.js';

const program = new Command()
  .name('kch')
  .description('kiro-cli-hive — multi-agent orchestrator for kiro-cli')
  .version('0.1.0');

program
  .command('team [spec]')
  .argument('<task>')
  .description('Launch a team of agents to work on a task')
  .option('--cwd <dir>', 'Working directory', process.cwd())
  .option('--cleanup', 'Remove team state after completion')
  .option('--worktree [branch]', 'Use git worktrees for worker isolation')
  .option('--merge-worktrees', 'Merge/cherry-pick worker worktree changes after completion')
  .option('--detach', 'Start team in background, return team name immediately')
  .action(async (spec: string | undefined, task: string, opts: { cwd: string; cleanup?: boolean; worktree?: boolean | string; mergeWorktrees?: boolean; detach?: boolean }) => {
    const { workerCount, agentType } = parseSpec(spec);
    const explicitAgentType = spec !== undefined && spec.includes(':');
    const explicitWorkerCount = spec !== undefined && /^\d/.test(spec);
    let worktreeMode: import('../team/worktree.js').WorktreeMode = { enabled: false };
    if (opts.worktree !== undefined && opts.worktree !== false) {
      if (typeof opts.worktree === 'string') {
        worktreeMode = { enabled: true, detached: false, name: opts.worktree };
      } else {
        worktreeMode = { enabled: true, detached: true, name: null };
      }
    }
    if (opts.detach) {
      await startTeamDetached({ workerCount, agentType, task, cwd: opts.cwd, worktreeMode, mergeWorktrees: Boolean(opts.mergeWorktrees), explicitAgentType, explicitWorkerCount });
    } else {
      await startTeam({ workerCount, agentType, task, cwd: opts.cwd, cleanup: opts.cleanup, worktreeMode, mergeWorktrees: Boolean(opts.mergeWorktrees), explicitAgentType, explicitWorkerCount });
    }
  });

program.addCommand(statusCommand());
program.addCommand(shutdownCommand());
program.addCommand(cancelCommand());
program.addCommand(apiCommand);
program.addCommand(traceCommand());
program.addCommand(exploreCommand());
program.addCommand(listCommand());
program.addCommand(versionCommand());
program.addCommand(stateCommand());
program.addCommand(notepadCommand());
program.addCommand(projectMemoryCommand());
program.addCommand(wikiCommand());
program.addCommand(deepInterviewCommand());
program.addCommand(researchCommand('research'));
program.addCommand(researchCommand('autoresearch'));
program.addCommand(researchCommand('deep-research'));
program.addCommand(reasoningCommand());

program
  .command('setup')
  .description('Prepare kch state directories')
  .option('--dry-run', 'Show planned setup changes without writing')
  .action(async (opts: { dryRun?: boolean }) => {
    await runSetup({ dryRun: opts.dryRun });
  });

program
  .command('cleanup')
  .description('Clean stale kch runtime artifacts')
  .option('--dry-run', 'Show planned cleanup without deleting', true)
  .option('--apply', 'Apply cleanup changes')
  .action(async (opts: { dryRun?: boolean; apply?: boolean }) => {
    await runCleanup({ dryRun: opts.dryRun, apply: opts.apply });
  });

program
  .command('hud')
  .description('Launch the HUD dashboard')
  .option('--watch', 'Continuous update')
  .option('--team <name>', 'Team name')
  .option('--interval <ms>', 'Update interval in ms', '2000')
  .action(async (options: { watch?: boolean; team?: string; interval?: string }) => {
    const teamName = options.team;
    if (!teamName) {
      console.error('Error: --team is required');
      process.exitCode = 1;
      return;
    }
    const interval = parseInt(options.interval ?? '2000', 10);
    const stateRoot = ktStateDir();

    if (options.watch) {
      while (true) {
        const state = await collectHudState(teamName, stateRoot);
        process.stdout.write('\x1B[2J\x1B[H');
        process.stdout.write(renderHud(state));
        await sleep(interval);
      }
    } else {
      const state = await collectHudState(teamName, stateRoot);
      process.stdout.write(renderHud(state));
    }
  });

program
  .command('scale-up <team> <count>')
  .description('Add workers to a team')
  .option('--role <role>', 'Agent role for new workers')
  .action(async (team: string, countStr: string, opts: { role?: string }) => {
    const count = Math.max(1, parseInt(countStr, 10) || 1);
    const stateRoot = ktStateDir();
    try {
      const result = await scaleUp(team, count, stateRoot, { agentType: opts.role });
      console.log(`Added ${result.addedWorkers.length} workers: ${result.addedWorkers.map(w => w.name).join(', ')}`);
      console.log(`Total workers: ${result.newWorkerCount}`);
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    }
  });

program
  .command('scale-down <team> <worker>')
  .description('Remove a worker from a team')
  .action(async (team: string, worker: string) => {
    const stateRoot = ktStateDir();
    try {
      const result = await scaleDown(team, [worker], stateRoot);
      console.log(`Removed: ${result.removedWorkers.join(', ')}`);
      console.log(`Remaining workers: ${result.newWorkerCount}`);
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    }
  });

program
  .command('resume <team-name>')
  .description('Resume a paused team')
  .action(async (teamName: string) => {
    const stateRoot = ktStateDir();
    try {
      await resumeTeam(teamName, stateRoot);
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    }
  });

program
  .command('doctor')
  .description('Check environment prerequisites')
  .action(async () => {
    console.log('kch doctor — checking environment...\n');
    const code = await runDoctor();
    process.exitCode = code;
  });

program
  .command('plan <task>')
  .description('Generate a staffing plan for a task')
  .option('--workers <n>', 'Number of workers', '2')
  .option('--mode <mode>', 'Execution mode: team or verify', 'team')
  .action(async (task: string, opts: { workers: string; mode: string }) => {
    const workerCount = Math.max(1, parseInt(opts.workers, 10) || 2);
    const mode: FollowupMode = opts.mode === 'verify' ? 'verify' : 'team';
    const cwd = process.cwd();

    try {
      const available = await resolveAvailableAgentTypes(cwd);
      const plan = buildFollowupStaffingPlan(mode, task, available, { workerCount });

      console.log(`\n📋 Staffing Plan: ${task}\n`);
      console.log(`Mode: ${plan.mode}`);
      console.log(`Headcount: ${plan.recommendedHeadcount}`);
      console.log(`Available roles: ${plan.rosterSummary}\n`);

      console.log('Allocations:');
      for (const a of plan.allocations) {
        const effort = a.reasoningEffort ? ` [${a.reasoningEffort}]` : '';
        console.log(`  ${a.role} ×${a.count} — ${a.reason}${effort}`);
      }

      console.log(`\nVerification: ${plan.verificationPlan.summary}`);
      for (const cp of plan.verificationPlan.checkpoints) {
        console.log(`  • ${cp}`);
      }

      console.log(`\n🚀 Launch command:`);
      console.log(`  ${plan.launchHints.shellCommand}`);
      console.log(`\n  ${plan.launchHints.rationale}`);
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    }
  });

program
  .command('ralph <task>')
  .description('Start a persistent verification lifecycle (execute → verify → fix → complete)')
  .option('--cwd <dir>', 'Working directory', process.cwd())
  .option('--max-iterations <n>', 'Maximum iterations', '50')
  .option('--max-fix-attempts <n>', 'Maximum fix attempts', '5')
  .option('--linked-team <name>', 'Link to a team name')
  .action(async (task: string, opts: { cwd: string; maxIterations: string; maxFixAttempts: string; linkedTeam?: string }) => {
    await startRalph({
      task,
      cwd: opts.cwd,
      maxIterations: parseInt(opts.maxIterations, 10),
      maxFixAttempts: parseInt(opts.maxFixAttempts, 10),
      linkedTeam: opts.linkedTeam,
    });
  });

program
  .command('notify <message>')
  .description('Send a manual notification via configured channels')
  .option('--type <type>', 'Notification type: info, success, warning, error', 'info')
  .option('--title <title>', 'Notification title', 'kch notification')
  .action(async (message: string, opts: { type: string; title: string }) => {
    const config = await loadNotificationConfig();
    if (!config) {
      console.error(`No notification config found. Create ${ktStateDir()}/notifications.json`);
      process.exitCode = 1;
      return;
    }
    const validTypes = ['info', 'success', 'warning', 'error'] as const;
    const type = validTypes.includes(opts.type as typeof validTypes[number])
      ? (opts.type as typeof validTypes[number])
      : 'info';
    await notify({ title: opts.title, message, type }, config);
    console.log('Notification sent.');
  });

program
  .command('mcp-server <name>')
  .description('Start an MCP server (team or state)')
  .action(async (name: string) => {
    if (name === 'team') {
      await import('../mcp/team-server.js');
    } else if (name === 'state') {
      await import('../mcp/state-server.js');
    } else {
      console.error(`Unknown MCP server: ${name}. Available: team, state`);
      process.exitCode = 1;
    }
  });

program
  .command('send <team> <worker> <message>')
  .description('Send a message to a running worker')
  .action(async (team: string, worker: string, message: string) => {
    const { readTeamConfig, sendMessage } = await import('../team/state.js');
    const { sendKeys, capturePane, paneLooksReady } = await import('../team/tmux-session.js');
    const config = await readTeamConfig(team);
    if (!config) { console.error(`Team not found: ${team}`); process.exitCode = 1; return; }
    const w = config.workers.find(w => w.name === worker);
    if (!w) { console.error(`Worker not found: ${worker}. Available: ${config.workers.map(w => w.name).join(', ')}`); process.exitCode = 1; return; }
    if (!w.pane_id) { console.error(`Worker ${worker} has no pane`); process.exitCode = 1; return; }

    // Save to mailbox
    await sendMessage(team, 'leader', worker, message);

    // Trigger worker to check mailbox
    sendKeys(w.pane_id, message);
    console.log(`Message sent to ${worker} in team ${team}`);
  });

program.parse();
