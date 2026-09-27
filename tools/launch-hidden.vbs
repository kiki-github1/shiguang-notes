Option Explicit

' ============================================================================
'  Hidden launcher for the local admin backend.
'
'  Why this file exists: the desktop shortcut used to point straight at
'  start-admin.bat, which parks a black console window on screen for as long
'  as the backend runs. Running the batch file through wscript with window
'  style 0 gets rid of that box, so double-clicking the icon feels like
'  opening an ordinary desktop app.
'
'  *** KEEP THIS FILE PURE ASCII. ***
'  wscript reads .vbs source using the system ANSI code page (936 / GBK on a
'  Chinese Windows). Chinese text stored here as UTF-8 turns into mojibake,
'  and a UTF-8 BOM makes the parser fail outright -- both were verified.
'  Every Chinese message therefore lives in start-admin.bat, where `echo`
'  handles it natively. Do not "helpfully" translate the strings below.
' ============================================================================

Dim fso, shell, root, nodeExe, rc

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

' This file lives in tools\, so the project root is one level up.
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))

If Not fso.FileExists(fso.BuildPath(root, "server.js")) Then
  MsgBox "Launcher cannot find server.js in:" & vbCrLf & vbCrLf & root & vbCrLf & vbCrLf & _
         "The shortcut is probably pointing at a folder that was moved or deleted.", _
         16, "Shiguang Notes"
  WScript.Quit 1
End If

nodeExe = FindNode()

If nodeExe = "" Then
  ' No Node.js anywhere. Run the batch file in a VISIBLE window so the user
  ' gets a readable explanation instead of a silent no-op.
  shell.Run """" & root & "\start-admin.bat""", 1, False
  WScript.Quit 1
End If

' Hand the resolved path down to the batch file. Explorer can hold on to a
' stale PATH for a long time after Node.js is installed, so we never trust
' `node` being on PATH -- but the batch file still needs to know what we found.
shell.Environment("PROCESS")("SHIGUANG_NODE") = nodeExe

shell.CurrentDirectory = root

' Window style 0 = hidden. Wait = True, so the exit code tells us whether the
' backend actually came up.
rc = shell.Run("""" & nodeExe & """ """ & root & "\tools\launch.js""", 0, True)

If rc <> 0 Then
  ' It failed while invisible. Re-run through the batch file in a visible
  ' window so the reason is on screen instead of swallowed.
  shell.Run """" & root & "\start-admin.bat""", 1, False
End If

WScript.Quit rc

' ---------------------------------------------------------------------------
' Locate node.exe without trusting PATH, then fall back to asking the shell.
' Returns "" when nothing usable was found.
Function FindNode()
  Dim pf, pf86, localAppData, appdata, candidates, i, p

  pf = shell.ExpandEnvironmentStrings("%ProgramFiles%")
  pf86 = shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%")
  localAppData = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%")
  appdata = shell.ExpandEnvironmentStrings("%APPDATA%")

  candidates = Array( _
    pf & "\nodejs\node.exe", _
    pf86 & "\nodejs\node.exe", _
    localAppData & "\Programs\nodejs\node.exe", _
    localAppData & "\nodejs\node.exe", _
    localAppData & "\Volta\bin\node.exe", _
    appdata & "\nvm\node.exe" _
  )

  For i = 0 To UBound(candidates)
    p = candidates(i)
    ' A variable that failed to expand still contains a percent sign. Skip it,
    ' otherwise FileExists would probe a literal "%LOCALAPPDATA%\..." path.
    If InStr(p, "%") = 0 Then
      If fso.FileExists(p) Then
        FindNode = p
        Exit Function
      End If
    End If
  Next

  ' Last resort: let the shell resolve "node" through PATH. Redirected to nul
  ' so a miss does not flash a console window.
  If shell.Run("cmd /c where node >nul 2>nul", 0, True) = 0 Then
    FindNode = "node"
    Exit Function
  End If

  FindNode = ""
End Function
