# Runs the stop hook's PowerShell command from hooks.json exactly as written,
# with only COPILOT_PLUGIN_ROOT set, and checks it prints valid JSON.
$ErrorActionPreference = 'Stop'
$hooks = Get-Content -Raw plugins/prove-it-gate/hooks.json | ConvertFrom-Json
$cmd = $hooks.hooks.agentStop[0].powershell
Remove-Item Env:PLUGIN_ROOT -ErrorAction SilentlyContinue
$env:COPILOT_PLUGIN_ROOT = (Resolve-Path plugins/prove-it-gate).Path
$env:PROVE_IT_DATA = Join-Path ([IO.Path]::GetTempPath()) 'prove-it-smoke'
$shell = if ($PSVersionTable.PSEdition -eq 'Core') { 'pwsh' } else { 'powershell' }
$out = '{"sessionId":"smoke","cwd":"."}' | & $shell -NoProfile -Command $cmd
if ($LASTEXITCODE -ne 0) { throw "hook exited $LASTEXITCODE" }
$null = ($out | Out-String | ConvertFrom-Json)
"hook OK: $out"
