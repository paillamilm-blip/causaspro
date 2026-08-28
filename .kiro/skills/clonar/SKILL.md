---
name: clonar
description: >
  COMBO: Clonar cualquier sitio web con un solo comando. Combina la metodologia de
  fuente-real-primero (claude-skill-web-clone) con reconstruccion AI-powered en
  Next.js moderno (ai-website-cloner-template). Dos modos: FIEL (extraer codigo
  real) o RECREAR (rebuild como React/Tailwind moderno). Usar cuando el usuario
  dice clonar, clona, reproducir sitio, recrear diseno, copiar pagina, fiel al
  original, o rebuild this site.
triggers:
  - CLONAR
  - clonar sitio
  - clona este sitio
  - clonea esta pagina
  - clonear pagina
  - recrear este diseno
  - copia esta web
  - reproducir sitio
  - rebuild this site
  - clone this website
  - replicar pagina
allowed-tools:
  - Bash
  - Read
  - Write
  - Browser
metadata:
  type: combo
  combines:
    - ai-website-cloner-template
    - claude-skill-web-clone
  author: paillamilm-blip
---

# CLONAR - Combo de Clonacion Web

> Un comando. Cualquier sitio. Dos modos segun lo que necesites.

```
CLONAR [url]
CLONAR [url] --fiel
CLONAR [url] --recrear
```

## Que es esto?

Combo que fusiona dos metodologias complementarias:

| Componente | Aporta |
|-----------|--------|
| **claude-skill-web-clone** | Disciplina de fuente real, decision tree, reverse engineering WebGL, verificacion anti-alucinacion |
| **ai-website-cloner-template** | Pipeline de builders paralelos, extraction via getComputedStyle, specs como contratos, stack Next.js + shadcn |

## Dos Modos

### (A) FIEL - Extraer codigo fuente real

**Cuando usar:** queres el sitio exacto tal cual es, manteniendo el codigo original.

- Busca fuente en GitHub primero
- Si la encuentra: clone directo, limpiar tracking, listo
- Si no: mirror completo / reverse engineer del DOM real
- NUNCA confiar en codigo generado por IA sin verificar contra fuente
- Resultado: copia funcional 1:1 del original

**Ideal para:** aprender de implementaciones reales, archivar sitios, auditar competencia.

### (B) RECREAR - Rebuild moderno con AI

**Cuando usar:** queres la apariencia/funcionalidad del sitio pero con stack moderno y limpio.

- Reconocimiento visual + extraccion CSS computado exacto
- Reconstruccion en Next.js + shadcn/ui + Tailwind v4
- Spec files para cada componente antes de construir
- Builders paralelos en worktrees
- Resultado: clon pixel-perfect en stack moderno, listo para modificar

**Ideal para:** punto de partida para tu propio proyecto, aprender patterns de UI, prototipar rapido.

---

## Workflow Paso a Paso

### Step 0 - Parsear Intent

```
Input del usuario: "CLONAR https://ejemplo.com"
```

Preguntar modo si no fue especificado:

> Dos opciones para clonar este sitio:
>
> **(A) FIEL** - Extraer el codigo fuente real tal cual esta.
> Resultado: copia funcional identica al original.
>
> **(B) RECREAR** - Reconstruir como proyecto Next.js moderno.
> Resultado: mismo look, stack limpio, listo para personalizar.
>
> Cual preferis?

Si el usuario dice "fiel", "exacto", "tal cual", "mirror" → modo A.
Si dice "recrear", "moderno", "React", "rebuild", "personalizar" → modo B.
Si dice "CLONAR" sin especificar → preguntar.

---

### Step 1 - Reconocimiento (ambos modos)

1. **Buscar fuente en GitHub** (siempre primero, ahorra 30 min):
   ```bash
   gh api "search/repositories?q=<nombre-sitio>" \
     | jq -r '.items[] | "\(.full_name) \(.stargazers_count)* \(.description)"' | head -10
   ```

2. **Recon con browser** (si no hay fuente o modo B):
   - Screenshot 1440px + 390px
   - Detectar: framework, WebGL, scroll libs, fonts, paleta
   - Interaction sweep: scroll, click, hover

3. **Clasificar complejidad** (L1-L6):
   | L1 | Landing estatica | L4 | Scroll-driven complejo |
   | L2 | Multi-page + animaciones | L5 | WebGL/Canvas interactivo |
   | L3 | SPA + API | L6 | WebGL pesado + fisica |

4. **Verificar licencia**:
   - MIT/Apache/BSD → OK para clonar y deployar
   - Sin licencia → Solo aprendizaje local, no deployar
   - Propietaria → Solo lectura

---

### Step 2A - Ruta FIEL

Si encontraste fuente en GitHub:
```bash
git clone <repo> ~/projects/website-clones/<nombre>-clone
cd ~/projects/website-clones/<nombre>-clone
# Limpiar tracking (gtag, pixels, heatmaps)
# Escribir NOTES.md
# Verificar en browser: npm run dev → abrir → console limpia → screenshot
```

Si NO hay fuente:
1. Segun tipo de sitio:
   - Estatico → `wget --mirror` o `mirror-site.mjs`
   - SPA → capturar network fixtures + rebuild parcial
   - WebGL → reverse engineering con disciplina de 3 reglas:
     - Clasificar evidencia (SOURCE/PARTIAL/GUESS)
     - No-compensation (no tapar errores con ajustes cosmeticos)
     - Baseline-first (raw replay antes de refactorizar)

2. Verificacion obligatoria en browser (no "deberia funcionar")
3. Generar CLONE_REPORT.md comparativo

---

### Step 2B - Ruta RECREAR

1. **Foundation** (secuencial):
   - Configurar fonts en layout.tsx
   - Design tokens como CSS variables
   - TypeScript interfaces para contenido
   - Descargar assets reales del sitio

2. **Component Specs** (escribir ANTES de construir):
   ```
   docs/research/<site>/components/<nombre>.spec.md
   ```
   Cada spec incluye: CSS exacto via getComputedStyle, estados + transiciones,
   contenido textual verbatim, assets necesarios, responsive behavior.

3. **Builders paralelos** (despachar en worktrees):
   - Seccion simple (1-2 componentes) → 1 builder
   - Seccion compleja (3+ componentes) → 1 builder por sub-componente
   - Verificar `npx tsc --noEmit` en cada builder

4. **Assembly**:
   - Importar secciones en orden
   - Implementar layout page-level
   - Conectar contenido real a props
   - Verificar: `npm run build`

5. **Visual QA Diff**:
   - Comparar original vs clon a 1440px y 390px
   - Testear interacciones (scroll, tabs, hover)
   - Arreglar discrepancias

---

### Step 3 - Entrega (ambos modos)

Checklist final:

- [ ] Sitio corre localmente sin errores de console
- [ ] Screenshots comparativos original vs clon guardados
- [ ] NOTES.md completo (fuente, licencia, modo, scoring)
- [ ] Tracking eliminado (GA, pixels, heatmaps)
- [ ] Si modo FIEL: evidencia clasificada (no hay GUESS sin documentar)
- [ ] Si modo RECREAR: build pasa limpio (`npm run build`)
- [ ] Licencia verificada y respetada

---

## Reglas Criticas (de ambas metodologias)

### De claude-skill-web-clone:
- **Fuente real primero** - Siempre buscar GitHub antes de reconstruir
- **Anti-alucinacion** - Codigo generado por IA se verifica contra fuente real
- **Evidencia clasificada** - SOURCE / PARTIAL / GUESS. Sin marca = GUESS
- **No-compensation** - No tapar bugs con ajustes cosmeticos
- **Verificacion en browser** - Obligatoria, no vale "deberia andar"

### De ai-website-cloner-template:
- **Completitud > velocidad** - Builders reciben todo, no adivinan nada
- **Tareas pequenas** - Componentes enfocados, no secciones enteras
- **CSS exacto** - `getComputedStyle()`, no "se parece a text-lg"
- **Spec antes de build** - Sin spec = sin despacho
- **Build siempre compila** - tsc + build despues de cada merge

---

## Ejemplo de Uso

```
Usuario: "CLONAR https://linear.app --recrear"

Kiro:
1. Busco en GitHub... encontrado: linearapp/linear (privado). Sin fuente publica.
2. Recon: Next.js, Tailwind, animaciones scroll-driven, dark mode. Complejidad L3.
3. Licencia: propietaria. Solo uso local/aprendizaje.
4. Foundation: fonts (Inter), tokens (oklch palette), types creados.
5. Specs: Hero.spec.md, Features.spec.md, Pricing.spec.md, Footer.spec.md
6. Builders despachados: 8 componentes en paralelo.
7. Assembly: page.tsx conectado, smooth scroll configurado.
8. QA: 2 discrepancias encontradas y corregidas.
9. Build: npm run build OK.
10. Screenshots comparativos guardados.

Resultado: clon funcional en ~/projects/website-clones/linear-clone/
Score fidelidad: visual 9/10, interaccion 8/10, responsive 9/10
```

---

## Skills Referenciadas

- `kiro-skills/08-automatizacion/ai-website-cloner-template/` - Pipeline de reconstruccion AI
- `kiro-skills/08-automatizacion/claude-skill-web-clone/` - Metodologia fuente-real
- `kiro-skills/08-automatizacion/browse/` - Browser automation para recon
- `kiro-skills/08-automatizacion/scrape/` - Extraccion de datos complementaria
