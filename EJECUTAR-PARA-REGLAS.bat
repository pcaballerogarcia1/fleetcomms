@echo off
title Desplegando reglas Firestore...
cd /d "C:\Users\Usuario\Desktop\FLEETCOMMS"
echo.
echo ============================================
echo  PASO 1: Se abrira el navegador con Google
echo  Solo haz clic en PERMITIR con tu cuenta
echo ============================================
echo.
node deploy-reglas.mjs
echo.
if %ERRORLEVEL% == 0 (
  echo ============================================
  echo  EXITO - Reglas desplegadas correctamente
  echo  Ya puedes crear usuarios y organizaciones
  echo ============================================
) else (
  echo ============================================
  echo  ERROR - Algo fue mal, mira el texto arriba
  echo ============================================
)
echo.
pause
