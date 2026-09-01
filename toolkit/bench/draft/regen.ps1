$waits = 5, 15, 30, 60, 120, 240
foreach ($w in $waits) {
  $out = & ../../.venv/Scripts/python.exe extract.py leghe-classic.json "Leghe" 2>&1
  if ($LASTEXITCODE -eq 0) { $out | Select-Object -Last 2; "OK"; exit 0 }
  "DB occupato, riprovo fra $w s"; Start-Sleep -Seconds $w
}
"FALLITO"; exit 1
