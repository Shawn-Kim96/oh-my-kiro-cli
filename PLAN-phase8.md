# kiro-team (kt) — Phase 8: omkc Integration + E2E + Documentation

## Goal
omkc (oh-my-kiro-cli)와 연동 + 전체 E2E 테스트 + 문서화 + npm 배포.

## Preconditions
- Phase 0-7 완료

## Steps

### 8.1 omkc Skill: `team-spawn`

Skill 파일: `~/.aim/skills/Oh-my-kiro-cli/team-spawn/SKILL.md`

```markdown
---
name: team-spawn
description: Delegate work to independent kiro-cli workers via kiro-team (kt) tmux orchestration
---

# team-spawn

## When to use kt vs use_subagent

| Criteria | use_subagent | kt team |
|----------|-------------|---------|
| Simple single-turn query | ✅ Preferred | Overkill |
| Complex multi-step task | ❌ Context limited | ✅ Full agent session |
| Need parallel execution | ❌ Max 4, shared context | ✅ Independent sessions |
| Need file write/shell | ❌ Limited tools | ✅ Full tool access |
| Need multi-turn interaction | ❌ Single response | ✅ Persistent session |
| Need worker to use git | ❌ No git access | ✅ Full git access |

## Usage from sisyphus

Instead of:
```
use_subagent → agent_name: "yolo-explorer", query: "Find all API endpoints"
```

Use:
```bash
kt team 1:explorer "Find all API endpoints"
kt status <team-name>    # check progress
# wait for completion...
kt status <team-name> --json | jq '.workers[].result'  # collect results
kt shutdown <team-name>
```

For parallel work:
```bash
kt team 3:executor "Implement OAuth: 1) callback handler 2) token refresh 3) tests"
```

## Result Format

`kt status --json` returns:
```json
{
  "team": "alpha-20260317",
  "phase": "complete",
  "workers": [
    {"name": "worker-1", "state": "done", "result": "..."},
    {"name": "worker-2", "state": "done", "result": "..."}
  ],
  "tasks": [
    {"id": "1", "status": "completed", "result": "..."}
  ]
}
```

## Prerequisites
- `kt` installed globally: `npm i -g kiro-team`
- tmux available
- Running inside tmux session
```

### 8.2 sisyphus Agent-Spec 수정

`yolo-sisyphus.agent-spec.json` 변경:

1. allowedCommands에 `kt` 추가:
```regex
"^kt (team|status|shutdown|scale-up|scale-down|resume|api|hud|doctor)( [^;|&`$\\n]+)?$"
```

2. system prompt에 kt 사용 지침 추가:
```
## kiro-team (kt) Integration

When delegating complex, multi-step, or parallel tasks, use `kt team` instead of `use_subagent`:

```bash
# Single specialist worker
kt team 1:explorer "Find all authentication patterns"

# Parallel workers
kt team 3:executor "Implement feature with tests and docs"

# Check results
kt status <team-name> --json
```

Use `use_subagent` only for simple, single-turn queries where a full worker session is unnecessary.
```

### 8.3 E2E Test Scenarios

**Scenario 1: Single worker, simple task**
```bash
kt team 1 "Read the file /tmp/kt-test-input.txt and write its contents to /tmp/kt-test-output.txt"
```
Verify: `/tmp/kt-test-output.txt` exists with correct contents.

**Scenario 2: Parallel workers, different roles**
```bash
kt team 2:explorer "Find all .ts files in /tmp/oh-my-codex/src/team/ and list them"
```
Verify: 2 workers spawn, both produce file lists, results collected.

**Scenario 3: Worker communication via kt api**
```bash
kt team 1 "Claim task-1, do the work, then transition to completed using kt api"
```
Verify: task-1 status transitions: pending → in_progress → completed.

**Scenario 4: Worker failure + monitor detection**
```bash
kt team 2 "Long running task"
# Manually kill worker-1 pane
# Verify: monitor detects dead worker, emits worker_stopped event
```

**Scenario 5: Dynamic scaling**
```bash
kt team 2:executor "Start implementation"
sleep 30
kt scale-up <team> 1:reviewer
# Verify: 3rd worker joins, gets assigned review task
```

**Scenario 6: Graceful shutdown**
```bash
kt team 2 "Long task" &
sleep 10
kt shutdown <team-name>
# Verify: shutdown inbox sent, ACKs collected, panes killed
```

**Scenario 7: Resume after disconnect**
```bash
kt team 2 "Task"
# Kill kt process (not workers)
kt resume <team-name>
# Verify: reconnects to existing workers, monitor resumes
```

**Scenario 8: Phase transition**
```bash
kt team 1 "Implement and verify: create /tmp/kt-phase-test.txt"
# Verify: exec → verify → complete phase transitions
```

### 8.4 Documentation

**README.md:**
- Project description + motivation
- Comparison with omx
- Requirements (Node.js, tmux, kiro-cli)
- Installation (`npm i -g kiro-team`)
- Quickstart (3분)
- CLI Reference (all commands)
- Architecture overview
- Configuration (env vars)
- FAQ

**docs/architecture.md:**
- System diagram (leader/worker/state)
- Communication flow
- Phase state machine
- File-based IPC design
- tmux integration details

**docs/worker-protocol.md:**
- Complete worker protocol reference
- kt api operations
- State root resolution
- Mailbox protocol
- Shutdown protocol

**docs/comparison-with-omx.md:**
- Feature comparison table
- Architecture differences
- Design decisions and rationale

**docs/future-prompt-mode.md:**
- Non-tmux worker design
- CI/CD integration plan
- kiro-cli requirements

**AGENTS.md:**
- kiro-cli agent discovery file
- Lists kt as available tool

### 8.5 npm 배포 준비

```json
// package.json
{
  "name": "kiro-team",
  "version": "0.1.0",
  "description": "tmux-based multi-agent orchestration for kiro-cli",
  "bin": {"kt": "./bin/kt.js"},
  "files": ["bin/", "dist/", "src/prompts/"],
  "engines": {"node": ">=20"},
  "keywords": ["kiro", "kiro-cli", "multi-agent", "tmux", "orchestration"],
  "license": "MIT"
}
```

배포 체크리스트:
- [ ] `npm run build` 성공
- [ ] `npm pack` → tarball 확인
- [ ] tarball에서 `npm i -g` → `kt --help` 동작
- [ ] `kt doctor` → 모든 체크 통과
- [ ] `kt team 1 "hello"` → E2E 동작

## Deliverables
- [ ] omkc team-spawn skill (SKILL.md)
- [ ] sisyphus agent-spec 수정 (allowedCommands + system prompt)
- [ ] E2E test 8개 시나리오 통과
- [ ] README.md + docs/ (4개 문서)
- [ ] AGENTS.md
- [ ] npm 배포 준비 (package.json, npm pack 검증)

## Acceptance Criteria
- sisyphus가 `kt team` 으로 worker 소환 → `kt status --json` 으로 결과 수집 가능
- 모든 E2E 시나리오 통과
- `npm i -g kiro-team` → `kt --help` 동작
- `kt doctor` → tmux ✓, kiro-cli ✓, kt ✓
- README quickstart가 3분 내 완료 가능
- docs/ 4개 문서 모두 작성됨
