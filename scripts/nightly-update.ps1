# The NIGHTLY acquisition: `update` in full, on a machine nobody is using - in SLICES of two hours at most.
#
# WHY A SCHEDULED TASK AND NOT AN AGENT (operator's question, 10/09/2026: «possiamo creare un agente
# che aggiorni questi dati la notte?»). The work is deterministic and the judgement is already inside
# `update`: one ordered plan derived from `bootstrap`, every step resumable, a cache that is not paid
# for twice, and the rule that a sweep which starts getting refused is abandoned instead of ground
# against a closed door (17/08/2026). What was actually missing is a RUNNER that outlives the session
# that started it. And it cannot be a CLOUD agent: the acquisition needs `data/`, the cache and the
# credentials in `.env`, which live on this machine and on no runner.
#
# WHY SLICES (operator, 27/10/2026: «5 ore sono troppe, dobbiamo suddividere in più step da max un paio
# d'ore il lavoro»). The night used to be ONE task with a five-hour limit, and three things went wrong
# with it, all measured on the night of 27/10:
#   - one long source ate the window of every source after it: Transfermarkt alone took 02:24-06:55,
#     the sheets were reached at 07:00 and cut off, and on the 26th the injury walk (2h16) kept the
#     market curve and the per-match layer from running at all;
#   - the limit killed PowerShell and NOT the Python child under it, which went on writing into a pipe
#     nobody was reading and died on `OSError: [Errno 22]` - every nightly row of `ingest_runs` since
#     09/10 says exactly that - while still holding the database;
#   - so the morning build met `database is locked` and the deliverable was not produced.
# Now every slice is its own scheduled task with its own hard limit, and the limit is enforced HERE
# (the whole process tree is killed with `taskkill /T`), so a slice that overruns costs its own window
# and nothing else, and the build always gets one. Every step is resumable, so what a slice does not
# finish tonight is picked up tomorrow.
#
# THE SLICES ARE SIZED ON THE NIGHT OF 27/10 (reconstructed from the cache's mtimes, local time):
# ratings, positions, transfers, fixtures 02:00-02:50 · injuries:ids 02:50-03:53 · injuries ~30 min
# (2h16 on the 26th) · market 04:25-05:38 · performance 05:38-06:55 · build ~45 min. `update` now
# prints the clock and the minutes of every step, so the next resizing reads the log instead.
#
# ONE SESSION OWNS THE DB. A slice refuses to start when somebody holds the write lock or an
# acquisition is already running, and says so in the log.
#
# Usage:
#   pwsh scripts/nightly-update.ps1 -Slice base   # run one slice now, exactly as its task would
#   pwsh scripts/nightly-update.ps1 -Archives     # the archive slot: what is due tonight, catch-up included
#   pwsh scripts/nightly-update.ps1               # run every slice in order (each with its limit)
#   pwsh scripts/nightly-update.ps1 -Register     # create/replace the scheduled tasks
#   pwsh scripts/nightly-update.ps1 -Unregister   # remove them
#   pwsh scripts/nightly-update.ps1 -Status       # what the tasks are, and what the last nights did

[CmdletBinding()]
param(
    [switch]$Register,
    [switch]$Unregister,
    [switch]$Status,
    # One slice by name (see $Slices). Without it, every slice runs in order.
    [string]$Slice,
    # The archive slot: whatever archive slice is DUE tonight, its own day or a catch-up.
    [switch]$Archives
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$python = Join-Path $repo 'toolkit\.venv\Scripts\python.exe'
$logDir = Join-Path $repo 'data\logs'
$taskPrefix = 'FantAssistant nightly'
# The names the night had before the slices: `-Register` and `-Unregister` remove them, because a
# renamed task left behind keeps running while no command of this script names it any more.
$legacyTasks = @('FantAssistant nightly update', 'FantAssistant morning build', 'FantAssistant morning picture')
# Two weeks of logs: enough to see a source that has been refusing for days.
$keepLogs = 14

# THE SLICES, grouped by CADENCE (operator, 27/10/2026: «vedi cio' che serve aggiornare piu' spesso da
# quello che serve aggiornare meno spesso ... qualcosa magari possiamo aggiornarla ogni 15gg»).
# `Minutes` is the HARD limit, nothing above 120. `Days` empty = every night; `Weeks` 2 = every other
# week. The question asked of every step is «when does its fact CHANGE»:
#   - EVERY NIGHT: the votes and the listone (a round is voted the morning after it ends, the FVM moves
#     every week), today's squads and roles, the calendar, the Elo, the probabili/indisponibili, and
#     the SofaScore per-match layer, which only fetches the rounds it has not got.
#   - THE MORNINGS AFTER A ROUND (Mon, Tue, Fri): Transfermarkt's per-match layer, which is the
#     backup of SofaScore since 24/09 (the trend, the matchday map) - re-read for everybody, so it is
#     paid only when there is something new: Sunday's matches on Monday, Monday's on Tuesday, a
#     midweek round on Friday, all before a lineup is handed in.
#   - SATURDAY AND SUNDAY: the coaches and transfers (a sacking lands before the lineup), cups and
#     friendlies, and the injury ARCHIVE in two halves - today's absences are `fc_site`, every night.
#   - EVERY OTHER WEEK: the squad pages and contracts (squads change in the windows), the value curve,
#     badges, tournaments, the heatmap gaps, the recent form of men with no history.
# A test (`test_nightly_slices.py`) holds the one property a list like this can lose in silence: every
# acquisition step of the plan is in EXACTLY one slice.
$Slices = @(
    [pscustomobject]@{ Name = 'base'; Minutes = 75; At = '00:30'; Days = @(); Weeks = 1
        Why  = 'ogni notte: voti e listone, rose e ruoli SofaScore, calendario, Elo, probabili'
        Args = @('--step', 'inbox', '--step', 'rosters', '--step', 'stats', '--step', 'ratings:default',
            '--step', 'ratings:euro', '--step', 'positions:season', '--step', 'positions:roles',
            '--step', 'elo', '--step', 'fixtures', '--step', 'fc_site', '--step', 'positions:match',
            '--step', 'positions:complete') },
    [pscustomobject]@{ Name = 'presenze'; Minutes = 90; At = '01:45'; Days = @('Monday', 'Tuesday', 'Friday'); Weeks = 1
        Why  = 'dopo le giornate: le partite giocate da Transfermarkt (il ripiego di SofaScore)'
        Args = @('--step', 'performance') },
    [pscustomobject]@{ Name = 'infortuni'; Minutes = 120; At = '01:45'; Days = @('Saturday', 'Sunday'); Weeks = 1
        Why  = 'nel weekend: allenatori e trasferimenti, coppe e amichevoli, archivio infortuni'
        Args = @('--step', 'transfers', '--step', 'positions:extra', '--step', 'injuries') },
    [pscustomobject]@{ Name = 'rose'; Minutes = 120; At = '01:45'; Days = @('Wednesday'); Weeks = 2
        Why  = 'ogni 15 giorni: rose e contratti Transfermarkt, stemmi, tornei, heatmap, forma recente'
        Args = @('--step', 'positions:crests', '--step', 'tournaments', '--step', 'positions:heatmap',
            '--step', 'injuries:ids', '--step', 'recent_form') },
    [pscustomobject]@{ Name = 'valori'; Minutes = 90; At = '01:45'; Days = @('Thursday'); Weeks = 2
        Why  = 'ogni 15 giorni: la curva del valore di mercato (dopo le rose del giorno prima)'
        Args = @('--step', 'market') },
    # THE BUILD IS A SLICE OF ITS OWN, every night and after the longest second slot: derivation, the
    # sheets, the packs, the bundle and the app's copy, on whatever the acquisition brought - more
    # recent than yesterday anyway, and the manifest carries its own date.
    [pscustomobject]@{ Name = 'build'; Minutes = 75; At = '03:45'; Days = @(); Weeks = 1
        Why  = 'ogni notte: derivazione, fogli, pacchetti, bundle, copia nell app, quadro del mattino'
        Args = @('--phase', 'derive', '--phase', 'sheets', '--phase', 'packs', '--phase', 'bundle',
            '--phase', 'app') }
)

function Assert-Toolkit {
    if (-not (Test-Path $python)) {
        throw "python not found at $python - create the venv first (toolkit/.venv)"
    }
}

# THE NIGHT'S LOG is named after the MORNING it belongs to, not after the clock of each slice: a night
# that starts before midnight would otherwise be split over two files, and the morning picture reads
# one. Six hours forward files a slice started after 18:00 under the next day.
function Get-NightLog {
    Join-Path $logDir ("nightly-{0}.log" -f (Get-Date).AddHours(6).ToString('yyyy-MM-dd'))
}

function Write-Log {
    param([string]$log, [string]$line)
    Add-Content -Path $log -Value $line -Encoding utf8
    Write-Host $line
}

# ---------------------------------------------------------------- the morning's picture
#
# ONE FILE TO OPEN in the morning: the verdict of every slice plus `fetch --stale` («when did we last
# look»). It is written by the build slice, which runs even when an acquisition slice was cut off or
# skipped - a night that went wrong is exactly the night whose picture is worth having.
function Write-Morning {
    param([string]$log)
    $morning = Join-Path $logDir 'morning.txt'
    # WHAT COUNTS AS THE NIGHT'S VERDICT: a run that did nothing has as many ways of saying so as a
    # run that worked, and a switch file with a typo is read as ON and must still leave a trace here.
    $verdict = @(Get-Content $log -ErrorAction SilentlyContinue |
        Where-Object { $_ -match 'steps done|abandoning|SKIPPED|SPENTO|illeggibile|TAGLIATA|RINVIATA|riprendo il giro|=== archivi:|=== .*: exit' })
    Set-Content -Path $morning -Value ("=== la notte del {0} ===" -f (Get-Date).ToString('yyyy-MM-dd')) -Encoding utf8
    Add-Content -Path $morning -Value $verdict -Encoding utf8
    Add-Content -Path $morning -Value '' -Encoding utf8
    Push-Location (Join-Path $repo 'toolkit')
    try {
        # Read-only on the DB, so it costs nothing and cannot damage what the night just wrote.
        & $python -m euroleghe_ingest fetch --stale 2>&1 | Tee-Object -FilePath $morning -Append |
            Tee-Object -FilePath $log -Append | Out-Null
    }
    finally {
        Pop-Location
    }
    Write-Host "il quadro del mattino: $morning"
}

# ---------------------------------------------------------------- one slice
#
# THE LIMIT IS ENFORCED HERE AND ON THE WHOLE TREE. Task Scheduler's own limit kills only this
# PowerShell, and the Python under it survived every night it was used - holding the DB. The update
# runs under `cmd /c` with its output appended straight to the log (no pipe that can die under it),
# and on timeout `taskkill /T /F` takes cmd and Python together.
function Invoke-Slice {
    # `$Minutes` lowers the slice's own limit when it runs inside the archive slot with less time left.
    param($one, [string]$log, [int]$Minutes = 0)
    $limit = if ($Minutes -gt 0) { [math]::Min($Minutes, $one.Minutes) } else { $one.Minutes }
    $started = Get-Date
    Write-Log $log ("=== {0} {1} ({2}, limite {3} min) ===" -f $started.ToString('yyyy-MM-dd HH:mm:ss'),
        $one.Name, $one.Why, $limit)

    # THE SWITCH IS A DECLARATION, not a property of the scheduler (operator, 10/09/2026: «permettimi
    # di attivare/disattivare il check notturno»). It lives in `config/nightly.json`, read rather than
    # inferred, and a run that obeys it still SAYS why it did nothing - «spento apposta» must not read
    # like «il task e' rotto». A MISSING FILE MEANS ON: a machine never told anything keeps its data
    # fresh.
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
            # A DECLARATION THAT CANNOT BE READ IS NOT A DECLARATION TO OBEY: a broken brace must not
            # stop the acquisition, and must not pass unnoticed either.
            Write-Log $log ("=== {0} config/nightly.json illeggibile ({1}) - proseguo come ACCESO ===" -f `
                (Get-Date).ToString('HH:mm:ss'), $_.Exception.Message)
        }
    }
    if (-not $enabled) {
        Write-Log $log ("=== {0}: SPENTO per tua decisione{1} (config/nightly.json) ===" -f `
            $one.Name, $(if ($decided) { " dal $decided" } else { "" }))
        return 0
    }

    # TWO GUARDS, because one is not enough: a long acquisition writes in BATCHES, so between two of
    # them the lock probe says «go» (measured 10/09/2026). The command line sees it. `gui` is not a
    # reason to skip - a panel left open overnight is not an acquisition.
    $busy = @(Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -match 'euroleghe_ingest' -and
            $_.CommandLine -notmatch 'euroleghe_ingest\s+gui' })
    if ($busy) {
        $what = ($busy | ForEach-Object {
                ($_.CommandLine -split 'euroleghe_ingest')[-1].Trim() } | Select-Object -Unique) -join ', '
        Write-Log $log ("=== {0}: SKIPPED, an acquisition is already running ({1}) ===" -f $one.Name, $what)
        return 0
    }
    # The lock is asked of the DATABASE, rolled back at once: the check must not become the collision.
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
    if ($probe -match 'locked') {
        # NOT an error: a night skipped while the operator was working is the guard doing its job.
        Write-Log $log ("=== {0}: SKIPPED, another session owns the DB ({1}) ===" -f $one.Name, $probe)
        return 0
    }

    # UTF-8 on the way out, or every «·» of `update` lands in the log as «À».
    $env:PYTHONIOENCODING = 'utf-8'
    # ...and UNBUFFERED: written to a file, Python holds its output in blocks, so a slice killed at its
    # limit lost exactly the last lines - the ones that say how far it got (seen on `transfers`, whose
    # log stayed silent for ten minutes of work).
    $env:PYTHONUNBUFFERED = '1'
    $line = "`"$python`" -m euroleghe_ingest update $($one.Args -join ' ') >> `"$log`" 2>&1"
    $proc = Start-Process -FilePath 'cmd.exe' -ArgumentList '/d', '/s', '/c', "`"$line`"" `
        -WorkingDirectory (Join-Path $repo 'toolkit') -WindowStyle Hidden -PassThru
    $null = $proc.Handle   # cache the handle, or ExitCode reads null after the wait
    if ($proc.WaitForExit($limit * 60 * 1000)) {
        $code = $proc.ExitCode
        $minutes = [math]::Round(((Get-Date) - $started).TotalMinutes)
        Write-Log $log ("=== {0}: exit {1} alle {2} ({3} min) ===" -f $one.Name, $code,
            (Get-Date).ToString('HH:mm:ss'), $minutes)
        return $code
    }
    & taskkill.exe /PID $proc.Id /T /F 2>&1 | Out-Null
    $proc.WaitForExit(30 * 1000) | Out-Null
    # TAGLIATA and not an error: every step resumes its own cycle (`update.begin_step`), and the
    # archive slot puts an unfinished slice back on the next night.
    Write-Log $log ("=== {0}: TAGLIATA al limite di {1} min alle {2} - riprende la prossima notte da dove e' arrivata ===" -f `
        $one.Name, $limit, (Get-Date).ToString('HH:mm:ss'))
    return 0
}

# WHEN a slice is scheduled, in the operator's words - read by -Register and -Status.
function Get-SliceWhen {
    param($one)
    $it = @{ Monday = 'lun'; Tuesday = 'mar'; Wednesday = 'mer'; Thursday = 'gio'; Friday = 'ven';
        Saturday = 'sab'; Sunday = 'dom' }
    if (-not $one.Days -or $one.Days.Count -eq 0) { return "ogni notte alle $($one.At)" }
    $days = ($one.Days | ForEach-Object { $it[$_] }) -join ' '
    if ($one.Weeks -gt 1) { return "$days ogni $($one.Weeks) settimane alle $($one.At)" }
    "$days alle $($one.At)"
}

# ---------------------------------------------------------------- the archive slot, and the catch-up
#
# A SLICE THAT DID NOT FINISH COMES BACK THE NEXT NIGHT (operator, 27/10/2026: «quando un'operazione per
# qualche motivo si interrompe a meta' possa essere ripresa successivamente, anche il giorno dopo per
# recuperare»). The four archive slices do not have a task each: they share ONE slot, every night at
# 01:45, and the slot decides what is DUE - a slice is due when its last scheduled day has come and not
# every one of its steps has completed since. So the slice of its day runs, and so does one that was cut
# at its limit, crashed, or met a machine that was off - the night after, not fifteen days after.
# TONIGHT'S OWN SLICE GOES FIRST, then the debts oldest first, within the slot's two hours: a debt
# that keeps running long must not starve the per-match layer of the morning after a round, and what a
# debt does not finish it resumes the next night. What does not fit is postponed, and says so.
#
# «COMPLETED» IS NOT DECIDED HERE: `update` writes, per step, when its cycle began and when it
# completed (`data/cache/update-state.json`), and it is the same record that makes a resumed step skip
# the pages it already read. One record, two readers.
$archiveSlot = [pscustomobject]@{ Name = 'archivi'; Minutes = 120; At = '01:45' }
# The week the every-other-week slices count from: a Monday, so «week 0» is the one of 28/10/2026.
$biweeklyAnchor = [datetime]'2026-10-26'

function Get-StepState {
    $path = Join-Path $repo 'data\cache\update-state.json'
    if (-not (Test-Path $path)) { return @{} }
    # `-DateKind String`: left to itself ConvertFrom-Json turns the ISO stamps into local DateTimes
    # and then nothing parses them back.
    try { (Get-Content $path -Raw | ConvertFrom-Json -AsHashtable -DateKind String).steps } catch { @{} }
}

function Get-SliceSteps {
    param($one)
    $out = @()
    for ($i = 0; $i -lt $one.Args.Count - 1; $i++) {
        if ($one.Args[$i] -eq '--step') { $out += $one.Args[$i + 1] }
    }
    $out
}

# The last day on or before $day this slice was SCHEDULED for.
function Get-LastOccurrence {
    param($one, [datetime]$day)
    for ($back = 0; $back -lt 21; $back++) {
        $d = $day.Date.AddDays(-$back)
        if ($one.Days -notcontains $d.DayOfWeek.ToString()) { continue }
        $week = [math]::Floor(($d - $biweeklyAnchor).TotalDays / 7)
        if ((($week % $one.Weeks) + $one.Weeks) % $one.Weeks -eq 0) { return $d }
    }
    $null
}

# Every step completed at or after $since? A step with no record has never completed.
function Test-SliceDone {
    param($one, [datetime]$since, $state)
    foreach ($key in Get-SliceSteps $one) {
        $done = $state[$key].completed_at
        if (-not $done) { return $false }
        if (([datetimeoffset]::Parse($done, [cultureinfo]::InvariantCulture)).LocalDateTime -lt $since) { return $false }
    }
    $true
}

function Get-DueSlices {
    param([datetime]$day)
    $state = Get-StepState
    $due = foreach ($one in $Slices | Where-Object { $_.Days -and $_.Days.Count -gt 0 }) {
        $since = Get-LastOccurrence $one $day
        if ($since -and -not (Test-SliceDone $one $since $state)) {
            [pscustomobject]@{ Slice = $one; Since = $since }
        }
    }
    @($due | Sort-Object @{ Expression = { if ($_.Since -eq $day.Date) { 0 } else { 1 } } }, Since)
}

function Invoke-Archives {
    param([string]$log)
    $started = Get-Date
    $due = Get-DueSlices (Get-Date)
    if (-not $due) {
        Write-Log $log ("=== archivi: niente di dovuto stanotte ({0}) ===" -f (Get-Date).ToString('HH:mm:ss'))
        return 0
    }
    Write-Log $log ("=== archivi: dovute {0} ===" -f (($due | ForEach-Object {
        "$($_.Slice.Name) (dal $($_.Since.ToString('dd/MM')))" }) -join ', '))
    $code = 0
    foreach ($item in $due) {
        $left = $archiveSlot.Minutes - [math]::Floor(((Get-Date) - $started).TotalMinutes)
        # Less than a quarter of an hour is not worth opening a walk for: it would only re-read the
        # pages a resumed cycle skips, and be cut. It waits for the next night, and says so.
        if ($left -lt 15) {
            Write-Log $log ("=== {0}: RINVIATA alla prossima notte, restano {1} min nella fascia ===" -f `
                $item.Slice.Name, $left)
            continue
        }
        $code = Invoke-Slice $item.Slice $log -Minutes $left
    }
    $code
}

if ($Register) {
    Assert-Toolkit
    $pwsh = (Get-Process -Id $PID).Path
    $script = Join-Path $PSScriptRoot 'nightly-update.ps1'
    foreach ($old in $legacyTasks) {
        Unregister-ScheduledTask -TaskName $old -Confirm:$false -ErrorAction SilentlyContinue
    }
    # THREE TASKS, every night: the base slice, the ARCHIVE SLOT (which decides on its own which archive
    # slice is due - its day, or a catch-up), and the build.
    $units = @(
        [pscustomobject]@{ Name = 'base'; Minutes = ($Slices | Where-Object Name -eq 'base').Minutes
            At = ($Slices | Where-Object Name -eq 'base').At; Arg = '-Slice base'
            Why = ($Slices | Where-Object Name -eq 'base').Why },
        [pscustomobject]@{ Name = $archiveSlot.Name; Minutes = $archiveSlot.Minutes; At = $archiveSlot.At
            Arg = '-Archives'; Why = 'ogni notte: la fetta d archivio del giorno, o quella rimasta a meta' },
        [pscustomobject]@{ Name = 'build'; Minutes = ($Slices | Where-Object Name -eq 'build').Minutes
            At = ($Slices | Where-Object Name -eq 'build').At; Arg = '-Slice build'
            Why = ($Slices | Where-Object Name -eq 'build').Why }
    )
    foreach ($one in $units) {
        $action = New-ScheduledTaskAction -Execute $pwsh `
            -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`" $($one.Arg)" -WorkingDirectory $repo
        # THREE SETTINGS, each a decision about a LAPTOP (operator, 10/09/2026). WakeToRun: he leaves
        # it suspended and plugged in. StartWhenAvailable OFF: a missed slice must not start at the next
        # boot, while he sits down to work - every step is resumable, so waiting costs nothing. Not on
        # battery, and not stopped if it goes onto battery halfway.
        # The scheduler's limit is a BACKSTOP ten minutes past the slice's own, which is the one that
        # kills the whole tree; the scheduler's would kill this script and leave Python behind.
        $settings = New-ScheduledTaskSettingsSet -WakeToRun `
            -ExecutionTimeLimit (New-TimeSpan -Minutes ($one.Minutes + 10)) `
            -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries:$false `
            -MultipleInstances IgnoreNew
        $name = "$taskPrefix - $($one.Name)"
        Register-ScheduledTask -TaskName $name -Action $action `
            -Trigger (New-ScheduledTaskTrigger -Daily -At $one.At) `
            -Settings $settings -Description "euroleghe-ingest, notte: $($one.Why)" -Force | Out-Null
        Write-Host ("registrata: '{0}' ogni notte alle {1}, limite {2} min" -f $name, $one.At, $one.Minutes)
    }
    foreach ($one in $Slices | Where-Object { $_.Days -and $_.Days.Count -gt 0 }) {
        Write-Host ("  nella fascia archivi: {0,-9} {1}" -f $one.Name, (Get-SliceWhen $one))
    }
    # A task that the table no longer declares must not keep running under its old name.
    $declared = $units | ForEach-Object { "$taskPrefix - $($_.Name)" }
    Get-ScheduledTask -TaskName "$taskPrefix - *" -ErrorAction SilentlyContinue |
        Where-Object { $declared -notcontains $_.TaskName } | ForEach-Object {
            Unregister-ScheduledTask -TaskName $_.TaskName -Confirm:$false
            Write-Host "rimossa: '$($_.TaskName)' (non e' piu' una fetta dichiarata)"
        }
    Write-Host "  log in $logDir\nightly-<data>.log, quadro del mattino in $logDir\morning.txt"
    exit 0
}

if ($Unregister) {
    Get-ScheduledTask -TaskName "$taskPrefix - *" -ErrorAction SilentlyContinue | ForEach-Object {
        Unregister-ScheduledTask -TaskName $_.TaskName -Confirm:$false
    }
    foreach ($old in $legacyTasks) {
        Unregister-ScheduledTask -TaskName $old -Confirm:$false -ErrorAction SilentlyContinue
    }
    Write-Host "rimosse le attivita' notturne"
    exit 0
}

if ($Status) {
    foreach ($unit in @('base', $archiveSlot.Name, 'build')) {
        $name = "$taskPrefix - $unit"
        $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
        if (-not $task) { Write-Host "  ${unit}: NON registrata"; continue }
        $info = Get-ScheduledTaskInfo -TaskName $name
        Write-Host ("  {0,-9} {1} | ultima {2} | esito {3} | prossima {4}" -f `
                $unit, $task.State, $info.LastRunTime, $info.LastTaskResult, $info.NextRunTime)
    }
    # WHAT THE ARCHIVE SLOT WOULD RUN TONIGHT, and why: its own day, or a slice left unfinished.
    $tonight = (Get-Date).AddHours(6)
    $due = Get-DueSlices $tonight
    Write-Host ("fascia archivi della prossima notte: {0}" -f $(if ($due) { ($due | ForEach-Object {
        "$($_.Slice.Name) (dovuta dal $($_.Since.ToString('dd/MM')))" }) -join ', ' } else { 'niente di dovuto' }))
    foreach ($old in $legacyTasks) {
        if (Get-ScheduledTask -TaskName $old -ErrorAction SilentlyContinue) {
            Write-Host "  ATTENZIONE: c'e' ancora la vecchia attivita' '$old' - rilancia -Register"
        }
    }
    # THE TASK'S STATE AND THE DECLARATION ARE TWO DIFFERENT FACTS, so both are printed.
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
        Sort-Object Name -Descending | Select-Object -First 3)
    foreach ($one in $logs) {
        Write-Host "  $($one.Name)"
        Get-Content $one.FullName | Where-Object { $_ -match '=== .*: (exit|TAGLIATA|SKIPPED|SPENTO)' } |
            ForEach-Object { Write-Host "    $_" }
    }
    exit 0
}

# ---------------------------------------------------------------- the run itself
Assert-Toolkit
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Get-NightLog

if ($Archives) {
    exit (Invoke-Archives $log)
}
$todo = if ($Slice) { @($Slices | Where-Object Name -eq $Slice) } else { $Slices }
if (-not $todo) {
    throw "slice sconosciuta '$Slice'; dichiarate: $(($Slices | ForEach-Object Name) -join ', ')"
}
$code = 0
foreach ($one in $todo) {
    $code = Invoke-Slice $one $log
}

if ($todo | Where-Object Name -eq 'build') {
    Write-Morning -log $log
    # Keep two weeks and say what was dropped: a log directory that silently trims is one nobody can
    # use to see how long a source has been refusing.
    $old = @(Get-ChildItem $logDir -Filter 'nightly-*.log' | Sort-Object Name -Descending |
        Select-Object -Skip $keepLogs)
    if ($old) {
        $old | Remove-Item -Force
        Write-Host ("log ruotati: {0} rimossi, {1} tenuti" -f $old.Count, $keepLogs)
    }
}
exit $code
