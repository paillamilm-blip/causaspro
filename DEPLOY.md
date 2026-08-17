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
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1d3V5cXB4YWliYnFqcnZhbWpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQ0MDU5MSwiZXhwIjoyMDk3MDE2NTkxfQ.ph3_VmsRrCANVnPPwHXYFbSxf2Hwyrz1yfp9cGj7pts` |

5. Click **Deploy**
6. ¡Listo! Tu app estará en una URL tipo: `causaspro-xxxxx.vercel.app`

## Después del deploy:

1. Abre tu app en el navegador
2. Arrastra tu Excel de causas
3. Espera a que procese
4. ¡Verás tu dashboard con todas las causas rankeadas por urgencia!
