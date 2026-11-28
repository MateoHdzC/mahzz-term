"""Backend de MahzzTerm: hace el login con Google para que el secret nunca viaje en la app.

Flujo:
  1. La app abre el navegador en /api/auth/google?puerto=..&state=..&desafio=..
  2. Este servidor manda al usuario a Google y Google vuelve a /api/auth/google/callback.
  3. Acá se canjea el código con el secret (que solo existe en este servidor).
  4. Se redirige al puerto local de la app con un código de un solo uso.
  5. La app canjea ese código en /api/auth/canjear presentando el verificador (PKCE).
  6. Cuando el acceso vence, la app pide uno nuevo en /api/auth/renovar.

Sin dependencias externas: solo la biblioteca estándar de Python.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

AUTORIZAR = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN = "https://oauth2.googleapis.com/token"
PERMISOS = "openid email profile https://www.googleapis.com/auth/drive.appdata"

VIDA_ESTADO = 10 * 60  # segundos que tiene el usuario para elegir su cuenta
VIDA_CODIGO = 60  # segundos que dura el código de un solo uso
MAX_CUERPO = 16 * 1024
# Pedidos por minuto y por IP en las rutas sensibles
LIMITE_POR_MINUTO = 30

BASE64URL = re.compile(r"^[A-Za-z0-9_-]{32,128}$")


def b64url(datos: bytes) -> str:
    return base64.urlsafe_b64encode(datos).rstrip(b"=").decode()


def b64url_a_bytes(texto: str) -> bytes:
    return base64.urlsafe_b64decode(texto + "=" * (-len(texto) % 4))


class Config:
    def __init__(self, entorno: dict[str, str] | None = None) -> None:
        entorno = os.environ if entorno is None else entorno
        self.cliente = entorno.get("GOOGLE_CLIENT_ID", "")
        self.secret = entorno.get("GOOGLE_CLIENT_SECRET", "")
        self.base = entorno.get("BASE_URL", "https://mahzzterm.xyz").rstrip("/")
        self.puerto = int(entorno.get("PUERTO", "8080"))
        if not self.cliente or not self.secret:
            raise SystemExit("Faltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET")

    @property
    def redireccion(self) -> str:
        return f"{self.base}/api/auth/google/callback"


class Estado:
    """Lo que se guarda en memoria. Si el servidor se reinicia, solo se pierden logins a medias."""

    def __init__(self) -> None:
        self.clave = secrets.token_bytes(32)
        self.codigos: dict[str, tuple[float, str, dict]] = {}
        self.pedidos: dict[str, list[float]] = {}
        self.cerrojo = threading.Lock()

    # El "state" que va a Google lleva firmados los datos de la app: no hace falta guardarlo.
    def firmar(self, datos: dict) -> str:
        cuerpo = b64url(json.dumps(datos, separators=(",", ":")).encode())
        firma = b64url(hmac.new(self.clave, cuerpo.encode(), hashlib.sha256).digest())
        return f"{cuerpo}.{firma}"

    def verificar(self, texto: str) -> dict | None:
        cuerpo, _, firma = texto.partition(".")
        esperada = b64url(hmac.new(self.clave, cuerpo.encode(), hashlib.sha256).digest())
        if not firma or not hmac.compare_digest(firma, esperada):
            return None
        try:
            datos = json.loads(b64url_a_bytes(cuerpo))
        except (ValueError, json.JSONDecodeError):
            return None
        if not isinstance(datos, dict) or datos.get("vence", 0) < time.time():
            return None
        return datos

    def guardar_codigo(self, desafio: str, tokens: dict) -> str:
        codigo = secrets.token_urlsafe(32)
        with self.cerrojo:
            ahora = time.time()
            self.codigos = {c: v for c, v in self.codigos.items() if v[0] > ahora}
            self.codigos[codigo] = (ahora + VIDA_CODIGO, desafio, tokens)
        return codigo

    def canjear(self, codigo: str, verificador: str) -> dict | None:
        with self.cerrojo:
            guardado = self.codigos.pop(codigo, None)
        if guardado is None:
            return None
        vence, desafio, tokens = guardado
        calculado = b64url(hashlib.sha256(verificador.encode()).digest())
        if vence < time.time() or not hmac.compare_digest(calculado, desafio):
            return None
        return tokens

    def permitir(self, ip: str) -> bool:
        ahora = time.time()
        with self.cerrojo:
            recientes = [t for t in self.pedidos.get(ip, []) if t > ahora - 60]
            if len(self.pedidos) > 10_000:
                self.pedidos.clear()
            if len(recientes) >= LIMITE_POR_MINUTO:
                self.pedidos[ip] = recientes
                return False
            recientes.append(ahora)
            self.pedidos[ip] = recientes
            return True


def pedir_a_google(campos: dict[str, str]) -> tuple[int, dict]:
    datos = urllib.parse.urlencode(campos).encode()
    pedido = urllib.request.Request(TOKEN, data=datos, method="POST")
    pedido.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(pedido, timeout=15) as respuesta:
            return respuesta.status, json.loads(respuesta.read())
    except urllib.error.HTTPError as error:
        try:
            return error.code, json.loads(error.read())
        except json.JSONDecodeError:
            return error.code, {"error": "respuesta_invalida"}


def crear_manejador(config: Config, estado: Estado, google=pedir_a_google):
    class Manejador(BaseHTTPRequestHandler):
        server_version = "mahzz-api"
        sys_version = ""

        def log_message(self, formato, *args):  # sin datos de usuarios en los registros
            print(f"{self.command} {urllib.parse.urlsplit(self.path).path} {args[1] if len(args) > 1 else ''}", flush=True)

        # Caddy agrega la IP real del cliente.
        def ip(self) -> str:
            return self.headers.get("X-Forwarded-For", self.client_address[0]).split(",")[0].strip()

        def json(self, codigo: int, cuerpo: dict) -> None:
            datos = json.dumps(cuerpo).encode()
            self.send_response(codigo)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(datos)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(datos)

        def redirigir(self, destino: str) -> None:
            self.send_response(302)
            self.send_header("Location", destino)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def leer_cuerpo(self) -> dict | None:
            try:
                largo = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                return None
            if largo <= 0 or largo > MAX_CUERPO:
                return None
            try:
                datos = json.loads(self.rfile.read(largo))
            except json.JSONDecodeError:
                return None
            return datos if isinstance(datos, dict) else None

        def do_GET(self):
            url = urllib.parse.urlsplit(self.path)
            consulta = dict(urllib.parse.parse_qsl(url.query))
            if url.path == "/api/salud":
                return self.json(200, {"ok": True})
            if url.path == "/api/auth/google":
                return self.empezar(consulta)
            if url.path == "/api/auth/google/callback":
                return self.volver_de_google(consulta)
            self.json(404, {"error": "no_existe"})

        def do_POST(self):
            url = urllib.parse.urlsplit(self.path)
            if url.path not in ("/api/auth/canjear", "/api/auth/renovar"):
                return self.json(404, {"error": "no_existe"})
            if not estado.permitir(self.ip()):
                return self.json(429, {"error": "demasiados_pedidos"})
            cuerpo = self.leer_cuerpo()
            if cuerpo is None:
                return self.json(400, {"error": "pedido_invalido"})
            if url.path == "/api/auth/canjear":
                return self.canjear(cuerpo)
            return self.renovar(cuerpo)

        def empezar(self, consulta: dict) -> None:
            if not estado.permitir(self.ip()):
                return self.json(429, {"error": "demasiados_pedidos"})
            puerto = consulta.get("puerto", "")
            estado_app = consulta.get("state", "")
            desafio = consulta.get("desafio", "")
            if not puerto.isdigit() or not 1024 <= int(puerto) <= 65535:
                return self.json(400, {"error": "puerto_invalido"})
            if not BASE64URL.match(estado_app) or not BASE64URL.match(desafio):
                return self.json(400, {"error": "pedido_invalido"})
            firmado = estado.firmar(
                {"puerto": int(puerto), "state": estado_app, "desafio": desafio, "vence": time.time() + VIDA_ESTADO}
            )
            destino = AUTORIZAR + "?" + urllib.parse.urlencode(
                {
                    "client_id": config.cliente,
                    "redirect_uri": config.redireccion,
                    "response_type": "code",
                    "scope": PERMISOS,
                    "state": firmado,
                    "access_type": "offline",
                    "prompt": "consent",
                }
            )
            self.redirigir(destino)

        def volver_de_google(self, consulta: dict) -> None:
            datos = estado.verificar(consulta.get("state", ""))
            if datos is None:
                return self.json(400, {"error": "login_vencido"})
            app = f"http://127.0.0.1:{datos['puerto']}/"
            if "code" not in consulta:
                error = consulta.get("error", "cancelado")
                return self.redirigir(app + "?" + urllib.parse.urlencode({"state": datos["state"], "error": error}))
            codigo_http, tokens = google(
                {
                    "client_id": config.cliente,
                    "client_secret": config.secret,
                    "code": consulta["code"],
                    "grant_type": "authorization_code",
                    "redirect_uri": config.redireccion,
                }
            )
            if codigo_http != 200 or "access_token" not in tokens:
                motivo = str(tokens.get("error", "desconocido"))[:60]
                print(f"Google rechazó el canje: {codigo_http} {motivo}", flush=True)
                return self.redirigir(app + "?" + urllib.parse.urlencode({"state": datos["state"], "error": f"google_rechazo:{motivo}"}))
            utiles = {
                clave: tokens[clave]
                for clave in ("access_token", "refresh_token", "expires_in")
                if clave in tokens
            }
            codigo = estado.guardar_codigo(datos["desafio"], utiles)
            self.redirigir(app + "?" + urllib.parse.urlencode({"state": datos["state"], "code": codigo}))

        def canjear(self, cuerpo: dict) -> None:
            codigo = cuerpo.get("codigo")
            verificador = cuerpo.get("verificador")
            if not isinstance(codigo, str) or not isinstance(verificador, str):
                return self.json(400, {"error": "pedido_invalido"})
            tokens = estado.canjear(codigo, verificador)
            if tokens is None:
                return self.json(400, {"error": "codigo_invalido"})
            self.json(200, tokens)

        def renovar(self, cuerpo: dict) -> None:
            renovacion = cuerpo.get("refresh_token")
            if not isinstance(renovacion, str) or not 10 <= len(renovacion) <= 512:
                return self.json(400, {"error": "pedido_invalido"})
            codigo_http, tokens = google(
                {
                    "client_id": config.cliente,
                    "client_secret": config.secret,
                    "refresh_token": renovacion,
                    "grant_type": "refresh_token",
                }
            )
            if codigo_http != 200 or "access_token" not in tokens:
                # invalid_grant = la sesión se revocó o venció: la app tiene que pedir login otra vez
                return self.json(401, {"error": tokens.get("error", "google_rechazo")})
            self.json(200, {"access_token": tokens["access_token"], "expires_in": tokens.get("expires_in", 3600)})

    return Manejador


def main() -> None:
    config = Config()
    servidor = ThreadingHTTPServer(("0.0.0.0", config.puerto), crear_manejador(config, Estado()))
    print(f"mahzz-api escuchando en :{config.puerto} (base {config.base})", flush=True)
    servidor.serve_forever()


if __name__ == "__main__":
    main()
