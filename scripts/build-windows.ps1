param([string]$Configuration = 'Release', [string]$DotNet = 'dotnet', [switch]$SkipWeb)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
if ($DotNet -eq 'dotnet' -and (Test-Path "$repo/build/tools/dotnet/dotnet.exe")) { $DotNet = "$repo/build/tools/dotnet/dotnet.exe" }
Push-Location $repo
try {
    if (-not $SkipWeb) {
        & pnpm.cmd --dir Web install --frozen-lockfile
        if ($LASTEXITCODE) { throw 'Web dependency restore failed' }
        & pnpm.cmd --dir Web build
        if ($LASTEXITCODE) { throw 'Web build failed' }
    }
    Push-Location WindowsApp
    try { & $DotNet build SofaPad.Windows.slnx -c $Configuration; if ($LASTEXITCODE) { throw 'Windows build failed' } }
    finally { Pop-Location }
} finally { Pop-Location }
