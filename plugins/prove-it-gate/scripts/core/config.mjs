// Optional `.prove-it.json`, searched from cwd upward. Defaults are conservative.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const DEFAULTS = Object.freeze({
  enabled: true,
  mode: "warn", // off | warn | enforce
  verifyCommands: [],
  verifyPatterns: [],
  ignorePaths: ["**/*.md", "docs/**", "**/*.txt"],
  maxBlocksPerTurn: 1,
  blockOnFailedVerification: true,
});

export function loadConfig(cwd, env = process.env) {
  let found = {};
  let dir = cwd;
  for (let i = 0; i < 8 && dir; i++) {
    const file = join(dir, ".prove-it.json");
    if (existsSync(file)) {
      try { found = JSON.parse(readFileSync(file, "utf8")); } catch { found = {}; }
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const config = { ...DEFAULTS, ...found };
  if (env.PROVE_IT_MODE) config.mode = env.PROVE_IT_MODE;
  if (config.enabled === false) config.mode = "off";
  return config;
}

export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      re += glob[i + 2] === "/" ? "(?:.*/)?" : ".*";
      i += glob[i + 2] === "/" ? 2 : 1;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

export function isIgnored(file, ignorePaths, cwd = "") {
  let rel = file.replace(/\\/g, "/");
  const base = cwd.replace(/\\/g, "/").replace(/\/$/, "");
  if (base && rel.startsWith(base + "/")) rel = rel.slice(base.length + 1);
  return ignorePaths.some(g => globToRegExp(g).test(rel));
}
