# 🚀 DEPLOY EN 3 PASOS

## Paso 1: Crear las tablas en Supabase

1. Abre: https://supabase.com/dashboard/project/cuwuyqpxaibbqjrvamjb/sql/new
2. Copia todo el contenido de `schema.sql`
3. Pégalo y click **Run**
4. ✅ Verás "Success" = tablas creadas

## Paso 2: Obtener la anon key

1. Abre: https://supabase.com/dashboard/project/cuwuyqpxaibbqjrvamjb/settings/api
2. Copia la key que dice **"anon"** (la pública, NO la service_role)
3. La necesitas para el paso 3

## Paso 3: Deploy en Vercel

Click este botón para deployar automáticamente:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/TU_USUARIO/causaspro&env=NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY)

O manualmente:

1. Sube este proyecto a un repositorio en GitHub
2. Ve a https://vercel.com/new
3. Importa el repositorio
4. En "Environment Variables" agrega:

| Variable | Valor |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://cuwuyqpxaibbqjrvamjb.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (la anon key del paso 2) |
| `SUPABASE_SERVICE_ROLE_KEY` | (tu service role key — Settings → API → `service_role`) |

> ⚠️ **NUNCA** pegues la `service_role` key en este archivo ni en ningún archivo versionado.
> Es la llave maestra de tu base de datos. Va solo en las Environment Variables de Vercel.

5. Click **Deploy**
6. ¡Listo! Tu app estará en una URL tipo: `causaspro-xxxxx.vercel.app`

## Después del deploy:

1. Abre tu app en el navegador
2. Arrastra tu Excel de causas
3. Espera a que procese
4. ¡Verás tu dashboard con todas las causas rankeadas por urgencia!


---

## 🤖 Ejecutar el Bot PJUD en Windows

Los scripts `.bat` contienen secretos (RUT, contraseña PJUD, service role key), por eso
**NO se versionan** (están en `.gitignore`). Se usan plantillas `.bat.example`:

1. Copia la plantilla y quítale el `.example`:
   ```cmd
   copy ejecutar-bot.bat.example ejecutar-bot.bat
   copy ejecutar-todo-el-dia.bat.example ejecutar-todo-el-dia.bat
   ```
2. Abre el `.bat` con el Bloc de notas y reemplaza los `CAMBIAR_*`:
   - `PJUD_RUT` → tu RUT (ej: `17692174-9`)
   - `PJUD_PASSWORD` → tu contraseña de Clave Única
   - `SUPABASE_SERVICE_ROLE_KEY` → tu service role key (Supabase → Settings → API)
3. Preparar el proyecto (una vez):
   ```cmd
   npm install
   npx playwright install chromium
   ```
4. Ejecutar:
   - **Una corrida:** doble clic en `ejecutar-bot.bat`
   - **Todo el día (cada 1 h):** doble clic en `ejecutar-todo-el-dia.bat`
   - **Prueba visible (1 causa):** `npm run bot:test`

### 🔴 IMPORTANTE — Rotar las keys expuestas

Versiones anteriores de estos `.bat` (y del `DEPLOY.md`) tenían la **service role key**
escrita en texto plano y quedaron en el historial de git. Por seguridad, **rota la key**:

1. Supabase → Settings → API → **Reset** de la `service_role` key (genera una nueva).
2. Actualiza el nuevo valor en: tus `.bat` locales, las env vars de Vercel y los
   Secrets de GitHub Actions.
3. La key vieja queda invalidada — aunque siga en el historial, ya no sirve.

> La contraseña de Clave Única no estaba en el repo (era un placeholder `CAMBIAR_*`),
> pero igual conviene no reutilizarla en archivos versionados.
