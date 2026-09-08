#!/usr/bin/env python3
# ============================================================
# CAUSASPRO BOT PJUD - Nova Act (IA)
# v3: Busca las causas ASIGNADAS UNA POR UNA por su RIT, ENTRA al
#     detalle de cada causa y copia TODA la informacion:
#     - Historial completo de movimientos/tramitacion
#     - Todas las audiencias
#     - Deteccion de "TRASLADO AL CURADOR"
#
# Guarda en Supabase: tablas `movimientos` y `audiencias`
# (ademas de actualizar datos basicos en `causas`).
#
# Variables de entorno requeridas:
#   PJUD_RUT, PJUD_PASSWORD          - credenciales Clave Unica
#   NEXT_PUBLIC_SUPABASE_URL         - URL de Supabase
#   SUPABASE_SERVICE_ROLE_KEY        - service role key
#   NOVA_ACT_API_KEY                 - API key de Nova Act
#   LIMITE_CAUSAS (opcional)         - limitar cuantas causas revisar
# ============================================================

import os
import sys
import json
import time
import urllib.request
import urllib.error
import urllib.parse
import re
from datetime import datetime, timezone
from typing import List
from pydantic import BaseModel, Field
from nova_act import NovaAct

MESES = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6,
    "julio": 7, "agosto": 8, "septiembre": 9, "setiembre": 9, "octubre": 10,
    "noviembre": 11, "diciembre": 12,
}

# Patrones que marcan una causa como URGENTE (traslado al curador)
PATRONES_TRASLADO = [
    "TRASLADO AL CURADOR",
    "TRASLADO CURADOR AD LITEM",
    "TRASLADO CURADOR",
    "TRASL. CURADOR",
    "TRASL CURADOR",
]


def partir_rit(rit):
    if not rit:
        return None
    t = str(rit).strip().upper().replace(" ", "")
    m = re.match(r"^([A-Z]+)[-\s]?(\d+)[-\s]?(\d{4})$", t)
    if m:
        letra, rol, anio = m.groups()
        return (letra, rol, anio)
    m = re.match(r"^(\d+)[-\s]?(\d{4})$", t)
    if m:
        rol, anio = m.groups()
        return ("", rol, anio)
    return None


def normalizar_fecha(texto):
    if not texto:
        return None
    t = str(texto).strip().lower()
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", t)
    if m:
        y, mo, d = m.groups()
        return f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"
    m = re.match(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})", t)
    if m:
        d, mo, y = m.groups()
        if len(y) == 2:
            y = "20" + y
        return f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"
    m = re.match(r"^(\d{1,2})\s+de\s+([a-zñ]+)\s+de\s+(\d{4})", t)
    if m:
        d, mes, y = m.groups()
        if mes in MESES:
            return f"{int(y):04d}-{MESES[mes]:02d}-{int(d):02d}"
    return None


def detectar_traslado_curador(texto):
    """True si el texto contiene algun patron de TRASLADO AL CURADOR."""
    if not texto:
        return False
    upper = str(texto).upper()
    return any(p in upper for p in PATRONES_TRASLADO)


PJUD_RUT = os.environ.get("PJUD_RUT", "")
PJUD_PASSWORD = os.environ.get("PJUD_PASSWORD", "")
SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
LIMITE = int(os.environ.get("LIMITE_CAUSAS", "0"))
PORTAL_URL = "https://oficinajudicialvirtual.pjud.cl/home/index.php"


# ============================================================
# MODELOS (lo que la IA extrae de la pagina)
# ============================================================
class Movimiento(BaseModel):
    fecha: str = ""
    etapa: str = ""
    tramite: str = ""
    descripcion: str = ""


class Audiencia(BaseModel):
    fecha: str = ""
    tipo: str = ""
    sala: str = ""
    estado: str = ""


class DatosCausa(BaseModel):
    encontrada: bool = False
    rit: str = ""
    tribunal: str = ""
    caratulado: str = ""
    fecha_ingreso: str = ""
    estado: str = ""


class DetalleCausa(BaseModel):
    """Todo lo que se lee DENTRO del detalle de una causa."""
    movimientos: List[Movimiento] = Field(default_factory=list)
    audiencias: List[Audiencia] = Field(default_factory=list)


def log(msg):
    hora = datetime.now().strftime("%H:%M:%S")
    print(f"[{hora}] {msg}", flush=True)


def http(url, method="GET", body=None):
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        headers["Prefer"] = "return=minimal"
        data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode()
            return resp.status, raw
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except Exception as e:
        return 0, str(e)


def leer_rits():
    rits = []
    offset = 0
    pagina = 1000
    while True:
        url = (f"{SUPABASE_URL}/rest/v1/causas?select=id,rit&order=rit"
               f"&limit={pagina}&offset={offset}")
        status, body = http(url)
        if status != 200:
            log(f"ERROR leyendo causas de Supabase (HTTP {status}): {body[:200]}")
            break
        try:
            filas = json.loads(body)
        except Exception as e:
            log(f"ERROR parseando respuesta de Supabase: {e}")
            break
        if not filas:
            break
        for f in filas:
            if f.get("rit"):
                rits.append((f["id"], (f.get("rit") or "").strip()))
        if len(filas) < pagina:
            break
        offset += pagina
    return rits


def actualizar_causa(causa_id, datos: DatosCausa, tiene_traslado: bool):
    payload = {
        "estado": datos.estado or None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if datos.caratulado:
        payload["caratulado"] = datos.caratulado
    fecha_iso = normalizar_fecha(datos.fecha_ingreso)
    if fecha_iso:
        payload["fecha_apertura"] = fecha_iso
    notas = []
    if datos.tribunal:
        notas.append(f"Tribunal: {datos.tribunal}")
    if datos.fecha_ingreso and not fecha_iso:
        notas.append(f"Fecha ingreso: {datos.fecha_ingreso}")
    if tiene_traslado:
        notas.append("🔴 TRASLADO AL CURADOR detectado")
    if notas:
        payload["notas"] = " | ".join(notas)
    rit_enc = urllib.parse.quote(str(causa_id), safe="")
    url = f"{SUPABASE_URL}/rest/v1/causas?id=eq.{rit_enc}"
    status, body = http(url, method="PATCH", body=payload)
    if 200 <= status < 300:
        return True
    log(f"   ERROR Supabase (HTTP {status}): {body[:150]}")
    return False


def guardar_movimientos(causa_id, movimientos: List[Movimiento]):
    """Inserta los movimientos leidos del detalle. Devuelve (insertados, tiene_traslado).

    Re-sincronizacion FAIL-SAFE: primero INSERTA los nuevos (marcados con un run_id
    unico), y SOLO si la insercion tuvo exito, BORRA los del bot que no son de esta
    corrida. Asi, si el insert falla, la causa conserva sus movimientos anteriores
    (nunca queda vacia por un error de red)."""
    if not movimientos:
        return 0, False

    # 1. Armar los registros. El flag `tiene_traslado` se calcula SOLO sobre los
    #    movimientos que efectivamente se guardan (coherente con lo que luego lee
    #    la vista de urgencia desde movimientos.es_traslado_curador).
    run_id = f"pjud_bot_{int(time.time())}"
    registros = []
    tiene_traslado = False
    for m in movimientos:
        # Requiere al menos un tramite o una fecha para valer la pena
        if not (m.tramite or m.fecha):
            continue
        texto_completo = " ".join([m.etapa or "", m.tramite or "", m.descripcion or ""])
        es_traslado = detectar_traslado_curador(texto_completo)
        if es_traslado:
            tiene_traslado = True
        registros.append({
            "causa_id": causa_id,
            "fecha": normalizar_fecha(m.fecha),
            "etapa": m.etapa or None,
            "tramite": m.tramite or "(sin descripcion)",
            "descripcion": m.descripcion or None,
            "es_traslado_curador": es_traslado,
            "fuente": run_id,  # marca temporal para distinguir de corridas previas
        })
    if not registros:
        return 0, tiene_traslado

    # 2. INSERTAR primero. Si falla, no tocamos nada: la causa conserva lo anterior.
    url = f"{SUPABASE_URL}/rest/v1/movimientos"
    status, body = http(url, method="POST", body=registros)
    if not (200 <= status < 300):
        log(f"   ERROR guardando movimientos (HTTP {status}): {body[:150]}")
        return 0, tiene_traslado

    # 3. Insert OK -> borrar los movimientos del bot de corridas ANTERIORES
    #    (fuente empieza con 'pjud_bot' pero distinta a este run_id). Si el borrado
    #    falla, quedan duplicados (molesto pero no destructivo) y se avisa.
    rit_enc = urllib.parse.quote(str(causa_id), safe="")
    del_url = (f"{SUPABASE_URL}/rest/v1/movimientos?causa_id=eq.{rit_enc}"
               f"&fuente=like.pjud_bot*&fuente=neq.{run_id}")
    del_status, del_body = http(del_url, method="DELETE")
    if not (200 <= del_status < 300):
        log(f"   AVISO: no se pudieron borrar movimientos previos (HTTP {del_status}) "
            f"- pueden quedar duplicados")

    # 4. Normalizar la fuente de los nuevos a 'pjud_bot' (consistencia futura)
    upd_url = f"{SUPABASE_URL}/rest/v1/movimientos?causa_id=eq.{rit_enc}&fuente=eq.{run_id}"
    http(upd_url, method="PATCH", body={"fuente": "pjud_bot"})

    return len(registros), tiene_traslado


def guardar_audiencias(causa_id, audiencias: List[Audiencia]):
    """Inserta las audiencias leidas del detalle (evita duplicados por fecha+tipo)."""
    if not audiencias:
        return 0
    # Leer audiencias existentes para no duplicar
    rit_enc = urllib.parse.quote(str(causa_id), safe="")
    url_get = f"{SUPABASE_URL}/rest/v1/audiencias?causa_id=eq.{rit_enc}&select=fecha,tipo"
    status, body = http(url_get)
    existentes = set()
    if status == 200:
        try:
            for a in json.loads(body):
                existentes.add(f"{a.get('fecha')}|{a.get('tipo')}")
        except Exception:
            pass
    registros = []
    for a in audiencias:
        fecha_iso = normalizar_fecha(a.fecha)
        if not (fecha_iso or a.tipo):
            continue
        clave = f"{fecha_iso}|{a.tipo or 'Audiencia'}"
        if clave in existentes:
            continue
        # La columna audiencias.fecha es TIMESTAMPTZ y la vista de urgencia filtra
        # `fecha >= NOW()`. Si guardamos solo la fecha (medianoche), una audiencia de
        # HOY quedaria "en el pasado". Guardamos a fin de dia (23:59) para que cuente
        # como futura durante todo el dia de la audiencia.
        fecha_ts = f"{fecha_iso}T23:59:00" if fecha_iso else None
        notas = []
        if a.sala:
            notas.append(f"Sala: {a.sala}")
        if a.estado:
            notas.append(f"Estado: {a.estado}")
        registros.append({
            "causa_id": causa_id,
            "fecha": fecha_ts,
            "tipo": a.tipo or "Audiencia",
            "notas": " | ".join(notas) if notas else None,
        })
    if not registros:
        return 0
    url = f"{SUPABASE_URL}/rest/v1/audiencias"
    status, body = http(url, method="POST", body=registros)
    if 200 <= status < 300:
        return len(registros)
    log(f"   ERROR guardando audiencias (HTTP {status}): {body[:150]}")
    return 0


def registrar_bot_log(causa_id, rit, n_mov, n_aud, tiene_traslado, error=None):
    """Log por causa (tabla bot_logs). No falla si la tabla no existe."""
    payload = {
        "causa_id": causa_id,
        "rit": rit,
        "fecha_scraping": datetime.now(timezone.utc).isoformat(),
        "movimientos_encontrados": n_mov,
        "audiencias_encontradas": n_aud,
        "tiene_traslado_curador": tiene_traslado,
        "error": error,
    }
    http(f"{SUPABASE_URL}/rest/v1/bot_logs", method="POST", body=payload)


def cerrar_aviso(nova):
    try:
        nova.act(
            "Si hay una ventana emergente, aviso o popup abierto, cierralo con "
            "su boton de cerrar o la X. Si no hay ninguno, no hagas nada."
        )
    except Exception as e:
        log(f"   (no se pudo cerrar popup, continuo) {e}")


def screenshot(nova, nombre):
    try:
        ruta = f"error_{nombre}.png"
        nova.page.screenshot(path=ruta)
        log(f"   [captura guardada: {ruta}]")
    except Exception as e:
        log(f"   (no se pudo sacar captura) {e}")


def buscar_causa(nova, rit):
    """Busca el RIT en el listado. Devuelve DatosCausa (fila del listado)."""
    partes = partir_rit(rit)
    if not partes:
        log(f"   -> RIT con formato raro, no se puede partir: {rit}")
        return DatosCausa(encontrada=False)
    letra, rol, anio = partes

    for intento in range(2):
        if letra:
            nova.act(
                f"Hay un pequenio menu desplegable llamado 'Rit' (esta entre el campo "
                f"'9' del rut y el campo 'Rol'). Abrelo y selecciona la letra '{letra}'."
            )
        nova.act(
            f"En el campo de texto llamado 'Rol', haz click, borra lo que haya y "
            f"escribe el numero '{rol}'."
        )
        nova.act(
            f"En el campo de texto llamado 'Ano' (o 'Anio'), haz click, borra lo "
            f"que haya y escribe '{anio}'."
        )
        nova.act(
            "Haz click en el boton azul que dice 'Buscar' (esta al centro, junto "
            "al boton verde 'Limpiar')."
        )
        time.sleep(2 + intento)

        result = nova.act_get(
            f"Estas viendo la tabla de resultados de buscar el RIT '{rit}'. "
            "Si aparece una fila con esa causa, pon encontrada=true y extrae de la "
            "fila: rit, tribunal, caratulado, fecha_ingreso (columna Fecha Ingreso), "
            "estado (columna Estado Procesal). "
            "Si dice 'Total de registros: 0' o la tabla esta vacia, pon encontrada=false.",
            schema=DatosCausa.model_json_schema()
        )
        if not result.parsed_response:
            continue
        datos = DatosCausa.model_validate(result.parsed_response)
        if datos.encontrada:
            return datos
        if intento == 1:
            return datos
    return None


def abrir_y_leer_detalle(nova, rit):
    """Entra al detalle de la causa (clic en la lupa) y lee movimientos + audiencias."""
    # 1. Abrir el detalle: click en la lupa/icono de la fila del RIT
    nova.act(
        f"En la tabla de resultados, en la fila de la causa RIT '{rit}', haz click "
        "en el icono de lupa (o boton para ver el detalle) que esta al inicio de la fila."
    )
    time.sleep(3)

    # 2. Leer el HISTORIAL de movimientos/tramitacion
    #    (en el detalle suele haber una pestana 'Historia', 'Tramitacion' o similar)
    nova.act(
        "Si ves pestanas dentro del detalle, haz click en la que muestre el historial "
        "de tramitacion (puede llamarse 'Historia Causa', 'Historial', 'Tramitacion' "
        "o 'Movimientos'). Si no hay pestanas, no hagas nada."
    )
    time.sleep(2)

    detalle = DetalleCausa()
    try:
        res_mov = nova.act_get(
            "Estas viendo el historial de tramitacion de la causa. Extrae TODOS los "
            "movimientos/tramites visibles de la tabla. Para cada uno: fecha, etapa, "
            "tramite (nombre del tramite/actuacion) y descripcion. Devuelve la lista "
            "completa en el campo 'movimientos'. Si no hay tabla, devuelve lista vacia.",
            schema=DetalleCausa.model_json_schema()
        )
        if res_mov.parsed_response:
            parsed = DetalleCausa.model_validate(res_mov.parsed_response)
            detalle.movimientos = parsed.movimientos
    except Exception as e:
        log(f"   (no se pudieron leer movimientos) {str(e)[:100]}")

    # 3. Leer las AUDIENCIAS (otra pestana normalmente)
    nova.act(
        "Ahora, si hay una pestana de 'Audiencias' dentro del detalle, haz click en "
        "ella. Si no existe, no hagas nada."
    )
    time.sleep(2)
    try:
        res_aud = nova.act_get(
            "Estas viendo las audiencias de la causa. Extrae TODAS las audiencias "
            "visibles: fecha, tipo (tipo de audiencia), sala y estado. Devuelve la "
            "lista completa en el campo 'audiencias'. Si no hay, devuelve lista vacia.",
            schema=DetalleCausa.model_json_schema()
        )
        if res_aud.parsed_response:
            parsed = DetalleCausa.model_validate(res_aud.parsed_response)
            detalle.audiencias = parsed.audiencias
    except Exception as e:
        log(f"   (no se pudieron leer audiencias) {str(e)[:100]}")

    # 4. Volver al listado para la siguiente causa (NO usar navegacion directa)
    nova.act(
        "Cierra el detalle de la causa y vuelve a la lista de resultados / buscador "
        "(usa el boton 'Volver', 'Cerrar' o la X del detalle, no el boton del navegador)."
    )
    time.sleep(2)

    return detalle


def main():
    log("========================================")
    log("CausasPro Bot PJUD (Nova Act) - v3 detalle completo")
    log("========================================")

    if not PJUD_RUT or not PJUD_PASSWORD:
        log("ERROR: Faltan PJUD_RUT y PJUD_PASSWORD")
        sys.exit(1)
    if not SUPABASE_URL or not SUPABASE_KEY:
        log("ERROR: Faltan credenciales de Supabase")
        sys.exit(1)
    if not os.environ.get("NOVA_ACT_API_KEY"):
        log("ERROR: Falta NOVA_ACT_API_KEY")
        sys.exit(1)

    log(f"   RUT: {PJUD_RUT[:4]}****")

    log("Leyendo causas asignadas desde Supabase...")
    rits = leer_rits()
    if not rits:
        log("ERROR: No se encontraron causas en Supabase. Sube el Excel primero.")
        sys.exit(1)
    if LIMITE > 0:
        rits = rits[:LIMITE]
    log(f"   -> {len(rits)} causas por revisar")

    actualizadas = 0
    no_encontradas = 0
    con_error = 0
    urgentes = []

    with NovaAct(starting_page=PORTAL_URL, headless=True,
                 screen_width=1600, screen_height=813) as nova:
        log("Cerrando aviso del portal...")
        cerrar_aviso(nova)

        log("Haciendo login con Clave Unica...")
        nova.act("Haz click en 'Todos los servicios' y luego en 'Clave Unica'")
        log("Ingresando RUN y contrasena...")
        nova.act(f"Ingresa el RUN '{PJUD_RUT}' en el campo de RUN")
        nova.act(
            f"Ingresa la contrasena '{PJUD_PASSWORD}' en el campo de contrasena "
            "y presiona el boton para continuar/autenticar"
        )
        time.sleep(3)
        cerrar_aviso(nova)

        try:
            check = nova.act_get(
                "Responde si ya iniciaste sesion y ves el portal privado con el "
                "menu del usuario (por ejemplo 'Mis Causas').",
                schema={"type": "object", "properties": {"logueado": {"type": "boolean"}}}
            )
            if check.parsed_response and not check.parsed_response.get("logueado", True):
                log("ERROR: No se pudo iniciar sesion. Revisa RUN/contrasena.")
                screenshot(nova, "login_fallido")
                sys.exit(1)
        except Exception:
            pass

        log("Navegando a Mis Causas...")
        nova.act("Haz click en 'Mis Causas' en el menu")

        log("Seleccionando pestana Familia...")
        nova.act("Haz click en la pestana que dice 'Familia'")
        time.sleep(2)

        log("Activando filtros de busqueda...")
        nova.act(
            "Si hay un interruptor o boton que diga 'Filtros' y esta "
            "desactivado, haz click para activar los filtros de busqueda. "
            "Si ya esta activado, no hagas nada."
        )
        time.sleep(1)

        log("Configurando filtros Tipo Causa y Estado en 'Todos'...")
        nova.act(
            "Abre el menu desplegable 'Tipo Causa' y haz click en el boton "
            "'Seleccionar Todos'. Luego CIERRA ese menu haciendo click fuera de el, "
            "en una zona vacia de la pagina."
        )
        nova.act(
            "Abre el menu desplegable 'Estado' y haz click en el boton "
            "'Seleccionar Todos'. Luego CIERRA ese menu haciendo click fuera de el, "
            "en una zona vacia de la pagina, de modo que la lista desplegable "
            "quede cerrada y no tape el boton Buscar."
        )
        time.sleep(1)
        screenshot(nova, "familia_filtros")

        log("Buscando causas una por una (con detalle completo)...")
        fallos_seguidos = 0
        for i, (causa_id, rit) in enumerate(rits, start=1):
            log(f"[{i}/{len(rits)}] Buscando RIT {rit} ...")

            if i % 25 == 0 or fallos_seguidos >= 3:
                cerrar_aviso(nova)
                fallos_seguidos = 0

            try:
                datos = buscar_causa(nova, rit)

                if i == 1:
                    screenshot(nova, "primera_busqueda")

                if datos is None:
                    con_error += 1
                    fallos_seguidos += 1
                    log("   -> sin respuesta de la IA")
                    registrar_bot_log(causa_id, rit, 0, 0, False, "sin respuesta IA")
                    continue

                if not datos.encontrada or not datos.estado:
                    no_encontradas += 1
                    fallos_seguidos = 0
                    log("   -> no encontrada en el portal")
                    registrar_bot_log(causa_id, rit, 0, 0, False, "no encontrada")
                    continue

                # ENTRAR AL DETALLE y copiar todo
                detalle = abrir_y_leer_detalle(nova, rit)

                n_mov, tiene_traslado = guardar_movimientos(causa_id, detalle.movimientos)
                n_aud = guardar_audiencias(causa_id, detalle.audiencias)
                actualizar_causa(causa_id, datos, tiene_traslado)
                registrar_bot_log(causa_id, rit, n_mov, n_aud, tiene_traslado)

                actualizadas += 1
                fallos_seguidos = 0
                marca = " 🔴 TRASLADO CURADOR" if tiene_traslado else ""
                if tiene_traslado:
                    urgentes.append(rit)
                log(f"   -> OK: {n_mov} movs, {n_aud} audiencias{marca}")

            except Exception as e:
                con_error += 1
                fallos_seguidos += 1
                log(f"   -> ERROR: {str(e)[:120]}")
                registrar_bot_log(causa_id, rit, 0, 0, False, str(e)[:200])
                if con_error == 1:
                    screenshot(nova, "primera_causa")

    log("========================================")
    log(f"Total: {len(rits)} revisadas")
    log(f"   Actualizadas: {actualizadas}")
    log(f"   No encontradas: {no_encontradas}")
    log(f"   Con error: {con_error}")
    if urgentes:
        log(f"   🔴 URGENTES (traslado al curador): {len(urgentes)}")
        for u in urgentes:
            log(f"      - {u}")
    log("========================================")


if __name__ == "__main__":
    main()
