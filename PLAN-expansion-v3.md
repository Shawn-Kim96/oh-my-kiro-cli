# kt Strategic Expansion Plan v3 (Final)

> Reviewed 4x by yolo-momus. Scores: D+ → B+ → A- → **A (SHIP IT)**
> Total effort: ~65 hours. Solo developer, evenings/weekends.

---

## Glossary

```typescript
// ── Wiki: file-based persistent knowledge per team ──
// Storage: ~/.kt/teams/{name}/wiki/{key}.md
interface WikiEntry {
  key: string;        // slug, e.g. "auth-conventions"
  content: string;    // markdown body
  updatedAt: string;  // ISO timestamp
}
// src/team/wiki.ts
function writeWikiEntry(teamName: string, key: string, content: string): Promise<void>
function readWikiEntry(teamName: string, key: string): Promise<string | null>
function listWikiEntries(teamName: string): Promise<string[]>

// ── Quality Gate: output validation before marking task complete ──
// src/team/quality-gate.ts
interface QualityResult { pass: boolean; issues: string[] }
function assessOutput(result: string, taskDescription: string): QualityResult
// Checks: (1) non-empty, (2) keyword overlap > 30% with task, (3) no error stack traces

// ── Ambiguity Detection: heuristic pre-spawn gate ──
// src/team/interview.ts
interface AmbiguityCheck { ambiguous: boolean; questions: string[]; confidence: number }
function detectAmbiguity(task: string): AmbiguityCheck
// Heuristic: question words without specifics, OR/AND conjunctions, vague verbs
// ("handle", "manage", "improve" without object)
// FALLBACK: if confidence < 0.5, SKIP gate and proceed. NEVER blocks execution.

// ── Triage: task complexity classification ──
// Replaces keyword-based routeTaskToRole() in src/team/role-router.ts
type TriageLevel = 'PASS' | 'LIGHT' | 'HEAVY'
interface TriageResult {
  level: TriageLevel;
  workerCount: number;   // PASS=1, LIGHT=1-2, HEAVY=3+
  agentTier: string;     // PASS=mini, LIGHT=standard, HEAVY=frontier
  reason: string;
}
function triageTask(task: string): TriageResult
// PASS: single-file ref, < 20 words, known simple patterns (typo, rename, add log)
// LIGHT: moderate scope, 1-3 file refs, action verbs (add, update, refactor)
// HEAVY: multi-file, architectural keywords (redesign, migrate, overhaul)

// ── Confirmed Send-Keys: reliable tmux delivery ──
// src/team/mcp-comm.ts
function confirmedSendKeys(
  paneId: string,
  text: string,
  opts?: { retries?: number; timeoutMs?: number }
): Promise<boolean>
// After sendKeys, capture pane, check for echo within timeoutMs. Retry up to retries times.

// ── Task Decomposition: synchronous string parsing (NOT LLM) ──
// Existing src/team/task-decomposer.ts
// Splits on: numbered list /^\d+[.)]/m, bullets /^[-*]/m, or sentence boundaries
// If no split points → 1 task shared by all workers
```

---

## Phase 8: Ship MVP

**Goal:** Get kt installable, testable, and usable for one real workflow.
**Effort:** ~15h
**Risk:** Low — all code exists, just packaging + testing.

### Steps

#### 8.1 Fix package.json for publish (~1h)
- **File:** `package.json`
- **What:** Pin deps (remove `^`), add `license: "MIT"`, `repository`, `description`, `keywords`, `homepage`
- **Depends on:** nothing
- **Acceptance:**
  ```bash
  $ node -e "const p=require('./package.json'); console.log(p.license, !!p.repository, !p.dependencies.commander.startsWith('^'))"
  # MIT true true
  ```

#### 8.2 Add CI with GitHub Actions (~2h)
- **File:** `.github/workflows/ci.yml`
- **What:** Workflow: checkout → `npm ci` → `npm run build` → `npm test`
- **Depends on:** 8.3 (tests must exist)
- **Acceptance:**
  ```bash
  $ cat .github/workflows/ci.yml | grep -c "npm run build"
  # 1
  $ cat .github/workflows/ci.yml | grep -c "npm test"
  # 1
  ```

#### 8.3 Add smoke tests (~4h)
- **File:** `src/__tests__/smoke.test.ts`
- **What:** 8+ tests using `node:test`: CLI --help parse, sanitizeTeamName(), parseSpec("3:explorer"), routeTaskToRole("find API endpoints") → explorer, transitionPhase() rejects invalid, state init/read round-trip, task decomposer splits numbered list, task decomposer returns 1 task for plain text
- **Wire:** `"test": "node --test dist/__tests__/*.test.js"` in package.json
- **Depends on:** nothing
- **Acceptance:**
  ```bash
  $ npm run build && npm test 2>&1 | grep -c "pass"
  # >= 8
  ```

#### 8.4 Create omkc team-spawn SKILL.md (~2h)
- **File:** `skills/team-spawn/SKILL.md`
- **What:** Frontmatter (name, description), when-to-use table (use_subagent vs kt), usage examples, result format
- **Depends on:** nothing
- **Acceptance:**
  ```bash
  $ head -3 skills/team-spawn/SKILL.md
  # ---
  # name: team-spawn
  # description: Delegate work to independent kiro-cli workers via kt
  ```

#### 8.5 npm pack + global install test (~2h)
- **Depends on:** 8.1, 8.3
- **Acceptance:**
  ```bash
  $ npm pack --dry-run 2>&1 | grep -c "bin/kt.js"
  # 1
  $ npm pack && npm i -g ./kiro-team-0.1.0.tgz && kt --help | head -1
  # Usage: kt [options] [command]
  $ kt doctor | grep -c "✓"
  # >= 3
  ```

#### 8.6 Publish v0.1.0 (~1h)
- **Depends on:** 8.5
- **Acceptance:**
  ```bash
  $ npm publish && npm view kiro-team version
  # 0.1.0
  ```
- **Fallback:** If npm name taken, use `@shawnksh/kiro-team` scoped package.

#### 8.7 Integrate Ralph into CLI (~3h)
- **Files:** `src/cli/index.ts`, `src/team/runtime.ts`
- **What:** Add `--ralph` flag to `kt team`. After exec phase completes, invoke Ralph's verify-fix loop on combined output. Ralph code already exists in `src/ralph/`.
- **Depends on:** nothing (Ralph code exists)
- **Acceptance:**
  ```bash
  $ kt team --help | grep -c "\-\-ralph"
  # 1
  $ npm test 2>&1 | grep -c "ralph"
  # >= 1
  ```

### Risk & Mitigation
| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| npm name taken | Medium | Use scoped package `@shawnksh/kiro-team` |
| Tests flaky on CI | Low | Use deterministic tests only (no tmux, no I/O) |

### Deliverables
- [ ] package.json complete with publish metadata + pinned deps
- [ ] CI workflow (.github/workflows/ci.yml)
- [ ] 8+ smoke tests passing via `npm test`
- [ ] team-spawn SKILL.md
- [ ] npm pack → global install → kt doctor passes
- [ ] v0.1.0 published
- [ ] --ralph flag wired

---

## Phase 9: Quality & Reliability

**Goal:** Fix architecture gaps that cause silent failures.
**Effort:** ~18h
**Risk:** Medium — tmux interaction is inherently racy.

### Steps

#### 9.1 Heartbeat-aware lock timeout (~3h)
- **File:** `src/team/state/locks.ts`
- **What:** Replace `STALE_THRESHOLD_MS = 30_000` with `staleLockThreshold(lockPath)` that reads associated worker's `heartbeat.json`. Fresh heartbeat (< 60s) → extend to 120s. No heartbeat → keep 30s.
- **Depends on:** nothing
- **Acceptance:**
  ```bash
  $ npm test 2>&1 | grep "lock"
  # ✔ stale lock broken after 30s when no heartbeat
  # ✔ lock extended to 120s when heartbeat fresh
  # ✔ concurrent claims: only one succeeds
  ```

#### 9.2 Confirmed send-keys with retry (~3h)
- **File:** `src/team/mcp-comm.ts`
- **What:** New `confirmedSendKeys()`. After sendKeys, capture pane within 5s, check for trigger echo. Retry up to 2x with 1s/2s backoff.
- **Depends on:** nothing
- **Acceptance:**
  ```bash
  $ npm test 2>&1 | grep "confirmedSendKeys"
  # ✔ returns true when pane echoes trigger
  # ✔ retries on first failure
  # ✔ returns false after max retries
  ```
- **Fallback:** If capture-pane is unreliable, fall back to fire-and-forget with warning log.

#### 9.3 Output quality gate (~4h)
- **File:** `src/team/quality-gate.ts` (new)
- **What:** `assessOutput(result, taskDescription)` → `{pass, issues[]}`. Checks: non-empty, keyword overlap > 30%, no error patterns (`/Error:|stack trace|FAILED/i`). Integrated in `runtime.ts`: failed gate → task stays in_progress, feedback sent to worker inbox.
- **Depends on:** nothing
- **Acceptance:**
  ```bash
  $ npm test 2>&1 | grep "quality"
  # ✔ empty result fails gate
  # ✔ error-pattern result fails gate
  # ✔ relevant result passes gate
  # ✔ irrelevant result (0% overlap) fails gate
  ```

#### 9.4 Expand tests to 20+ (~4h)
- **Files:** `src/__tests__/smoke.test.ts`, `src/__tests__/state.test.ts`, `src/__tests__/quality.test.ts`
- **What:** Add tests for: locks (stale, concurrent), dispatch dedup, phase transitions (full exec→verify→fix→complete), quality gate (4 cases), role router edge cases, state read/write round-trips, task decomposer (numbered, bullets, plain)
- **Depends on:** 9.1, 9.2, 9.3
- **Acceptance:**
  ```bash
  $ npm test 2>&1 | grep -c "pass"
  # >= 20
  ```

#### 9.5 Graceful shutdown ack clarification (~2h)
- **File:** `src/team/runtime.ts`
- **What:** Document and enforce: worker writes shutdown ack via `kt api send-message --input '{"from_worker":"worker-N","to_worker":"leader","body":"SHUTDOWN_ACK: worker-N"}'`. Leader detects ack by polling `mailbox/leader.json` for messages containing `SHUTDOWN_ACK`. Also writes `~/.kt/teams/{name}/shutdown/acks/{worker}.json`.
- **Depends on:** nothing
- **Acceptance:**
  ```bash
  $ npm test 2>&1 | grep "shutdown"
  # ✔ shutdown ack detected from mailbox
  # ✔ ack file written to shutdown/acks/
  ```

#### 9.6 Cleanup MCP dead weight (~2h)
- **File:** `package.json`, `src/mcp/`
- **What:** Evaluate `@modelcontextprotocol/sdk` usage. If `src/mcp/` is used → keep. If vestigial → remove dependency. Document decision.
- **Depends on:** nothing
- **Acceptance:**
  ```bash
  $ grep -r "from.*@modelcontextprotocol" src/ | wc -l
  # (if 0: remove dep. if >0: keep and document)
  ```

### Risk & Mitigation
| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| tmux capture-pane race | High | confirmedSendKeys has fallback to fire-and-forget |
| fs.watch unreliable on some OS | Medium | Deferred to Phase 10 with polling fallback |

### Deliverables
- [ ] Heartbeat-aware lock timeout
- [ ] confirmedSendKeys() with retry
- [ ] quality-gate.ts with assessOutput()
- [ ] 20+ tests passing
- [ ] Shutdown ack mechanism documented + tested
- [ ] MCP dependency evaluated

---

## Phase 10: Intelligence Layer

**Goal:** Make kt smarter than raw agent spawning.
**Effort:** ~20h
**Risk:** Medium — ambiguity detection is heuristic, may need tuning.

### Steps

#### 10.1 fs.watch monitor with polling fallback (~4h)
- **File:** `src/team/runtime.ts`
- **What:** Replace `await sleep(5000)` with `fs.watch()` on team state dir, debounced to 500ms. If `fs.watch` throws or platform unsupported → revert to 10s polling with `console.warn('fs.watch unavailable, falling back to 10s polling')`.
- **Depends on:** Phase 9 complete
- **Acceptance:**
  ```bash
  $ npm test 2>&1 | grep "monitor"
  # ✔ monitor reacts to file change within 1s
  # ✔ monitor falls back to polling when fs.watch unavailable
  ```
- **Fallback:** If fs.watch is too unreliable in testing, keep 5s polling and log a TODO.

#### 10.2 Wiki persistent knowledge (~4h)
- **File:** `src/team/wiki.ts` (new)
- **What:** `writeWikiEntry()`, `readWikiEntry()`, `listWikiEntries()`. Storage: `~/.kt/teams/{name}/wiki/{key}.md`. Workers receive wiki dump in inbox at bootstrap. Leader writes wiki for decisions discovered during execution.
- **Depends on:** nothing
- **Acceptance:**
  ```bash
  $ npx tsx -e "
    import {writeWikiEntry,readWikiEntry,listWikiEntries} from './dist/team/wiki.js';
    await writeWikiEntry('test','auth','Use JWT tokens');
    console.log(await readWikiEntry('test','auth'));
    console.log((await listWikiEntries('test')).length >= 1);
  "
  # Use JWT tokens
  # true
  ```

#### 10.3 Ambiguity detection (~3h)
- **File:** `src/team/interview.ts` (new)
- **What:** `detectAmbiguity(task)` using heuristic: count question words without specifics, OR/AND conjunctions, vague verbs. If ambiguous + confidence >= 0.5 → print questions, wait for user stdin confirmation. If confidence < 0.5 → SKIP, proceed silently.
- **Depends on:** nothing
- **Acceptance:**
  ```bash
  $ npx tsx -e "
    import {detectAmbiguity} from './dist/team/interview.js';
    const r1 = detectAmbiguity('implement auth');
    const r2 = detectAmbiguity('add try-catch in src/team/runtime.ts line 42');
    console.log(r1.ambiguous, r1.confidence >= 0.5);
    console.log(r2.ambiguous, r2.confidence < 0.5);
  "
  # true true
  # false true
  ```
- **Fallback:** If heuristic produces too many false positives in real use, add `--no-interview` flag to bypass entirely.

#### 10.4 Advisory triage routing (~4h)
- **File:** `src/team/role-router.ts` (replace existing)
- **What:** Replace keyword-based `routeTaskToRole()` with `triageTask()`. PASS/LIGHT/HEAVY based on word count, file ref count, architectural keywords. Triage determines worker count AND agent selection.
- **Depends on:** nothing
- **Acceptance:**
  ```bash
  $ npm test 2>&1 | grep "triage"
  # ✔ "fix typo in README" → PASS (1 worker)
  # ✔ "add error handling to auth module" → LIGHT (1-2 workers)
  # ✔ "redesign the API layer with new auth" → HEAVY (3+ workers)
  ```

#### 10.5 Planning phase injection (~5h)
- **File:** `src/team/planner.ts` (new), `src/team/runtime.ts`
- **What:** Before exec, if triage = HEAVY, spawn 1 planner worker (yolo-planner). Planner produces structured subtasks (JSON: `{subtasks: [{subject, description, dependsOn}]}`). Other workers receive plan in inbox. Optional `--no-plan` flag skips.
- **Depends on:** 10.4 (triage determines if planning needed)
- **Acceptance:**
  ```bash
  $ kt team --help | grep -c "no-plan"
  # 1
  $ npm test 2>&1 | grep "planner"
  # ✔ generateExecutionPlan returns structured subtasks
  # ✔ subtasks have subject, description, dependsOn
  # ✔ --no-plan bypasses planning
  ```
- **Fallback:** If planner agent produces bad plans, `--no-plan` is always available. Log warning if plan has 0 subtasks.

### Risk & Mitigation
| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Ambiguity detection false positives | Medium | `--no-interview` bypass flag |
| Planner produces bad plans | Medium | `--no-plan` flag + validation (reject 0-subtask plans) |
| fs.watch platform issues | Medium | Automatic fallback to 10s polling |

### Deliverables
- [ ] fs.watch monitor with polling fallback
- [ ] wiki.ts with read/write/list + inbox injection
- [ ] interview.ts with ambiguity detection + fallback
- [ ] Triage routing (PASS/LIGHT/HEAVY) replacing keyword router
- [ ] Planning phase for HEAVY tasks + --no-plan flag

---

## Phase 11: Brazil Package & Infrastructure

**Goal:** Make kt a Brazil package and the platform other omkc skills build on.
**Effort:** ~15h
**Risk:** Medium — Brazil packaging has learning curve.

### Steps

#### 11.0 Create Brazil package on code.amazon.com (~2h)
- **What:** Create package `KiroTeam` on code.amazon.com. Initialize with NpmPrettyMuch build system. Push existing code.
- **Depends on:** Phase 8 complete (code is stable)
- **Acceptance:**
  ```bash
  $ curl -s "https://code.amazon.com/packages/KiroTeam" -o /dev/null -w "%{http_code}"
  # 200
  ```

#### 11.1 Add Brazil Config file (~2h)
- **File:** `Config`
- **What:** Create Brazil Config with `build-system = npm-pretty-much`, NpmPrettyMuch build-tools, NodeJS dependency. Add `npm-pretty-much.appName: "kt"` to package.json. Ensure `bin/kt.js` has `#!/usr/bin/env node` shebang.
- **Depends on:** 11.0
- **Acceptance:**
  ```bash
  $ brazil-build 2>&1 | tail -1
  # Build succeeded
  $ ls build/bin/kt
  # build/bin/kt
  ```
- **Fallback:** If NpmPrettyMuch has issues with ESM (`"type": "module"`), add `"npm-pretty-much": {"runTest": "never"}` and handle test separately.

#### 11.2 Brazil workspace + pipeline setup (~3h)
- **What:** Create version set (or use existing team VS). Set up build pipeline on Pipelines. Configure AutoPublish for `live` version set.
- **Depends on:** 11.1
- **Acceptance:**
  ```bash
  $ brazil ws create --versionSet ShawnKsh/development --root ~/workplace/kt-ws
  $ cd ~/workplace/kt-ws && brazil ws use --package KiroTeam
  $ brazil-build
  # Build succeeded
  ```

#### 11.3 Expose kt as MCP server (~4h)
- **File:** `src/mcp/team-server.ts` (extend existing)
- **What:** Register 4 MCP tools: `kt_spawn_team`, `kt_get_status`, `kt_send_message`, `kt_shutdown`. Any kiro-cli agent with kt MCP configured can orchestrate teams programmatically.
- **Depends on:** Phase 9 (MCP dependency evaluated)
- **Acceptance:**
  ```bash
  $ npx tsx -e "
    import {createTeamServer} from './dist/mcp/team-server.js';
    const s = createTeamServer();
    const tools = s.listTools().map(t => t.name);
    console.log(tools.length >= 4);
    console.log(tools.includes('kt_spawn_team'));
  "
  # true
  # true
  ```

#### 11.4 Publish omkc skills: team-review + team-refactor (~2h)
- **Files:** `skills/team-review/SKILL.md`, `skills/team-refactor/SKILL.md`
- **What:** team-review: 1 explorer → 1 reviewer → 1 writer. team-refactor: 1 planner → N executors → 1 verifier. Both demonstrate kt as infrastructure.
- **Depends on:** 11.3
- **Acceptance:**
  ```bash
  $ grep -c "kt team" skills/team-review/SKILL.md
  # >= 2
  $ grep -c "kt team" skills/team-refactor/SKILL.md
  # >= 2
  ```

#### 11.5 Publish v1.0.0 to npm + Brazil (~2h)
- **What:** Semantic versioning commitment. Publish to npm AND build in Brazil pipeline.
- **Depends on:** 11.1, 11.2, 11.4
- **Acceptance:**
  ```bash
  $ npm view kiro-team version
  # 1.0.0
  $ brazil vs show ShawnKsh/development | grep KiroTeam
  # KiroTeam = 1.0
  ```

### Risk & Mitigation
| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| NpmPrettyMuch ESM issues | Medium | Set `runTest: "never"`, handle build manually |
| Version set access | Low | Create personal VS first, migrate to team VS later |
| MCP SDK compatibility | Low | Already in deps, just needs wiring |

### Deliverables
- [ ] KiroTeam package on code.amazon.com
- [ ] Brazil Config file + `brazil-build` succeeds
- [ ] Pipeline with AutoPublish
- [ ] 4 MCP tools (spawn, status, message, shutdown)
- [ ] team-review + team-refactor skills
- [ ] v1.0.0 on npm + Brazil

---

## Future (Stretch Goals — not committed)

| Feature | Prerequisite | Why deferred |
|---------|-------------|--------------|
| Cross-model routing (frontier/mini/spark) | Phase 10 triage | Needs kiro-cli model flag validation |
| `kt compose` (YAML multi-team workflows) | Phase 11 MCP | DSL design hard; premature without users |
| Migration guide from omx | Phase 11 skills | Need real omx users to validate |
| Visual verification | kiro-cli screenshot support | Upstream dependency |
| Distributed execution (remote workers) | Phase 9 reliability | Architecture change too large |
| Builder Toolbox distribution | Phase 11 Brazil | Alternative to version set; evaluate after adoption |

---

## Summary

| Phase | Focus | Effort | What you get |
|-------|-------|--------|-------------|
| **8** | Ship MVP | 15h | npm published, 8+ tests, CI, SKILL, Ralph |
| **9** | Reliability | 18h | Locks, confirmed delivery, quality gate, 20+ tests |
| **10** | Intelligence | 20h | Wiki, ambiguity gate, triage, planning phase, fs.watch |
| **11** | Brazil + Infra | 15h | Brazil package, MCP platform, skills, v1.0.0 |
| **Total** | | **~68h** | **Load-bearing omkc infrastructure on Brazil** |

**Critical path:** 8 → 9 → 10 → 11 (strictly sequential)

**Biggest risk:** Phase 10 planning phase — bad plans amplify errors. Mitigated by `--no-plan` flag and plan structure validation.

**Strategic outcome:** kt를 빼면 omkc의 멀티에이전트 스토리가 무너진다. 그게 indispensability.
