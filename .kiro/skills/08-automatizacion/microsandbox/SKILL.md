---
name: microsandbox
description: >
  Ejecutar codigo en microVMs aisladas con hardware virtualization. Crear sandboxes
  desde imagenes (Python, Node, Debian, etc.), correr scripts de forma segura,
  instalar dependencias sin riesgo. Usar cuando el usuario dice ejecutar en sandbox,
  correr codigo aislado, microvm, sandbox seguro, ejecutar script seguro,
  bot persistente, correr en aislamiento, o necesita ejecutar codigo no confiable.
triggers:
  - ejecutar en sandbox
  - correr en sandbox
  - sandbox seguro
  - microvm
  - ejecutar script
  - bot persistente
  - codigo aislado
  - run in sandbox
  - ejecutar aislado
  - instalar dependencias seguro
allowed-tools:
  - Bash
  - Read
  - Write
metadata:
  type: skill
  source: https://github.com/superradcompany/microsandbox
  stars: 7966
  language: Rust
  author: paillamilm-blip
---

# MICROSANDBOX - MicroVMs Aisladas para Codigo Seguro

> Ejecuta cualquier cosa sin miedo. Hardware virtualization real (no containers).

```
msb create python --name worker
msb exec worker "python -c 'print(hello)'"
msb create node --name api-test
```

## Que es esto?

MicroSandbox es un runtime de microVMs que usa virtualizacion de hardware (como una mini computadora adentro de tu computadora). Cada sandbox tiene su propio kernel (el cerebro del sistema operativo), filesystem (disco) y red. Es como tener una laptop desechable para cada tarea.

**Diferencia con Docker:** Docker comparte el kernel del host (menos aislado). MicroSandbox crea una VM completa por tarea (aislamiento total, como si fuera otro PC).

## Para que sirve?

| Caso de uso | Ejemplo |
|-------------|---------|
| **Codigo no confiable** | Correr un script que te pasaron sin arriesgar tu maquina |
| **Bots persistentes** | Un scraper que corre 24/7 sin ensuciar el host |
| **Instalar dependencias** | `pip install` o `npm install` sin contaminar tu entorno |
| **Tests automatizados** | Correr tests en un entorno limpio cada vez |
| **Scrapers aislados** | Navegar sitios sospechosos sin riesgo |
| **CI jobs** | Build + test en VM fresca por commit |
| **AI agent actions** | Dejar que un agente AI ejecute codigo de forma segura |

## Instalacion

```bash
# Opcion 1: Script de instalacion (recomendado)
curl -fsSL https://install.microsandbox.dev | sh

# Opcion 2: via npx (sin instalar nada global)
npx microsandbox run debian

# Verificar instalacion
msb --version
```

## Comandos Principales (CLI)

| Comando | Que hace |
|---------|----------|
| `msb create <imagen> --name <nombre>` | Crear un sandbox nuevo |
| `msb exec <nombre> "<comando>"` | Ejecutar algo dentro del sandbox |
| `msb list` | Ver sandboxes activos |
| `msb stop <nombre>` | Detener un sandbox |
| `msb rm <nombre>` | Eliminar un sandbox |
| `msb snapshot <nombre> --tag <tag>` | Guardar estado actual |
| `msb restore <nombre> --tag <tag>` | Restaurar desde snapshot |

## Imagenes Disponibles

| Imagen | Incluye |
|--------|---------|
| `python` | Python 3.x + pip |
| `node` | Node.js LTS + npm |
| `debian` | Debian base (apt-get para todo) |
| `ubuntu` | Ubuntu base |
| `rust` | Rust toolchain |
| `go` | Go toolchain |

## SDK (para usar desde codigo)

### TypeScript/Node.js

```typescript
import { Sandbox } from "microsandbox";

// Crear sandbox
const sb = await Sandbox.create({ image: "python" });

// Ejecutar codigo
const result = await sb.exec("python", ["-c", "print('Hola desde microVM!')"]);
console.log(result.stdout); // "Hola desde microVM!"

// Instalar dependencias dentro del sandbox
await sb.exec("pip", ["install", "requests", "beautifulsoup4"]);

// Correr script completo
await sb.exec("python", ["scraper.py"]);

// Detener
await sb.stop();
```

### Python SDK

```python
from microsandbox import Sandbox

# Crear sandbox
sb = Sandbox.create(image="python")

# Ejecutar
result = sb.exec("python", ["-c", "import sys; print(sys.version)"])
print(result.stdout)

# Limpiar
sb.stop()
```

## Workflows Comunes

### 1. Bot Scraper Persistente

```bash
# Crear sandbox para el bot
msb create python --name scraper-bot

# Instalar dependencias
msb exec scraper-bot "pip install requests beautifulsoup4 schedule"

# Copiar script al sandbox
msb cp ./scraper.py scraper-bot:/app/scraper.py

# Ejecutar en background
msb exec scraper-bot "python /app/scraper.py &"

# Ver logs
msb exec scraper-bot "cat /app/logs/output.log"

# Snapshot (guardar estado)
msb snapshot scraper-bot --tag "v1-configurado"
```

### 2. Test de Dependencias Seguro

```bash
# Crear sandbox temporal
msb create node --name test-deps

# Instalar paquete sospechoso de forma segura
msb exec test-deps "npm install some-unknown-package"

# Verificar que no hace nada raro
msb exec test-deps "cat /etc/passwd"  # no tiene acceso al host

# Eliminar cuando terminas
msb rm test-deps
```

### 3. Entorno de CI Limpio

```bash
# Nuevo sandbox por cada build
msb create node --name ci-$(date +%s)

# Clonar, instalar, testear
msb exec ci-xxx "git clone <repo> && cd repo && npm ci && npm test"

# Resultado sin contaminar host
msb rm ci-xxx
```

## Capacidades Avanzadas

| Feature | Descripcion |
|---------|-------------|
| **Volumes** | Montar carpetas del host dentro del sandbox |
| **Secrets** | Inyectar variables de entorno seguras |
| **Snapshots** | Guardar/restaurar el estado completo |
| **SSH** | Conectarte por SSH al sandbox |
| **Networking** | Red aislada, port forwarding configurable |
| **Metrics** | CPU, RAM, disco por sandbox |
| **Multi-sandbox** | Varios sandboxes hablando entre si via red privada |

## Configuracion via YAML

```yaml
# microsandbox.yaml
sandboxes:
  scraper:
    image: python
    volumes:
      - ./scripts:/app/scripts
      - ./data:/app/data
    secrets:
      - API_KEY
    ports:
      - 8080:8080
    resources:
      cpu: 2
      memory: 512M
```

```bash
msb up  # levanta todos los sandboxes del yaml
msb down  # los baja
```

## Reglas Criticas

1. **Siempre usar sandbox para codigo no confiable** - nunca correr scripts desconocidos en el host
2. **Snapshot antes de cambios grandes** - poder volver atras si algo falla
3. **Limpiar sandboxes terminados** - no dejar VMs zombies consumiendo recursos
4. **Volumes para persistencia** - el filesystem del sandbox se pierde al eliminarlo
5. **Secrets via env, nunca hardcoded** - usar `--secret` o el yaml

## Ejemplo Completo: Scraper Seguro

```
Usuario: "Necesito scrapear este sitio pero no confio en el script que me pasaron"

Kiro:
1. Creo sandbox aislado: msb create python --name safe-scraper
2. Copio el script al sandbox (no toca tu maquina)
3. Instalo dependencias DENTRO del sandbox
4. Ejecuto el script en la microVM
5. Extraigo solo los datos resultantes
6. Elimino el sandbox

Resultado: datos extraidos, tu maquina intacta, zero riesgo.
```

## Links

- Repo: https://github.com/superradcompany/microsandbox
- Docs: https://microsandbox.dev
- Install: https://install.microsandbox.dev
