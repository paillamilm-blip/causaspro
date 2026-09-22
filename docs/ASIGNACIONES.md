# Cargar las causas asignadas por la jefa

## Para Paula: cómo se hace

1. Abrí el correo **ASIGNACIONES** que manda el Centro Regional NNA Metropolitana Norte.
2. Apretá **Ctrl + A** (selecciona todo) y después **Ctrl + C** (copia).
3. Entrá a **causaspro.vercel.app** y apretá el botón **📥 Asignaciones** (arriba a la derecha).
4. Hacé clic en el cuadro grande y apretá **Ctrl + V** (pega).
5. Apretá **🔍 Revisar**. Te muestra qué causas detectó y cuáles son nuevas. **Todavía no guarda nada.**
6. Si está todo bien, apretá **💾 Guardar**.

Sirve también con **correos viejos**: si una causa ya estaba cargada, no se duplica (solo le agrega la nota de la asignación y la audiencia nueva).

Después de guardar, las causas nuevas quedan **sin datos del portal**. Corré `bot-mantenimiento.bat` para que el bot les traiga los movimientos.

### Si dice que no encontró nada

Casi siempre es porque se copió solo una parte del correo. Volvé al correo y usá **Ctrl + A** antes de copiar, así se lleva la tabla completa.

---

## Para el desarrollador: por qué NO es automático

El módulo `src/email/` tiene un interceptor IMAP completo y funcionando… que **no puede conectarse al buzón de la curadora**.

Registros DNS de `cajmetro.cl` (verificado 22-sep-2026):

```
MX            → cajmetro-cl.mail.protection.outlook.com
autodiscover  → autodiscover.outlook.com
SPF           → include:spf.protection.outlook.com
```

El correo está en **Microsoft 365 (Exchange Online)**, y Microsoft [eliminó la autenticación básica](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/deprecation-of-basic-authentication-exchange-online) (usuario + contraseña) para IMAP y POP. `src/email/modules/imapClient.ts` se conecta justamente con `IMAP_USER` + `IMAP_PASSWORD`.

**No es un problema de configuración.** Ninguna combinación de `IMAP_HOST` o de contraseña lo resuelve: Exchange rechaza el método de autenticación, no las credenciales. Por eso el PR #81 (modo histórico) se cerró.

> No usar la vía de reenviar los correos a un Gmail y leerlos por IMAP: implica sacar datos de causas de protección de menores del correo institucional hacia una cuenta personal, y muchos tenants bloquean el reenvío externo igual.

### Qué se reutiliza

La pantalla de pegado **no reimplementa nada**. El flujo comparte el código con el interceptor:

```
Correo pegado → parseAsignaciones()   (src/email/modules/htmlParser.ts)
              → syncAsignaciones()    (src/email/modules/syncAsignaciones.ts)
              → Supabase
```

`parseAsignaciones()` intenta primero la tabla `<table>` del HTML y, si no la encuentra, cae a un parseo de texto plano línea por línea. Hace falta porque al pegar en un `<textarea>` el navegador conserva **solo el texto plano**: la pantalla rescata `text/html` del portapapeles en el `onPaste` y manda las dos versiones, y el servidor usa la que detecte más asignaciones.

### Formato del correo

```
RIT          | FECHA AUD  | FECHA ING  | CURADOR
P-8141-2026  | 20/08/2026 | 10/08/2026 | PAULA VARGAS
```

El parser tolera: guion largo (`–`, `&#8211;`) en el RIT, el curador partido en dos líneas por `<br>`, el encabezado completo de un correo reenviado (`Fw:`), el mismo RIT repetido (deduplica), las columnas de fecha invertidas (lo deduce del encabezado) y filas sin fecha de audiencia.

### Cuidado con `notas`

`notas` es un **canal compartido**. El bot guarda ahí marcas de las que depende su funcionamiento:

| Marca | Quién la lee | Para qué |
|---|---|---|
| `[NO EN PORTAL]` | `getCausasToScrape` + barra del dashboard | No reintentar causas que no existen en el portal |
| `[REVISAR: no scrapeada]` | `getCausasToScrape` | Idem, tras varios intentos fallidos |
| `[INTENTOS FALLIDOS: n]` | `supabaseSync` | Contador de reintentos |
| `[VÍNCULO]` / `[REVISAR LETRA]` | `supabaseSync` | Enlace entre causas hermanas P↔X |
| `[ASIGNACIÓN]` | este módulo | Rastro de la asignación por correo |

Cualquier escritura en `notas` debe **agregar, nunca reemplazar** (ver `agregarNota()` en `syncAsignaciones.ts`). Un `update({ notas: '...' })` directo borraría las marcas del bot y devolvería a la cola las causas ya descartadas.

### El día que TI habilite la automatización

Se necesita **Microsoft Graph con OAuth 2.0**: TI de cajmetro debe registrar una aplicación en Azure y aprobar el permiso `Mail.Read` (requiere admin del tenant). Solo habría que reemplazar la obtención de los correos — `parseAsignaciones` y `syncAsignaciones` quedan igual.
