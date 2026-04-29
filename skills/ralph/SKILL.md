---
name: ralph
description: Run the persistent execute-verify-fix lifecycle through kch ralph
---

# ralph

Use `kch ralph` when a task needs a persistent completion loop with verification evidence.

```bash
kch ralph "Finish the runtime kernel and verify build/tests"
```

Ralph may inspect linked team state, but durable workers still run through tmux and `kch team`.
