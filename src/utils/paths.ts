import { join, resolve } from 'path';
import { homedir } from 'os';

function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

export function kchStateDir(): string {
  const raw =
    process.env['KCH_STATE_ROOT']?.trim() ||
    process.env['KT_STATE_ROOT']?.trim() ||
    process.env['KH_STATE_ROOT']?.trim();
  return raw ? resolve(expandHome(raw)) : join(homedir(), '.kch');
}

export function kchTeamDir(teamName: string): string { return join(kchStateDir(), 'teams', teamName); }
export function kchWorkerDir(teamName: string, workerName: string): string { return join(kchTeamDir(teamName), 'workers', workerName); }
export function kchLogsDir(): string { return join(kchStateDir(), 'logs'); }
export function kchWikiDir(namespace: string): string { return join(kchStateDir(), 'wiki', namespace); }
export function kchModeStateDir(): string { return join(kchStateDir(), 'state'); }
export function kchModeStatePath(mode: string): string { return join(kchModeStateDir(), `${mode}-state.json`); }
export function kchNotepadPath(): string { return join(kchStateDir(), 'notepad.md'); }
export function kchProjectMemoryPath(): string { return join(kchStateDir(), 'project-memory.json'); }
export function kchConfigPath(): string { return join(kchStateDir(), 'config.json'); }

// Compatibility exports: internal names remain kt* during migration.
export function ktStateDir(): string { return kchStateDir(); }
export function ktTeamDir(teamName: string): string { return kchTeamDir(teamName); }
export function ktWorkerDir(teamName: string, workerName: string): string { return kchWorkerDir(teamName, workerName); }
export function ktLogsDir(): string { return kchLogsDir(); }
export function ktWikiDir(namespace: string): string { return kchWikiDir(namespace); }
export function ktModeStateDir(): string { return kchModeStateDir(); }
export function ktModeStatePath(mode: string): string { return kchModeStatePath(mode); }
export function ktNotepadPath(): string { return kchNotepadPath(); }
export function ktProjectMemoryPath(): string { return kchProjectMemoryPath(); }
