---
name: ai-website-cloner-template
description: >
  Reverse-engineer and clone any website into a clean Next.js + shadcn/ui + Tailwind v4
  codebase using AI coding agents. Use when the user wants to clone, replicate, rebuild,
  reverse-engineer, or copy any website with pixel-perfect fidelity. Dispatches parallel
  builder agents in worktrees for maximum speed.
triggers:
  - clone website
  - replicate this site
  - rebuild this page
  - pixel-perfect clone
  - copy this website
  - reverse-engineer site
  - make a copy of this site
allowed-tools:
  - Bash
  - Read
  - Write
  - Browser
metadata:
  source: https://github.com/JCodesMore/ai-website-cloner-template
  stars: 33286
  language: JavaScript
  license: MIT
---

# AI Website Cloner Template

Reverse-engineer and rebuild cualquier sitio web como un clon pixel-perfect en Next.js moderno.

## Filosofia

No es un proceso de dos fases (inspeccionar y luego construir). Sos un **capataz en la obra**: mientras inspeccionas cada seccion de la pagina, escribis una spec detallada y se la pasas a un agente builder especializado. Extraccion y construccion pasan en paralelo.

## Stack Tecnico

- **Framework:** Next.js (App Router, React, TypeScript strict)
- **UI:** shadcn/ui (Radix primitives, Tailwind CSS v4, `cn()` utility)
- **Icons:** Lucide React + SVGs extraidos del sitio original
- **Deploy:** Vercel

## Principios Guia

1. **Completitud > Velocidad** - Cada builder recibe TODO lo que necesita. Si tiene que adivinar un color o font-size, fallaste en la extraccion.
2. **Tareas pequenas, resultados perfectos** - Un agente con "toda la seccion features" aproxima. Un agente con un componente enfocado + CSS exacto lo clava siempre.
3. **Contenido real, assets reales** - Extraer texto, imagenes, videos y SVGs reales del sitio. Esto es un clon, no un mockup.
4. **Foundation First** - Nada se construye sin: CSS global con design tokens, TypeScript types, y assets globales (fonts, favicons).
5. **Extraer como se VE y como se COMPORTA** - Un sitio no es un screenshot. Elementos se mueven, cambian, aparecen y desaparecen.
6. **Spec Files = Source of Truth** - Cada componente tiene su spec en `docs/research/` ANTES de despachar un builder.
7. **Build siempre debe compilar** - `npx tsc --noEmit` despues de cada builder. `npm run build` despues de cada merge.

## Workflow Completo

### Pre-Flight

1. Verificar herramienta de browser automation disponible (Chrome MCP, Playwright MCP, etc.)
2. Parsear y validar URLs objetivo
3. Verificar que el proyecto base compila: `npm run build`
4. Inventariar rutas existentes
5. Escribir output plan con site-key, page-key, rutas destino

### Fase 1: Reconocimiento

```
1. Screenshots full-page a 1440px (desktop) y 390px (mobile)
2. Extraccion global: fonts, colores, favicons, patrones UI globales
3. Interaction Sweep obligatorio:
   - Scroll sweep (header cambia? elementos animan? scroll-snap?)
   - Click sweep (tabs, botones, dropdowns)
   - Hover sweep (estados hover en cards, links, botones)
   - Responsive sweep (1440, 768, 390)
4. Page Topology: mapear todas las secciones top-to-bottom
```

### Fase 2: Foundation Build (secuencial)

1. Configurar fonts en `src/app/layout.tsx`
2. Mergear colores en `src/app/globals.css` como design tokens
3. Crear TypeScript interfaces para contenido
4. Extraer SVG icons como React components
5. Descargar assets al namespace correcto en `public/`
6. Verificar: `npm run build`

### Fase 3: Component Spec + Dispatch (paralelo)

Para cada seccion:

1. **Extraer** - Screenshot aislado + CSS via `getComputedStyle()` + contenido real + assets
2. **Escribir spec** en `docs/research/<site-key>/<page-key>/components/<name>.spec.md`
3. **Despachar builders** en worktrees paralelos
4. **Mergear** verificando build despues de cada merge

### Fase 4: Page Assembly

- Importar todos los section components
- Implementar layout page-level (scroll containers, sticky, z-index)
- Conectar contenido real a props
- Implementar comportamientos page-level (scroll-snap, Lenis, dark/light transitions)
- Verificar: `npm run build`

### Fase 5: Visual QA Diff

1. Comparar original vs clon section por section a 1440px
2. Comparar de nuevo a 390px
3. Testear TODAS las interacciones (scroll, click tabs, hover)
4. Arreglar discrepancias encontradas
5. Solo despues del QA pass se declara completo

## Extraction Script (CSS Exacto)

```javascript
// Ejecutar via browser MCP - reemplazar SELECTOR
(function(selector) {
  const el = document.querySelector(selector);
  if (!el) return JSON.stringify({ error: 'Not found: ' + selector });
  const props = [
    'fontSize','fontWeight','fontFamily','lineHeight','letterSpacing','color',
    'textTransform','backgroundColor','background',
    'padding','margin','width','height','maxWidth',
    'display','flexDirection','justifyContent','alignItems','gap',
    'gridTemplateColumns','borderRadius','border','boxShadow',
    'position','top','right','bottom','left','zIndex',
    'opacity','transform','transition'
  ];
  function extractStyles(element) {
    const cs = getComputedStyle(element);
    const styles = {};
    props.forEach(p => {
      const v = cs[p];
      if (v && v !== 'none' && v !== 'normal' && v !== 'auto' && v !== '0px')
        styles[p] = v;
    });
    return styles;
  }
  function walk(element, depth) {
    if (depth > 4) return null;
    return {
      tag: element.tagName.toLowerCase(),
      classes: element.className?.toString().split(' ').slice(0, 5).join(' '),
      text: element.childNodes.length === 1 && element.childNodes[0].nodeType === 3
        ? element.textContent.trim().slice(0, 200) : null,
      styles: extractStyles(element),
      children: [...element.children].slice(0, 20).map(c => walk(c, depth + 1)).filter(Boolean)
    };
  }
  return JSON.stringify(walk(el, 0), null, 2);
})('SELECTOR');
```

## Errores Comunes a Evitar

- NO construir tabs click-based cuando el original es scroll-driven (o viceversa)
- NO extraer solo el estado default (capturar TODOS los estados de tabs, scroll, hover)
- NO perder imagenes overlay/layered en un container
- NO aproximar clases CSS ("se ve como text-lg" es incorrecto si el valor computado difiere)
- NO dar scope demasiado grande a un builder agent
- NO saltear smooth scroll libraries (Lenis, Locomotive Scroll)
- NO despachar builders sin spec file escrito

## Estructura de Proyecto

```
src/
  app/              # Next.js routes
  components/       # React components
    ui/             # shadcn/ui primitives
    sites/          # Components por sitio clonado
  lib/utils.ts      # cn() utility
public/
  sites/            # Assets por sitio
docs/
  research/         # Specs y artefactos de investigacion
  design-references/ # Screenshots
scripts/            # Scripts de descarga de assets
```

## Resultado

Al completar, reportar:
- URL origen → ruta destino
- Total secciones construidas
- Total componentes creados
- Total spec files escritos
- Total assets descargados
- Estado del build (`npm run build`)
- Resultados del QA visual
