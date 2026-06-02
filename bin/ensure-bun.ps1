# bin/ensure-bun.ps1 — slim-plugin runtime provisioner (Windows target).
#
# Mirror of ensure-bun.sh. Idempotently provisions the PINNED bun.exe into
# ${CLAUDE_PLUGIN_DATA}\bun (persists across plugin updates). Called
# synchronously by launch.cmd before it launches the server.
#
# ALL diagnostic output goes to stderr (Write-Error / $host.UI write to stderr;
# we use [Console]::Error) — stdout must stay clean for the MCP JSON-RPC stream.
#
# FLAGGED: not executable on the Linux dev host; validate on Windows hardware.
$ErrorActionPreference = "Stop"
$Pin = "1.3.11"   # keep in sync with package.json scholar.bundledBunVersion

if (-not $env:CLAUDE_PLUGIN_DATA) { [Console]::Error.WriteLine("ensure-bun: CLAUDE_PLUGIN_DATA unset"); exit 1 }
$BunDir = Join-Path $env:CLAUDE_PLUGIN_DATA "bun"
$BunBin = Join-Path $BunDir "bun.exe"

function Test-Ok {
  if (-not (Test-Path $BunBin)) { return $false }
  try { return ((& $BunBin --version 2>$null) -eq $Pin) } catch { return $false }
}

if (Test-Ok) { exit 0 }

New-Item -ItemType Directory -Force -Path $BunDir | Out-Null

# Coarse single-writer guard (no flock on Windows): a lock dir created atomically.
$Lock = Join-Path $BunDir ".provision.lock"
$haveLock = $false
for ($i = 0; $i -lt 120; $i++) {
  try { New-Item -ItemType Directory -Path $Lock -ErrorAction Stop | Out-Null; $haveLock = $true; break }
  catch { if (Test-Ok) { exit 0 }; Start-Sleep -Milliseconds 500 }
}
try {
  if (Test-Ok) { exit 0 }
  $Url = "https://github.com/oven-sh/bun/releases/download/bun-v$Pin/bun-windows-x64.zip"
  [Console]::Error.WriteLine("ensure-bun: provisioning bun $Pin (windows-x64) into $BunDir")
  $Tmp = Join-Path $BunDir ".dl"
  if (Test-Path $Tmp) { Remove-Item -Recurse -Force $Tmp }
  New-Item -ItemType Directory -Force -Path $Tmp | Out-Null
  $Zip = Join-Path $Tmp "bun.zip"
  Invoke-WebRequest -Uri $Url -OutFile $Zip
  Expand-Archive -Path $Zip -DestinationPath $Tmp -Force
  Move-Item -Force (Join-Path $Tmp "bun-windows-x64\bun.exe") $BunBin
  Remove-Item -Recurse -Force $Tmp
  [Console]::Error.WriteLine("ensure-bun: provisioned $(& $BunBin --version)")
} finally {
  if ($haveLock) { Remove-Item -Recurse -Force $Lock -ErrorAction SilentlyContinue }
}
