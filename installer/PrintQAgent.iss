; PrintQ Agent - Windows installer (Inno Setup 6.3+)
;
; Produces PrintQAgent-Setup.exe: the single file a photocopy shop downloads,
; double-clicks, and is finished with.
;
; DESIGN DECISIONS WORTH KNOWING
;
; Per-user install, no administrator prompt.
;   PrivilegesRequired=lowest puts the program under the user's own
;   Programs folder. A counter PC is frequently a standard account, and an
;   installer that opens a UAC prompt nobody can answer is an installer that
;   does not get installed. Nothing here needs machine-wide rights: printing
;   happens as the logged-in user, and that is also the only session where
;   printer drivers behave predictably.
;
; Startup entry, not a Windows service.
;   A service runs in session 0 with no access to the interactive desktop,
;   where many printer drivers misbehave or silently fail. The agent is
;   registered under the user's Run key and starts minimised to the tray, so
;   it is in the same session as the printer it drives. This is deliberate --
;   see requirement note in docs/agent-deployment.md.
;
; SumatraPDF is downloaded, not bundled.
;   It is GPLv3. Shipping its binary inside this installer would make this a
;   conveyed GPL work with a source-offer obligation. The user's own machine
;   fetches the official build instead. If that download fails the install
;   still succeeds -- the agent fetches it itself on first run, so a shop
;   behind a slow connection is never left with a broken product.

#define AppName "PrintQ Agent"
#define AppPublisher "PrintQ"
#define AppExeName "PrintQAgent.exe"
#define AppUrl "https://printq-rho.vercel.app"

; Passed in by the release workflow: ISCC /DAppVersion=1.2.3
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

; Where PyInstaller left the executable.
#ifndef SourceDir
  #define SourceDir "..\agent\dist"
#endif

#define SumatraVersion "3.6.1"
#define SumatraUrl "https://www.sumatrapdfreader.org/dl/rel/" + SumatraVersion + "/SumatraPDF-" + SumatraVersion + "-64.zip"

[Setup]
; Fixed AppId: upgrades replace the previous install instead of stacking up.
AppId={{CC2AF9F6-AFC1-4402-BBDB-115629843DC3}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppUrl}
AppSupportURL={#AppUrl}/downloads/windows
DefaultDirName={autopf}\PrintQ Agent
DefaultGroupName=PrintQ
DisableProgramGroupPage=yes
DisableDirPage=auto
OutputDir=..\dist
OutputBaseFilename=PrintQAgent-Setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; No administrator rights required; see the note above.
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; Ask Windows to close a running agent rather than failing on a locked file.
CloseApplications=yes
RestartApplications=no
SetupIconFile=..\agent\printq.ico
UninstallDisplayIcon={app}\{#AppExeName}
UninstallDisplayName={#AppName}
VersionInfoVersion={#AppVersion}
MinVersion=10.0

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a shortcut on the desktop"; GroupDescription: "Shortcuts:"
Name: "startup"; Description: "Start PrintQ Agent automatically when this computer starts"; GroupDescription: "Printing:"; Flags: checkedonce

[Files]
Source: "{#SourceDir}\{#AppExeName}"; DestDir: "{app}"; Flags: ignoreversion
; Placed next to the agent by the download step below, when it succeeds.
Source: "{tmp}\SumatraPDF.exe"; DestDir: "{app}\SumatraPDF"; Flags: external skipifsourcedoesntexist ignoreversion

[Icons]
Name: "{group}\PrintQ Agent"; Filename: "{app}\{#AppExeName}"
Name: "{group}\PrintQ Dashboard"; Filename: "{#AppUrl}/dashboard"
Name: "{autodesktop}\PrintQ Agent"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Registry]
; Per-user startup, minimised to the tray. Uninstall removes the value and
; nothing else under Run.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
    ValueType: string; ValueName: "PrintQAgent"; \
    ValueData: """{app}\{#AppExeName}"" --minimised"; \
    Flags: uninsdeletevalue; Tasks: startup

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Open PrintQ Agent now"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Only what this installer created. Customer documents, logs and the pairing
; configuration live under %APPDATA%\PrintQ and are left alone unless the user
; asks for them in the prompt below.
Type: filesandordirs; Name: "{app}\SumatraPDF"

[Code]
var
  SumatraReady: Boolean;

function InitializeSetup(): Boolean;
begin
  SumatraReady := False;
  Result := True;
end;

{ Fetch the official SumatraPDF build and unpack the single executable it
  contains. Failure is not fatal: the agent provisions it on first run, so the
  worst case is a few seconds' wait the first time something prints. }
procedure DownloadSumatra();
var
  TempZip: String;
  ExtractDir: String;
  FindRec: TFindRec;
  ResultCode: Integer;
  Command: String;
begin
  TempZip := ExpandConstant('{tmp}\sumatra.zip');
  ExtractDir := ExpandConstant('{tmp}\sumatra');

  try
    DownloadTemporaryFile('{#SumatraUrl}', 'sumatra.zip', '', nil);
  except
    Log('SumatraPDF download failed: ' + GetExceptionMessage);
    Exit;
  end;

  if not FileExists(TempZip) then
  begin
    Log('SumatraPDF archive missing after download.');
    Exit;
  end;

  if not DirExists(ExtractDir) then
    CreateDir(ExtractDir);

  { Unpacked with the Expand-Archive that ships in every supported Windows,
    rather than Inno's ExtractArchive, which exists only in 6.4 and later --
    this keeps the script buildable on whatever Inno the CI runner installs.
    Internal to the installer; the shop never sees or types any of it. }
  Command := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ' +
             '"Expand-Archive -LiteralPath ''' + TempZip +
             ''' -DestinationPath ''' + ExtractDir + ''' -Force"';

  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
              Command, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
  begin
    Log('SumatraPDF extract could not start.');
    Exit;
  end;

  if ResultCode <> 0 then
  begin
    Log('SumatraPDF extract failed with code ' + IntToStr(ResultCode));
    Exit;
  end;

  { The archive holds exactly one .exe, named for its version. Rename it to a
    stable name so the agent's resolver does not have to know the version. }
  if FindFirst(ExtractDir + '\*.exe', FindRec) then
  begin
    try
      if FileCopy(ExtractDir + '\' + FindRec.Name, ExpandConstant('{tmp}\SumatraPDF.exe'), False) then
        SumatraReady := True;
    finally
      FindClose(FindRec);
    end;
  end;

  if not SumatraReady then
    Log('SumatraPDF executable not found in archive; the agent will fetch it.');
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  WizardForm.StatusLabel.Caption := 'Preparing the printing component...';
  DownloadSumatra();
  Result := '';
end;

{ Offer to clear the saved pairing and logs. Default is to keep them, so
  reinstalling or upgrading never makes a shop pair again. }
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    DataDir := ExpandConstant('{userappdata}\PrintQ');
    if DirExists(DataDir) then
    begin
      if MsgBox('Also remove this computer''s PrintQ pairing and logs?' + #13#10 + #13#10 +
                'Choose No if you are reinstalling or upgrading.',
                mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
        DelTree(DataDir, True, True, True);
    end;
    { The managed SumatraPDF copy is ours, so it goes either way. }
    DelTree(ExpandConstant('{localappdata}\PrintQ\SumatraPDF'), True, True, True);
  end;
end;
