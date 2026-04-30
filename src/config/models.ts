import { existsSync } from 'fs';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { kchConfigPath } from '../utils/paths.js';

export interface ModelConfig {
  defaultModel: string | null;
  workerModel: string | null;
  reasoningEffort: 'low' | 'medium' | 'high' | null;
}

const VALID_EFFORTS = new Set(['low', 'medium', 'high']);

interface StoredKchConfig {
  default_model?: string;
  worker_model?: string;
  reasoning_effort?: string;
}

function readStoredConfig(): StoredKchConfig {
  const path = kchConfigPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as StoredKchConfig;
  } catch {
    return {};
  }
}

export function writeStoredModelConfig(patch: StoredKchConfig): StoredKchConfig {
  const path = kchConfigPath();
  const merged = { ...readStoredConfig(), ...patch };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

export function resolveModelConfig(): ModelConfig {
  const stored = readStoredConfig();
  const effort = process.env['KCH_REASONING_EFFORT'] ?? process.env['KT_REASONING_EFFORT'] ?? stored.reasoning_effort ?? null;
  return {
    defaultModel: process.env['KCH_DEFAULT_MODEL'] ?? process.env['KT_DEFAULT_MODEL'] ?? stored.default_model ?? null,
    workerModel: process.env['KCH_WORKER_MODEL'] ?? process.env['KT_WORKER_MODEL'] ?? stored.worker_model ?? null,
    reasoningEffort: effort && VALID_EFFORTS.has(effort) ? effort as ModelConfig['reasoningEffort'] : null,
  };
}

export function resolveWorkerModelFlags(role: string, config: ModelConfig): string[] {
  const model = config.workerModel ?? config.defaultModel;
  if (!model) return [];
  return ['--model', model];
}
