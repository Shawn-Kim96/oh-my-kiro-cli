import { Command } from 'commander';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { resolveKiroCliCommand } from '../utils/kiro-cli.js';
import { runCommand } from '../utils/platform-command.js';
import { printJson } from '../utils/json.js';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = join(dirname(__filename), '..', '..');

function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export function versionCommand(): Command {
  return new Command('version')
    .description('Show kch and Kiro CLI version information')
    .option('--json', 'Print JSON')
    .action((opts: { json?: boolean }) => {
      const kiroCommand = resolveKiroCliCommand();
      const kiro = runCommand(kiroCommand, ['--version']);
      const info = {
        kch: packageVersion(),
        kiro_cli: kiro.ok ? kiro.stdout : null,
        kiro_cli_command: kiroCommand,
      };
      if (opts.json) printJson(info);
      else {
        console.log(`kch ${info.kch}`);
        console.log(`kiro-cli ${info.kiro_cli ?? 'not found'} (${kiroCommand})`);
      }
    });
}
