# Comparison with oh-my-codex (omx)

kiro-team (kt) is directly inspired by [oh-my-codex](https://github.com/Yeachan-Heo/oh-my-codex), the operational runtime for OpenAI Codex CLI. This document explains the similarities, differences, and design decisions.

## Feature Comparison

| Feature | omx | kt |
|---|---|---|
| **Wraps** | OpenAI Codex CLI | kiro-cli |
| **Team mode** | `omx team N:role "task"` | `kt team N:role "task"` |
| **Worker panes** | tmux split panes | tmux split panes |
| **HUD dashboard** | Yes | Yes (`kt hud --watch`) |
| **Dynamic scaling** | Yes | Yes (`kt scale-up`, `kt scale-down`) |
| **Resume** | Yes | Yes (`kt resume`) |
| **Graceful shutdown** | Yes (ACK-based) | Yes (ACK-based) |
| **State backend** | MCP servers | File-based IPC |
| **Worker comms** | MCP protocol | `kt api` CLI + file writes |
| **Phases** | plan → exec → verify | exec → verify → fix |
| **Role system** | Role prompts + skills | Agent mapping (role → kiro-cli agent) |
| **Mailbox** | MCP-backed | File-based JSON |
| **Event log** | MCP-backed | Append-only JSONL |
| **Locking** | MCP server handles | Directory-based (`mkdir`) |
| **Doctor check** | `omx doctor` | `kt doctor` |
| **Language** | TypeScript + Rust | TypeScript |
| **Package manager** | npm | npm |

## Architecture Differences

### State: MCP Servers vs File-Based IPC

**omx** uses MCP (Model Context Protocol) servers as the state backend. Workers communicate through MCP tools, and state is managed by server processes.

**kt** uses plain files under `~/.kt/`. Workers use the `kt api` CLI (which reads/writes JSON files with directory-based locks) and write status files directly.

**Why files?** kiro-cli doesn't have the same MCP integration that Codex has. File-based IPC is simpler to implement, debug, and recover from. If the leader crashes, state files survive on disk and `kt resume` can reconnect. No server process needs to be running.

### Communication: MCP vs tmux send-keys + CLI

**omx** workers call MCP tools to interact with team state.

**kt** workers use two channels:
1. `tmux send-keys` — leader types trigger messages into worker panes
2. `kt api` — workers call a CLI command that reads/writes state files

**Why not MCP?** kiro-cli's agent system doesn't expose MCP tools to the agent in the same way Codex does. The `kt api` CLI approach works with any kiro-cli agent without requiring MCP server configuration.

### Phases: No Plan Phase

**omx** has a `plan` phase where a planner agent decomposes the task before execution.

**kt** starts directly in `exec`. The leader creates a single task from the user's input and assigns it to workers. Task decomposition can happen within a worker's session if needed.

**Why?** kiro-cli agents are capable of planning within their own sessions. Adding a separate plan phase would add latency without clear benefit for the common case. Workers can use `kt api create-task` to create subtasks if they need to decompose work.

### Fix Phase

**omx** doesn't have an explicit fix phase — failed tasks are handled by the verify phase or manual intervention.

**kt** has a dedicated `fix` phase with retry counting (max 3 attempts). When verification fails, the system transitions to `fix`, which can loop back to `exec` for another attempt. This provides automatic retry without human intervention.

### Worker Identity

**omx** workers identify through MCP context.

**kt** workers identify through environment variables (`KT_TEAM`, `KT_WORKER`, `KT_STATE_ROOT`) set when the pane is spawned, plus an `identity.json` file in their state directory.

### Role System

**omx** uses role prompts and a skills system with productized behaviors.

**kt** maps roles to kiro-cli agents (e.g., `executor` → `yolo-general`, `explorer` → `yolo-explorer`). Each kiro-cli agent already has its own specialized behavior, so kt leverages the existing agent system rather than adding another prompt layer.

## What kt Borrows from omx

- The `N:role "task"` spec format
- tmux-based pane management with leader/worker layout
- HUD dashboard concept
- Graceful shutdown with ACK protocol
- Dynamic scaling (scale-up/scale-down)
- Resume after leader disconnect
- Doctor command for environment checks
- The overall philosophy: wrap the CLI, don't replace it

## What kt Does Differently

- File-based IPC instead of MCP servers (simpler, no server process)
- `kt api` CLI instead of MCP tools (works with any kiro-cli agent)
- exec → verify → fix phase model with automatic retries
- Role router with keyword-based auto-selection
- Dispatch queue with deduplication and retry logic
- Heartbeat monitoring via pane capture diffing
- Idle nudge system with escalation
