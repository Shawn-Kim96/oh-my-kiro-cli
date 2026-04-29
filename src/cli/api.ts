import { Command } from 'commander';
import { handleApiOperation } from '../team/api-interop.js';

export const apiCommand = new Command('api')
  .description('Worker interop API')
  .argument('<operation>', 'API operation to perform')
  .option('--input <json>', 'JSON input for the operation', '{}')
  .option('--json', 'Output as JSON')
  .action(async (operation: string, opts: { input: string; json?: boolean }) => {
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(opts.input) as Record<string, unknown>;
    } catch {
      const out = { ok: false, operation, timestamp: new Date().toISOString(), error: 'Invalid JSON input' };
      console.log(JSON.stringify(out, null, 2));
      process.exitCode = 1;
      return;
    }

    const result = await handleApiOperation(operation, input);
    const out = {
      ok: result.ok,
      operation,
      timestamp: new Date().toISOString(),
      ...(result.data !== undefined ? { data: result.data } : {}),
      ...(result.error !== undefined ? { error: result.error } : {}),
    };

    console.log(JSON.stringify(out, null, 2));
    if (!result.ok) process.exitCode = 1;
  });
