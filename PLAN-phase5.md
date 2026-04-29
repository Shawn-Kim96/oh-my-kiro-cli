# kiro-team (kt) — Phase 5: Phase Controller + Role Router

## Goal
Team phase state machine (exec→verify→fix) + task→role 자동 매핑.

## Preconditions
- Phase 0-4 완료

## Design Decision: plan/prd phase 생략
omx는 `team-plan → team-prd → team-exec → team-verify → team-fix` 5단계.
kt는 `exec → verify → fix` 3단계.

이유:
- kiro-cli의 planner agent (yolo-planner)가 이미 planning 수행
- kt에서 plan phase를 별도로 관리하면 kiro-cli의 planning과 중복
- planning이 필요하면 exec phase에서 planner role worker를 실행
- PRD(Product Requirements Document)는 kt의 scope 밖 (kt는 execution tool)

## Steps

### 5.1 Phase State Machine (`src/team/orchestrator.ts`)

```typescript
type TeamPhase = 'exec' | 'verify' | 'fix';
type TerminalPhase = 'complete' | 'failed' | 'cancelled';

const TRANSITIONS: Record<TeamPhase, Array<TeamPhase | TerminalPhase>> = {
  exec:   ['verify'],
  verify: ['fix', 'complete', 'failed'],
  fix:    ['exec', 'verify', 'complete', 'failed'],
};

function isValidTransition(from: TeamPhase, to: TeamPhase | TerminalPhase): boolean
function isTerminalPhase(phase: TeamPhase | TerminalPhase): phase is TerminalPhase

function transitionPhase(
  state: PhaseState,
  to: TeamPhase | TerminalPhase,
  reason?: string,
): PhaseState
// - validates transition
// - if to='fix': current_fix_attempt++
// - if fix_attempt > max_fix_attempts → auto-transition to 'failed'
// - appends to transitions array
// - returns new PhaseState

function createInitialPhaseState(maxFixAttempts?: number): PhaseState
// default: exec phase, max_fix_attempts=3
```

### 5.2 Phase Controller (`src/team/phase-controller.ts`)

```typescript
function inferPhaseFromTaskCounts(counts: {
  pending: number;
  blocked: number;
  in_progress: number;
  completed: number;
  failed: number;
}, options?: {verificationPending?: boolean}): TeamPhase | TerminalPhase
```

로직:
```
allTerminal = (pending=0 AND blocked=0 AND in_progress=0)
if allTerminal AND failed=0:
  if verificationPending → 'verify'
  else → 'complete'
if allTerminal AND failed>0 → 'fix'
else → 'exec'
```

```typescript
function reconcilePhaseState(
  persisted: PhaseState | null,
  target: TeamPhase | TerminalPhase,
): PhaseState
```
- persisted가 null → createInitialPhaseState() + transition to target
- persisted.current_phase == target → return as-is (update timestamp)
- persisted가 terminal → target도 terminal이면 유지, 아니면 reopen
- 그 외 → buildTransitionPath(from, to) → 순차 transition

```typescript
function buildTransitionPath(
  from: TeamPhase | TerminalPhase,
  to: TeamPhase | TerminalPhase,
): Array<TeamPhase | TerminalPhase>
```
- exec → verify: ['verify']
- exec → fix: ['verify', 'fix']
- exec → complete: ['verify', 'complete']
- fix → exec: ['exec']
- fix → complete: ['complete']

### 5.3 Role Router (`src/team/role-router.ts`)

```typescript
interface RoleRouterResult {
  role: string;
  agent: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

function routeTaskToRole(
  taskSubject: string,
  taskDescription: string,
  phase: TeamPhase | null,
  fallbackRole: string,
): RoleRouterResult
```

**Keyword heuristics (extensible):**
```typescript
const ROLE_KEYWORDS: ReadonlyArray<{role: string; agent: string; keywords: readonly string[]}> = [
  {role: 'explorer',  agent: 'yolo-explorer',            keywords: ['find', 'search', 'locate', 'grep', 'pattern', 'where', 'list all']},
  {role: 'debugger',  agent: 'yolo-oracle',              keywords: ['debug', 'investigate', 'root cause', 'bisect', 'diagnose', 'trace', 'stack trace']},
  {role: 'writer',    agent: 'yolo-document-writer',      keywords: ['doc', 'readme', 'guide', 'changelog', 'documentation', 'api doc']},
  {role: 'reviewer',  agent: 'yolo-momus',               keywords: ['review', 'audit', 'quality', 'lint', 'anti-pattern', 'code review']},
  {role: 'frontend',  agent: 'yolo-frontend-specialist',  keywords: ['ui', 'css', 'component', 'layout', 'responsive', 'tailwind', 'react']},
  {role: 'librarian', agent: 'yolo-librarian',            keywords: ['research', 'documentation', 'api reference', 'best practice', 'example']},
  {role: 'planner',   agent: 'yolo-planner',              keywords: ['plan', 'break down', 'decompose', 'task list', 'roadmap']},
  {role: 'executor',  agent: 'yolo-general',              keywords: ['implement', 'build', 'create', 'fix', 'ship', 'add', 'update', 'migrate']},
];
```

**Scoring:**
- 2+ keyword matches from same category → high confidence
- 1 keyword match → medium confidence
- 0 matches → low confidence, use fallbackRole

**Keyword position weighting:**
- keyword in subject → weight 2x
- keyword in description → weight 1x

**Phase-aware defaults:**
```typescript
function getPhaseDefaultRoles(phase: TeamPhase): string[] {
  switch (phase) {
    case 'exec':   return ['executor', 'frontend'];
    case 'verify': return ['reviewer', 'explorer'];
    case 'fix':    return ['debugger', 'executor'];
  }
}
```

### 5.4 Phase-Specific Agent Selection

Monitor loop에서 phase 전환 시:
- verify phase → 기존 executor workers에게 verify task 할당 (role 변경 없이 task 내용으로 구분)
- fix phase → failed task를 debugger role worker에게 재할당 (또는 기존 worker에게 fix 지시)

## Deliverables
- [ ] `src/team/orchestrator.ts` — phase state machine
- [ ] `src/team/phase-controller.ts` — auto phase inference + reconciliation + transition path
- [ ] `src/team/role-router.ts` — task → role routing with scoring
- [ ] Unit tests:
  - Valid/invalid transitions
  - Fix loop max attempts → auto 'failed'
  - Phase inference from task counts
  - Role routing: "find API endpoints" → explorer (high)
  - Role routing: "implement OAuth" → executor (high)
  - Role routing: "debug flaky test" → debugger (high)
  - Role routing: unknown → fallback (low)
  - Subject vs description keyword weighting

## Acceptance Criteria
- `isValidTransition('exec', 'verify')` → true
- `isValidTransition('exec', 'complete')` → false (must go through verify)
- `transitionPhase(state, 'fix')` 4th time (max=3) → auto 'failed'
- `inferPhaseFromTaskCounts({completed:3, failed:0, ...})` → 'complete'
- `inferPhaseFromTaskCounts({completed:2, failed:1, ...})` → 'fix'
- `routeTaskToRole("find all API endpoints", ...)` → {role:'explorer', confidence:'high'}
- `routeTaskToRole("xyz unknown task", ...)` → {role:'executor', confidence:'low'}
- `reconcilePhaseState(null, 'verify')` → creates state + transitions exec→verify
