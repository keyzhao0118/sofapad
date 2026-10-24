#ifndef AppVersion
  #define AppVersion "0.10.0"
#endif
#ifndef PublishDir
  #define PublishDir "..\..\build\windows-x64"
#endif
#ifndef OutputDir
  #define OutputDir "..\..\build\releases"
#endif

[Setup]
AppId={{BBCB69CF-94ED-4BC6-A5BD-2E8CFE41A68F}
AppName=SofaPad
AppVersion={#AppVersion}
AppPublisher=Key (keyzhao0118)
AppPublisherURL=https://github.com/keyzhao0118/sofapad
DefaultDirName={autopf}\SofaPad
DefaultGroupName=SofaPad
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64os
ArchitecturesInstallIn64BitMode=x64os
MinVersion=10.0.22000
OutputDir={#OutputDir}
OutputBaseFilename=SofaPad-{#AppVersion}-windows-x64-setup
SetupIconFile=..\src\SofaPad.Windows\AppIcon.ico
UninstallDisplayIcon={app}\SofaPad.exe
LicenseFile=..\..\LICENSE
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
CloseApplicationsFilter=SofaPad.exe
RestartApplications=no
SetupLogging=yes

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[InstallDelete]
Type: filesandordirs; Name: "{app}\Web"

[Files]
Source: "{#PublishDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\SofaPad"; Filename: "{app}\SofaPad.exe"
Name: "{autodesktop}\SofaPad"; Filename: "{app}\SofaPad.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; Flags: unchecked

[Run]
; Only the installer is elevated. The network service always runs as the original user.
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""SofaPad Private LAN"""; Flags: runhidden waituntilterminated
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""SofaPad Private LAN"" dir=in action=allow program=""{app}\SofaPad.exe"" enable=yes profile=private protocol=TCP localport=9876 remoteip=LocalSubnet edge=no"; Flags: runhidden waituntilterminated
Filename: "{app}\SofaPad.exe"; Description: "启动 SofaPad"; Flags: nowait postinstall skipifsilent runasoriginaluser

[UninstallRun]
Filename: "{app}\SofaPad.exe"; Parameters: "--uninstall-user"; Flags: runhidden waituntilterminated; RunOnceId: "StopSofaPad"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""SofaPad Private LAN"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoveSofaPadFirewall"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var ResultCode: Integer;
begin
  if FileExists(ExpandConstant('{app}\SofaPad.exe')) then begin
    Exec(ExpandConstant('{app}\SofaPad.exe'), '--shutdown', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Sleep(3500);
  end;
  Result := '';
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then Sleep(3500);
end;
