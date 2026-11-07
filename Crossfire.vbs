Option Explicit

Dim fso, shell, folder, serverPath, check

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
folder = fso.GetParentFolderName(WScript.ScriptFullName)

check = shell.Run("cmd /c where node >nul 2>nul", 0, True)
If check <> 0 Then
  MsgBox "Crossfire needs Node.js 24 or newer." & vbCrLf & "Install it from https://nodejs.org/ and try again.", 16, "Crossfire"
  WScript.Quit 1
End If

serverPath = folder & "\control-panel\server.mjs"
shell.Run "node """ & serverPath & """ --open", 0, False
