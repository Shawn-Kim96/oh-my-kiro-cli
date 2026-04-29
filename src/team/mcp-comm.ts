import { randomUUID } from 'crypto';
import {
  writeWorkerInbox, enqueueDispatchRequest, markDispatchRequestNotified,
  listDispatchRequests, transitionDispatchRequest, readDispatchRequest,
  listMessages, markMessageNotified,
} from './state.js';
import { capturePane, paneLooksReady, sendKeys } from './tmux-session.js';
import { sleep } from '../utils/sleep.js';
import type { DispatchRequest } from './contracts.js';

export interface DispatchOutcome {
  ok: boolean;
  transport: 'tmux_send_keys' | 'none';
  reason: string;
  request_id: string;
  message_id?: string;
  to_worker?: string;
}

export async function confirmedSendKeys(
  paneId: string,
  text: string,
  opts?: { retries?: number; timeoutMs?: number },
): Promise<boolean> {
  const maxRetries = opts?.retries ?? 2;
  const timeoutMs = opts?.timeoutMs ?? 5000;
  // Use first 40 chars of text as fingerprint to check delivery
  const fingerprint = text.trim().slice(0, 40).toLowerCase();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    sendKeys(paneId, text);

    // Wait for sent text to appear in pane output
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await sleep(500);
      const after = capturePane(paneId, 30).toLowerCase();
      if (after.includes(fingerprint)) return true;
    }

    // Backoff before retry
    if (attempt < maxRetries) await sleep(1000 * (attempt + 1));
  }
  return false;
}

const MAX_RETRIES = 3;

export async function queueInboxInstruction(params: {
  teamName: string;
  workerName: string;
  workerIndex: number;
  paneId: string;
  inbox: string;
  triggerMessage: string;
  stateRoot: string;
}): Promise<DispatchOutcome> {
  await writeWorkerInbox(params.teamName, params.workerName, params.inbox);

  const { request, deduped } = await enqueueDispatchRequest(params.teamName, {
    kind: 'inbox',
    to_worker: params.workerName,
    worker_index: params.workerIndex,
    pane_id: params.paneId,
    trigger_message: params.triggerMessage,
    message_id: null,
    deduplication_key: `inbox:${params.workerName}`,
    max_retries: MAX_RETRIES,
    last_reason: null,
  });

  if (deduped) {
    return { ok: false, transport: 'none', reason: 'duplicate_pending_dispatch', request_id: request.request_id, to_worker: params.workerName };
  }

  // Wait for worker to be ready before sending (up to 60s)
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const capture = capturePane(params.paneId);
    if (paneLooksReady(capture)) {
      ready = true;
      break;
    }
    await sleep(1000);
  }
  if (!ready) {
    await transitionDispatchRequest(params.teamName, request.request_id, 'pending', 'failed', { last_reason: 'worker_not_ready' });
    return { ok: false, transport: 'none', reason: 'worker_not_ready', request_id: request.request_id, to_worker: params.workerName };
  }

  // Use confirmed delivery with retry
  const delivered = await confirmedSendKeys(params.paneId, params.triggerMessage);
  await markDispatchRequestNotified(params.teamName, request.request_id, {
    last_reason: delivered ? 'confirmed_via_tmux' : 'sent_unconfirmed_via_tmux',
  });

  return { ok: true, transport: 'tmux_send_keys', reason: 'dispatched', request_id: request.request_id, to_worker: params.workerName };
}

export async function retryFailedDispatches(teamName: string, stateRoot: string): Promise<DispatchOutcome[]> {
  const reqs = await listDispatchRequests(teamName);
  const failed = reqs.filter(r => r.status === 'failed' && r.retry_count < r.max_retries);
  const outcomes: DispatchOutcome[] = [];

  for (const req of failed) {
    if (!req.pane_id) {
      outcomes.push({ ok: false, transport: 'none', reason: 'no_pane_id', request_id: req.request_id, to_worker: req.to_worker });
      continue;
    }

    const capture = capturePane(req.pane_id);
    if (!paneLooksReady(capture)) {
      await transitionDispatchRequest(teamName, req.request_id, 'failed', 'failed', {
        retry_count: req.retry_count + 1,
        last_reason: 'worker_not_ready',
      });
      outcomes.push({ ok: false, transport: 'none', reason: 'worker_not_ready', request_id: req.request_id, to_worker: req.to_worker });
      continue;
    }

    // Use confirmed delivery with retry
    const delivered = await confirmedSendKeys(req.pane_id, req.trigger_message);
    await transitionDispatchRequest(teamName, req.request_id, 'failed', 'notified', {
      retry_count: req.retry_count + 1,
      last_reason: delivered ? 'retry_confirmed_via_tmux' : 'retry_sent_unconfirmed_via_tmux',
    });
    outcomes.push({ ok: true, transport: 'tmux_send_keys', reason: 'retry_dispatched', request_id: req.request_id, to_worker: req.to_worker });
  }

  return outcomes;
}

export async function deliverPendingMailboxMessages(
  teamName: string, stateRoot: string, workers: Array<{ name: string; paneId: string }>,
): Promise<void> {
  for (const worker of workers) {
    const msgs = await listMessages(teamName, worker.name);
    const unnotified = msgs.filter(m => !m.notified);
    if (unnotified.length === 0) continue;

    const capture = capturePane(worker.paneId);
    if (!paneLooksReady(capture)) continue;

    sendKeys(worker.paneId, `Check your mailbox: kch api mailbox-list --input '{"team_name":"${teamName}","worker":"${worker.name}"}' --json`);

    for (const msg of unnotified) {
      await markMessageNotified(teamName, worker.name, msg.message_id);
    }
  }
}

export async function waitForDispatchReceipt(
  teamName: string, requestId: string, stateRoot: string,
  options: { timeoutMs: number; pollMs?: number },
): Promise<DispatchRequest | null> {
  const deadline = Date.now() + options.timeoutMs;
  let interval = options.pollMs ?? 50;
  const maxInterval = 500;

  while (Date.now() < deadline) {
    const req = await readDispatchRequest(teamName, requestId);
    if (req && req.status !== 'pending') return req;
    await sleep(interval);
    interval = Math.min(interval * 2, maxInterval);
  }
  return null;
}
