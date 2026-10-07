// Structural checks for the plugin and marketplace manifests. No dependencies.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const errors = [];
const load = f => { try { return JSON.parse(readFileSync(f, "utf8")); } catch (e) { errors.push(`${f}: ${e.message}`); return {}; } };
const kebab = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const market = load(".github/plugin/marketplace.json");
if (!kebab.test(market.name ?? "")) errors.push("marketplace.name must be kebab-case");
if (!market.owner?.name) errors.push("marketplace.owner.name is required");
for (const p of market.plugins ?? []) {
  const dir = p.source;
  const manifest = load(join(dir, "plugin.json"));
  if (manifest.name !== p.name) errors.push(`${p.name}: name differs from ${dir}/plugin.json`);
  if (manifest.version !== p.version) errors.push(`${p.name}: version differs from ${dir}/plugin.json`);
  for (const k of manifest.keywords ?? []) if (!kebab.test(k)) errors.push(`${p.name}: keyword "${k}" must be lowercase-hyphenated`);
  const hooks = load(join(dir, manifest.hooks ?? "hooks.json"));
  if (hooks.version !== 1) errors.push(`${p.name}: hooks.json version must be 1`);
  for (const [event, entries] of Object.entries(hooks.hooks ?? {})) {
    if (!Array.isArray(entries)) errors.push(`${p.name}: hooks.${event} must be an array`);
  }
  for (const s of ["scripts/prove-it.mjs", "skills/prove-it/SKILL.md"]) {
    if (!existsSync(join(dir, s))) errors.push(`${p.name}: missing ${s}`);
  }
  const skill = readFileSync(join(dir, "skills/prove-it/SKILL.md"), "utf8").replace(/\r\n/g, "\n");
  if (!/^---\nname: prove-it\ndescription: .+\n---/m.test(skill)) errors.push("SKILL.md frontmatter must have name: prove-it and a description");
}

if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("manifests OK");
