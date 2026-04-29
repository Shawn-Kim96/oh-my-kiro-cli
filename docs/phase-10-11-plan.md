# Phase 10: Intelligence & Knowledge Layer (~18h)

## Goal
Add advisory triage, deep-interview intake, and persistent wiki so kt makes smarter dispatch decisions and remembers across sessions.

## Steps

### 10.1 — Advisory Triage Engine (3h)
**What:** `triageTask()` classifies tasks as `PASS | LIGHT | HEAVY` using word count, file-reference density, code-symbol count, dependency signals. PASS→1 worker, LIGHT→2, HEAVY→full decomposition.
**Files:** `src/team/triage.ts`, `src/__tests__/smoke.test.ts`  |  **Depends-on:** None
**Acceptance:** `$ npm run build && node --test dist/__tests__/smoke.test.js 2>&1 | grep -c 'pass'` → ≥56
**Fallback:** Ship with static thresholds (≤10 words=PASS, ≤30=LIGHT, else HEAVY). Add `KT_TRIAGE_DEBUG=1` env var to log triage decisions for threshold tuning.

### 10.2 — Wire Triage into Decomposer (2h)
**What:** Call `triageTask()` at top of `buildTeamExecutionPlan()`. PASS skips decomposition (single-task plan). LIGHT caps subtasks at 2. HEAVY unchanged.
**Files:** `src/team/task-decomposer.ts`  |  **Depends-on:** 10.1
**Acceptance:** `$ npm run build && npx tsx -e "import{buildTeamExecutionPlan}from'./dist/team/task-decomposer.js';const p=buildTeamExecutionPlan('fix typo in README',3,null,'executor');console.log(p.tasks.length)"` → 1
**Fallback:** Gate behind `KT_TRIAGE=1` env var.

### 10.3 — Deep-Interview Intake (4h)
**What:** `interviewTask()` returns `{goal, scope, constraints, acceptanceCriteria, ambiguities}`. Extracts file paths, flags vague verbs ("improve","refactor"), detects missing acceptance criteria. Ambiguities generate clarifying question strings.
**Files:** `src/team/interview.ts`, `src/__tests__/smoke.test.ts`  |  **Depends-on:** None
**Acceptance:** `$ npm run build && npx tsx -e "import{interviewTask}from'./dist/team/interview.js';const r=interviewTask('improve the codebase');console.log(r.ambiguities.length>0?'QUESTIONS':'CLEAR')"` → QUESTIONS
**Fallback:** Reduce to 3 checks: has file path? has verb? has acceptance criteria?

### 10.4 — Wire Interview into CLI (2h)
**What:** In `startTeam()`, call `interviewTask()` before decomposition. If ambiguities exist and `--no-interview` not set, print questions and exit code 2. PASS-triaged tasks skip interview.
**Files:** `src/team/runtime.ts`, `src/cli/index.ts`  |  **Depends-on:** 10.3, 10.1
**Acceptance:** `$ npm run build && node dist/cli/index.js team "improve things" --dry-run 2>&1 | grep -c 'Clarification'` → 1
**Fallback:** Make interview advisory-only (warn, don't block).

### 10.5 — Wiki Persistent Knowledge Store (4h)
**What:** `WikiStore` class: `get(key)`, `set(key,value)`, `search(query)`, `listKeys()`. JSON files under `~/.kt/wiki/{namespace}/`. Namespaces: `team-{name}` (scoped), `global` (cross-session). Search = substring match on keys+values.
**Files:** `src/knowledge/wiki.ts`, `src/utils/paths.ts`  |  **Depends-on:** None
**Acceptance:** `$ npm run build && npx tsx -e "import{WikiStore}from'./dist/knowledge/wiki.js';const w=new WikiStore('test');w.set('k',{v:1});console.log(w.get('k').v);w.cleanup()"` → 1
**Fallback:** Add in-memory index if filesystem search is slow.

### 10.6 — Auto-Capture on Phase Transitions (3h)
**What:** After `transitionPhase()` calls in `runtime.ts`, write wiki entry `{phase,from,to,reason,timestamp}` under `team-{name}`. On completion, write `lessons-learned` with task count, fix attempts, duration.
**Files:** `src/team/runtime.ts`, `src/knowledge/wiki.ts`  |  **Depends-on:** 10.5
**Acceptance:** `$ npm run build && npx tsx -e "import{WikiStore}from'./dist/knowledge/wiki.js';import{transitionPhase,createInitialPhaseState}from'./dist/team/orchestrator.js';transitionPhase(createInitialPhaseState(),'verify');const w=new WikiStore('team-test');w.set('transition-verify',{phase:'verify',ts:Date.now()});console.log(w.listKeys().some(k=>k.includes('transition'))?'OK':'FAIL');w.cleanup()"` → OK
**Fallback:** Call `recordTransition()` from `runtime.ts` instead of modifying `transitionPhase` signature.

## Risk & Mitigation
| Risk | Mitigation |
|------|------------|
| Triage thresholds wrong for real tasks | Ship behind env flag, tune with usage data |
| Interview blocks fast-start users | PASS-triaged tasks auto-skip interview |
| Wiki disk grows unbounded | `maxEntries` per namespace (500), FIFO eviction |

## Deliverables
`triage.ts`, `interview.ts`, `wiki.ts` — triage wired into decomposer, interview into CLI, wiki captures transitions. ≥62 tests.

---

# Phase 11: Brazil Package & Platform (~19h)

## Goal
Ship kt as a Brazil NpmPrettyMuch package with auto-checkpoint, cross-model routing, and wiki MCP tools.

## Steps

### 11.1 — Brazil Package Scaffolding (4h)
**What:** Create `Config` for NpmPrettyMuch. Package name `KiroTeam`, runtime deps (`Commander`, `ModelContextProtocolSdk`). Brazil-build compatible structure + `.npmrc` for internal registry.
**Files:** `Config`, `.npmrc`, `build-tools/`  |  **Depends-on:** None
**Acceptance:** `$ test -f Config && grep -c 'NpmPrettyMuch' Config` → 1
**Fallback:** Use `brazil ws create` to scaffold, copy generated Config.

### 11.2 — Dependency Version Set Alignment (3h)
**What:** Pin deps to versions in target version set. Update `package.json` ranges for Brazil resolution. Add `build_system` and `build-tools` to Config.
**Files:** `Config`, `package.json`  |  **Depends-on:** 11.1
**Acceptance:** `$ grep -c 'build_system' Config` → 1
**Fallback:** Vendor `@modelcontextprotocol/sdk` as bundled dep if not in version set.

### 11.3 — Brazil Build & Test Integration (3h)
**What:** `brazil-build build` runs `tsc`, `brazil-build test` runs `node --test`. Add shell scripts in `build-tools/bin/`. Verify all tests pass.
**Files:** `build-tools/bin/build.sh`, `build-tools/bin/test.sh`  |  **Depends-on:** 11.2
**Acceptance:** `$ npm run build && npm test` → both exit 0 with no failures
**Fallback:** Add `--experimental-vm-modules` if ESM issues arise.

### 11.4 — Auto-Checkpoint on Phase Transitions (3h)
**What:** `autoCheckpoint()` runs `git add -A && git commit -m "kt: {from}→{to}"` in leader cwd after transitions. Skips if no changes. Respects `--no-checkpoint`.
**Files:** `src/team/checkpoint.ts`, `src/team/orchestrator.ts`  |  **Depends-on:** Phase 10
**Acceptance:** `$ npm run build && npx tsx -e "import{autoCheckpoint}from'./dist/team/checkpoint.js';autoCheckpoint('/tmp/no-repo','a','b','r').then(r=>console.log(r.skipped?'SKIP':'OK'))"` → SKIP
**Fallback:** Make checkpoint async fire-and-forget.

### 11.5 — Cross-Model Routing (3h)
**What:** Extend triage result with `modelRoute: 'fast'|'standard'|'reasoning'`. PASS→fast, LIGHT→standard, HEAVY→reasoning. Wire into `parseWorkerLaunchArgs()` in `model-contract.ts`. **Note:** kiro-cli model selection support is unverified; fallback to current model is the primary path until confirmed.
**Files:** `src/team/triage.ts`, `src/config/model-contract.ts`  |  **Depends-on:** 10.1
**Acceptance:** `$ npm run build && npx tsx -e "import{triageTask}from'./dist/team/triage.js';console.log(triageTask('fix typo').modelRoute)"` → fast
**Fallback:** Default all routes to current model if config missing.

### 11.6 — MCP Wiki Tools (3h)
**What:** Expose `kt_wiki_get`, `kt_wiki_set`, `kt_wiki_search` as MCP tools in `team-server.ts`. Workers read/write knowledge during execution.
**Files:** `src/mcp/team-server.ts`  |  **Depends-on:** 10.5, existing `team-server.ts` MCP pattern
**Acceptance:** `$ npm run build && grep -c 'kt_wiki' dist/mcp/team-server.js` → ≥3
**Fallback:** Expose via `handleApiOperation` dispatch if MCP tool API changes.

## Risk & Mitigation
| Risk | Mitigation |
|------|------------|
| Brazil version set missing deps | Vendor deps or use `brazil-third-party-tool` |
| Checkpoint creates noisy git history | Default off, enable with `--checkpoint` |
| Model routing picks wrong tier | Conservative defaults (current model unless high confidence) |

## Deliverables
Brazil `Config` + build scripts, `checkpoint.ts`, cross-model routing, wiki MCP tools. ≥68 tests.

---

# Phase 12: Competitive Edge (~12h) [OPTIONAL STRETCH]

## Goal
Generalize state machine into reusable pipeline and surface kt's reliability moat.

### 12.1 — Pipeline Abstraction (4h)
Extract orchestrator into generic `Pipeline<TPhase>` with configurable transitions, hooks, max-retry.
**Files:** `src/pipeline/engine.ts`  |  **Depends-on:** Phase 11
**Acceptance:** `$ npm run build && npx tsx -e "import{createPipeline}from'./dist/pipeline/engine.js';const p=createPipeline({phases:['a','b','done'],transitions:{a:['b'],b:['done']},terminal:['done']});p.advance('b');p.advance('done');console.log(p.current)"` → done

### 12.2 — Reliability Dashboard in HUD (4h)
Add heartbeat-miss count, lock contention, crash-resume count to HUD.
**Files:** `src/hud/render.ts`, `src/hud/state.ts`  |  **Depends-on:** None
**Acceptance:** `$ npm run build && grep -c 'heartbeat' dist/hud/render.js` → ≥1

### 12.3 — Verification Report Generator (4h)
At team completion, write `~/.kt/reports/{team}-{ts}.json` with per-task fingerprint, status, worker, duration.
**Files:** `src/team/verification-report.ts`  |  **Depends-on:** None
**Acceptance:** `$ npm run build && npx tsx -e "import{generateReport}from'./dist/team/verification-report.js';console.log(generateReport('t',[{id:'1',status:'completed',owner:'w-0',duration:30}]).tasks.length)"` → 1

---

# Future / Stretch Goals

| Feature | Priority | Effort | Why Deferred |
|---------|----------|--------|-------------|
| Plugin system for custom roles | P2 | Large | Needs stable pipeline API (Phase 12) |
| Multi-repo worktree orchestration | P2 | Large | Single-repo covers 90% of cases |
| Metrics export (CloudWatch) | P2 | Medium | Needs Brazil deployment first |
| NL wiki search (embeddings) | P3 | Medium | Substring search sufficient for MVP |
| Adapter layer for non-kiro agents | P3 | Large | Wrong fit for terminal-first arch |

---

# Summary

| Phase | Effort | What You Get |
|-------|--------|-------------|
| **10: Intelligence & Knowledge** | 18h | PASS/LIGHT/HEAVY triage, deep-interview intake, persistent wiki — smarter dispatch, cross-session memory |
| **11: Brazil & Platform** | 19h | Brazil package, auto-checkpoint, cross-model routing, wiki MCP tools — deployable infra with cost-aware models |
| **12: Competitive Edge** *(stretch)* | 12h | Generic pipeline, reliability dashboard, verification reports — moat becomes visible |
| **Core total** | **37h** | **All P0 gaps closed, 2/3 P1 gaps, Brazil-packaged** |
