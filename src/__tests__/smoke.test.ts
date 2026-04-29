import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseSpec, resolveAgent } from '../config/agent-mapping.js';
import { routeTaskToRole } from '../team/role-router.js';
import {
  isValidTransition,
  transitionPhase,
  createInitialPhaseState,
  isTerminalPhase,
} from '../team/orchestrator.js';
import { splitTaskString } from '../team/task-decomposer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const kchBin = join(__dirname, '..', '..', 'bin', 'kch.js');
const khBin = join(__dirname, '..', '..', 'bin', 'kh.js');
const ktBin = join(__dirname, '..', '..', 'bin', 'kt.js');
const packageJsonPath = join(__dirname, '..', '..', 'package.json');

// ── CLI integration ──

describe('CLI integration', () => {
  it('kch --help prints usage', () => {
    const out = execFileSync('node', [kchBin, '--help'], { encoding: 'utf8' });
    assert.ok(out.includes('Usage: kch'), 'Should contain kch usage');
    assert.ok(out.includes('team'), 'Should list team command');
    assert.ok(out.includes('doctor'), 'Should list doctor command');
  });

  it('kch --version prints 0.1.0', () => {
    const out = execFileSync('node', [kchBin, '--version'], { encoding: 'utf8' });
    assert.ok(out.trim().includes('0.1.0'), `Expected 0.1.0, got: ${out.trim()}`);
  });

  it('kch team --help prints team usage', () => {
    const out = execFileSync('node', [kchBin, 'team', '--help'], { encoding: 'utf8' });
    assert.ok(out.includes('task'), 'Should mention task argument');
  });

  it('kch operator commands expose help', () => {
    for (const command of ['setup', 'cleanup', 'cancel', 'trace', 'explore']) {
      const out = execFileSync('node', [kchBin, command, '--help'], { encoding: 'utf8' });
      assert.ok(out.includes('Usage:'), `${command} should print usage`);
    }
  });

  it('kh and kt compatibility aliases print kch usage', () => {
    for (const bin of [khBin, ktBin]) {
      const out = execFileSync('node', [bin, '--help'], { encoding: 'utf8' });
      assert.ok(out.includes('Usage: kch'), `Expected kch usage from ${bin}`);
    }
  });

  it('package exposes kch primary and kh/kt compatibility bins', () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { name: string; bin: Record<string, string> };
    assert.equal(pkg.name, 'kiro-cli-hive');
    assert.equal(pkg.bin['kch'], './bin/kch.js');
    assert.equal(pkg.bin['kh'], './bin/kh.js');
    assert.equal(pkg.bin['kt'], './bin/kt.js');
    for (const rel of Object.values(pkg.bin)) {
      assert.equal(existsSync(join(__dirname, '..', '..', rel)), true, `${rel} should exist`);
    }
  });
});

// ── parseSpec ──

describe('parseSpec', () => {
  it('parses count:role format', () => {
    const r = parseSpec('3:explorer');
    assert.equal(r.workerCount, 3);
    assert.equal(r.agentType, 'explorer');
  });

  it('parses count-only format', () => {
    const r = parseSpec('5');
    assert.equal(r.workerCount, 5);
    assert.equal(r.agentType, 'executor');
  });

  it('defaults to 1 executor when undefined', () => {
    const r = parseSpec(undefined);
    assert.equal(r.workerCount, 1);
    assert.equal(r.agentType, 'executor');
  });

  it('clamps 0 to 1 worker', () => {
    const r = parseSpec('0:executor');
    assert.equal(r.workerCount, 1);
  });

  it('handles non-numeric count gracefully', () => {
    const r = parseSpec('abc:explorer');
    assert.equal(r.workerCount, 1);
    assert.equal(r.agentType, 'explorer');
  });
});

// ── resolveAgent ──

describe('resolveAgent', () => {
  it('maps executor to yolo-general', () => {
    assert.equal(resolveAgent('executor'), 'yolo-general');
  });

  it('maps explorer to yolo-explorer', () => {
    assert.equal(resolveAgent('explorer'), 'yolo-explorer');
  });

  it('maps debugger to yolo-oracle', () => {
    assert.equal(resolveAgent('debugger'), 'yolo-oracle');
  });

  it('falls back to yolo-general for unknown role', () => {
    assert.equal(resolveAgent('nonexistent-role'), 'yolo-general');
  });
});

// ── routeTaskToRole ──

describe('routeTaskToRole', () => {
  it('routes "find API endpoints" to explorer', () => {
    const r = routeTaskToRole('find all API endpoints', '', null, 'executor');
    assert.equal(r.role, 'explorer');
  });

  it('routes "implement OAuth" to executor', () => {
    const r = routeTaskToRole('implement OAuth callback handler', '', null, 'executor');
    assert.equal(r.role, 'executor');
  });

  it('routes "debug flaky test" to debugger', () => {
    const r = routeTaskToRole('debug the flaky test in auth module', '', null, 'executor');
    assert.equal(r.role, 'debugger');
  });

  it('falls back to provided role for unknown tasks', () => {
    const r = routeTaskToRole('xyz unknown task', '', null, 'executor');
    assert.equal(r.role, 'executor');
    assert.equal(r.confidence, 'low');
  });

  it('considers description for routing', () => {
    const r = routeTaskToRole('do the thing', 'search for all patterns in the codebase', null, 'executor');
    assert.equal(r.role, 'explorer');
  });
});

// ── Phase transitions ──

describe('isValidTransition', () => {
  it('allows exec → verify', () => {
    assert.equal(isValidTransition('exec', 'verify'), true);
  });

  it('rejects exec → complete (must go through verify)', () => {
    assert.equal(isValidTransition('exec', 'complete'), false);
  });

  it('allows verify → fix', () => {
    assert.equal(isValidTransition('verify', 'fix'), true);
  });

  it('allows verify → complete', () => {
    assert.equal(isValidTransition('verify', 'complete'), true);
  });

  it('allows fix → exec (retry)', () => {
    assert.equal(isValidTransition('fix', 'exec'), true);
  });
});

describe('transitionPhase', () => {
  it('transitions exec → verify', () => {
    const state = createInitialPhaseState();
    const next = transitionPhase(state, 'verify');
    assert.equal(next.current_phase, 'verify');
    assert.equal(next.transitions.length, 1);
  });

  it('throws on invalid transition exec → complete', () => {
    const state = createInitialPhaseState();
    assert.throws(() => transitionPhase(state, 'complete'), /Invalid transition/);
  });

  it('throws on transition from terminal phase', () => {
    const state = createInitialPhaseState();
    const s1 = transitionPhase(state, 'verify');
    const s2 = transitionPhase(s1, 'complete');
    assert.throws(() => transitionPhase(s2, 'exec'), /terminal phase/);
  });

  it('auto-fails after max fix attempts exceeded', () => {
    let state = createInitialPhaseState(2); // max 2 fix attempts
    state = transitionPhase(state, 'verify');
    state = transitionPhase(state, 'fix');   // attempt 1
    state = transitionPhase(state, 'exec');
    state = transitionPhase(state, 'verify');
    state = transitionPhase(state, 'fix');   // attempt 2
    state = transitionPhase(state, 'exec');
    state = transitionPhase(state, 'verify');
    const final = transitionPhase(state, 'fix'); // attempt 3 → auto-fail
    assert.equal(final.current_phase, 'failed');
  });
});

describe('isTerminalPhase', () => {
  it('complete is terminal', () => assert.equal(isTerminalPhase('complete'), true));
  it('failed is terminal', () => assert.equal(isTerminalPhase('failed'), true));
  it('cancelled is terminal', () => assert.equal(isTerminalPhase('cancelled'), true));
  it('exec is not terminal', () => assert.equal(isTerminalPhase('exec'), false));
  it('verify is not terminal', () => assert.equal(isTerminalPhase('verify'), false));
});

// ── Task decomposition ──

describe('splitTaskString', () => {
  it('splits numbered list into subtasks', () => {
    const plan = splitTaskString('1) implement auth 2) add tests 3) update docs');
    assert.ok(plan.subtasks.length >= 3, `Expected >= 3 subtasks, got ${plan.subtasks.length}`);
  });

  it('returns single candidate for plain text', () => {
    const plan = splitTaskString('implement OAuth callback handler');
    assert.ok(plan.subtasks.length <= 2, `Expected <= 2 subtasks, got ${plan.subtasks.length}`);
  });
});

import { assessOutput } from '../team/quality-gate.js';
import { staleLockThreshold, withFileLock } from '../team/state/locks.js';
import { inferPhaseFromTaskCounts } from '../team/phase-controller.js';
import { tmpdir } from 'os';
import { mkdtemp, rm } from 'fs/promises';
import { kchStateDir, ktStateDir } from '../utils/paths.js';
import type { TeamConfig } from '../team/contracts.js';
import {
  initTeamState, createTask, readTask, claimTask, transitionTaskStatus,
  recordTaskQualityResult, readPhaseState, writePhaseState,
} from '../team/state.js';
import { handleApiOperation } from '../team/api-interop.js';
import { generateWorkerInbox } from '../team/worker-bootstrap.js';
import { latestTeamName } from '../cli/team-select.js';
import { findCleanupCandidates } from '../cli/cleanup.js';

// ── Quality Gate ──

describe('assessOutput', () => {
  it('fails on empty result', () => {
    const r = assessOutput('', 'implement auth');
    assert.equal(r.pass, false);
    assert.ok(r.issues.some(i => i.includes('empty')));
  });

  it('fails on whitespace-only result', () => {
    const r = assessOutput('   \n  ', 'implement auth');
    assert.equal(r.pass, false);
  });

  it('fails on short result with error pattern', () => {
    const r = assessOutput('TypeError: cannot read', 'implement auth');
    assert.equal(r.pass, false);
    assert.ok(r.issues.some(i => i.includes('error pattern')));
  });

  it('passes on relevant result', () => {
    const r = assessOutput(
      'Implemented the authentication module with JWT token validation and refresh logic.',
      'implement authentication with JWT tokens',
    );
    assert.equal(r.pass, true);
  });

  it('fails on irrelevant result (low keyword overlap)', () => {
    const r = assessOutput(
      'The weather today is sunny with a high of 75 degrees.',
      'implement authentication with JWT tokens',
    );
    assert.equal(r.pass, false);
    assert.ok(r.issues.some(i => i.includes('overlap')));
  });

  it('passes when task has no meaningful words', () => {
    const r = assessOutput('Done.', 'do it');
    assert.equal(r.pass, true);
  });

  it('passes when error pattern is in success context', () => {
    const r = assessOutput(
      'Fixed the TypeError in the authentication module by adding null checks.',
      'fix TypeError in auth module',
    );
    assert.equal(r.pass, true);
  });
});

// ── State root identity ──

describe('kch state root resolution', () => {
  const original = {
    KCH_STATE_ROOT: process.env['KCH_STATE_ROOT'],
    KT_STATE_ROOT: process.env['KT_STATE_ROOT'],
    KH_STATE_ROOT: process.env['KH_STATE_ROOT'],
  };

  function restoreEnv(): void {
    for (const key of Object.keys(original) as Array<keyof typeof original>) {
      const value = original[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  it('prefers KCH_STATE_ROOT over legacy aliases', () => {
    process.env['KCH_STATE_ROOT'] = '/tmp/kch-primary';
    process.env['KT_STATE_ROOT'] = '/tmp/kt-legacy';
    process.env['KH_STATE_ROOT'] = '/tmp/kh-legacy';
    assert.equal(kchStateDir(), '/tmp/kch-primary');
    assert.equal(ktStateDir(), '/tmp/kch-primary');
    restoreEnv();
  });

  it('falls back to KT_STATE_ROOT then KH_STATE_ROOT', () => {
    delete process.env['KCH_STATE_ROOT'];
    process.env['KT_STATE_ROOT'] = '/tmp/kt-legacy';
    process.env['KH_STATE_ROOT'] = '/tmp/kh-legacy';
    assert.equal(kchStateDir(), '/tmp/kt-legacy');

    delete process.env['KT_STATE_ROOT'];
    assert.equal(kchStateDir(), '/tmp/kh-legacy');
    restoreEnv();
  });
});

function testTeamConfig(name: string, stateRoot: string): TeamConfig {
  return {
    name,
    task: 'implement authentication module',
    agent_type: 'executor',
    worker_count: 1,
    max_workers: 1,
    workers: [{
      name: 'worker-0',
      index: 0,
      role: 'executor',
      agent: 'yolo-general',
      pane_id: null,
      assigned_tasks: [],
      worker_cli: 'kiro-cli',
    }],
    created_at: new Date().toISOString(),
    tmux_target: '',
    leader_pane_id: null,
    hud_pane_id: null,
    next_task_id: 1,
    next_worker_index: 1,
    leader_cwd: process.cwd(),
    team_state_root: stateRoot,
  };
}

async function withTempStateRoot<T>(fn: (stateRoot: string, teamName: string) => Promise<T>): Promise<T> {
  const oldKch = process.env['KCH_STATE_ROOT'];
  const oldKt = process.env['KT_STATE_ROOT'];
  const oldKh = process.env['KH_STATE_ROOT'];
  const stateRoot = await mkdtemp(join(tmpdir(), 'kch-state-'));
  const teamName = `team-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  process.env['KCH_STATE_ROOT'] = stateRoot;
  delete process.env['KT_STATE_ROOT'];
  delete process.env['KH_STATE_ROOT'];
  try {
    await initTeamState(testTeamConfig(teamName, stateRoot));
    return await fn(stateRoot, teamName);
  } finally {
    if (oldKch === undefined) delete process.env['KCH_STATE_ROOT']; else process.env['KCH_STATE_ROOT'] = oldKch;
    if (oldKt === undefined) delete process.env['KT_STATE_ROOT']; else process.env['KT_STATE_ROOT'] = oldKt;
    if (oldKh === undefined) delete process.env['KH_STATE_ROOT']; else process.env['KH_STATE_ROOT'] = oldKh;
    await rm(stateRoot, { recursive: true, force: true });
  }
}

// ── Worker API protocol ──

describe('worker task API protocol', () => {
  it('requires expected_version for claim-task API calls', async () => {
    await withTempStateRoot(async (_stateRoot, teamName) => {
      const task = await createTask(teamName, { subject: 'implement auth', description: 'implement authentication module' });
      const result = await handleApiOperation('claim-task', {
        team_name: teamName,
        task_id: task.id,
        worker: 'worker-0',
      });
      assert.equal(result.ok, false);
      assert.match(result.error ?? '', /expected_version is required/);
    });
  });

  it('claims and transitions only with the returned claim token', async () => {
    await withTempStateRoot(async (_stateRoot, teamName) => {
      const task = await createTask(teamName, { subject: 'implement auth', description: 'implement authentication module' });
      const claim = await claimTask(teamName, task.id, 'worker-0', task.version);
      assert.equal(claim.ok, true);
      assert.ok(claim.claim_token);

      const missing = await transitionTaskStatus(teamName, task.id, 'in_progress', 'completed', '', { result: 'Implemented authentication module.' });
      assert.equal(missing.ok, false);
      assert.equal(missing.error, 'missing_claim_token');

      const wrong = await transitionTaskStatus(teamName, task.id, 'in_progress', 'completed', 'wrong-token', { result: 'Implemented authentication module.' });
      assert.equal(wrong.ok, false);
      assert.equal(wrong.error, 'invalid_claim_token');

      const ok = await transitionTaskStatus(teamName, task.id, 'in_progress', 'completed', claim.claim_token!, { result: 'Implemented authentication module with tests.' });
      assert.equal(ok.ok, true);

      const completed = await readTask(teamName, task.id);
      assert.equal(completed?.status, 'completed');
      assert.equal(completed?.claim_token, null);
    });
  });

  it('refuses claim by a worker that does not own the assigned task', async () => {
    await withTempStateRoot(async (_stateRoot, teamName) => {
      const task = await createTask(teamName, {
        subject: 'implement auth',
        description: 'implement authentication module',
        owner: 'worker-0',
      });
      const claim = await claimTask(teamName, task.id, 'worker-1', task.version);
      assert.equal(claim.ok, false);
      assert.match(claim.error ?? '', /task_owned_by:worker-0/);
    });
  });

  it('records quality gate failure on completed tasks', async () => {
    await withTempStateRoot(async (_stateRoot, teamName) => {
      const task = await createTask(teamName, { subject: 'implement auth', description: 'implement authentication module' });
      const claim = await claimTask(teamName, task.id, 'worker-0', task.version);
      assert.equal(claim.ok, true);
      await transitionTaskStatus(teamName, task.id, 'in_progress', 'completed', claim.claim_token!, { result: 'weather report' });

      const quality = await recordTaskQualityResult(teamName, task.id, { pass: false, issues: ['Low keyword overlap'] });
      assert.equal(quality.ok, true);

      const failed = await readTask(teamName, task.id);
      assert.equal(failed?.status, 'failed');
      assert.equal(failed?.quality_checked, true);
      assert.equal(failed?.quality_passed, false);
      assert.match(failed?.error ?? '', /quality_gate/);
    });
  });
});

describe('phase persistence', () => {
  it('writes and reads phase state', async () => {
    await withTempStateRoot(async (_stateRoot, teamName) => {
      const phase = await readPhaseState(teamName);
      assert.equal(phase?.current_phase, 'exec');
      assert.ok(phase);
      await writePhaseState(teamName, { ...phase, current_phase: 'verify', updated_at: new Date().toISOString() });
      const updated = await readPhaseState(teamName);
      assert.equal(updated?.current_phase, 'verify');
    });
  });
});

describe('latest team selection', () => {
  it('uses config.created_at instead of lexical team name', async () => {
    await withTempStateRoot(async (stateRoot) => {
      await initTeamState({
        ...testTeamConfig('z-old', stateRoot),
        name: 'z-old',
        created_at: '2026-01-01T00:00:00.000Z',
      });
      await initTeamState({
        ...testTeamConfig('a-new', stateRoot),
        name: 'a-new',
        created_at: '2099-01-02T00:00:00.000Z',
      });
      assert.equal(await latestTeamName(), 'a-new');
    });
  });
});

describe('cleanup safety', () => {
  it('does not classify active lock directories as cleanup candidates', async () => {
    await withTempStateRoot(async (stateRoot, teamName) => {
      mkdirSync(join(stateRoot, 'teams', teamName, '.locks'), { recursive: true });
      const candidates = await findCleanupCandidates(stateRoot);
      assert.equal(candidates.some(c => c.path.includes(teamName)), false);
    });
  });
});

describe('worker bootstrap protocol', () => {
  it('contains kch API, expected_version, claim_token, and no unconditional git commit', () => {
    const inbox = generateWorkerInbox({
      teamName: 'team-1',
      workerName: 'worker-0',
      role: 'executor',
      agent: 'yolo-general',
      tasks: [{ id: '1', subject: 'implement auth', description: 'implement authentication module', status: 'pending' }],
      stateRoot: '/tmp/kch',
      leaderCwd: '/repo',
    });

    assert.match(inbox, /kch api claim-task/);
    assert.match(inbox, /expected_version/);
    assert.match(inbox, /claim_token/);
    assert.doesNotMatch(inbox, /git add -A && git commit/);
  });
});

describe('skill catalog', () => {
  it('has valid frontmatter for every skill', () => {
    const skillsDir = join(__dirname, '..', '..', 'skills');
    const skillDirs = readdirSync(skillsDir, { withFileTypes: true }).filter(e => e.isDirectory());
    assert.ok(skillDirs.length >= 8, 'Expected kch workflow skills');

    for (const dirent of skillDirs) {
      const path = join(skillsDir, dirent.name, 'SKILL.md');
      assert.equal(existsSync(path), true, `${dirent.name} should have SKILL.md`);
      const content = readFileSync(path, 'utf-8');
      assert.match(content, /^---\nname: .+\ndescription: .+\n---/m, `${dirent.name} should have frontmatter`);
    }
  });
});

// ── staleLockThreshold ──

describe('staleLockThreshold', () => {
  it('returns 30000 for non-lock paths', async () => {
    const t = await staleLockThreshold('/some/random/path');
    assert.equal(t, 30_000);
  });

  it('returns 30000 for task locks (no worker mapping)', async () => {
    const t = await staleLockThreshold('/home/user/.kch/teams/myteam/.locks/task-1');
    assert.equal(t, 30_000);
  });

  it('returns 30000 when heartbeat file missing', async () => {
    const t = await staleLockThreshold('/home/user/.kch/teams/nonexistent/.locks/mailbox-worker-0');
    assert.equal(t, 30_000);
  });
});

// ── withFileLock ──

describe('withFileLock', () => {
  const lockBase = join(tmpdir(), `kch-test-locks-${Date.now()}`);

  it('executes function and returns result', async () => {
    const lockPath = join(lockBase, 'test-exec');
    const result = await withFileLock(lockPath, async () => 42);
    assert.equal(result, 42);
  });

  it('releases lock after execution', async () => {
    const lockPath = join(lockBase, 'test-release');
    await withFileLock(lockPath, async () => 'done');
    // Should be able to acquire again immediately
    const result = await withFileLock(lockPath, async () => 'again');
    assert.equal(result, 'again');
  });

  it('releases lock even on error', async () => {
    const lockPath = join(lockBase, 'test-error');
    try {
      await withFileLock(lockPath, async () => { throw new Error('boom'); });
    } catch { /* expected */ }
    // Lock should be released, can acquire again
    const result = await withFileLock(lockPath, async () => 'recovered');
    assert.equal(result, 'recovered');
  });

  it('concurrent access: only one succeeds at a time', async () => {
    const lockPath = join(lockBase, 'test-concurrent');
    const order: number[] = [];
    const p1 = withFileLock(lockPath, async () => {
      order.push(1);
      await new Promise(r => setTimeout(r, 200));
      order.push(2);
    });
    // Small delay to ensure p1 acquires first
    await new Promise(r => setTimeout(r, 50));
    const p2 = withFileLock(lockPath, async () => {
      order.push(3);
    });
    await Promise.all([p1, p2]);
    // p1 should complete (1,2) before p2 starts (3)
    assert.deepEqual(order, [1, 2, 3]);
  });

  // Cleanup
  it('cleanup temp locks', async () => {
    await rm(lockBase, { recursive: true, force: true });
  });
});

// ── Phase inference ──

describe('inferPhaseFromTaskCounts', () => {
  it('returns complete when all tasks completed', () => {
    const phase = inferPhaseFromTaskCounts({ pending: 0, blocked: 0, in_progress: 0, completed: 3, failed: 0 });
    assert.equal(phase, 'complete');
  });

  it('returns fix when some tasks failed', () => {
    const phase = inferPhaseFromTaskCounts({ pending: 0, blocked: 0, in_progress: 0, completed: 2, failed: 1 });
    assert.equal(phase, 'fix');
  });

  it('returns exec when tasks still in progress', () => {
    const phase = inferPhaseFromTaskCounts({ pending: 1, blocked: 0, in_progress: 1, completed: 1, failed: 0 });
    assert.equal(phase, 'exec');
  });
});

// ── Full phase cycle ──

describe('full phase cycle', () => {
  it('exec → verify → complete', () => {
    let state = createInitialPhaseState();
    assert.equal(state.current_phase, 'exec');
    state = transitionPhase(state, 'verify');
    assert.equal(state.current_phase, 'verify');
    state = transitionPhase(state, 'complete');
    assert.equal(state.current_phase, 'complete');
    assert.equal(state.transitions.length, 2);
  });

  it('exec → verify → fix → exec → verify → complete', () => {
    let state = createInitialPhaseState();
    state = transitionPhase(state, 'verify');
    state = transitionPhase(state, 'fix');
    assert.equal(state.current_fix_attempt, 1);
    state = transitionPhase(state, 'exec');
    state = transitionPhase(state, 'verify');
    state = transitionPhase(state, 'complete');
    assert.equal(state.current_phase, 'complete');
    assert.equal(state.transitions.length, 5);
  });
});

import { triageTask } from '../team/triage.js';
import { interviewTask } from '../team/interview.js';
import { WikiStore } from '../knowledge/wiki.js';

// ── Triage ──

describe('triageTask', () => {
  it('classifies simple task as PASS', () => {
    const r = triageTask('fix typo in README');
    assert.equal(r.level, 'PASS');
    assert.equal(r.workerCount, 1);
    assert.equal(r.modelRoute, 'fast');
  });

  it('classifies moderate task as LIGHT', () => {
    const r = triageTask('add error handling to the auth module in src/auth.ts and src/middleware.ts');
    assert.equal(r.level, 'LIGHT');
    assert.equal(r.workerCount, 2);
    assert.equal(r.modelRoute, 'standard');
  });

  it('classifies complex task as HEAVY', () => {
    const r = triageTask('redesign the entire API layer with new authentication, rate limiting, caching, and migrate all endpoints from REST to GraphQL across src/api/ src/auth/ src/cache/ src/middleware/');
    assert.equal(r.level, 'HEAVY');
    assert.equal(r.workerCount, 3);
    assert.equal(r.modelRoute, 'reasoning');
  });

  it('detects architectural keywords', () => {
    const r = triageTask('migrate the database from MySQL to PostgreSQL');
    assert.equal(r.level, 'HEAVY');
  });
});

// ── Interview ──

describe('interviewTask', () => {
  it('detects ambiguity in vague task', () => {
    const r = interviewTask('improve the codebase');
    assert.ok(r.ambiguities.length > 0, 'Should have ambiguities');
  });

  it('extracts file paths as scope', () => {
    const r = interviewTask('add try-catch in src/team/runtime.ts');
    assert.ok(r.scope.some(s => s.includes('runtime.ts')), 'Should find runtime.ts in scope');
  });

  it('no ambiguity for specific task', () => {
    const r = interviewTask('add try-catch in src/team/runtime.ts line 42 so that null pointer errors are caught');
    assert.equal(r.ambiguities.length, 0, `Unexpected ambiguities: ${r.ambiguities.join(', ')}`);
  });

  it('detects missing acceptance criteria', () => {
    const r = interviewTask('refactor the auth module');
    assert.ok(r.ambiguities.some(a => a.toLowerCase().includes('done')), 'Should ask what done looks like');
  });
});

// ── WikiStore ──

describe('WikiStore', () => {
  const ns = `test-${Date.now()}`;
  const wiki = new WikiStore(ns);

  it('set and get a value', () => {
    wiki.set('key1', { data: 'hello' });
    const val = wiki.get('key1');
    assert.deepEqual(val, { data: 'hello' });
  });

  it('returns null for missing key', () => {
    assert.equal(wiki.get('nonexistent'), null);
  });

  it('lists keys', () => {
    wiki.set('key2', 'world');
    const keys = wiki.listKeys();
    assert.ok(keys.length >= 2, `Expected >= 2 keys, got ${keys.length}`);
    assert.ok(keys.some(k => k.startsWith('key1')));
    assert.ok(keys.some(k => k.startsWith('key2')));
  });

  it('searches by query', () => {
    const results = wiki.search('hello');
    assert.ok(results.length >= 1);
  });

  it('search returns empty for no match', () => {
    const results = wiki.search('zzzznonexistent');
    assert.equal(results.length, 0);
  });

  it('cleanup removes namespace', () => {
    wiki.cleanup();
    assert.equal(wiki.listKeys().length, 0);
  });
});

// ── Triage + Decomposer integration ──

describe('triage-decomposer integration', () => {
  it('PASS-triaged task produces single-task plan', async () => {
    const { buildTeamExecutionPlan } = await import('../team/task-decomposer.js');
    const plan = buildTeamExecutionPlan('fix typo in README', 3, 'executor', false);
    assert.equal(plan.tasks.length, 1);
    assert.equal(plan.workerCount, 1);
  });
});

import { autoCheckpoint } from '../team/checkpoint.js';
import { resolveModelRouteFlags } from '../config/model-contract.js';

// ── Auto-checkpoint ──

describe('autoCheckpoint', () => {
  it('skips unless explicitly enabled', async () => {
    const r = await autoCheckpoint('/tmp', 'exec', 'verify', 'test-team');
    assert.equal(r.skipped, true);
    assert.ok(r.reason.includes('disabled'));
  });
});

// ── Cross-model routing ──

describe('resolveModelRouteFlags', () => {
  it('returns empty array for fast route', () => {
    assert.deepEqual(resolveModelRouteFlags('fast'), []);
  });

  it('returns empty array for standard route', () => {
    assert.deepEqual(resolveModelRouteFlags('standard'), []);
  });

  it('returns empty array for reasoning route (unverified)', () => {
    assert.deepEqual(resolveModelRouteFlags('reasoning'), []);
  });
});
