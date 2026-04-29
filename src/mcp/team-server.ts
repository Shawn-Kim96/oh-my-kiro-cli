import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { autoStartStdioMcpServer } from './bootstrap.js';
import { WikiStore } from '../knowledge/wiki.js';

interface KtTeamJob {
  status: 'running' | 'completed' | 'failed';
  result?: string;
  stderr?: string;
  startedAt: number;
  pid?: number;
  teamName?: string;
  cwd?: string;
}

const jobs = new Map<string, KtTeamJob>();

function jobsDir(): string {
  return join(homedir(), '.kt', 'jobs');
}

function persistJob(jobId: string, job: KtTeamJob): void {
  try {
    const dir = jobsDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${jobId}.json`), JSON.stringify(job), 'utf-8');
  } catch { /* best-effort */ }
}

function loadJob(jobId: string): KtTeamJob | undefined {
  try {
    return JSON.parse(readFileSync(join(jobsDir(), `${jobId}.json`), 'utf-8')) as KtTeamJob;
  } catch {
    return undefined;
  }
}

function getJob(jobId: string): KtTeamJob | undefined {
  return jobs.get(jobId) ?? loadJob(jobId);
}

function createTeamServer(): Server {
  const server = new Server(
    { name: 'kt-team-server', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'kt_run_team_start',
        description: 'Spawn a kt team in the background. Returns jobId.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            spec: { type: 'string', description: 'Worker spec e.g. "3:kiro"' },
            task: { type: 'string', description: 'Task description' },
            cwd: { type: 'string', description: 'Working directory' },
          },
          required: ['task', 'cwd'],
        },
      },
      {
        name: 'kt_run_team_status',
        description: 'Check status of a background kt team job.',
        inputSchema: {
          type: 'object' as const,
          properties: { job_id: { type: 'string' } },
          required: ['job_id'],
        },
      },
      {
        name: 'kt_run_team_wait',
        description: 'Block until a kt team job completes or times out.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            job_id: { type: 'string' },
            timeout_ms: { type: 'number', description: 'Max wait ms (default 300000)' },
          },
          required: ['job_id'],
        },
      },
      {
        name: 'kt_run_team_cleanup',
        description: 'Kill worker panes for a kt team job.',
        inputSchema: {
          type: 'object' as const,
          properties: { job_id: { type: 'string' } },
          required: ['job_id'],
        },
      },
      {
        name: 'kt_wiki_get',
        description: 'Get a wiki entry by namespace and key.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            namespace: { type: 'string', description: 'Wiki namespace' },
            key: { type: 'string', description: 'Entry key' },
          },
          required: ['namespace', 'key'],
        },
      },
      {
        name: 'kt_wiki_set',
        description: 'Set a wiki entry by namespace and key.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            namespace: { type: 'string', description: 'Wiki namespace' },
            key: { type: 'string', description: 'Entry key' },
            value: { description: 'Value to store' },
          },
          required: ['namespace', 'key', 'value'],
        },
      },
      {
        name: 'kt_wiki_search',
        description: 'Search wiki entries by namespace and query.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            namespace: { type: 'string', description: 'Wiki namespace' },
            query: { type: 'string', description: 'Search query' },
          },
          required: ['namespace', 'query'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = (args ?? {}) as Record<string, unknown>;

    try {
      switch (name) {
        case 'kt_run_team_start': {
          const task = a['task'] as string;
          const cwd = a['cwd'] as string;
          const spec = (a['spec'] as string) ?? '2:kiro';
          const jobId = `kt-${Date.now().toString(36)}`;

          const job: KtTeamJob = { status: 'running', startedAt: Date.now(), cwd };
          jobs.set(jobId, job);

          const child = spawn('kt', ['team', spec, task, '--cwd', cwd], {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env },
          });
          job.pid = child.pid;
          persistJob(jobId, job);

          const outChunks: Buffer[] = [];
          const errChunks: Buffer[] = [];
          child.stdout.on('data', (c: Buffer) => outChunks.push(c));
          child.stderr.on('data', (c: Buffer) => errChunks.push(c));

          child.on('close', (code) => {
            job.result = Buffer.concat(outChunks).toString('utf-8').trim();
            job.stderr = Buffer.concat(errChunks).toString('utf-8').trim();
            job.status = code === 0 ? 'completed' : 'failed';
            persistJob(jobId, job);
          });

          child.on('error', (err: Error) => {
            job.status = 'failed';
            job.stderr = err.message;
            persistJob(jobId, job);
          });

          return { content: [{ type: 'text' as const, text: JSON.stringify({ jobId, pid: job.pid }) }] };
        }

        case 'kt_run_team_status': {
          const jobId = a['job_id'] as string;
          const job = getJob(jobId);
          if (!job) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `No job: ${jobId}` }) }] };
          const elapsed = ((Date.now() - job.startedAt) / 1000).toFixed(1);
          return { content: [{ type: 'text' as const, text: JSON.stringify({ jobId, status: job.status, elapsedSeconds: elapsed, result: job.result }) }] };
        }

        case 'kt_run_team_wait': {
          const jobId = a['job_id'] as string;
          const timeoutMs = Math.min((a['timeout_ms'] as number) ?? 300000, 3600000);
          const deadline = Date.now() + timeoutMs;
          let delay = 500;

          while (Date.now() < deadline) {
            const job = getJob(jobId);
            if (!job) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `No job: ${jobId}` }) }] };
            if (job.status !== 'running') {
              return { content: [{ type: 'text' as const, text: JSON.stringify({ jobId, status: job.status, result: job.result }) }] };
            }
            await new Promise<void>(r => setTimeout(r, delay));
            delay = Math.min(delay * 1.5, 2000);
          }

          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'timeout', jobId }) }] };
        }

        case 'kt_run_team_cleanup': {
          const jobId = a['job_id'] as string;
          const job = getJob(jobId);
          if (!job) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `No job: ${jobId}` }) }] };
          if (job.pid) {
            try { process.kill(job.pid, 'SIGTERM'); } catch { /* ignore */ }
          }
          return { content: [{ type: 'text' as const, text: JSON.stringify({ cleaned: true, jobId }) }] };
        }

        case 'kt_wiki_get': {
          const store = new WikiStore(a['namespace'] as string);
          const value = store.get(a['key'] as string);
          return { content: [{ type: 'text' as const, text: JSON.stringify({ value }) }] };
        }

        case 'kt_wiki_set': {
          const store = new WikiStore(a['namespace'] as string);
          store.set(a['key'] as string, a['value']);
          return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true }) }] };
        }

        case 'kt_wiki_search': {
          const store = new WikiStore(a['namespace'] as string);
          const results = store.search(a['query'] as string);
          return { content: [{ type: 'text' as const, text: JSON.stringify({ results }) }] };
        }

        default:
          return { content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }], isError: true };
      }
    } catch (error) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
    }
  });

  return server;
}

// Auto-start when imported as MCP server
void autoStartStdioMcpServer('team', createTeamServer);
