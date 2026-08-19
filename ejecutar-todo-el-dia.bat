@echo off
REM ============================================================
REM CausasPro Bot - Ejecutar TODO EL DÍA cada 1 hora
REM Déjalo corriendo y no cierres esta ventana
REM ============================================================

cd /d "%~dp0"

set PJUD_RUT=17692174-9
set PJUD_PASSWORD=CAMBIAR_POR_CLAVE_UNICA_REAL
set NEXT_PUBLIC_SUPABASE_URL=https://ggwpikokzhckjpwyltye.supabase.co
set SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdnd3Bpa29remhja2pwd3lsdHllIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Njk4NzE0OCwiZXhwIjoyMTAyNTYzMTQ4fQ.-Q1Oh5machF6ADNBELJMKFXcJonPf4e00gHGFypGwCY
set SKIP_HOUR_CHECK=1

echo ============================================================
echo   CausasPro Bot - Modo TODO EL DIA (cada 1 hora)
echo   NO CIERRES ESTA VENTANA
echo   Para detener: presiona Ctrl+C
echo ============================================================
echo.

:loop
echo [%date% %time%] === INICIANDO SESION DEL BOT ===
echo.
call npx tsx src/bot/index.ts
echo.
echo [%date% %time%] === SESION TERMINADA ===
echo.
echo Esperando 1 hora para la siguiente ejecucion...
echo (Para detener: presiona Ctrl+C)
echo.
timeout /t 3600 /nobreak
goto loop
