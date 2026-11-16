; "Keep lophn running"이 Windows에서 쓴 로그인 시작 값(이름이 lophn-core-로 시작하는 HKCU Run 값과 그 StartupApproved 값)을
; 제거할 때 지운다. 업데이트는 옛 판의 uninstaller를 부르므로 그때는 남긴다. 사람의 data root는 건드리지 않는다.
!include LogicLib.nsh

!macro lophnDeleteCoreValues KEY
  Push $0
  Push $1
  Push $2
  StrCpy $0 0
  ${Do}
    ClearErrors
    EnumRegValue $1 HKCU "${KEY}" $0
    ${If} ${Errors}
      ${ExitDo}
    ${EndIf}
    StrCpy $2 $1 11
    ${If} $2 == "lophn-core-"
      ; 지우면 뒤 값이 앞으로 밀리므로 index를 올리지 않는다.
      DeleteRegValue HKCU "${KEY}" $1
    ${Else}
      IntOp $0 $0 + 1
    ${EndIf}
  ${Loop}
  Pop $2
  Pop $1
  Pop $0
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    !insertmacro lophnDeleteCoreValues "Software\Microsoft\Windows\CurrentVersion\Run"
    !insertmacro lophnDeleteCoreValues "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
  ${endIf}
!macroend
