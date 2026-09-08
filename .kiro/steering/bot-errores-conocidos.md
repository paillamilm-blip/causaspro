# 🧠 Bitácora de errores conocidos del Bot PJUD

Registro vivo de problemas encontrados en el bot de scraping (portal Oficina Judicial
Virtual — `oficinajudicialvirtual.pjud.cl`) y sus soluciones, para **no repetir el mismo
error dos veces**.

> **Regla:** cada vez que se resuelve un problema nuevo del bot, agregar una entrada aquí
> (y también actualizar el learning global de Kiro). Ordenar de más reciente a más antiguo.

---

## ERROR #1 — 🔴 CAPTCHA al buscar en el portal

**Síntoma:** el portal muestra un CAPTCHA (o bloquea) durante el login o la búsqueda de
causas. La búsqueda no devuelve resultados o pide verificación humana.

**Causa raíz:** el PJUD detecta comportamiento de bot — búsquedas demasiado rápidas,
demasiadas causas por sesión, o patrón no humano. Contexto: en julio 2026 un abogado
colapsó el sistema con 38.000 escritos automatizados, así que el portal vigila bots
activamente.

**Soluciones / mitigaciones (prevención):**
- ✅ **NO subir** el límite de ~25 causas por sesión (`maxCausasPorSesion`). Es el freno anti-detección más importante.
- ✅ Mantener **delays aleatorios** de 10–25 s (o más) entre acciones (`delayMin`/`delayMax`).
- ✅ Operar **solo en horario laboral chileno (8–18 h)** — el bot ya lo valida (`isWithinAllowedHours`).
- ✅ **Tipeo humano** carácter por carácter con velocidad variable (ya implementado en `login.ts`).
- ✅ Repartir el trabajo en **varias corridas al día** (cron de GitHub Actions) en vez de una masiva.

**Solución (cuando YA apareció el CAPTCHA):**
1. **Esperar 1–2 horas** y reintentar (la marca de sospecha caduca).
2. Si persiste: hacer **login manual una vez** en el navegador con esas credenciales para "limpiar" la marca.
3. Verificar que no se haya subido el límite de causas por sesión sin querer.

**Estado del código:**
- Hay selectores de CAPTCHA en `src/bot/config/index.ts` → `OJV_SELECTORS.captcha`.
- ⚠️ **Pendiente:** la detección *activa* del CAPTCHA en el flujo `login`/`search` no está
  completamente implementada. Hoy el bot puede seguir a ciegas si aparece. Mejora propuesta:
  detectar el selector de CAPTCHA, **abortar la sesión limpiamente** y registrar el motivo
  en `bot_runs` (en vez de fallar de forma opaca o insistir y empeorar el bloqueo).

---

## Notas de arquitectura relevantes al scraping

- **Qué causas revisa el bot:** el `orchestrator.ts` actual **lista todo el portal**
  (filtros Tipo Causa 5/5, Estado 12/12, y años) y **crea causas nuevas** en la BD si no
  existían. Los filtros 5/5 y 12/12 **NO limitan** — traen *todo* para no perder causas.
- Existe `getCausasToScrape()` en `supabaseSync.ts` que leería **solo las causas ya cargadas**
  (por Excel) para revisar únicamente esas, pero **no se usa** en el flujo principal.
  *(Decisión de negocio pendiente: revisar solo causas cargadas vs. todo el portal.)*
- **Nunca navegar por URL directa ni `history.back()`** después del login: el portal OJV
  pierde la sesión. Siempre navegar con clicks en los menús internos.
