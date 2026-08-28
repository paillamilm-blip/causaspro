---
name: claude-skill-web-clone
description: >
  Metodologia para clonar fielmente cualquier sitio web (estatico / React / WebGL)
  sin copiar codigo inventado por IA. Fuente real primero. Usa cuando el usuario dice
  clonar sitio, reproducir pagina, copiar web, fiel al original, replicar exacto,
  mirror site. Cubre sitios estaticos, React/Vue/Next, y WebGL/Canvas/Three.js pesados.
triggers:
  - clonar sitio
  - clone website faithfully
  - reproducir pagina
  - mirror site
  - copiar web fielmente
  - replicar exacto
  - web clone real source
allowed-tools:
  - Bash
  - Read
  - Write
  - Browser
metadata:
  source: https://github.com/Jane-xiaoer/claude-skill-web-clone
  stars: 971
  language: JavaScript
  license: MIT
  author: jane (xiaoer)
  version: "1.6.0"
---

# Web Clone - Metodologia de Clonacion Fiel

Convierte "clonar un sitio" en un flujo repetible y verificable. La regla de oro:
**fuente real primero, jamas confiar en codigo inventado por IA**.

## Regla #1: Codigo Real, No Alucinaciones

> Cualquier analisis generado por IA puede tener conceptos correctos en prosa,
> pero los bloques de codigo ejecutable son potencialmente inventados. Deben
> verificarse linea por linea contra la fuente real antes de usar.

**Evidencia (caso marbles):** Un analisis IA invento "ray-marching + SDF + DOM como textura"
cuando la arquitectura real era "calculo analitico rayo-esfera + displacement map para SVG
feDisplacementMap que distorsiona DOM real". Dos implementaciones completamente distintas.

## Decision Tree (seguir en orden, no saltear)

### Step 0 - Crear estructura estandar

Crear directorio del proyecto clone con:
- `NOTES.md` (metadatos, stack, licencia, mapa de reemplazo)
- `RECON/screenshots/` (capturas comparativas)

### Step 1 - Buscar codigo fuente en GitHub PRIMERO

```bash
# Buscar por nombre de sitio/producto
gh api "search/repositories?q=<keywords>" \
  | jq -r '.items[] | "\(.full_name) - \(.stargazers_count) - \(.description)"' | head -10
```

- Sitio single-file (github.io / HTML puro) → `curl -sL` el raw
- **Si encontras fuente con licencia compatible → skip directo a Step 4 (clone)**
- Esto ahorra 30+ minutos de trabajo innecesario

### Step 2 - Sin fuente? Reconocimiento con browser

Ejecutar probes automatizados para detectar:
- Framework (React/Vue/Next/Astro/vanilla)
- WebGL/Canvas/Three.js presente
- Librerias de scroll (Lenis, Locomotive)
- Fonts, colores, responsive breakpoints

Capturas en 3 viewports: 1440 / 768 / 390

### Step 2.5 - Clasificacion de complejidad

| Nivel | Tipo |
|-------|------|
| L1 | Landing page estatica simple |
| L2 | Sitio multi-pagina con animaciones basicas |
| L3 | SPA con routing + API calls |
| L4 | Animaciones complejas + scroll-driven |
| L5 | WebGL/Canvas interactivo |
| L6 | WebGL pesado + fisica custom + shaders |

Elegir modo:
- **Fiel** = clonar fuente real byte por byte
- **Visual** = recrear la apariencia con stack moderno
- **Contenido** = mantener estructura/DNA visual, reemplazar contenido

### Step 3 - Elegir ruta segun resultado

| Resultado del recon | Ruta |
|---------------------|------|
| HTML/CSS estatico sin framework | `wget --mirror` → limpiar tracking → editar |
| React/Vue/Next (contenido) | Reconstruir template, inyectar contenido |
| SPA / SaaS / data-driven | Capturar API fixtures → mock server local |
| Multi-pagina | Route crawl → template por tipo → reemplazar |
| Interacciones complejas | Interaction probe → implementar por estado |
| **WebGL/Canvas/Three.js** | **Reverse engineering real → fiel o template 3D** |
| Sitio estatico construido (Astro/Vite/Hugo) | Mirror completo de assets → self-host |

### Step 4 - Montar proyecto en el workspace

```bash
mkdir ~/projects/website-clones/<nombre>-clone && cd $_
# Fuente git: clone. Single-file: copiar.
# Guardar copia read-only como baseline: index-original.html
# Verificar Node version, pinear .nvmrc
```

### Step 5 - Limpiar + Verificar

1. **Eliminar tracking**: Google Analytics (`gtag`/`googletagmanager`), pixels, heatmaps
2. **Escribir NOTES.md**: complejidad, modo, comparacion original vs clon, score
3. **Sitios complejos**: escribir TEARDOWN.md (tearing tecnico, referenciar lineas de fuente)
4. **Verificacion en browser** (obligatorio): servidor local → abrir → console sin errores → screenshot comparativo
5. **Scoring de fidelidad**: estructura / visual / interaccion / responsive / contenido / funcional

### Step 6 - Reemplazo de contenido

Reemplazar tres cosas:
- Texto (`index.html` / `data/*.json` / `content/*.md`)
- Media (`public/` / `assets/`)
- Colores de marca (CSS variables / Tailwind theme)

## Disciplina de Reverse Engineering (WebGL/Canvas)

Para sitios pesados de front-end, identificar **pilares tecnicos**:
- Rendering (WebGL/shaders)
- Compositing (SVG filter / multi-canvas / post-process)
- Fisica
- Interaccion
- Audio

### Tres reglas inviolables:

1. **Evidencia clasificada**: cada conclusion se marca como:
   - `SOURCE` = codigo fuente real / source-map / dump en runtime
   - `PARTIAL` = nombre/fragmento, pendiente verificacion
   - `GUESS` = estimacion visual / magic numbers
   - Sin marca = GUESS por defecto. No copiar hasta subir a SOURCE.

2. **No-compensation**: prohibido ajustar brillo/velocidad/posicion para tapar errores de timing/coordenadas/estado

3. **Baseline-first**: primero "replay raw minimo" con draw calls/shaders/uniforms reales → verificar frame-by-frame → RECIEN AHI refactorizar

## Licencia y Atribucion (verificar ANTES de clonar)

| Licencia | Que podes hacer |
|----------|-----------------|
| MIT / Apache / BSD | Modificar, deployar, mantener credito |
| **Sin LICENSE** | Solo aprendizaje local, atribuir, NO deployar |
| Propietaria | Solo lectura, no copiar, no deployar |

> "Que este en GitHub publico" NO es lo mismo que MIT.

## Productos Esperados

- `NOTES.md` - Fuente, stack, licencia, modo, scoring
- `RECON/screenshots/` - Comparativas original vs clon
- `TEARDOWN.md` - (sitios complejos) Analisis tecnico con referencias a lineas de fuente
- `CLONE_REPORT.md` - Comparacion automatizada original vs clon
- `CLONE_AUDIT.md` - Verificacion de tracking/brand residual

## Scripts Incluidos en el Repo Original

| Script | Funcion |
|--------|---------|
| `init-clone.mjs` | Crear esqueleto de proyecto |
| `recon-site.mjs` | Reconocimiento automatizado con Playwright |
| `asset-harvest.mjs` | Descargar imagenes/scripts/estilos del original |
| `network-capture.mjs` | Capturar XHR/fetch para fixtures locales |
| `mirror-site.mjs` | Mirror 1:1 de sitio estatico con browser real |
| `route-crawl.mjs` | Crawl de rutas internas con screenshots |
| `interaction-probe.mjs` | Probe automatizado de scroll/hover/click/drag |
| `sourcemap-hunt.mjs` | Buscar y extraer source maps |
| `compare-recon.mjs` | Generar CLONE_REPORT.md comparativo |
| `visual-diff.mjs` | Diff pixel-by-pixel con score |
| `audit-clone.mjs` | Auditar tracking/brand residual |
| `dna-scaffold.mjs` | Generar design-dna.json para modo visual |

## Limites de Capacidad

- **Alta fidelidad**: sitios estaticos, marketing pages, frontends de contenido, sitios con fuente accesible
- **Visual aceptable (simplificado)**: CMS backends, scroll narrativo complejo, WebGL/Canvas
- **No se clona por defecto**: login, pagos, search/recomendaciones, logica servidor, APIs propietarias, assets con copyright

## Caso Flagship

`marbles-clone/` - WebGL nativo + SVG Filter + fisica custom. Clon byte-por-byte fiel con TEARDOWN completo. Ejemplo de la rama "WebGL pesado".
