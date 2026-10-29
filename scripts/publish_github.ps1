# Execute no PowerShell, após criar um repositório GitHub público e vazio.
param([Parameter(Mandatory=$true)][string]$RepoUrl)
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))
if (!(Test-Path '.git')) { git init; if ($LASTEXITCODE -ne 0) { throw 'git init falhou' } }
python scripts/check_repository.py
if ($LASTEXITCODE -ne 0) { throw 'Faltam arquivos essenciais; GitHub não será publicado' }
git add .
if ($LASTEXITCODE -ne 0) { throw 'git add falhou' }
Write-Host 'Confira os arquivos que serão publicados (NÃO inclua segredos):'
git status --short
$answer=Read-Host 'Você conferiu que não há credenciais e deseja continuar? (digite SIM)'
if ($answer -cne 'SIM') { Write-Host 'Operação cancelada'; exit 0 }
git commit -m 'feat: organize Global Watch Cafe as Turborepo monorepo'
if ($LASTEXITCODE -ne 0) { throw 'O commit não foi criado: configure seu git user.name e user.email' }
git branch -M main
if ((git remote) -contains 'origin') { throw 'Já há remote origin; confira manualmente antes de alterar' }
git remote add origin $RepoUrl
git push -u origin main
