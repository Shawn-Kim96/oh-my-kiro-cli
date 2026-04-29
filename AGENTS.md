# Agents

kiro-team (kt) orchestrates multiple kiro-cli agents via tmux. Each worker runs in its own tmux pane with a dedicated kiro-cli session.

## Available Roles

| Role | Agent | Purpose |
|------|-------|---------|
| executor | yolo-general | Implementation, building, fixing, migrations |
| explorer | yolo-explorer | Codebase search, pattern finding, file discovery |
| planner | yolo-planner | Task decomposition, roadmaps, planning |
| verifier | yolo-general | Verification, testing completed work |
| reviewer | yolo-momus | Code review, quality audits, anti-pattern detection |
| debugger | yolo-oracle | Debugging, root cause analysis, stack trace investigation |
| writer | yolo-document-writer | Documentation, READMEs, changelogs, API docs |
| librarian | yolo-librarian | Research, API references, best practices |
| frontend | yolo-frontend-specialist | UI, CSS, React components, responsive layouts |

## How Workers Are Launched

Each worker is spawned as:
```bash
KT_TEAM=<team> KT_WORKER=<worker> KT_STATE_ROOT=<root> kiro-cli chat --trust-all-tools --agent <agent>
```

Workers receive instructions via `inbox.md` in their state directory and interact with the leader through the `kt api` CLI.

## Role Selection

Roles can be specified explicitly via the spec format:
```bash
kt team 2:explorer "Find all API endpoints"
kt team 1:writer "Write the changelog"
```

The role router also auto-selects roles based on task keywords:
- "find", "search", "grep" → explorer
- "debug", "investigate", "root cause" → debugger
- "doc", "readme", "changelog" → writer
- "review", "audit", "lint" → reviewer
- "implement", "build", "fix" → executor
