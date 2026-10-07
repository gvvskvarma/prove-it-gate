// Plain-text receipt. Deterministic for tests (no timestamps unless present in input).

const MAX_FILES = 10;

export function renderReceipt({ edits, verifies, gate }) {
  const files = [...new Set(edits.flatMap(e => (e.files?.length ? e.files : [`(shell) ${e.command ?? e.tool}`])))];
  const lines = ["prove-it receipt", `Gate: ${gate}`, `Files edited: ${files.length}`];
  for (const f of files.slice(0, MAX_FILES)) lines.push(`  - ${f}`);
  if (files.length > MAX_FILES) lines.push(`  ... and ${files.length - MAX_FILES} more`);
  if (verifies.length) {
    lines.push("Verification run after last edit:");
    for (const v of verifies) lines.push(`  - ${v.command} -> exit ${v.exit ?? "unknown"}`);
  } else {
    lines.push("Verification run after last edit: none");
  }
  lines.push("NOT verified: " + (gate === "passed"
    ? "correctness beyond what the commands above check"
    : "the edits above have no passing verification"));
  return lines.join("\n");
}
