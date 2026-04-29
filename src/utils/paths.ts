import { join } from 'path';
import { homedir } from 'os';

export function ktStateDir(): string { return join(homedir(), '.kt'); }
export function ktTeamDir(teamName: string): string { return join(ktStateDir(), 'teams', teamName); }
export function ktWorkerDir(teamName: string, workerName: string): string { return join(ktTeamDir(teamName), 'workers', workerName); }
export function ktLogsDir(): string { return join(ktStateDir(), 'logs'); }
export function ktWikiDir(namespace: string): string { return join(ktStateDir(), 'wiki', namespace); }
