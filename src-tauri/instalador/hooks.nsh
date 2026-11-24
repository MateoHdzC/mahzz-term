; Ganchos del instalador de MahzzTerm (Tauri los inserta en installer.nsi).
; Al desinstalar se borra "Abrir en MahzzTerm" del clic derecho y la entrada de "Abrir con".
; En una actualizacion no: la version nueva los vuelve a registrar sola al abrirse.
!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --quitar-integracion'
  ${EndIf}
!macroend
