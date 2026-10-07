# Research review of the plan (2026-10-07)

This file updates `docs/PLAN.md`. Facts are taken from the doc sources in `github/docs` and `microsoft/vscode-docs` (fetched raw from GitHub on 2026-10-07). Each item says which plan section it changes.

## Facts that resolve plan unknowns

1. **Real Copilot CLI tool names** (closes §13 "real toolName values"). Hooks reference maps runtime names to Claude names: `bash`/`powershell` -> Bash, `view` -> Read, `create` -> Write, `edit`/`str_replace_editor`/`apply_patch` -> Edit, `task` -> Agent. These names are now in `scripts/core/classify.mjs`.
2. **Failed tools do not reach `postToolUse`.** `postToolUse` fires on success; failures fire `postToolUseFailure`. The plan only registered `postToolUse`, so a failing `npm test` would have been invisible and the gate would block with "no verification ran". Both are now registered.
3. **Turn boundaries need `userPromptSubmitted`.** §3.1 says "no edit events since the last user prompt", but no prompt hook was registered, so the ledger had no turn marker. Added.
4. **Runaway guard.** The CLI ends a turn after 8 consecutive `block` continuations. `stop_hook_active` + `maxBlocksPerTurn` stay as the primary guard.
5. **Blocks cost money.** VS Code's Stop docs say forced continuations consume AI credits / premium requests. This belongs in the README and in benchmark metric (c).
6. **Plugin root variable.** VS Code expands `${PLUGIN_ROOT}` (OpenPlugin format) and `${CLAUDE_PLUGIN_ROOT}` (Claude format) in hook commands and exports them as env vars. Copilot CLI documents `${PLUGIN_ROOT}` / `${COPILOT_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_ROOT}` for MCP servers, agents and LSP config, and says a plugin hook "can read the directory it was loaded from". Whether the CLI sets `PLUGIN_ROOT` for hook commands is still unconfirmed, so `hooks.json` uses a shell fallback chain. **Spike item #1.**
7. **Plugin data dir.** `PLUGIN_DATA` with aliases `COPILOT_PLUGIN_DATA` and `CLAUDE_PLUGIN_DATA`. The ledger checks all three, then falls back to the OS temp dir.
8. **Manifest formats.** Copilot CLI supports a legacy `plugin.json` (with `hooks`/`skills` path fields) and Agent Plugins 1.0 (`$schema` set, hooks under `com.github.copilot/hooks/hooks.json`). Hooks are not portable in Agent Plugins 1.0, so v0.1 uses the legacy format. Revisit once VS Code and the CLI both read the 1.0 hook location.

## Changes to scope

### A. VS Code agent mode belongs in v1, not v2 (plan §5, §14)
The user problem is "Copilot CLI **or VS Code chat**". VS Code now has Local agent hooks (Preview) with `Stop`, `PostToolUse`, `UserPromptSubmit`, `SessionStart`, `PreCompact`, and `SubagentStop`. Its Stop hook takes `decision: "block"` + `reason` and reports `stop_hook_active`. VS Code agent plugins can ship hooks, and VS Code reads Copilot-format hook files (numeric `version`, camelCase events) but **sends its own snake_case payloads**.

Differences that the adapter has to handle (already in code):
- Payload casing: CLI camelCase vs VS Code snake_case. `normalize.mjs` accepts both.
- Stop output: CLI and Claude Code read top-level `decision`/`reason`. VS Code reads `hookSpecificOutput.decision`/`reason`. The script prints one object that carries both forms.
- Surfacing the receipt on the allow path: VS Code has `systemMessage` ("warning shown to the user"). This answers plan §3.3 for VS Code. For the CLI it is still unknown (spike item #3).
- VS Code edit tool names differ (`replace_string_in_file`, `create_file`, `apply_patch`, `run_in_terminal`, ...). Confirm them with a logging hook in the spike.

This turns the product into one plugin for Copilot CLI, VS Code agent mode, and probably Claude Code too, since both read Claude-format plugins. That makes a much stronger pitch to companies.

### B. Enterprise distribution is the selling point
Since the user story is "companies using Copilot", add a Phase 6b:
- Copilot CLI: org-managed policy can pin plugins.
- VS Code: managed settings can force-enable `enabledPlugins["prove-it@prove-it"]`, and `allowManagedHooksOnly` restricts hooks to managed plugins.
- Cloud agent: reads `.github/hooks/*.json` from the repo, and `agentStop` fires there. A repo-level variant (`bash`/`command` only, no `powershell`/`exec`) can enforce the gate for every cloud-agent PR. This is cheap to add and is the strongest enforcement point. Move it from v2 to v1.1.
- Ship a `docs/ENTERPRISE.md` that walks through rolling it out in `warn` mode, checking the receipts, and then switching to `enforce`.

### C. Prior art is closer than the plan assumed (plan §2.4, Phase 0)
- `vnmoorthy/groundtruth`: a Claude Code Stop hook that **detects completion claims** in the assistant's reply ("Done", "fixed", ...) and blocks when the turn has no evidence. Its claim regex was tuned on 1,272 turns.
- A dev.to post, "The hook that won't let the agent say done", describes the same Stop-hook pattern.
- Differentiation: Copilot CLI + VS Code (groundtruth is Claude Code only), edit-aware rather than claim-aware, ecosystem-specific suggestions, a receipt file, and an enterprise rollout path. Read groundtruth's exclusion patterns before writing ours. **Consider claim-awareness as a second signal**: block only when there were edits **and** (no verification **or** an unverified claim of success). This cuts false blocks. The transcript format is not a stable API in VS Code, so make claim detection optional.

## Design improvements

1. **Failed verification policy.** The plan contradicts itself: §3.4 says to block with "fix or explain", while §3 Phase 3 says to allow. v0.1 blocks once (`blockOnFailedVerification: true`), then allows. Claiming "done" on red tests is the worst version of the problem.
2. **Shell-edit detection.** Regex write-detection is in v0.1. Add a git snapshot (`git status --porcelain` + `git diff --stat` hash at prompt time, compared at stop time) in v0.2. It is cheap and catches `python script.py` that rewrites files.
3. **Exit code extraction.** The CLI's `textResultForLlm` format for shell exit codes is unconfirmed. v0.1 parses `exit code N`, falls back to "failure event => 1", and otherwise uses `unknown` (counts as ran). Spike item #2.
4. **Optional `postToolUse` nudge.** The CLI's `postToolUse` can return `additionalContext`, which the model sees right after the tool output. A single nudge on the first edit of a turn ("remember to verify; prove-it is active") is cheaper than a Stop block because it needs no extra turn. Benchmark it as a third arm: OFF / nudge / enforce.
5. **Hook overhead.** `postToolUse` spawns Node on every tool call (~40 ms). Measure it. If it hurts, move the matcher into the hook config (VS Code ignores matchers in Claude format; the CLI supports `matcher` on some events).
6. **Layout fix.** The plan's top-level `core/` would not be installed. `copilot plugin install` copies only the plugin directory. Core now lives under `plugins/prove-it/scripts/core/`.
7. **Name.** "prove-it" is used here; check for collisions in awesome-copilot and VS Code marketplace before publishing.

## Updated spike checklist (Phase 1)
1. Does Copilot CLI set `PLUGIN_ROOT` (or an alias) for plugin **hook** commands? If not, what is the hook cwd?
2. The exact `textResultForLlm` for a shell command that exits non-zero. Does it fire `postToolUse` or `postToolUseFailure`?
3. Does the CLI show `systemMessage` (or anything) from an `agentStop` allow?
4. Does an object with both top-level `decision` and `hookSpecificOutput` parse correctly in CLI, VS Code and Claude Code?
5. VS Code Local tool names for edit and terminal tools (use the logging hook from the VS Code docs).
6. `copilot plugin install ./plugins/prove-it` and VS Code `/plugin install` from this repo both work.
7. Same `sessionId` for subagent tool calls?

## Sources
- Copilot CLI hooks reference: https://github.com/github/docs/blob/main/content/copilot/reference/hooks-reference.md
- Copilot CLI plugin reference: https://github.com/github/docs/blob/main/content/copilot/reference/copilot-cli-reference/cli-plugin-reference.md
- Creating a CLI plugin: https://github.com/github/docs/blob/main/content/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating.md
- VS Code agent hooks: https://github.com/microsoft/vscode-docs/blob/main/docs/agent-customization/hooks.md
- VS Code hooks reference: https://github.com/microsoft/vscode-docs/blob/main/docs/agents/reference/hooks-reference.md
- VS Code agent plugins: https://github.com/microsoft/vscode-docs/blob/main/docs/agent-customization/agent-plugins.md
- groundtruth: https://github.com/vnmoorthy/groundtruth
