import { runCommand } from '../utils/platform-command.js';
import { ktStateDir } from '../utils/paths.js';

export async function runDoctor(): Promise<number> {
  let allOk = true;

  // Check tmux
  const tmux = runCommand('tmux', ['-V']);
  if (tmux.ok) {
    console.log(`  ✓ tmux: ${tmux.stdout}`);
  } else {
    console.log('  ✗ tmux: not found');
    allOk = false;
  }

  // Check kiro-cli
  const kiro = runCommand('kiro-cli', ['--version']);
  if (kiro.ok) {
    console.log(`  ✓ kiro-cli: ${kiro.stdout}`);
  } else {
    console.log('  ✗ kiro-cli: not found');
    allOk = false;
  }

  const kch = runCommand('which', ['kch']);
  if (kch.ok) {
    console.log(`  ✓ kch: ${kch.stdout}`);
  } else {
    console.log('  ○ kch: not in PATH (optional — run via node bin/kch.js)');
  }

  for (const alias of ['kh', 'kt']) {
    const result = runCommand('which', [alias]);
    if (result.ok) {
      console.log(`  ✓ ${alias}: ${result.stdout} (compatibility alias)`);
    } else {
      console.log(`  ○ ${alias}: not in PATH (optional compatibility alias)`);
    }
  }

  console.log(`  ✓ state root: ${ktStateDir()}`);

  // Check if inside tmux
  const inTmux = !!process.env['TMUX'];
  console.log(`  ${inTmux ? '✓' : '○'} tmux session: ${inTmux ? 'yes' : 'no'}`);

  return allOk ? 0 : 1;
}
