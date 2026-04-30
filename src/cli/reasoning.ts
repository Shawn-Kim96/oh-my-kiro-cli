import { Command } from 'commander';
import { resolveModelConfig, writeStoredModelConfig } from '../config/models.js';
import { printJson } from '../utils/json.js';

const VALID_EFFORTS = new Set(['low', 'medium', 'high']);

export function reasoningCommand(): Command {
  return new Command('reasoning')
    .description('Show or set default reasoning effort metadata for kch')
    .argument('[effort]', 'low, medium, or high')
    .option('--json', 'Print JSON')
    .action((effort: string | undefined, opts: { json?: boolean }) => {
      if (effort) {
        const normalized = effort.trim().toLowerCase();
        if (!VALID_EFFORTS.has(normalized)) {
          throw new Error(`Invalid reasoning effort: ${effort}. Expected low, medium, or high.`);
        }
        writeStoredModelConfig({ reasoning_effort: normalized });
      }
      const config = resolveModelConfig();
      if (opts.json) {
        printJson(config);
        return;
      }
      console.log(`reasoning: ${config.reasoningEffort ?? 'kiro default'}`);
      console.log(`default model: ${config.defaultModel ?? 'kiro default'}`);
      console.log(`worker model: ${config.workerModel ?? config.defaultModel ?? 'kiro default'}`);
    });
}
