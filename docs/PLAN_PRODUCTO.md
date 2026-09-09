# Plan de Producto — Copiloto de Decisiones Legales

> Documento vivo. Consolida la investigación de mercado, el posicionamiento, el
> inventario de activos reutilizables de CausasPro y el plan de construcción por fases.
>
> **Última actualización:** septiembre 2026

---

## 1. La visión en una frase

> **No vendemos un archivador de causas. Vendemos velocidad y claridad para decidir.**
> Un buen abogado se paga por tomar buenas decisiones a tiempo — y para eso necesita
> información instantánea, interpretada y priorizada. Eso es lo que construimos.

**Nombre de trabajo:** Copiloto de Decisiones Legales (definir marca comercial).

---

## 2. El problema real

Un abogado con 30–200 causas vive con dos dolores:

1. **Miedo a que se le pase un plazo** (riesgo de negligencia, preclusión, pérdida de derechos).
2. **Sobrecarga mental**: revisar el PJUD causa por causa, interpretar el "legalés",
   calcular plazos y decidir la siguiente acción — todos los días.

Y un tercer dolor de negocio que casi nadie resuelve integrado:

3. **Cobrar bien lo que trabaja**: cuánto le cobra a cada cliente, en cuántas cuotas,
   cuánto le han pagado y cuánto le deben. En Chile, cobrar honorarios es un dolor
   documentado para los profesionales independientes.

**El insight central:** el abogado no paga por "gestionar". Paga por **decidir rápido y bien**,
porque de esa capacidad depende cuánto puede cobrar y cuántas causas puede atender.

---

## 3. Investigación de mercado (2026)

### Contexto macro
- El mercado de **IA vertical** (agentes de industria específica) es el patrón ganador de 2026:
  soluciones que resuelven UN problema de UNA industria mejor que un chatbot genérico.
- El diferenciador ya **no es "tener IA"** (todos la tienen). El diferenciador es
  **nicho + precio + experiencia + confiabilidad del dato**.

### Competencia directa en Chile

| Competidor | Qué hace | Para quién | Precio | Debilidad |
|---|---|---|---|---|
| **CaseTracking (Lemontech)** | Seguimiento PJUD en tiempo real + capa de IA. Líder del mercado. | Estudios grandes / gerencias legales (cientos de causas) | No público (demo/cotización) → enterprise, caro | Pesado y caro. **Ignora al independiente y al estudio chico.** |
| **CausAlerta** | Monitorea causas + resumen diario con enlaces a documentos del PJUD | Abogados que quieren alertas simples | No público en resultados indexados | Solo alertas. **Sin CRM de clientes, sin honorarios/cuotas.** |
| **AbogaCloud** | Gestión de estudio: vencimientos, expedientes, honorarios, agenda, escritos con IA | Estudios que quieren un ERP legal | No público en resultados indexados | **El seguimiento automático del PJUD no parece ser su fuerte.** |

### Referente internacional relevante
- **JuristPay (EE.UU.)**: producto dedicado SOLO a la parte financiera del abogado —
  facturación, retainers, **planes de pago en cuotas rastreadas por separado**, cobranza.
  Confirma que "cuánto cobras + cuántas cuotas + seguimiento de pagos" es un producto
  entero por sí mismo en mercados maduros. **En Chile nadie lo une con el seguimiento del PJUD.**

### El hueco de mercado
- **Nadie publica precios** → mercado de venta consultiva. Oportunidad de ser el único con
  **precio transparente y autoservicio** ("te suscribes online, sin llamadas de ventas").
- CaseTracking es enterprise → deja libre el segmento **independiente + estudios chicos (2–10 personas)**.
- Nadie cierra el círculo **causa → decisión → cliente → cobro**.

---

## 4. Posicionamiento

> **"El sistema que no solo te avisa qué pasó en tus causas — te dice qué decidir y cuándo,
> y además te ayuda a cobrar. Seguimiento del PJUD + copiloto de decisiones con IA +
> control de honorarios y cuotas + portal para tus clientes. Para el abogado independiente
> y estudios que quieren crecer sin perder plata (ni plazos)."**

### Por qué gana
- 🎯 Ataca el segmento que el gigante ignora (independientes + estudios chicos).
- ⚡ Vende **decisión** (premium), no "gestión" (commodity).
- 💰 Resuelve el dolor del dinero que nadie resuelve integrado.
- 📈 Camino de crecimiento natural: independiente → estudio → asociación.

### Mapa competitivo
```
                    SIMPLE / BARATO
                          |
      CausAlerta *        |
   (solo alertas PJUD)    |        * NUESTRA OPORTUNIDAD
   -----------------------+-----------------------
   Sin gestion            |            Con gestion
   de cartera             |            completa
                          |      * AbogaCloud
                          |       (CRM, sin scraping fuerte)
                          |   * CaseTracking
                          |    (enterprise, caro)
                    COMPLEJO / CARO
```

---

## 5. El producto: "copiloto de decisiones"

El corazón no es una base de datos: es un **motor de decisiones priorizadas**.
Cada elemento no es "un dato", es **una decisión interpretada, priorizada y con acción sugerida**.

Ejemplo de la pantalla principal ("Qué necesitas decidir hoy"):

```
+----------------------------------------------------+
|  QUE NECESITAS DECIDIR HOY                          |
+----------------------------------------------------+
|  CRITICO — decide ahora                             |
|  Causa Perez (C-1234): te dieron traslado           |
|  -> Vence jueves. Si no respondes, precluye.        |
|  [Ver detalle]  [Borrador IA]  [Marcar hecho]       |
|                                                     |
|  IMPORTANTE — esta semana                           |
|  Causa Lopez: audiencia el lunes 9AM                |
|  -> Prepara: prueba testimonial pendiente           |
|                                                     |
|  OPORTUNIDAD                                         |
|  Causa Soto: la contraparte no respondio            |
|  -> Puedes acusar rebeldia                          |
+----------------------------------------------------+
```

### Diferencia frente a la competencia

| Competencia | Nosotros |
|---|---|
| "Tu causa tuvo un movimiento: 'Se confiere traslado'" | "Te dieron traslado. Tienes hasta el jueves (5 días hábiles). Riesgo si no actúas: precluye. Acción sugerida: contestar. ¿Preparo un borrador?" |
| Información cruda | Información procesada para decidir |
| Herramienta administrativa | Ventaja competitiva del abogado |

---

## 6. Los 3 pilares del producto

1. **⚡ Motor de decisiones (corazón)** — IA que lee el PJUD, interpreta, prioriza por
   urgencia/riesgo y sugiere la acción. *No datos: decisiones.*
2. **🤖 Seguimiento automático del PJUD (combustible)** — el bot que alimenta el motor con
   info fresca cada día.
3. **💰 Control de honorarios y cuotas (negocio)** — para que además de decidir bien, cobre bien.

### Features innovadores (elegir 2–3 para diferenciar, no todos)

| # | Feature | Por qué pega |
|---|---|---|
| 1 | **Resumen IA del movimiento** | Traduce el "legalés" a acción concreta con plazo y riesgo. Valor inmediato. |
| 2 | **Motor de cuotas y cobranza** | Cada cuota rastreada por separado + recordatorio automático al cliente. Nadie lo une con el PJUD en Chile. |
| 3 | **Portal del cliente** | El cliente ve el estado de SU causa + sus cuotas. Reduce las llamadas de "¿cómo va lo mío?". |
| 4 | **Honorario de éxito automático** | Calcula el % de lo ganado cuando la causa termina. Único en el mercado. |
| 5 | **Modo asociación (multi-abogado)** | Cada abogado ve su cartera; el estudio ve el consolidado y reparte honorarios entre socios. |

---

## 7. Inventario de activos reutilizables (repo `causaspro`)

**Stack confirmado:** Next.js 14 + React 18 + Supabase + Playwright + TypeScript + Tailwind.

| Activo | Ubicación | Qué hace | Valor |
|---|---|---|---|
| **Bot del PJUD completo** | `src/bot/modules/` | Login OJV, búsqueda, scraping, sync | ⭐⭐⭐⭐⭐ El corazón, difícil de copiar |
| **Motor de detección de urgencia** | `src/bot/modules/detection.ts` | Nivel de urgencia 1–10 + motivos + acción inmediata | ⭐⭐⭐⭐⭐ Embrión del "copiloto de decisiones" |
| **Semáforo de decisión (UI)** | `src/components/Dashboard.tsx` | Colores por urgencia + motivo legible | ⭐⭐⭐⭐ Ya prioriza visualmente |
| **Sync inteligente a Supabase** | `src/bot/modules/supabaseSync.ts` | Inserta solo movimientos nuevos (anti-duplicados), logs | ⭐⭐⭐⭐ Robusto |
| **Config anti-detección** | `src/bot/config/index.ts` | Delays humanos, horario laboral, límite por sesión, user-agent | ⭐⭐⭐⭐ Mitiga riesgo de CAPTCHA |
| **Modelo de datos** | `schema*.sql` | causas, movimientos, audiencias, medidas, bot_runs | ⭐⭐⭐ Base sólida para extender |
| **Ingesta por email (IMAP)** | `src/email/` | Lee correos del PJUD y parsea | ⭐⭐⭐ Fuente alternativa al scraping (menos riesgo de bloqueo) |

### Hallazgo clave
`detection.ts` **ya calcula** lo que definimos como corazón del producto:
`nivel_urgencia` (1–10), `motivos`, `requiere_accion_inmediata`, `dias_para_audiencia`.
El copiloto **no se construye de cero: se evoluciona** desde este módulo.

---

## 8. Arquitectura objetivo

```
+- CAPA 1: INGESTA (ya existe) ----------------------+
|  Bot Playwright OJV  +  Ingesta email IMAP         |
|  -> alimenta la BD con movimientos frescos         |
+---------------------+-------------------------------+
                     v
+- CAPA 2: MOTOR DE DECISION (evolucionar) ----------+
|  detection.ts (urgencia 1-10) + NUEVA capa IA      |
|  -> "Te dieron traslado, responde antes del jueves"|
+---------------------+-------------------------------+
                     v
+- CAPA 3: NEGOCIO (nuevo) --------------------------+
|  Clientes + Honorarios + Cuotas + Cobranza         |
+---------------------+-------------------------------+
                     v
+- CAPA 4: EXPERIENCIA (evolucionar) ----------------+
|  Dashboard "Que decidir hoy" + Portal cliente      |
|  Multi-abogado (asociacion)                        |
+----------------------------------------------------+
```

---

## 9. Plan de construcción por fases

- **Fase 1 — MVP (ya casi lo tienes)**
  Seguimiento PJUD (bot) + Clientes + Causas + Alertas de plazos.
  Generalizar `detection.ts` (hoy es específico de causas proteccionales / NNA / curador)
  para que sirva a cualquier tipo de causa (civil, laboral, familia, cobranza).

- **Fase 2 — El diferenciador**
  Capa IA que traduce el movimiento a acción concreta + Dashboard "Qué decidir hoy".

- **Fase 3 — El negocio**
  Motor de honorarios + cuotas + dashboard financiero + recordatorios de cobro.

- **Fase 4 — Retención y escala**
  Portal del cliente + Modo multi-abogado / asociación + reparto de honorarios.

---

## 10. Modelo de precios (hipótesis a validar)

Rangos estimados de mercado (NO confirmados — pendiente validar con los competidores):

| Segmento | Rango mensual estimado (CLP) |
|---|---|
| CaseTracking (estudios grandes) | Alto: ~$100.000–$500.000+/mes, negociado |
| CausAlerta (solo alertas) | Bajo/medio: ~$15.000–$50.000/mes |
| AbogaCloud (gestión estudio) | Medio: ~$20.000–$80.000/mes |
| **Nuestro precio sugerido** | **$25.000–$60.000/mes** independiente + planes de estudio |

**Ventaja de precio:** publicar el precio y ofrecer autoservicio, mientras la competencia lo esconde.

---

## 11. Riesgos y decisiones abiertas

### Riesgo #1 — Detección de bots en el PJUD (crítico)
- El portal OJV muestra CAPTCHA ante comportamiento no humano. Contexto: en julio 2026 un
  abogado colapsó el sistema con 38k escritos automatizados; el PJUD vigila bots.
- **Estado actual:** la detección activa de CAPTCHA en el flujo login/search **no está
  implementada** (los selectores existen en config pero no se usan). Pendiente: abortar
  limpio y notificar cuando se detecte CAPTCHA.
- Escalar a muchos abogados = muchas más consultas al PJUD = más riesgo. **Es el mayor
  desafío técnico y de negocio, pero también el foso defensivo** (si se resuelve bien,
  es difícil de copiar).
- **Mitigación existente:** delays 10–25s, horario laboral 8–18h, límite por sesión,
  user-agent real. **Alternativa de menor riesgo:** priorizar la ingesta por email (IMAP)
  sobre el scraping cuando sea posible.

### Decisiones abiertas
1. ¿Diferenciador principal: cobro/cuotas, resumen IA, o portal del cliente?
2. ¿Apuntar primero al abogado independiente o al estudio chico (2–10)?
3. Validar precios reales de la competencia (requiere abrir sus webs / pedir cotización).
4. ¿El bot revisa SOLO las causas cargadas (`getCausasToScrape`) o todo el portal?
   (Decisión de negocio ya identificada en la bitácora del bot.)

---

## 12. Próximos pasos sugeridos

1. Validar el diferenciador principal con 2–3 abogados reales (entrevistas cortas).
2. Prototipar el dashboard "Qué decidir hoy" sobre el motor `detection.ts` existente.
3. Generalizar `detection.ts` para tipos de causa más allá de proteccional.
4. Diseñar el modelo de datos de clientes + honorarios + cuotas.
5. Resolver la detección de CAPTCHA antes de escalar a múltiples usuarios.
