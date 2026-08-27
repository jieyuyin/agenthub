[CmdletBinding()]
param(
  [switch]$Build,
  [switch]$NoDesktop,
  [switch]$Stop
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker was not found. Install and start Docker Desktop first.'
}

if ($Stop) {
  docker compose --env-file .env.docker down
  exit $LASTEXITCODE
}

docker info *> $null
if ($LASTEXITCODE -ne 0) {
  throw 'Docker Desktop is not running or Docker Engine is unavailable.'
}

if (-not (Test-Path -LiteralPath '.env.docker')) {
  Copy-Item -LiteralPath '.env.docker.example' -Destination '.env.docker'
  Write-Host 'Created .env.docker. Configure the model provider in this file.' -ForegroundColor Yellow
}

$composeArgs = @('compose', '--env-file', '.env.docker', 'up', '-d')
if ($Build) { $composeArgs += '--build' }
& docker @composeArgs
if ($LASTEXITCODE -ne 0) { throw 'Failed to start AgentHub containers.' }

Write-Host 'Waiting for AgentHub API and Web...' -ForegroundColor Cyan
$deadline = (Get-Date).AddMinutes(5)
do {
  $apiReady = $false
  $webReady = $false
  try { $apiReady = (Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3003/api/health' -TimeoutSec 3).StatusCode -eq 200 } catch {}
  try { $webReady = (Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000' -TimeoutSec 3).StatusCode -eq 200 } catch {}
  if ($apiReady -and $webReady) { break }
  if ((Get-Date) -ge $deadline) {
    docker compose --env-file .env.docker ps
    throw 'Timed out waiting for AgentHub. Run docker compose logs for details.'
  }
  Start-Sleep -Seconds 2
} while ($true)

Write-Host 'AgentHub is ready: http://localhost:3000' -ForegroundColor Green
if ($NoDesktop) { exit 0 }

if (-not (Get-Command corepack -ErrorAction SilentlyContinue)) {
  throw 'Containers are ready, but Node.js/Corepack is required to start Electron.'
}
if (-not (Test-Path -LiteralPath 'node_modules')) {
  Write-Host 'Installing Electron host dependencies for the first run...' -ForegroundColor Cyan
  corepack pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw 'Failed to install Electron dependencies.' }
}

$env:AGENTHUB_WEB_URL = 'http://localhost:3000'
corepack pnpm --filter @agenthub/desktop start
