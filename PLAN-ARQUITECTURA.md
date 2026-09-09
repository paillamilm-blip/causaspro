# 🗺️ Plan de Arquitectura — CausasPro

> Micro SaaS que monitorea causas judiciales chilenas (parte por **Familia**, luego
> escala a Civil, Laboral, Corte Suprema, etc.). El bot revisa el portal PJUD
> (Oficina Judicial Virtual) y entrega un reporte inteligente al abogado/curador.

## 🧠 Filosofía: arquitectura híbrida (mapa + cerebro)

La visión del producto separa dos roles con claridad:

| Rol | Herramienta | Por qué |
|-----|-------------|---------|
| **El "mapa"** — pasos mecánicos y repetitivos (login, navegar, buscar, copiar datos) | **Playwright** (código) | El portal PJUD es estable y no cambia a diario. Un mapa fijo es más **rápido, gratis y confiable** que una IA para caminos conocidos. |
| **El "cerebro"** — analizar, interpretar y priorizar | **IA** (espacio pequeño) | Aquí la IA sí aporta: leer un movimiento judicial y decidir "esto es urgente" o "esto es rutina". Es lo que hace **vendible** el producto. |

**Principio clave:** darle a la IA un espacio **pequeño y controlado** (solo análisis),
no que maneje el navegador. Así es barato, rápido y escalable. Si la IA falla, el
scraping ya guardó todos los datos igual.

```
┌─────────────────────────────────────────────┐
│  PLAYWRIGHT (el mapa) — rápido, gratis, fijo  │
│  • Login Clave Única                          │
│  • Ir a Mis Causas → Familia                  │
│  • Buscar cada causa por su RIT (anti-CAPTCHA)│
│  • Abrir detalle y copiar movimientos/audienc.│
│  • Guardar en Supabase                        │
└──────────────────┬──────────────────────────┘
                   │ datos crudos ya guardados
                   ▼
┌─────────────────────────────────────────────┐
│  IA (el cerebro) — "espacio pequeño"          │
│  • Lee los movimientos guardados              │
│  • ¿Traslado al curador? ¿Audiencia próxima?  │
│  • Prioriza: 🔴 urgente / 🟡 atención / 🟢 al día│
│  • Alimenta el reporte inteligente            │
└─────────────────────────────────────────────┘
```

## 📋 Fases (cada una se prueba antes de seguir)

### FASE 0 — Preparar el terreno
- Confirmar tablas en Supabase: `causas`, `movimientos`, `audiencias` (ya existen).
- 🔴 **Rotar la `service_role` key** de Supabase (quedó expuesta en el historial de git).
- Confirmar credenciales PJUD.
- **Regla:** no tocar el bot hasta que BD + claves estén 100% ok.

### FASE 1 — El "mapa": Playwright scrapea (SIN IA) ← *estamos aquí*
- Login Clave Única → Mis Causas → Familia → buscar RIT → abrir detalle → copiar
  movimientos y audiencias → guardar en Supabase. **Cero IA.**
- Búsqueda **por RIT individual** (tipo + rol + año) para evitar el CAPTCHA que
  dispara el listado masivo (~17.500 registros).
- **Cómo no fallar:** probar con **1 causa** (modo visible) → luego 3 → luego todas.
- **Entregable:** la tabla `movimientos` se llena con datos reales, rápido y gratis.

### FASE 2 — El "cerebro": la IA interpreta (espacio pequeño)
- Función separada que lee los movimientos YA guardados y decide urgencia.
- La IA **nunca** toca el navegador; solo lee datos y escribe conclusiones.
- Reutiliza la lógica de `detection.ts` (traslado al curador, plazos, audiencias) y
  añade interpretación con IA donde el texto sea ambiguo.

### FASE 3 — El reporte (lo vendible)
- Pantalla/reporte priorizado: *"Tienes 47 causas. 3 urgentes: atiende estas hoy."*
- **Cómo no fallar:** empezar simple (lista priorizada), no sobre-diseñar.

### FASE 4 — Escalar a otras materias (Civil, Laboral, Corte Suprema...)
- Reutilizar el "mapa" (Playwright) y enseñarle a la IA a interpretar la materia nueva.
- **Cómo no fallar:** una materia a la vez, validando cada una antes de la siguiente.

## 🛡️ Reglas de oro para NO fallar

1. **Probar de a poco:** 1 causa → 3 → todas. Nunca saltar directo a producción.
2. **Ultra Review antes de cada push.**
3. **Separar mapa de cerebro:** si la IA se cae, el scraping sigue funcionando.
4. **Modo visible para depurar, invisible para producción.**
5. **No mezclar fases:** terminar y validar una antes de la siguiente.
6. **Nunca subir secretos a git** (usar variables de entorno / GitHub Secrets).

## 🔧 Estado técnico actual

- El bot **Playwright** vive en `src/bot/` y ya incluye:
  - `login.ts` — login vía Clave Única (stealth, tipeo humano).
  - `search.ts` — búsqueda por RIT individual anti-CAPTCHA + navegación a detalle.
  - `scraper.ts` — extrae movimientos, audiencias, resoluciones.
  - `detection.ts` — detecta TRASLADO AL CURADOR, plazos fatales, audiencias próximas.
  - `supabaseSync.ts` — guarda en la BD (con `getCausasToScrape` para revisar solo
    las causas ya cargadas por Excel).
  - `orchestrator.ts` — orquesta el flujo (modo `rit` por defecto = anti-CAPTCHA).
- Ejecutable con `npm run bot` (y `npm run bot:test` para 1 causa visible).
- Hubo un experimento paralelo en Python + Nova Act (PR #9), **descartado** a favor
  de la arquitectura híbrida: el scraping mecánico se queda en Playwright (más rápido
  y gratis para un portal estable), y la IA se reserva solo para el análisis (Fase 2).

## 🎯 Por qué esto ayuda a vender y escalar

- **Costo bajo:** la IA solo se usa en el análisis, no en cada clic → ~10x menos gasto.
- **Rápido:** el scraping vuela con Playwright.
- **Escalable:** agregar Civil/Laboral reutiliza el mapa; solo se le enseña a la IA la
  materia nueva.
- **Vendible:** el diferenciador no es "tengo un bot", es *"mi IA te dice qué causa
  atender hoy"* — eso es lo que paga un abogado.
