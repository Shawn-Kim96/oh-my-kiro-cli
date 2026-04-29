# Context Snapshot: oh-my-kiro-cli parity and expansion plan

## Task Statement
Create a very detailed `$ralplan` plan for making `oh-my-kiro-cli` approach the maturity and operator experience of `oh-my-codex`, while preserving the Kiro/tmux direction and avoiding Kiro `use_subagent` dependence.

## Desired Outcome
- Identify what is missing or shallow in `oh-my-kiro-cli` relative to `oh-my-codex`.
- Separate confirmed gaps from intentional design differences.
- Provide a staged, testable implementation roadmap for fixes, parity, and new Kiro-specific improvements.
- Stop after planning; do not implement source changes in this workflow.

## Known Facts / Evidence
- Current repo root: `/Users/shawn/Documents/personal/oh-my-kiro-cli`.
- Baseline repo found locally at `/Users/shawn/Documents/personal/oh-my-codex`.
- Target identity is now clarified: this repo/project is `oh-my-kiro-cli`, the Amazon-internal package/distribution is `kiro-cli-hive`, and the canonical executable should be `kch`.
- Current package metadata exposes only `kh` in `package.json`, while repo docs and tests still use `kt`; `package-lock.json` still names `kiro-team`. Treat this as drift from the target `kch` identity, not an unresolved product choice.
- `npm ci` failed on 2026-04-29 with `ETARGET No matching version found for typescript@5.7.0`, so clean install/build is currently blocked.
- Current `oh-my-kiro-cli` has one test file; local count found 1 test file versus 196 in the `oh-my-codex` repo.
- Current `oh-my-kiro-cli` ships one skill (`skills/team-spawn/SKILL.md`); `oh-my-codex` has a broad workflow-skill catalog.
- Current CLI includes `team`, `status`, `shutdown`, `api`, `hud`, `scale-up`, `scale-down`, `resume`, `doctor`, `plan`, `ralph`, `notify`, `mcp-server`, and `send`.
- `oh-my-codex` CLI exposes broader operator surfaces including `setup`, `uninstall`, `cleanup`, `ask`, `explore`, `sparkshell`, `session`, `agents-init`, `agents`, `autoresearch`, `ralphthon`, `tmux-hook`, `hooks`, `status`, `cancel`, and `reasoning`.
- Current repo already contains partial implementations of triage, interview, wiki, checkpoint, worktrees, confirmed send-keys, MCP team/state servers, role routing, allocation, and Ralph.
- Several partial implementations are not wired into the main lifecycle or are unsafe by default, notably quality gate usage, phase persistence, auto-checkpoint, CLI naming, and setup/skill installation.

## Constraints
- Preserve Kiro as the execution engine and tmux panes as the durable worker substrate.
- Do not depend on Kiro `use_subagent` for core orchestration.
- Avoid new runtime dependencies unless clearly justified.
- Prefer file-based IPC unless MCP integration provides clear operator value.
- Keep implementation stages small enough to verify independently.
- Planning only for this turn; implementation should be handed off later via `$ralph` or `$team`.

## Unknowns / Open Questions
- Exact external/public npm publishing name is still a distribution decision, but local repo/project identity is `oh-my-kiro-cli`, Amazon-internal identity is `kiro-cli-hive`, and canonical executable is `kch`.
- Exact Kiro CLI support for model/reasoning flags is unverified.
- Exact Kiro hooks/config/agent install surfaces need live confirmation before setup automation is implemented.
- Whether to copy all OMX skills or create Kiro-native equivalents requires product judgment, but the plan favors Kiro-native equivalents.

## Likely Codebase Touchpoints
- `package.json`, `package-lock.json`, `bin/kch.js`, `bin/kh.js`, `bin/kt.js`, `.github/workflows/ci.yml`
- `src/cli/index.ts`, `src/cli/*` new command modules
- `src/team/runtime.ts`, `src/team/state.ts`, `src/team/api-interop.ts`, `src/team/tmux-session.ts`, `src/team/mcp-comm.ts`
- `src/team/task-decomposer.ts`, `src/team/triage.ts`, `src/team/interview.ts`, `src/team/quality-gate.ts`, `src/team/checkpoint.ts`, `src/team/governance.ts`
- `src/mcp/team-server.ts`, `src/mcp/state-server.ts`, possible new memory/trace/code-intel servers
- `src/knowledge/wiki.ts`, possible new memory/notepad/session-history modules
- `src/prompts/*`, `skills/*`, `templates/*`, docs and release assets
