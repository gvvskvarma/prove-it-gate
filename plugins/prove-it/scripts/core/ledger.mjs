// Append-only JSONL ledger per session. Local files only; never networked.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_BYTES = 1_000_000;
const KEEP_LINES = 2000;
const PRUNE_AFTER_MS = 14 * 24 * 3600 * 1000;

export function dataDir(env = process.env) {
  return env.PROVE_IT_DATA ?? env.COPILOT_PLUGIN_DATA ?? env.PLUGIN_DATA ?? env.CLAUDE_PLUGIN_DATA ?? join(tmpdir(), "prove-it");
}

function sessionsDir(env) {
  const dir = join(dataDir(env), "sessions");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function safeId(sessionId) {
  return String(sessionId).replace(/[^\w.-]/g, "_").slice(0, 128) || "unknown";
}

export function ledgerPath(sessionId, env) {
  return join(sessionsDir(env), `${safeId(sessionId)}.jsonl`);
}

export function append(sessionId, entries, env) {
  if (!entries.length) return;
  const file = ledgerPath(sessionId, env);
  appendFileSync(file, entries.map(e => JSON.stringify(e)).join("\n") + "\n");
  if (statSync(file).size > MAX_BYTES) {
    const lines = readFileSync(file, "utf8").trimEnd().split("\n").slice(-KEEP_LINES);
    writeFileSync(file, lines.join("\n") + "\n");
  }
}

export function read(sessionId, env) {
  const file = ledgerPath(sessionId, env);
  if (!existsSync(file)) return [];
  const out = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* tolerate corruption */ }
  }
  return out;
}

export function prune(env, now = Date.now()) {
  const dir = sessionsDir(env);
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    try { if (now - statSync(file).mtimeMs > PRUNE_AFTER_MS) unlinkSync(file); } catch { /* ignore */ }
  }
}
