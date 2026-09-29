#ifndef PayloadDir
  #error PayloadDir is required
#endif
#ifndef OutputDir
  #define OutputDir "."
#endif
#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif

[Setup]
AppId={{A0F16E4E-29F8-4D91-ACF1-0B6E2143E063}
AppName=GPT Observatory
AppVersion={#AppVersion}
AppPublisher=GPT Observatory
DefaultDirName={localappdata}\GPTObservatory
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=GPT-Observatory-Setup-x64
SetupIconFile={#PayloadDir}\public\gpt-observatory.ico
WizardStyle=modern
Compression=lzma2/ultra64
SolidCompression=yes
Uninstallable=no
CreateAppDir=no

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{tmp}\GPTObservatoryPayload"; Flags: recursesubdirs createallsubdirs deleteafterinstall ignoreversion

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  Bootstrap: String;
  Parameters: String;
begin
  if CurStep = ssPostInstall then
  begin
    Bootstrap := ExpandConstant('{tmp}\GPTObservatoryPayload\Install-GPT-Observatory.ps1');
    Parameters := '-NoProfile -ExecutionPolicy Bypass -File "' + Bootstrap + '"';

    if not Exec(
      ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
      Parameters,
      ExpandConstant('{tmp}\GPTObservatoryPayload'),
      SW_SHOWNORMAL,
      ewWaitUntilTerminated,
      ResultCode
    ) then
      RaiseException('Failed to launch GPT Observatory installer bootstrap.');

    if ResultCode <> 0 then
      RaiseException(Format('GPT Observatory installation failed with exit code %d.', [ResultCode]));
  end;
end;
