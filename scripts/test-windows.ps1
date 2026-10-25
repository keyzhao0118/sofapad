param([string]$Configuration = 'Release', [string]$DotNet = 'dotnet', [switch]$Desktop)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
if ($DotNet -eq 'dotnet' -and (Test-Path "$repo/build/tools/dotnet/dotnet.exe")) { $DotNet = "$repo/build/tools/dotnet/dotnet.exe" }
& "$PSScriptRoot/build-windows.ps1" -Configuration $Configuration -DotNet $DotNet
Push-Location $repo
$previousBinary = $env:SOFAPAD_BINARY
$previousRoot = $env:SOFAPAD_WEB_ROOT
$previousDotnetRoot = $env:DOTNET_ROOT
try {
    & pnpm.cmd --dir Web test
    if ($LASTEXITCODE) { throw 'Web tests failed' }
    & $DotNet run --project WindowsApp/tests/SofaPad.Tests -c $Configuration --no-build
    if ($LASTEXITCODE) { throw 'Windows tests failed' }
    $env:SOFAPAD_BINARY = "$repo/WindowsApp/src/SofaPad.Windows/bin/$Configuration/net10.0-windows/SofaPad.exe"
    $env:DOTNET_ROOT = Split-Path -Parent (Get-Command $DotNet).Source
    & python Tests/Integration/server_test.py
    if ($LASTEXITCODE) { throw 'HTTP/WS tests failed' }
    if ($Desktop) {
        $env:SOFAPAD_WEB_ROOT = "$repo/Web/dist"
        & $DotNet run --project WindowsApp/tests/SofaPad.DesktopProbe -c $Configuration --no-build
        if ($LASTEXITCODE) { throw 'Native desktop input probe failed' }
    }
} finally { $env:SOFAPAD_BINARY = $previousBinary; $env:SOFAPAD_WEB_ROOT = $previousRoot; $env:DOTNET_ROOT = $previousDotnetRoot; Pop-Location }
