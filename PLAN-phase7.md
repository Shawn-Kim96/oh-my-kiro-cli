# kiro-team (kt) — Phase 7: Dynamic Scaling + Resume + Advanced Features

## Goal
실행 중 worker 추가/제거, resume/recovery, model config, worktree (scoped).

## Preconditions
- Phase 0-6 완료

## Steps

### 7.1 Dynamic Scaling (`src/team/scaling.ts`)

**Scale Up:**
```typescript
async function scaleUp(teamName: string, count: number, stateRoot: string, options?: {
  agentType?: string;
  tasks?: Array<{subject: string; description: string}>;
}): Promise<{addedWorkers: WorkerInfo[]; newWorkerCount: number}>
```

동작:
1. `withScalingLock(teamName, async () => { ... })` — concurrent scale 방지
2. readTeamConfig → next_worker_index 확인
3. 새 worker info 생성 (monotonic index)
4. config.workers에 추가 + next_worker_index 증가 + saveTeamConfig
5. 새 worker pane spawn
6. readiness 대기
7. tasks가 제공되면 createTask + inbox 작성 + dispatch
8. tasks 미제공이면 기존 pending tasks에서 자동 할당

**Scale Down:**
```typescript
async function scaleDown(teamName: string, workerNames: string[], stateRoot: string): Promise<{
  removedWorkers: string[];
  newWorkerCount: number;
}>
```

동작:
1. `withScalingLock(teamName, async () => { ... })`
2. 각 worker 상태 확인:
   - state='working' → 거부 ("worker-1 is busy, cannot remove")
   - state='idle' 또는 'done' → 제거 가능
3. Worker의 in_progress tasks → releaseTaskClaim → status='pending'
4. killPane(paneId)
5. config.workers에서 제거 + saveTeamConfig
6. appendEvent('worker_stopped', {reason: 'scaled_down'})

**CLI:**
```bash
kt scale-up <team> <count> [--role <role>]
kt scale-down <team> <worker-name>
```

### 7.2 Resume + Recovery (`src/team/runtime.ts`)

```typescript
async function resumeTeam(teamName: string, stateRoot: string): Promise<void>
```

동작:
```
1. readTeamConfig → 기존 config 로드
2. phase가 terminal → error "team already completed/failed"
3. 각 worker 상태 확인:
   a. isPaneAlive(paneId) → alive
   b. pane dead → mark as dead
4. Dead worker 처리:
   a. dead worker의 in_progress tasks → releaseTaskClaim → status='pending'
   b. 새 worker pane spawn (같은 role/agent)
   c. readiness 대기
   d. pending tasks 재할당
5. Alive worker 처리:
   a. readWorkerStatus → 상태 확인
   b. idle + pending tasks → 재할당
6. Monitor loop 재시작
```

**CLI:**
```bash
kt resume <team-name>
```

### 7.3 Model Configuration (`src/config/models.ts`)

```typescript
interface ModelConfig {
  defaultModel: string | null;     // --model flag for kiro-cli
  workerModel: string | null;      // worker별 모델 override
  reasoningEffort: 'low' | 'medium' | 'high' | null;
}

function resolveWorkerModel(role: string, config: ModelConfig): string[]
// returns additional kiro-cli flags: ['--model', 'claude-sonnet-4'] or []
```

환경변수:
```bash
KT_DEFAULT_MODEL=claude-sonnet-4     # leader model
KT_WORKER_MODEL=claude-sonnet-4      # worker model
KT_REASONING_EFFORT=medium           # worker reasoning effort
```

Worker spawn 시 model flag 적용:
```bash
kiro-cli chat --trust-all-tools --agent <agent> --model <model>
```

### 7.4 Git Worktree Support (v1: Simple Isolation Only)

**Scope**: v1에서는 worktree 생성/삭제만. 자동 merge/cherry-pick/rebase는 v2.

```typescript
async function createWorkerWorktree(params: {
  teamName: string;
  workerName: string;
  repoRoot: string;
  branchPrefix?: string;   // default: 'kt'
}): Promise<{worktreePath: string; branch: string}>
// git worktree add <path> -b kt/<team>/<worker>

async function removeWorkerWorktree(worktreePath: string): Promise<void>
// git worktree remove <path>

async function listWorkerWorktrees(teamName: string): Promise<Array<{
  workerName: string;
  path: string;
  branch: string;
}>>
```

Worker가 worktree에서 작업:
- spawnWorkerPane의 cwd를 worktreePath로 설정
- worker는 독립 branch에서 작업
- merge는 leader가 수동으로 수행 (v1)

**CLI:**
```bash
kt team 2:executor "implement feature" --worktree
# → 각 worker에 대해 git worktree 생성
# → worker는 독립 branch에서 작업
```

v2 예정 (이 phase에서는 구현하지 않음):
- 자동 merge/cherry-pick
- Conflict detection + reporting
- Cross-worker rebase
- Integration event logging

### 7.5 Prompt-Mode Workers (Non-tmux) — Future Scope

**이 phase에서는 구현하지 않음.** 설계만 문서화.

Prompt-mode worker:
- tmux 없이 child process로 kiro-cli 실행
- stdin/stdout pipe로 통신
- CI/CD, headless 환경용

```typescript
// Future: src/team/prompt-worker.ts
interface PromptWorker {
  process: ChildProcess;
  stdin: Writable;
  stdout: Readable;
  send(message: string): Promise<string>;
  kill(): void;
}
```

이 기능은 kiro-cli의 `--no-interactive` 모드가 멀티턴을 지원하게 되면 구현 가능.
현재는 `--no-interactive`가 single-turn이므로 tmux interactive 모드만 지원.

## Deliverables
- [ ] `src/team/scaling.ts` — scale up/down with scaling lock
- [ ] `src/team/runtime.ts` 에 resumeTeam() 추가
- [ ] `src/config/models.ts` — model resolution
- [ ] Git worktree support (create/remove/list only, no auto-merge)
- [ ] `kt scale-up`, `kt scale-down`, `kt resume` CLI 명령어
- [ ] Prompt-mode worker 설계 문서 (docs/future-prompt-mode.md)

## Acceptance Criteria
- `kt scale-up alpha 2` → 2 new workers spawn + 기존 team에 합류
- `kt scale-up alpha 1 --role reviewer` → reviewer worker 추가
- `kt scale-down alpha worker-3` (idle) → worker 제거 + task requeue
- `kt scale-down alpha worker-1` (working) → 거부 에러
- Concurrent `kt scale-up` 2개 → 하나만 성공 (scaling lock)
- `kt resume alpha` → dead workers 재생성 + pending tasks 재할당
- `kt resume alpha` (terminal phase) → "team already completed" 에러
- `--worktree` flag → 각 worker에 독립 git worktree 생성
- `KT_WORKER_MODEL=claude-sonnet-4` → worker가 해당 모델로 실행
