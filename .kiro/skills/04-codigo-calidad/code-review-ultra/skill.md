# Skill: Review & Ultra Review

## Description
Sistema de revision de codigo en dos niveles: Review (revision estandar rapida) y Ultra Review (auditoria exhaustiva de seguridad, performance, arquitectura y accesibilidad).

## Activation
- **Review**: Cuando el usuario pida "revisar", "review", o comparta codigo para feedback.
- **Ultra Review**: Cuando pida "ultra review", "revision profunda", "auditoria", o revision critica de produccion.

## Instructions

---

### Nivel 1: REVIEW (Estandar)

Revision enfocada en correctitud inmediata. Buscar:

1. **Bugs y errores logicos** - Condiciones invertidas, off-by-one, null/undefined no manejados
2. **Edge cases no manejados** - Arrays vacios, strings vacios, valores negativos, concurrencia
3. **Errores de tipeo y naming inconsistente** - Typos en variables, naming mixto (camelCase/snake_case)
4. **Imports faltantes o no usados** - Dead imports, imports que no existen
5. **Codigo muerto** - Funciones no llamadas, variables no usadas, bloques inalcanzables

#### Formato de salida Review

Lista priorizada por severidad:

```markdown
## Review: [nombre del archivo/componente]

### 🔴 Critico (bloquea deploy)
1. **[BUG]** Descripcion del problema
   - **Linea**: ~XX
   - **Fix**: `codigo corregido`

### 🟡 Medio (resolver antes de merge)
1. **[EDGE]** Descripcion del caso no manejado
   - **Linea**: ~XX
   - **Fix**: `codigo sugerido`

### 🟢 Bajo (nice to have)
1. **[STYLE]** Descripcion
   - **Linea**: ~XX
   - **Sugerencia**: `mejora propuesta`

---
**Veredicto**: ✅ Aprobado / ⚠️ Con comentarios / ❌ Requiere cambios
**Issues**: X criticos, Y medios, Z bajos
```

---

### Nivel 2: ULTRA REVIEW (Profundo)

Todo lo de Review estandar MAS estas 5 dimensiones adicionales:

#### 🔒 SEGURIDAD
- XSS (innerHTML, dangerouslySetInnerHTML, interpolacion no sanitizada)
- Injection (SQL, NoSQL, Command, LDAP)
- Datos sensibles expuestos (tokens en logs, secrets en client, PII sin encriptar)
- CORS mal configurado
- Auth/Authz bypass
- CSRF, SSRF

#### ⚡ PERFORMANCE
- Re-renders innecesarios (falta memo, keys inestables, context excesivo)
- Memory leaks (listeners no removidos, intervals sin clear, subscriptions abiertas)
- N+1 queries (loops con await, fetches dentro de maps)
- Bundle size (imports completos en lugar de tree-shaking)
- Operaciones bloqueantes en main thread

#### 🏗️ ARQUITECTURA
- Acoplamiento excesivo (componente sabe demasiado del sistema)
- Responsabilidades mixtas (componente hace fetch + render + logica de negocio)
- DRY violations (logica duplicada que deberia abstraerse)
- Leaky abstractions (detalles de implementacion expuestos)
- Dependency direction incorrecta

#### 📐 PATRONES
- Anti-patterns conocidos (prop drilling excesivo, god components, barrel files masivos)
- Mejor alternativa disponible (custom hook vs HOC, composition vs inheritance)
- Patrones inconsistentes con el resto del codebase
- Over-engineering (abstraccion prematura, generalizacion innecesaria)

#### ♿ ACCESIBILIDAD
- ARIA labels faltantes (botones sin texto, imagenes sin alt, forms sin labels)
- Keyboard navigation rota (elementos clickeables no focuseables, tab order roto)
- Contraste insuficiente (texto sobre fondos de bajo contraste)
- Screen reader (contenido oculto visualmente pero relevante, live regions)
- Focus management (modales sin focus trap, focus perdido despues de acciones)

#### Formato de salida Ultra Review

```markdown
## Ultra Review: [componente/feature]

### Scorecard
| Dimension | Score | Estado |
|-----------|-------|--------|
| Correctitud | X/10 | ✅/⚠️/❌ |
| Seguridad | X/10 | ✅/⚠️/❌ |
| Performance | X/10 | ✅/⚠️/❌ |
| Arquitectura | X/10 | ✅/⚠️/❌ |
| Patrones | X/10 | ✅/⚠️/❌ |
| Accesibilidad | X/10 | ✅/⚠️/❌ |
| **TOTAL** | **XX/60** | **[estado]** |

---

### 🔒 SEGURIDAD
**Problema:** [descripcion clara del issue]
**Archivo:** `path/to/file.ts`
**Linea:** ~XX
**Solucion:**
```typescript
// codigo corregido
```
**Impacto:** Alto/Medio/Bajo

---

### ⚡ PERFORMANCE
**Problema:** [descripcion]
**Archivo:** `path/to/file.ts`
**Linea:** ~XX
**Solucion:**
```typescript
// codigo corregido
```
**Impacto:** Alto/Medio/Bajo

---

### 🏗️ ARQUITECTURA
**Problema:** [descripcion]
**Archivo:** `path/to/file.ts`
**Linea:** ~XX
**Solucion:** [descripcion del refactor o codigo]
**Impacto:** Alto/Medio/Bajo

---

### 📐 PATRONES
**Problema:** [descripcion]
**Archivo:** `path/to/file.ts`
**Linea:** ~XX
**Solucion:** [patron correcto a usar]
**Impacto:** Alto/Medio/Bajo

---

### ♿ ACCESIBILIDAD
**Problema:** [descripcion]
**Archivo:** `path/to/file.ts`
**Linea:** ~XX
**Solucion:**
```tsx
// codigo corregido con ARIA/a11y
```
**Impacto:** Alto/Medio/Bajo

---

### Patrones positivos ✨
- [Lo que esta bien hecho - reforzar]

### Plan de accion
| Prioridad | Issue | Estimacion |
|-----------|-------|------------|
| 🔴 P0 | [fix critico] | Xh |
| 🟡 P1 | [fix importante] | Xh |
| 🟢 P2 | [mejora] | Xh |

### Veredicto final
🔴 BLOQUEAR / 🟡 APROBAR CON CONDICIONES / 🟢 SHIP IT
```

---

### Reglas de severidad

| Nivel | Criterio | Accion |
|-------|----------|--------|
| 🔴 Critico | Bug en prod, vulnerabilidad explotable, data loss | Bloquea merge |
| 🟡 Medio | Performance degradada, code smell serio, a11y rota | Resolver antes de merge |
| 🟢 Bajo | Estilo, naming, optimizacion menor | Opcional / crear ticket |

### Reglas operativas

- Siempre mostrar CODIGO CONCRETO en las soluciones, no solo describir
- Indicar linea aproximada (~XX) para ubicar rapido
- Priorizar por impacto real al usuario/sistema
- Si no hay issues en una categoria, omitirla (no poner "N/A")
- Siempre cerrar con veredicto claro y plan de accion

## Example

**Input:** "Review de este hook useAuth"

**Respuesta (Review estandar):**
> ## Review: useAuth.ts
>
> ### 🔴 Critico
> 1. **[BUG]** Token se guarda en localStorage sin verificar expiracion
>    - **Linea**: ~15
>    - **Fix**: `if (isTokenExpired(token)) { logout(); return null; }`
>
> ### 🟡 Medio
> 1. **[EDGE]** No maneja el caso donde `localStorage` no esta disponible (SSR)
>    - **Linea**: ~8
>    - **Fix**: `const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null`
>
> ### 🟢 Bajo
> 1. **[STYLE]** Variable `t` deberia ser `token` para claridad
>    - **Linea**: ~12
>
> ---
> **Veredicto**: ❌ Requiere cambios
> **Issues**: 1 critico, 1 medio, 1 bajo
