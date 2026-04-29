import { accessSync, constants } from 'fs';
import { delimiter, join } from 'path';
import { homedir } from 'os';

function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findOnPath(command: string): string | null {
  const pathEnv = process.env['PATH'] ?? '';
  for (const segment of pathEnv.split(delimiter)) {
    if (!segment) continue;
    const candidate = join(segment, command);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

export function resolveKiroCliCommand(): string {
  const configured =
    process.env['KCH_KIRO_CLI']?.trim() ||
    process.env['KIRO_CLI']?.trim();
  if (configured) return expandHome(configured);

  const onPath = findOnPath('kiro-cli');
  if (onPath) return onPath;

  const localInstall = join(homedir(), '.local', 'bin', 'kiro-cli');
  if (isExecutable(localInstall)) return localInstall;

  return 'kiro-cli';
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function shellEnvAssignment(key: string, value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new Error(`Invalid environment variable name: ${key}`);
  }
  return `${key}=${shellQuote(value)}`;
}
