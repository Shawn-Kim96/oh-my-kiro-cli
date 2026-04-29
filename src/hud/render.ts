import type { HudState } from './state.js';

// ANSI color helpers
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;

const STATUS_ICONS: Record<string, string> = {
  working: yellow('⚙'),
  idle: dim('◯'),
  blocked: magenta('⏳'),
  done: green('✓'),
  dead: red('✗'),
  failed: red('✗'),
  draining: cyan('↓'),
};

function statusIcon(state: string): string {
  return STATUS_ICONS[state] ?? dim('?');
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m${String(s).padStart(2, '0')}s`;
}

function workerSummary(w: { name: string; state: string; taskId: string | null }): string {
  const icon = statusIcon(w.state);
  const task = w.taskId ? ` (task-${w.taskId})` : '';
  return `${w.name}: ${icon} ${w.state}${task}`;
}

export function renderHud(state: HudState): string {
  const { teamName, phase, tasks, dispatch, mailbox, elapsed, workers } = state;

  const header = ` [kch] ${bold(teamName)} │ phase: ${cyan(phase)} │ tasks: ${tasks.completed}/${tasks.total} done │ ⏱ ${formatElapsed(elapsed)} `;
  const workerLine = ` ${workers.map(workerSummary).join(' │ ')} `;
  const statsLine = ` dispatch: ${dispatch.ok} ok, ${dispatch.failed} failed │ mailbox: ${mailbox.pending} pending `;

  const maxLen = Math.max(header.length, workerLine.length, statsLine.length, 60);
  // Use raw content width (strip ANSI for measurement)
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
  const contentWidth = Math.max(strip(header).length, strip(workerLine).length, strip(statsLine).length, 60);

  const pad = (s: string) => {
    const visible = strip(s).length;
    return s + ' '.repeat(Math.max(0, contentWidth - visible));
  };

  const top = `╔${'═'.repeat(contentWidth)}╗`;
  const bot = `╚${'═'.repeat(contentWidth)}╝`;

  return [
    top,
    `║${pad(header)}║`,
    `║${pad(workerLine)}║`,
    `║${pad(statsLine)}║`,
    bot,
    '',
  ].join('\n');
}
