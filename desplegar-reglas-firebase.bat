@echo off
echo ========================================
echo  Desplegando reglas de Firestore...
echo ========================================
echo.
cd /d "C:\Users\Usuario\Desktop\FLEETCOMMS"
echo Paso 1: Login en Firebase (se abrira el navegador)
call "C:\Users\Usuario\AppData\Roaming\npm\firebase.cmd" login
echo.
echo Paso 2: Desplegando reglas...
call "C:\Users\Usuario\AppData\Roaming\npm\firebase.cmd" deploy --only firestore:rules --project fleetcomms-13d89
echo.
echo ========================================
echo  Listo! Pulsa cualquier tecla para cerrar
echo ========================================
pause
