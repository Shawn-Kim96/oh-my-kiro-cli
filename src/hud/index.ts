import { splitPane, killPane, runTmux } from '../team/tmux-session.js';

export const HUD_HEIGHT_LINES = 6;

export function startHud(teamName: string, _stateRoot: string): string {
  const cmd = `kch hud --watch --team ${teamName}`;
  const paneId = splitPane({
    direction: 'v',
    command: cmd,
  });
  // Resize to fixed height
  runTmux(['resize-pane', '-t', paneId, '-y', String(HUD_HEIGHT_LINES)]);
  return paneId;
}

export function stopHud(paneId: string): void {
  killPane(paneId);
}

export function registerResizeHook(teamName: string, hudPaneId: string, tmuxTarget: string): string {
  const hookName = `kch-resize-${teamName}`;
  runTmux([
    'set-hook', '-t', tmuxTarget,
    'after-resize-pane',
    `resize-pane -t ${hudPaneId} -y ${HUD_HEIGHT_LINES}`,
  ]);
  return hookName;
}

export function unregisterResizeHook(_hookName: string, tmuxTarget: string): void {
  runTmux(['set-hook', '-u', '-t', tmuxTarget, 'after-resize-pane']);
}
