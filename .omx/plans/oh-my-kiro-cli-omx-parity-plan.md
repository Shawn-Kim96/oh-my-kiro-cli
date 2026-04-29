# RALPLAN: oh-my-kiro-cli OMX-Maturity Roadmap

Created: 2026-04-29
Context snapshot: `.omx/context/oh-my-kiro-parity-20260429T064149Z.md`
Scope: planning only. Do not implement from this artifact until a follow-up execution mode is explicitly launched.

## Executive Summary

`oh-my-kiro-cli` already has the right core idea: replace Kiro `use_subagent` with durable, independent `kiro-cli chat` workers running in tmux panes, coordinated through file-based IPC and a worker API. The missing work is not just "copy more oh-my-codex features." The current repo needs a trustworthy Kiro-native runtime kernel first: installable package identity, correct worker API protocol, persisted phase truth, quality-gated completion, and opt-in git mutation.

The chosen strategy is:

1. Stabilize the target `kch` team runtime until one end-to-end team lifecycle is truthful and safe, while keeping existing `kh`/`kt` entry points only as migration aliases.
2. Expand tests until lifecycle and safety behavior is protected.
3. Add setup, cleanup, cancel, doctor, skills, Ralph handoff, and selected OMX-like commands as adapters over the stable kernel.
4. Keep the implementation Kiro/tmux/file-IPC native. Do not make `use_subagent` or Codex-native MCP assumptions part of the worker path.

## Evidence Snapshot

Local comparison:

| Area | oh-my-kiro-cli | oh-my-codex baseline | Evidence |
| --- | ---: | ---: | --- |
| `src/**/*.ts` files | 52 | 348 | local `find src -name '*.ts'` count |
| test files | 1 | about 196 | local test-file count |
| skills | 1 | 36 | local `find skills -mindepth 1 -maxdepth 1` count |
| docs markdown files | 5 | 71 | local docs count |

Confirmed current repo issues:

- Clean install is blocked. `npm ci` failed with `ETARGET No matching version found for typescript@5.7.0`; `package.json` pins `"typescript": "5.7.0"` at [package.json:33](/Users/shawn/Documents/personal/oh-my-kiro-cli/package.json:33), while the lockfile resolves TypeScript 5.9.3 at [package-lock.json:1112](/Users/shawn/Documents/personal/oh-my-kiro-cli/package-lock.json:1112).
- Target identity is now explicit, but the repo still drifts. The local/project name is `oh-my-kiro-cli`, the Amazon-internal distribution/package name is `kiro-cli-hive`, and the canonical executable should be `kch`. Current `package.json` names `kiro-cli-hive` at [package.json:2](/Users/shawn/Documents/personal/oh-my-kiro-cli/package.json:2) and exposes only `kh` at [package.json:20](/Users/shawn/Documents/personal/oh-my-kiro-cli/package.json:20), while `package-lock.json` names `kiro-team` at [package-lock.json:2](/Users/shawn/Documents/personal/oh-my-kiro-cli/package-lock.json:2) and records bin `kt` at [package-lock.json:14](/Users/shawn/Documents/personal/oh-my-kiro-cli/package-lock.json:14). README uses `kh`, but many docs, tests, source names, and prompt examples still use `kt`.
- State-root documentation is inconsistent. Runtime paths use `~/.kt` in [src/utils/paths.ts:4](/Users/shawn/Documents/personal/oh-my-kiro-cli/src/utils/paths.ts:4), while README state docs say `~/.kh` at [README.md:294](/Users/shawn/Documents/personal/oh-my-kiro-cli/README.md:294). The target runtime should introduce canonical `~/.kch` state for new installs and read/migrate legacy `~/.kt`/`~/.kh` state.
- Quality gate exists but is not wired. `assessOutput()` is defined at [src/team/quality-gate.ts:39](/Users/shawn/Documents/personal/oh-my-kiro-cli/src/team/quality-gate.ts:39); `monitorTeam()` reads task statuses and can exit complete without invoking it around [src/team/runtime.ts:508](/Users/shawn/Documents/personal/oh-my-kiro-cli/src/team/runtime.ts:508) and [src/team/runtime.ts:567](/Users/shawn/Documents/personal/oh-my-kiro-cli/src/team/runtime.ts:567).
- Phase state is initialized but not persisted through the lifecycle. `initTeamState()` writes `phase.json` at [src/team/state.ts:47](/Users/shawn/Documents/personal/oh-my-kiro-cli/src/team/state.ts:47); only `readPhaseState()` exists at [src/team/state.ts:89](/Users/shawn/Documents/personal/oh-my-kiro-cli/src/team/state.ts:89). `phase-controller.ts` has inference/reconciliation helpers, but runtime does not write reconciled phases.
- Worker bootstrap and API contracts disagree. Worker bootstrap examples claim tasks with no `expected_version` and transition without `claim_token` around [src/team/worker-bootstrap.ts:34](/Users/shawn/Documents/personal/oh-my-kiro-cli/src/team/worker-bootstrap.ts:34) and [src/team/worker-bootstrap.ts:54](/Users/shawn/Documents/personal/oh-my-kiro-cli/src/team/worker-bootstrap.ts:54), while API/state require token validation at [src/team/api-interop.ts:45](/Users/shawn/Documents/personal/oh-my-kiro-cli/src/team/api-interop.ts:45) and [src/team/state.ts:214](/Users/shawn/Documents/personal/oh-my-kiro-cli/src/team/state.ts:214).
- Git mutation is unsafe by default. Runtime `captureTransition()` invokes `autoCheckpoint()` whenever `cwd` exists at [src/team/runtime.ts:39](/Users/shawn/Documents/personal/oh-my-kiro-cli/src/team/runtime.ts:39), and `autoCheckpoint()` runs `git add -A` plus commit at [src/team/checkpoint.ts:29](/Users/shawn/Documents/personal/oh-my-kiro-cli/src/team/checkpoint.ts:29).
- Worktree merge is also aggressive by default. Worker worktrees can be auto-committed at [src/team/worktree.ts:240](/Users/shawn/Documents/personal/oh-my-kiro-cli/src/team/worktree.ts:240), then cherry-picked into the leader repo around [src/team/worktree.ts:263](/Users/shawn/Documents/personal/oh-my-kiro-cli/src/team/worktree.ts:263).
- Current CLI surface is useful but narrow: `team`, `status`, `shutdown`, `api`, `hud`, `scale-up`, `scale-down`, `resume`, `doctor`, `plan`, `ralph`, `notify`, `mcp-server`, `send`. `oh-my-codex` additionally has setup/uninstall/cleanup/ask/explore/sparkshell/session/agents/autoresearch/ralphthon/tmux-hook/hooks/status/cancel/reasoning.

## RALPLAN-DR Summary

### Principles

1. Kiro-native first: workers are `kiro-cli chat` sessions in tmux, not Kiro `use_subagent` calls.
2. Runtime truth before feature surface: package identity, API protocol, phase state, verification, and git safety must be correct before adding more commands.
3. File IPC remains the worker contract: MCP may be an optional operator integration, not a required worker dependency.
4. Destructive or repository-mutating automation is opt-in, visible, reversible, and covered by tests.
5. Port OMX patterns, not OMX assumptions: copy workflow ideas and quality gates only when they fit Kiro/tmux/file-IPC architecture.

### Decision Drivers

1. Lifecycle correctness: spawn -> inbox -> claim -> work -> result -> transition -> verify -> phase persist -> shutdown/resume.
2. Installability and operator trust: `npm ci`, package/bin aliases, docs, state root, and CLI help must agree.
3. Evidence quality: all completion claims need runnable tests, state assertions, and no silent git mutations.

### Viable Options

| Option | Approach | Pros | Cons | Decision |
| --- | --- | --- | --- | --- |
| A. Kiro-native reliability kernel first | Stabilize existing runtime, then add setup/skills/Ralph/parity | Fixes the real failure modes; keeps Kiro/tmux architecture; reduces silent failure risk | Slower visible feature growth | Chosen |
| B. Feature-surface parity first | Add setup, skills, explore, sparkshell, hooks, autoresearch-like commands immediately | Looks closer to OMX quickly; user-facing value appears sooner | Builds on broken install/protocol/phase/git contracts; can hide silent failures | Rejected for now |
| C. Thin wrapper over oh-my-codex | Reuse OMX implementation directly and adapt command names | Maximum reuse; inherits mature patterns | Imports Codex/MCP assumptions; undermines Kiro-native tmux/file IPC goal | Rejected |
| D. Minimal packaging-only fix | Fix `npm ci` and naming, postpone architecture | Quickest install recovery | Leaves workers able to fail silently or mutate git unexpectedly | Rejected as insufficient |

## ADR

### Decision

Build a Kiro-native reliability kernel first, then layer selected OMX-like workflows on top.

### Drivers

- Current repo already has primitives for teams, state, dispatch, tmux, worktrees, role routing, MCP stubs, and Ralph.
- The dangerous gaps are integration gaps: identity drift, invalid dependency pin, worker API mismatch, no persisted phase truth, quality gate not wired, and unsafe git mutation defaults.
- User goal is specifically to stop relying on Kiro subagents and use tmux instead, so the runtime substrate matters more than superficial command parity.

### Alternatives Considered

- Feature parity first: rejected because new commands would sit on unreliable lifecycle semantics.
- Thin OMX adapter: rejected because the Kiro project intentionally uses tmux/file IPC where OMX uses Codex/MCP assumptions.
- Packaging-only repair: rejected because a buildable package that silently completes bad tasks is still untrustworthy.

### Why Chosen

The reliability kernel creates a single enforceable contract that every later feature can reuse. It also limits scope: later setup/skills/Ralph/explore work becomes adapter work rather than more runtime invention.

### Consequences

- Users get fewer new commands immediately, but the existing team path becomes trustworthy.
- Some old docs/plans must be revised or deprecated because they conflict with current code behavior.
- `kch` must be the canonical command, and `kh`/`kt` compatibility must be explicit and tested rather than implied.

### Follow-ups

- Implement the clarified `kch` identity and state-root compatibility in Phase 0.
- Treat Phase 0-4 as "kernel gates"; do not begin OMX parity phases until those gates pass.

## Target Runtime Contract

The stable kernel must enforce this lifecycle:

1. Operator runs `kch team [spec] "<task>"`; compatibility aliases `kh team ...` and `kt team ...` work during the migration period.
2. CLI creates team state under the canonical state root, with backward-compatible reads from old state root if needed.
3. Runtime creates tasks, workers, inboxes, and dispatch requests.
4. Worker reads inbox, lists assigned task files, claims a task with expected version, records the returned `claim_token`, does work, writes structured status/evidence, and transitions with the token.
5. Runtime monitor reconciles task counts into persisted `phase.json`, appends `phase_transition` events, retries failed dispatch, and nudges idle workers.
6. Completion is allowed only after task terminal state and monitor-side verification/quality checks agree.
7. Failed quality verification produces structured feedback, marks or requeues the task through the fix path, and persists evidence.
8. Git mutation never happens unless explicitly requested by CLI flag or config.
9. Shutdown, cancel, and resume operate on persisted state and never require Kiro `use_subagent`.

## Identity and Compatibility Contract

Maintainer-updated target:

- Project/repo name: `oh-my-kiro-cli`.
- Amazon-internal package/distribution name: `kiro-cli-hive`.
- Canonical executable: `kch`, short for Kiro CLI Hive.
- Transitional aliases: keep `kh` and `kt` for one migration window because current `package.json`, README, docs, prompts, tests, and state references already use them. Aliases should print either identical help or a concise compatibility notice.
- Canonical state root: `~/.kch` for new installs.
- Legacy state roots: read and optionally migrate from `~/.kt` and `~/.kh`; do not delete legacy state automatically.
- Environment variables: add `KCH_STATE_ROOT` as the preferred override. Keep `KT_STATE_ROOT` and `KH_STATE_ROOT` as fallback aliases during migration, with precedence `KCH_STATE_ROOT` -> `KT_STATE_ROOT` -> `KH_STATE_ROOT` -> default `~/.kch`.
- Function/module names: do not bulk rename `kt*` internal functions in early phases. They are implementation details and renaming them would create noise before behavior is stable.
- CLI help: `kch --help` must be primary; `kh --help` and `kt --help` must work as compatibility aliases.

## Git Safety Contract

Default behavior:

- `kch team` must not commit, stage, cherry-pick, merge, or remove worktrees unless explicitly requested.
- Worker bootstrap must not instruct workers to always `git add -A && git commit`.
- `--worktree` may create isolated worktrees, but merge/cherry-pick is disabled by default.
- Runtime phase transitions may write state/wiki/events, but not git commits by default.

Opt-in flags:

- `--checkpoint`: allow runtime checkpoints only for explicitly scoped paths. Must refuse if unrelated dirty files exist unless `--checkpoint-all` is later added.
- `--merge-worktrees`: allow automatic merge/cherry-pick from worker worktrees into the leader repo. Must be separate from `--worktree`.
- `--keep-worktrees`: keep worker worktrees after completion for manual review.

Generated commit message protocol:

```
Record kch checkpoint after verified phase transition

The runtime checkpoint captures state after the team moved from <from>
to <to>. It is generated only because checkpointing was explicitly
enabled for this run.

Constraint: Checkpointing must never include unrelated dirty user files
Confidence: medium
Scope-risk: narrow
Directive: Do not enable default checkpointing without re-running git safety tests
Tested: <commands>
Not-tested: <gaps>
```

## Phase Plan

### Phase 0: Canonical Baseline Repair

Goal: make the repo installable and make the `kch` identity truthful.

Primary files:

- `package.json`
- `package-lock.json`
- `bin/kch.js`
- `bin/kh.js`
- `bin/kt.js`
- `README.md`
- `docs/architecture.md`
- `docs/comparison-with-omx.md`
- `docs/worker-protocol.md`
- `src/cli/index.ts`
- `src/cli/doctor.ts`
- `src/__tests__/smoke.test.ts` or new `src/cli/__tests__/package-contract.test.ts`

Work:

1. Implement and document the canonical package/binary policy from the Identity Contract.
2. Expose `kch` as the primary `package.json` bin and keep `kh`/`kt` as compatibility bins during the migration period.
3. Align `package-lock.json` root package name and bins with `package.json`.
4. Replace invalid `typescript@5.7.0` with a resolvable version. The lockfile already points at 5.9.3, so use `5.9.3` unless there is a specific compatibility reason not to.
5. Decide exact vs range dependency policy. Recommended for this repo: exact runtime deps for CLI repeatability, exact dev deps for clean CI.
6. Normalize docs so `kch` is primary, `kh`/`kt` are compatibility aliases, and `~/.kch` is the canonical new state root with legacy migration from `~/.kt`/`~/.kh`.
7. Add package contract tests that parse `package.json`, verify primary and compatibility bin files exist and are executable as intended, and verify help text.

Acceptance criteria:

- `npm ci` succeeds from clean checkout.
- `npm run build` succeeds.
- `npm test` succeeds.
- `npm pack --dry-run` includes `bin/kch.js`, `bin/kh.js`, `bin/kt.js`, `dist/`, `src/prompts/`, and `skills/` as intended.
- `node bin/kch.js --help` prints primary command help.
- `node bin/kh.js --help` works as compatibility alias.
- `node bin/kt.js --help` works as compatibility alias.
- Docs no longer contradict package identity or state-root policy.

Verification:

```bash
rm -rf node_modules dist
npm ci
npm run build
npm test
npm pack --dry-run
node bin/kch.js --help
node bin/kh.js --help
node bin/kt.js --help
node -e "const p=require('./package.json'); console.log(p.name, p.bin.kch, p.bin.kh, p.bin.kt)"
```

Do not proceed to Phase 1 until Phase 0 passes.

### Phase 1: Worker Protocol and API Correctness

Goal: workers can reliably claim and complete tasks using the same contract the state layer enforces.

Primary files:

- `src/team/worker-bootstrap.ts`
- `src/prompts/worker-protocol.md`
- `docs/worker-protocol.md`
- `src/team/api-interop.ts`
- `src/team/state.ts`
- `src/team/contracts.ts`
- new `src/team/__tests__/api-interop.test.ts`
- new `src/team/__tests__/worker-bootstrap.test.ts`

Work:

1. Update generated worker instructions:
   - Read task file first.
   - Use task `version` as `expected_version` when claiming.
   - Store returned `claim_token`.
   - Include `claim_token` in `transition-task-status`.
   - If claim fails, reread task/list tasks rather than inventing token.
2. Update docs/prompts to match API behavior.
3. Decide whether `api-interop` should require `claim_token` explicitly or support owner-bound token lookup. Recommended: keep explicit token; it is safer and already matches state design.
4. Improve API error messages so workers know whether failure was missing token, stale version, wrong owner, invalid transition, or missing task.
5. Add tests for:
   - Claim pending task with expected version succeeds and returns token.
   - Transition without token fails with a precise error.
   - Transition with wrong token fails.
   - Transition with correct token succeeds.
   - Generated worker inbox contains `expected_version` and `claim_token` guidance.

Acceptance criteria:

- Worker bootstrap examples and docs are consistent with API/state.
- `transition-task-status` cannot bypass claim-token protection.
- Workers have enough prompt guidance to recover from stale expected version.
- API failures are actionable.

Verification:

```bash
npm run build
npm test
node --test dist/team/__tests__/api-interop.test.js
node --test dist/team/__tests__/worker-bootstrap.test.js
```

### Phase 2: Phase Truth and Quality-Gated Completion

Goal: the runtime's persisted phase state and completion claims reflect reality.

Primary files:

- `src/team/runtime.ts`
- `src/team/state.ts`
- `src/team/phase-controller.ts`
- `src/team/orchestrator.ts`
- `src/team/quality-gate.ts`
- `src/team/contracts.ts`
- `src/hud/state.ts`
- `src/hud/render.ts`
- new `src/team/__tests__/runtime-phase.test.ts`
- new `src/team/__tests__/quality-gate-runtime.test.ts`

Runtime semantics:

- Add `writePhaseState(teamName, phaseState)` to `src/team/state.ts`.
- On every monitor iteration, compute task counts and infer target phase with `inferPhaseFromTaskCounts()`.
- Reconcile persisted state with `reconcilePhaseState()`.
- Persist updated `phase.json` when phase or transition history changes.
- Append a `phase_transition` event whenever persisted phase changes.
- HUD/status should read persisted phase, not infer a separate truth.

Quality gate insertion:

- Run `assessOutput()` in monitor before allowing `complete`.
- Input text should be assembled in this order:
  1. `task.result` from lifecycle transition.
  2. Worker `result.json` if present and linked to task.
  3. Recent DONE mailbox message only as secondary evidence, not primary result.
- If gate passes, record verification evidence on task metadata or event log.
- If gate fails:
  - Transition target phase to `fix`.
  - Mark the task `failed` with `error = quality_gate:<issues>` if it is already terminal.
  - Or requeue to `pending` with structured feedback if completion has not been committed yet.
  - Send worker inbox feedback explaining the gate issues.
- Do not silently complete with empty, irrelevant, or error-like results.

Acceptance criteria:

- `phase.json` transitions through `exec -> verify -> complete` for successful tasks.
- Failed quality gate yields `verify -> fix`, not `complete`.
- Event log includes `phase_transition` and `quality_gate_failed`/`quality_gate_passed` events.
- Resume reads persisted phase and does not reopen terminal teams incorrectly.
- HUD/status report persisted phase.

Verification:

```bash
npm run build
npm test
node --test dist/team/__tests__/runtime-phase.test.js
node --test dist/team/__tests__/quality-gate-runtime.test.js
node -e "import('./dist/team/quality-gate.js').then(m=>console.log(m.assessOutput('Implemented auth module','implement auth').pass))"
```

### Phase 3: Git and Worktree Safety

Goal: no automatic repository mutation unless explicitly requested.

Primary files:

- `src/team/runtime.ts`
- `src/team/checkpoint.ts`
- `src/team/worktree.ts`
- `src/team/worker-bootstrap.ts`
- `src/cli/index.ts`
- `docs/worker-protocol.md`
- `docs/architecture.md`
- new `src/team/__tests__/checkpoint.test.ts`
- new `src/team/__tests__/worktree-safety.test.ts`

Work:

1. Remove or gate automatic `autoCheckpoint()` calls in `captureTransition()`.
2. Add CLI flags:
   - `--checkpoint` default false.
   - `--merge-worktrees` default false.
   - `--keep-worktrees` default false or documented current behavior.
3. Remove worker instruction requiring commits before completion. Replace with:
   - Write result/evidence.
   - Do not commit unless the team was launched with explicit checkpoint/merge policy.
4. Split worktree isolation from worktree merge:
   - `--worktree`: create isolated worker worktrees.
   - `--merge-worktrees`: after completion, attempt controlled merge/cherry-pick.
5. Add dirty-worktree guard:
   - Refuse checkpoint/merge if unrelated dirty files exist.
   - Report dirty paths clearly.
6. Generated commits must use Lore protocol trailers.

Acceptance criteria:

- Default `kch team` does not call `git add`, `git commit`, or `git cherry-pick`.
- Default `--worktree` creates isolation but does not merge.
- `--checkpoint` produces Lore-format commit only when safe.
- `--merge-worktrees` reports conflicts and keeps evidence without destructive cleanup.
- Tests prove no commits happen by default.

Verification:

```bash
npm run build
npm test
node --test dist/team/__tests__/checkpoint.test.js
node --test dist/team/__tests__/worktree-safety.test.js
git status --porcelain
```

### Phase 4: Test Architecture Expansion

Goal: convert the repo from smoke-test-only to lifecycle-tested.

Primary files:

- `src/__tests__/smoke.test.ts`
- new `src/cli/__tests__/*`
- new `src/team/__tests__/*`
- new `src/ralph/__tests__/*`
- new `src/mcp/__tests__/*`
- new `src/hud/__tests__/*`
- new `src/utils/__tests__/*`
- `.github/workflows/ci.yml`
- optional `COVERAGE.md`

Work:

1. Split current smoke tests into focused suites.
2. Add fake tmux wrappers for unit-level tmux behavior.
3. Keep live tmux integration tests gated behind `KT_TEST_TMUX=1`.
4. Add CI matrix for Node 20 and current LTS once dependencies are fixed.
5. Add tests for:
   - Package/bin contract.
   - API claim/transition tokens.
   - Phase persistence and events.
   - Quality gate monitor behavior.
   - Dispatch retry and confirmed send-keys.
   - Mailbox delivery and notification marking.
   - Shutdown ACK fallback.
   - Scale up/down.
   - Resume with dead worker and pending task.
   - Worktree planning and safety.
   - Doctor output.
   - MCP team/state server tool lists.
   - Ralph persistence and sentinel limitations.

Acceptance criteria:

- Non-tmux tests pass in CI.
- Tmux integration tests can be run locally and skipped cleanly in CI.
- Public command behavior has tests.
- Runtime kernel phases are covered by unit and integration tests.

Verification:

```bash
npm run build
npm test
KT_TEST_TMUX=1 npm test
```

### Phase 5: Setup, Cleanup, Cancel, and Doctor Maturity

Goal: make the tool self-installing, inspectable, recoverable, and cancellable.

Primary files:

- `src/cli/index.ts`
- new `src/cli/setup.ts`
- new `src/cli/cleanup.ts`
- new `src/cli/cancel.ts`
- `src/cli/doctor.ts`
- `src/utils/paths.ts`
- `src/mcp/bootstrap.ts`
- `skills/*`
- `src/prompts/*`
- `.github/workflows/ci.yml`
- new CLI tests

Work:

1. Add `kch setup`:
   - Installs skills and prompts into the Kiro-appropriate location.
   - Writes/updates project AGENTS guidance if this project keeps using AGENTS.
   - Creates state/log/plan directories.
   - Is idempotent.
   - Backs up overwritten files.
2. Add `kch cleanup`:
   - `--dry-run` default recommended for first invocation.
   - Cleans stale teams, stale locks, stale jobs, orphan panes, and optional old worktrees.
3. Add `kch cancel`:
   - Gracefully shutdown active team/Ralph modes.
   - Mark state terminal.
   - Preserve logs/evidence.
4. Expand `kch doctor`:
   - Node version.
   - tmux version and current tmux session.
   - `kiro-cli` availability and version if available.
   - `kch` primary bin availability plus `kh`/`kt` compatibility bin availability.
   - package version/lock consistency.
   - state root writability.
   - stale locks.
   - optional MCP server start.
   - dangerous automation defaults disabled.

Acceptance criteria:

- `setup` can run twice without harmful changes.
- `cleanup --dry-run` reports planned changes without deleting.
- `cancel` terminalizes active state and sends shutdown instructions.
- `doctor` catches the Phase 0 problems if reintroduced.

Verification:

```bash
npm run build
npm test
node bin/kch.js setup --dry-run
node bin/kch.js doctor
node bin/kch.js cleanup --dry-run
node bin/kch.js cancel --help
```

### Phase 6: Kiro-Native Skill and Prompt Catalog

Goal: provide workflow affordances like OMX without Codex-native assumptions.

Primary files:

- `skills/team/SKILL.md`
- `skills/ralph/SKILL.md`
- `skills/plan/SKILL.md`
- `skills/ralplan/SKILL.md`
- `skills/cancel/SKILL.md`
- `skills/trace/SKILL.md`
- `skills/doctor/SKILL.md`
- `skills/cleanup/SKILL.md`
- `skills/code-review/SKILL.md`
- `skills/security-review/SKILL.md`
- `skills/ultraqa/SKILL.md`
- existing `skills/team-spawn/SKILL.md`
- `src/cli/setup.ts`
- `src/prompts/*`
- new skill validation tests

Work:

1. Keep `team-spawn` as compatibility or alias it to `team`.
2. Add skills that invoke Kiro/tmux/file-IPC workflows, not `use_subagent`.
3. Add frontmatter validation tests for every skill.
4. Add setup installation tests.
5. Add docs that distinguish:
   - Kiro built-in `use_subagent`: small, temporary, single response.
   - `kch team`: durable tmux workers.
   - `kch ralph`: persistent verification/fix loop.

Acceptance criteria:

- Every skill has valid frontmatter and maps to a real command or documented workflow.
- Skills explicitly prohibit using Kiro `use_subagent` for team worker orchestration.
- Setup installs skills and doctor can verify them.

Verification:

```bash
npm run build
npm test
find skills -maxdepth 2 -name SKILL.md -print
node bin/kch.js setup --dry-run
```

### Phase 7: Ralph and Team Handoff Maturity

Goal: make Ralph a structured verification lifecycle, not just sentinel text in pane capture.

Primary files:

- `src/ralph/runtime.ts`
- `src/ralph/persistence.ts`
- `src/ralph/contract.ts`
- `src/team/followup-planner.ts`
- `src/cli/index.ts`
- optional new `src/cli/ralph.ts`
- `.kch/plans/`, legacy `.kt`/`.kh` plan migration, or `.omx/plans/` compatibility policy
- new `src/ralph/__tests__/*`

Work:

1. Add PRD/test-spec gate before Ralph execution for broad tasks.
2. Persist structured evidence:
   - command run,
   - exit code,
   - stdout/stderr excerpt,
   - files touched,
   - test results,
   - remaining risks.
3. Support linked team verification:
   - `kch ralph "<task>" --linked-team <team>`.
   - Ralph reads team tasks/events/phase/evidence.
   - Ralph can reopen failed/incomplete tasks through the team API if policy permits.
4. Add stop/cancel/resume semantics.
5. Do not rely on `RALPH_COMPLETE` alone; sentinel text can be one signal, not final proof.

Acceptance criteria:

- Ralph cannot mark complete without structured verification evidence.
- Linked-team Ralph can summarize team evidence and identify missing proof.
- Ralph state survives process interruption.
- Ralph respects git safety defaults.

Verification:

```bash
npm run build
npm test
node bin/kch.js plan "mature runtime quality gates" --workers 3 --mode team
node bin/kch.js ralph --help
```

### Phase 8: Selective OMX Feature Parity

Goal: add high-value OMX-style operator surfaces after the kernel is stable.

Primary files:

- new `src/cli/explore.ts`
- new `src/cli/sparkshell.ts`
- new `src/cli/session-search.ts`
- new `src/cli/hooks.ts`
- new `src/cli/agents.ts`
- new `src/cli/autoresearch.ts`
- `src/mcp/*`
- `src/knowledge/wiki.ts`
- docs and tests

Candidate features:

1. `kch explore`: read-only repo lookup, bounded and non-mutating.
2. `kch sparkshell`: controlled shell summaries for noisy read-only commands.
3. `kch session`: local session/history search if Kiro exposes usable transcript storage.
4. `kch hooks`: Kiro-compatible hook/plugin runner if the Kiro runtime has a stable hook surface.
5. `kch trace`: event/log timeline summary from file IPC.
6. `kch autoresearch`: thin mission loop built on `kch team` and Ralph, not Codex subagents.
7. `kch ask`: optional local provider advisor if Claude/Gemini CLIs are available.

Acceptance criteria:

- Every command degrades gracefully when optional external tools are unavailable.
- Read-only commands cannot write repo or state.
- Feature docs say what is Kiro-native versus OMX-inspired.
- No command bypasses kernel safety gates.

Verification:

```bash
npm run build
npm test
node bin/kch.js explore --help
node bin/kch.js trace --help
node bin/kch.js session --help
```

## Missing Feature Inventory

### P0 Missing or Broken

- Clean dependency install.
- Package/bin/lock/docs identity consistency.
- Worker protocol token correctness.
- Persisted phase reconciliation.
- Runtime quality gate integration.
- Safe default git behavior.
- Focused lifecycle tests.

### P1 Missing

- Setup/install workflow.
- Cleanup and cancel commands.
- Mature doctor.
- Skill catalog.
- Structured Ralph evidence.
- Team -> Ralph verification path.
- State/root compatibility docs.
- MCP/tooling tests.

### P2 Missing

- Read-only explore and shell summary surfaces.
- Session/history search.
- Hook/plugin extensibility.
- Autoresearch-like mission runner.
- Release workflow, packed install smoke, and docs site.
- Cross-platform tmux/psmux guidance.

## Acceptance Gates

Kernel gates before OMX parity:

1. Install gate: `npm ci`, `npm run build`, `npm test`, `npm pack --dry-run` pass.
2. Identity gate: `kch` primary bin works, `kh`/`kt` aliases work, and docs match.
3. Protocol gate: claim-token lifecycle tests pass.
4. Phase gate: persisted phase and event tests pass.
5. Quality gate: bad worker output cannot complete a team.
6. Git safety gate: no default commits/merges/cherry-picks.
7. Test gate: focused non-tmux CI suite exists.

No setup/skills/Ralph/parity phase should start until gates 1-6 pass.

## Risk Register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Invalid package dependencies block all work | P0 install failure | Fix dependency pins and regenerate lockfile in Phase 0 |
| `kch` migration breaks existing `kh`/`kt` users | Lost compatibility | Add `kch` as canonical, keep `kh`/`kt` aliases for one migration window, read/migrate `~/.kt`/`~/.kh`, document alias policy |
| Worker prompt/API mismatch keeps tasks from completing | Runtime failure | Fix token guidance and tests before phase/quality work |
| Quality gate creates false negatives | Worker churn | Start monitor-side with structured feedback and tests; tune heuristics later |
| Phase state diverges from task state | Bad resume/HUD/status | Single reconcile/write path in monitor |
| Auto checkpoint captures user work | Data loss/noisy history | Disable by default; dirty unrelated guard; Lore commit protocol |
| Worktree auto-merge causes conflicts or unwanted commits | Repo corruption risk | Separate `--worktree` from `--merge-worktrees`; keep worktrees for review |
| Porting OMX features imports Codex assumptions | Architectural drift | Require Kiro-native acceptance criteria for each parity feature |
| Too much test expansion slows delivery | Schedule risk | Prioritize kernel tests before full coverage |

## Available Agent Types Roster

Observed in this repo's prompt catalog and role mapping:

- `executor`: implementation, fixes, migrations.
- `explorer`: codebase search and file/symbol mapping.
- `planner`: task decomposition and roadmaps.
- `verifier`: test execution and completion evidence.
- `reviewer`: code review and quality audits.
- `debugger`: root-cause analysis and runtime failures.
- `writer`: docs, READMEs, changelogs, skills.
- `librarian`: research and external reference checks.
- `frontend`: UI/CSS/frontend.
- `analyst`: requirements and acceptance criteria.
- `api-reviewer`: API contracts.
- `critic`: plan/design challenge.
- `dependency-expert`: dependency/version review.
- `git-master`: git history and merge strategy.
- `information-architect`: docs/information structure.
- `product-manager`: product scope and roadmap.
- `product-analyst`: feature gap analysis.
- `qa-tester`: test scenarios and defects.
- `quality-reviewer`: maintainability and complexity.
- `style-reviewer`: formatting and conventions.
- `ux-researcher`: user workflow and onboarding.
- `security-reviewer`: security and trust boundaries.
- `build-fixer`: build/toolchain errors.
- `test-engineer`: test design and reliability.
- `code-simplifier`: simplification after implementation.
- `performance-reviewer`: performance and scaling.

## Staffing Guidance

### Recommended Ralph Path

Use Ralph after the plan is approved when you want one owner to drive kernel phases sequentially.

Suggested lane sequence:

1. Ralph owner: execute Phase 0 and prove install/build/test.
2. Executor lane: implement protocol/phase/quality/git changes.
3. Test-engineer lane: add focused tests as each behavior changes.
4. Reviewer/quality-reviewer lane: review git safety and lifecycle semantics.
5. Verifier lane: run acceptance gates and produce evidence.

Suggested reasoning levels:

- High: protocol, phase state, git/worktree safety, Ralph evidence.
- Medium: package/docs/setup/doctor.
- Low: read-only inventory and docs consistency checks.

Ralph launch hint after approval:

```bash
kch ralph "Implement Phase 0-4 kernel gates from .omx/plans/oh-my-kiro-cli-omx-parity-plan.md with tests and evidence"
```

### Recommended Team Path

Use team mode for faster execution after Phase 0 is fixed enough for workers to run.

Phase 0-4 team:

- `1:executor`: package/bin/dependency identity.
- `1:executor`: worker protocol and API.
- `1:executor`: phase/quality runtime.
- `1:test-engineer`: focused tests and fixtures.
- `1:reviewer`: git/worktree safety review.

Phase 5-8 team:

- `1:executor`: setup/cleanup/cancel/doctor.
- `1:writer`: skills/docs/onboarding.
- `1:verifier`: command matrix and packed install smoke.
- `1:reviewer`: parity review and safety audit.

Team launch hint after approval:

```bash
kch team 5:executor "Implement Phase 0-4 kernel gates from .omx/plans/oh-my-kiro-cli-omx-parity-plan.md. Assign lanes for package identity, worker protocol, phase/quality runtime, tests, and git safety review."
```

### Team -> Ralph Verification Path

1. Team workers implement disjoint lanes and report tests/evidence.
2. Reviewer verifies no default git mutation and no `use_subagent` dependence.
3. Verifier runs:

```bash
npm ci
npm run build
npm test
npm pack --dry-run
node bin/kch.js doctor
node bin/kch.js cleanup --dry-run
```

4. Ralph is launched with the team name:

```bash
kch ralph "Verify Phase 0-4 kernel gates are complete and no unsafe git automation remains" --linked-team <team-name>
```

5. Ralph checks persisted team tasks/events/phase evidence and either signs off or reopens missing-proof work.

## Final Checklist for Execution Handoff

- [ ] Phase 0 identity contract is accepted or changed by maintainer.
- [ ] `kch` primary plus `kh`/`kt` compatibility aliases are explicitly tested.
- [ ] `~/.kch` canonical state root and `~/.kt`/`~/.kh` compatibility are documented.
- [ ] TypeScript dependency pin is corrected.
- [ ] Worker protocol token contract is tested.
- [ ] Phase persistence write/reconcile path is implemented.
- [ ] Quality gate has monitor-side semantics and tests.
- [ ] Default git mutation is disabled.
- [ ] Worktree merge/cherry-pick is opt-in.
- [ ] Non-tmux CI test suite passes.
- [ ] Live tmux integration tests are gated.
- [ ] Setup/skills/parity phases do not begin until kernel gates pass.
