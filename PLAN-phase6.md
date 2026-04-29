# kiro-team (kt) — Phase 6: HUD + Hooks + Notifications

## Goal
실시간 상태 표시 (HUD pane) + worker 이벤트 감지 + leader 알림 + idle nudge.

## Preconditions
- Phase 0-5 완료

## Steps

### 6.1 HUD Pane (`src/hud/`)

**HUD pane 생성:**
```typescript
// src/hud/index.ts
const HUD_HEIGHT_LINES = 6;  // tmux pane height

async function startHud(teamName: string, stateRoot: string): Promise<string>
// tmux split-pane -v -l <HUD_HEIGHT_LINES> "kt hud --watch --team <teamName>"
// returns hud pane ID

async function stopHud(paneId: string): Promise<void>
// killPane(paneId)

function registerResizeHook(teamName: string, hudPaneId: string, tmuxTarget: string): string
// tmux set-hook -t <target> after-resize-pane "resize-pane -t <hudPaneId> -y <HUD_HEIGHT_LINES>"
// returns hook name (for cleanup)

function unregisterResizeHook(hookName: string, tmuxTarget: string): void
```

**HUD 렌더링:**
```typescript
// src/hud/render.ts
function renderHud(state: HudState): string
```

출력 (ANSI colors):
```
╔══════════════════════════════════════════════════════════════╗
║ [kt] alpha │ phase: exec │ tasks: 1/3 done │ ⏱ 2m30s       ║
║ worker-1: ⚙ working (task-1) │ worker-2: ◯ idle │ w-3: ✗   ║
║ dispatch: 2 ok, 0 failed │ mailbox: 1 pending              ║
╚══════════════════════════════════════════════════════════════╝
```

Worker 상태 아이콘:
- `⚙` working
- `◯` idle
- `⏳` blocked
- `✓` done
- `✗` dead/failed
- `↓` draining

**HUD state 수집:**
```typescript
// src/hud/state.ts
interface HudState {
  teamName: string;
  phase: string;
  workers: Array<{
    name: string;
    state: string;
    taskId: string | null;
    alive: boolean;
  }>;
  tasks: {total: number; completed: number; failed: number; in_progress: number; pending: number; blocked: number};
  dispatch: {ok: number; failed: number; pending: number};
  mailbox: {pending: number};
  elapsed: number;
  updatedAt: string;
}

async function collectHudState(teamName: string, stateRoot: string): Promise<HudState>
```

**`kt hud --watch` 명령:**
```typescript
program.command('hud')
  .option('--watch', 'Continuous update')
  .option('--team <name>', 'Team name')
  .option('--interval <ms>', 'Update interval', '2000')
  .action(async (options) => {
    while (true) {
      const state = await collectHudState(options.team, ktStateDir());
      process.stdout.write('\x1B[2J\x1B[H');  // clear screen
      process.stdout.write(renderHud(state));
      await sleep(parseInt(options.interval));
    }
  });
```

### 6.2 Heartbeat Monitor (`src/hooks/heartbeat.ts`)

```typescript
interface HeartbeatMonitorOptions {
  intervalMs: number;          // default 10000
  staleThresholdMs: number;    // default 60000
}

async function startHeartbeatMonitor(
  teamName: string,
  stateRoot: string,
  workers: WorkerInfo[],
  options: HeartbeatMonitorOptions,
  callbacks: {
    onStale: (workerName: string, lastSeen: string) => void;
    onDead: (workerName: string) => void;
    onRecovered: (workerName: string) => void;
  },
): Promise<{stop: () => void}>
```

**Leader-side heartbeat 업데이트:**
Monitor loop에서 각 worker에 대해:
1. `capturePane(paneId, 5)` → 마지막 5줄 캡처
2. 이전 캡처와 비교 → 변경 있으면 활동 중
3. 활동 감지 → `updateWorkerHeartbeat(teamName, workerName)`
4. 변경 없음 + staleThreshold 초과 → onStale 콜백

이 방식의 장점: worker가 heartbeat를 직접 업데이트할 필요 없음 (프로토콜 단순화).

### 6.3 Notification Hook (`src/hooks/notify-hook.ts`)

```typescript
interface NotifyHookCallbacks {
  onTaskCompleted: (taskId: string, workerName: string, result: string) => void;
  onTaskFailed: (taskId: string, workerName: string, error: string) => void;
  onWorkerIdle: (workerName: string) => void;
  onAllWorkersIdle: () => void;
  onWorkerStopped: (workerName: string) => void;
  onDispatchFailed: (requestId: string, reason: string) => void;
}

async function startNotifyHook(
  teamName: string,
  stateRoot: string,
  callbacks: NotifyHookCallbacks,
): Promise<{stop: () => void}>
```

구현:
- events.jsonl을 polling (마지막 읽은 위치 기억)
- 새 이벤트 → 해당 콜백 호출
- MonitorSnapshot으로 중복 알림 방지:
  - 이미 알린 event timestamp 기록
  - 같은 event 재알림 방지

Leader 알림 방식:
```typescript
function notifyLeader(message: string): void
// tmux display-message -d 5000 "kt: <message>"
// -d 5000 = 5초간 표시
```

### 6.4 Idle Nudge (`src/hooks/idle-nudge.ts`)

```typescript
interface IdleNudgeTracker {
  workerName: string;
  idleSince: string;
  nudgeCount: number;
  lastNudgeAt: string | null;
}

async function checkIdleNudges(
  teamName: string,
  stateRoot: string,
  workers: WorkerInfo[],
  options: {
    idleThresholdMs: number;     // default 120000 (2분)
    maxNudges: number;           // default 3
  },
): Promise<Array<{workerName: string; action: 'nudge' | 'escalate'}>>
```

Nudge 로직:
1. Worker idle + pending tasks 존재 → nudge
2. Nudge: `sendKeys(paneId, "You have pending tasks. Check your inbox.")` + nudgeCount++
3. nudgeCount > maxNudges → escalate (leader에게 알림: "worker-1 is unresponsive after 3 nudges")

전체 team nudge:
- 모든 worker idle + pending tasks → leader nudge: "All workers idle but tasks remain"
- 모든 worker idle + 모든 task terminal → leader nudge: "All work complete, ready for shutdown"

## Deliverables
- [ ] `src/hud/index.ts` — HUD pane lifecycle + resize hook
- [ ] `src/hud/render.ts` — ANSI rendering
- [ ] `src/hud/state.ts` — state collection
- [ ] `src/hooks/heartbeat.ts` — leader-side heartbeat monitor
- [ ] `src/hooks/notify-hook.ts` — event notification with dedup
- [ ] `src/hooks/idle-nudge.ts` — idle worker nudge + escalation
- [ ] `kt hud --watch` 명령어

## Acceptance Criteria
- HUD pane이 6줄 높이로 생성됨
- HUD가 2초마다 갱신 (worker 상태, task 진행률, phase)
- Terminal resize 시 HUD 높이 유지 (resize hook)
- Worker 완료 시 `tmux display-message "kt: worker-1 completed task-1"` 표시
- Stale worker (60초 무활동) → 경고 로그
- Dead worker (pane 종료) → 즉시 감지 + 이벤트
- Idle worker (2분) + pending tasks → 자동 nudge (send-keys)
- 3회 nudge 후 무응답 → leader에게 escalation 알림
- 중복 알림 방지 (MonitorSnapshot 기반)
