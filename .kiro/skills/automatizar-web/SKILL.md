---
name: automatizar-web
description: >
  POWER SUITE: Automatizacion web total. Combina 4 skills en un arsenal completo:
  agent-browser (navegar, click, extraer, grabar), clonar (replicar sitios FIEL o
  RECREAR), microsandbox (ejecutar codigo en microVMs seguras), html-anything
  (generar HTML/reportes/presentaciones sandboxed). 8 capacidades: EXTRAER datos,
  LLENAR formularios, MONITOREAR cambios, GRABAR flujos, CLONAR-Y-MODIFICAR,
  EJECUTAR scripts en sandbox, GENERAR HTML visual, PIPELINE encadenado. Usar
  cuando el usuario dice automatizar, extraer datos, llenar formulario, monitorear
  sitio, grabar flujo, clonar y modificar, ejecutar bot, generar reporte, pipeline
  web, scraping seguro, bot automatico, o cualquier tarea web compleja.
triggers:
  - AUTOMATIZAR
  - automatizar web
  - extraer datos de
  - llenar formulario
  - monitorear sitio
  - monitorear cambios
  - grabar flujo
  - grabar navegacion
  - clonar y modificar
  - ejecutar bot
  - generar reporte
  - pipeline web
  - scraping seguro
  - bot automatico
  - automatizar todo
  - power suite
  - suite web
allowed-tools:
  - Bash(agent-browser:*)
  - Bash(npx agent-browser:*)
  - Bash(msb:*)
  - Bash
  - Read
  - Write
  - Browser
metadata:
  type: combo
  combines:
    - agent-browser
    - clonar
    - microsandbox
    - html-anything
  author: paillamilm-blip
---

# AUTOMATIZAR-WEB - Power Suite de Automatizacion

> 4 skills. 8 capacidades. Un comando. Toda la web es tuya.

```
AUTOMATIZAR [tarea]
EXTRAER [url] [que datos]
LLENAR [url] [datos]
MONITOREAR [url] [que vigilar]
GRABAR [url]
CLONAR [url] --modificar
EJECUTAR [script] --sandbox
GENERAR [tipo] [contenido]
PIPELINE [extraer de X] → [procesar] → [generar Y]
```

---

## Que es esto?

La Power Suite fusiona 4 herramientas en un arsenal completo para dominar la web:

| Componente | Aporta | Estrellas |
|-----------|--------|-----------|
| **agent-browser** | Navegar, click, llenar, extraer, screenshots, grabar video | CLI Rust nativa |
| **clonar** | Replicar sitios (modo FIEL o RECREAR en Next.js) | 2 metodologias |
| **microsandbox** | Ejecutar codigo en microVMs aisladas (hardware virtualization) | 7,966 ★ |
| **html-anything** | Generar HTML profesional, 75 skills x 9 superficies | 8,516 ★ |

**En simple:** Podes extraer datos de cualquier sitio, llenar formularios automaticamente, monitorear cambios 24/7, grabar lo que haces en el browser, clonar y personalizar sitios, ejecutar bots de forma segura, generar reportes visuales, y encadenar todo en pipelines.

---

## Las 8 Capacidades

| # | Capacidad | Comando | Skills usadas |
|---|-----------|---------|---------------|
| 1 | **EXTRAER** | `EXTRAER [url] [datos]` | agent-browser |
| 2 | **LLENAR** | `LLENAR [url] [datos]` | agent-browser |
| 3 | **MONITOREAR** | `MONITOREAR [url] [que]` | agent-browser + microsandbox |
| 4 | **GRABAR** | `GRABAR [url]` | agent-browser |
| 5 | **CLONAR-Y-MODIFICAR** | `CLONAR [url] --modificar` | clonar + html-anything |
| 6 | **EJECUTAR** | `EJECUTAR [script] --sandbox` | microsandbox |
| 7 | **GENERAR** | `GENERAR [tipo] [contenido]` | html-anything |
| 8 | **PIPELINE** | `PIPELINE [pasos]` | todas combinadas |

---

## 1. EXTRAER - Sacar datos de cualquier sitio

**Cuando usar:** Necesitas datos de una pagina web (precios, listados, tablas, textos).

```
EXTRAER https://ejemplo.com/productos "nombre, precio, stock"
EXTRAER https://linkedin.com/jobs "titulo, empresa, ubicacion"
EXTRAER https://news.ycombinator.com "titulo, puntos, comentarios"
```

### Como funciona:

```bash
# 1. Abrir sesion de browser
agent-browser session create --name extractor

# 2. Navegar al sitio
agent-browser navigate --session extractor --url "https://ejemplo.com"

# 3. Snapshot (ver el DOM como arbol accesible)
agent-browser snapshot --session extractor

# 4. Extraer datos via selectores o texto
agent-browser extract --session extractor --selector ".product-card" --fields "name,price"

# 5. Exportar resultados
# Output: JSON/CSV con los datos
```

### Ejemplo completo:

```
Usuario: "EXTRAER precios de MercadoLibre para 'notebook lenovo'"

Kiro:
1. Abro browser → navego a mercadolibre.cl
2. Busco "notebook lenovo" en el buscador
3. Snapshot → identifico cards de productos
4. Extraigo: nombre, precio, vendedor, envio, link
5. Resultado: tabla con 50 productos, ordenados por precio

| Producto | Precio | Vendedor | Envio |
|----------|--------|----------|-------|
| Lenovo IdeaPad 3 | $399.990 | TechStore | Gratis |
| Lenovo ThinkPad E14 | $549.990 | OfiMarket | $5.990 |
| ... | ... | ... | ... |
```

---

## 2. LLENAR - Completar formularios automaticamente

**Cuando usar:** Tenes que llenar formularios repetitivos (registros, postulaciones, encuestas).

```
LLENAR https://forms.google.com/xxx {nombre: "Juan", email: "j@x.com", cargo: "Dev"}
LLENAR https://portal.gobierno.cl/tramite {rut: "12345678-9", ...}
```

### Como funciona:

```bash
# 1. Navegar al formulario
agent-browser navigate --session form --url "https://forms.example.com"

# 2. Snapshot para ver campos disponibles
agent-browser snapshot --session form
# Output: @e1 input[name=email], @e2 input[name=nombre], @e3 select[name=pais]

# 3. Llenar campo por campo
agent-browser type --session form --element @e1 --text "juan@email.com"
agent-browser type --session form --element @e2 --text "Juan Perez"
agent-browser select --session form --element @e3 --value "Chile"

# 4. Submit
agent-browser click --session form --element @e4  # boton enviar

# 5. Verificar exito
agent-browser snapshot --session form  # ver mensaje de confirmacion
```

### Ejemplo completo:

```
Usuario: "LLENAR 20 postulaciones en LinkedIn con mis datos"

Kiro:
1. Abro browser → login a LinkedIn (vault de credenciales)
2. Navego a cada URL de postulacion
3. Detecto campos del formulario (snapshot)
4. Lleno: nombre, email, telefono, CV adjunto
5. Click "Postular" en cada uno
6. Resultado: 20 postulaciones enviadas, log con confirmaciones

Exitosas: 18/20
Fallidas: 2 (requerian respuesta personalizada - te las dejo marcadas)
```

---

## 3. MONITOREAR - Vigilar cambios en sitios 24/7

**Cuando usar:** Queres que te avise cuando algo cambia en un sitio (precio, stock, publicacion nueva).

```
MONITOREAR https://ejemplo.com/producto-x "cuando baje de $100.000"
MONITOREAR https://portal.pjud.cl "nuevos documentos en causa ROL-123"
MONITOREAR https://github.com/repo/releases "nueva release"
```

### Como funciona:

Combina agent-browser (para revisar el sitio) con microsandbox (para el bot persistente que corre 24/7):

```bash
# 1. Crear sandbox para el monitor
msb create node --name monitor-precios

# 2. Script de monitoreo (corre en la microVM)
msb exec monitor-precios "cat > /app/monitor.js << 'EOF'
const { chromium } = require('playwright');
const schedule = require('node-schedule');

// Revisar cada 30 minutos
schedule.scheduleJob('*/30 * * * *', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('https://ejemplo.com/producto-x');
  const precio = await page.textContent('.price');
  
  if (parseInt(precio.replace(/\D/g, '')) < 100000) {
    // ALERTA! Precio bajo
    console.log('ALERTA: Precio bajo a', precio);
    // Enviar notificacion (email, Slack, webhook)
  }
  await browser.close();
});
EOF"

# 3. Ejecutar en background
msb exec monitor-precios "node /app/monitor.js &"

# 4. Ver estado
msb exec monitor-precios "cat /app/logs/alerts.log"
```

### Ejemplo completo:

```
Usuario: "MONITOREAR el portal judicial, avisame cuando haya movimiento en mi causa"

Kiro:
1. Creo sandbox: msb create node --name monitor-pjud
2. Configuro bot que revisa cada 15 minutos
3. El bot navega al portal, busca la causa, compara estado
4. Si detecta cambio → alerta inmediata
5. Corre 24/7 en la microVM (no necesita tu PC prendida)

Status: Monitor activo ✓
Frecuencia: cada 15 min
Ultimo check: hace 3 min - sin cambios
Sandbox: monitor-pjud (running, CPU 0.1%, RAM 45MB)
```

---

## 4. GRABAR - Registrar flujos de navegacion

**Cuando usar:** Queres documentar un proceso web, crear tutoriales, o guardar evidencia.

```
GRABAR https://app.ejemplo.com "flujo de compra completo"
GRABAR https://admin.misite.com "como crear un usuario nuevo"
```

### Como funciona:

```bash
# 1. Iniciar grabacion
agent-browser session create --name recording --record

# 2. Navegar normalmente (todo queda grabado)
agent-browser navigate --session recording --url "https://app.ejemplo.com"
agent-browser click --session recording --element @e5
agent-browser type --session recording --element @e8 --text "datos"
# ... cada paso se registra

# 3. Detener grabacion
agent-browser session stop --name recording

# 4. Output
# - Video MP4 del flujo completo
# - Log de acciones paso a paso
# - Screenshots en cada paso clave
```

### Ejemplo completo:

```
Usuario: "GRABAR como hago una compra en mi tienda para documentar bugs"

Kiro:
1. Inicio grabacion (video + log de acciones)
2. Navego: home → categoria → producto → carrito → checkout → pago
3. En cada paso: screenshot + estado del DOM
4. Detecto si algo falla (errores JS, 404s, timeouts)
5. Resultado:

Grabacion: ./recordings/compra-flow-2025-01-15.mp4 (2:34 min)
Steps log: 12 pasos documentados
Bugs encontrados: 1 (boton "Agregar" no responde en mobile)
Screenshots: ./recordings/screenshots/ (12 archivos)
```

---

## 5. CLONAR-Y-MODIFICAR - Copiar un sitio y personalizarlo

**Cuando usar:** Queres tomar un sitio existente como base y modificarlo para tu proyecto.

```
CLONAR https://stripe.com/pricing --modificar "cambiar precios y colores a mi marca"
CLONAR https://linear.app --recrear --modificar "adaptar para mi SaaS"
```

### Como funciona:

Combina clonar (para obtener el sitio) con html-anything (para preview seguro de las modificaciones):

```
1. CLONAR el sitio (modo FIEL o RECREAR)
2. Modificar segun instrucciones del usuario
3. Preview sandboxed de los cambios (html-anything)
4. Iterar hasta que quede perfecto
5. Export final
```

### Ejemplo completo:

```
Usuario: "CLONAR la landing de Vercel y adaptarla para mi startup de fintech"

Kiro:
1. CLONAR vercel.com --recrear
   - Recon: Next.js, gradientes, dark mode, animaciones scroll
   - Rebuild en Next.js + Tailwind moderno
   
2. MODIFICAR:
   - Logo → tu logo de fintech
   - Colores → paleta fintech (azul oscuro + dorado)
   - Textos → tu propuesta de valor
   - Features → tus 3 features principales
   - Pricing → tus planes
   
3. PREVIEW sandboxed (html-anything)
   - Vista desktop 1440px ✓
   - Vista mobile 390px ✓
   - Interacciones (scroll, hover) ✓
   
4. EXPORT: proyecto Next.js listo para deploy

Resultado: landing profesional basada en el diseño de Vercel,
completamente personalizada para tu fintech.
Tiempo: ~15 minutos vs 3 dias desde cero.
```

---

## 6. EJECUTAR - Correr scripts/bots en sandbox seguro

**Cuando usar:** Necesitas ejecutar codigo que no es 100% confiable, o queres un entorno limpio.

```
EJECUTAR scraper.py --sandbox
EJECUTAR "npm install && npm test" --sandbox
EJECUTAR bot-telegram.js --sandbox --persistente
```

### Como funciona:

```bash
# 1. Crear microVM aislada
msb create python --name ejecutor

# 2. Copiar script
msb cp ./mi-script.py ejecutor:/app/script.py

# 3. Instalar dependencias (seguro, dentro de la VM)
msb exec ejecutor "pip install requests beautifulsoup4 pandas"

# 4. Ejecutar
msb exec ejecutor "python /app/script.py"

# 5. Extraer resultados
msb cp ejecutor:/app/output.csv ./resultados.csv

# 6. Limpiar
msb rm ejecutor
```

### Ejemplo completo:

```
Usuario: "EJECUTAR este script de scraping que encontre en GitHub (no se si es seguro)"

Kiro:
1. Creo sandbox aislado (microVM con su propio kernel)
2. Copio el script DENTRO del sandbox (no toca tu maquina)
3. Lo analizo: detecta que hace requests a 3 dominios, guarda en CSV
4. Instalo dependencias dentro del sandbox
5. Ejecuto y monitoreo (CPU, RAM, red)
6. Extraigo solo el CSV resultante a tu maquina
7. Elimino el sandbox

Resultado: datos extraidos de forma segura
El script no tuvo acceso a: tu filesystem, tus credenciales, tu red local
Riesgo: ZERO
```

---

## 7. GENERAR - Crear HTML/reportes/presentaciones

**Cuando usar:** Necesitas contenido visual profesional rapido (reportes, presentaciones, posters).

```
GENERAR reporte "ventas Q3 2025" --datos ventas.csv
GENERAR presentacion "intro a microservicios" --slides 8
GENERAR poster "evento tech meetup" --estilo moderno
GENERAR landing "mi producto SaaS" --con pricing
```

### Superficies disponibles:

| Superficie | Ideal para | Ejemplo |
|-----------|-----------|---------|
| Magazine | Contenido largo editorial | Case study, blog visual |
| Deck | Presentaciones | Pitch, clase, workshop |
| Poster | Impacto visual unico | Evento, producto, anuncio |
| Prototype | Mockups funcionales | App screens, user flows |
| Data Report | Datos + graficos | Dashboard, KPIs, analytics |
| Hyperframes | Mini-sitio navegable | Docs, multi-pagina |
| Tweet/X | Posts sociales | Anuncios, hilos visuales |
| Email | Newsletters | Campanas, updates |

### Ejemplo completo:

```
Usuario: "GENERAR un data report con los resultados del scraping que hicimos"

Kiro:
1. Tomo los datos extraidos (50 productos, precios, stock)
2. Superficie: Data Report
3. Genero HTML con:
   - KPI cards (total productos, precio promedio, % en stock)
   - Grafico de barras (top 10 mas baratos)
   - Grafico de torta (distribucion por vendedor)
   - Tabla completa filtrable
   - Narrativa automatica ("El precio promedio es $X, 
     el 80% tiene envio gratis...")
4. Preview sandboxed ✓
5. Export: reporte-productos.html (autocontenido, abrilo en Chrome)

Resultado: reporte profesional en 30 segundos.
```

---

## 8. PIPELINE - Encadenar capacidades

**Cuando usar:** Necesitas una tarea compleja que combina extraer, procesar y generar.

```
PIPELINE: extraer precios de [sitio] → comparar con competencia → generar reporte
PIPELINE: monitorear [url] → cuando cambie → ejecutar [script] → notificar
PIPELINE: clonar [sitio] → modificar → generar screenshots → enviar por email
```

### Sintaxis:

```
PIPELINE [paso1] → [paso2] → [paso3] → ...
```

Cada paso puede ser cualquiera de las 7 capacidades anteriores.

### Pipelines Pre-armados:

| Pipeline | Pasos | Para que |
|----------|-------|----------|
| **Inteligencia Competitiva** | EXTRAER precios → EJECUTAR analisis → GENERAR reporte | Saber precios de la competencia |
| **Monitor + Alerta** | MONITOREAR sitio → EJECUTAR script alertas → GENERAR resumen | Enterarte al instante de cambios |
| **Clone & Ship** | CLONAR sitio → MODIFICAR → GENERAR preview → EXPORT | Landing en 10 minutos |
| **Scrape & Report** | EXTRAER datos → EJECUTAR limpieza → GENERAR data report | De web cruda a reporte visual |
| **Full Automation** | LLENAR forms → GRABAR proceso → GENERAR documentacion | Automatizar + documentar |

### Ejemplo completo:

```
Usuario: "PIPELINE: extraer todos los arriendos de portalinmobiliario.com 
          en Santiago < $500.000, analizar con Python, y generar un reporte 
          visual con los mejores"

Kiro:

PASO 1 - EXTRAER (agent-browser):
→ Navego portalinmobiliario.com
→ Filtro: Santiago, arriendo, < $500.000
→ Extraigo: 127 propiedades (direccion, precio, m2, dormitorios, link)
→ Output: propiedades.json

PASO 2 - EJECUTAR (microsandbox):
→ Creo sandbox Python
→ Script de analisis:
  - Calcula precio/m2 para cada propiedad
  - Rankea por mejor relacion precio/espacio
  - Filtra: >2 dormitorios, cerca de metro
  - Output: top_20_propiedades.json

PASO 3 - GENERAR (html-anything):
→ Superficie: Data Report
→ Contenido:
  - Mapa con ubicaciones (top 20 marcadas)
  - KPIs: precio promedio, m2 promedio, mejor zona
  - Tabla interactiva ordenable
  - Graficos: precio vs m2, distribucion por comuna
→ Export: reporte-arriendos.html

RESULTADO FINAL:
- 127 propiedades analizadas
- Top 20 seleccionadas por precio/m2 + ubicacion
- Reporte visual interactivo listo
- Todo en 3 minutos, zero riesgo (sandbox aislado)
```

---

## Decision Tree - Que capacidad usar?

```
¿Que necesitas hacer?
│
├─ Sacar informacion de un sitio?
│  └─ EXTRAER
│
├─ Meter datos en un sitio?
│  └─ LLENAR
│
├─ Que te avise cuando algo cambie?
│  └─ MONITOREAR
│
├─ Documentar un flujo web?
│  └─ GRABAR
│
├─ Copiar un sitio y cambiarlo?
│  └─ CLONAR-Y-MODIFICAR
│
├─ Correr codigo sin riesgo?
│  └─ EJECUTAR
│
├─ Crear contenido visual (HTML)?
│  └─ GENERAR
│
└─ Varias cosas encadenadas?
   └─ PIPELINE
```

---

## Reglas Criticas de la Power Suite

### Seguridad:
1. **Codigo no confiable SIEMPRE en sandbox** - nunca ejecutar scripts desconocidos en el host
2. **Credenciales en vault** - agent-browser tiene vault cifrado para logins
3. **Preview sandboxed** - HTML generado se renderiza aislado
4. **Zero tracking** - nunca incluir analytics en outputs generados

### Calidad:
5. **Verificar en browser** - todo output se verifica visualmente antes de entregar
6. **Datos reales** - nunca inventar datos, siempre extraer de fuente
7. **Export autocontenido** - HTML con CSS inline, sin dependencias externas rotas
8. **Responsive** - todo funciona en desktop (1440px) y mobile (390px)

### Eficiencia:
9. **Pipeline > pasos sueltos** - si son 3+ pasos, encadenar automaticamente
10. **Sandbox reutilizable** - no crear uno nuevo por cada tarea menor
11. **Snapshot antes de cambios** - poder revertir si algo sale mal
12. **Logs siempre** - cada accion queda registrada para debug

---

## Configuracion Rapida

### Prerequisitos:

```bash
# agent-browser (CLI de automatizacion)
npm i -g agent-browser && agent-browser install

# microsandbox (microVMs)
curl -fsSL https://install.microsandbox.dev | sh

# html-anything (generacion HTML) - no requiere instalacion para uso basico
# El agente genera HTML directamente
```

### Verificar que todo funciona:

```bash
agent-browser --version    # ✓ CLI instalada
msb --version              # ✓ MicroSandbox instalado
msb create debian --name test && msb rm test  # ✓ VMs funcionando
```

---

## Tabla Resumen: Cuando usar que

| Situacion | Comando | Tiempo aprox |
|-----------|---------|--------------|
| "Necesito precios de la competencia" | `EXTRAER [url] "precios"` | 2-5 min |
| "Llena estas 50 postulaciones" | `LLENAR [urls] {datos}` | 10-30 min |
| "Avisame si baja de precio" | `MONITOREAR [url] "precio < X"` | Setup 2 min, corre 24/7 |
| "Documenta como uso el admin" | `GRABAR [url]` | lo que dure el flujo |
| "Quiero esa landing para mi" | `CLONAR [url] --modificar` | 10-20 min |
| "Corre este bot sin riesgo" | `EJECUTAR bot.py --sandbox` | 1-3 min |
| "Haceme un reporte visual" | `GENERAR reporte [datos]` | 30-60 seg |
| "Scrapeame, analizame, reporteame" | `PIPELINE [pasos]` | 3-10 min |

---

## Skills Referenciadas

| Skill | Ubicacion | Funcion |
|-------|-----------|---------|
| agent-browser | `kiro-skills/08-automatizacion/agent-browser/` | Browser automation CLI |
| clonar | `kiro-skills/08-automatizacion/clonar/` | Clonacion web (FIEL/RECREAR) |
| microsandbox | `kiro-skills/08-automatizacion/microsandbox/` | MicroVMs aisladas |
| html-anything | `kiro-skills/08-automatizacion/html-anything/` | Generacion HTML profesional |

---

## Ejemplo Final: Power Suite en Accion

```
Usuario: "Necesito automatizar todo el analisis de mi competencia. 
          Quiero precios actualizados, alertas cuando cambien, 
          y un reporte semanal bonito."

Kiro:

SETUP (una vez):
1. EJECUTAR → Creo sandbox "competencia-bot" con Python + dependencias
2. MONITOREAR → Configuro checks cada 6 horas a los 5 sitios competidores

DIARIO (automatico):
3. EXTRAER → El bot extrae precios de los 5 competidores
4. EJECUTAR → Script Python analiza: cambios, tendencias, anomalias
5. Si detecta cambio importante → alerta inmediata

SEMANAL (automatico):
6. GENERAR → Data Report con:
   - Evolucion de precios (grafico lineal 7 dias)
   - Comparativa vs tus precios
   - Productos nuevos detectados
   - Recomendaciones automaticas
7. Export → PDF enviado a tu email

RESULTADO:
- Zero trabajo manual
- Datos frescos cada 6 horas
- Alertas instantaneas si algo cambia
- Reporte profesional cada lunes
- Todo en sandbox seguro (los competidores no detectan nada)
```

---

> **Power Suite = agent-browser + clonar + microsandbox + html-anything**
> 
> La web completa automatizada. Extraer. Llenar. Monitorear. Grabar. Clonar. Ejecutar. Generar. Encadenar.
