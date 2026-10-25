-- ============================================================
-- CausasPro - Limpiar contadores de intentos y cuarentenas de `notas`
-- ------------------------------------------------------------
-- PARA QUE: devolver a la cola del bot las causas que acumularon fallos que NO
-- eran suyos. Hasta el commit 9eb9fae, cuando el bot perdia la sesion del portal
-- (el panel de Familia deja de estar accesible) seguia recorriendo la lista y le
-- sumaba [INTENTOS FALLIDOS: n] a cada causa que "no encontraba". A los 3 fallos
-- la causa pasaba a [REVISAR: no scrapeada] y getCausasToScrape la EXCLUIA de la
-- cola: una causa perfectamente valida desaparecia del monitoreo en silencio.
--
-- El bot ya no hace eso (ahora distingue el fallo de panel del "no existe" y
-- corta la tanda). Este script limpia lo que quedo de antes.
--
-- QUE BORRA: solo las lineas [INTENTOS FALLIDOS: n] y [REVISAR: no scrapeada].
-- QUE CONSERVA: todo lo demas, en su orden original — [NO EN PORTAL] (que SI es
-- confiable: se marca solo cuando el portal confirma el mensaje "no existen
-- causas"), [VINCULO], [REVISAR LETRA], [ASIGNACION] y las notas escritas a mano.
--
-- Es IDEMPOTENTE: se puede correr las veces que sea.
-- ============================================================

-- PASO 1 (opcional) — mirar el estado antes de tocar nada.
SELECT
  COUNT(*) FILTER (WHERE notas LIKE '%[INTENTOS FALLIDOS:%')     AS con_contador,
  COUNT(*) FILTER (WHERE notas LIKE '%[REVISAR: no scrapeada]%') AS en_cuarentena,
  COUNT(*) FILTER (WHERE notas LIKE '%[NO EN PORTAL]%')          AS no_en_portal,
  COUNT(*)                                                       AS total
FROM causas;

-- PASO 2 — la limpieza.
-- Se trabaja LINEA POR LINEA (string_to_array + unnest) en vez de con regexp_replace:
-- el bot escribe cada marca en su propia linea, asi que filtrar lineas es exacto y no
-- corre riesgo de comerse texto vecino. WITH ORDINALITY + ORDER BY conserva el orden
-- original (sin eso, el orden de unnest no esta garantizado). NULLIF deja la columna en
-- NULL si la causa no tenia mas que el contador, para no dejar un string vacio.
UPDATE causas c
SET notas = NULLIF((
  SELECT string_agg(t.linea, E'\n' ORDER BY t.n)
  FROM unnest(string_to_array(c.notas, E'\n')) WITH ORDINALITY AS t(linea, n)
  WHERE t.linea NOT LIKE '%[INTENTOS FALLIDOS:%'
    AND t.linea NOT LIKE '%[REVISAR: no scrapeada]%'
), '')
WHERE c.notas LIKE '%[INTENTOS FALLIDOS:%'
   OR c.notas LIKE '%[REVISAR: no scrapeada]%';

-- PASO 3 — confirmar que quedo limpio (las dos primeras columnas deben dar 0).
SELECT
  COUNT(*) FILTER (WHERE notas LIKE '%[INTENTOS FALLIDOS:%')     AS con_contador,
  COUNT(*) FILTER (WHERE notas LIKE '%[REVISAR: no scrapeada]%') AS en_cuarentena,
  COUNT(*) FILTER (WHERE notas LIKE '%[NO EN PORTAL]%')          AS no_en_portal,
  COUNT(*)                                                       AS total
FROM causas;
