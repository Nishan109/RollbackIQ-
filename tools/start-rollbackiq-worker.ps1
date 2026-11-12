#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$ExpectedRelease,
    [string]$AppUrl,
    [string]$EnvFile,
    [string]$NodePath,
    [string]$PnpmPath,
    [string]$GitPath,
    [int]$HealthPort
)

& (Join-Path $PSScriptRoot 'rollbackiq-worker.ps1') -Mode start @PSBoundParameters
exit $LASTEXITCODE
