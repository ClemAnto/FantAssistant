# Refresh the fantacalcio.it editorial pages (probabili + indisponibili) NOW, before a session.
#
# It used to be `weekly-snapshot.ps1` and it used to argue for a scheduled task. Both are gone by the
# operator's decision (05/08/2026): «il job ogni settimana non serve». The reasoning behind it was already
# on the record from 29/07 and this closes it: the probabili page shows only "now", so its HISTORY cannot
# be reconstructed - but that history is not what the toolkit is for. An initial auction happens in August,
# when the page does not exist yet; and what the editors add that we cannot compute arrives LATE, from the
# coach's own words, so the reading worth having is one taken JUST BEFORE the session and used at once.
# `starter_prob` 0/1453 on the gate's past windows is therefore empty BY DESIGN, and no auction rule waits
# for it (gate §5, `docs/model/stato-progetto-continuita-v5.md`, «le probabili non si storicizzano»).
#
# So this script does one thing, on demand: one run of `python -m euroleghe_ingest fc_site`, which snapshots
# the pages into data/cache/fc_site_{page}_{date}.html and ingests them (probable_starter / availability /
# penalty_hierarchy). The snapshots ARE the dated series - `rebuild` replays them in date order - so the
# value of a run is entirely in the files it leaves behind, and running it the day of an auction is what
# makes the board draw today's probabili instead of last week's.
#
# Idempotent: re-running on the same day overwrites that day's snapshot instead of duplicating it (the date
# is the key). ⚠️ Two runs on the SAME day overwrite each other, so a 20:45 kick-off would read the 15:00
# state: if a pre-match reading ever has to be taken seriously, the series needs an hour, not a day.
#
# Usage:
#   pwsh scripts/refresh-editorial.ps1

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$python = Join-Path $repo 'toolkit\.venv\Scripts\python.exe'
$logDir = Join-Path $repo 'data\reports'
$log = Join-Path $logDir 'refresh-editorial.log'

if (-not (Test-Path $python)) {
    throw "python not found at $python - create the venv first (toolkit/.venv)"
}
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
Add-Content -Path $log -Value "=== $stamp fc_site ==="
& $python -m euroleghe_ingest fc_site 2>&1 | Tee-Object -FilePath $log -Append
$code = $LASTEXITCODE
Add-Content -Path $log -Value "=== exit $code ==="

# The point of the run is the files: say which days exist now, so a stale board is visible as a date.
$snapshots = @(Get-ChildItem -Path (Join-Path $repo 'data\cache') -Filter 'fc_site_probabili_*.html' `
        -ErrorAction SilentlyContinue)
Write-Host ("probabili snapshots on disk: {0}" -f $snapshots.Count)
if ($snapshots.Count) {
    $dates = $snapshots.Name -replace '^fc_site_probabili_', '' -replace '\.html$', '' | Sort-Object
    Write-Host ("  from {0} to {1}" -f $dates[0], $dates[-1])
}
exit $code
