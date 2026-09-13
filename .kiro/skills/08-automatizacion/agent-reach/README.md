# 🌐 Agent Reach — Ojos de internet para tu agente

> Le da a Kiro la capacidad de **leer y buscar en toda la web** con un solo CLI y
> **sin pagar APIs**: web, YouTube, Reddit, Twitter/X, GitHub, Bilibili,
> XiaoHongShu, LinkedIn, RSS y más. Vos decís "investiga X" y el agente combina
> plataformas para traerte el contenido.

- **Fuente:** [github.com/Panniantong/agent-reach](https://github.com/Panniantong/agent-reach) · Licencia **MIT** (ver `LICENSE`)
- **Autor original:** Agent Eyes (Panniantong)
- **Instalado en este repo:** septiembre 2026, sin modificar el contenido de las skills.
- `SKILL.md` es la versión **en inglés** (principal). `SKILL_zh.md` es la original en chino. `references/` son las guías por categoría.

---

## 📦 Qué hace (15 plataformas, ruteo multi-backend)

Solo **lee/busca** contenido de internet (no publica, no comenta, no traduce ni analiza — eso lo hace Kiro después). Enrutamiento con "preferido + respaldo": si una vía se cae, cambia a otra sin que te enteres.

| Categoría | Plataformas | Config |
|-----------|-------------|--------|
| **search** | Búsqueda web / código (Exa, vía MCP) | Zero-config |
| **web** | Cualquier página, artículos, **RSS/Atom** | Zero-config |
| **video** | **YouTube** (subtítulos + búsqueda), Bilibili, podcasts (Xiaoyuzhou) | YouTube zero-config |
| **social** | Twitter/X, Reddit, Facebook, Instagram, XiaoHongShu, V2EX | Según plataforma |
| **career** | LinkedIn (perfiles, empresas, empleos) | "Configúrame LinkedIn" |
| **dev** | GitHub (repos públicos, búsqueda; privado/issues con login) | "Inicia sesión en GitHub" |
| **finance** | Xueqiu / cotizaciones de acciones | Según plataforma |

**6 canales funcionan sin configuración** (web, YouTube, RSS, búsqueda, V2EX, GitHub público). El resto se activan diciéndole al agente *"configúrame [plataforma]"* y te guía paso a paso.

---

## 🚀 Instalación

Es "agent-driven": le pasás una instrucción al agente y él hace el resto.

```
Instálame Agent Reach: https://raw.githubusercontent.com/Panniantong/agent-reach/main/docs/install.md
```

Por defecto **solo revisa el entorno** (no toca el sistema). Para que instale dependencias y registre la skill, usa `agent-reach install --system` (requiere tu permiso explícito).

Actualizar:
```
Actualízame Agent Reach: https://raw.githubusercontent.com/Panniantong/agent-reach/main/docs/update.md
```

## 🩺 Diagnóstico

```bash
agent-reach doctor --json   # muestra qué backend sirve cada plataforma AHORA mismo
agent-reach check-update    # avisa si hay versión nueva
```

## 🗺️ Cómo se activa

Decile a Kiro cosas como:
```
Investiga qué dice la gente sobre [producto] en Twitter y Reddit
Resúmeme este video de YouTube: [url]
¿De qué trata este repo de GitHub y qué dicen los issues?
Suscríbeme a estos RSS y avísame de novedades
Busca en la web comparativas recientes de frameworks LLM
```

---

## 🛡️ Seguridad y privacidad

- **Cookies solo locales:** las credenciales/cookies quedan en tu máquina, no se suben. Código abierto y auditable.
- **Solo lectura:** no hace operaciones de escritura (publicar/comentar/like).
- **Autorización:** usar solo para contenido que podés acceder legítimamente; respetar términos de cada plataforma y `robots.txt`.
- **Costo:** todo gratis; lo único que podría costar es un proxy en servidor (~$1/mes), innecesario en local.
- **Requiere** que el agente pueda ejecutar comandos de shell (en OpenClaw hay que habilitar el perfil `coding`).

---

*Contenido de las skills reproducido bajo MIT con atribución a Agent Eyes / Panniantong. Ver `LICENSE`. El CLI `agent-reach` se instala desde el repo oficial (no desde el paquete homónimo de PyPI, que no es este proyecto).*
