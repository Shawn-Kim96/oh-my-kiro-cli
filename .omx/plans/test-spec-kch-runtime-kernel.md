# Test Spec: kch Runtime Kernel

Created: 2026-04-29
Source plan: `.omx/plans/oh-my-kiro-cli-omx-parity-plan.md`

## Required Verification Gates

1. Install/build/test:
   - `npm ci`
   - `npm run build`
   - `npm test`
   - `npm pack --dry-run`

2. Identity:
   - `node bin/kch.js --help`
   - `node bin/kh.js --help`
   - `node bin/kt.js --help`
   - Package contract test verifies `kch`, `kh`, and `kt` bin entries.

3. State root:
   - Default root resolves to `~/.kch`.
   - `KCH_STATE_ROOT` overrides all.
   - `KT_STATE_ROOT` and `KH_STATE_ROOT` remain fallback aliases.

4. Worker protocol:
   - Claim with expected version returns claim token.
   - Missing token transition fails.
   - Wrong token transition fails.
   - Correct token transition succeeds.
   - Generated worker bootstrap mentions expected version and claim token.

5. Phase and quality:
   - Successful task state can reconcile to terminal phase.
   - Bad/empty worker result cannot silently complete.
   - Phase/quality events are persisted or observable through state APIs.

6. Git safety:
   - Default checkpoint path does not commit.
   - `--checkpoint` or equivalent explicit option is required for commits.
   - Default worktree flow does not merge/cherry-pick.
   - Worker bootstrap does not instruct unconditional `git add -A && git commit`.

## Minimum Fresh Evidence Before Ralph Completion

```bash
npm ci
npm run build
npm test
npm pack --dry-run
node bin/kch.js --help
node bin/kh.js --help
node bin/kt.js --help
git status --porcelain
```
