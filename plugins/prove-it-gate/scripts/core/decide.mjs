// The gate. Pure function: ledger + context in, decision out.
import { isIgnored } from "./config.mjs";
import { renderReceipt } from "./receipt.mjs";

export function currentTurn(events) {
  let start = 0;
  events.forEach((e, i) => { if (e.kind === "prompt") start = i + 1; });
  return events.slice(start);
}

function countsAsEdit(e, config, cwd) {
  if (e.kind !== "edit") return false;
  if (!e.files?.length) return true; // shell edit: files unknown, count it
  return e.files.some(f => !isIgnored(f, config.ignorePaths, cwd));
}

export function decide({ events, config, stopHookActive = false, suggestions = [], cwd = "" }) {
  const turn = currentTurn(events);
  const edits = turn.map((e, i) => [e, i]).filter(([e]) => countsAsEdit(e, config, cwd));
  const lastEdit = edits.length ? edits[edits.length - 1][1] : -1;
  const verifies = lastEdit < 0 ? [] : turn.slice(lastEdit + 1).filter(e => e.kind === "verify");
  const lastVerify = verifies[verifies.length - 1];
  const blocks = turn.filter(e => e.kind === "block").length;

  let gate;
  if (lastEdit < 0) gate = "not-applicable";
  else if (!lastVerify) gate = "unverified";
  else if (lastVerify.exit != null && lastVerify.exit !== 0) gate = "failed-verification";
  else gate = "passed";

  const wantsBlock =
    config.mode === "enforce" &&
    (gate === "unverified" || (gate === "failed-verification" && config.blockOnFailedVerification));
  const guarded = stopHookActive || blocks >= config.maxBlocksPerTurn;
  if (wantsBlock && guarded) gate = gate === "unverified" ? "demanded-and-skipped" : gate;

  const receipt = renderReceipt({ turn, edits: edits.map(([e]) => e), verifies, gate });
  if (config.mode === "off" || gate === "not-applicable") return { action: "allow", gate, receipt: null };
  if (!wantsBlock || guarded) return { action: "allow", gate, receipt };

  const run = suggestions.length ? `Run: ${suggestions.join(" ; ")}.` : "Run this project's test, lint or typecheck command.";
  const reason = gate === "unverified"
    ? `prove-it: files were edited but no test/lint/typecheck/build ran after the last edit. ${run} If verification is impossible here, say exactly why. End your reply with a receipt: commands run, exit status, and what was NOT verified.`
    : `prove-it: the last verification after your edits failed (${lastVerify.command} -> exit ${lastVerify.exit}). Fix the failure or state clearly that it is unresolved. Do not claim the task is done. End with a receipt.`;
  return { action: "block", gate, reason, receipt };
}
