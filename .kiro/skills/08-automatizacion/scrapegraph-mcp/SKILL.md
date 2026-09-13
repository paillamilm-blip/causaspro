---
name: scrapegraph-mcp
description: >
  Servidor MCP (Model Context Protocol) de ScrapeGraphAI: conecta a Kiro (o
  Claude/Cursor) las capacidades de scraping con IA de la API gestionada de
  ScrapeGraph — sin escribir codigo Python ni manejar navegadores localmente. Una
  vez configurado, Kiro puede convertir webs a markdown, extraer datos
  estructurados por prompt, buscar en la web, crawlear multi-pagina y monitorear
  sitios, todo via herramientas MCP (scrape, extract, search, crawl, schema,
  monitor, credits, history). Usar cuando el usuario dice conectar scrapegraph por
  MCP, configurar el MCP de scrapegraph, convertir web a markdown, extraer datos
  con la API de scrapegraph, o quiere scraping gestionado sin infra local.
triggers:
  - scrapegraph mcp
  - mcp de scrapegraph
  - conectar scrapegraph
  - configurar scrapegraph mcp
  - convertir web a markdown
  - extraer con la api de scrapegraph
  - scraping gestionado
  - crawl multipagina
  - monitorear sitio web
allowed-tools:
  - Bash
  - Read
  - Write
metadata:
  type: mcp-server
  source: https://github.com/scrapegraphai/scrapegraph-mcp
  license: MIT
  api: ScrapeGraph API v3 (v2-api.scrapegraphai.com/api)
  author: paillamilm-blip
  based-on: ScrapeGraphAI / Marco Perini
---

# 🔌 ScrapeGraph MCP — Scraping con IA vía Model Context Protocol

> El primo "gestionado por API" de la skill `scrapegraph-ai`. En vez de la
> librería Python local, expone ScrapeGraph como un **servidor MCP** con
> herramientas listas para que el agente las llame. No necesitás Python, ni
> Playwright, ni navegador local.

- **Fuente:** [github.com/scrapegraphai/scrapegraph-mcp](https://github.com/scrapegraphai/scrapegraph-mcp) · Licencia **MIT** (ver `LICENSE`)
- **API:** ScrapeGraph v3 (base `https://v2-api.scrapegraphai.com/api`), auth con header `SGAI-APIKEY`.
- **Requiere una API key** de ScrapeGraph (gratis con créditos): [Dashboard de ScrapeGraph](https://scrapegraphai.com).

## 🆚 ¿Cuál uso, `scrapegraph-ai` o `scrapegraph-mcp`?

| Situación | Usá |
|-----------|-----|
| Querés que Kiro/Claude/Cursor scrapee "hablando", sin escribir código, con infra gestionada | **scrapegraph-mcp** (esta) |
| Necesitás pipelines Python propios, LLM local (Ollama), control total y offline | **scrapegraph-ai** (librería) |
| No querés pagar API ni crear cuenta | **scrapegraph-ai** con Ollama |

---

## 🧰 Herramientas que expone (API v3)

| Tool | Rol |
|------|-----|
| `scrape` | `POST /scrape` — salida en **markdown / html / screenshot / links / images / summary / branding** |
| `extract` | `POST /extract` — requiere `website_url` + `user_prompt`; `output_schema` opcional (JSON estructurado) |
| `search` | `POST /search` — búsqueda web (`num_results` 1–20, `country_search`, `time_range`) |
| `crawl_start` | `POST /crawl` — crawl multi-página asíncrono |
| `crawl_get_status` | `GET /crawl/:id` — poll hasta `status: completed` |
| `crawl_stop` / `crawl_resume` | detener / reanudar un crawl |
| `schema` | `POST /schema` — genera o amplía un JSON Schema desde un prompt |
| `monitor_*` | crear/listar/pausar/reanudar/borrar **jobs programados** + `monitor_activity` (historial de cambios) |
| `credits` / `history` | créditos disponibles / historial paginado |

> **Nota v2→v3:** los nombres cambiaron (rename duro, sin alias): `smartscraper`→`extract`, `searchscraper`→`search`, `smartcrawler_initiate`→`crawl_start`, `generate_schema`→`schema`, y `markdownify` se **eliminó** (usá `scrape` con `output_format="markdown"`).

---

## ⚙️ Instalación / configuración del MCP

### Opción A — Smithery (la más rápida)

```bash
npx -y @smithery/cli install @ScrapeGraphAI/scrapegraph-mcp --client claude
```

### Opción B — Local (Python)

```bash
pip install scrapegraph-mcp   # o: uv pip install scrapegraph-mcp
export SGAI_API_KEY=tu-api-key   # PowerShell: $env:SGAI_API_KEY="..."  · CMD: set SGAI_API_KEY=...
```

Config del cliente MCP (Kiro / Claude Desktop / Cursor):

```json
{
  "mcpServers": {
    "scrapegraph": {
      "command": "python",
      "args": ["-m", "scrapegraph_mcp.server"],
      "env": { "SGAI_API_KEY": "tu-api-key-aqui" }
    }
  }
}
```

En **Windows**, si falla, usá:
```
C:\Windows\System32\cmd.exe /c npx -y @smithery/cli@latest run @ScrapeGraphAI/scrapegraph-mcp --config "{\"scrapegraphApiKey\":\"TU-API-KEY\"}"
```

### Opción C — Servidor remoto (Render, etc.) vía `mcp-remote`

```json
{
  "mcpServers": {
    "scrapegraph": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://tu-server.onrender.com/mcp", "--header", "X-API-Key:${SGAI_API_KEY}"],
      "env": { "SGAI_API_KEY": "tu-api-key-aqui" }
    }
  }
}
```

### Variables de entorno

| Var | Default | Qué es |
|-----|---------|--------|
| `SGAI_API_KEY` | — | Tu API key (también vía `scrapegraphApiKey` / header `X-API-Key`) |
| `SGAI_API_URL` | `https://v2-api.scrapegraphai.com/api` | Base URL (override) |
| `SGAI_TIMEOUT` | `120` | Timeout de request en segundos |

---

## 🗺️ Cómo se usa (una vez conectado)

Decile a Kiro cosas como:
```
Convierte https://scrapegraphai.com a markdown
Extrae todos los precios de productos de esta página de e-commerce
Investiga los últimos avances en IA y resume los hallazgos
Crawlea este sitio y tráeme el texto de todas las páginas
Monitorea esta página y avísame cuando cambie el precio
```

## 🛡️ Seguridad y buen uso

- **API key** por variable de entorno / config del cliente MCP; **nunca** hardcodearla ni commitearla.
- Scrapear solo sitios permitidos; respetar términos de uso, `robots.txt` y rate limits.
- Cada llamada consume **créditos** de tu cuenta ScrapeGraph — revisá `credits` para no quedarte sin saldo.

---

*Skill basada en el servidor MCP open-source de ScrapeGraphAI (MIT), créditos a Marco Perini / ScrapeGraphAI. El servidor se instala desde el repo/PyPI oficial; esta skill es la guía de configuración y uso para este repo.*
