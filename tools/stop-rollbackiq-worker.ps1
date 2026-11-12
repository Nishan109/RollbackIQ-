#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$ExpectedRelease,
    [ValidateRange(1,300)][int]$TimeoutSeconds = 210
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
$directory = Join-Path $env:LOCALAPPDATA 'RollbackIQ/windows-worker'
$metadataPath = Join-Path $directory 'worker-control.json'
if (!(Test-Path -LiteralPath $metadataPath -PathType Leaf)) {
    throw 'No supported shutdown record exists. An older worker needs its interactive Ctrl+C console.'
}
$allowed = @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-18', 'S-1-5-32-544')
foreach ($path in @($directory, $metadataPath)) {
    $item = Get-Item -LiteralPath $path
    $acl = Get-Acl -LiteralPath $path
    $grants = $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) |
        Where-Object { $_.AccessControlType -eq 'Allow' }
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
        $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $allowed -or
        @($grants | Where-Object { $_.IdentityReference.Value -notin $allowed }).Count) {
        throw 'Worker shutdown files must have private permissions.'
    }
}
$control = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
if ($control.release -cne $ExpectedRelease -or $control.pid -lt 1 -or
    $control.stopFile -cnotmatch '^worker-[0-9]+-[a-f0-9-]{36}\.stop$') {
    throw 'The worker identity or requested release does not match.'
}
$worker = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$control.pid)"
if (!$worker -or $worker.Name -ne 'node.exe' -or
    $worker.CommandLine -notmatch 'rollbackiq-worker\.mjs[" ]+start(?:\s|$)' -or
    [Math]::Abs(($worker.CreationDate.ToUniversalTime() - ([datetime]$control.processStartedAt).ToUniversalTime()).TotalSeconds) -gt 2) {
    throw 'The recorded worker process is unavailable or has been replaced.'
}
$owner = Invoke-CimMethod -InputObject $worker -MethodName GetOwnerSid
if ($owner.Sid -ne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) {
    throw 'The worker belongs to another Windows account.'
}
$stopPath = Join-Path $directory $control.stopFile
if (Test-Path -LiteralPath $stopPath) {
    if ((Get-Item -LiteralPath $stopPath).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'The shutdown signal must be a regular file.'
    }
} else {
    [IO.File]::WriteAllText($stopPath, 'drain')
}
Write-Host "Graceful shutdown requested for worker $($worker.ProcessId)."
$deadline = [datetime]::UtcNow.AddSeconds($TimeoutSeconds)
while (Get-Process -Id $worker.ProcessId -ErrorAction SilentlyContinue) {
    if ([datetime]::UtcNow -ge $deadline) {
        throw 'The worker is still draining. Inspect its log and active lease before taking further action.'
    }
    Start-Sleep -Milliseconds 300
}
Write-Host 'Worker exited. Rerun preflight before starting it again.'
