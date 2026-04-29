# kiro-team (kt) — Phase 2: tmux Session Manager

## Goal
tmux pane 생명주기 관리. worker pane 생성, readiness 감지, 모니터링, 종료.

## Preconditions
- Phase 0, 1 완료
- tmux >= 3.0 설치됨
- 현재 세션이 tmux 안에서 실행 중 ($TMUX 설정됨)

## Steps

### 2.1 tmux 기본 함수 (`src/team/tmux-session.ts`)

**Low-level wrappers:**
```typescript
function runTmux(args: string[]): {ok: true, stdout: string} | {ok: false, stderr: string}
// spawnSync('tmux', args) wrapper. 동기.

async function runTmuxAsync(args: string[]): Promise<{ok: true, stdout: string} | {ok: false, stderr: string}>
// execFile('tmux', args) wrapper. 비동기.

function isTmuxAvailable(): boolean
// which tmux + tmux -V 확인

function isInsideTmux(): boolean
// process.env.TMUX 존재 확인
```

**Pane 관리:**
```typescript
interface TmuxPaneInfo {
  paneId: string;          // %42
  currentCommand: string;  // kiro-cli, zsh, etc.
  startCommand: string;    // 원래 실행 명령
  isDead: boolean;
  pid: number;
}

function listPanes(target: string): TmuxPaneInfo[]
// tmux list-panes -t <target> -F '#{pane_id}\t#{pane_current_command}\t#{pane_start_command}\t#{pane_dead}\t#{pane_pid}'

function splitPane(options: {direction: 'h'|'v', command: string, cwd?: string, targetPane?: string}): string
// tmux split-pane -<dir> -P -F '#{pane_id}' -c <cwd> "<command>"
// returns pane ID

function killPane(paneId: string): void
// tmux kill-pane -t <paneId>

function capturePane(paneId: string, lines: number = 80): string
// tmux capture-pane -t <paneId> -p -S -<lines>

function sendKeys(paneId: string, text: string): void
// tmux send-keys -t <paneId> "<text>" C-m

function isPaneAlive(paneId: string): boolean
// list-panes + pane_dead=0 + process.kill(pid, 0)

function displayMessage(message: string): void
// tmux display-message "<message>"
```

### 2.2 Readiness Detection

```typescript
async function waitForWorkerReady(
  paneId: string,
  options: {
    timeoutMs: number;       // default 45000
    pollMs: number;          // default 1000
  },
): Promise<boolean>
```

**Ready 판정 기준 (3단계):**

1. **Bootstrap 감지**: capture-pane에 "mcp servers initialized" 또는 "Welcome to Kiro" 포함
2. **Trust prompt 처리**: capture-pane에 "trust" 또는 "permission" 프롬프트 감지 시 → `dismissTrustPrompt(paneId)` 호출
3. **Prompt ready**: 마지막 비공백 줄에 `λ` 문자 포함 AND 이전 줄에 active tool call 패턴 없음

```typescript
function paneLooksReady(capture: string): boolean
// λ가 마지막 비공백 줄에 있고, 직전에 tool call 진행 중이 아님

function paneIsBootstrapping(capture: string): boolean
// "mcp servers" 또는 "hooks finished" 가 있지만 λ가 아직 없음

function paneHasActiveTask(capture: string): boolean
// "▸" (tool execution indicator) 가 λ 이후에 있음 → 아직 작업 중

async function dismissTrustPrompt(paneId: string): Promise<void>
// trust prompt 감지 시 'y' + Enter 전송
// kiro-cli의 --trust-all-tools 사용하므로 보통 불필요하지만, 안전장치
```

### 2.3 Worker Pane Lifecycle

**Spawn:**
```typescript
interface SpawnWorkerOptions {
  teamName: string;
  workerName: string;
  agent: string;
  cwd: string;
  direction: 'h' | 'v';
  targetPane?: string;     // split from this pane
  env?: Record<string, string>;
}

function spawnWorkerPane(options: SpawnWorkerOptions): string  // returns pane ID
```

실행 명령:
```bash
KT_TEAM=<teamName> KT_WORKER=<workerName> KT_STATE_ROOT=<stateRoot> \
  kiro-cli chat --trust-all-tools --agent <agent>
```

환경변수:
- `KT_TEAM` — team name
- `KT_WORKER` — worker name
- `KT_STATE_ROOT` — canonical state root path

**State Root Resolution Order (worker 측):**
1. `KT_STATE_ROOT` 환경변수
2. worker identity.json의 `team_state_root`
3. team config.json의 `team_state_root`
4. `~/.kt/` (fallback)

**Liveness Check:**
```typescript
function isWorkerAlive(paneId: string): boolean
// 1. tmux list-panes로 pane 존재 확인
// 2. pane_dead=0 확인
// 3. pane_pid로 process.kill(pid, 0) 확인

function getWorkerPanePid(paneId: string): number | null
```

### 2.4 Team Session Orchestration

```typescript
interface TeamSession {
  name: string;
  workerCount: number;
  cwd: string;
  workerPaneIds: string[];
  leaderPaneId: string;
  hudPaneId: string | null;
}

async function createTeamSession(options: {
  teamName: string;
  workerCount: number;
  workers: Array<{name: string; agent: string}>;
  cwd: string;
}): Promise<TeamSession>
```

동작:
1. 현재 pane ID 기록 (leader)
2. pane layout 계산
3. N개 worker pane 생성
4. 각 worker readiness 대기 (parallel, Promise.allSettled)
5. ready 실패한 worker → 에러 로그 + 계속 진행 (partial start 허용)
6. TeamSession 반환

```typescript
async function teardownTeamSession(session: TeamSession): Promise<void>
```
- 모든 worker pane kill (leader pane 제외)
- HUD pane kill (있으면)
- 에러 무시 (이미 죽은 pane)

### 2.5 Pane Layout

```typescript
function computePaneLayout(workerCount: number): Array<{
  direction: 'h' | 'v';
  targetPane?: string;  // 어떤 pane에서 split할지
}>
```

| Workers | Layout |
|---------|--------|
| 1 | leader \| worker (horizontal) |
| 2 | leader \| worker-1 / worker-2 (leader left, workers stacked right) |
| 3 | 2x2 grid (leader top-left, 3 workers) |
| 4 | 2x2 grid (leader top-left, 4 workers — leader pane 축소) |
| 5+ | leader left column, workers right column stacked |

최소 pane 크기 보장:
- 각 pane 최소 80 columns, 20 rows
- split 후 pane이 너무 작으면 경고 출력

## Deliverables
- [ ] `src/team/tmux-session.ts` — 모든 tmux 함수
- [ ] Readiness detection (3단계: bootstrap → trust prompt → prompt ready)
- [ ] Worker spawn + liveness check
- [ ] Team session create + teardown
- [ ] Pane layout computation

## Acceptance Criteria
- `spawnWorkerPane()` → tmux pane 생성 + kiro-cli 실행 확인 (capture-pane으로 검증)
- `waitForWorkerReady()` → λ prompt 감지 후 true 반환 (45초 이내)
- `dismissTrustPrompt()` → trust prompt 있을 때 자동 dismiss
- `sendKeys()` → worker가 지시를 받고 응답 (capture-pane으로 검증)
- `teardownTeamSession()` → 모든 worker pane 종료, leader pane 유지
- `isTmuxAvailable()` → tmux 없으면 false + 명확한 에러 메시지
- `isInsideTmux()` → tmux 밖이면 false + "run inside tmux session" 메시지
- 3 worker layout → 2x2 grid 생성 확인
