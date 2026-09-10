# The NIGHTLY acquisition: `update` in full, on a machine nobody is using.
#
# WHY A SCHEDULED TASK AND NOT AN AGENT (operator's question, 10/09/2026: «possiamo creare un agente
# che aggiorni questi dati la notte?»). The work is deterministic and the judgement is already inside
# `update`: one ordered plan derived from `bootstrap`, every step resumable, a cache that is not paid
# for twice, and the rule that a sweep which starts getting refused is abandoned instead of ground
# against a closed door (17/08/2026). What an LLM would add at 3am is a layer nobody reads. What was
# actually missing is a RUNNER that outlives the session that started it - the run this replaced died
# at 493 pages of 3721 with `exit 127`, killed by a shell wrapper and not by the source.
#
# AND IT CANNOT BE A CLOUD AGENT, for the reason already on the record about publishing (09/08/2026):
# the acquisition needs `data/`, the cache and the credentials in `.env`, all of which live on this
# machine and on no runner. The operator's machine is the only publisher, and it is the only fetcher.
#
# WHAT IT RUNS is the FULL update and not `--daily`, which is the whole point of doing it at night:
# the archives are what the night is for (the injury history, the market curve, the per-match layer,
# the votes), and they are exactly what a day-of-session run leaves out. The daily readings are taken
# by the operator when he sits down - the probabili show only «now», so the reading worth having is
# one taken just before a session and used at once (his ruling of 05/08/2026, which removed the
# weekly job this file must not quietly reinstate). This run takes today's editorial pages too, and
# that does NOT overrule him: the snapshot is keyed on the DAY, so his own run before a session
# overwrites it with the fresher one. The order is what makes both true.
#
# ONE SESSION OWNS THE DB. The task refuses to start when somebody holds the write lock - measured
# with the database itself (`BEGIN IMMEDIATE`, rolled back) rather than by looking for processes,
# because what matters is the lock and not who has it. A collision that begins AFTER the check is
# covered by `db.database.retry_on_lock` (1, 2, 4, 8, 16 seconds, each one printed).
#
# IT IS MEANT TO BE CUT OFF. The plan is ~22h cold and every step is resumable, so the task is
# registered with a five-hour limit (03:00 -> 08:00) and what does not finish tonight is picked up
# tomorrow. A kill mid-run costs nothing: the modules commit as they go and the cache keeps what was
# downloaded, which is the same property `--stale-days` exists for.
#
# Usage:
#   pwsh scripts/nightly-update.ps1              # run it now, exactly as the task would
#   pwsh scripts/nightly-update.ps1 -Register    # create/replace the 03:00 scheduled task
#   pwsh scripts/nightly-update.ps1 -Unregister  # remove it
#   pwsh scripts/nightly-update.ps1 -Status      # what the task is, and what the last runs did

[CmdletBinding()]
param(
    [switch]$Register,
    [switch]$Unregister,
    [switch]$Status,
    # The nightly cut-off, in hours. Task Scheduler enforces it; the run resumes tomorrow.
    [int]$MaxHours = 5,
    [string]$At = '03:00'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$python = Join-Path $repo 'toolkit\.venv\Scripts\python.exe'
$logDir = Join-Path $repo 'data\logs'
$taskName = 'FantAssistant nightly update'
# Two weeks of logs: enough to see a source that has been refusing for days, which is a thing that
# has happened (Sofascore 403 on 16 and 17/08, ClubElo's API 502 since January).
$keepLogs = 14

function Assert-Toolkit {
    if (-not (Test-Path $python)) {
        throw "python not found at $python - create the venv first (toolkit/.venv)"
    }
}

if ($Register) {
    Assert-Toolkit
    $pwsh = (Get-Process -Id $PID).Path
    $script = Join-Path $PSScriptRoot 'nightly-update.ps1'
    $action = New-ScheduledTaskAction -Execute $pwsh `
        -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`"" -WorkingDirectory $repo
    $trigger = New-ScheduledTaskTrigger -Daily -At $At
    # THREE SETTINGS, and each is a decision about a LAPTOP that the operator made on 10/09/2026 once
    # the machine turned out to have a battery - the first version guessed and guessed one of them
    # wrong.
    #
    # WakeToRun ON: he leaves it suspended and plugged in, so the machine wakes itself at $At. It
    # cannot help from a full shutdown - nothing in Windows can - and that is a firmware question
    # (RTC wake), not this script's.
    #
    # StartWhenAvailable OFF, which is the one that looks helpful and is not: it makes a missed night
    # run AT THE NEXT BOOT, i.e. five hours of scraping starting exactly while he sits down to work.
    # A missed night costs nothing because every step is resumable, so the right answer to a machine
    # that was off is to wait for the next one.
    #
    # Batteries: it does NOT start on battery (five hours of downloading would drain it) and does not
    # stop if it goes onto battery mid-run, because abandoning halfway wastes what was already paid
    # for and the next night resumes anyway.
    $settings = New-ScheduledTaskSettingsSet -WakeToRun `
        -ExecutionTimeLimit (New-TimeSpan -Hours $MaxHours) `
        -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries:$false `
        -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Settings $settings -Description 'euroleghe-ingest: the full update, nightly' -Force | Out-Null
    Write-Host "registrata: '$taskName' ogni giorno alle $At, limite $MaxHours ore"
    Write-Host "  log in $logDir\nightly-<data>.log"
    exit 0
}

if ($Unregister) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "rimossa: '$taskName'"
    exit 0
}

if ($Status) {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if (-not $task) { Write-Host "nessuna attivita' '$taskName' registrata"; exit 0 }
    $info = Get-ScheduledTaskInfo -TaskName $taskName
    Write-Host ("attivita': {0} | ultima {1} | esito {2} | prossima {3}" -f `
            $task.State, $info.LastRunTime, $info.LastTaskResult, $info.NextRunTime)
    # THE TASK'S STATE AND THE DECLARATION ARE TWO DIFFERENT FACTS, so both are printed: a task that
    # is «Ready» while the switch says off would otherwise read as «it will run tonight».
    $switch = Join-Path $repo 'config\nightly.json'
    if (Test-Path $switch) {
        $declared = Get-Content $switch -Raw | ConvertFrom-Json
        Write-Host ("dichiarato: {0}{1}" -f `
            $(if ($declared.enabled) { 'ACCESO' } else { 'SPENTO' }),
            $(if ($declared.decided_on) { " dal $($declared.decided_on)" } else { "" }))
    }
    else {
        Write-Host "dichiarato: ACCESO (nessun config/nightly.json: il default e' acceso)"
    }
    $logs = @(Get-ChildItem $logDir -Filter 'nightly-*.log' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 5)
    # The LAST LINE of each log, because that is where `update` puts its own verdict ("N/M steps
    # done"): a task that says «0x0» and a log that says «2/31» are two different runs to look at.
    foreach ($one in $logs) {
        $tail = (Get-Content $one.FullName -Tail 3 | Where-Object { $_ -match 'steps done|abandon' })
        Write-Host ("  {0}  {1}" -f $one.Name, ($tail -join ' | '))
    }
    exit 0
}

# ---------------------------------------------------------------- the run itself
Assert-Toolkit
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("nightly-{0}.log" -f (Get-Date).ToString('yyyy-MM-dd'))

# THE LOCK IS ASKED OF THE DATABASE, not of the process table: what stops a nightly run is somebody
# holding the write lock, and who that is does not change the answer. Rolled back immediately - the
# check must not become the collision it is testing for.
$probe = & $python -c @"
import sqlite3, sys
from euroleghe_ingest.config import Config
try:
    conn = sqlite3.connect(Config().db_path, timeout=2)
    conn.execute('BEGIN IMMEDIATE')
    conn.rollback()
    conn.close()
except Exception as exc:
    sys.stdout.write(f'locked: {exc}')
"@ 2>&1
# THE SWITCH IS A DECLARATION, not a property of the scheduler (operator, 10/09/2026: «permettimi di
# attivare/disattivare il check notturno»). It lives in `config/nightly.json` and has the shape of the
# other three declared files - `board_rulings.json`, `player_notes.json`, `player_rulings.json`:
# dated, revocable, and read rather than inferred.
#
# WHY A FILE AND NOT `Disable-ScheduledTask`. Disabling the task would work and would be invisible:
# the run simply never happens, the morning file stops being written, and «spento apposta» reads
# exactly like «il task e' rotto» - the silent-zero defect this project keeps paying for. Read from a
# file, the run still happens, still writes the morning picture, and SAYS why it did nothing. It also
# makes the switch writable by anything that can write a file, which is what any future toggle - the
# panel, a local companion - will need; the scheduler API is not reachable from a browser and never
# will be.
#
# A MISSING FILE MEANS ON, and that is the safe direction: a machine that has never been told
# anything should keep its data fresh, and the alternative («no file, no run») would silently stop
# the acquisition on any clone.
$switch = Join-Path $repo 'config\nightly.json'
$enabled = $true
$decided = $null
if (Test-Path $switch) {
    try {
        $declared = Get-Content $switch -Raw | ConvertFrom-Json
        if ($null -ne $declared.enabled) { $enabled = [bool]$declared.enabled }
        $decided = $declared.decided_on
    }
    catch {
        # A DECLARATION THAT CANNOT BE READ IS NOT A DECLARATION TO OBEY: an unparseable file is a
        # typo, and reading a typo as «off» would stop the acquisition on the strength of a broken
        # brace. It says so and carries on.
        Add-Content -Path $log -Value ("=== {0} config/nightly.json illeggibile ({1}) - proseguo come ACCESO ===" -f `
            (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $_.Exception.Message)
    }
}

# ...AND THE LOCK PROBE IS NOT ENOUGH ON ITS OWN, which was found the evening this was written: a long
# acquisition writes in BATCHES, so between two of them the database is free and the probe says «go».
# The instrument that sees it is the command line - measured on the spot, with an `injuries` walk of
# mine and a `recent_form` of another session both running while `BEGIN IMMEDIATE` succeeded. Two
# acquisitions on one DB is what `retry_on_lock` exists to survive, not something to schedule.
#
# `gui` is deliberately NOT a reason to skip: a panel left open overnight is not an acquisition, and
# blocking on it would cost every night to somebody who forgot to close a window. The limit is stated
# rather than hidden - an acquisition STARTED FROM the panel may run inside that process and be
# invisible here, and that case is what `db.database.retry_on_lock` is for.
$busy = @(Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match 'euroleghe_ingest' -and
        $_.CommandLine -notmatch 'euroleghe_ingest\s+gui' })

$code = 0
if (-not $enabled) {
    $line = "=== {0} SPENTO per tua decisione{1} (config/nightly.json) ===" -f `
        (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $(if ($decided) { " dal $decided" } else { "" })
    Add-Content -Path $log -Value $line
    Write-Host $line
}
elseif ($busy) {
    $what = ($busy | ForEach-Object {
            ($_.CommandLine -split 'euroleghe_ingest')[-1].Trim() } | Select-Object -Unique) -join ', '
    $line = "=== {0} SKIPPED: an acquisition is already running ({1}) ===" -f `
        (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $what
    Add-Content -Path $log -Value $line
    Write-Host $line
}
elseif ($probe -match 'locked') {
    $line = "=== {0} SKIPPED: another session owns the DB ({1}) ===" -f `
        (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $probe
    Add-Content -Path $log -Value $line
    Write-Host $line
    # NOT an error, and NOT an early exit either. It is not an error because a night skipped while the
    # operator was working is the guard doing its job, and a non-zero code would fill the scheduler's
    # history with red for a correct decision. It is not an exit because the morning still wants its
    # picture: a skipped night is precisely the morning on which «how old is everything» matters, and
    # a report that goes quiet when nothing ran is a report that hides the state it exists to show.
}
else {
    $stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    Add-Content -Path $log -Value "=== $stamp update (full) ==="
    Push-Location (Join-Path $repo 'toolkit')
    try {
        & $python -m euroleghe_ingest update 2>&1 | Tee-Object -FilePath $log -Append
        $code = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }
}
Add-Content -Path $log -Value ("=== exit {0} at {1} ===" -f $code, (Get-Date).ToString('HH:mm:ss'))

# ---------------------------------------------------------------- the morning's picture
#
# ONE FILE TO OPEN, because the alternative is what it replaced: a morning spent reading logs by hand
# to find that ClubElo's API had been answering 502 since January, that the Serie A listone was three
# days old while the euro one was of that morning, and that the injury archive had reached its weekly
# cadence. All three are FRESHNESS - «when did we last look» - and none of them needs judgement: they
# need somebody to ask. `fetch --stale` is that reader, and this is where the asking happens.
#
# It runs even when the update FAILED, and that is the point rather than an oversight: a night that
# died halfway is exactly the night whose picture is worth having, and a report that only prints after
# a success would go quiet in the one case it exists for.
$morning = Join-Path $logDir 'morning.txt'
# WHAT COUNTS AS THE NIGHT'S VERDICT, and the list is longer than the obvious one: a run that did
# nothing has as many ways of saying so as a run that worked. «SPENTO» and «illeggibile» were added
# after the filter was written without them - the second one is the worse omission, because a switch
# file with a typo is read as ON and would have left no trace in the one page read in the morning.
$verdict = @(Get-Content $log -Tail 60 |
    Where-Object { $_ -match 'steps done|abandoning|SKIPPED|SPENTO|illeggibile|=== exit' })
Set-Content -Path $morning -Value ("=== la notte del {0} ===" -f (Get-Date).ToString('yyyy-MM-dd'))
Add-Content -Path $morning -Value $verdict
Add-Content -Path $morning -Value ''
Push-Location (Join-Path $repo 'toolkit')
try {
    # Read-only on the DB, so it costs nothing and cannot damage what the run just wrote.
    & $python -m euroleghe_ingest fetch --stale 2>&1 | Tee-Object -FilePath $morning -Append |
        Tee-Object -FilePath $log -Append | Out-Null
}
finally {
    Pop-Location
}
Write-Host "il quadro del mattino: $morning"

# Keep two weeks and say what was dropped: a log directory that silently trims is one nobody can use
# to see how long a source has been refusing.
$old = @(Get-ChildItem $logDir -Filter 'nightly-*.log' | Sort-Object Name -Descending |
    Select-Object -Skip $keepLogs)
if ($old) {
    $old | Remove-Item -Force
    Write-Host ("log ruotati: {0} rimossi, {1} tenuti" -f $old.Count, $keepLogs)
}
exit $code
