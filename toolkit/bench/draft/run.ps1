# Build the app's code into `appcode.mjs`, then run a bench script - in that order, always.
#
# The order is the whole point: a run against a stale `appcode.mjs` measures a panel that no longer exists,
# and nothing in the output would say so.
#
#   ./run.ps1                       # the published campaign
#   ./run.ps1 coverage              # a policy set
#   ./run.ps1 floor.mjs             # any script by name
#   ./run.ps1 signal.py             # the python ones too
param([string]$What = 'published')

$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
  node build.mjs
  if (-not (Test-Path './windows.json')) {
    Write-Host 'windows.json is missing - regenerating it from the DB (about two minutes, read-only).'
    & ../../.venv/Scripts/python.exe extract.py windows.json
  }
  if ($What -like '*.py') { & ../../.venv/Scripts/python.exe $What }
  elseif ($What -like '*.mjs') { node $What }
  else { node multi.mjs $What }
} finally {
  Pop-Location
}
