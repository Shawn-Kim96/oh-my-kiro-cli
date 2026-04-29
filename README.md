# kiro-cli-hive (kh)

> Multi-agent orchestration for kiro-cli, powered by tmux.

**kiro-cli-hive** lets you spawn a team of independent kiro-cli agents in tmux panes, each with its own full tool access, persistent session, and lifecycle. A leader process coordinates task assignment, monitors progress, and collects results — all through file-based IPC and `tmux send-keys`.

Think of it as a foreman on a construction site: you describe the job, `kh` breaks it into tasks, assigns workers, watches for problems, and reports back when everything's done.

## Why kiro-cli-hive?

kiro-cli's built-in `use_subagent` is great for simple, single-turn queries. But it falls short for real work:

| Limitation of `use_subagent` | How `kh` solves it |
|---|---|
| Shared context window | Each worker gets its own independent kiro-cli session |
| Limited tool access | Full shell, git, file I/O — everything kiro-cli can do |
| Single response only | Multi-turn persistent sessions |
| Max ~4 concurrent | Scale to 8+ workers |
| No lifecycle control | Monitor, scale, resume, shutdown |

**Inspired by [oh-my-codex (omx)](https://github.com/Yeachan-Heo/oh-my-codex)** — the operational runtime for OpenAI Codex CLI. `kh` brings the same team orchestration model to kiro-cli, adapted for its agent system and trust model.

## How It Works

```
┌─────────────────────────────────────────────────────────┐
│  tmux session                                           │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   Leader      │  │  worker-0    │  │  worker-1    │  │
│  │   (kh team)   │  │  kiro-cli    │  │  kiro-cli    │  │
│  │               │  │  yolo-general│  │  yolo-explorer│ │
│  │  • monitor    │  │              │  │              │  │
│  │  • dispatch   │  │  reads       │  │  reads       │  │
│  │  • collect    │  │  inbox.md    │  │  inbox.md    │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │                 │                 │           │
│         └────────┬────────┴────────┬────────┘           │
│                  ▼                 ▼                     │
│         ┌──────────────────────────────┐                │
│         │  ~/.kh/teams/<team-name>/    │                │
│         │  ├── config.json             │                │
│         │  ├── phase.json              │                │
│         │  ├── events.jsonl            │                │
│         │  ├── tasks/task-1.json       │                │
│         │  ├── workers/                │                │
│         │  │   ├── worker-0/           │                │
│         │  │   │   ├── inbox.md        │                │
│         │  │   │   ├── status.json     │                │
│         │  │   │   └── identity.json   │                │
│         │  │   └── worker-1/...        │                │
│         │  ├── mailbox/                │                │
│         │  ├── dispatch/               │                │
│         │  └── shutdown/               │                │
│         └──────────────────────────────┘                │
└─────────────────────────────────────────────────────────┘
```

**Communication flow:**
1. Leader writes `inbox.md` for each worker with task + protocol instructions
2. Leader uses `tmux send-keys` to trigger the worker to read its inbox
3. Workers use `kh api` CLI to claim tasks, transition status, and send messages
4. Workers write `status.json` and `result.json` directly to the state directory
5. Leader's monitor loop polls state files, retries failed dispatches, and detects completion

## Requirements

- **Node.js** >= 20
- **tmux** >= 3.0
- **kiro-cli** installed and configured

## Installation

```bash
npm i -g kiro-cli-hive
```

Verify your environment:

```bash
kh doctor
```

Expected output:
```
kh doctor — checking environment...

  ✓ tmux: tmux 3.x
  ✓ kiro-cli: x.x.x
  ✓ kh: /path/to/kh
  ✓ tmux session: yes
```

## Quickstart (3 minutes)

**1. Start a tmux session** (if not already in one):
```bash
tmux new -s work
```

**2. Launch a team:**
```bash
kh team 2:executor "Implement a hello-world Express server with tests"
```

This spawns 2 workers using the `executor` role (mapped to `yolo-general` agent). Each gets a tmux pane, an inbox with the task, and the full worker protocol.

**3. Watch progress:**
```bash
# Quick status
kh status

# Live HUD dashboard
kh hud --team <team-name> --watch
```

**4. Check results:**
```bash
kh status <team-name> --json
```

**5. Shut down when done:**
```bash
kh shutdown <team-name>
```

## CLI Reference

### `kh team [spec] <task>`

Launch a team of agents.

```bash
# 1 executor (default)
kh team "Implement OAuth callback handler"

# 3 executors
kh team 3 "Build REST API with CRUD endpoints"

# 2 explorers
kh team 2:explorer "Find all authentication patterns in the codebase"

# 1 writer
kh team 1:writer "Write API documentation for the auth module"
```

**Spec format:** `[count][:role]` — count defaults to 1, role defaults to `executor`.

**Options:**
- `--cwd <dir>` — working directory for workers (default: current directory)
- `--cleanup` — remove team state directory after completion

### `kh status [team-name]`

Show team status. Omit team name to show the most recent team.

```bash
kh status
kh status my-team-123456
kh status my-team-123456 --json
```

**JSON output includes:** team name, creation time, worker states, and all task statuses with results.

### `kh shutdown <team-name>`

Gracefully shut down a team. Sends shutdown instructions to each worker's inbox, waits for ACKs (up to 15s), then kills panes.

```bash
kh shutdown my-team-123456
kh shutdown my-team-123456 --force   # skip ACK wait, kill immediately
```

### `kh scale-up <team> <count>`

Add workers to a running team. New workers auto-assign to pending tasks.

```bash
kh scale-up my-team-123456 2
kh scale-up my-team-123456 1 --role reviewer
```

### `kh scale-down <team> <worker>`

Remove a specific worker. Fails if the worker is currently busy (`state=working`). Releases any task claims held by the worker.

```bash
kh scale-down my-team-123456 worker-2
```

### `kh resume <team-name>`

Resume a team after the leader process was killed (e.g., Ctrl+C). Reconnects to existing worker panes, respawns dead workers, reassigns pending tasks, and restarts the monitor loop.

```bash
kh resume my-team-123456
```

### `kh api <operation>`

Worker interop API. Used by workers (kiro-cli agents) to interact with team state. Not typically called by humans.

```bash
kh api claim-task --input '{"team_name":"...","task_id":"1","worker":"worker-0"}' --json
kh api transition-task-status --input '{"team_name":"...","task_id":"1","from":"in_progress","to":"completed","result":"Done"}' --json
kh api send-message --input '{"team_name":"...","from_worker":"worker-0","to_worker":"leader","body":"ACK"}' --json
kh api mailbox-list --input '{"team_name":"...","worker":"worker-0"}' --json
kh api mailbox-mark-delivered --input '{"team_name":"...","worker":"worker-0","message_id":"..."}' --json
kh api release-task-claim --input '{"team_name":"...","task_id":"1","claim_token":"..."}' --json
kh api read-task --input '{"team_name":"...","task_id":"1"}' --json
kh api list-tasks --input '{"team_name":"..."}' --json
kh api create-task --input '{"team_name":"...","subject":"...","description":"..."}' --json
```

### `kh hud --team <name> --watch`

Live terminal dashboard showing team state, worker status, task progress, and dispatch stats.

```bash
kh hud --team my-team-123456 --watch
kh hud --team my-team-123456 --watch --interval 1000
```

### `kh doctor`

Check that all prerequisites are installed and accessible.

## Configuration

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `KT_DEFAULT_MODEL` | Default model for all workers | kiro-cli default |
| `KT_WORKER_MODEL` | Override model specifically for workers | `KT_DEFAULT_MODEL` |
| `KT_REASONING_EFFORT` | Reasoning effort: `low`, `medium`, `high` | kiro-cli default |
| `KT_STATE_ROOT` | Override state directory | `~/.kh` |
| `KT_TEAM` | (set automatically) Team name for worker processes | — |
| `KT_WORKER` | (set automatically) Worker name for worker processes | — |

**Example — low-token workers:**
```bash
KT_WORKER_MODEL=claude-sonnet KT_REASONING_EFFORT=low kh team 3:executor "Quick analysis task"
```

## Worker Roles

Each role maps to a kiro-cli agent with specialized capabilities:

| Role | Agent | Best For |
|---|---|---|
| `executor` | `yolo-general` | Implementation, building, fixing |
| `explorer` | `yolo-explorer` | Codebase search, pattern finding |
| `planner` | `yolo-planner` | Task decomposition, roadmaps |
| `verifier` | `yolo-general` | Verification, testing |
| `reviewer` | `yolo-momus` | Code review, quality audits |
| `debugger` | `yolo-oracle` | Debugging, root cause analysis |
| `writer` | `yolo-document-writer` | Documentation, changelogs |
| `librarian` | `yolo-librarian` | Research, API references |
| `frontend` | `yolo-frontend-specialist` | UI, CSS, React components |
| `analyst` | `yolo-general` | Requirements analysis, acceptance criteria |
| `api-reviewer` | `yolo-momus` | API design review, contract validation |
| `critic` | `yolo-oracle` | Critical analysis, devil's advocate |
| `dependency-expert` | `yolo-librarian` | Dependency audit, version management |
| `git-master` | `yolo-general` | Git operations, commits, rebases |
| `information-architect` | `yolo-planner` | Information structure, taxonomies |
| `product-manager` | `yolo-planner` | Product requirements, user stories |
| `product-analyst` | `yolo-general` | Feature gap analysis, product assessment |
| `qa-tester` | `yolo-general` | Test planning, defect reporting |
| `quality-reviewer` | `yolo-momus` | Code quality, complexity analysis |
| `style-reviewer` | `yolo-momus` | Code style, formatting, conventions |
| `ux-researcher` | `yolo-frontend-specialist` | Usability analysis, user flows |

The role router can also auto-select roles based on task keywords (e.g., a task containing "find" or "search" routes to `explorer`).

## Phase System

Teams progress through phases automatically based on task outcomes:

```
exec ──→ verify ──→ complete
                ──→ fix ──→ exec (retry)
                         ──→ failed (max attempts exceeded)
```

- **exec** — workers implement the task
- **verify** — verification of completed work
- **fix** — retry failed tasks (max 3 attempts by default)
- **complete** — all tasks succeeded
- **failed** — max fix attempts exceeded or unrecoverable error

## State Directory

All team state lives in `~/.kh/teams/<team-name>/`:

```
config.json          # Team configuration
phase.json           # Current phase + transition history
events.jsonl         # Append-only event log
monitor-snapshot.json
tasks/
  task-1.json        # Task state (status, owner, result)
workers/
  worker-0/
    identity.json    # Worker identity + team binding
    inbox.md         # Instructions from leader
    status.json      # Current worker state
    heartbeat.json   # Liveness tracking
mailbox/             # Inter-worker messaging
dispatch/            # Dispatch queue for reliable delivery
shutdown/            # Shutdown coordination
  request.json
  acks/
```

File-based IPC with directory-based locks ensures safe concurrent access from multiple processes.

## Comparison with omx

`kh` is directly inspired by [oh-my-codex (omx)](https://github.com/Yeachan-Heo/oh-my-codex). Key differences:

| | omx | kh |
|---|---|---|
| Wraps | OpenAI Codex CLI | kiro-cli |
| State backend | MCP servers | File-based IPC |
| Worker comms | MCP protocol | `kh api` CLI + file writes |
| Phases | plan → exec → verify | exec → verify → fix |
| Worker CLI | `codex` | `kiro-cli chat` |

See [docs/comparison-with-omx.md](docs/comparison-with-omx.md) for a detailed comparison.

## Documentation

- [Architecture](docs/architecture.md) — system design, communication flow, state machine
- [Worker Protocol](docs/worker-protocol.md) — complete worker lifecycle reference
- [Comparison with omx](docs/comparison-with-omx.md) — feature comparison and design decisions
- [Future: Prompt Mode](docs/future-prompt-mode.md) — non-tmux worker design for CI/CD

## License

MIT
