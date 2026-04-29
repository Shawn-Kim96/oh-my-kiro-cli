// ── Team ──
export interface TeamConfig {
  name: string;
  task: string;
  agent_type: string;
  worker_count: number;
  max_workers: number;
  workers: WorkerInfo[];
  created_at: string;
  tmux_target: string;
  leader_pane_id: string | null;
  hud_pane_id: string | null;
  next_task_id: number;
  next_worker_index: number;
  leader_cwd: string;
  team_state_root: string;
}

// ── Worker ──
export interface WorkerInfo {
  name: string;
  index: number;
  role: string;
  agent: string;
  pane_id: string | null;
  assigned_tasks: string[];
  worker_cli: 'kiro-cli';
}

export interface WorkerIdentity {
  team_name: string;
  worker_name: string;
  role: string;
  agent: string;
  pane_id: string;
  team_state_root: string;
  leader_cwd: string;
  created_at: string;
}

export interface WorkerStatus {
  state: 'idle' | 'working' | 'blocked' | 'done' | 'failed' | 'draining';
  current_task_id: string | null;
  reason: string | null;
  updated_at: string;
}

export interface WorkerHeartbeat {
  last_seen: string;
  pid: number | null;
  turn_count: number;
}

// ── Task ──
export type TaskStatus = 'pending' | 'blocked' | 'in_progress' | 'completed' | 'failed';

export const TASK_STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending:     ['in_progress', 'blocked'],
  blocked:     ['pending', 'in_progress'],
  in_progress: ['completed', 'failed'],
  completed:   [],
  failed:      ['pending'],
};

export interface TaskState {
  id: string;
  subject: string;
  description: string;
  status: TaskStatus;
  owner: string | null;
  claim_token: string | null;
  version: number;
  blocked_by: string[];
  requires_code_change: boolean;
  role: string | null;
  result: string | null;
  error: string | null;
  quality_checked?: boolean;
  quality_passed?: boolean;
  quality_issues?: string[];
  created_at: string;
  updated_at: string;
}

// ── Mailbox ──
export interface MailboxMessage {
  message_id: string;
  from_worker: string;
  to_worker: string;
  body: string;
  created_at: string;
  delivered: boolean;
  notified: boolean;
}

// ── Dispatch ──
export type DispatchStatus = 'pending' | 'notified' | 'delivered' | 'failed';

export interface DispatchRequest {
  request_id: string;
  kind: 'inbox' | 'mailbox';
  to_worker: string;
  worker_index: number;
  pane_id: string | null;
  trigger_message: string;
  message_id: string | null;
  status: DispatchStatus;
  deduplication_key: string | null;
  retry_count: number;
  max_retries: number;
  last_reason: string | null;
  created_at: string;
  updated_at: string;
}

// ── Events ──
export type EventType =
  | 'task_completed' | 'task_failed' | 'task_claimed'
  | 'worker_idle' | 'worker_stopped' | 'worker_blocked'
  | 'message_received'
  | 'dispatch_failed' | 'dispatch_retried'
  | 'team_started' | 'team_shutdown'
  | 'phase_transition'
  | 'quality_gate_passed' | 'quality_gate_failed'
  | 'leader_nudge'
  | 'shutdown_ack';

export interface TeamEvent {
  type: EventType;
  timestamp: string;
  data: Record<string, unknown>;
}

// ── Phase ──
export type TeamPhase = 'exec' | 'verify' | 'fix';
export type TerminalPhase = 'complete' | 'failed' | 'cancelled';

export interface PhaseState {
  current_phase: TeamPhase | TerminalPhase;
  max_fix_attempts: number;
  current_fix_attempt: number;
  transitions: Array<{ from: string; to: string; at: string; reason?: string }>;
  updated_at: string;
}

// ── Monitor Snapshot ──
export interface MonitorSnapshot {
  last_notified_events: Record<string, string>;
  last_poll_at: string;
  worker_states: Record<string, string>;
  updated_at: string;
}

// ── Shutdown ──
export interface ShutdownRequest {
  requested_at: string;
  reason: string;
  force: boolean;
}

export interface ShutdownAck {
  worker_name: string;
  acked_at: string;
  final_status: string;
}

// ── Validation Constants ──
export const TEAM_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,29}$/;
export const WORKER_NAME_PATTERN = /^worker-\d{1,3}$/;
export const TASK_ID_PATTERN = /^\d{1,10}$/;
