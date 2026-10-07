// Turn any supported harness payload into one normalized event.
// Copilot CLI camelCase events send camelCase fields; PascalCase events (and
// VS Code / Claude Code) send snake_case fields. Accept both.

const EVENT_ALIASES = {
  "session-start": "session-start", sessionStart: "session-start", SessionStart: "session-start",
  prompt: "prompt", userPromptSubmitted: "prompt", UserPromptSubmit: "prompt",
  "post-tool": "post-tool", postToolUse: "post-tool", PostToolUse: "post-tool",
  "post-tool-failure": "post-tool-failure", postToolUseFailure: "post-tool-failure", PostToolUseFailure: "post-tool-failure",
  stop: "stop", agentStop: "stop", Stop: "stop",
};

function parseMaybe(value) {
  if (typeof value !== "string") return value ?? {};
  try { return JSON.parse(value); } catch { return { raw: value }; }
}

function resultText(result) {
  if (result == null) return "";
  if (typeof result === "string") return result;
  return String(result.textResultForLlm ?? result.text_result_for_llm ?? result.output ?? result.stdout ?? JSON.stringify(result));
}

export function normalize(raw, eventArg) {
  const event = EVENT_ALIASES[eventArg] ?? EVENT_ALIASES[raw.hook_event_name ?? raw.hookEventName] ?? "unknown";
  const result = raw.toolResult ?? raw.tool_result ?? raw.tool_response;
  const resultType = result?.resultType ?? result?.result_type;
  return {
    event,
    sessionId: String(raw.sessionId ?? raw.session_id ?? "unknown"),
    cwd: raw.cwd || process.cwd(),
    tool: raw.toolName ?? raw.tool_name ?? null,
    args: parseMaybe(raw.toolArgs ?? raw.tool_input),
    resultText: resultText(result) || String(raw.error?.message ?? raw.error ?? ""),
    failed: event === "post-tool-failure" || resultType === "failure",
    stopHookActive: Boolean(raw.stop_hook_active ?? raw.stopHookActive),
    transcriptPath: raw.transcriptPath ?? raw.transcript_path ?? null,
  };
}
