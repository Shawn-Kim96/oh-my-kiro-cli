# kiro-team (kt) — Phase 3: Worker Bootstrap + Communication Protocol

## Goal
Worker 통신 프로토콜 확정 + inbox 생성 + dispatch queue + `kt api` CLI interop.

## Preconditions
- Phase 0, 1, 2 완료
- `kt` 가 global PATH에 등록됨 (`npm link`)

## Architecture Decision: `kt api` is the Canonical Communication Path

**확정**: Worker의 모든 state mutation은 `kt api` CLI를 통해 수행.
- Task lifecycle (claim, transition, release) → `kt api`
- Mailbox (send-message, mark-delivered) → `kt api`
- 직접 파일 쓰기 허용 대상: status.json, result.json, heartbeat.json (비트랜잭션 데이터)

이유:
- 파일 직접 쓰기는 race condition + malformed JSON 위험
- `kt api`는 locking + validation + atomic write 보장
- omx가 동일한 결론에 도달 ("Do NOT write lifecycle fields directly in task files")

## Steps

### 3.1 Worker Protocol (`src/prompts/worker-protocol.md`)

```markdown
## You are a kiro-team worker

Team: {team_name}
Worker: {worker_name}
Role: {role}
State Root: {state_root}

## State Root Resolution
Use this order to find the team state root:
1. $KT_STATE_ROOT environment variable
2. Your identity file: {state_root}/teams/{team_name}/workers/{worker_name}/identity.json → team_state_root
3. Team config: {state_root}/teams/{team_name}/config.json → team_state_root
4. Default: ~/.kt/

## Startup Protocol (REQUIRED — do this FIRST before any work)
1. Send startup ACK to leader:
   ```bash
   kt api send-message --input '{{"team_name":"{team_name}","from_worker":"{worker_name}","to_worker":"leader","body":"ACK: {worker_name} initialized"}}' --json
   ```
   CRITICAL: Never omit from_worker. The API cannot auto-detect your identity.

2. Read your inbox:
   Read file: {state_root}/teams/{team_name}/workers/{worker_name}/inbox.md

3. Read your assigned task:
   Read file: {state_root}/teams/{team_name}/tasks/task-{task_id}.json

## Work Protocol
1. Claim your task:
   ```bash
   kt api claim-task --input '{{"team_name":"{team_name}","task_id":"{task_id}","worker":"{worker_name}"}}' --json
   ```

2. Update your status to "working":
   Write to {state_root}/teams/{team_name}/workers/{worker_name}/status.json:
   {{"state":"working","current_task_id":"{task_id}","reason":null,"updated_at":"<ISO>"}}

3. Do the work using your tools.

4. When work is complete, commit your changes BEFORE reporting:
   ```bash
   git add -A && git commit -m "task: {task_subject}"
   ```

5. Write your result:
   Write to {state_root}/teams/{team_name}/workers/{worker_name}/result.json:
   {{"status":"done","result":"<your detailed findings/output>","updated_at":"<ISO>"}}

6. Transition task to completed:
   ```bash
   kt api transition-task-status --input '{{"team_name":"{team_name}","task_id":"{task_id}","from":"in_progress","to":"completed","result":"<summary>"}}' --json
   ```

7. Update your status to "idle":
   Write to status.json: {{"state":"idle","current_task_id":null,"reason":null,"updated_at":"<ISO>"}}

8. Send completion message to leader:
   ```bash
   kt api send-message --input '{{"team_name":"{team_name}","from_worker":"{worker_name}","to_worker":"leader","body":"DONE: task-{task_id} completed"}}' --json
   ```

9. Wait for next instruction (leader will send via your terminal).

## Mailbox Protocol
Check your mailbox when instructed:
```bash
kt api mailbox-list --input '{{"team_name":"{team_name}","worker":"{worker_name}"}}' --json
```

After reading a message, mark it delivered:
```bash
kt api mailbox-mark-delivered --input '{{"team_name":"{team_name}","worker":"{worker_name}","message_id":"<MESSAGE_ID>"}}' --json
```

## Failure Protocol
If your task fails:
1. Write error to result.json: {{"status":"failed","error":"<what went wrong>","updated_at":"<ISO>"}}
2. Transition task:
   ```bash
   kt api transition-task-status --input '{{"team_name":"{team_name}","task_id":"{task_id}","from":"in_progress","to":"failed","error":"<reason>"}}' --json
   ```
3. Update status to "idle"
4. Send failure message to leader

## Blocked Protocol
If you cannot proceed:
1. Update status: {{"state":"blocked","current_task_id":"{task_id}","reason":"<why blocked>","updated_at":"<ISO>"}}
2. Send message to leader explaining the blocker

## Shutdown Protocol
If leader sends shutdown instruction:
1. Finish current atomic operation (don't leave files half-written)
2. Commit any uncommitted changes
3. Write shutdown ACK:
   ```bash
   kt api send-message --input '{{"team_name":"{team_name}","from_worker":"{worker_name}","to_worker":"leader","body":"SHUTDOWN_ACK: {worker_name}"}}' --json
   ```
4. Exit your session

## Rules
- Focus ONLY on your assigned task
- Do NOT spawn subagents (no use_subagent tool)
- Do NOT modify files outside your task scope
- Do NOT write task lifecycle fields (status, owner, claim_token) directly — use kt api
- Always write result.json BEFORE reporting completion via kt api
- Always commit changes BEFORE reporting completion
- Always include from_worker in every kt api call
```

### 3.2 Worker Bootstrap (`src/team/worker-bootstrap.ts`)

```typescript
function generateWorkerInbox(params: {
  teamName: string;
  workerName: string;
  role: string;
  agent: string;
  taskId: string;
  taskSubject: string;
  taskDescription: string;
  stateRoot: string;
  leaderCwd: string;
}): string
// worker-protocol.md 템플릿에 변수 치환 + task 정보 포함

function generateTriggerMessage(params: {
  workerName: string;
  teamName: string;
  stateRoot: string;
}): string
// < 200 chars. 예:
// "You are worker-1 in team alpha. Read your inbox at ~/.kt/teams/alpha/workers/worker-1/inbox.md and follow ALL instructions."

function generateShutdownInbox(params: {
  teamName: string;
  workerName: string;
  reason: string;
}): string
// shutdown 지시 inbox 생성
```

### 3.3 Dispatch Queue (`src/team/mcp-comm.ts`)

```typescript
interface DispatchOutcome {
  ok: boolean;
  transport: 'tmux_send_keys' | 'none';
  reason: string;
  request_id: string;
  message_id?: string;
  to_worker?: string;
}

async function queueInboxInstruction(params: {
  teamName: string;
  workerName: string;
  workerIndex: number;
  paneId: string;
  inbox: string;
  triggerMessage: string;
  stateRoot: string;
}): Promise<DispatchOutcome>
```

동작:
1. `writeWorkerInbox()` — inbox.md 작성
2. `enqueueDispatchRequest()` — dispatch queue에 등록 (dedup 체크)
3. deduped → return `{ok: false, reason: 'duplicate_pending_dispatch'}`
4. worker pane ready 확인 (`paneLooksReady()`)
5. not ready → return `{ok: false, reason: 'worker_not_ready'}`
6. `sendKeys(paneId, triggerMessage)` — tmux send-keys
7. `markDispatchRequestNotified()` — status → notified
8. return `{ok: true, transport: 'tmux_send_keys'}`

```typescript
async function retryFailedDispatches(teamName: string, stateRoot: string): Promise<DispatchOutcome[]>
```
- listDispatchRequests에서 status='failed' + retry_count < max_retries 인 것들
- 각각 재시도 (send-keys)
- retry_count++

```typescript
async function deliverPendingMailboxMessages(teamName: string, stateRoot: string): Promise<void>
```
- 각 worker의 mailbox에서 notified=false인 메시지 확인
- 해당 worker pane에 "Check your mailbox" 트리거 전송

```typescript
async function waitForDispatchReceipt(
  teamName: string,
  requestId: string,
  stateRoot: string,
  options: {timeoutMs: number; pollMs?: number},
): Promise<DispatchRequest | null>
```
- polling with exponential backoff (50ms → 500ms max)
- status가 notified/delivered/failed 되면 반환

### 3.4 API Interop (`src/cli/api.ts` + `src/team/api-interop.ts`)

CLI 명령:
```bash
kt api <operation> --input '<json>' --json
```

**Operations:**

| Operation | State Function | Description |
|-----------|---------------|-------------|
| `send-message` | `sendMessage()` | 메시지 전송 (from_worker 필수) |
| `mailbox-list` | `listMessages()` | 메시지 목록 |
| `mailbox-mark-delivered` | `markMessageDelivered()` | 배달 확인 |
| `claim-task` | `claimTask()` | task claim |
| `transition-task-status` | `transitionTaskStatus()` | task 상태 전환 |
| `release-task-claim` | `releaseTaskClaim()` | claim 해제 |
| `read-task` | `readTask()` | task 읽기 |
| `list-tasks` | `listTasks()` | task 목록 |
| `create-task` | `createTask()` | task 생성 |

**Output format (--json):**
```json
{
  "ok": true,
  "operation": "claim-task",
  "timestamp": "2026-03-17T15:00:00.000Z",
  "data": { "claim_token": "abc-123", "version": 2 }
}
```

**Error format:**
```json
{
  "ok": false,
  "operation": "claim-task",
  "timestamp": "2026-03-17T15:00:00.000Z",
  "error": "Task already claimed by worker-2"
}
```

### 3.5 Worker → Leader 결과 수집

```typescript
async function collectWorkerResults(teamName: string): Promise<Array<{
  workerName: string;
  status: WorkerStatus | null;
  result: any | null;
  heartbeat: WorkerHeartbeat | null;
  alive: boolean;
  paneId: string | null;
}>>
```

## Deliverables
- [ ] `src/prompts/worker-protocol.md` — 완전한 worker 프로토콜 (ACK, work, failure, blocked, shutdown, mailbox, rules)
- [ ] `src/team/worker-bootstrap.ts` — inbox/trigger/shutdown inbox 생성
- [ ] `src/team/mcp-comm.ts` — dispatch queue + retry + pending mailbox delivery
- [ ] `src/cli/api.ts` + `src/team/api-interop.ts` — kt api CLI
- [ ] E2E: `kt api send-message` → mailbox에 메시지 저장 확인
- [ ] E2E: `kt api claim-task` → task owner 설정 확인

## Acceptance Criteria
- `generateWorkerInbox()` 출력에 team/worker/task 정보 + 전체 프로토콜 포함
- `queueInboxInstruction()` → inbox.md 작성 + send-keys + dispatch request 생성
- Duplicate dispatch → `{ok: false, reason: 'duplicate_pending_dispatch'}`
- `retryFailedDispatches()` → failed dispatch 재시도 + retry_count 증가
- `kt api claim-task` → `{ok: true, data: {claim_token: "...", version: 2}}`
- `kt api send-message` with empty from_worker → `{ok: false, error: "from_worker is required"}`
- `kt api transition-task-status` invalid transition → `{ok: false, error: "..."}`
