import { Command } from 'commander';
import { existsSync } from 'fs';
import { readFile, readdir } from 'fs/promises';
import { basename, join } from 'path';
import { homedir } from 'os';
import { printJson } from '../utils/json.js';

interface SessionSummary {
  id: string;
  path: string;
  messages: number;
  firstPrompt: string | null;
  updatedAt: string | null;
}

function sessionsDir(): string {
  return join(homedir(), '.kiro', 'sessions', 'cli');
}

function sessionIdFromPath(path: string): string {
  return basename(path).replace(/\.jsonl?$/, '');
}

async function sessionFiles(): Promise<string[]> {
  const dir = sessionsDir();
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map(entry => join(dir, entry.name))
    .sort();
}

function textFromRecord(record: unknown): string {
  const seen = new Set<unknown>();
  const chunks: string[] = [];
  function visit(value: unknown): void {
    if (value === null || value === undefined) return;
    if (typeof value === 'string') {
      if (value.trim()) chunks.push(value);
      return;
    }
    if (typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    for (const item of Object.values(value as Record<string, unknown>)) visit(item);
  }
  visit(record);
  return chunks.join('\n');
}

async function summarizeSession(path: string): Promise<SessionSummary> {
  const content = await readFile(path, 'utf-8');
  const lines = content.split(/\r?\n/).filter(Boolean);
  let firstPrompt: string | null = null;
  let updatedAt: string | null = null;
  for (const line of lines) {
    try {
      const record = JSON.parse(line) as Record<string, unknown>;
      const text = textFromRecord(record);
      if (!firstPrompt && record['kind'] === 'Prompt') firstPrompt = text.slice(0, 160);
      const timestamp = text.match(/\b20\d\d-\d\d-\d\dT[^\s"]+/)?.[0];
      if (timestamp) updatedAt = timestamp;
    } catch { /* skip malformed line */ }
  }
  return { id: sessionIdFromPath(path), path, messages: lines.length, firstPrompt, updatedAt };
}

export function sessionCommand(): Command {
  const command = new Command('session')
    .description('Search Kiro CLI session transcripts');

  command
    .command('list')
    .option('--json', 'Print JSON')
    .action(async (opts: { json?: boolean }) => {
      const sessions = await Promise.all((await sessionFiles()).map(summarizeSession));
      if (opts.json) {
        printJson({ sessions });
        return;
      }
      if (!sessions.length) {
        console.log('No Kiro CLI sessions found.');
        return;
      }
      for (const session of sessions) {
        console.log(`${session.id} (${session.messages} records) ${session.firstPrompt ?? ''}`);
      }
    });

  command
    .command('search <query>')
    .option('--json', 'Print JSON')
    .action(async (query: string, opts: { json?: boolean }) => {
      const q = query.toLowerCase();
      const results: Array<SessionSummary & { matches: string[] }> = [];
      for (const file of await sessionFiles()) {
        const content = await readFile(file, 'utf-8');
        if (!content.toLowerCase().includes(q)) continue;
        const matches = content
          .split(/\r?\n/)
          .filter(line => line.toLowerCase().includes(q))
          .slice(0, 5)
          .map(line => {
            try { return textFromRecord(JSON.parse(line)).slice(0, 240); } catch { return line.slice(0, 240); }
          });
        results.push({ ...(await summarizeSession(file)), matches });
      }
      if (opts.json) printJson({ query, results });
      else {
        for (const result of results) {
          console.log(`${result.id}:`);
          for (const match of result.matches) console.log(`  ${match}`);
        }
      }
    });

  command
    .command('show <session-id>')
    .option('--json', 'Print parsed JSONL records')
    .action(async (sessionId: string, opts: { json?: boolean }) => {
      const file = (await sessionFiles()).find(path => sessionIdFromPath(path).startsWith(sessionId));
      if (!file) throw new Error(`Session not found: ${sessionId}`);
      const content = await readFile(file, 'utf-8');
      if (!opts.json) {
        for (const line of content.split(/\r?\n/).filter(Boolean)) {
          try { console.log(textFromRecord(JSON.parse(line))); } catch { console.log(line); }
        }
        return;
      }
      const records = content.split(/\r?\n/).filter(Boolean).map(line => {
        try { return JSON.parse(line) as unknown; } catch { return { raw: line }; }
      });
      printJson({ id: sessionIdFromPath(file), path: file, records });
    });

  return command;
}
