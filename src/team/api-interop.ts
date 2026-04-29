import {
  sendMessage, listMessages, markMessageDelivered,
  claimTask, transitionTaskStatus, releaseTaskClaim,
  readTask, listTasks, createTask,
} from './state.js';
import type { TaskStatus } from './contracts.js';

type ApiResult = { ok: boolean; data?: unknown; error?: string };

const str = (v: unknown): string => String(v ?? '');
const num = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const requiredVersion = (v: unknown): { ok: true; value: number } | { ok: false; error: string } => {
  if (v === undefined || v === null || v === '') return { ok: false, error: 'expected_version is required' };
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) return { ok: false, error: 'expected_version must be a positive integer' };
  return { ok: true, value: n };
};

const handlers: Record<string, (input: Record<string, unknown>) => Promise<ApiResult>> = {
  'send-message': async (input) => {
    const fromWorker = str(input['from_worker']);
    if (!fromWorker) return { ok: false, error: 'from_worker is required' };
    const msg = await sendMessage(
      str(input['team_name']), fromWorker, str(input['to_worker']), str(input['body']),
    );
    return { ok: true, data: msg };
  },

  'mailbox-list': async (input) => {
    const msgs = await listMessages(str(input['team_name']), str(input['worker']));
    return { ok: true, data: msgs };
  },

  'mailbox-mark-delivered': async (input) => {
    await markMessageDelivered(str(input['team_name']), str(input['worker']), str(input['message_id']));
    return { ok: true };
  },

  'claim-task': async (input) => {
    const expectedVersion = requiredVersion(input['expected_version']);
    if (!expectedVersion.ok) return { ok: false, error: expectedVersion.error };
    const result = await claimTask(
      str(input['team_name']), str(input['task_id']), str(input['worker']),
      expectedVersion.value,
    );
    if (!result.ok) return { ok: false, error: `Task claim failed: ${result.error ?? 'unknown'}` };
    return { ok: true, data: { claim_token: result.claim_token, version: result.version } };
  },

  'transition-task-status': async (input) => {
    const result = await transitionTaskStatus(
      str(input['team_name']), str(input['task_id']),
      str(input['from']) as TaskStatus, str(input['to']) as TaskStatus,
      str(input['claim_token']),
      { result: input['result'] as string | undefined, error: input['error'] as string | undefined },
    );
    if (!result.ok) return { ok: false, error: `Task transition failed: ${result.error ?? 'unknown'}` };
    return { ok: true };
  },

  'release-task-claim': async (input) => {
    const result = await releaseTaskClaim(
      str(input['team_name']), str(input['task_id']), str(input['claim_token']),
    );
    if (!result.ok) return { ok: false, error: `Release claim failed: ${result.error ?? 'unknown'}` };
    return { ok: true };
  },

  'read-task': async (input) => {
    const task = await readTask(str(input['team_name']), str(input['task_id']));
    if (!task) return { ok: false, error: 'Task not found' };
    return { ok: true, data: task };
  },

  'list-tasks': async (input) => {
    const tasks = await listTasks(str(input['team_name']));
    return { ok: true, data: tasks };
  },

  'create-task': async (input) => {
    const task = await createTask(str(input['team_name']), {
      subject: str(input['subject']),
      description: str(input['description']),
      blocked_by: input['blocked_by'] as string[] | undefined,
      requires_code_change: input['requires_code_change'] as boolean | undefined,
    });
    return { ok: true, data: task };
  },
};

export async function handleApiOperation(
  operation: string, input: Record<string, unknown>,
): Promise<ApiResult> {
  const handler = handlers[operation];
  if (!handler) return { ok: false, error: `Unknown operation: ${operation}` };
  try {
    return await handler(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
