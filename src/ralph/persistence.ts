import { join } from 'path';
import { mkdir, readdir, rm } from 'fs/promises';
import { readJson, writeJson } from '../utils/safe-json.js';
import type { RalphState, RalphEvidence } from './contract.js';
import { ktStateDir } from '../utils/paths.js';

function ralphDir(slug: string): string {
  return join(ktStateDir(), 'ralph', slug);
}

function statePath(slug: string): string {
  return join(ralphDir(slug), 'state.json');
}

export async function initRalphState(slug: string, state: RalphState): Promise<void> {
  await mkdir(ralphDir(slug), { recursive: true });
  await writeJson(statePath(slug), state);
}

export async function readRalphState(slug: string): Promise<RalphState | null> {
  return readJson<RalphState>(statePath(slug));
}

export async function saveRalphState(slug: string, state: RalphState): Promise<void> {
  await writeJson(statePath(slug), state);
}

export async function appendRalphEvidence(slug: string, evidence: RalphEvidence): Promise<void> {
  const state = await readRalphState(slug);
  if (!state) return;
  state.evidence.push(evidence);
  await saveRalphState(slug, state);
}

export async function listRalphSessions(): Promise<string[]> {
  const dir = join(ktStateDir(), 'ralph');
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

export async function cleanupRalphState(slug: string): Promise<void> {
  try {
    await rm(ralphDir(slug), { recursive: true, force: true });
  } catch { /* ignore */ }
}
