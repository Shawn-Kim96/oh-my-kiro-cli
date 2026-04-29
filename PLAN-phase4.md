# kiro-team (kt) — Phase 4: Team Runtime

## Goal
메인 런타임. `kt team <N> "<task>"` 실행 시 전체 lifecycle 관리.
Graceful shutdown 포함.

## Preconditions
- Phase 0, 1, 2, 3 완료

## Steps

### 4.1 Runtime Entry (`src/team/runtime.ts`)

```typescript
async function startTeam(options: {
  workerCount: number;
  agentType: string;
  task: string;
  cwd: string;
}): Promise<void>
```

전체 흐름:
```
 1. Validate preconditions
    - isTmuxAvailable() → error if false
    - isInsideTmux() → error if false
    - kt doctor checks (kiro-cli available)
 2. Generate team name
    - sanitize(task) → slug, append timestamp
    - validate against TEAM_NAME_PATTERN
 3. Init team state
    - initTeamState(config)
    - appendEvent('team_started')
 4. Create tasks
    - Single task mode: 1 task, all workers share
    - Multi-task mode: N tasks (if task contains numbered list)
 5. Resolve worker roles
    - agentType → kiro-cli agent mapping
    - If agentType='auto' → use role router per task
 6. Spawn worker panes
    - createTeamSession()
 7. Wait for all workers ready
    - waitForWorkerReady() for each (parallel)
    - Log ready/failed status per worker
 8. Generate inbox for each worker
    - generateWorkerInbox() with task assignment
 9. Dispatch inbox + trigger to each worker
    - queueInboxInstruction() for each
    - Log dispatch outcomes
10. Register SIGINT handler
    - On Ctrl+C → gracefulShutdown()
11. Enter monitor loop
    - monitorTeam()
12. On completion → reportTeamResults()
13. On failure → reportTeamErrors()
14. Cleanup (optional, based on --cleanup flag)
```

### 4.2 Agent Mapping (`src/config/agent-mapping.ts`)

```typescript
const AGENT_MAP: Record<string, string> = {
  executor:    'yolo-general',
  explorer:    'yolo-explorer',
  planner:     'yolo-planner',
  verifier:    'yolo-general',
  reviewer:    'yolo-momus',
  debugger:    'yolo-oracle',
  writer:      'yolo-document-writer',
  librarian:   'yolo-librarian',
  frontend:    'yolo-frontend-specialist',
  default:     'yolo-general',
};

function resolveAgent(agentType: string): string
// AGENT_MAP[agentType] ?? AGENT_MAP['default']
```

### 4.3 Task Allocation Policy (`src/team/allocation-policy.ts`)

```typescript
interface AllocationScore {
  worker: WorkerInfo;
  score: number;
  reasons: string[];
}

function scoreWorkerForTask(worker: WorkerInfo, task: TaskState, allWorkers: WorkerInfo[]): AllocationScore
```

Scoring criteria (가중치):
1. **Role match** (+10): worker.role이 task에 적합한 role과 일치
2. **Load balance** (+5): assigned_tasks가 적은 worker 우선
3. **Prior context** (+3): worker가 이전에 같은 파일/디렉토리 관련 task를 수행한 경우
4. **Idle preference** (+2): 현재 idle 상태인 worker 우선

```typescript
function chooseWorkerForTask(task: TaskState, workers: WorkerInfo[]): WorkerInfo | null
// 모든 worker에 대해 scoreWorkerForTask → 최고 점수 worker 반환
// 모든 worker가 busy → null

async function assignPendingTasks(teamName: string, stateRoot: string): Promise<void>
// 1. listTasks에서 pending tasks 가져오기
// 2. 각 pending task에 대해:
//    a. blocked_by 확인 → 의존 task가 미완료면 skip
//    b. chooseWorkerForTask → best worker 선택
//    c. claimTask → inbox 작성 → dispatch
```

### 4.4 Monitor Loop (`src/team/runtime.ts`)

```typescript
async function monitorTeam(
  teamName: string,
  session: TeamSession,
  stateRoot: string,
  options: {
    pollIntervalMs: number;      // default 5000
    staleHeartbeatMs: number;    // default 60000
    idleNudgeMs: number;         // default 120000
  },
): Promise<void>
```

매 poll cycle:
```
1. Worker health check
   for each worker:
     a. isPaneAlive(paneId) → dead면 emit 'worker_stopped', mark status
     b. readWorkerHeartbeat → stale이면 log warning
     c. readWorkerStatus → 상태 수집
     d. Leader-side heartbeat: capturePane → 활동 감지 → updateWorkerHeartbeat

2. Task status check
   a. listTasks → 각 task 상태 확인
   b. completed tasks → emit 'task_completed'
   c. failed tasks → emit 'task_failed'

3. Dispatch reliability
   a. retryFailedDispatches() → 실패한 dispatch 재시도
   b. deliverPendingMailboxMessages() → 미전달 mailbox 전달

4. Task assignment
   a. idle workers + pending tasks → assignPendingTasks()

5. Phase inference
   a. inferPhaseFromTaskCounts() → 현재 phase 추론
   b. reconcilePhaseState() → phase 전환 필요 시 전환

6. Idle nudge check
   a. 모든 worker idle + pending tasks 존재 → leader nudge
   b. Worker가 idleNudgeMs 이상 idle → "check your inbox" 재전송

7. Monitor snapshot 저장
   a. writeMonitorSnapshot() → 중복 알림 방지

8. Terminal check
   a. phase가 complete/failed/cancelled → break
   b. 모든 task terminal + 모든 worker idle → complete
```

### 4.5 Graceful Shutdown (`src/team/runtime.ts`)

```typescript
async function gracefulShutdown(
  teamName: string,
  session: TeamSession,
  stateRoot: string,
  options: {
    reason: string;
    force: boolean;           // skip ACK wait
    ackTimeoutMs: number;     // default 15000
  },
): Promise<void>
```

Shutdown sequence:
```
1. writeShutdownRequest(teamName, {reason, force})
2. appendEvent('team_shutdown', {reason})
3. For each alive worker:
   a. Generate shutdown inbox
   b. writeWorkerInbox(teamName, workerName, shutdownInbox)
   c. sendKeys(paneId, "SHUTDOWN: Read your inbox for shutdown instructions")
4. If not force:
   a. Wait for shutdown ACKs (poll readShutdownAcks)
   b. Timeout after ackTimeoutMs → log warning, proceed
5. For each worker pane:
   a. killPane(paneId)
6. Kill HUD pane (if exists)
7. Report final status
8. Optional: cleanupTeamState(teamName) if --cleanup flag
```

SIGINT handler:
```typescript
function registerSigintHandler(teamName: string, session: TeamSession, stateRoot: string): void
// process.on('SIGINT', async () => {
//   console.log('\nShutting down team...');
//   await gracefulShutdown(teamName, session, stateRoot, {reason: 'user_interrupt', force: false, ackTimeoutMs: 10000});
//   process.exit(0);
// });
// 두 번째 SIGINT → force shutdown
```

### 4.6 CLI Integration (`src/cli/team.ts`)

```typescript
program
  .command('team')
  .argument('[spec]', 'N or N:role (e.g., 3, 2:executor, 1:explorer)')
  .argument('<task>', 'Task description')
  .option('--cwd <dir>', 'Working directory', process.cwd())
  .option('--json', 'JSON output')
  .option('--cleanup', 'Remove team state after completion')
  .option('--detach', 'Run monitor in background')
  .action(...)
```

spec 파싱:
- `"3"` → workerCount=3, agentType='executor'
- `"2:explorer"` → workerCount=2, agentType='explorer'
- 생략 → workerCount=1, agentType='executor'

### 4.7 Status + Shutdown CLI

```typescript
// kt status [team-name]
program.command('status')
  .argument('[team]', 'Team name (latest if omitted)')
  .option('--json')
  .action(async (team, options) => {
    // readTeamConfig → collectWorkerResults → listTasks → render
  });

// kt shutdown <team-name>
program.command('shutdown')
  .argument('<team>', 'Team name')
  .option('--force', 'Skip ACK wait')
  .action(async (team, options) => {
    // gracefulShutdown()
  });
```

## Deliverables
- [ ] `src/team/runtime.ts` — startTeam + monitorTeam + gracefulShutdown
- [ ] `src/config/agent-mapping.ts` — role → agent 매핑
- [ ] `src/team/allocation-policy.ts` — task allocation scoring
- [ ] `src/cli/team.ts` — CLI command
- [ ] `src/cli/status.ts` — status command
- [ ] `src/cli/shutdown.ts` — shutdown command
- [ ] SIGINT handler with 2-stage shutdown (graceful → force)

## Acceptance Criteria
- `kt team 1 "say hello"` → worker spawn → 작업 → 결과 출력 → 자동 종료
- `kt team 2:explorer "find API endpoints"` → 2 explorer worker spawn
- Monitor loop가 worker 완료 감지 → 결과 수집
- Dead worker → 'worker_stopped' event + 에러 보고
- Ctrl+C → graceful shutdown (shutdown inbox → ACK wait → kill panes)
- Ctrl+C 두 번 → force shutdown (즉시 kill)
- `kt status` → worker/task 상태 표시
- `kt shutdown --force` → 즉시 종료
- Idle worker + pending task → 자동 재할당
- Failed dispatch → 자동 재시도 (max 3회)
