import { spawnSync } from 'child_process';
import { execFile } from 'child_process';
import { ktStateDir } from '../utils/paths.js';
import { sleep } from '../utils/sleep.js';
import { resolveKiroCliCommand, shellEnvAssignment, shellQuote } from '../utils/kiro-cli.js';
import { resolveModelConfig, resolveWorkerModelFlags } from '../config/models.js';

// ── Result types ──

type TmuxOk = { ok: true; stdout: string };
type TmuxErr = { ok: false; stderr: string };
type TmuxResult = TmuxOk | TmuxErr;

// ── Low-level wrappers ──

export function runTmux(args: string[]): TmuxResult {
  const result = spawnSync('tmux', args, { encoding: 'utf-8' });
  if (result.error) return { ok: false, stderr: result.error.message };
  if (result.status !== 0) return { ok: false, stderr: (result.stderr || '').trim() };
  return { ok: true, stdout: (result.stdout || '').trim() };
}

export function runTmuxAsync(args: string[]): Promise<TmuxResult> {
  return new Promise(resolve => {
    execFile('tmux', args, { encoding: 'utf-8' }, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, stderr: stderr?.trim() || error.message });
        return;
      }
      resolve({ ok: true, stdout: (stdout || '').trim() });
    });
  });
}

export function isTmuxAvailable(): boolean {
  const result = spawnSync('tmux', ['-V'], { encoding: 'utf-8' });
  return !result.error && result.status === 0;
}

export function isInsideTmux(): boolean {
  return !!process.env['TMUX'];
}

// ── Pane info ──

export interface TmuxPaneInfo {
  paneId: string;
  currentCommand: string;
  startCommand: string;
  isDead: boolean;
  pid: number;
}

export function listPanes(target: string): TmuxPaneInfo[] {
  const fmt = '#{pane_id}\t#{pane_current_command}\t#{pane_start_command}\t#{pane_dead}\t#{pane_pid}';
  const result = runTmux(['list-panes', '-t', target, '-F', fmt]);
  if (!result.ok) return [];
  return result.stdout.split('\n').filter(Boolean).map(line => {
    const [paneId, currentCommand, startCommand, dead, pid] = line.split('\t');
    return {
      paneId: paneId ?? '',
      currentCommand: currentCommand ?? '',
      startCommand: startCommand ?? '',
      isDead: dead === '1',
      pid: parseInt(pid ?? '0', 10),
    };
  });
}

// ── Pane management ──

export function splitPane(options: {
  direction: 'h' | 'v';
  command: string;
  cwd?: string;
  targetPane?: string;
}): string {
  const args = ['split-window', `-${options.direction}`, '-P', '-F', '#{pane_id}'];
  if (options.cwd) args.push('-c', options.cwd);
  if (options.targetPane) args.push('-t', options.targetPane);
  args.push(options.command);
  const result = runTmux(args);
  if (!result.ok) throw new Error(`split-pane failed: ${result.stderr}`);
  return result.stdout.trim();
}

export function killPane(paneId: string): void {
  runTmux(['kill-pane', '-t', paneId]);
}

export function capturePane(paneId: string, lines = 80): string {
  const result = runTmux(['capture-pane', '-t', paneId, '-p', '-S', `-${lines}`]);
  if (!result.ok) return '';
  return result.stdout;
}

export function sendKeys(paneId: string, text: string): void {
  const result = runTmux(['send-keys', '-t', paneId, text, 'C-m']);
  if (!result.ok) throw new Error(`send-keys failed: ${result.stderr}`);
}

export function isPaneAlive(paneId: string): boolean {
  const fmt = '#{pane_id}\t#{pane_dead}\t#{pane_pid}';
  const result = runTmux(['list-panes', '-a', '-F', fmt]);
  if (!result.ok) return false;
  for (const line of result.stdout.split('\n')) {
    const [id, dead, pidStr] = line.split('\t');
    if (id === paneId) {
      if (dead === '1') return false;
      const pid = parseInt(pidStr ?? '0', 10);
      if (pid <= 0) return false;
      try { process.kill(pid, 0); return true; } catch { return false; }
    }
  }
  return false;
}

export function getWorkerPanePid(paneId: string): number | null {
  const fmt = '#{pane_id}\t#{pane_pid}';
  const result = runTmux(['list-panes', '-a', '-F', fmt]);
  if (!result.ok) return null;
  for (const line of result.stdout.split('\n')) {
    const [id, pidStr] = line.split('\t');
    if (id === paneId) {
      const pid = parseInt(pidStr ?? '0', 10);
      return pid > 0 ? pid : null;
    }
  }
  return null;
}

export function displayMessage(message: string): void {
  runTmux(['display-message', message]);
}

// ── Readiness detection ──

export function paneLooksReady(capture: string): boolean {
  const lower = capture.toLowerCase();
  if (lower.includes('ask a question or describe a task')) return true;

  const lines = capture.split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) return false;
  const lastLine = lines[lines.length - 1] ?? '';
  // kiro-cli prompt patterns vary by agent:
  // Old UI: "[yolo-general] 9% λ !>" or "[yolo-general] 7% !>"
  // New TUI: "ask a question or describe a task"
  return lastLine.includes('λ') || lastLine.includes('!>') || lastLine.includes('λ !>');
}

export function paneIsBootstrapping(capture: string): boolean {
  const lower = capture.toLowerCase();
  const hasBootstrap = lower.includes('mcp servers') || lower.includes('hooks finished') || lower.includes('welcome to kiro');
  return hasBootstrap && !paneLooksReady(capture);
}

export function paneHasActiveTask(capture: string): boolean {
  const lines = capture.split('\n');
  let lastPromptIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? '';
    if (line.includes('λ') || line.includes('!>')) { lastPromptIdx = i; break; }
  }
  if (lastPromptIdx < 0) return false;
  for (let i = lastPromptIdx + 1; i < lines.length; i++) {
    if ((lines[i] ?? '').includes('▸')) return true;
  }
  return false;
}

export async function dismissTrustPrompt(paneId: string): Promise<void> {
  const capture = capturePane(paneId);
  const lower = capture.toLowerCase();

  // kiro-cli trust-all-tools consent prompt: arrow-key selection UI
  // Options: "No, exit" (default) / "Yes, I accept" / "Yes, and don't ask again"
  // Navigate down twice to "Yes, and don't ask again", then Enter
  if (lower.includes('trust') || lower.includes('permission') || lower.includes('don\'t ask again') || lower.includes('i accept')) {
    runTmux(['send-keys', '-t', paneId, 'Down']);
    await sleep(200);
    runTmux(['send-keys', '-t', paneId, 'Down']);
    await sleep(200);
    runTmux(['send-keys', '-t', paneId, 'Enter']);
    await sleep(1000);
  }

  // Also handle any y/n confirmation prompts
  const afterCapture = capturePane(paneId).toLowerCase();
  if (afterCapture.includes('(y/n)') || afterCapture.includes('[y/n]')) {
    runTmux(['send-keys', '-t', paneId, 'y', 'C-m']);
    await sleep(500);
  }
}

export async function waitForWorkerReady(
  paneId: string,
  options?: { timeoutMs?: number; pollMs?: number },
): Promise<boolean> {
  const timeout = options?.timeoutMs ?? 45000;
  const poll = options?.pollMs ?? 1000;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const capture = capturePane(paneId);

    // Handle trust prompts and consent screens
    const lower = capture.toLowerCase();
    if (lower.includes('trust') || lower.includes('permission') || lower.includes('don\'t ask again') || lower.includes('i accept') || lower.includes('no, exit')) {
      await dismissTrustPrompt(paneId);
    }

    if (paneLooksReady(capture) && !paneHasActiveTask(capture)) {
      return true;
    }

    await sleep(poll);
  }
  return false;
}

// ── Worker pane lifecycle ──

export interface SpawnWorkerOptions {
  teamName: string;
  workerName: string;
  agent: string;
  cwd: string;
  direction: 'h' | 'v';
  targetPane?: string;
  env?: Record<string, string>;
}

export function spawnWorkerPane(options: SpawnWorkerOptions): string {
  const stateRoot = ktStateDir();
  const envParts = [
    shellEnvAssignment('KT_TEAM', options.teamName),
    shellEnvAssignment('KT_WORKER', options.workerName),
    shellEnvAssignment('KCH_STATE_ROOT', stateRoot),
    shellEnvAssignment('KT_STATE_ROOT', stateRoot),
    shellEnvAssignment('KH_STATE_ROOT', stateRoot),
  ];
  if (options.env) {
    for (const [k, v] of Object.entries(options.env)) {
      envParts.push(shellEnvAssignment(k, v));
    }
  }
  const modelFlags = resolveWorkerModelFlags(options.agent, resolveModelConfig()).map(shellQuote);
  const launchParts = [
    shellQuote(resolveKiroCliCommand()),
    'chat',
    '--trust-all-tools',
    ...modelFlags,
    '--agent',
    shellQuote(options.agent),
  ];
  const cmd = `${envParts.join(' ')} ${launchParts.join(' ')}`;
  return splitPane({
    direction: options.direction,
    command: cmd,
    cwd: options.cwd,
    targetPane: options.targetPane,
  });
}

// ── Pane layout ──

export function computePaneLayout(workerCount: number): Array<{ direction: 'h' | 'v'; targetPane?: string }> {
  if (workerCount <= 0) return [];
  if (workerCount === 1) return [{ direction: 'h' }];
  if (workerCount === 2) return [{ direction: 'h' }, { direction: 'v' }];
  // 3-4: 2x2 grid
  if (workerCount <= 4) {
    const layout: Array<{ direction: 'h' | 'v'; targetPane?: string }> = [{ direction: 'h' }];
    // split leader pane vertically, then split right pane vertically
    for (let i = 1; i < workerCount; i++) {
      layout.push({ direction: 'v' });
    }
    return layout;
  }
  // 5+: leader left, workers stacked right
  const layout: Array<{ direction: 'h' | 'v'; targetPane?: string }> = [{ direction: 'h' }];
  for (let i = 1; i < workerCount; i++) {
    layout.push({ direction: 'v' });
  }
  return layout;
}

// ── Team session ──

export interface TeamSession {
  name: string;
  workerCount: number;
  cwd: string;
  workerPaneIds: string[];
  leaderPaneId: string;
  hudPaneId: string | null;
}

export async function createTeamSession(options: {
  teamName: string;
  workerCount: number;
  workers: Array<{ name: string; agent: string; cwd?: string }>;
  cwd: string;
  stateRoot: string;
}): Promise<TeamSession> {
  // Get current pane as leader
  const leaderResult = runTmux(['display-message', '-p', '#{pane_id}']);
  if (!leaderResult.ok) throw new Error(`Cannot get leader pane: ${leaderResult.stderr}`);
  const leaderPaneId = leaderResult.stdout.trim();

  const layout = computePaneLayout(options.workerCount);
  const workerPaneIds: string[] = [];

  for (let i = 0; i < options.workers.length; i++) {
    const worker = options.workers[i];
    const step = layout[i];
    if (!worker || !step) continue;

    // For 2-worker layout: second worker splits from first worker pane
    // For 3-4 worker (2x2): alternate splits between leader and first worker
    // For 5+: all workers after first split from previous worker pane
    let targetPane: string | undefined;
    if (i === 0) {
      targetPane = leaderPaneId;
    } else if (options.workerCount === 2) {
      // Split the right pane (first worker) vertically
      targetPane = workerPaneIds[0];
    } else if (options.workerCount <= 4) {
      // 2x2 grid: second splits leader vertically, third+ split from existing
      if (i === 1) targetPane = leaderPaneId;
      else if (i === 2) targetPane = workerPaneIds[0];
      else targetPane = workerPaneIds[1];
    } else {
      // 5+: all after first stack on the right (split from previous worker)
      targetPane = workerPaneIds[i - 1];
    }

    const paneId = spawnWorkerPane({
      teamName: options.teamName,
      workerName: worker.name,
      agent: worker.agent,
      cwd: worker.cwd ?? options.cwd,
      direction: step.direction,
      targetPane,
    });
    workerPaneIds.push(paneId);
  }

  // Wait for all workers to be ready (parallel, partial start allowed)
  const readyResults = await Promise.allSettled(
    workerPaneIds.map(id => waitForWorkerReady(id)),
  );

  for (let i = 0; i < readyResults.length; i++) {
    const r = readyResults[i];
    if (r && (r.status === 'rejected' || (r.status === 'fulfilled' && !r.value))) {
      const name = options.workers[i]?.name ?? `worker-${i}`;
      displayMessage(`Warning: ${name} did not become ready in time`);
    }
  }

  return {
    name: options.teamName,
    workerCount: options.workerCount,
    cwd: options.cwd,
    workerPaneIds,
    leaderPaneId,
    hudPaneId: null,
  };
}

export async function teardownTeamSession(session: TeamSession): Promise<void> {
  for (const paneId of session.workerPaneIds) {
    try { killPane(paneId); } catch { /* pane may already be dead */ }
  }
  if (session.hudPaneId) {
    try { killPane(session.hudPaneId); } catch { /* ignore */ }
  }
}
