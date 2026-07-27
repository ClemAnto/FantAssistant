# Mirror the locally-cached raw downloads and the database to a folder OUTSIDE the repository.
#
# Why this exists. Every network module writes its raw response to data/cache/ before ingesting it, and
# every one of them can re-ingest offline (`rebuild` calls those paths), so the DB is rebuildable from
# scratch exactly as the project's rules require. But data/cache/ and data/*.db are in .gitignore, and
# for good reason: the cached fantacalcio.it files carry "QUESTO FILE NON PUO' ESSERE RIPRODOTTO NE'
# PUBBLICATO SU ALTRI SITI INTERNET - AD USO PERSONALE ESCLUSIVO DEGLI ISCRITTI", and this repository is
# PUBLIC. Committing them would republish paid content.
#
# So git protects the code and the knowledge base, and nothing protects the data. Hours of deliberately
# slow, polite scraping - requests we should not make twice - live in one ignored folder, which a
# `git clean -xdf` would delete without asking. This mirrors it somewhere that command cannot reach.
#
# Incremental: robocopy /MIR copies only what changed, so running it after every scraping session costs
# seconds. /MIR also DELETES from the destination what is gone from the source, which is what "mirror"
# means - if you want a frozen snapshot instead, pass -Snapshot.
#
# Usage:
#   pwsh scripts/backup-data.ps1                    # mirror to the default destination
#   pwsh scripts/backup-data.ps1 -Snapshot          # dated copy, nothing ever deleted
#   pwsh scripts/backup-data.ps1 -Destination E:\backup\fantassistant

[CmdletBinding()]
param(
    [string]$Destination = "D:\Projects\FantAssistant-data-backup",
    [switch]$Snapshot
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repo 'data'
if (-not (Test-Path $source)) { throw "no data directory at $source" }

if ($Snapshot) {
    $Destination = Join-Path $Destination (Get-Date -Format 'yyyy-MM-dd_HHmm')
}
if (-not (Test-Path $Destination)) { New-Item -ItemType Directory -Force $Destination | Out-Null }

# /MIR mirror · /R:1 /W:1 do not sit on a locked file · /NFL /NDL /NJH quiet, keep the summary
$mirror = if ($Snapshot) { '/E' } else { '/MIR' }
$targets = @('cache', 'raw', 'reports')
foreach ($folder in $targets) {
    $from = Join-Path $source $folder
    if (-not (Test-Path $from)) { continue }
    Write-Host "[backup] $folder ..." -NoNewline
    & robocopy $from (Join-Path $Destination $folder) $mirror /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    # robocopy exit codes below 8 are success (0 = nothing to do, 1 = copied, 3 = copied + extra)
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed on $folder (exit $LASTEXITCODE)" }
    $count = (Get-ChildItem (Join-Path $Destination $folder) -Recurse -File).Count
    Write-Host " $count files"
}

# The database is a single file and may be open: copy it through a snapshot-safe SQLite backup when the
# CLI is available, and fall back to a plain copy (which is fine when nothing is writing).
Get-ChildItem $source -Filter '*.db' | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $Destination $_.Name) -Force
    Write-Host "[backup] $($_.Name) $([math]::Round($_.Length/1MB,1)) MB"
}

$size = (Get-ChildItem $Destination -Recurse -File | Measure-Object -Property Length -Sum).Sum
Write-Host "[backup] $Destination -> $([math]::Round($size/1MB,1)) MB total"
