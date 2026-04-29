# Future: Prompt Mode (Non-tmux Workers)

This document describes a future worker execution mode that doesn't require tmux, enabling kt to run in CI/CD pipelines, containers, and headless environments.

## Motivation

The current architecture requires tmux because:
1. Workers are interactive kiro-cli sessions in tmux panes
2. The leader communicates via `tmux send-keys`
3. Worker readiness is detected by capturing pane output

This works well for interactive development but blocks adoption in:
- CI/CD pipelines (no tmux, no interactive terminal)
- Docker containers (headless)
- Remote execution environments
- Automated workflows

## Proposed Design

### Prompt Mode Workers

Instead of spawning an interactive kiro-cli session in a tmux pane, prompt mode would invoke kiro-cli in a non-interactive, single-turn mode for each task:

```bash
kiro-cli chat --no-interactive --agent yolo-general --message "<task instructions>"
```

The worker lifecycle becomes:
1. Leader creates task + writes inbox
2. Leader spawns `kiro-cli chat --no-interactive` as a child process (not a tmux pane)
3. kiro-cli executes the task and exits
4. Leader reads the result from stdout or result file
5. Leader transitions task status

### Interface Sketch

```typescript
interface PromptWorker {
  spawn(task: TaskState, inbox: string): ChildProcess;
  waitForCompletion(timeout: number): Promise<{ stdout: string; exitCode: number }>;
  kill(): void;
}

interface WorkerBackend {
  type: 'tmux' | 'prompt';
  spawn(options: SpawnOptions): Worker;
  isReady(worker: Worker): Promise<boolean>;
  sendMessage(worker: Worker, message: string): void;
  getOutput(worker: Worker): string;
}
```

The `runtime.ts` would accept a `WorkerBackend` instead of directly calling tmux functions:

```typescript
async function startTeam(options: TeamOptions & { backend?: WorkerBackend }) {
  const backend = options.backend ?? createTmuxBackend();
  // ... rest of orchestration uses backend interface
}
```

### kiro-cli Requirements

For prompt mode to work, kiro-cli would need:

1. **`--no-interactive` flag** — run a single task and exit (no REPL loop)
2. **`--message` flag** — pass the task as a CLI argument instead of interactive input
3. **Structured output** — write results to a file or stdout in a parseable format
4. **Non-zero exit on failure** — so the leader can detect task failures from the exit code

Currently kiro-cli's `chat` command is interactive-only. These flags would need to be added upstream.

### Multi-turn Prompt Mode

For tasks that require multiple turns (e.g., claim → work → complete), prompt mode could use a wrapper script:

```bash
#!/bin/bash
# Worker wrapper for prompt mode
STATE_ROOT=$KT_STATE_ROOT
TEAM=$KT_TEAM
WORKER=$KT_WORKER

# 1. Read inbox
INBOX=$(cat "$STATE_ROOT/teams/$TEAM/workers/$WORKER/inbox.md")

# 2. Run kiro-cli with full instructions
kiro-cli chat --no-interactive --agent "$AGENT" --message "$INBOX"

# 3. Write completion status
echo '{"state":"done","current_task_id":null,"reason":null}' > \
  "$STATE_ROOT/teams/$TEAM/workers/$WORKER/status.json"
```

### Communication Without tmux

| Current (tmux) | Prompt Mode |
|---|---|
| `tmux send-keys` | Pass message as CLI arg or stdin |
| Pane capture for readiness | Process spawn = ready |
| `isPaneAlive()` | `process.kill(pid, 0)` |
| Interactive multi-turn | Single invocation per task |
| `kt api` from within session | Pre/post hooks in wrapper script |

### Configuration

```bash
# Use prompt mode
KT_WORKER_BACKEND=prompt kt team 2:executor "task"

# Or via CLI flag
kt team 2:executor "task" --backend prompt
```

## Migration Path

1. Extract a `WorkerBackend` interface from current tmux-specific code
2. Implement `TmuxBackend` wrapping existing functions (no behavior change)
3. Implement `PromptBackend` using child processes
4. Add `--backend` flag to `kt team`
5. Wait for kiro-cli `--no-interactive` support

## Limitations

Prompt mode workers would lose:
- Multi-turn interaction within a single task
- Real-time visibility into worker progress (no pane to watch)
- Ability for workers to ask clarifying questions
- Interactive debugging

These tradeoffs are acceptable for CI/CD where tasks are well-defined and don't need human oversight.
