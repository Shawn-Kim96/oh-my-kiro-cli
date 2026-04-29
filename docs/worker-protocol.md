# Worker Protocol Reference

This document describes the complete protocol that kiro-cli agents follow when operating as `kch` workers.

## Overview

A worker is a kiro-cli agent running in a tmux pane. It receives instructions via an `inbox.md` file and interacts with team state through the `kch api` CLI and direct file writes.

## State Root Resolution

Workers resolve the team state directory in this order:

1. `$KCH_STATE_ROOT` environment variable
2. `$KT_STATE_ROOT` compatibility environment variable
3. `$KH_STATE_ROOT` compatibility environment variable
4. Worker identity file: `<state_root>/teams/<team>/workers/<worker>/identity.json` → `team_state_root`
5. Team config: `<state_root>/teams/<team>/config.json` → `team_state_root`
6. Default: `~/.kch/`

Environment variables `KT_TEAM` and `KT_WORKER` are set automatically when the pane is spawned.

## Startup Protocol

When a worker's pane becomes ready (kiro-cli shows the `λ` prompt), the leader sends a trigger message via `tmux send-keys`. The worker must:

**1. Send startup ACK:**
```bash
kch api send-message --input '{
  "team_name": "<team>",
  "from_worker": "<worker>",
  "to_worker": "leader",
  "body": "ACK: <worker> initialized"
}' --json
```

`from_worker` is required on every `kch api` call. The API cannot auto-detect worker identity.

**2. Read inbox:**
```
<state_root>/teams/<team>/workers/<worker>/inbox.md
```

**3. Read assigned task:**
```
<state_root>/teams/<team>/tasks/task-<id>.json
```

## Task Lifecycle

### Claim

```bash
kch api claim-task --input '{
  "team_name": "<team>",
  "task_id": "<id>",
  "worker": "<worker>",
  "expected_version": 1
}' --json
```

Returns `{ ok: true, data: { claim_token: "...", version: 2 } }` on success.

Claim uses optimistic concurrency: if `expected_version` doesn't match the task's current version, the claim fails. The task must be in `pending` or `blocked` status.

### Work

After claiming, the worker:

1. Updates status to `working`:
   ```json
   // Write to <state_root>/teams/<team>/workers/<worker>/status.json
   {
     "state": "working",
     "current_task_id": "<id>",
     "reason": null,
     "updated_at": "<ISO>"
   }
   ```

2. Does the actual work using kiro-cli tools (shell, file I/O, git, etc.)

3. Does not commit, stage, merge, or cherry-pick unless the leader explicitly launched the team with a git mutation policy.

4. Writes result:
   ```json
   // Write to <state_root>/teams/<team>/workers/<worker>/result.json
   {
     "status": "done",
     "result": "<detailed findings/output>",
     "updated_at": "<ISO>"
   }
   ```

### Complete

```bash
kch api transition-task-status --input '{
  "team_name": "<team>",
  "task_id": "<id>",
  "from": "in_progress",
  "to": "completed",
  "claim_token": "<token>",
  "result": "<summary>"
}' --json
```

After completion, update status to `idle` and notify the leader:

```bash
kch api send-message --input '{
  "team_name": "<team>",
  "from_worker": "<worker>",
  "to_worker": "leader",
  "body": "DONE: task-<id> completed"
}' --json
```

### Fail

```bash
kch api transition-task-status --input '{
  "team_name": "<team>",
  "task_id": "<id>",
  "from": "in_progress",
  "to": "failed",
  "claim_token": "<token>",
  "error": "<what went wrong>"
}' --json
```

### Release Claim

If a worker needs to give up a task without completing or failing it:

```bash
kch api release-task-claim --input '{
  "team_name": "<team>",
  "task_id": "<id>",
  "claim_token": "<token>"
}' --json
```

This resets the task to `pending` with no owner.

### Task Status Transitions

```
pending ──→ in_progress (via claim-task)
pending ──→ blocked
blocked ──→ pending
blocked ──→ in_progress
in_progress ──→ completed
in_progress ──→ failed
failed ──→ pending (retry)
```

`completed` and `failed` are terminal — they clear `owner` and `claim_token`.

## kch api Operations

All operations accept `--input '<json>'` and optionally `--json` for structured output.

| Operation | Input Fields | Description |
|---|---|---|
| `claim-task` | `team_name`, `task_id`, `worker`, `expected_version` | Claim a pending task |
| `transition-task-status` | `team_name`, `task_id`, `from`, `to`, `claim_token`, `result?`, `error?` | Transition task state |
| `release-task-claim` | `team_name`, `task_id`, `claim_token` | Release claim, reset to pending |
| `read-task` | `team_name`, `task_id` | Read a single task |
| `list-tasks` | `team_name` | List all tasks |
| `create-task` | `team_name`, `subject`, `description`, `blocked_by?`, `requires_code_change?` | Create a new task |
| `send-message` | `team_name`, `from_worker`, `to_worker`, `body` | Send a mailbox message |
| `mailbox-list` | `team_name`, `worker` | List messages for a worker |
| `mailbox-mark-delivered` | `team_name`, `worker`, `message_id` | Mark message as delivered |

**Response format:**
```json
{
  "ok": true,
  "operation": "claim-task",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "data": { "claim_token": "uuid", "version": 2 }
}
```

On error:
```json
{
  "ok": false,
  "operation": "claim-task",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "error": "Task claim failed (wrong version, status, or not found)"
}
```

## Mailbox Protocol

Workers can send messages to each other or to the leader.

**Check mailbox** (when instructed by leader via send-keys):
```bash
kch api mailbox-list --input '{"team_name":"<team>","worker":"<worker>"}' --json
```

**Mark as delivered** after reading:
```bash
kch api mailbox-mark-delivered --input '{
  "team_name": "<team>",
  "worker": "<worker>",
  "message_id": "<id>"
}' --json
```

The leader's monitor loop calls `deliverPendingMailboxMessages()` which sends a `tmux send-keys` nudge to workers with unread messages.

## Blocked Protocol

If a worker cannot proceed:

1. Update status:
   ```json
   {
     "state": "blocked",
     "current_task_id": "<id>",
     "reason": "<why blocked>",
     "updated_at": "<ISO>"
   }
   ```

2. Send message to leader explaining the blocker.

## Shutdown Protocol

When the leader initiates shutdown:

1. Leader writes `shutdown/request.json` and a shutdown inbox for each worker
2. Leader sends `tmux send-keys` with shutdown notification
3. Worker reads shutdown inbox and:
   - Finishes current atomic operation
   - Leaves uncommitted work in place unless explicitly instructed to commit
   - Sends shutdown ACK:
     ```bash
     kch api send-message --input '{
       "team_name": "<team>",
       "from_worker": "<worker>",
       "to_worker": "leader",
       "body": "SHUTDOWN_ACK: <worker>"
     }' --json
     ```
4. Leader waits up to 15s for ACKs, then kills all panes

With `--force`, the leader skips the ACK wait and kills panes immediately.

## Worker Rules

- Focus ONLY on the assigned task
- Do NOT spawn subagents (`use_subagent`)
- Do NOT modify files outside task scope
- Do NOT write task lifecycle fields (`status`, `owner`, `claim_token`) directly — use `kch api`
- Always write `result.json` BEFORE reporting completion via `kch api`
- Always include `claim_token` in every task transition or release call
- Always include `from_worker` in every `kch api` call
- Do NOT commit unless explicitly instructed by the leader
