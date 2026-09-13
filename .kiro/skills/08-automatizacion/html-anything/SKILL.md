---
name: html-anything
description: >
  Editor HTML agentivo con preview sandboxed. Generar HTML para cualquier superficie:
  magazines, presentaciones, posters, prototipos, reportes de datos, tweets, posts XHS.
  75 skills x 9 superficies. Export 1-click a HTML/PNG/WeChat/X. Usar cuando el usuario
  dice generar html, crear reporte visual, hacer presentacion, disenar poster, crear
  magazine, data report, generar tweet visual, preview html, prototipo rapido, pagina
  html, landing rapida, o cualquier generacion de contenido HTML visual.
triggers:
  - generar html
  - crear reporte visual
  - hacer presentacion html
  - disenar poster
  - crear magazine
  - data report
  - reporte de datos
  - tweet visual
  - preview html
  - prototipo rapido
  - pagina html
  - landing rapida
  - export html
  - generar contenido visual
  - crear deck
allowed-tools:
  - Bash
  - Read
  - Write
  - Browser
metadata:
  type: skill
  source: https://github.com/nexu-io/html-anything
  stars: 8516
  language: HTML/TypeScript
  author: paillamilm-blip
---

# HTML-ANYTHING - Editor HTML Agentivo

> 75 skills. 9 superficies. El agente escribe HTML, vos lo shippeas.

```
"Genera un reporte de datos como magazine"
"Crea una presentacion de 5 slides en HTML"
"Diseña un poster para mi evento"
"Prototipo rapido de esta landing"
```

## Que es esto?

HTML-Anything es un editor donde el agente AI genera HTML listo para usar, con preview sandboxed (seguro, aislado) y export en 1 click. No necesitas API keys. Funciona con cualquier agente (Claude Code, Cursor, Codex, Gemini, etc.).

**En simple:** Le decis que queres, genera HTML profesional, lo ves en preview, y lo exportas.

## Las 9 Superficies

| # | Superficie | Que es | Ejemplo |
|---|-----------|--------|---------|
| 1 | **Magazine** | Articulo largo con layout editorial | Blog post visual, case study |
| 2 | **Deck** | Presentacion de slides | Pitch deck, clase, workshop |
| 3 | **Poster** | Imagen/pagina unica de impacto | Evento, producto, anuncio |
| 4 | **Prototype** | Wireframe/mockup interactivo | App screens, user flows |
| 5 | **Data Report** | Datos + graficos + narrativa | Dashboard, KPI report, analytics |
| 6 | **Hyperframes** | Multi-pagina navegable | Mini-sitio, documentacion |
| 7 | **XHS Post** | Formato Xiaohongshu (red social china) | Contenido visual tipo Instagram |
| 8 | **Tweet/X** | Formato Twitter/X | Thread visual, anuncio social |
| 9 | **Email** | Newsletter/email marketing | Campana, update, digest |

## 75 Skills de Generacion

Cada superficie tiene skills especificas. Algunos ejemplos:

| Skill | Superficie | Resultado |
|-------|-----------|-----------|
| `infographic` | Data Report | Infografia con datos reales |
| `comparison` | Magazine | Tabla comparativa visual |
| `timeline` | Deck | Linea de tiempo interactiva |
| `hero-section` | Prototype | Header de landing con CTA |
| `pricing-table` | Hyperframes | Pagina de precios |
| `social-proof` | Poster | Testimonios visuales |
| `chart-narrative` | Data Report | Graficos + texto explicativo |
| `step-by-step` | Magazine | Tutorial paso a paso |
| `before-after` | Tweet/X | Comparacion visual |
| `announcement` | Email | Email de lanzamiento |

## Setup (para desarrollo local)

```bash
# Clonar
git clone https://github.com/nexu-io/html-anything
cd html-anything

# Instalar dependencias
pnpm install

# Modo desarrollo
pnpm -F @html-anything/next dev

# Build produccion
pnpm -F @html-anything/next build

# E2E tests
pnpm -F @html-anything/next test:e2e
```

## Como Usarlo (sin instalar nada)

No necesitas clonar el repo para usar la funcionalidad. El agente genera HTML directamente:

### Modo Directo (el agente genera el HTML)

```
Usuario: "Genera un data report de las ventas de Q3"

Kiro:
1. Recibe los datos (o los extrae de donde indiques)
2. Elige superficie: Data Report
3. Genera HTML completo con graficos (Chart.js), tablas, narrativa
4. Lo muestra en preview sandboxed
5. Export: HTML file listo para abrir en cualquier browser
```

### Ejemplo de Output

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Reporte Q3 2025 - Ventas</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    /* Estilos profesionales generados */
    body { font-family: 'Inter', system-ui; max-width: 1200px; margin: 0 auto; }
    .chart-container { background: #f8fafc; border-radius: 12px; padding: 2rem; }
    /* ... */
  </style>
</head>
<body>
  <header>
    <h1>Reporte de Ventas Q3 2025</h1>
    <p class="subtitle">Resumen ejecutivo con metricas clave</p>
  </header>
  <section class="kpis"><!-- KPI cards --></section>
  <section class="charts"><!-- Graficos interactivos --></section>
  <section class="analysis"><!-- Texto narrativo --></section>
</body>
</html>
```

## Exports Disponibles

| Formato | Como | Para que |
|---------|------|----------|
| **HTML** | Archivo .html directo | Abrir en browser, hostear, compartir |
| **PNG** | Screenshot del render | Redes sociales, documentos |
| **PDF** | Print-to-PDF del HTML | Reportes formales |
| **WeChat/XHS** | Formato optimizado | Redes sociales chinas |
| **Twitter/X** | Formato optimizado | Posts con imagenes |

## Workflows Comunes

### 1. Reporte de Datos Automatico

```
Datos (CSV/JSON/API) → HTML-Anything (Data Report) → HTML con graficos → Export PNG/PDF
```

### 2. Presentacion Rapida

```
Ideas/bullets → HTML-Anything (Deck) → Slides HTML interactivos → Presentar en browser
```

### 3. Landing Page Prototipo

```
Descripcion del producto → HTML-Anything (Prototype) → HTML funcional → Iterar
```

### 4. Contenido para Redes

```
Mensaje clave → HTML-Anything (Tweet/Poster) → Visual profesional → Export PNG → Publicar
```

## Preview Sandboxed

El preview corre en un iframe aislado (sandboxed). Esto significa:

- **Seguro:** el HTML generado no puede acceder a tu maquina
- **Aislado:** no ejecuta scripts maliciosos
- **Instantaneo:** renderiza en tiempo real mientras el agente escribe
- **Fiel:** ves exactamente lo que se exporta

## Ventajas Clave

| Ventaja | Detalle |
|---------|---------|
| **Zero API keys** | No necesitas OpenAI, Anthropic, ni nada |
| **Cualquier agente** | Claude Code, Cursor, Codex, Gemini, Copilot |
| **Preview en vivo** | Ves el resultado mientras se genera |
| **1 archivo** | El output es un .html autocontenido |
| **Profesional** | Tipografia, colores, layout de nivel editorial |
| **Responsive** | Se ve bien en desktop y mobile |

## Reglas Criticas

1. **Siempre generar HTML autocontenido** - todo en un archivo (CSS inline o en head, assets via CDN)
2. **Usar CDN para librerias** - Chart.js, fonts, iconos via CDN (no dependencias locales)
3. **Preview antes de export** - siempre mostrar como se ve antes de entregar
4. **Responsive obligatorio** - todo debe verse bien en 390px y 1440px
5. **Accesible** - alt texts, contraste, semantica HTML correcta
6. **Sin tracking** - nunca incluir Google Analytics, pixels, ni heatmaps

## Ejemplo Completo

```
Usuario: "Haceme una presentacion de 5 slides sobre machine learning para mi equipo"

Kiro:
1. Superficie elegida: Deck (presentacion)
2. Skill: step-by-step + chart-narrative
3. Genero 5 slides HTML:
   - Slide 1: Titulo + agenda
   - Slide 2: Que es ML (diagrama)
   - Slide 3: Tipos de ML (comparacion visual)
   - Slide 4: Caso de uso del equipo (datos reales)
   - Slide 5: Proximos pasos (timeline)
4. Preview sandboxed: navegable con flechas
5. Export: archivo presentation.html (abrilo en Chrome, presentalo full-screen)

Resultado: presentacion profesional en 60 segundos, sin PowerPoint.
```

## Links

- Repo: https://github.com/nexu-io/html-anything
- 75 skills documentadas en el repo
- Stack: Next.js + pnpm workspace + Playwright E2E
