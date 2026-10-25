# Destructive installation lifecycle checks run only on the disposable GitHub runner.
param([string]$Version = '0.10.0')
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP) { throw 'This test is only for an isolated GitHub Actions Windows runner.' }
$repo = Split-Path -Parent $PSScriptRoot
$setup = Join-Path $repo "build/releases/SofaPad-$Version-windows-x64-setup.exe"
$installation = Join-Path $env:RUNNER_TEMP 'SofaPad-installed'
$settingsDirectory = Join-Path $env:LOCALAPPDATA 'SofaPad'
$settingsFile = Join-Path $settingsDirectory 'settings.json'
if ((Test-Path $installation) -or (Test-Path $settingsDirectory) -or (Get-NetFirewallRule -DisplayName 'SofaPad Private LAN' -ErrorAction SilentlyContinue)) { throw 'Installer test requires an unused runner.' }
function Install-TestPackage {
    $arguments = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', "/DIR=`"$installation`"")
    $process = Start-Process -FilePath $setup -ArgumentList $arguments -WindowStyle Hidden -PassThru -Wait
    if ($process.ExitCode -ne 0) { throw "Installer exit code: $($process.ExitCode)" }
}
Install-TestPackage
$binary = Join-Path $installation 'SofaPad.exe'
foreach ($file in @('SofaPad.exe', 'coreclr.dll', 'Web/app.js', 'Licenses/NoSleep-MIT.txt')) {
    if (-not (Test-Path (Join-Path $installation $file))) { throw "Installed file missing: $file" }
}
$rule = Get-NetFirewallRule -DisplayName 'SofaPad Private LAN'
if ($rule.Profile -ne 'Private' -or $rule.Direction -ne 'Inbound') { throw 'Unexpected firewall rule scope' }
if (($rule | Get-NetFirewallPortFilter).LocalPort -ne '9876') { throw 'Unexpected firewall port' }
if (($rule | Get-NetFirewallAddressFilter).RemoteAddress -ne 'LocalSubnet') { throw 'Unexpected remote address scope' }
$env:SOFAPAD_BINARY = $binary
$env:DOTNET_ROOT = Join-Path $env:RUNNER_TEMP 'no-runtime-installed-here'
& python (Join-Path $repo 'Tests/Integration/server_test.py')
if ($LASTEXITCODE) { throw 'Installed self-contained server tests failed' }
New-Item -ItemType Directory -Path $settingsDirectory | Out-Null
'{"version":1,"settings":{"pointer":2.4,"scroll":0.4,"natural":false,"keepAwake":true}}' | Set-Content -LiteralPath $settingsFile -Encoding utf8
$before = (Get-FileHash $settingsFile).Hash
# Create a stale web module, then verify upgrade removes it and retains user settings.
Set-Content -LiteralPath (Join-Path $installation 'Web/stale.js') -Value '// removed module'
Install-TestPackage
if ((Get-FileHash $settingsFile).Hash -ne $before -or (Test-Path (Join-Path $installation 'Web/stale.js'))) { throw 'Upgrade did not preserve settings or remove stale web modules' }
$uninstaller = Join-Path $installation 'unins000.exe'
$process = Start-Process -FilePath $uninstaller -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -WindowStyle Hidden -PassThru -Wait
if ($process.ExitCode -ne 0) { throw "Uninstaller exit code: $($process.ExitCode)" }
if ((Test-Path $binary) -or (Get-NetFirewallRule -DisplayName 'SofaPad Private LAN' -ErrorAction SilentlyContinue)) { throw 'Uninstall left the application or firewall rule behind' }
if ((Get-FileHash $settingsFile).Hash -ne $before) { throw 'Uninstall removed user settings' }
Write-Output 'PASS: installation, private-subnet firewall, installed server, upgrade, settings preservation and uninstall'
