# language: PowerShell, file: export-e2e-env.ps1, target: Windows
# Le o log do e2e-seed e emite linhas `set "K=V"` para o cmd consumir via for /f.
# Motivo: env definido dentro de um filho powershell NAO volta ao processo cmd pai;
# o padrao for/f executa cada linha `set` no proprio cmd, atualizando o ambiente.
param([string]$SeedLog = "C:\temp\seed.log")

$ErrorActionPreference = "Stop"
if (-not (Test-Path $SeedLog)) { exit 1 }
$raw = Get-Content $SeedLog -Raw
$start = $raw.IndexOf("{")
$end = $raw.LastIndexOf("}")
if ($start -lt 0 -or $end -le $start) { exit 1 }
$json = $raw.Substring($start, $end - $start + 1) | ConvertFrom-Json

# Fixos do fluxo E2E (mesmos valores usados pelos wrappers).
$extras = [ordered]@{
  E2E_READY      = "1"
  E2E_API_URL    = "http://localhost:4000"
  E2E_ADMIN_URL  = "http://localhost:3001"
}
foreach ($e in $extras.GetEnumerator()) {
  Write-Output ('set "' + $e.Key + '=' + $e.Value + '"')
}
foreach ($p in $json.PSObject.Properties) {
  Write-Output ('set "' + $p.Name + '=' + [string]$p.Value + '"')
}
exit 0
