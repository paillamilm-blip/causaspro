# 🚀 DEPLOY EN 3 PASOS

> ⚠️ **Antes de empezar — proyecto Supabase correcto:** en este repo aparecieron dos
> URLs de proyecto en distintos momentos (`cuwuyqpxaibbqjrvamjb` y `ggwpikokzhckjpwyltye`).
> Verifica en tu panel de Supabase cuál es el proyecto ACTIVO (el que tiene tus causas) y
> usa SIEMPRE esa URL. Los `https://supabase.com/dashboard/project/<ID>/...` de abajo son
> plantillas: reemplaza `<ID>` por el tuyo.

## Paso 1: Crear las tablas en Supabase

1. Abre: `https://supabase.com/dashboard/project/<ID>/sql/new`
2. Copia todo el contenido de `db/base/schema.sql`
3. Pégalo y click **Run**
4. Repite con `db/base/schema-bot.sql`
5. ✅ Verás "Success" = tablas creadas

> Las migraciones históricas (fixes ya aplicados al proyecto en producción) están en
> `db/migraciones/`. No las corras de nuevo al montar un proyecto limpio desde
> `db/base/` salvo `db/migraciones/db/migraciones/schema-v2.sql` y las que `BOT-PJUD.md` pida.

## Paso 2: Obtener la anon key

1. Abre: `https://supabase.com/dashboard/project/<ID>/settings/api`
2. Copia la key que dice **"anon"** (la pública, NO la service_role)
3. La necesitas para el paso 3

## Paso 3: Deploy en Vercel

O manualmente:

1. Sube este proyecto a un repositorio en GitHub
2. Ve a https://vercel.com/new
3. Importa el repositorio
4. En "Environment Variables" agrega:

| Variable | Valor |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ID>.supabase.co` (tu proyecto verificado) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (la anon key del paso 2) |
| `SUPABASE_SERVICE_ROLE_KEY` | (tu service role key — Settings → API → `service_role`) |
| `NEXT_PUBLIC_REPORTE_TOKEN` | secreto largo y aleatorio. Es el token que aceptan los reportes Word **y** las rutas que escriben/borran (`/api/admin/reset`, `/api/upload`, `/api/config`). Va en el bundle del navegador a propósito: es "puerta cerrada", no secreto fuerte. |
| `REPORTE_API_TOKEN` | (opcional, recomendado) secreto **solo server-side** para llamadas privilegiadas. Si no se define, cae a `BOT_API_TOKEN` → `SUPABASE_SERVICE_ROLE_KEY`. |

> ⚠️ **NUNCA** pegues la `service_role` key en este archivo ni en ningún archivo versionado.
> Es la llave maestra de tu base de datos. Va solo en las Environment Variables de Vercel.
> Genera los tokens con: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`

> 🔒 Todas las rutas que borran o escriben en masa son **fail-closed**: si no hay ningún
> token configurado, rechazan la llamada (ver `src/lib/apiAuth.ts`). Un proyecto desplegado
> sin `NEXT_PUBLIC_REPORTE_TOKEN` deja el panel sin botón de borrado, no expuesto.

5. Click **Deploy**
6. ¡Listo! Tu app estará en una URL tipo: `causaspro-xxxxx.vercel.app`

## Después del deploy:

1. Abre tu app en el navegador
2. Arrastra tu Excel de causas
3. Espera a que procese
4. ¡Verás tu dashboard con todas las causas rankeadas por urgencia!


---

## 🤖 Ejecutar el Bot PJUD en Windows

El bot se corre **SOLO LOCAL** en la PC: el portal PJUD bloquea IPs de nube, por eso el
workflow de GitHub Actions quedó sin cron (solo disparo manual de respaldo).

Los scripts `.bat` contienen secretos (RUT, contraseña PJUD, service role key), por eso
**NO se versionan** (están en `.gitignore`). Se usan plantillas `.bat.example`:

1. Copia la plantilla y quítale el `.example`:
   ```cmd
   copy bot-100-causas.bat.example bot-100-causas.bat
   ```
2. Configurar tus datos (una sola vez): **doble clic en `bot-mantenimiento.bat`**. Te pide
   RUT, Clave Única y service role key, y los guarda en `.env`. **No hay que editar
   ningún archivo con el Bloc de notas**: los dos `.bat` leen `.env`.
   ```cmd
   copy /y bot-mantenimiento.bat.example bot-mantenimiento.bat
   ```
3. Preparar el proyecto (una vez):
   ```cmd
   npm install
   npx playwright install chromium
   ```
4. Ejecutar:
   - **Carga inicial** — doble clic en `bot-100-causas.bat` → 100 causas en 4 tandas de
     33, con 15 min de descanso entre tandas. No cierres la ventana hasta
     `PROCESO COMPLETO`.
   - **Día a día** — doble clic en `bot-mantenimiento.bat` → 25 causas, una tanda, solo
     entre 6 y 18 h (hora Chile).
   - Ajustes (tamaño de tanda, descanso, horario): ver `BOT-PJUD.md`.

### 🔴 IMPORTANTE — Rotar las keys expuestas

Versiones anteriores de estos `.bat` (y del `DEPLOY.md`) tenían la **service role key**
escrita en texto plano y quedaron en el historial de git. Por seguridad, **rota la key**
(y verifica si ya se hizo antes de dar el panel público):

1. Supabase → Settings → API → **Reset** de la `service_role` key (genera una nueva).
2. Actualiza el nuevo valor en: el `.env` local de la PC y las env vars de Vercel.
3. La key vieja queda invalidada — aunque siga en el historial, ya no sirve.

> La contraseña de Clave Única no estaba en el repo (era un placeholder `CAMBIAR_*`),
> pero igual conviene no reutilizarla en archivos versionados.
