#!/usr/bin/env node
// Single hook entry point. Usage: node prove-it.mjs <session-start|prompt|post-tool|post-tool-failure|stop>
// Contract: always exit 0, print at most one JSON object, fail open on any error.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { classify } from "./core/classify.mjs";
import { loadConfig } from "./core/config.mjs";
import { decide } from "./core/decide.mjs";
import { detect } from "./core/detect.mjs";
import { append, dataDir, prune, read } from "./core/ledger.mjs";
import { normalize } from "./core/normalize.mjs";

function readStdin() {
  try { return JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { return {}; }
}

// One object that satisfies Copilot CLI / Claude Code (top-level decision)
// and VS Code Local hooks (hookSpecificOutput). Unknown fields are ignored.
export function stopOutput(result) {
  if (result.action === "block") {
    return {
      decision: "block",
      reason: result.reason,
      hookSpecificOutput: { hookEventName: "Stop", decision: "block", reason: result.reason },
    };
  }
  return result.receipt ? { systemMessage: result.receipt } : {};
}

export function run(eventArg, raw, env = process.env) {
  const evt = normalize(raw, eventArg);
  const config = loadConfig(evt.cwd, env);
  if (config.mode === "off") return evt.event === "stop" ? {} : null;

  switch (evt.event) {
    case "session-start":
      prune(env);
      return null;
    case "prompt":
      append(evt.sessionId, [{ ts: Date.now(), kind: "prompt" }], env);
      return null;
    case "post-tool":
    case "post-tool-failure":
      append(evt.sessionId, classify(evt, config), env);
      return null;
    case "stop": {
      const result = decide({
        events: read(evt.sessionId, env),
        config,
        stopHookActive: evt.stopHookActive,
        suggestions: detect(evt.cwd, config),
        cwd: evt.cwd,
      });
      if (result.action === "block") append(evt.sessionId, [{ ts: Date.now(), kind: "block" }], env);
      if (result.receipt) {
        const dir = join(dataDir(env), "receipts");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${evt.sessionId.replace(/[^\w.-]/g, "_")}.txt`), result.receipt + "\n");
      }
      return stopOutput(result);
    }
    default:
      return null;
  }
}

function main() {
  const eventArg = process.argv[2];
  let out = null;
  try {
    out = run(eventArg, readStdin());
  } catch {
    out = eventArg === "stop" ? {} : null; // fail open
  }
  if (out) process.stdout.write(JSON.stringify(out) + "\n");
  process.exitCode = 0;
}

if (process.argv[1]?.endsWith("prove-it.mjs")) main();
