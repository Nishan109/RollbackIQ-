#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('start','test')][string]$Mode,
    [string]$ExpectedRelease,
    [string]$AppUrl,
    [string]$EnvFile,
    [string]$NodePath,
    [string]$PnpmPath,
    [string]$GitPath,
    [ValidateRange(1,65535)][int]$HealthPort = 8080
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
$root = Split-Path -Parent $PSScriptRoot
$web = Join-Path $root 'apps/web'
$runtimeDir = Join-Path $env:LOCALAPPDATA 'RollbackIQ/windows-worker'
if (!$EnvFile) {
    $privateEnv = Join-Path $runtimeDir 'worker.env'
    $EnvFile = if (Test-Path -LiteralPath $privateEnv -PathType Leaf) { $privateEnv } else { Join-Path $web '.env.local' }
}

function Resolve-Program($ExplicitPath, $Name) {
    if ($ExplicitPath) { return (Get-Item -LiteralPath $ExplicitPath).FullName }
    return (Get-Command $Name -CommandType Application | Select-Object -First 1).Source
}

$originalPath = $env:Path
$mutex = $null
$ownsMutex = $false
$locationPushed = $false
$phase = 'Windows runtime'
try {
    $phase = 'Node.js'
    $node = Resolve-Program $NodePath 'node.exe'
    $nodeVersion = & $node --version 2>$null
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+\.\d+\.\d+)$' -or [version]$Matches[1] -lt [version]'22.13.0') {
        throw 'Node.js 22.13.0 or newer is required.'
    }
    Write-Host "PASS Node.js $nodeVersion"
    $env:Path = "$(Split-Path -Parent $node);$originalPath"

    $phase = 'pnpm'
    $pnpm = Resolve-Program $PnpmPath 'pnpm.cmd'
    $manifest = Get-Content -Raw -LiteralPath (Join-Path $root 'package.json') | ConvertFrom-Json
    $pnpmVersion = & $pnpm --version 2>$null
    if ($LASTEXITCODE -ne 0 -or "pnpm@$pnpmVersion" -ne $manifest.packageManager) {
        throw 'pnpm must match the packageManager version in package.json.'
    }
    Write-Host "PASS pnpm $pnpmVersion"

    $phase = 'Git'
    $git = Resolve-Program $GitPath 'git.exe'
    if (!$ExpectedRelease) { $ExpectedRelease = & $git -C $root rev-parse HEAD 2>$null }
    if ($ExpectedRelease -cnotmatch '^[a-f0-9]{40}$') { throw 'A full Git commit SHA is required.' }

    $phase = 'Environment file'
    $envItem = Get-Item -LiteralPath $EnvFile
    if ($envItem.PSIsContainer -or ($envItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'The environment file must be a regular local file.'
    }
    $EnvFile = $envItem.FullName
    $allowedSids = @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-18', 'S-1-5-32-544')
    $acl = Get-Acl -LiteralPath $EnvFile
    $readers = $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) |
        Where-Object { $_.AccessControlType -eq 'Allow' -and ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::ReadData) }
    $filePrivate = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -in $allowedSids -and
        @($readers | Where-Object { $_.IdentityReference.Value -notin $allowedSids }).Count -eq 0
    if (!$filePrivate) {
        Write-Host 'FAIL Environment file is readable by other accounts or has an unexpected owner.'
        exit 1
    }
    Write-Host 'PASS Environment file access is limited to this account, SYSTEM, and Administrators.'

    if ($Mode -eq 'start') {
        $phase = 'Worker control directory'
        if (!(Test-Path -LiteralPath $runtimeDir -PathType Container)) {
            New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
        }
        $runtimeAcl = Get-Acl -LiteralPath $runtimeDir
        $runtimeGrants = $runtimeAcl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) |
            Where-Object { $_.AccessControlType -eq 'Allow' }
        if ($runtimeAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $allowedSids -or
            @($runtimeGrants | Where-Object { $_.IdentityReference.Value -notin $allowedSids }).Count) {
            throw 'The worker control directory must be private to this account, SYSTEM, and Administrators.'
        }
    }

    $phase = 'Duplicate worker check'
    $mutex = [Threading.Mutex]::new($false, 'Local\RollbackIQ.WindowsWorker')
    try { $ownsMutex = $mutex.WaitOne(0) }
    catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
    $workers = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
        $_.CommandLine -match 'scripts[\\/]+github-worker\.ts|rollbackiq-worker\.mjs[" ]+start(?:\s|$)'
    })
    $singleWorker = $ownsMutex -and !$workers.Count
    if ($singleWorker) { Write-Host 'PASS No existing RollbackIQ worker on Windows.' }
    else { Write-Host 'BLOCKED Another RollbackIQ worker or preflight is active.' }

    $phase = 'Local health port'
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $HealthPort)
    $listener.ExclusiveAddressUse = $true
    try {
        $listener.Start()
        $portAvailable = $true
        Write-Host "PASS Local health port $HealthPort is available."
    } catch [Net.Sockets.SocketException] {
        $portAvailable = $false
        Write-Host "BLOCKED Local health port $HealthPort is unavailable."
    } finally { $listener.Stop() }

    $phase = 'Worker preflight'
    $phaseArgs = @('--import','tsx',(Join-Path $PSScriptRoot 'rollbackiq-worker.mjs'),$Mode,$EnvFile,$ExpectedRelease,[string]$HealthPort,$git)
    # The positional placeholder also works in Windows PowerShell's legacy native argument parser.
    $phaseArgs += if ($AppUrl) { $AppUrl } else { '-' }
    $phaseArgs += [string]($singleWorker -and $portAvailable)
    $nodeHelp = & $node --help 2>$null
    if ($nodeHelp -match '--use-system-ca') { $phaseArgs = @('--use-system-ca') + $phaseArgs }
    Push-Location -LiteralPath $web
    $locationPushed = $true
    & $node @phaseArgs
    exit $LASTEXITCODE
} catch {
    Write-Host "FAIL $phase. Check the required executable, file or Windows permission."
    exit 1
} finally {
    if ($locationPushed) { Pop-Location }
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    if ($mutex) { $mutex.Dispose() }
    $env:Path = $originalPath
}
