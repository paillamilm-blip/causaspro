# Skill: QA Skill — Aprende de los Errores

## Description
Sistema de QA inteligente que registra, categoriza y aprende de cada error cometido durante el desarrollo. Antes de ejecutar cualquier cambio, consulta el historial de errores para NO repetirlos. Convierte cada fallo en una regla concreta que previene el siguiente.

## Activation
- **Siempre activo**: Después de cada error de CI, typecheck, lint, o bug — registra el error automáticamente.
- **Antes de cada cambio**: Consulta el registro para verificar que no se va a repetir un error conocido.
- **Trigger manual**: "qaskill", "qué errores he tenido", "errores anteriores", "no repitas eso".

## Instructions

### Rol
Eres un sistema de QA que APRENDE. Tu memoria son los errores pasados. Tu trabajo es que NUNCA se repita el mismo error dos veces. Cada fallo es una lección que se convierte en una regla permanente.

---

### AL DETECTAR UN ERROR (CI falla, typecheck, lint, runtime)

Registrar INMEDIATAMENTE:

```markdown
## 🔴 ERROR REGISTRADO

| Campo | Valor |
|-------|-------|
| **Fecha** | [fecha] |
| **Archivo** | [path:línea] |
| **Tipo** | TypeCheck / Lint / Runtime / Build |
| **Error** | [mensaje exacto] |
| **Causa raíz** | [por qué pasó — 1 frase] |
| **Fix aplicado** | [qué se hizo para resolverlo] |
| **Regla aprendida** | [regla concreta para no repetirlo] |
| **Categoría** | Tipos / Imports / API mismatch / Unused code / Naming / Config |
```

---

### ANTES DE CADA CAMBIO (Pre-flight check)

Antes de modificar cualquier archivo, el agente DEBE:

1. **Consultar el registro de errores** relacionados con ese archivo o patrón
2. **Verificar contra las reglas aprendidas** — ¿este cambio viola alguna?
3. **Si hay riesgo**, advertir ANTES de ejecutar

Formato de pre-flight:

```markdown
## ✅ QA PRE-FLIGHT

Archivos a modificar: [lista]
Reglas relevantes del historial:
- [Regla 1]: [cómo aplica]
- [Regla 2]: [cómo aplica]

Riesgo de repetir error conocido: BAJO / MEDIO / ALTO
```

---

### REGISTRO PERMANENTE DE ERRORES (Base de Conocimiento)

Mantener actualizado un registro acumulativo. Cada error nuevo se agrega. Nunca se borra.

#### Categorías de errores:

| Categoría | Patrón típico | Regla general |
|-----------|---------------|---------------|
| **Tipos** | Property X does not exist on type Y | Siempre verificar el tipo real del hook/contexto antes de acceder campos |
| **Imports** | Module has no exported member X | Verificar exports reales del módulo antes de importar |
| **API mismatch** | Expected N arguments, got M | Verificar firma de la función antes de llamarla |
| **Unused code** | X is defined but never used | No importar más de lo que se usa; limpiar imports al terminar |
| **Naming** | Did you mean Y? | Verificar nombres exactos de exports contra el archivo fuente |
| **Async** | await only in async functions | Si usas await, la función DEBE ser async |
| **Config** | Cannot find type definition | Verificar que tipos/dependencias estén en tsconfig/package.json |

---

### REGLAS APRENDIDAS — Sistema Ómicron (OTRO proyecto)

> ⚠️ **Leer primero:** las reglas 1-10 son de **Sistema Ómicron** (React + Vite + Edge
> Functions), no de CausasPro. Se conservan porque las reglas no se borran, pero **no aplican
> a este repo**: acá no existen `useGemeloProfile`, `dailyChallenge` ni Edge Functions.
> Para CausasPro, usar la sección siguiente.

1. **`useGemeloProfile()` retorna `GemeloProfile`** — tiene `axes`, `rep`, `pe`, `vault`, `skills`. NO tiene `execution_score`, `quality_score`, `reputation_score`, `skills_detail`, `display_name`. Para esos campos, usar `useProfile()` que retorna el tipo `Profile` de Supabase.

2. **`dailyChallenge.ts` exports**: `getDailyChallenge(gemelo)`, `isChallengeCompleted(challengeId)`, `markChallengeCompleted(challengeId)`, `getCurrentStreak()`, `incrementStreak()`. NO exporta: `getTodayChallenge`, `completeChallenge`, `challengeStreak`.

3. **`DailyChallenge` interface**: Tiene `id`, `title`, `description`, `action`, `duration`, `reward: {pe, axis, delta}`, `icon`, `targetTab`. NO tiene: `type`, `emoji`, `estimatedMinutes`, `peReward`.

4. **SpeechRecognition API**: Los tipos `SpeechRecognition`, `SpeechRecognitionEvent`, `SpeechRecognitionErrorEvent` NO existen en el tsconfig estándar de Vite. Declarar interfaces locales en el archivo que las usa.

5. **`useCallback` con `await`**: Si el callback usa `await`, DEBE ser `async`: `useCallback(async () => { ... })`.

6. **Imports no usados**: Al refactorizar, SIEMPRE verificar que los imports que se dejan siguen siendo necesarios. ESLint falla con `no-unused-vars`.

7. **`let` vs `const`**: Si una variable solo se asigna una vez (incluso si es un objeto al que se le modifican propiedades), usar `const`. ESLint `prefer-const` lo rechaza.

8. **Parámetros no usados**: Prefijar con `_` (ej: `_gen`) o usar `catch {` sin variable. ESLint `no-unused-vars` acepta el patrón `^_`.

9. **Squash merge + conflictos**: Cuando GitHub hace squash merge, verificar que los cambios realmente llegaron revisando el archivo en main DESPUÉS del merge. No asumir que "mergeado = aplicado".

10. **Edge Functions vs Frontend types**: Los tipos de Supabase en Edge Functions (Deno) son diferentes a los del frontend (Vite). No compartir interfaces entre ambos sin verificar compatibilidad.

---

### REGLAS APRENDIDAS — CausasPro (ESTE repo)

> Next.js 14 + Supabase + bot Playwright local. Estas sí aplican acá.

#### 🧠 El patrón que más daño hizo: culpar al DATO por un fallo del SISTEMA

Apareció **cuatro veces** en el mismo día, siempre con el mismo resultado: datos dañados o
un diagnóstico falso. Es el primer sesgo a descartar ante cualquier bug de este repo.

| Dónde | Qué pasaba | Qué había que hacer |
|---|---|---|
| Sesión del portal caída | 17 causas válidas quedaron como "no encontrada en el portal", con contador de fallos | Detectar el fallo sistémico, cortar la tanda y NO tocar las causas |
| `tasa_exito` | Contaba como falla del bot las causas que el portal confirma que no existen → "4%, revisá los selectores" | Denominador = solo lo alcanzable (`calcularTasaExito`) |
| Letra del RIT distinta | El bot descubría el RIT real, lo logueaba y lo tiraba; después penalizaba la causa | Persistir el hallazgo (`[REVISAR LETRA]`) y sacarla de la cola |
| `syncAsignaciones` | `update({ notas })` borraba las marcas del bot | Agregar sin reemplazar (`agregarNota`) |

**Regla:** antes de escribir una marca de fallo en un registro, preguntarse *¿esto lo causó el
registro, o el entorno?* Si fue el entorno (sesión, red, portal caído), **cortar el proceso**,
no marcar el registro. Y si el proceso ya descubrió el dato correcto, **persistirlo**.

#### 11. `notas` de la tabla `causas` es un CANAL COMPARTIDO
Contiene marcas de las que depende el funcionamiento: `[NO EN PORTAL]`,
`[REVISAR: no scrapeada]`, `[INTENTOS FALLIDOS: n]`, `[VÍNCULO]`, `[REVISAR LETRA]`,
`[ASIGNACIÓN]`. Las leen `getCausasToScrape` (cola del bot) y la barra de progreso del
dashboard. **Toda escritura debe AGREGAR línea, nunca reemplazar el campo.** Un
`update({ notas: '...' })` directo devuelve a la cola causas ya descartadas y borra los
vínculos P↔X. Patrón a copiar: `agregarNota()` en `src/lib/asignacionesSync.ts`.

#### 12. NUNCA importar `src/bot/` ni `src/email/` desde `src/app/`
`src/email/` arrastra `imapflow` y `src/bot/` arrastra `playwright` + `fs`. Importarlos desde
una ruta de Next **rompe el build en Vercel (~21 s)** aunque el build local pase perfecto
(verificado con clon limpio, `npm install`, Node 18 y 22). La lógica compartida va en
`src/lib/`, y la dependencia va en una sola dirección: `src/email → src/lib`, nunca al revés.

#### 13. Si Vercel falla y el build local pasa, BISECAR — no adivinar
Un deploy que falla en ~21 s no da logs accesibles. Lo que funciona: rama de prueba desde
`main` y **un cambio por deploy**. Así se aisló la regla #12: `.md` solo → OK; endpoint stub
sin imports → OK; endpoint + parser **sin modificar** → FALLA (ahí quedó claro que no era el
código nuevo). Sin esa última prueba habría "arreglado" código que estaba bien.

#### 14. Antes de un UPDATE sobre producción, probarlo contra Postgres real
Se puede correr PostgreSQL de verdad en el sandbox con **PGlite**
(`npm i @electric-sql/pglite`, corre en WASM, sin instalar servidor). Se usó para validar
`schema-limpiar-contadores.sql` antes de tocar 84 filas reales: confirmó que conservaba
`[NO EN PORTAL]`, `[VÍNCULO]` y las notas humanas, que respetaba el orden de las líneas y que
era idempotente. **Preferir filtrado por líneas** (`string_to_array` + `unnest WITH
ORDINALITY`) sobre `regexp_replace`: el bot escribe una marca por línea, así el borrado es
exacto y no se come texto vecino.

#### 15. `loadEnv.ts` NO pisa variables ya presentes en el entorno
Es a propósito (en CI mandan las reales). Consecuencia: un `set PJUD_RUT=CAMBIAR_...` en un
`.bat` **le gana al `.env`**, y el bot intenta entrar a Clave Única con el placeholder
literal → login fallido repetido y riesgo de bloqueo de cuenta. **Las credenciales van en un
solo lugar (`.env`); los `.bat` no las llevan adentro.**

#### 16. `.gitignore`: `.env` es coincidencia EXACTA
No cubre los derivados. Un respaldo `.env.respaldo` quedaba sin trackear y podía subirse con
RUT, Clave Única y service role key. Usar `.env` + `.env.*` + `!.env.example`.

#### 17. Distinguir "ausencia confirmada" de "fallo transitorio" antes de marcar datos
`[NO EN PORTAL]` solo se pone cuando el portal responde textualmente *"No existen causas por
el valor ingresado"* (doble confirmación). Un `[]` por timeout, panel no cargado o ambigüedad
**no prueba nada**. Este repo ya tenía la distinción bien hecha con el callback
`onConfirmadoNoExiste`; el bug fue no extenderla a los casos nuevos (panel inaccesible, letra
distinta). Al agregar un motivo de fallo, **agregar también su callback**.

#### 18. No "corregir" la letra de un RIT automáticamente
P y X son causas **hermanas legalmente distintas** (protección / cumplimiento). El modo
`BOT_FIX_LETRAS=1` hace lo correcto: conserva la original, crea la hermana y las vincula
(`X-2772-2023 ↔ P-2772-2023 (protección con cumplimiento — hay sentencia)`). Adivinar habría
mezclado dos expedientes de menores.

#### 19. Los mensajes que imprime un `.bat` no llevan tildes ni ñ
La consola de Windows los muestra roto. Aplica a `echo` y a los `log`/`print` del bot, **no**
a los comentarios `REM` (no se imprimen). Verificable con
`grep -nP '^\s*echo.*[^\x00-\x7F]'`.

#### 20. Antes de dar por bueno un `.bat`, revisar estructura
No se puede ejecutar desde el sandbox (es Linux), pero sí verificar: que toda etiqueta
referenciada por `goto :x` exista, que los bloques `if (...)` estén balanceados (ojo: los
paréntesis literales dentro de un `echo` inflan el conteo y son válidos a nivel superior,
pero **dentro** de un bloque hay que escaparlos `^(` `^)`), y que no queden credenciales
hardcodeadas.

---

### FLUJO OPERATIVO

```
1. ANTES de cambiar → QA PRE-FLIGHT (consultar reglas)
2. DURANTE el cambio → aplicar reglas
3. DESPUÉS del cambio → verificar (grep imports no usados, types correctos)
4. SI CI FALLA → registrar error → agregar regla → fix → push
5. NUNCA repetir un error registrado
```

---

### INTERACCIÓN CON OTRAS SKILLS

- **Con Context Mode**: QA Skill agrega una verificación extra en Fase 1 (Análisis) — "¿este cambio viola alguna regla aprendida?"
- **Con Claude Mem**: Los errores se guardan en la memoria persistente bajo categoría DECISIONES
- **Con Ponytail**: QA Skill no agrega código innecesario — las reglas son constraints, no boilerplate
- **Con BUNKER combo**: QA Skill es el primer check antes de aprobar cualquier cambio

---

## Example

**Después de un error de CI:**

> 🔴 ERROR REGISTRADO
>
> | Campo | Valor |
> |-------|-------|
> | Fecha | 2026-08-17 |
> | Archivo | src/components/shared/DailyChallengeCard.tsx:51 |
> | Tipo | TypeCheck |
> | Error | Property 'type' does not exist on type 'DailyChallenge' |
> | Causa raíz | El componente usaba la API vieja del módulo (pre-refactor) |
> | Fix | Cambiar `challenge.type` → `challenge.targetTab` |
> | Regla | Siempre verificar la interface exportada del módulo antes de acceder sus campos |
> | Categoría | API mismatch |

**Antes del siguiente cambio:**

> ✅ QA PRE-FLIGHT
>
> Archivos a modificar: DailyChallengeCard.tsx
> Reglas relevantes:
> - Regla #3: DailyChallenge tiene `targetTab`, NO `type`
> - Regla #6: Verificar imports no usados al terminar
>
> Riesgo: BAJO (cambio alineado con reglas conocidas)
