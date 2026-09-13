---
name: scrapegraph-ai
description: >
  Web scraping con IA usando la libreria Python ScrapeGraphAI: pipelines basados
  en LLM + logica de grafos que extraen datos ESTRUCTURADOS de sitios web y
  documentos locales (HTML, XML, JSON, Markdown, PDF, DOCX) con solo describir en
  lenguaje natural que informacion queres. En vez de escribir selectores CSS/XPath
  fragiles, le decis "extrae fundadores, descripcion y redes sociales" y la
  libreria arma el pipeline (Fetch -> Parse -> GenerateAnswer). Soporta OpenAI,
  Ollama (local/gratis), Azure, Gemini y mas via LiteLLM. Usar cuando el usuario
  dice extraer datos estructurados, scrapear con IA, scrapear sin selectores,
  convertir web en JSON, scrapegraph, smart scraper, extraer de PDF/HTML, o
  scraping con lenguaje natural.
triggers:
  - SCRAPEGRAPH
  - scrapegraph-ai
  - scrapear con IA
  - scraping con IA
  - extraer datos estructurados
  - scrapear sin selectores
  - web a json
  - convertir web en json
  - smart scraper
  - extraer de esta pagina
  - extraer de un pdf
  - scraping en lenguaje natural
allowed-tools:
  - Bash
  - Read
  - Write
metadata:
  type: library-skill
  source: https://github.com/ScrapeGraphAI/Scrapegraph-ai
  license: MIT
  language: python
  author: paillamilm-blip
  based-on: ScrapeGraphAI
---

# 🕷️ ScrapeGraphAI — Scraping con IA (You Only Scrape Once)

> Decís QUÉ querés, no CÓMO extraerlo. La librería arma el pipeline de scraping
> con un LLM y lógica de grafos, y te devuelve **JSON estructurado**.

- **Fuente:** [github.com/ScrapeGraphAI/Scrapegraph-ai](https://github.com/ScrapeGraphAI/Scrapegraph-ai) · Licencia **MIT** (ver `LICENSE`)
- **Cuándo usar esta skill vs otras de scraping:**
  - **scrapegraph-ai** → cuando la estructura del sitio es desconocida/cambiante y querés extracción semántica ("dame los precios y stock") sin mantener selectores. Corre en Python.
  - **firecrawl** → cuando querés convertir páginas a Markdown limpio o una API de crawling gestionada.
  - **agent-browser / scrape** → cuando necesitás interacción (clicks, login, formularios) o control del navegador.

---

## 🚀 Instalación

```bash
# Recomendado: entorno virtual
python -m venv .venv && source .venv/bin/activate

pip install scrapegraphai
playwright install            # IMPORTANTE: para poder descargar el contenido de las webs
```

Requiere **Python 3.10+** (el repo usa 3.12 para desarrollo).

## ⚙️ Configuración del LLM

El `graph_config` decide qué modelo usa. Nunca hardcodear claves — leerlas de variables de entorno.

```python
# Opción A — OpenAI (calidad alta, de pago)
graph_config = {
    "llm": {"api_key": os.getenv("OPENAI_API_KEY"), "model": "openai/gpt-4o-mini"},
    "verbose": True,
    "headless": True,
}

# Opción B — Ollama (local, gratis, privado)
graph_config = {
    "llm": {"model": "ollama/llama3.2", "model_tokens": 8192, "format": "json"},
    "verbose": True,
    "headless": True,
}
```

> Soporta también Azure OpenAI, Google Gemini, Anthropic, Groq y otros vía LiteLLM
> (cambia el `model` y la `api_key`). Para uso local sin costo, Ollama es la vía.

---

## 🧩 Pipelines (graphs) principales

| Graph | Qué hace |
|-------|----------|
| **SmartScraperGraph** | Scraper de **una página**: prompt + URL/fuente → JSON. El más usado. |
| **SearchGraph** | Scraper **multi-página**: extrae del top-N de resultados de un buscador. |
| **SmartScraperMultiGraph** | Mismo prompt aplicado a **varias URLs**. |
| **OmniScraperGraph** | Extrae texto **e imágenes** (multimodal). |
| **ScriptCreatorGraph** | Genera un **script Python** de scraping reutilizable. |
| **SpeechGraph** | Extrae info y genera un **archivo de audio** (TTS). |
| **DocumentScraperGraph** | Extrae de **documentos locales** (HTML/XML/JSON/MD/PDF/DOCX). |
| **DepthSearchGraph** | Búsqueda en **profundidad** siguiendo enlaces. |

---

## 💻 Uso — SmartScraperGraph (el caso típico)

```python
import os, json
from scrapegraphai.graphs import SmartScraperGraph

graph_config = {
    "llm": {"model": "ollama/llama3.2", "model_tokens": 8192, "format": "json"},
    "verbose": True,
    "headless": True,
}

scraper = SmartScraperGraph(
    prompt="Extrae la descripción de la empresa, los fundadores y los links de redes sociales",
    source="https://scrapegraphai.com/",   # también acepta una ruta a un archivo local o HTML crudo
    config=graph_config,
)

result = scraper.run()
print(json.dumps(result, indent=2, ensure_ascii=False))
```

Devuelve un `dict` estructurado, listo para guardar en BD o pasar a otra etapa.

### Multi-página desde un buscador

```python
from scrapegraphai.graphs import SearchGraph

search = SearchGraph(
    prompt="Lista los 5 mejores frameworks de scraping con IA y una frase de cada uno",
    config={**graph_config, "max_results": 5},
)
print(search.run())
```

### Salida con esquema fijo (Pydantic) — recomendado para pipelines serios

```python
from pydantic import BaseModel
from typing import List

class Fundador(BaseModel):
    nombre: str
    rol: str
    linkedin: str | None = None

class Empresa(BaseModel):
    descripcion: str
    fundadores: List[Fundador]

scraper = SmartScraperGraph(
    prompt="Extrae la empresa y sus fundadores",
    source="https://scrapegraphai.com/",
    config=graph_config,
    schema=Empresa,     # fuerza la forma de la salida
)
```

---

## 🔗 Encadenar con otras skills (Power Suite)

- **EXTRAER con scrapegraph-ai → EJECUTAR análisis en `microsandbox` → GENERAR reporte con `html-anything`.**
- Guardar el JSON resultante directo en Supabase (patrón de tus proyectos).

## 🛡️ Reglas de seguridad y buen uso

- **Claves:** siempre por `os.getenv`, nunca hardcodeadas ni commiteadas (usar `.env` gitignoreado).
- **Autorización:** scrapear solo sitios que te pertenecen o permiten el scraping; respetar `robots.txt`, términos de uso y rate limits.
- **Costo:** con LLMs de pago, cada corrida consume tokens; para desarrollo/loop rápido usar **Ollama local**.
- **Datos sensibles:** si el contenido trae datos personales, tratarlos según la política de privacidad del proyecto.

---

*Skill basada en la librería open-source ScrapeGraphAI (MIT). Créditos al equipo de ScrapeGraphAI. Esta skill es documentación de uso escrita para este repo; el código de la librería se instala desde PyPI.*
