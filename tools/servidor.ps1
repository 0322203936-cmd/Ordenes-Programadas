# Keeps Órdenes Automáticas running on the server PC and up to date with GitHub (started by the
# scheduled task "Ordenes Servidor", see tools/instalar_arranque.ps1):
#   * starts node server.mjs and starts it again if it stops
#   * every 2 minutes looks at GitHub (master); when the CODE changed: git pull, npm install if the
#     libraries changed, restart. Commits that only touch orders.json / execution-log.json (made by
#     "Ejecutar órdenes" and the POSCO workflow) are left to the app itself, so a running execution is never cut.
#   * data\.apagar (tools/apagar.ps1) stops the server and this loop
# Logs: logs\servidor.log (this loop), logs\server.out.log / server.err.log (the server)
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$Branch = 'master'
$Logs = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force $Logs, (Join-Path $Root 'data') | Out-Null
$LoopLog = Join-Path $Logs 'servidor.log'
$StopAll = Join-Path $Root 'data\.apagar'
$CheckEvery = 120

function Log($msg) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg" | Add-Content -Path $LoopLog -Encoding utf8 }

# only one copy of this loop
$mutex = New-Object System.Threading.Mutex($false, 'Global\OrdenesServidor')
if (-not $mutex.WaitOne(0)) { exit 0 }

$node = (Get-Command node -ErrorAction Stop).Source
$npm = Join-Path (Split-Path $node) 'npm.cmd'

function Start-App {
  foreach ($f in 'server.out.log', 'server.err.log') {
    $p = Join-Path $Logs $f
    if (Test-Path $p) { Move-Item $p "$p.anterior" -Force }
  }
  $proc = Start-Process -FilePath $node -ArgumentList 'server.mjs' -WorkingDirectory $Root `
    -RedirectStandardOutput (Join-Path $Logs 'server.out.log') -RedirectStandardError (Join-Path $Logs 'server.err.log') `
    -WindowStyle Hidden -PassThru
  Log "Sistema prendido (proceso $($proc.Id), versión $(git rev-parse --short HEAD))"
  return $proc
}

function Stop-App($proc) {
  if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
}

Remove-Item $StopAll -ErrorAction SilentlyContinue
Log 'Arranque'
$app = Start-App
$nextCheck = (Get-Date).AddSeconds(30)
while ($true) {
  Start-Sleep -Seconds 2
  if (Test-Path $StopAll) {
    Remove-Item $StopAll -ErrorAction SilentlyContinue
    Log 'Apagado pedido'
    Stop-App $app
    break
  }
  if ($app.HasExited) {
    Log "El sistema se detuvo (código $($app.ExitCode)); se vuelve a prender en 5 s"
    Start-Sleep -Seconds 5
    $app = Start-App
  }
  if ((Get-Date) -ge $nextCheck) {
    $nextCheck = (Get-Date).AddSeconds($CheckEvery)
    git fetch -q origin $Branch 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { continue }
    $changed = @(git diff --name-only HEAD "origin/$Branch")
    $code = @($changed | Where-Object { $_ -and $_ -notin @('orders.json', 'execution-log.json') })
    if ($code.Count -gt 0 -and (git rev-list --count "HEAD..origin/$Branch") -gt 0) {
      Log "Actualización encontrada: $(git log --oneline -1 "origin/$Branch")"
      Stop-App $app
      $out = git pull --rebase -q origin $Branch 2>&1
      if ($LASTEXITCODE -ne 0) { Log "git pull falló: $out" }
      elseif ($code -match '^package(-lock)?\.json$') {
        Log 'Librerías nuevas: npm install'
        & $npm install --no-audit --no-fund 2>&1 | Out-Null
      }
      $app = Start-App
    }
  }
}
$mutex.ReleaseMutex()
