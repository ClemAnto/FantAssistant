# Take this week's snapshot of the fantacalcio.it editorial pages (probabili + indisponibili).
#
# Why this exists, and why it has to run on a schedule. The probabili-formazioni page shows only
# "now": there is no archive, so a matchday nobody snapshotted is gone for good. The gate's own
# input inventory says it out loud - `starter_prob` is 0/1453 on T2, not because the model ignores
# it but because no history exists to read. R7 (the starting probability) is PRE-REGISTERED in its
# weekly-snapshot form, and it cannot be tested until enough weeks have accumulated. Every week this
# does not run is a window that can never be reconstructed.
#
# What it does: one run of `python -m euroleghe_ingest fc_site`, which snapshots the pages into
# data/cache/fc_site_{page}_{date}.html and ingests them (probable_starter / availability /
# penalty_hierarchy). The snapshots ARE the time series - `rebuild` replays them in date order - so
# the value of this script is entirely in the FILES it leaves behind.
#
# Idempotent: re-running on the same day overwrites that day's snapshot instead of duplicating it
# (the date is the key), so a missed week can be caught up by running it late, and running it twice
# costs nothing.
#
# Usage:
#   pwsh scripts/weekly-snapshot.ps1               # take today's snapshot now
#   pwsh scripts/weekly-snapshot.ps1 -Register     # also register the weekly scheduled task
#   pwsh scripts/weekly-snapshot.ps1 -Unregister   # remove it
#   pwsh scripts/weekly-snapshot.ps1 -Status       # is it registered, and when did it last run
#
# The scheduled task runs as the current user (no admin needed), Friday 12:00 - the probabili are
# published and refined through the week, and Friday is the last quiet moment before Serie A plays.

[CmdletBinding()]
param(
    [switch]$Register,
    [switch]$Unregister,
    [switch]$Status,
    [string]$TaskName = 'FantAssistant-weekly-snapshot',
    [string]$At = '12:00',
    [ValidateSet('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')]
    [string]$DayOfWeek = 'Friday'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$python = Join-Path $repo 'toolkit\.venv\Scripts\python.exe'
$logDir = Join-Path $repo 'data\reports'
$log = Join-Path $logDir 'weekly-snapshot.log'

if ($Status) {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $task) { Write-Host "not registered: $TaskName"; exit 0 }
    $info = Get-ScheduledTaskInfo -TaskName $TaskName
    Write-Host "registered: $TaskName ($($task.State))"
    Write-Host "  last run : $($info.LastRunTime) (result $($info.LastTaskResult))"
    Write-Host "  next run : $($info.NextRunTime)"
    if (Test-Path $log) { Write-Host "  log      : $log" }
    exit 0
}

if ($Unregister) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "unregistered: $TaskName"
    exit 0
}

if ($Register) {
    # -NoProfile so the task does not depend on the interactive profile; -File keeps the quoting sane.
    $action = New-ScheduledTaskAction -Execute 'pwsh.exe' `
        -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" `
        -WorkingDirectory $repo
    $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $DayOfWeek -At $At
    # StartWhenAvailable: a laptop that was off on Friday still takes the snapshot when it wakes up.
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
        -Settings $settings -Description 'FantAssistant: weekly fantacalcio.it editorial snapshot' `
        -Force | Out-Null
    Write-Host "registered: $TaskName -> $DayOfWeek $At"
    Write-Host "  (it also runs now, so the first snapshot is not a week away)"
}

if (-not (Test-Path $python)) {
    throw "python not found at $python - create the venv first (toolkit/.venv)"
}
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
Add-Content -Path $log -Value "=== $stamp fc_site ==="
& $python -m euroleghe_ingest fc_site 2>&1 | Tee-Object -FilePath $log -Append
$code = $LASTEXITCODE
Add-Content -Path $log -Value "=== exit $code ==="

# The point of the run is the files: report how many weeks of history exist now.
$snapshots = @(Get-ChildItem -Path (Join-Path $repo 'data\cache') -Filter 'fc_site_probabili_*.html' `
        -ErrorAction SilentlyContinue)
Write-Host ("probabili snapshots on disk: {0}" -f $snapshots.Count)
if ($snapshots.Count) {
    $dates = $snapshots.Name -replace '^fc_site_probabili_', '' -replace '\.html$', '' | Sort-Object
    Write-Host ("  from {0} to {1}" -f $dates[0], $dates[-1])
}
exit $code
