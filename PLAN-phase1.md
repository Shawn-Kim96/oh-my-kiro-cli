# kiro-team (kt) — Phase 1: State Layer

## Goal
파일 기반 persistence layer. 모든 team/worker/task/mailbox 상태를 파일로 관리.

## Preconditions
- Phase 0 완료 (빌드 가능한 프로젝트)

## Directory Structure (runtime)
```
~/.kt/teams/<team-name>/
├── config.json                    # TeamConfig
├── manifest.json                  # TeamManifest (worker roster snapshot)
├── phase.json                     # Current phase state
├── monitor-snapshot.json          # Monitor snapshot (prevents re-notification)
├── events.jsonl                   # Append-only event log
├── workers/
│   └── worker-<n>/
│       ├── identity.json          # WorkerIdentity
│       ├── inbox.md               # Leader → Worker 지시 (덮어쓰기)
│       ├── status.json            # Worker 자체 보고
│       ├── heartbeat.json         # Last seen timestamp
│       └── result.json            # Task 결과
├── tasks/
│   └── task-<id>.json             # TaskState
├── mailbox/
│   ├── leader.json                # Workers → Leader 메시지 배열
│   └── worker-<n>.json            # Leader → Worker 메시지 배열
├── dispatch/
│   └── requests.json              # Dispatch request queue
└── shutdown/
    ├── request.json               # Shutdown request from leader
    └── acks/
        └── worker-<n>.json        # Shutdown ACK from each worker
```

## Steps

### 1.1 Type Definitions (`src/team/contracts.ts`)

```typescript
// ── Team ──
interface TeamConfig {
  name: string;
  task: string;
  agent_type: string;
  worker_count: number;
  max_workers: number;             // default 10, max 20
  workers: WorkerInfo[];
  created_at: string;
  tmux_target: string;
  leader_pane_id: string | null;
  hud_pane_id: string | null;
  next_task_id: number;
  next_worker_index: number;       // monotonic counter for scaling
  leader_cwd: string;
  team_state_root: string;         // canonical state root path
}

// ── Worker ──
interface WorkerInfo {
  name: string;                    // "worker-1"
  index: number;
  role: string;
  agent: string;                   // kiro-cli agent name
  pane_id: string | null;
  assigned_tasks: string[];
  worker_cli: 'kiro-cli';         // extensible for future CLIs
}

interface WorkerIdentity {
  team_name: string;
  worker_name: string;
  role: string;
  agent: string;
  pane_id: string;
  team_state_root: string;        // canonical state root
  leader_cwd: string;
  created_at: string;
}

interface WorkerStatus {
  state: 'idle' | 'working' | 'blocked' | 'done' | 'failed' | 'draining';
  current_task_id: string | null;
  reason: string | null;
  updated_at: string;
}

interface WorkerHeartbeat {
  last_seen: string;
  pid: number | null;
  turn_count: number;             // incremented each interaction
}

// ── Task ──
type TaskStatus = 'pending' | 'blocked' | 'in_progress' | 'completed' | 'failed';

const TASK_STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending:     ['in_progress', 'blocked'],
  blocked:     ['pending', 'in_progress'],   // unblocked → back to pending or directly to in_progress
  in_progress: ['completed', 'failed'],
  completed:   [],
  failed:      ['pending'],                  // retry: failed → pending
};

interface TaskState {
  id: string;
  subject: string;
  description: string;
  status: TaskStatus;
  owner: string | null;
  claim_token: string | null;
  version: number;                 // optimistic concurrency
  blocked_by: string[];            // task IDs this depends on
  requires_code_change: boolean;
  result: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

// ── Mailbox ──
interface MailboxMessage {
  message_id: string;              // UUID
  from_worker: string;             // REQUIRED — never omit
  to_worker: string;
  body: string;
  created_at: string;
  delivered: boolean;
  notified: boolean;
}

// ── Dispatch ──
type DispatchStatus = 'pending' | 'notified' | 'delivered' | 'failed';

interface DispatchRequest {
  request_id: string;
  kind: 'inbox' | 'mailbox';
  to_worker: string;
  worker_index: number;
  pane_id: string | null;
  trigger_message: string;
  message_id: string | null;       // for mailbox kind
  status: DispatchStatus;
  deduplication_key: string | null; // prevents duplicate dispatches
  retry_count: number;
  max_retries: number;             // default 3
  last_reason: string | null;
  created_at: string;
  updated_at: string;
}

// ── Events ──
type EventType =
  | 'task_completed' | 'task_failed' | 'task_claimed'
  | 'worker_idle' | 'worker_stopped' | 'worker_blocked'
  | 'message_received'
  | 'dispatch_failed' | 'dispatch_retried'
  | 'team_started' | 'team_shutdown'
  | 'phase_transition'
  | 'leader_nudge'
  | 'shutdown_ack';

interface TeamEvent {
  type: EventType;
  timestamp: string;
  data: Record<string, unknown>;
}

// ── Phase ──
type TeamPhase = 'exec' | 'verify' | 'fix';
type TerminalPhase = 'complete' | 'failed' | 'cancelled';
// NOTE: 'plan' phase는 의도적으로 생략. kt는 omx의 plan/prd phase를 생략하고
// 바로 exec부터 시작. 이유: kiro-cli의 planner agent가 이미 planning을 수행하므로
// kt 런타임에서 별도 plan phase를 관리할 필요 없음. planning이 필요하면
// planner role worker를 exec phase에서 실행.

interface PhaseState {
  current_phase: TeamPhase | TerminalPhase;
  max_fix_attempts: number;        // default 3
  current_fix_attempt: number;
  transitions: Array<{ from: string; to: string; at: string; reason?: string }>;
  updated_at: string;
}

// ── Monitor Snapshot ──
interface MonitorSnapshot {
  last_notified_events: Record<string, string>;  // eventType → last timestamp
  last_poll_at: string;
  worker_states: Record<string, string>;          // workerName → last known state
  updated_at: string;
}

// ── Shutdown ──
interface ShutdownRequest {
  requested_at: string;
  reason: string;
  force: boolean;
}

interface ShutdownAck {
  worker_name: string;
  acked_at: string;
  final_status: string;
}

// ── Validation Constants ──
const TEAM_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,29}$/;
const WORKER_NAME_PATTERN = /^worker-\d{1,3}$/;
const TASK_ID_PATTERN = /^\d{1,10}$/;
```

### 1.2 State Persistence (`src/team/state.ts`)

**Team:**
- `initTeamState(config: TeamConfig): Promise<void>` — 전체 디렉토리 구조 생성 + config.json + phase.json + monitor-snapshot.json
- `readTeamConfig(teamName): Promise<TeamConfig | null>`
- `saveTeamConfig(teamName, config): Promise<void>`
- `cleanupTeamState(teamName): Promise<void>` — rm -rf team dir
- `listTeams(): Promise<string[]>`

**Worker:**
- `writeWorkerIdentity(teamName, workerName, identity): Promise<void>`
- `readWorkerIdentity(teamName, workerName): Promise<WorkerIdentity | null>`
- `writeWorkerInbox(teamName, workerName, content: string): Promise<void>`
- `readWorkerInbox(teamName, workerName): Promise<string | null>`
- `readWorkerStatus(teamName, workerName): Promise<WorkerStatus | null>`
- `writeWorkerStatus(teamName, workerName, status): Promise<void>`
- `updateWorkerHeartbeat(teamName, workerName, turnCount?): Promise<void>`
- `readWorkerHeartbeat(teamName, workerName): Promise<WorkerHeartbeat | null>`

**Task:**
- `createTask(teamName, task): Promise<TaskState>` — auto-increment ID, version=1
- `readTask(teamName, taskId): Promise<TaskState | null>`
- `listTasks(teamName): Promise<TaskState[]>`
- `claimTask(teamName, taskId, workerName, expectedVersion): Promise<{ok, claim_token?, version?}>`
  - optimistic concurrency: version mismatch → fail
  - status must be 'pending' or 'blocked'(unblocked)
  - sets owner, claim_token, status='in_progress', version++
- `transitionTaskStatus(teamName, taskId, from, to, claimToken, patch?): Promise<{ok}>`
  - validates transition table
  - validates claim_token matches
  - applies patch (result, error)
  - version++
- `releaseTaskClaim(teamName, taskId, claimToken): Promise<{ok}>`
  - sets status='pending', clears owner/claim_token, version++

**Mailbox:**
- `sendMessage(teamName, from, to, body): Promise<MailboxMessage>`
  - from_worker is REQUIRED — throws if empty
  - appends to target's mailbox file
- `listMessages(teamName, workerName): Promise<MailboxMessage[]>`
- `markMessageDelivered(teamName, workerName, messageId): Promise<void>`
- `markMessageNotified(teamName, workerName, messageId): Promise<void>`

**Dispatch:**
- `enqueueDispatchRequest(teamName, request): Promise<{request: DispatchRequest, deduped: boolean}>`
  - deduplication: if pending request exists for same to_worker+kind → return {deduped: true}
- `readDispatchRequest(teamName, requestId): Promise<DispatchRequest | null>`
- `listDispatchRequests(teamName): Promise<DispatchRequest[]>`
- `transitionDispatchRequest(teamName, requestId, from, to, patch?): Promise<void>`
- `markDispatchRequestNotified(teamName, requestId, patch?): Promise<void>`

**Events:**
- `appendEvent(teamName, event): Promise<void>` — JSONL append
- `readEvents(teamName, since?): Promise<TeamEvent[]>` — optional since timestamp filter

**Monitor:**
- `readMonitorSnapshot(teamName): Promise<MonitorSnapshot | null>`
- `writeMonitorSnapshot(teamName, snapshot): Promise<void>`

**Shutdown:**
- `writeShutdownRequest(teamName, request): Promise<void>`
- `readShutdownRequest(teamName): Promise<ShutdownRequest | null>`
- `writeShutdownAck(teamName, ack): Promise<void>`
- `readShutdownAcks(teamName): Promise<ShutdownAck[]>`

### 1.3 File Locking (`src/team/state/locks.ts`)
- `withFileLock<T>(lockPath, fn, timeoutMs=5000): Promise<T>` — mkdir-based lock with stale detection (30s)
- `withTeamLock<T>(teamName, fn): Promise<T>`
- `withTaskClaimLock<T>(teamName, taskId, fn): Promise<T>`
- `withMailboxLock<T>(teamName, workerName, fn): Promise<T>`
- `withScalingLock<T>(teamName, fn): Promise<T>`
- `withDispatchLock<T>(teamName, fn): Promise<T>`

### 1.4 Atomic Write Utility
```typescript
async function writeAtomic(filePath: string, content: string): Promise<void>
// writes to filePath.tmp then renames to filePath
```

## Deliverables
- [ ] `src/team/contracts.ts` — 모든 타입 + validation constants + transition tables
- [ ] `src/team/state.ts` — 모든 CRUD 함수
- [ ] `src/team/state/locks.ts` — file locking with stale detection
- [ ] Unit tests covering:
  - initTeamState → readTeamConfig
  - createTask → claimTask (with version) → transitionTaskStatus → releaseTaskClaim
  - sendMessage (with from_worker validation) → listMessages → markMessageDelivered
  - enqueueDispatchRequest deduplication
  - Invalid transition rejection (pending → completed)
  - Concurrent claimTask (only one succeeds)
  - blocked → pending → in_progress flow
  - failed → pending retry flow

## Acceptance Criteria
- `initTeamState()` 호출 시 올바른 디렉토리 구조 생성됨 (shutdown/acks/ 포함)
- `claimTask()` with wrong version → `{ok: false}`
- `claimTask()` concurrent → 하나만 `{ok: true}` (lock 검증)
- `sendMessage()` with empty from_worker → throws Error
- `enqueueDispatchRequest()` duplicate → `{deduped: true}`
- `transitionTaskStatus('pending', 'completed')` → `{ok: false}` (invalid transition)
- `transitionTaskStatus('pending', 'blocked')` → `{ok: true}`
- `transitionTaskStatus('failed', 'pending')` → `{ok: true}` (retry)
