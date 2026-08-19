@echo off
REM ============================================================
REM CausasPro Bot - Ejecución automática
REM Este archivo se configura en el Programador de Tareas de Windows
REM para que corra cada 2 horas automáticamente
REM ============================================================

cd /d "%~dp0"

set PJUD_RUT=17692174-9
set PJUD_PASSWORD=CAMBIAR_POR_CLAVE_UNICA_REAL
set NEXT_PUBLIC_SUPABASE_URL=https://ggwpikokzhckjpwyltye.supabase.co
set SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdnd3Bpa29remhja2pwd3lsdHllIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Njk4NzE0OCwiZXhwIjoyMTAyNTYzMTQ4fQ.-Q1Oh5machF6ADNBELJMKFXcJonPf4e00gHGFypGwCY
set SKIP_HOUR_CHECK=1

echo [%date% %time%] Iniciando bot CausasPro... >> bot-log.txt
npx tsx src/bot/index.ts >> bot-log.txt 2>&1
echo [%date% %time%] Bot finalizado. >> bot-log.txt
echo. >> bot-log.txt
