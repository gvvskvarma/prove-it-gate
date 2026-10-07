// Suggest verification commands for the project. Never guesses: returns []
// when nothing recognizable is found.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function has(cwd, name) { return existsSync(join(cwd, name)); }

export function detect(cwd, config = {}) {
  if (config.verifyCommands?.length) return [...config.verifyCommands];
  const out = [];
  if (has(cwd, "package.json")) {
    try {
      const scripts = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")).scripts ?? {};
      for (const s of ["test", "lint", "typecheck"]) if (scripts[s]) out.push(s === "test" ? "npm test" : `npm run ${s}`);
    } catch { /* ignore */ }
  }
  if (["pyproject.toml", "pytest.ini", "tox.ini", "setup.cfg"].some(f => has(cwd, f))) out.push("pytest");
  if (has(cwd, "go.mod")) out.push("go vet ./...", "go test ./...");
  if (has(cwd, "Cargo.toml")) out.push("cargo test");
  if (has(cwd, "pom.xml")) out.push("mvn -q test");
  if (has(cwd, "build.gradle") || has(cwd, "build.gradle.kts")) out.push(has(cwd, "gradlew") ? "./gradlew test" : "gradle test");
  try {
    if (readdirSync(cwd).some(f => f.endsWith(".sln") || f.endsWith(".csproj"))) out.push("dotnet test");
  } catch { /* ignore */ }
  return out;
}
