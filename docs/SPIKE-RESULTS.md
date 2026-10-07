# Spike results

Each entry records the date, the tool and version, what was tried, and what was observed. The checklist is in docs/RESEARCH.md under "Updated spike checklist".

## 2026-10-07 — Copilot CLI on Windows (PowerShell), plugin installed from the marketplace

Sandbox: a Node project with `math.mjs`, `math.test.mjs`, `npm test` = `node --test`, and `.prove-it.json` set to `enforce`.

Observed from the ledger in `%TEMP%\prove-it\sessions\*.jsonl`:

1. **Plugin hooks run on Windows** (checklist item 1). The `powershell` hook command found `scripts/prove-it.mjs`, and `userPromptSubmitted`, `postToolUse` and `agentStop` all wrote ledger entries. Which of `PLUGIN_ROOT` / `COPILOT_PLUGIN_ROOT` / `CLAUDE_PLUGIN_ROOT` was set is not yet known.
2. **The data dir falls back to the OS temp dir.** None of the plugin-data variables was set for hook commands, so the ledger went to `%TEMP%\prove-it`.
3. **Tool names seen:** `glob`, `view`, `powershell`, `skill`, `task`, `task_complete`, `fetch_copilot_cli_documentation`. No `edit` or `create` calls happened; **Copilot wrote files through `powershell`** using `[System.IO.File]::WriteAllText(...)`. Detecting shell writes is a primary path on Windows, not an edge case.
4. **Exit code is available** for shell commands: `npm test` was recorded as `verify` with `exit: 0` (checklist item 2, success case).
5. **`agentStop` blocked** once after files were written with no later check (a `block` entry follows the edit).
6. Bug found: `npm pkg set 'scripts.test=node --test'` was counted as a verification because the pattern matched text inside quotes. Fixed: quoted strings are ignored when classifying.
7. Bug found: the `WriteAllText` edit was caught only because `=>` in the file content looked like a redirect. Fixed: .NET file APIs and more PowerShell cmdlets are now detected, and quoted content is ignored.
8. Open: several `prompt` entries follow the block with no tool calls in between. Check whether a block's `reason` is delivered as a new user prompt (which would reset the turn in the ledger) or whether these were typed by the user.

Still to run: prompts 2 to 6 (unverified edit, happy path, failing test, docs-only, warn mode).
