# 🦉 Strix — Pentesting autónomo con IA

> Skill de seguridad ofensiva: agentes de IA que **actúan como hackers reales** —
> ejecutan tu código, encuentran vulnerabilidades y las **validan con pruebas de
> concepto (PoC) reales**, no solo las marcan como los escáneres estáticos.

- **Fuente:** [github.com/usestrix/strix](https://github.com/usestrix/strix) (`npx skills add usestrix/strix`)
- **Licencia:** Apache-2.0 (ver [`LICENSE`](./LICENSE))
- **Autor original:** usestrix · Docs: https://docs.strix.ai
- **Instalado en este repo:** septiembre 2026, sin modificaciones al contenido de las skills.

---

## 📦 Qué incluye (9 sub-skills)

| Sub-skill | Para qué |
|-----------|----------|
| **penetration-testing-with-strix** | Pentest general de app/API/repo/URL/dominio/IP (punto de entrada principal). |
| **web-app-penetration-testing** | Pentest enfocado en aplicaciones web. |
| **api-security-testing** | Pruebas de seguridad sobre APIs (OpenAPI/Postman). |
| **application-security-testing** | AppSec: detectar y validar vulnerabilidades críticas. |
| **find-security-vulnerabilities-in-code** | Encontrar vulnerabilidades en el código fuente (white-box). |
| **owasp-top-10-testing** | Testing dirigido al OWASP Top 10. |
| **fix-security-vulnerabilities-with-strix** | Generar parches/autofix y verificar la corrección. |
| **ci-security-scanning-with-strix** | Integrar el escaneo en CI/CD (bloquear PRs inseguros). |
| **managed-pentesting-with-strix** | Usar la nube gestionada `app.strix.ai` (sin Docker ni LLM key local). |

`AGENTS.md` es la referencia rápida original del proyecto.

---

## 🚀 Cómo se activa

Decile a Kiro cosas como:

```
Pentest a este repo con Strix
Busca vulnerabilidades en https://staging.example.com
Corre un OWASP Top 10 sobre esta API
Arregla las vulnerabilidades que encontró Strix
Configura escaneo de seguridad en el CI con Strix
```

## ⚙️ Requisitos (modo open-source / CLI)

1. **Docker** corriendo (`docker info`).
2. **Strix instalado**: `curl -sSL https://strix.ai/install | bash` (o `pipx install strix-agent`).
3. **LLM configurado** (nunca hardcodear claves):
   ```bash
   export STRIX_LLM="openrouter/z-ai/glm-5.3"   # cualquier id LiteLLM
   export LLM_API_KEY="<tu-api-key>"
   ```

Alternativa **sin infraestructura local**: nube gestionada (`strix cloud ...`) — ver la sub-skill `managed-pentesting-with-strix`.

## 🛡️ Regla de seguridad

Escanear **solo objetivos que te pertenecen o para los que tenés autorización explícita**.
La nube exige verificación de dominio; en el CLI open-source, confirmá la autorización vos mismo antes de escanear infraestructura de terceros.

---

*Contenido de las skills reproducido bajo Apache-2.0 con atribución a usestrix. Ver `LICENSE` para los términos completos.*
