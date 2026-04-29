# Architecture

## System Overview

kiro-cli-hive has three planes:

- **Execution plane** — kiro-cli agents running in tmux panes, doing the actual work
- **Control plane** — the `kch` leader process that spawns workers, dispatches tasks, monitors health, and manages lifecycle
- **State plane** — file-based IPC under `~/.kch/` that all processes read and write

`kch` resolves the Kiro CLI command from `KCH_KIRO_CLI`, then `KIRO_CLI`, then `kiro-cli` on `PATH`, and finally the official installer location at `~/.local/bin/kiro-cli`.

```
┌─ Control Plane ──────────────────────────────────────────────┐
│                                                              │
│  kch team 2:executor "task"                                   │
│    │                                                         │
│    ├─ initTeamState()     → create ~/.kch/teams/<name>/       │
│    ├─ createTeamSession() → spawn tmux panes                 │
│    ├─ generateWorkerInbox() → write inbox.md per worker      │
│    ├─ queueInboxInstruction() → dispatch via send-keys       │
│    └─ monitorTeam()       → poll loop until terminal         │
│                                                              │
└──────────────────────────────────────────────────────────────┘
         │ tmux send-keys              │ file read/write
         ▼                             ▼
┌─ Execution Plane ────────┐  ┌─ State Plane ─────────────────┐
│                          │  │                                │
│  ┌────────────────────┐  │  │  ~/.kch/teams/<team>/           │
│  │ worker-0 (pane)    │  │  │  ├── config.json               │
│  │ kiro-cli chat      │──┼──│  ├── phase.json                │
│  │ --agent yolo-gen   │  │  │  ├── events.jsonl              │
│  └────────────────────┘  │  │  ├── monitor-snapshot.json     │
│                          │  │  ├── tasks/                    │
│  ┌────────────────────┐  │  │  │   └── task-1.json           │
│  │ worker-1 (pane)    │  │  │  ├── workers/                  │
│  │ kiro-cli chat      │──┼──│  │   ├── worker-0/             │
│  │ --agent yolo-expl  │  │  │  │   │   ├── inbox.md          │
│  └────────────────────┘  │  │  │   │   ├── status.json       │
│                          │  │  │   │   ├── identity.json     │
└──────────────────────────┘  │  │   │   └── heartbeat.json    │
                              │  │   └── worker-1/...          │
                              │  ├── mailbox/                  │
                              │  ├── dispatch/requests.json    │
                              │  └── shutdown/                 │
                              │      ├── request.json          │
                              │      └── acks/                 │
                              └────────────────────────────────┘
```

## Communication Flow

There are two communication channels:

### 1. Leader → Worker: `tmux send-keys`

The leader cannot write directly into a kiro-cli session's context. Instead:

1. Leader writes `inbox.md` to the worker's state directory
2. Leader calls `tmux send-keys` to type a trigger message into the worker's pane
3. The trigger message tells the worker to read its inbox file
4. The worker (kiro-cli agent) reads the file and follows the instructions

This is managed by the dispatch queue (`dispatch/requests.json`) which handles deduplication, retries, and failure tracking.

### 2. Worker → Leader: `kch api` CLI + file writes

Workers communicate back through two mechanisms:

- **`kch api` CLI** — for structured operations: `claim-task`, `transition-task-status`, `send-message`, etc. These go through the `handleApiOperation()` function with proper locking.
- **Direct file writes** — for status updates: workers write `status.json`, `result.json`, and `heartbeat.json` directly.

### Message Flow Example

```
Leader                          Worker-0                    State Files
  │                                │                            │
  ├─ writeWorkerInbox() ──────────────────────────────────────→ inbox.md
  ├─ enqueueDispatchRequest() ────────────────────────────────→ dispatch/requests.json
  ├─ sendKeys(trigger) ──────────→ │                            │
  │                                ├─ reads inbox.md ←──────────┤
  │                                ├─ kch api send-message ────→ mailbox/leader.json (ACK)
  │                                ├─ kch api claim-task ──────→ tasks/task-1.json
  │                                ├─ writes status.json ─────→ workers/worker-0/status.json
  │                                │  (does work...)            │
  │                                ├─ writes result.json ─────→ workers/worker-0/result.json
  │                                ├─ kch api transition ──────→ tasks/task-1.json (completed)
  │                                ├─ writes status.json ─────→ (idle)
  │                                ├─ kch api send-message ────→ mailbox/leader.json (DONE)
  │                                │                            │
  ├─ monitorTeam() polls ─────────────────────────────────────← tasks/, workers/
  ├─ detects all terminal ─────→ exits                          │
```

## Phase State Machine

```
         ┌──────────────────────────────────────┐
         │                                      │
         ▼                                      │
       exec ──→ verify ──→ complete             │
                  │                             │
                  ├──→ failed                   │
                  │                             │
                  └──→ fix ──→ exec ────────────┘
                        │        (retry)
                        ├──→ verify
                        ├──→ complete
                        └──→ failed (max attempts exceeded)
```

Transitions are validated by `orchestrator.ts`. The `phase-controller.ts` can infer the target phase from task counts and build multi-hop transition paths (e.g., `exec → verify → fix`).

Fix attempts are capped at `max_fix_attempts` (default: 3). Exceeding the cap auto-transitions to `failed`.

## File-Based IPC Design

All state is stored as JSON files under `~/.kch/`. This design was chosen over MCP servers (used by omx) for simplicity:

- **No server process** — state survives leader crashes; `kch resume` reconnects
- **Atomic writes** — all writes use tmp + rename pattern (`writeJson()` in `safe-json.ts`)
- **Directory-based locks** — `mkdir` is atomic on POSIX; used for task claims, mailbox, dispatch, and scaling operations (`state/locks.ts`)
- **Stale lock recovery** — locks older than 30s are automatically broken
- **Append-only events** — `events.jsonl` provides an audit trail

### Lock Hierarchy

| Lock | Scope | Protects |
|------|-------|----------|
| `team` | Whole team | Team config |
| `task-{id}` | Single task | Task claim/transition |
| `mailbox-{worker}` | Single worker | Mailbox messages |
| `dispatch` | Whole team | Dispatch queue |
| `scaling` | Whole team | Worker add/remove |

## Monitor Loop

The leader runs a poll-based monitor loop (`monitorTeam()` in `runtime.ts`):

Every 5 seconds:
1. **Worker health** — check if each worker's tmux pane is alive via `isPaneAlive()`
2. **Task status** — read all task files, emit events for completed/failed
3. **Dispatch reliability** — retry failed dispatches, deliver pending mailbox messages
4. **Terminal check** — if all tasks are terminal AND all workers are idle/done → exit
5. **Dead worker check** — if all panes are dead → exit
6. **Snapshot** — write `monitor-snapshot.json` with current worker states

## Dispatch Queue

The dispatch system (`mcp-comm.ts`) ensures reliable message delivery:

1. `queueInboxInstruction()` — writes inbox, enqueues dispatch request (with dedup)
2. Checks if worker pane is ready (`paneLooksReady()` — looks for `λ` prompt)
3. If ready: `sendKeys()` + mark as `notified`
4. If not ready: mark as `failed` for retry
5. `retryFailedDispatches()` — called each monitor iteration, retries up to 3 times

States: `pending → notified → delivered` or `pending → failed → (retry) → notified`

## Tmux Session Layout

`createTeamSession()` spawns worker panes relative to the leader pane:

| Workers | Layout |
|---------|--------|
| 1 | Leader left, worker right (horizontal split) |
| 2 | Leader left, 2 workers stacked right |
| 3-4 | 2×2 grid |
| 5+ | Leader left, workers stacked vertically on right |

Worker readiness is detected by capturing pane output and looking for the kiro-cli `λ` prompt. Trust prompts are auto-dismissed.

## Hooks

Three background hooks run alongside the monitor:

- **Heartbeat monitor** (`hooks/heartbeat.ts`) — polls pane captures every 10s, detects stale (60s no activity) and dead workers
- **Idle nudge** (`hooks/idle-nudge.ts`) — nudges idle workers with pending tasks after 2 minutes, escalates to leader after 3 nudges
- **Notify hook** (`hooks/notify-hook.ts`) — polls `events.jsonl` every 3s, fires callbacks for task/worker events, deduplicates via monitor snapshot
