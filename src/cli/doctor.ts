import { runCommand } from '../utils/platform-command.js';

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

  // Check kh in PATH
  const kh = runCommand('which', ['kh']);
  if (kh.ok) {
    console.log(`  ✓ kh: ${kh.stdout}`);
  } else {
    console.log('  ○ kh: not in PATH (optional — run via node bin/kh.js)');
  }

  // Check if inside tmux
  const inTmux = !!process.env['TMUX'];
  console.log(`  ${inTmux ? '✓' : '○'} tmux session: ${inTmux ? 'yes' : 'no'}`);

  return allOk ? 0 : 1;
}
