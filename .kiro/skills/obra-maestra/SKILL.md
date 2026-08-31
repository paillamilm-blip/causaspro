---
name: obra-maestra
description: >
  COMBO POTENCIADO: Diseno frontend de nivel award, fusion de 4 skills en un solo
  pipeline. Combina taste-skill (leer el brief, dials anti-slop, elegir el sistema
  de diseno correcto), ui-ux-pro-max (inteligencia de diseno: 84 estilos, 192
  paletas, 74 font pairings, 98 guidelines UX), impeccable (barra de director de
  arte, modos Persuade/Operate/Read/Experience, paleta de comandos, verificacion
  acotada) y animate (movimiento con filosofia Emil Kowalski, solo donde se lo gana).
  4 fases encadenadas: LEER LA SALA -> INTELIGENCIA -> EJECUTAR Y REFINAR -> DARLE VIDA.
  Usar cuando el usuario dice disenar, diseno pro, obra maestra, landing, portfolio,
  rediseno, UI nivel award, redisenar, componente premium, o cualquier tarea donde
  el resultado tiene que verse, sentirse y moverse como diseno de verdad, no como
  output de IA.
triggers:
  - OBRA MAESTRA
  - DISENAR PRO
  - diseno pro
  - disena esto pro
  - landing anti-slop nivel award
  - redisena nivel award
  - UI nivel obra maestra
  - componente premium
  - pipeline de diseno
  - diseno potenciado
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Browser
metadata:
  type: combo
  combines:
    - taste-skill
    - ui-ux-pro-max
    - impeccable
    - animate
  author: paillamilm-blip
---

# OBRA MAESTRA - El Combo de Diseno Potenciado

> 4 skills. 1 pipeline. Diseno que no se ve hecho por IA, ejecutado con barra de director de arte, y que se mueve solo donde se lo gana.

```
OBRA MAESTRA [que disenar]
OBRA MAESTRA landing para [producto]
OBRA MAESTRA redisena [url/target]
OBRA MAESTRA componente [X] premium
```

---

## Que es esto?

La mayoria del diseno que produce un LLM es malo por la misma razon: salta directo a un default (purpura AI, Inter, hero centrado sobre mesh oscuro, tres cards iguales) sin leer lo que el usuario realmente quiere. Este combo existe para romper ese reflejo.

Fusiona 4 skills de diseno en un pipeline donde **cada una cubre una fase y se refuerzan entre si**:

| Fase | Skill | Aporta | Estrellas |
|------|-------|--------|-----------|
| 1. LEER LA SALA | **taste-skill** | Inferencia de brief, 3 dials, disciplina anti-slop, elegir el sistema de diseno correcto | Anti-slop frontend |
| 2. INTELIGENCIA | **ui-ux-pro-max** | La artesania real de UI/UX: 84 estilos, 192 paletas, 74 fonts, 98 guidelines, motion presets | Repo 122K ★ |
| 3. EJECUTAR Y REFINAR | **impeccable** | Barra de director de arte, 4 modos, paleta de comandos, verificacion acotada | Award-winning |
| 4. DARLE VIDA | **animate** | Movimiento con filosofia Emil Kowalski, solo donde se lo gana | Emil Kowalski |

**Potenciar no es concatenar.** El output de cada fase es el input de la siguiente: el design read (fase 1) elige el modo de impeccable (fase 3); los dials (fase 1) calibran los `--variance/--motion/--density` de ui-ux-pro-max (fase 2); el tier de motion (fase 2) le dice a animate (fase 4) cuanto presupuesto de movimiento hay; y la barra de calidad de impeccable (fase 3) audita que ninguna de las otras 3 haya dejado un default de IA.

---

## El Pipeline (4 fases)

```
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│ 1. LEER LA SALA │──▶│ 2. INTELIGENCIA │──▶│ 3. EJECUTAR+REF │──▶│ 4. DARLE VIDA   │
│  taste-skill    │   │  ui-ux-pro-max  │   │  impeccable     │   │  animate        │
│                 │   │                 │   │                 │   │                 │
│ design read     │   │ --design-system │   │ modo + comando  │   │ gate de motion  │
│ 3 dials         │   │ paleta/font/    │   │ craft-floor     │   │ transform+op    │
│ elegir sistema  │   │ estilo/layout   │   │ verif. acotada  │   │ reduced-motion  │
│ anti-default    │   │ 98 UX rules     │   │ refina/redisena │   │ solo si se gana │
└─────────────────┘   └─────────────────┘   └─────────────────┘   └─────────────────┘
     el "que"              el "con que"           el "como"            el "que se mueva"
```

---

## FASE 1 - LEER LA SALA (taste-skill)

**Antes de tocar codigo.** Inferir que quiere el usuario de verdad. Este es el paso que mas se salta y el que mas rompe el resultado.

### 1.1 Design Read (una linea, obligatorio)

Antes de generar nada, declara en una linea:

> **"Lo leo como: `<tipo de pagina>` para `<audiencia>`, con lenguaje `<vibe>`, tirando hacia `<sistema de diseno o familia estetica>`."**

Ejemplo: *"Lo leo como: landing B2B SaaS para compradores tecnicos, lenguaje minimalista tipo Linear, tirando hacia utilidades Tailwind + Geist + motion restringido."*

Si el brief es ambiguo y el read diverge de verdad, **una sola pregunta** ("mas Linear-limpio o mas Awwwards-experimental?"). Si podes inferir con confianza, no preguntes: declara el read y segui.

### 1.2 Los 3 Dials

| Dial | Rango | Que controla |
|------|-------|--------------|
| `DESIGN_VARIANCE` | 1 (simetria) → 10 (caos artistico) | Cuanto se aleja del layout centrado/simetrico |
| `MOTION_INTENSITY` | 1 (estatico) → 10 (cinematico) | Cuanto movimiento entra (alimenta la fase 4) |
| `VISUAL_DENSITY` | 1 (galeria de arte) → 10 (cockpit de datos) | Cuanto contenido por pantalla |

**Baseline `8 / 6 / 4`.** Calibra segun el read:

| Senal | VARIANCE | MOTION | DENSITY |
|------|----------|--------|---------|
| minimalista / calmo / editorial / Linear | 5-6 | 3-4 | 2-3 |
| premium consumer / Apple-y / lujo | 7-8 | 5-7 | 3-4 |
| playful / Awwwards / agencia / experimental | 9-10 | 8-10 | 3-4 |
| trust-first / sector publico / regulado / a11y-critico | 3-4 | 2-3 | 4-5 |
| dashboard / herramienta / producto (operativo) | 4-6 | 3-5 | 7-9 |

### 1.3 Anti-Default (la disciplina que rompe el reflejo de IA)

NO tirar por default a: gradientes purpura-AI, hero centrado sobre mesh oscuro, tres feature-cards iguales, glassmorphism en todo, micro-animaciones en loop infinito, `Inter + slate-900`, y (en briefs premium-consumer) la paleta beige+brass+espresso. Son los defaults del LLM. Alcanzalos solo si el read lo justifica de verdad.

### 1.4 Elegir el sistema de diseno (honestidad)

Si el brief matchea un sistema oficial, **instala y usa el paquete oficial** (no recrees su CSS a mano):

| El brief se lee como... | Alcanza |
|------|---------|
| Microsoft / enterprise SaaS | `@fluentui/react-components` |
| Material / producto Google-ish | `@material/web` + Material 3 |
| IBM / analitica B2B | `@carbon/react` |
| Sector publico UK / US | `govuk-frontend` / `uswds` |
| SaaS moderno donde vos sos dueno del codigo | shadcn/ui (`npx shadcn@latest add`) |
| SaaS/marketing Tailwind moderno (default indie) | Tailwind v4 + `dark:` |

Estetica (glassmorphism, bento, brutalism, editorial, kinetic type) **no es un sistema**: se construye con CSS nativo + Tailwind y se etiqueta como aproximacion. **Un solo sistema por proyecto.**

**Salida de la fase 1:** design read + valores de los 3 dials + sistema/estetica elegidos. Esto alimenta todo lo demas.

---

## FASE 2 - INTELIGENCIA DE DISENO (ui-ux-pro-max)

Con el read y los dials fijados, sacar las decisiones concretas de la base de datos de diseno: paleta, tipografia, estilo, layout, guidelines UX. **Los dials de la fase 1 se mapean directo a los flags de esta fase.**

### 2.1 Mapeo dials → flags

| Dial de fase 1 | Flag de ui-ux-pro-max |
|----------------|-----------------------|
| `DESIGN_VARIANCE` | `--variance <1-10>` |
| `MOTION_INTENSITY` | `--motion <1-10>` |
| `VISUAL_DENSITY` | `--density <1-10>` |

### 2.2 Generar el design system

```bash
# stack detectado del package.json / pubspec / etc. (nunca asumas el stack)
python "<skill-dir>/ui-ux-pro-max/scripts/search.py" \
  "<product> <industria> <keywords>" --design-system \
  --variance <VARIANCE> --motion <MOTION> --density <DENSITY> \
  -p "Nombre Proyecto" --persist --output-dir "<project-root>"
```

Esto devuelve pattern, estilo, colores, tipografia, efectos y anti-patterns, aplicando reglas de razonamiento reales. `--persist` guarda `design-system/<slug>/MASTER.md` como fuente de verdad (no lo pisa si ya existe salvo `--force`).

### 2.3 Deep-dives por dominio (segun haga falta)

```bash
python "<skill-dir>/ui-ux-pro-max/scripts/search.py" "<keyword>" --domain <domain>
```

`product`, `style`, `color`, `typography`, `google-fonts`, `landing`, `icons`, `gsap`, `ux`, `chart`, y `--stack <stack>` para guias especificas del framework.

### 2.4 Prioridades UX (1→10, la 1 primero)

| Prioridad | Categoria | Must-have |
|-----------|-----------|-----------|
| 1 | Accesibilidad | Contraste 4.5:1, alt text, teclado, aria-labels |
| 2 | Touch e interaccion | Target min 44×44px, feedback de loading |
| 3 | Performance | WebP/AVIF, lazy load, reservar espacio (CLS < 0.1) |
| 4 | Seleccion de estilo | Matchear product type, iconos SVG (no emoji) |
| 5 | Layout responsive | Mobile-first, sin scroll horizontal |
| 6 | Tipografia y color | Base 16px, line-height 1.5, tokens semanticos |
| 7 | Animacion | 150-300ms, el movimiento comunica sentido |

Si una busqueda devuelve 0 resultados: reintentar con keywords mas amplias, y si sigue vacio, decir explicitamente que la recomendacion viene de defaults, no de la DB. **Nunca inventar un resultado.**

**Salida de la fase 2:** paleta + tipografia + estilo + tokens de spacing + estructura de layout + preset de motion (tier Subtle/Standard/Complex). El preset de motion alimenta la fase 4.

---

## FASE 3 - EJECUTAR Y REFINAR (impeccable)

Ahora se construye, con barra de director de arte. La fase 3 toma el read (fase 1) y el design system (fase 2) y los ejecuta como codigo production-grade, despues verifica.

### 3.1 Elegir el modo (del design read)

El modo nombra que significa "exito" para el visitante en esa superficie:

| Modo | Superficie | El visitante... |
|------|-----------|-----------------|
| **Persuade** | landing, marketing, pricing | decide y actua. El diseno es el producto. |
| **Operate** | app, dashboard, editor, settings | completa una tarea. Escaneabilidad > expresion. |
| **Read** | docs, articulos, guias, changelog | entiende algo. Estructura para comprension. |
| **Experience** | portfolio, galeria, showcase | esta dentro de la obra. La interfaz se corre del medio. |

El modo sale de la **superficie pedida**, no del producto: la landing de una herramienta sigue siendo Persuade; la doc de una casa de moda sigue siendo Read.

### 3.2 Refinar vs Redisenar (regla dura)

- **Refinar preserva:** mantiene identidad, comportamiento, copy y todo lo fuera de scope. Es un ajuste sobre lo que existe.
- **Redisenar reemplaza:** conserva la verdad del producto (contenido, funcion, constraints) pero trata el look viejo como anti-referencia y elige un mundo visual nuevo.
- **Nunca partir la diferencia:** pulir sobre un look que ya decidiste descartar es fallar.

### 3.3 Paleta de comandos (aplicar el que pide el request)

| Comando | Categoria | Que hace |
|---------|-----------|----------|
| `shape` | Build | Planear UX/UI antes de escribir codigo |
| `critique` | Evaluate | Review de UX con scoring heuristico |
| `audit` | Evaluate | Chequeos tecnicos (a11y, perf, responsive) |
| `polish` | Refine | Pasada final de calidad antes de shipear |
| `bolder` / `quieter` | Refine | Subir o bajar la intensidad del diseno |
| `distill` | Refine | Sacar a la esencia, remover complejidad |
| `harden` | Refine | Errores, i18n, edge cases, production-ready |
| `animate` | Enhance | Movimiento con proposito → **delega a la FASE 4** |
| `colorize` / `typeset` / `layout` | Enhance | Color / tipografia / spacing y jerarquia |
| `delight` / `overdrive` | Enhance | Personalidad / empujar los limites |
| `clarify` | Fix | UX copy, labels, mensajes de error |
| `adapt` / `optimize` | Fix | Dispositivos / performance de UI |

### 3.4 Verificacion ACOTADA (no un loop infinito)

Este es el corazon de impeccable y lo que evita quemar tiempo:

```
build completo → inspeccionar UNA vez (desktop + mobile juntos, en batch)
             → arreglar TODO lo que muestra en un solo batch
             → confirmar con como maximo una ronda mas → PARAR
```

No hacer self-QA abierto. Construir del todo, inspeccionar una vez, arreglar en batch, confirmar, parar.

**Salida de la fase 3:** interfaz construida, verificada, con estados completos (loading, empty, error), lista para recibir movimiento.

---

## FASE 4 - DARLE VIDA (animate)

El movimiento entra al final, y **solo donde se lo gana**. `MOTION_INTENSITY` (fase 1) y el preset de motion (fase 2) definen el presupuesto; animate define el como.

### 4.1 El gate (produce cero lineas de codigo a veces, y esta bien)

| Frecuencia | Decision |
|-----------|----------|
| 100+ veces/dia (atajos de teclado, toggle de command palette) | **Sin animacion. Nunca.** |
| Decenas de veces/dia (hover, navegar listas) | Solo casi-imperceptible: rapido y sutil, o nada |
| Ocasional (modales, drawers, toasts) | Animacion estandar |
| Raro / primera vez (onboarding, exito, celebracion) | Aca vive el presupuesto de delight |

Nombrar el proposito en una palabra: **feedback, continuidad espacial, indicacion de estado, prevenir un cambio brusco, explicacion, o delight.** Si no podes nombrarlo, no lo construyas.

### 4.2 El tool mas barato que funciona

| Necesidad | Tool |
|-----------|------|
| Hover, press, toggle de estado que controlas con clase/atributo | **CSS transition** |
| Entrada al montar, sin estado JS | **CSS `@starting-style`** |
| Motion predeterminado que debe seguir fluido mientras la pagina carga | **CSS animation** (corre off main-thread) |
| Control programatico con perf de CSS, sin libreria | **WAAPI** |
| Springs, layout animations, exit, gestos | **Motion** (`motion/react`) |

### 4.3 Ingredientes obligatorios

- **Solo `transform` y `opacity`** (corren en GPU, saltan layout y paint). Nunca animar `width/height/margin/padding/top/left`.
- **Nunca `scale(0)`** de entrada: arrancar en `scale(0.9-0.97)` + `opacity: 0`.
- **Easing** (nunca `ease-in` en UI): entrada/salida `ease-out` = `cubic-bezier(0.23, 1, 0.32, 1)`; movimiento en pantalla `ease-in-out` = `cubic-bezier(0.77, 0, 0.175, 1)`.
- **Duracion UI bajo 300ms** (button 100-160ms, tooltip 125-200ms, dropdown 150-250ms, modal/drawer 200-500ms).
- **Transiciones, no keyframes** para lo que se dispara rapido (toasts, toggles). Salir por donde entro.
- **`prefers-reduced-motion` y gating de hover** shipean CON la animacion, no despues:

```css
@media (prefers-reduced-motion: reduce) { .el { animation: fade 0.2s ease; } }
@media (hover: hover) and (pointer: fine) { .el:hover { transform: scale(1.05); } }
```

**Salida de la fase 4:** movimiento con proposito, acelerado por GPU, respetuoso de accesibilidad, solo donde suma.

---

## Conflictos entre skills (resueltos)

Potenciar significa que las skills se pisan a veces. Aca se resuelven de forma coherente:

| Conflicto | Resolucion |
|-----------|------------|
| **animate dice "el tool mas barato" (CSS); taste-skill defaultea a la libreria Motion** | Regla: para hover/press/toggle/entrada simple → CSS transition (animate manda). Reservar Motion para springs, layout animations, exit animations y valores continuos manejados por gesto/scroll (ahi taste-skill y animate coinciden: `useMotionValue`, nunca `useState` para valores continuos). |
| **taste-skill limita a landing/portfolio/redesign; impeccable cubre dashboards y app UI** | El design read (fase 1) decide: si es landing/portfolio/rediseno, los dials y las reglas de layout de taste-skill mandan. Si es dashboard/app/settings, impeccable modo **Operate** manda y `VISUAL_DENSITY` sube a 7-9. |
| **ui-ux-pro-max tiene GSAP presets; animate prefiere CSS/Motion y desaconseja librerias pesadas** | El preset de ui-ux-pro-max define el *tier* e intencion (Subtle/Standard/Complex). animate elige la *implementacion*: CSS/Motion salvo que el brief pida choreography real de scroll (pin, Flip, SplitText), unico caso donde entra GSAP. |
| **impeccable "go all out / bold"; animate "a veces cero lineas de codigo"** | No hay conflicto: bold es sobre composicion visual (fase 3), no sobre cantidad de movimiento. Un diseno puede ser audaz y casi estatico. El gate de animate (fase 4) manda sobre el movimiento. |
| **impeccable verificacion acotada; el instinto de seguir puliendo** | La verificacion acotada gana siempre: build → inspeccionar una vez → arreglar en batch → confirmar → parar. |

---

## NUNCA SHIPEAR (bans duros de las 4 skills)

Antes de entregar, chequear que ninguno de estos aparezca. Cada uno es un fail automatico.

| Nunca | En su lugar | De |
|-------|-------------|-----|
| Gradientes purpura-AI / glow azul por default | Base neutra (Zinc/Slate/Stone) + 1 acento de alto contraste | taste |
| `Inter` como font por default | Geist, Outfit, Satoshi, Cabinet Grotesk, o serif con justificacion | taste |
| Serif "porque se ve creativo/premium" (esp. `Fraunces`, `Instrument_Serif`) | Sans display por default; serif solo si el brief lo nombra o es genuinamente editorial | taste |
| Paleta beige+brass+espresso en briefs premium-consumer | Rotar: cold luxury, forest, black&tan, cobalt+cream, terracotta+slate | taste |
| Hero centrado sobre mesh oscuro + 3 cards iguales | Split-screen, asimetria, scroll-pinned (si `VARIANCE > 4`) | taste |
| Hero que no entra en el viewport inicial | Headline ≤2 lineas, subtext ≤20 palabras, CTAs sin scroll | taste |
| Eyebrow (label uppercase) sobre cada seccion | Max 1 eyebrow cada 3 secciones; casi siempre, sacarlo | taste |
| 3+ secciones seguidas de zigzag image+text | Romper con full-width, vertical-stack, bento, marquee | taste |
| Dos CTAs con la misma intencion en la pagina | Un label por intencion, usado en todos lados | taste |
| CTA cuyo texto wrappea a 2+ lineas en desktop | Acortar label (≤3 palabras) o ensanchar el boton | taste |
| Boton con texto ilegible sobre su fondo (contraste) | WCAG AA min: 4.5:1 body, 3:1 texto grande | taste + promax |
| Placeholder como label | Label ARRIBA del input, error DEBAJO | taste + promax |
| Emoji como iconos | Iconos SVG de UNA familia (Phosphor, Tabler, Radix) | taste + promax |
| Mezclar flat y skeuomorphic al azar / 2 sistemas de diseno en un arbol | Un sistema por proyecto | taste + promax |
| Instant state change (0ms) / feedback ausente en touch | Target 44×44px + feedback de loading | promax |
| Solo el estado exitoso (sin loading/empty/error) | Ciclo completo de estados, skeletons con la forma final | taste + impeccable |
| Self-QA abierto / loop de pulido infinito | Verificacion acotada: build → inspeccionar 1 vez → batch → parar | impeccable |
| Pulir sobre un look que ya decidiste descartar | Refinar preserva; redisenar reemplaza. No partir la diferencia | impeccable |
| `transition: all` | Nombrar las propiedades exactas | animate |
| `transform: scale(0)` de entrada | `scale(0.95)` + `opacity: 0` | animate |
| `ease-in` en UI | `ease-out` o curva custom fuerte | animate |
| Duracion UI > 300ms sin razon | 150-250ms | animate |
| Animacion en atajo de teclado / accion 100+/dia | Sin animacion | animate |
| Keyframes en toasts/toggles/rapidos | CSS transitions (retargetean desde el valor actual) | animate |
| Animar `width/height/margin/padding/top/left` | `transform` / `opacity` | animate + promax |
| `:hover` motion sin gate | `@media (hover: hover) and (pointer: fine)` | animate |
| Falta `prefers-reduced-motion` | Variante mas suave, no cero | animate + promax |
| Todo entra a la vez | Stagger de 30-80ms | animate |
| Inventar datos / resultado de busqueda de 0 hits | Extraer de fuente real; decir cuando es un default | promax |

---

## Ejemplos del pipeline completo

### Ejemplo 1 - Landing SaaS B2B

```
Usuario: "OBRA MAESTRA landing para mi herramienta de observabilidad para equipos de infra"

FASE 1 - LEER LA SALA (taste):
→ Design read: "Landing B2B SaaS para ingenieros de infra, lenguaje tecnico-limpio
   tipo Linear, tirando hacia Tailwind v4 + Geist + motion restringido."
→ Dials: VARIANCE 6 / MOTION 4 / DENSITY 4
→ Sistema: Tailwind v4 (soy dueno del codigo), un solo acento (electric blue, no purpura)

FASE 2 - INTELIGENCIA (pro-max):
→ search.py "observability devtool technical minimal" --design-system --variance 6 --motion 4 --density 4
→ Paleta: Zinc base + electric blue acento. Font: Geist + Geist Mono. Estilo: minimal tech.
→ Preset motion: tier Subtle (scroll reveal + stagger, sin choreography)

FASE 3 - EJECUTAR (impeccable):
→ Modo: Persuade (es una landing).
→ shape → layout: hero split (no centrado, VARIANCE 6), logo wall bajo el hero,
   bento con rhythm para features, sin zigzag repetido.
→ Estados completos, contraste AA en todos los CTAs (un solo label: "Empezar gratis").
→ Verificacion acotada: build → inspeccion desktop+mobile → 1 batch de fixes → confirmar → parar.

FASE 4 - DARLE VIDA (animate):
→ Gate: landing = ocasional. Motion 4 = sutil.
→ Scroll reveal de secciones (CSS + IntersectionObserver, tool mas barato), stagger 60ms.
→ Hover en cards: transform scale(1.02) 160ms ease-out, gated por hover+fine pointer.
→ prefers-reduced-motion: solo opacity, sin movimiento.

RESULTADO: landing que no se ve hecha por IA, nivel award, con movimiento que suma.
```

### Ejemplo 2 - Rediseno de dashboard

```
Usuario: "OBRA MAESTRA redisena el dashboard de mi app, se ve viejo y recargado"

FASE 1: Design read: "Rediseno de dashboard analitico para uso diario de operadores,
   lenguaje denso-pero-claro." Dials: VARIANCE 4 / MOTION 3 / DENSITY 8.
   (No es landing → mandan las reglas de app UI, no las de taste-skill hero.)

FASE 2: search.py "analytics dashboard operational dense" --design-system
   --variance 4 --motion 3 --density 8. Spacing scale denso (8-32px), tokens semanticos,
   charts con legends+tooltips, color no como unico canal de significado.

FASE 3: Modo Operate (completar tareas > expresion). Redisenar (reemplaza el look viejo,
   conserva funcion y datos). Comandos: distill (sacar complejidad) + layout + audit (a11y).
   Verificacion acotada.

FASE 4: Gate: dashboard = alta frecuencia. Casi todo instant. Solo micro-feedback en
   acciones (guardar: check 120ms), transiciones de tab con indicador (150ms). Sin decoracion.

RESULTADO: dashboard limpio, denso pero escaneable, rapido, sin movimiento gratuito.
```

### Ejemplo 3 - Componente premium aislado

```
Usuario: "OBRA MAESTRA un pricing toggle mensual/anual premium para mi SaaS"

FASE 1: Design read: "Componente aislado, superficie Persuade dentro de pricing."
   Dials heredados de la pagina. Anti-default: nada de purpura.

FASE 2: --domain ux "toggle switch pricing" + --domain gsap para el tier de motion.
   Preset: Standard.

FASE 3: Modo Persuade. Comando: shape → build. Estados: mensual/anual, con el ahorro
   anual visible. Contraste AA. Un solo acento heredado de la pagina.

FASE 4: Gate: toggle = decenas de veces/dia → solo casi-imperceptible. Proposito:
   indicacion de estado. Tool: CSS transition (el mas barato). Thumb: transform translateX
   180ms ease-out cubic-bezier(0.23,1,0.32,1). Precio: crossfade opacity, NO keyframes
   (se dispara rapido). Gated + reduced-motion.

RESULTADO: un toggle que se siente premium sin animacion de sobra.
```

---

## Cheat sheet

```
1. LEER LA SALA   → design read en 1 linea + 3 dials + elegir sistema (taste)
2. INTELIGENCIA   → --design-system con los dials como flags + deep-dives (pro-max)
3. EJECUTAR+REF   → modo + comando + craft-floor + verificacion ACOTADA (impeccable)
4. DARLE VIDA     → gate → proposito → tool mas barato → transform+opacity (animate)

Regla de oro: potenciar = el output de cada fase alimenta la siguiente,
y la barra de calidad audita que ninguna dejo un default de IA.
```

---

## Skills Referenciadas

| Skill | Ubicacion | Rol en el pipeline |
|-------|-----------|--------------------|
| taste-skill | `kiro-skills/03-diseno/taste-skill/SKILL.md` | Fase 1 - Leer la sala |
| ui-ux-pro-max | `kiro-skills/03-diseno/ui-ux-pro-max/SKILL.md` | Fase 2 - Inteligencia de diseno |
| impeccable | `kiro-skills/03-diseno/impeccable/SKILL.md` | Fase 3 - Ejecutar y refinar |
| animate | `kiro-skills/03-diseno/animate/SKILL.md` | Fase 4 - Darle vida |

---

> **OBRA MAESTRA = taste-skill + ui-ux-pro-max + impeccable + animate**
>
> Leer la sala. Sacar la inteligencia. Ejecutar con barra de director. Darle vida solo donde se lo gana.
> Diseno que no se ve hecho por IA.
