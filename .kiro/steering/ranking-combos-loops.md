---
inclusion: manual
---

# 🏆 Ranking de Combos y Loops (Top 9)

Guía de flujos de trabajo para usar con Kiro en CausasPro. Proviene del repo de skills
`paillamilm-blip/mis-skills` y se adapta acá con ejemplos del proyecto.

> **Combo** = pasos en fila (una sola pasada: A → B → C).
> **Loop** ⟳ = ciclo que se **repite hasta cumplir una meta** (le decís la condición de salida y Kiro itera solo).
> Para usar esta guía en una sesión, activala manualmente (es de inclusión `manual`, no carga sola).

---

## 📊 Tabla

| # | Nombre | Tipo | Qué hace |
|---|--------|------|----------|
| 1 | 🏗️ **CONSTRUIR** | combo | Crear algo grande de la idea a producción: pensar → planificar → especificar → construir de a pasos → revisar → deployar |
| 2 | 🔎 **INVESTIGAR** | combo | Traer info real de internet y sintetizarla (leer web/redes → extraer datos → resumir) |
| 3 | 🎨 **OBRA MAESTRA** | combo | Diseño de UI nivel pro en un comando (leer contexto → inteligencia de diseño → ejecutar → animar) |
| 4 | 🐛 **CAZA-BUGS** | loop ⟳ | Cazar un bug difícil: investigar → hipótesis → arreglar → probar → *si falla, repetir* hasta que el test pasa |
| 5 | 🛡️ **CONTROL** | loop ⟳ | Control de calidad de seguridad: buscar fallas → arreglar la más grave → volver a revisar, *hasta que no queden fallas graves* |
| 6 | ⚡ **CERO DEFECTOS** | loop ⟳ | Hacer rápido y simple → autoverificar que quedó completo → corregir, *hasta que está bien terminado de verdad* |
| 7 | 🚀 **PUBLICAR** | combo | Sacar a producción sin que nada se rompa: revisar a fondo → chequear seguridad → checklist → publicar → verificar |
| 8 | 📊 **REPORTE WEB** | combo | De una web a un informe automático: sacar datos → procesarlos en entorno seguro → armar informe visual |
| 9 | 🧹 **LIMPIAR** | loop ⟳ | Sacar lo que sobra del código: escanear bloat → simplificar → revisar, *hasta que no queda código de más* |

---

## 📖 Cada uno, aplicado a CausasPro

**1 · 🏗️ CONSTRUIR** — para una feature grande del proyecto.
> `"CONSTRUIR: el reporte Word descargable por causa"`

**2 · 🔎 INVESTIGAR** — research real de internet.
> `"Investigá en internet cómo hace Magnar legaltech los reportes de causas y resumí"`

**3 · 🎨 OBRA MAESTRA** — UI del dashboard nivel pro (la usuaria final es Paula, la abogada).
> `"OBRA MAESTRA el dashboard de causas urgentes"`

**4 · 🐛 CAZA-BUGS** ⟳ — bugs difíciles del bot PJUD.
> `"CAZA-BUGS: el bot cae en el panel de Corte Suprema al procesar la 2ª causa"`

**5 · 🛡️ CONTROL** ⟳ — control de calidad de seguridad (⚠️ manejamos datos de menores + Clave Única).
> `"Loop de CONTROL sobre CausasPro hasta cerrar las fallas graves"`

**6 · ⚡ CERO DEFECTOS** ⟳ — modo por defecto para tareas concretas.
> `"CERO DEFECTOS: agregá el filtro por materia en el dashboard"`

**7 · 🚀 PUBLICAR** — salir a producción (Vercel autodeploya al mergear en main).
> `"PUBLICAR"` (o `"Ultra review y ship it"`)

**8 · 📊 REPORTE WEB** — muy alineado al objetivo del proyecto (reportes tipo Magnar con causas reales del PJUD).
> `"REPORTE WEB: con los movimientos de esta causa, armá un informe descargable"`

**9 · 🧹 LIMPIAR** ⟳ — reducir deuda técnica del bot/dashboard.
> `"LIMPIAR el módulo de scraping del bot"`

---

## ⟳ Cómo funcionan los loops

Un loop no termina en un paso: se repite hasta la condición de salida.
```
🐛 CAZA-BUGS    → arreglar → probar         REPITE hasta que el test pasa
🛡️ CONTROL      → buscar fallas → arreglar   REPITE hasta que no queden fallas graves
⚡ CERO DEFECTOS → hacer → revisar            REPITE hasta que quedó bien terminado
🧹 LIMPIAR      → simplificar → revisar       REPITE hasta que no queda código de más
```

---

## 🗺️ Cuál usar según el momento

```
¿Qué necesito?
├── 💡 pensar algo grande ──── CONSTRUIR
├── 🔎 saber algo ──────────── INVESTIGAR
├── 🎨 UI que se vea pro ───── OBRA MAESTRA
├── 🐛 bug que no cede ─────── CAZA-BUGS ⟳
├── 🛡️ seguridad ───────────── CONTROL ⟳
├── ⚡ hacer una tarea ─────── CERO DEFECTOS ⟳
├── 🚀 salir a producción ──── PUBLICAR
├── 📊 datos → informe ─────── REPORTE WEB
└── 🧹 limpiar código ──────── LIMPIAR ⟳
```

---

*Fuente: `paillamilm-blip/mis-skills` (DOCUMENTO-MAESTRO.md · COMBINACIONES.md). Mantener alineado si el ranking cambia allá.*
