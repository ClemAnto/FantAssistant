# Riprova l'estrazione finche' il DB si libera: un'altra sessione puo' tenere il lock di scrittura, e
# il DB e' in journal_mode=delete, quindi un writer blocca anche i lettori. Attesa crescente, come
# `db.database.retry_on_lock` fa per i writer - stessa ragione, dall'altro lato.
$waits = 5, 15, 30, 60, 120, 240, 480
foreach ($w in $waits) {
  $out = & ../../.venv/Scripts/python.exe extract.py leghe-classic.json "Leghe" 2>&1
  if ($LASTEXITCODE -eq 0) { $out | Select-Object -Last 3; "ESTRAZIONE OK"; exit 0 }
  "DB occupato, riprovo fra $w secondi"
  Start-Sleep -Seconds $w
}
"NON RIUSCITO: il DB e' rimasto occupato"
exit 1
