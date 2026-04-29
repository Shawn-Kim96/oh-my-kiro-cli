import { spawn, type ChildProcess } from 'child_process';

export interface PromptWorker {
  id: string;
  process: ChildProcess | null;
  send(message: string): Promise<string>;
  isAlive(): boolean;
  kill(): void;
}

export async function spawnPromptWorker(options: {
  agent: string;
  cwd: string;
  env?: Record<string, string>;
}): Promise<PromptWorker> {
  let currentProcess: ChildProcess | null = null;

  const worker: PromptWorker = {
    id: `prompt-${Date.now().toString(36)}`,
    get process() { return currentProcess; },

    async send(message: string): Promise<string> {
      return sendPromptWorkerMessage(worker, message, options);
    },

    isAlive(): boolean {
      return currentProcess !== null && currentProcess.exitCode === null;
    },

    kill(): void {
      if (currentProcess && currentProcess.exitCode === null) {
        currentProcess.kill('SIGTERM');
      }
      currentProcess = null;
    },
  };

  return worker;
}

export async function sendPromptWorkerMessage(
  _worker: PromptWorker,
  message: string,
  options: { agent: string; cwd: string; env?: Record<string, string> },
): Promise<string> {
  // --no-interactive is single-turn: spawn a new process per message
  return new Promise<string>((resolve, reject) => {
    const child = spawn('kiro-cli', ['chat', '--no-interactive', '--trust-all-tools', '--agent', options.agent], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    child.stdout.on('data', (c: Buffer) => outChunks.push(c));
    child.stderr.on('data', (c: Buffer) => errChunks.push(c));

    child.stdin.write(message);
    child.stdin.end();

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Prompt worker timed out'));
    }, 300000);

    child.on('close', (code) => {
      clearTimeout(timeout);
      const stdout = Buffer.concat(outChunks).toString('utf-8');
      if (code !== 0) {
        const stderr = Buffer.concat(errChunks).toString('utf-8');
        reject(new Error(`Worker exited with code ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      resolve(stdout);
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}
