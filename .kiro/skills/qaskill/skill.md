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

### REGLAS APRENDIDAS (de esta sesión)

> Estas reglas se acumulan. Nunca se borran. Cada error nuevo agrega una regla.

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
