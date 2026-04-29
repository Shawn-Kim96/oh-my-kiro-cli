# PRD: kch Runtime Kernel

Created: 2026-04-29
Source plan: `.omx/plans/oh-my-kiro-cli-omx-parity-plan.md`
Context snapshot: `.omx/context/oh-my-kiro-parity-20260429T064149Z.md`

## Goal

Make `oh-my-kiro-cli` usable as Amazon-internal `kiro-cli-hive` through the canonical `kch` executable, while preserving Kiro CLI plus tmux/file-IPC orchestration and avoiding Kiro `use_subagent` for durable team workers.

## Scope

Phase 0-4 kernel gates are required before higher-level OMX-style feature parity:

1. Canonical package/bin/state-root identity.
2. Worker API protocol correctness.
3. Persisted phase truth and quality-gated completion.
4. Git/worktree safety by default.
5. Focused tests for the above behavior.

Phase 5-8 features may be added after the kernel gates pass, but must not bypass these contracts.

## User Stories

### US-001: Canonical kch Identity

As an internal operator, I can run `kch` as the primary command so that `kiro-cli-hive` has a stable internal executable.

Acceptance criteria:
- `package.json` exposes `kch` as the primary bin and keeps `kh`/`kt` compatibility aliases.
- `bin/kch.js`, `bin/kh.js`, and `bin/kt.js` all launch the CLI.
- Docs and doctor output refer to `kch` as canonical.
- New state defaults to `~/.kch`, with legacy `~/.kt`/`~/.kh` fallback support.

### US-002: Safe Worker Lifecycle

As a team leader, I can launch tmux-backed workers that claim and complete tasks using the same token/version contract enforced by the state layer.

Acceptance criteria:
- Worker instructions mention `expected_version` and returned `claim_token`.
- Task transitions without the correct claim token fail.
- Tests cover claim success, missing token, wrong token, and correct-token transition.

### US-003: Truthful Completion

As an operator, I can trust team completion because persisted phase state and quality gates agree with task state.

Acceptance criteria:
- `phase.json` is reconciled and written during monitor/runtime updates.
- Completion is blocked or moved to fix/failure when quality evidence is empty or irrelevant.
- Phase and quality events are recorded.

### US-004: No Surprise Git Mutation

As a developer, I can run `kch team` without the tool staging, committing, cherry-picking, merging, or deleting worktrees unless I explicitly request it.

Acceptance criteria:
- Default runtime does not call automatic checkpoint commits.
- Worker instructions do not require commits.
- Worktree merge/cherry-pick is opt-in.
- Tests prove default git mutation is disabled.

## Constraints

- Preserve Kiro CLI as the worker execution engine.
- Preserve tmux panes and file-based IPC as the durable worker substrate.
- Do not introduce new runtime dependencies without a clear need.
- Keep existing `kh`/`kt` users working during migration.
- Do not remove legacy state automatically.

## Out Of Scope For Kernel

- Full parity with every `oh-my-codex` command.
- Replacing Kiro CLI with Codex-native subagents.
- Automatic migration deletion of legacy `~/.kt`/`~/.kh` data.
