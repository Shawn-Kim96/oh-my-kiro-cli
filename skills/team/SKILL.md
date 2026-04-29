---
name: team
description: Run durable tmux-backed kiro-cli workers through kch team
---

# team

Use `kch team` for durable multi-step work that should run in independent kiro-cli sessions.

```bash
kch team 3:executor "Implement the feature with tests"
```

Workers must use `kch api` and file IPC. Do not use Kiro `use_subagent` for durable team orchestration.
