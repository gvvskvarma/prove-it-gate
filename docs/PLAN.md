# "Prove It" — Copilot CLI Verification-Gate Plugin: A-to-Z Plan

Status: v0.1 scaffold implemented (2026-10-07). Created 2026-10-05. docs/RESEARCH.md amends this plan; where they differ, RESEARCH.md wins.
Audience: any session (human or agent) picking this up cold. Read top to bottom once, then use the checklists.

## HANDOFF: how to use this file with ANY AI tool or session

This file is tool-neutral. It can be given to GitHub Copilot CLI, Claude Code, Cursor, Codex, Gemini CLI, a chat UI, or a human.

Paste this preamble first:

> You are continuing a project from the attached plan (`prove-it-plugin-plan.md`). Read it fully. Do not assume anything tagged [ASSUMED] or [UNKNOWN]; verify it first. Work on ONE phase at a time, starting at the first unchecked box in section 6. Do all work in the public repo `gvvskvarma/prove-it-gate`. After each phase, update the checkboxes and write results to `docs/SPIKE-RESULTS.md` (dated, with tool and version used). Report what you verified versus what you inferred. Stop at every STOP/DECIDE point and ask the human.

Rules for any tool picking this up:
- Re-fetch the sources in section 12 before trusting any platform fact; docs change often. Facts are dated 2026-10-05.
- The plan's confidence tags are the contract. Replace a tag only with an observed result, and record the observation.
- State is the checkbox list in section 6 plus `docs/SPIKE-RESULTS.md`. Update both, so the next tool or session can resume without chat history.
- Keep one writer at a time. If two tools work in parallel, give each a different phase, and never the same file.
- Tool-specific instruction files (`AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`) in the new repo should point to this plan rather than duplicate it. Copilot CLI reads all three [DOCS: CLI help output].

Legend for confidence tags used throughout:
- **[DOCS]**  stated in official GitHub docs fetched on 2026-10-05
- **[WEB]**   from a web-search summary or third-party page, NOT confirmed in official docs
- **[ASSUMED]** my inference; must be verified in Phase 1 before relying on it
- **[UNKNOWN]** not researched yet

---------------------------------------------------------------------
## 0. Ground rules (read first)

1. **Personal, universal project.** This is a personal open-source project for any team using Copilot, built on a personal machine. It lives in its own public repo, `gvvskvarma/prove-it-gate`. Use neutral sandbox projects for demos and benchmarks.
2. **No secrets, no telemetry.** The plugin must not send data anywhere. All state is local files.
3. **Honest claims only.** The plugin proves "these commands ran and exited N", not "the change is correct". Every doc/README sentence must respect that.
4. **Opt-in and low-friction.** Forced extra agent turns cost tokens and annoy users. Default must be conservative (see §6).

---------------------------------------------------------------------
## 1. Problem statement and goal

Problem: coding agents often finish a turn claiming "fixed/done/tests pass" without having reproduced the issue or run any check after editing. A skill/instruction that says "please verify" is advisory and is skipped under context pressure.

Goal: an **enforced** gate. If the agent edited files during a turn and no verification command ran after the last edit, the agent is blocked from finishing and told to verify. When it does finish, it emits a **receipt** (commands run, exit codes, what was NOT verified).

Non-goals (v1):
- Judging whether tests are adequate.
- Hallucinated-API detection and diff-scope checking (v2 ideas, see §14).
- Cloud-agent support (see §5 caveats).

---------------------------------------------------------------------
## 2. What the platform supports (research findings)

### 2.1 Hooks [DOCS: docs.github.com/en/copilot/reference/hooks-configuration]
- Hook config JSON: `{ "version": 1, "hooks": { "<event>": [ {...} ] } }`.
- Hook entry types: `command`, `http`, `prompt` (prompt only on `sessionStart`).
- Command hook fields: `bash`, `powershell`, `command` (cross-platform fallback), `cwd`, `env`, `timeoutSec` (default 30), and CLI-only `exec` + `args` (runs an executable directly, no shell; do not combine `exec` with `bash`/`powershell`/`command`).
- Load order (CLI): policy -> user -> project (`.github/hooks/*.json`, `.github/copilot/settings.json`) -> **plugins** (their own `hooks.json` or `hooks/hooks.json`). All entries from all sources run.
- Events: `agentStop`, `errorOccurred`, `notification`, `permissionRequest`, `postToolUse`, `postToolUseFailure`, `preCompact`, `preToolUse`, `sessionEnd`, `sessionStart`, `subagentStart`, `subagentStop`, `userPromptSubmitted`, `userPromptTransformed`.
- **`agentStop`**: fires when the main agent finishes a turn. Output `{"decision":"block","reason":"<prompt for next turn>"}` forces another turn; `"allow"` lets it end. Payload (camelCase): `sessionId, timestamp, cwd, transcriptPath, stopReason, stop_hook_active`. `stop_hook_active` is true when this turn was already forced to continue by a prior block from this hook — **this is the loop guard**.
- **`postToolUse`** payload: `sessionId, timestamp, cwd, toolName, toolArgs, toolResult{resultType, textResultForLlm}`. `postToolUseFailure` has `error`.
- **`preToolUse`** can return `permissionDecision` allow/deny/ask, `permissionDecisionReason`, `modifiedArgs`. Command `preToolUse` hooks fail closed on crash/non-zero exit; **command-hook timeouts are always fail-open**; HTTP preToolUse hooks fail open.
- Exactly one final JSON object may be printed to stdout; progress lines `{"type":"progress","message":"..."}` (one per line) are stripped before parsing. Two non-progress JSON objects = invalid = ignored.
- Sandbox: when session sandbox is on, plugin hooks run inside it; a plugin hook can write to `$COPILOT_PLUGIN_DATA` and read its own install dir.
- Policy hooks (admin, machine-wide) cannot be disabled by users. The plugin must never try to override them.
- Two payload formats: camelCase event names -> camelCase fields; PascalCase event names (`Stop`, `PostToolUse`) -> VS Code-compatible snake_case fields. Pick one and use it consistently (this plan uses camelCase).
- **Correction to a web summary:** one search summary claimed a non-zero exit code blocks `agentStop`. The official docs describe blocking via the JSON `decision` field. Use the JSON field. [WEB claim rejected]

### 2.2 Plugins and marketplaces [DOCS: docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-marketplace and .../cli-plugin-reference]
- A plugin is a directory with `plugin.json` (only strictly required file) plus optional `agents/`, `skills/`, `hooks.json`, `.mcp.json`, `lsp.json`. [WEB for exact layout; confirm against plugin-creating doc in Phase 1]
- A marketplace is any repo with `.github/plugin/marketplace.json` (also accepted: `.claude-plugin/marketplace.json`). Fields shown in docs: `name`, `owner{name,email}`, `metadata{description,version}`, `plugins[{name,description,version,source}]`. `source` is a repo-relative path like `./plugins/foo`.
- User install flows: `copilot plugin marketplace add OWNER/REPO`, then `copilot plugin install NAME@MARKETPLACE`; or direct `copilot plugin install OWNER/REPO` / `OWNER/REPO:PATH` / git URL / local path. `copilot plugin list|update|enable|disable|uninstall`.
- Orgs can pin plugins via managed policy; those can't be toggled locally.
- Docs mention `copilot plugin validate`? **[WEB only]** — the CLI reference page I fetched was truncated before any validate subcommand. Check `copilot plugin --help` in Phase 1.

### 2.3 awesome-copilot [DOCS: raw CONTRIBUTING.md, 2026-10-05]
- Accepts instructions, agents, skills, canvas extensions, plugins, hooks, agentic workflows.
- Plugins: scaffold with `npm run plugin:create`, validate with `npm run plugin:validate`. Source files live in top-level dirs and are materialized into plugins by CI. Instructions are NOT part of plugins.
- Skills: `npm run skill:create -- --name <n> --description "<d>"`, `npm run skill:validate`, `npm run build`.
- **External plugins** (hosted in your own repo): do NOT PR `plugins/external.json`. Use the issue form. Needs: name, description, `owner/repo`, optional path, release **tag** ref, full 40-char **commit SHA**, version (semver), license, author, keywords (lowercase-hyphenated), notes. Public GitHub repos only (v1). Automation runs `vally lint` + a Copilot CLI install smoke test, then a maintainer replies `/approve` or `/reject`. Comment `/rerun-intake` to retry. Approved entries are re-reviewed every 6 months.
- **Explicit rejection criterion:** submissions that "duplicate existing model strengths without meaningful uplift". Our pitch must be "enforcement + receipt the model cannot skip", backed by data (§11).
- Content policy: no security-weakening, no circumventing platform policies.
- Paid-services guidance exists (discussion #968) — not relevant if plugin is free.

### 2.4 Prior art (check before building) [WEB, unverified — open each repo]
- `torosent/ralph-loop` — Copilot CLI plugin using `agentStop` to keep looping until done.
- `bertclaws/copilot-hooks` — curated hook collection.
- awesome-copilot catalog — a search summary found no dedicated verification/definition-of-done plugin, but this was not an exhaustive search.
- Action: Phase 0 task is to read these and write a 5-line differentiation statement. If one already does >80% of this, contribute there instead of building.

---------------------------------------------------------------------
## 3. Design

### 3.1 Behavior
1. `postToolUse` hook (all tools) appends one JSON line per tool call to a per-session state file: `{ts, toolName, kind, filesTouched?, command?, exit?}`.
   - `kind = "edit"` for file-mutating tools (names to confirm in Phase 1: likely `edit`, `create`, plus shell commands that write files — see §3.4).
   - `kind = "verify"` for shell commands that match a verification pattern (test/lint/typecheck/build) AND whose result indicates success or failure.
   - `kind = "other"` otherwise.
2. `agentStop` hook reads the state file for the current session:
   - If no `edit` events since the last user prompt -> allow (read-only turn).
   - If an edit exists and a `verify` event occurred AFTER the last edit -> allow, and emit the receipt (via `reason`-less allow; receipt delivery in §3.3).
   - If an edit exists and no later verify -> `decision: block`, `reason`: concise instruction naming the detected verification command(s), or "state explicitly that no verification is possible and why".
   - If `stop_hook_active` is true -> allow (never loop). Append a note to the receipt: "verification demanded, not performed".
3. Optional `sessionStart` hook injects a 3-line reminder of the contract (`additionalContext`). [DOCS: sessionStart can inject additionalContext]
4. Optional `preCompact` hook writes the ledger summary so it survives compaction. [DOCS: notification-only; use it just to persist]

### 3.2 Verification-command detection
Ordered discovery, first hit wins per ecosystem; never guess when nothing is found:
- Node: `package.json` scripts `test`, `lint`, `typecheck`/`tsc`, `build`.
- Python: `pyproject.toml`/`pytest.ini`/`tox.ini` -> `pytest`; `ruff`/`mypy` if configured.
- Go: `go.mod` -> `go vet ./...`, `go test ./...`.
- Rust: `Cargo.toml` -> `cargo check`, `cargo test`.
- Java/.NET: `pom.xml`/`build.gradle` -> `mvn -q test`/`gradle test`; `*.sln`/`*.csproj` -> `dotnet test`.
- Override file: `.prove-it.json` in repo root (see §3.5) for custom commands/patterns.
Pattern matching on executed shell commands: regex list of known runners (`npm (run )?test`, `pytest`, `go test`, `cargo test`, `dotnet test`, `tsc`, `eslint`, `ruff`, `mypy`, `jest`, `vitest`, `mvn.*test`, etc.).
The gate treats ANY command matching these patterns (after the last edit) as verification; it does not require the exact detected command. The detected command is only used to make the block message specific.

### 3.3 Receipt
- Written to `$COPILOT_PLUGIN_DATA/<sessionId>/receipt.md` (fallback: OS temp dir) and, on the allow path, surfaced to the agent. [ASSUMED: how an allow-path message reaches the user is unclear — `agentStop` allow output only documents `decision`/`reason`. Phase 1 must test whether a progress line or `reason` on allow is displayed.]
- Fallback if no surfacing channel exists: the block-path `reason` instructs the agent to END its final message with a receipt block it composes from the ledger (the hook supplies the ledger text in the reason). Design for this fallback by default.
- Receipt format (plain text, no tables):
  - Files edited (count + list, truncated)
  - Verification run: command, exit status, timestamp
  - NOT verified: anything edited with no corresponding verification, or "no test covering these files detected"
  - Gate result: passed / demanded-and-skipped / not-applicable

### 3.4 Edge cases to handle
- Edits made through shell (`sed`, `Set-Content`, redirects) — detect via git: at `agentStop`, compare `git status --porcelain` mtime/hash snapshot taken at turn start. Simpler v1: treat shell commands matching write patterns as edits; document the gap.
- Non-git directories (some workspaces are not git repos): fall back to the tool-event ledger only.
- Verification that was run but FAILED: still counts as "verification ran" for gating purposes, but receipt must show the failure and the block reason should say "fix or explain failure".
- Hook crash: `agentStop` hook errors must fail OPEN (never trap the user). Wrap everything in try/catch and print `{"decision":"allow"}`. Note: command hook timeouts are fail-open per docs.
- Performance: hooks run on every tool call; keep scripts < 50 ms (Node startup is ~40 ms; acceptable; measure).
- Parallel/subagent sessions: key state by `sessionId`; subagent edits count toward parent only if they share sessionId [ASSUMED — test].
- Windows paths and quoting: use `exec`+`args` to avoid shell quoting problems.
- Sandbox: state must live under `$COPILOT_PLUGIN_DATA`; if unset, use `os.tmpdir()`.

### 3.5 Configuration (`.prove-it.json`, optional, repo root)
```json
{
  "enabled": true,
  "mode": "enforce",
  "verifyCommands": ["npm test", "npm run lint"],
  "verifyPatterns": ["\\bmake check\\b"],
  "ignorePaths": ["docs/**", "*.md"],
  "maxBlocksPerTurn": 1
}
```
- `mode`: `off` | `warn` (receipt only, never block) | `enforce`.
- **Default mode when no file exists: `warn`** (do no harm on install). `enforce` is opt-in. [Design decision; revisit after dogfooding.]
- Edits only to `ignorePaths` files (docs/markdown) never trigger the gate.

---------------------------------------------------------------------
## 4. Repository layout (public repo `prove-it-copilot-plugin` — name TBD)

```
prove-it-copilot-plugin/
  .github/
    plugin/marketplace.json        # makes the repo its own marketplace
    workflows/ci.yml               # tests + plugin validation + lint
    ISSUE_TEMPLATE/               # bug report, feature request
  plugins/
    prove-it/
      plugin.json
      hooks.json
      scripts/
        prove-it.mjs               # single Node entry; subcommands: post-tool, stop, session-start, pre-compact
        lib/
          detect.mjs               # project/command detection
          ledger.mjs               # per-session state IO
          patterns.mjs             # edit/verify classification
          receipt.mjs
      skills/
        prove-it/SKILL.md          # advisory layer: how to verify, how to write the receipt
  test/                            # node:test unit tests + fixtures + hook-payload fixtures
  docs/
    DESIGN.md
    DEMO.md
    assets/demo.gif
  README.md
  LICENSE                          # MIT
  CHANGELOG.md
  SECURITY.md
  CONTRIBUTING.md
  package.json                     # dev-only (test script); zero runtime deps
```
Rationale: marketplace layout `plugins/<name>` matches the documented `source: "./plugins/<name>"` example. [DOCS]
Zero runtime dependencies keeps install trivial and passes review easily.
Language choice: Node ESM (`.mjs`), requires Node >= 18. [ASSUMED: Copilot CLI users have Node; confirm. If not acceptable, fall back to PowerShell + bash pair per `hooks.json` `bash`/`powershell` fields — double the maintenance, so avoid unless needed.]

---------------------------------------------------------------------
## 5. Compatibility matrix and caveats
- **Copilot CLI** (primary target). All events available. [DOCS]
- **Copilot cloud agent**: reads only `.github/hooks/*.json` from the repo, ignores plugins, honors only `bash`/`command` (not `powershell`, not `exec`). Out of scope for v1; a repo-level hook file variant is a possible v1.1.
- **VS Code Copilot**: shares the hook format partially (PascalCase/snake_case variant). Out of scope for v1. [ASSUMED]
- **Windows/macOS/Linux**: must test all three (CI matrix).

### 5.1 Cross-tool portability (the gate idea is not Copilot-specific)

Facts from the Copilot docs [DOCS]:
- Copilot CLI also reads `.claude/settings.json` and `.claude/settings.local.json` hooks, and looks for `marketplace.json` in `.claude-plugin/` as well as `.github/plugin/`.
- Copilot accepts PascalCase event names (`Stop`, `PostToolUse`, `PreToolUse`) with snake_case payloads, "to match the VS Code Copilot extension format". The `Stop` payload includes `stop_hook_active` and `transcript_path`.

Inferences to verify [ASSUMED]:
- Claude Code's `Stop` hook uses the same shape (`decision: "block"` plus `reason`, and a `stop_hook_active` flag). The Copilot docs' shared naming strongly suggests this, but I did not fetch Claude Code docs. Check them before claiming compatibility.
- Cursor, Codex CLI, and Gemini CLI each have their own hook or rules systems with different event names, and I have not researched any of them. [UNKNOWN]

Portable design (do this from day one, it is cheap):
1. Keep all logic in a tool-agnostic core: `core/` takes a normalized event (`{sessionId, cwd, kind, tool, command, files, exit}`) and returns a decision (`allow` or `block`, plus reason).
2. Put thin adapters in `adapters/<tool>/` that translate each tool's payload to the normalized event and the decision back to that tool's output format. v1 ships the Copilot CLI adapter. A Claude Code adapter is the likely second one, after the compatibility check above.
3. Tools with no blocking hook cannot enforce. For those, ship only the advisory `SKILL.md` plus a CLI script (`prove-it check`) the user or CI can run: it reads the ledger or `git diff` and fails if edits have no verification. A CI check (a PR workflow step) is the universal enforcement point and works for every tool, including humans.
4. Be honest in the README per tool: "enforced" (blocking hook), "advisory" (skill/rules only), or "CI-only".

Updated repo layout addition:
```
core/            # normalize.mjs, decide.mjs, ledger.mjs, detect.mjs, receipt.mjs
adapters/
  copilot-cli/   # hooks.json + entry script
  claude-code/   # later, after verification
bin/prove-it     # tool-independent CLI: `prove-it check` for CI / pre-commit
```
Add to Phase 2: build `core/` first, test it with plain fixtures, then the Copilot adapter. Add to Phase 4: if time allows, repeat a smaller benchmark on a second tool to show the idea generalizes.

---------------------------------------------------------------------
## 6. Step-by-step execution plan

### Phase 0 — Prior art and go/no-go (0.5 day)
- [ ] Open `torosent/ralph-loop`, `bertclaws/copilot-hooks`, and search awesome-copilot (site: awesome-copilot.github.com) for "verify", "gate", "definition of done", "receipt", "evidence".
- [ ] Write a differentiation note (5 lines max) in `docs/DESIGN.md`.
- [ ] Re-read awesome-copilot CONTRIBUTING "What We Don't Accept" and confirm the idea is not a duplicate-of-model-strength.
- [ ] Decide GO / NO-GO / CONTRIBUTE-TO-EXISTING.
- [ ] Choose a repo name; check it's free on GitHub; check no trademark collision with "Copilot" usage (don't name it "GitHub Copilot ..."; use "for Copilot CLI" in descriptions only).

### Phase 1 — Platform spike on a throwaway project (1–2 days)
Goal: replace every [ASSUMED] tag with an observed fact. Do this in a scratch dir.
- [ ] `copilot --version`; record version used. Read `copilot plugin --help` and `copilot plugin install --help`; check for a `validate` subcommand.
- [ ] Fetch the "Creating a plugin for GitHub Copilot CLI" doc (`.../plugins-creating`) and the rest of the plugin-reference page (truncated earlier at 9000 chars) for the exact `plugin.json` schema, `hooks.json` location, and path-variable names (`${CLAUDE_PLUGIN_ROOT}`-style?). [UNKNOWN]
- [ ] Write a minimal plugin with `hooks.json` containing one `postToolUse` command hook that dumps stdin to a file. Install via `copilot plugin install ./path`. Run a trivial task. Inspect the dump.
   - Record: is payload on stdin? exact JSON? Are `toolName` values for edit/create/shell what I think? How are shell commands represented in `toolArgs`? Is exit code present in `toolResult`?
- [ ] Add an `agentStop` hook that returns `{"decision":"block","reason":"TEST"}` once, using `stop_hook_active` as guard. Confirm: does the agent get another turn? Is `reason` shown to the user? What does `stop_hook_active` look like on the second call?
- [ ] Test the allow path: can any message be shown to the user/agent on allow (progress line? additionalContext?). Decides the receipt design in §3.3.
- [ ] Test hook crash and timeout behavior for `agentStop` (expect fail-open; verify).
- [ ] Test `exec`+`args` form with `node` on Windows and one POSIX OS. Confirm env var `COPILOT_PLUGIN_DATA` is set for plugin hooks and where it points.
- [ ] Test subagent behavior: do edits by a subagent appear to the parent's `postToolUse`? Same `sessionId`?
- [ ] Test `/compact`: does state survive (it's on disk, so yes) and does `preCompact` fire?
- [ ] Write results into `docs/SPIKE-RESULTS.md` (dated, with CLI version). **Exit criterion: every [ASSUMED] in this doc is either confirmed or the design is amended.**
- [ ] STOP/DECIDE: if `agentStop` block does not reliably force a new turn, the whole premise fails -> reassess (fallback: `preToolUse` gate on `git commit` / `task_complete`-style actions only).

### Phase 2 — Core implementation (2–4 days)
- [ ] Scaffold repo (§4). `git init`, MIT LICENSE, `.gitignore`, `package.json` (no runtime deps; `"test": "node --test"`).
- [ ] `patterns.mjs`: classify tool calls -> edit / verify / other, driven by Phase 1 observed tool names. Table-driven; easy to extend.
- [ ] `ledger.mjs`: append-only JSONL per session; tolerate corruption (skip bad lines); cap file size; prune old sessions (> 14 days).
- [ ] `detect.mjs`: ecosystem detection per §3.2; returns candidate commands.
- [ ] `prove-it.mjs`: subcommand router reading stdin JSON, always exits 0, always prints exactly one JSON object on `agentStop` and nothing (or progress only) elsewhere.
- [ ] `agentStop` logic per §3.1 incl. `maxBlocksPerTurn`, `stop_hook_active`, `mode` handling, ignorePaths.
- [ ] `receipt.mjs`: plain-text receipt; deterministic output for tests.
- [ ] `SKILL.md` (advisory layer): when to reproduce first, how to pick the narrowest command, how to write the "NOT verified" section, never claim "done" without receipt. Keep < 150 lines. Frontmatter `name` must match folder name; `description` must say WHEN to trigger. [DOCS: awesome-copilot skill rules]
- [ ] `hooks.json`: `postToolUse`, `agentStop` (timeoutSec ~ 10), optional `sessionStart`, `preCompact`.
- [ ] `plugin.json`: name, description, version `0.1.0`, author, license, keywords (lowercase-hyphenated), and pointers to skills/hooks per the exact schema found in Phase 1.

### Phase 3 — Tests (1–2 days, parallel with Phase 2)
- [ ] Unit tests (`node:test`) with recorded payload fixtures from Phase 1 for: classification, ledger IO, detection per ecosystem fixture dir, gate decision table (see below), receipt formatting.
- [ ] Gate decision table tests:
  - no edits -> allow
  - edit, no verify -> block
  - edit, verify after -> allow
  - edit, verify BEFORE edit only -> block
  - edit, failing verify after -> allow + receipt shows failure
  - `stop_hook_active=true` -> allow regardless
  - docs-only edit -> allow
  - mode `warn` -> allow always; `off` -> allow, no ledger
  - corrupted ledger -> allow (fail-open)
  - missing `COPILOT_PLUGIN_DATA` -> tmp fallback works
- [ ] Integration test script: installs plugin from local path into a temp `COPILOT_HOME`, runs `copilot -p "<scripted task>"` [ASSUMED: non-interactive `-p` flag works with hooks; docs say prompt hooks don't fire in `-p` mode but other hooks should — verify], asserts the ledger.
- [ ] CI (`.github/workflows/ci.yml`): matrix ubuntu/windows/macos x Node 18/20/22; run unit tests; run the repo's plugin validation (`npm run plugin:validate` equivalent if available, or JSON schema checks on `plugin.json`/`marketplace.json`); lint.

### Phase 4 — Dogfood and measure (3–5 days elapsed)
Purpose: produce the evidence that justifies the plugin (and the awesome-copilot pitch).
- [ ] Build a benchmark of 10–20 small, neutral tasks across 2–3 languages (e.g., fix an off-by-one, add a function + test, rename a symbol, fix a failing test). Public/open-source sample repos or purpose-built fixtures only.
- [ ] Run each task N>=5 times in two arms: plugin OFF vs plugin ON (`enforce`). Same model, same prompt. (Auto mode may switch models — pin a model for the experiment.)
- [ ] Metrics: (a) % of runs where agent edited code and ended without any verification command; (b) % of runs where final claim of "tests pass" had no matching executed command; (c) extra turns and tokens per run (cost); (d) final correctness (hidden tests); (e) false-block rate (blocked when verification was unnecessary).
- [ ] Record results honestly, including no-effect and negative results. Publish raw run logs in `docs/benchmarks/`.
- [ ] Use own daily work for 1–2 weeks in `warn` mode, then `enforce`; keep a log of annoying blocks and tune patterns/defaults.
- [ ] Go/no-go for publishing: effect must be positive and cost acceptable. If the plugin doesn't measurably reduce unverified completions, say so and stop or re-scope.

### Phase 5 — Docs and demo (1–2 days)
- [ ] README: one-paragraph problem, 30-second install, GIF, how it works, what it does NOT prove, config, FAQ, uninstall, troubleshooting, benchmark summary with link to raw data.
- [ ] Install snippet (verify exact commands in Phase 1):
  - `copilot plugin marketplace add <owner>/<repo>`
  - `copilot plugin install prove-it@<marketplace-name>`
- [ ] Record demo GIF (scratch project): agent edits code -> tries to finish -> blocked -> runs tests -> receipt. Keep < 30 s, < 5 MB. Tools: `vhs`, `asciinema`+`agg`, or ScreenToGif.
- [ ] `SECURITY.md` (what the hooks read/write; no network; local files only), `CONTRIBUTING.md`, issue templates, CODE_OF_CONDUCT (Contributor Covenant), CHANGELOG (Keep a Changelog).
- [ ] `docs/DESIGN.md`: limitations (verification != correctness; shell-edit gap; non-git dirs), threat model (a hook runs arbitrary commands on user machine -> keep scripts tiny and auditable, no `eval`, no network).

### Phase 6 — Release on your own repo (0.5 day)
- [ ] Create public GitHub repo; set description, topics: `github-copilot`, `copilot-cli`, `copilot-plugin`, `hooks`, `ai-agents`, `verification`.
- [ ] Add `.github/plugin/marketplace.json` listing the plugin (`source: "./plugins/prove-it"`, version matches `plugin.json`).
- [ ] Enable branch protection, require CI, enable Dependabot (dev deps), enable private vulnerability reporting.
- [ ] Tag `v0.1.0` (annotated) and create a GitHub Release with changelog notes. Record the **full 40-char commit SHA** of the tag (needed for the awesome-copilot form).
- [ ] Clean-machine install test from the public repo on Windows and one POSIX OS, following only the README.
- [ ] Verify `copilot plugin marketplace add` / `install` / `update` / `uninstall` all work, and that uninstall leaves no hooks behind.

### Phase 7 — Submit to awesome-copilot (1 day + review wait)
Pick path A (preferred first) or B.
- **A. External-plugin issue form** (keeps code in your repo):
  - [ ] Find the "external plugin" issue template in `github/awesome-copilot` issues (new issue -> choose form). [UNKNOWN exact name; verify]
  - [ ] Fill: name, description, `owner/repo`, plugin path (`plugins/prove-it`), ref = release tag, sha = full commit SHA, version, license (`MIT`), author, keywords (lowercase-hyphenated), notes (link to benchmark + differentiation).
  - [ ] Wait for automation: `vally lint` and install smoke test. Fix and comment `/rerun-intake` if labeled `requires-submitter-fixes`.
  - [ ] Maintainer review -> `/approve` or `/reject <reason>`. Rejected is terminal; a new issue is required to retry, so don't submit until Phase 4 evidence exists.
  - [ ] Plan for 6-month re-review (calendar reminder); keep releases/tags immutable.
- **B. Native contribution** (hook and/or skill, if maintainers prefer them in-repo):
  - [ ] Fork `github/awesome-copilot`; follow CONTRIBUTING sections "Adding Hooks"/"Adding Skills"/"Adding Plugins"; use `npm run plugin:create`, `npm run skill:create`, `npm run plugin:validate`, `npm run skill:validate`, `npm run build`.
  - [ ] Open a PR; respond to review. Expect them to ask about duplicate-of-model-strength — answer with benchmark data.
- [ ] Before either path, search issues/discussions for an existing proposal and optionally open a short Discussion first ("RFC: enforced verification gate via agentStop") to gauge maintainer interest and avoid a rejection that is terminal.

### Phase 8 — Promotion (ongoing, after approval or in parallel with own-repo release)
- [ ] GitHub Discussions post in awesome-copilot (show-and-tell category) and in `github/copilot-cli` discussions if applicable. Lead with the benchmark chart, not the feature list.
- [ ] Blog post / dev.to / LinkedIn: "We measured how often coding agents claim success without running tests" — data first, plugin second. Include methodology and raw data link.
- [ ] Short demo video (60–90 s) for X/LinkedIn/YouTube.
- [ ] Add repo to relevant "awesome" lists (awesome-copilot website listing comes via Phase 7; other lists optional).
- [ ] Respond to issues within 48 h for the first month; label `good first issue` for pattern additions (new ecosystems) to attract contributors.
- [ ] Track: stars, installs (GitHub traffic/clones; no telemetry in plugin), issues, false-block reports.

### Phase 9 — Maintenance
- [ ] Watch Copilot CLI changelog (`/changelog`) for hook/plugin schema changes; pin a "tested with CLI vX.Y.Z" badge; add a weekly CI job that installs the latest CLI and runs the integration test.
- [ ] Semver: breaking config/behavior changes = major. Keep CHANGELOG current.
- [ ] Re-review every 6 months for awesome-copilot listing.

---------------------------------------------------------------------
## 7. Risks and mitigations

- **`agentStop` block doesn't behave as documented** -> Phase 1 spike gate; fallback design in Phase 1 STOP/DECIDE.
- **User annoyance / token cost** -> default `warn`, `maxBlocksPerTurn: 1`, ignorePaths, read-only turns never blocked, benchmark measures cost.
- **False sense of safety** -> receipt always lists "NOT verified"; README says verification != correctness.
- **Pattern gaps (shell edits, exotic runners)** -> table-driven patterns + `.prove-it.json` overrides + issue template for new patterns.
- **Rejected as duplicate** -> Phase 0 differentiation + Phase 4 data + RFC Discussion first.
- **Platform churn** -> weekly compatibility CI; minimal surface (2–4 hooks).
- **Security perception (hooks run code)** -> zero deps, no network, tiny readable scripts, SECURITY.md, no `eval`/dynamic requires.
- **Hook loop / trapping the agent** -> `stop_hook_active` guard, `maxBlocksPerTurn`, fail-open on every error.
- **Name/trademark** -> avoid "GitHub Copilot" as the product name.

---------------------------------------------------------------------
## 8. Definition of done (per phase gates)

- Phase 1 done: SPIKE-RESULTS.md exists; zero [ASSUMED] tags left unresolved in this doc (or design amended).
- Phase 3 done: CI green on 3 OSes; decision-table tests pass; integration test passes.
- Phase 4 done: benchmark report with raw data; effect and cost stated; go/no-go recorded.
- Phase 6 done: clean-machine install from README works; tag + SHA recorded.
- Phase 7 done: issue approved (or PR merged) / or documented rejection reason and next steps.

---------------------------------------------------------------------
## 9. Skeleton reference (illustrative, UNTESTED — verify field names in Phase 1)

`plugins/prove-it/hooks.json`
```json
{
  "version": 1,
  "hooks": {
    "postToolUse": [
      { "type": "command", "exec": "node", "args": ["scripts/prove-it.mjs", "post-tool"], "timeoutSec": 5 }
    ],
    "agentStop": [
      { "type": "command", "exec": "node", "args": ["scripts/prove-it.mjs", "stop"], "timeoutSec": 10 }
    ]
  }
}
```
Open question: how a plugin hook references its own install directory (relative `cwd`? an env var?). The docs' `cwd` is "relative to repository root or absolute", which would break plugin-relative script paths. Resolve in Phase 1 (check plugin docs for a plugin-root variable).

`scripts/prove-it.mjs` sketch (stop path)
```js
// Read one JSON payload from stdin, decide, print exactly one JSON object.
import { readFileSync } from "node:fs";

const allow = () => console.log(JSON.stringify({ decision: "allow" }));
try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  if (input.stop_hook_active) return allow();           // loop guard
  const events = readLedger(input.sessionId);            // lib/ledger.mjs
  const lastEdit = lastIndex(events, e => e.kind === "edit");
  if (lastEdit < 0) return allow();                      // read-only turn
  const verified = events.slice(lastEdit + 1).some(e => e.kind === "verify");
  if (verified) return allow();
  console.log(JSON.stringify({
    decision: "block",
    reason: "Files were edited but no test/lint/typecheck ran afterward. " +
            "Run: " + suggest(input.cwd).join(" ; ") +
            " — or state explicitly why verification is impossible. " +
            "End with a receipt: commands run, exit status, what was NOT verified."
  }));
} catch { allow(); }                                     // fail open
```
(Top-level `return` is not valid in an ES module — wrap in a `main()` function in the real code.)

`.github/plugin/marketplace.json`
```json
{
  "name": "prove-it-marketplace",
  "owner": { "name": "<your name>", "email": "<public email>" },
  "metadata": { "description": "Enforced verification gate for Copilot CLI", "version": "0.1.0" },
  "plugins": [
    {
      "name": "prove-it",
      "description": "Blocks 'done' after edits until a test/lint/typecheck has run; emits a receipt.",
      "version": "0.1.0",
      "source": "./plugins/prove-it"
    }
  ]
}
```

---------------------------------------------------------------------
## 10. Information needed from the user before starting

1. Repo and name: decided, `gvvskvarma/prove-it-gate` (display name "Prove It").
2. Target OS list for testing (Windows confirmed available; macOS/Linux via CI only?).
3. Whether Node >= 18 is acceptable as a runtime requirement.
4. Preferred default mode (`warn` proposed).
5. Budget/time: phases total ~2–3 weeks elapsed part-time, dominated by Phase 4 data collection.

---------------------------------------------------------------------
## 11. How the pitch is argued (for README, awesome-copilot form, blog)

- Claim: enforcement beats advice. A skill is skipped under context pressure; a hook is not.
- Evidence: benchmark delta in unverified-completion rate, with cost (extra turns/tokens) and false-block rate stated.
- Honest limits: proves commands ran, not correctness; default is non-blocking.
- Differentiation: from `ralph-loop` (loop-until-done) and generic hook collections — this one is a narrow, evidence-based gate with a receipt. (Confirm in Phase 0.)

---------------------------------------------------------------------
## 12. Source list (re-fetch to refresh; docs change often)

- Hooks reference: https://docs.github.com/api/article/body?pathname=/en/copilot/reference/hooks-configuration
- Plugin marketplaces: https://docs.github.com/api/article/body?pathname=/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-marketplace
- Plugin reference: https://docs.github.com/api/article/body?pathname=/en/copilot/reference/copilot-cli-reference/cli-plugin-reference (only first ~9 KB read)
- Creating a plugin (NOT yet read): https://docs.github.com/api/article/body?pathname=/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating
- Finding/installing plugins (NOT yet read): .../plugins-finding-installing
- awesome-copilot CONTRIBUTING: https://raw.githubusercontent.com/github/awesome-copilot/main/CONTRIBUTING.md (read ~half; "Adding Hooks" section and the rest not read)
- Example marketplaces: github/copilot-plugins, github/awesome-copilot (`.github/plugin/marketplace.json`)
- Third-party (unverified): torosent/ralph-loop, bertclaws/copilot-hooks, xavierxmorris/copilot-cli-plugin-marketplace-guide, josh-ops.com/posts/github-copilot-plugins, jamescroft.co.uk plugin-publishing post, DeepWiki pages for awesome-copilot.

## 13. Known research gaps (do these in Phase 0/1)
- Exact `plugin.json` schema and how plugin hooks/skills are referenced.
- How a plugin hook locates its own scripts (plugin-root variable).
- awesome-copilot "Adding Hooks"/"Adding Plugins" sections, and the external-plugin issue-form name.
- Whether `copilot plugin validate` exists.
- Whether `agentStop` allow-path can surface text to the user.
- Real `toolName` values and `toolArgs` shapes for edit/create/shell, and whether exit code is available.
- Subagent/session-id behavior; `-p` non-interactive hook behavior.
- Prior-art overlap (ralph-loop, copilot-hooks).

## 14. v2 ideas (explicitly deferred)
- Dependency/API existence check for newly imported symbols (hallucinated APIs).
- Diff-scope check against the user's request.
- Repro-first mode: require a failing reproduction before edits (via `preToolUse`).
- Repo-level `.github/hooks` variant for cloud agent.
- VS Code Copilot compatibility.
- Optional JSON receipt export for CI/PR descriptions.
