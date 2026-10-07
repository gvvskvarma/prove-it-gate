import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { classify } from "../plugins/prove-it-gate/scripts/core/classify.mjs";
import { DEFAULTS, isIgnored } from "../plugins/prove-it-gate/scripts/core/config.mjs";
import { decide } from "../plugins/prove-it-gate/scripts/core/decide.mjs";
import { normalize } from "../plugins/prove-it-gate/scripts/core/normalize.mjs";
import { run } from "../plugins/prove-it-gate/scripts/prove-it.mjs";

const enforce = { ...DEFAULTS, mode: "enforce" };
const prompt = { kind: "prompt" };
const edit = { kind: "edit", files: ["src/a.js"] };
const pass = { kind: "verify", command: "npm test", exit: 0 };
const fail = { kind: "verify", command: "npm test", exit: 1 };

test("decision table", () => {
  const cases = [
    ["no edits -> allow", [prompt], {}, "allow", "not-applicable"],
    ["edit, no verify -> block", [prompt, edit], {}, "block", "unverified"],
    ["edit then verify -> allow", [prompt, edit, pass], {}, "allow", "passed"],
    ["verify only before edit -> block", [prompt, pass, edit], {}, "block", "unverified"],
    ["failing verify -> block once", [prompt, edit, fail], {}, "block", "failed-verification"],
    ["stop_hook_active -> allow", [prompt, edit], { stopHookActive: true }, "allow", "demanded-and-skipped"],
    ["already blocked this turn -> allow", [prompt, edit, { kind: "block" }], {}, "allow", "demanded-and-skipped"],
    ["docs-only edit -> allow", [prompt, { kind: "edit", files: ["README.md"] }], {}, "allow", "not-applicable"],
    ["edit in previous turn only -> allow", [prompt, edit, prompt], {}, "allow", "not-applicable"],
    ["shell edit (no files) -> block", [prompt, { kind: "edit", files: [], command: "sed -i s/a/b/ x" }], {}, "block", "unverified"],
  ];
  for (const [name, events, extra, action, gate] of cases) {
    const r = decide({ events, config: enforce, ...extra });
    assert.equal(r.action, action, name);
    assert.equal(r.gate, gate, name);
  }
});

test("warn mode never blocks but returns a receipt", () => {
  const r = decide({ events: [prompt, edit], config: { ...DEFAULTS, mode: "warn" } });
  assert.equal(r.action, "allow");
  assert.match(r.receipt, /Gate: unverified/);
});

test("classifies Copilot CLI, VS Code and Claude payload shapes", () => {
  const cli = normalize({ sessionId: "s", toolName: "bash", toolArgs: JSON.stringify({ command: "npm test" }), toolResult: { resultType: "success", textResultForLlm: "ok\n<exited with exit code 0>" } }, "post-tool");
  assert.deepEqual(classify(cli).map(e => [e.kind, e.exit]), [["verify", 0]]);

  const vscode = normalize({ hook_event_name: "PostToolUse", session_id: "s", tool_name: "replace_string_in_file", tool_input: { filePath: "/w/src/x.ts" } });
  assert.equal(vscode.event, "post-tool");
  assert.deepEqual(classify(vscode)[0].files, ["/w/src/x.ts"]);

  const failed = normalize({ toolName: "bash", toolArgs: { command: "pytest -q" }, error: "boom" }, "post-tool-failure");
  assert.equal(classify(failed)[0].exit, 1);

  const both = normalize({ toolName: "bash", toolArgs: { command: "sed -i s/a/b/ f.py && pytest" } }, "post-tool");
  assert.deepEqual(classify(both).map(e => e.kind), ["edit", "verify"]);

  const read = normalize({ toolName: "bash", toolArgs: { command: "ls -la 2>&1" } }, "post-tool");
  assert.deepEqual(classify(read).map(e => e.kind), ["other"]);
});

test("real Copilot CLI PowerShell commands from the Windows spike", () => {
  const ps = command => classify(normalize({ toolName: "powershell", toolArgs: { command } }, "post-tool")).map(e => e.kind);
  // Setup command whose quoted value merely contains "node --test": not a verification.
  assert.deepEqual(ps("npm init -y; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npm pkg set 'scripts.test=node --test'"), ["other"]);
  // .NET file writes are edits; the "=>" inside the quoted file content is not a redirect.
  assert.deepEqual(ps("[System.IO.File]::WriteAllText((Join-Path (Get-Location) 'math.mjs'), 'export const add = (a, b) => a + b;', [System.Text.UTF8Encoding]::new($false))"), ["edit"]);
  assert.deepEqual(ps('node -e "const f = x => x; console.log(f(1))"'), ["other"]);
  assert.deepEqual(ps("npm test"), ["verify"]);
  assert.deepEqual(ps('Set-Content math.mjs "x"; npm test'), ["edit", "verify"]);
});

test("ignorePaths globs", () => {
  assert.ok(isIgnored("/repo/docs/x/y.js", DEFAULTS.ignorePaths, "/repo"));
  assert.ok(isIgnored("README.md", DEFAULTS.ignorePaths));
  assert.ok(!isIgnored("/repo/src/a.js", DEFAULTS.ignorePaths, "/repo"));
});

test("end to end through run() with a temp data dir", () => {
  const env = { PROVE_IT_DATA: mkdtempSync(join(tmpdir(), "prove-it-")), PROVE_IT_MODE: "enforce" };
  const cwd = mkdtempSync(join(tmpdir(), "proj-"));
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  const base = { sessionId: "e2e", cwd };
  run("prompt", base, env);
  run("post-tool", { ...base, toolName: "edit", toolArgs: { path: join(cwd, "index.js") } }, env);
  const blocked = run("stop", { ...base, stop_hook_active: false }, env);
  assert.equal(blocked.decision, "block");
  assert.equal(blocked.hookSpecificOutput.decision, "block");
  assert.match(blocked.reason, /npm test/);
  run("post-tool", { ...base, toolName: "bash", toolArgs: { command: "npm test" }, toolResult: { resultType: "success", textResultForLlm: "pass" } }, env);
  const allowed = run("stop", { ...base, stop_hook_active: true }, env);
  assert.equal(allowed.decision, undefined);
  assert.match(allowed.systemMessage, /Gate: passed/);
});

test("CLI entry fails open on garbage input", () => {
  const out = execFileSync(process.execPath, ["plugins/prove-it-gate/scripts/prove-it.mjs", "stop"], { input: "not json", env: { ...process.env, PROVE_IT_DATA: mkdtempSync(join(tmpdir(), "p-")) } });
  assert.doesNotThrow(() => JSON.parse(out.toString() || "{}"));
});
