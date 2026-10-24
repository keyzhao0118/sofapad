param([string]$Version = '0.10.0', [string]$DotNet = 'dotnet', [string]$InnoCompiler = '', [switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
if ($DotNet -eq 'dotnet' -and (Test-Path "$repo/build/tools/dotnet/dotnet.exe")) { $DotNet = "$repo/build/tools/dotnet/dotnet.exe" }
if (-not $InnoCompiler) {
    $InnoCompiler = @("${env:ProgramFiles(x86)}/Inno Setup 6/ISCC.exe", "$env:ProgramFiles/Inno Setup 6/ISCC.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $InnoCompiler) { throw 'Install Inno Setup 6, or pass -InnoCompiler with the full path to ISCC.exe.' }
if (-not $SkipBuild) { & "$PSScriptRoot/build-windows.ps1" -DotNet $DotNet }
$publish = Join-Path $repo 'build/windows-x64'
$output = Join-Path $repo 'build/releases'
New-Item -ItemType Directory -Force $output | Out-Null
# Publish into a clean, verified workspace-owned directory so deleted modules cannot ship.
if (Test-Path $publish) {
    $resolved = (Resolve-Path -LiteralPath $publish).Path
    if ($resolved -ne (Join-Path $repo 'build/windows-x64')) { throw 'Unexpected publish path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
Push-Location "$repo/WindowsApp"
try {
    & $DotNet publish src/SofaPad.Windows/SofaPad.Windows.csproj -c Release -r win-x64 --self-contained true -o $publish "-p:Version=$Version"
    if ($LASTEXITCODE) { throw 'Publish failed' }
} finally { Pop-Location }
$sdkDirectory = Split-Path -Parent (Get-Command $DotNet).Source
New-Item -ItemType Directory -Force "$publish/Licenses" | Out-Null
foreach ($notice in @('LICENSE.txt', 'ThirdPartyNotices.txt')) {
    $sourceNotice = Join-Path $sdkDirectory $notice
    if (-not (Test-Path $sourceNotice)) { throw "Missing .NET distribution notice: $sourceNotice" }
    Copy-Item -LiteralPath $sourceNotice -Destination "$publish/Licenses/dotnet-$notice"
}
foreach ($asset in (Get-ChildItem "$repo/Web/dist" -File)) {
    $packaged = Join-Path "$publish/Web" $asset.Name
    if (-not (Test-Path $packaged) -or (Get-FileHash $asset.FullName).Hash -ne (Get-FileHash $packaged).Hash) { throw "Missing or stale web asset: $($asset.Name)" }
}
Compress-Archive -Path "$publish/*" -DestinationPath "$output/SofaPad-$Version-windows-x64.zip" -Force
& $InnoCompiler "/DAppVersion=$Version" "/DPublishDir=$publish" "/DOutputDir=$output" "$repo/WindowsApp/installer/SofaPad.iss"
if ($LASTEXITCODE) { throw 'Installer compilation failed' }
Get-ChildItem $output -File | Where-Object { $_.Name -like "SofaPad-$Version-windows-x64*" } | Get-FileHash -Algorithm SHA256 |
    ForEach-Object { "$($_.Hash.ToLower())  $(Split-Path -Leaf $_.Path)" } | Set-Content "$output/SofaPad-$Version-windows-SHA256.txt" -Encoding ascii
Write-Output "Installer and portable ZIP: $output"
