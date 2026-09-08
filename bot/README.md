# 🤖 CausasPro Bot PJUD (Nova Act)

Bot único del proyecto. Automatiza la consulta de causas en la
**Oficina Judicial Virtual** del PJUD usando **Nova Act** (IA que maneja el
navegador con instrucciones en español, resistente a cambios del portal).

## Qué hace (v3)

1. **Login** en el portal vía Clave Única.
2. Va a **Mis Causas → Familia** y activa filtros.
3. Lee las **causas cargadas** en Supabase (las que subiste por Excel) y busca
   **cada una por su RIT exacto** (tipo + rol + año) → evita el CAPTCHA que
   dispara el listado masivo.
4. **Entra al detalle** de cada causa (clic en la lupa) y copia:
   - **Historial completo de movimientos** (fecha, etapa, trámite, descripción)
   - **Todas las audiencias** (fecha, tipo, sala, estado)
   - Detecta **"TRASLADO AL CURADOR"** → marca la causa como urgente
5. Guarda todo en Supabase (tablas `movimientos`, `audiencias`, `bot_logs`).

## Requisitos

- **Python 3.10+**
- `pip install nova-act pydantic`
- Una **API key de Nova Act**

## Variables de entorno

| Variable | Descripción |
|----------|-------------|
| `PJUD_RUT` | RUT del usuario (ej: `17692174-9`) |
| `PJUD_PASSWORD` | Contraseña de Clave Única |
| `NEXT_PUBLIC_SUPABASE_URL` | URL de Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key de Supabase |
| `NOVA_ACT_API_KEY` | API key de Nova Act |
| `LIMITE_CAUSAS` | (Opcional) limitar cuántas causas revisar, útil para pruebas |

> ⚠️ **Seguridad:** nunca pongas estas credenciales en el código ni las subas a
> git. Úsalas como variables de entorno.

## Uso

### Windows (CMD)
```cmd
set PJUD_RUT=17692174-9
set PJUD_PASSWORD=tu_clave_unica
set NEXT_PUBLIC_SUPABASE_URL=https://TU_PROYECTO.supabase.co
set SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key
set NOVA_ACT_API_KEY=tu_api_key_nova
set LIMITE_CAUSAS=3
python bot\bot_pjud.py
```

### Requisito de base de datos
Antes de la primera corrida, ejecuta en el SQL Editor de Supabase:
- `schema.sql` (tablas base: causas, audiencias, ...)
- `schema-bot.sql` (tablas `movimientos`, `bot_logs`, `bot_runs` + vista de urgencia)

## Prueba recomendada
Empieza con `LIMITE_CAUSAS=3` para revisar solo 3 causas y confirmar que el
login, la búsqueda por RIT y la lectura del detalle funcionan, antes de correr
la cartera completa.
