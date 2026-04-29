---
name: team-spawn
description: Delegate work to independent kiro-cli workers via kiro-cli-hive (kh) tmux orchestration
---

# team-spawn

Use `kh` to spawn independent kiro-cli agent sessions via tmux for tasks that exceed what `use_subagent` can handle.

## When to use kh vs use_subagent

| Criteria | use_subagent | kh team |
|---|---|---|
| Simple single-turn query | ✅ Preferred | Overkill |
| Complex multi-step task | Context limited | ✅ Full agent session |
| Need parallel execution | Max 4, shared context | ✅ Independent sessions |
| Need file write/shell | Limited tools | ✅ Full tool access |
| Need multi-turn interaction | Single response | ✅ Persistent session |
| Need worker to use git | No git access | ✅ Full git access |

**Rule of thumb:** If the task needs git, multiple tool calls, or would benefit from its own context window — use `kh`.

## Usage

### Single worker
```bash
kh team 1:explorer "Find all API endpoints in src/ and list them with their HTTP methods"
```

### Parallel workers
```bash
kh team 3:executor "Implement OAuth: 1) callback handler 2) token refresh 3) integration tests"
```

### Check status
```bash
kh status <team-name>
kh status <team-name> --json
```

### Shutdown
```bash
kh shutdown <team-name>
```

## Available Roles

| Role | Agent | Best For |
|---|---|---|
| `executor` | yolo-general | Implementation, building, fixing |
| `explorer` | yolo-explorer | Codebase search, pattern finding |
| `planner` | yolo-planner | Task decomposition, roadmaps |
| `verifier` | yolo-general | Verification, testing |
| `reviewer` | yolo-momus | Code review, quality audits |
| `debugger` | yolo-oracle | Debugging, root cause analysis |
| `writer` | yolo-document-writer | Documentation, changelogs |
| `librarian` | yolo-librarian | Research, API references |
| `frontend` | yolo-frontend-specialist | UI, CSS, React components |
| `analyst` | yolo-general | Requirements analysis |
| `api-reviewer` | yolo-momus | API design review |
| `critic` | yolo-oracle | Critical analysis, devil's advocate |
| `dependency-expert` | yolo-librarian | Dependency audit, version management |
| `git-master` | yolo-general | Git operations, commits, rebases |
| `information-architect` | yolo-planner | Information structure, taxonomies |
| `product-manager` | yolo-planner | Product requirements, user stories |
| `product-analyst` | yolo-general | Feature gap analysis |
| `qa-tester` | yolo-general | Test planning, defect reporting |
| `quality-reviewer` | yolo-momus | Code quality, complexity analysis |
| `style-reviewer` | yolo-momus | Code style, formatting |
| `ux-researcher` | yolo-frontend-specialist | Usability analysis, user flows |

The role router can also auto-select roles based on task keywords (e.g., "find" → explorer, "debug" → debugger).

## Result Format

`kh status <team-name> --json` returns:

```json
{
  "team": "oauth-impl-482910",
  "created_at": "2026-04-28T10:00:00.000Z",
  "workers": [
    { "name": "worker-1", "state": "done", "task": "1" },
    { "name": "worker-2", "state": "working", "task": "2" }
  ],
  "tasks": [
    { "id": "1", "subject": "Implement callback handler", "status": "completed", "owner": "worker-1", "result": "..." },
    { "id": "2", "subject": "Implement token refresh", "status": "in_progress", "owner": "worker-2", "result": null }
  ]
}
```

## Prerequisites

- `tmux` >= 3.0 — must be installed and available on PATH
- `kiro-cli` — the agent runtime each worker session uses
- `kh` — the kiro-cli-hive CLI orchestrator
- Must be running inside a tmux session (`$TMUX` set)
