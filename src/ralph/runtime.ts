import {
  createInitialRalphState, transitionRalphPhase, isTerminalRalphPhase,
  type RalphState, type RalphEvidence,
} from './contract.js';
import { initRalphState, readRalphState, saveRalphState, appendRalphEvidence } from './persistence.js';
import {
  isTmuxAvailable, isInsideTmux, spawnWorkerPane, waitForWorkerReady,
  isPaneAlive, sendKeys, capturePane, killPane,
} from '../team/tmux-session.js';
import { resolveAgent } from '../config/agent-mapping.js';
import { sleep } from '../utils/sleep.js';
import { notify, loadNotificationConfig } from '../notifications/notifier.js';

function slugify(task: string): string {
  const base = task.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20);
  return `${base || 'ralph'}-${String(Date.now()).slice(-6)}`;
}

export async function startRalph(options: {
  task: string;
  cwd: string;
  maxIterations?: number;
  maxFixAttempts?: number;
  linkedTeam?: string;
}): Promise<void> {
  if (!isTmuxAvailable()) {
    console.error('Error: tmux is not installed or not in PATH');
    process.exitCode = 1;
    return;
  }
  if (!isInsideTmux()) {
    console.error('Error: must be running inside a tmux session');
    process.exitCode = 1;
    return;
  }

  const slug = slugify(options.task);
  const state = createInitialRalphState(options.task, {
    maxIterations: options.maxIterations,
    maxFixAttempts: options.maxFixAttempts,
    linkedTeam: options.linkedTeam,
  });

  await initRalphState(slug, state);
  console.log(`Ralph session: ${slug}`);
  console.log(`Task: ${options.task}`);
  console.log(`Max iterations: ${state.max_iterations}, Max fix attempts: ${state.max_fix_attempts}`);

  const agent = resolveAgent('kiro');
  const paneId = spawnWorkerPane({
    teamName: `ralph-${slug}`,
    workerName: 'ralph-worker',
    agent,
    cwd: options.cwd,
    direction: 'h',
  });

  console.log('Waiting for worker to be ready...');
  const ready = await waitForWorkerReady(paneId, { timeoutMs: 60000 });
  if (!ready) {
    console.error('Worker did not become ready in time');
    killPane(paneId);
    process.exitCode = 1;
    return;
  }

  // Transition to executing and send initial task
  let current = transitionRalphPhase(state, 'executing');
  await saveRalphState(slug, current);

  const initialPrompt = [
    `You are Ralph — a persistent verification agent.`,
    `Task: ${options.task}`,
    ``,
    `Execute the task, then verify it works. If verification fails, fix and re-verify.`,
    `When done, write RALPH_COMPLETE to signal success.`,
    `If you cannot fix it, write RALPH_FAILED.`,
  ].join('\n');

  sendKeys(paneId, initialPrompt);
  console.log('Task sent. Monitoring...\n');

  const notifConfig = await loadNotificationConfig();
  const pollMs = 5000;

  // Monitor loop
  while (!isTerminalRalphPhase(current.current_phase)) {
    if (!isPaneAlive(paneId)) {
      console.log('Worker pane died. Marking failed.');
      current = transitionRalphPhase(current, 'failed', 'pane_died');
      await saveRalphState(slug, current);
      break;
    }

    current.iteration++;
    if (current.iteration > current.max_iterations) {
      console.log(`Max iterations (${current.max_iterations}) exceeded.`);
      current = transitionRalphPhase(current, 'failed', 'max_iterations');
      await saveRalphState(slug, current);
      break;
    }

    const output = capturePane(paneId, 100);
    const evidence: RalphEvidence = {
      phase: current.current_phase,
      iteration: current.iteration,
      command: 'capture',
      output: output.slice(-500),
      pass: false,
      timestamp: new Date().toISOString(),
    };

    if (output.includes('RALPH_COMPLETE')) {
      evidence.pass = true;
      await appendRalphEvidence(slug, evidence);
      current = transitionRalphPhase(current, 'complete');
      await saveRalphState(slug, current);
      console.log('✓ Ralph completed successfully.');
      break;
    }

    if (output.includes('RALPH_FAILED')) {
      await appendRalphEvidence(slug, evidence);
      current = transitionRalphPhase(current, 'failed', 'agent_signaled');
      await saveRalphState(slug, current);
      console.log('✗ Ralph reported failure.');
      break;
    }

    // Phase inference from output
    if (current.current_phase === 'executing' && (output.includes('verify') || output.includes('test'))) {
      current = transitionRalphPhase(current, 'verifying');
    } else if (current.current_phase === 'verifying' && output.includes('FAIL')) {
      current = transitionRalphPhase(current, 'fixing');
      if (isTerminalRalphPhase(current.current_phase)) {
        // max fix attempts exceeded
        await saveRalphState(slug, current);
        console.log('✗ Max fix attempts exceeded.');
        break;
      }
    } else if (current.current_phase === 'fixing' && output.includes('PASS')) {
      evidence.pass = true;
      current = transitionRalphPhase(current, 'verifying');
    }

    await appendRalphEvidence(slug, evidence);
    await saveRalphState(slug, current);

    if (current.iteration % 10 === 0) {
      console.log(`  [ralph] iteration ${current.iteration}, phase: ${current.current_phase}`);
    }

    await sleep(pollMs);
  }

  // Final report
  const final = await readRalphState(slug) ?? current;
  console.log(`\nRalph ${slug} finished: ${final.current_phase}`);
  console.log(`  Iterations: ${final.iteration}`);
  console.log(`  Fix attempts: ${final.fix_attempts}`);
  console.log(`  Evidence entries: ${final.evidence.length}`);

  await notify({
    title: `Ralph ${final.current_phase}`,
    message: `Task: ${final.task_description}\nIterations: ${final.iteration}`,
    type: final.current_phase === 'complete' ? 'success' : 'error',
  }, notifConfig);

  // Cleanup pane
  try { killPane(paneId); } catch { /* ignore */ }
}
