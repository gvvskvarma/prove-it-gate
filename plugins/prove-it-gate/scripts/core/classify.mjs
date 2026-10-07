// Classify a tool call as edit / verify / other. Table-driven so new
// harnesses and ecosystems are one-line additions.

// Copilot CLI runtime names, their Claude equivalents, and VS Code Local tool names.
export const EDIT_TOOLS = new Set([
  "edit", "create", "str_replace_editor", "apply_patch", "write",
  "Edit", "Write", "MultiEdit", "NotebookEdit",
  "replace_string_in_file", "multi_replace_string_in_file", "create_file",
  "insert_edit_into_file", "edit_notebook_file", "editFiles",
]);

export const SHELL_TOOLS = new Set(["bash", "powershell", "shell", "Bash", "run_in_terminal", "runInTerminal"]);

export const VERIFY_PATTERNS = [
  /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|lint|typecheck|type-check|check|build)\b/,
  /\bnpx\s+(jest|vitest|mocha|tsc|eslint|playwright\s+test)\b/,
  /\b(jest|vitest|mocha|tsc|eslint|biome\s+check)\b/,
  /\bnode\s+--test\b/,
  /\b(python\d*\s+-m\s+)?(pytest|unittest|mypy|ruff|pyright|tox|nox)\b/,
  /\bgo\s+(test|vet|build)\b/,
  /\bcargo\s+(test|check|clippy|build)\b/,
  /\bdotnet\s+(test|build)\b/,
  /\b(mvn|mvnw|\.\/mvnw)\b.*\b(test|verify|package)\b/,
  /\b(gradle|gradlew|\.\/gradlew)\b.*\b(test|check|build)\b/,
  /\b(make|just)\s+(test|check|lint|verify)\b/,
  /\b(rspec|phpunit|swift\s+test|mix\s+test|bundle\s+exec\s+rake)\b/,
  /\bInvoke-Pester\b/,
];

const SHELL_WRITE_PATTERNS = [
  /\bsed\s+(-[a-zA-Z]*i|--in-place)/,
  /(^|[^0-9&>])>{1,2}\s*(?!\/dev\/null|&|\$null)[\w./~-]/,
  /\btee\b/,
  /\b(Set-Content|Add-Content|Out-File|New-Item)\b/,
  /\b(git\s+(apply|checkout\s+--|restore)|patch\s+-p)\b/,
  /\b(mv|cp|rm)\s+/,
];

export function commandOf(args) {
  if (!args || typeof args !== "object") return "";
  return String(args.command ?? args.cmd ?? args.script ?? args.raw ?? "");
}

export function filesOf(args) {
  if (!args || typeof args !== "object") return [];
  const one = args.path ?? args.filePath ?? args.file_path ?? args.file;
  const many = args.paths ?? args.files ?? args.filePaths;
  return [one, ...(Array.isArray(many) ? many : [])].filter(v => typeof v === "string");
}

export function exitCodeOf(text, failed) {
  const m = /exit(?:ed)?(?:\s+with)?\s+code[:\s]+(-?\d+)/i.exec(text ?? "");
  if (m) return Number(m[1]);
  return failed ? 1 : null; // null = unknown, treated as "ran"
}

function compile(patterns) {
  return (patterns ?? []).map(p => (p instanceof RegExp ? p : new RegExp(p)));
}

// Returns zero or more ledger entries for one tool call.
export function classify(evt, config = {}) {
  const ts = Date.now();
  if (EDIT_TOOLS.has(evt.tool)) {
    return [{ ts, kind: "edit", tool: evt.tool, files: filesOf(evt.args) }];
  }
  if (SHELL_TOOLS.has(evt.tool)) {
    const command = commandOf(evt.args);
    const out = [];
    if (SHELL_WRITE_PATTERNS.some(re => re.test(command))) {
      out.push({ ts, kind: "edit", tool: evt.tool, files: [], command: command.slice(0, 300) });
    }
    const verify = [...VERIFY_PATTERNS, ...compile(config.verifyPatterns)];
    const custom = (config.verifyCommands ?? []).some(c => command.includes(c));
    if (custom || verify.some(re => re.test(command))) {
      out.push({ ts, kind: "verify", tool: evt.tool, command: command.slice(0, 300), exit: exitCodeOf(evt.resultText, evt.failed) });
    }
    return out.length ? out : [{ ts, kind: "other", tool: evt.tool }];
  }
  return [{ ts, kind: "other", tool: evt.tool }];
}
