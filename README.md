# Prove It

A verification gate for coding agents in **GitHub Copilot CLI** and **VS Code agent mode**.

Coding agents often end a turn with "fixed, tests pass" without running anything after their last edit. A "please verify" instruction is only advice, and agents skip it when the context gets long. prove-it is a hook, so the agent can't skip it. If the agent edited code and no test, lint, typecheck or build ran after the last edit, the agent is told to verify before it finishes. Every gated turn leaves a receipt that lists the commands that ran, their exit codes, and what was not verified.

> Status: **0.1.0, pre-release.** The core logic is unit-tested. Behaviour inside the real CLI and VS Code still needs the Phase 1 spike in [docs/RESEARCH.md](docs/RESEARCH.md).

## What it proves, and what it doesn't
It proves that verification commands ran after the last edit, and shows how they exited. It does **not** prove the change is correct or that the tests are adequate.

## Install (Copilot CLI)
```
copilot plugin marketplace add gvvskvarma/prove-it-gate
copilot plugin install prove-it-gate@prove-it-gate
```

## Modes
Default is `warn`: it never blocks and only records a receipt. Opt in to blocking per repo with `.prove-it.json`:
```json
{
  "mode": "enforce",
  "verifyCommands": ["npm test"],
  "verifyPatterns": ["\\bmake check\\b"],
  "ignorePaths": ["**/*.md", "docs/**"],
  "maxBlocksPerTurn": 1,
  "blockOnFailedVerification": true
}
```
The `PROVE_IT_MODE=off|warn|enforce` environment variable overrides the file.

Every block costs an extra agent turn, which uses premium requests. prove-it blocks at most `maxBlocksPerTurn` times per turn and never loops.

## How it works
- `userPromptSubmitted` marks the start of a turn.
- `postToolUse` / `postToolUseFailure` add one line per tool call to a local JSONL ledger, tagged edit, verify or other.
- `agentStop` reads the current turn. If there was an edit with no verification after it, it blocks once with a specific command to run (detected from `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, Maven, Gradle or .NET).

All state is local, in the plugin data directory. Nothing goes over the network, and the plugin has no runtime dependencies. If anything goes wrong, the hook fails open and lets the agent finish.

## Development
```
npm test           # node:test, zero deps
npm run validate   # manifest checks
```
Plan: [docs/PLAN.md](docs/PLAN.md). Research review and plan changes: [docs/RESEARCH.md](docs/RESEARCH.md).

## License
MIT
