# Stops Órdenes Automáticas. To turn it on again:
#   Start-ScheduledTask -TaskName 'Ordenes Servidor'   (or restart the PC)
$Root = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force (Join-Path $Root 'data') | Out-Null
New-Item -ItemType File -Force (Join-Path $Root 'data\.apagar') | Out-Null
Write-Host ' Apagando Órdenes Automáticas...'
