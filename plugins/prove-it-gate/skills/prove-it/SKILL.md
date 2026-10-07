---
name: prove-it
description: Use whenever you edit code and are about to say a task is done, fixed, or passing. Explains how to verify changes with the narrowest real command and how to write the prove-it receipt.
---

# Prove it before you say it

The prove-it hook records every edit and every verification command you run. If you edited files and no test, lint, typecheck or build ran after your last edit, it may stop you from finishing.

## Workflow

1. For a bug, reproduce it first when a reproduction is cheap (a failing test or a command that shows the bug).
2. Make the change.
3. Run the narrowest command that exercises the change (one test file before the whole suite), then the project's standard check if it is fast.
4. If a check fails, fix it or say plainly that it is unresolved. Never describe a failing change as done.
5. If no verification is possible (no tests, needs credentials, needs a device), say exactly why.

## Receipt

End your final message with:

```
Verified:
- <command> -> exit <code>
NOT verified:
- <what the commands above do not cover>
```

Claim only what the commands show. "Tests pass" requires a test command in this turn that exited 0.
