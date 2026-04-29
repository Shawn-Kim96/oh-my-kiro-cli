export interface ModelConfig {
  defaultModel: string | null;
  workerModel: string | null;
  reasoningEffort: 'low' | 'medium' | 'high' | null;
}

const VALID_EFFORTS = new Set(['low', 'medium', 'high']);

export function resolveModelConfig(): ModelConfig {
  const effort = process.env['KT_REASONING_EFFORT'] ?? null;
  return {
    defaultModel: process.env['KT_DEFAULT_MODEL'] ?? null,
    workerModel: process.env['KT_WORKER_MODEL'] ?? null,
    reasoningEffort: effort && VALID_EFFORTS.has(effort) ? effort as ModelConfig['reasoningEffort'] : null,
  };
}

export function resolveWorkerModelFlags(role: string, config: ModelConfig): string[] {
  const model = config.workerModel ?? config.defaultModel;
  if (!model) return [];
  return ['--model', model];
}
