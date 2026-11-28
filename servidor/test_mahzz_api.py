"""Pruebas del backend con un Google falso.  python -m unittest -v (desde servidor/)"""

import base64
import hashlib
import json
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer

import mahzz_api


class SinRedirecciones(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


abrir = urllib.request.build_opener(SinRedirecciones).open


def b64url(datos: bytes) -> str:
    return base64.urlsafe_b64encode(datos).rstrip(b"=").decode()


class PruebasLogin(unittest.TestCase):
    def setUp(self):
        self.pedidos_a_google = []

        def google_falso(campos):
            self.pedidos_a_google.append(campos)
            if campos.get("code") == "codigo-bueno":
                return 200, {"access_token": "acceso", "refresh_token": "renovacion-123", "expires_in": 3599, "id_token": "x"}
            if campos.get("refresh_token") == "renovacion-123":
                return 200, {"access_token": "acceso-nuevo", "expires_in": 3599}
            return 400, {"error": "invalid_grant"}

        config = mahzz_api.Config({"GOOGLE_CLIENT_ID": "cliente", "GOOGLE_CLIENT_SECRET": "secreto", "BASE_URL": "https://ejemplo.test"})
        self.estado = mahzz_api.Estado()
        self.servidor = ThreadingHTTPServer(("127.0.0.1", 0), mahzz_api.crear_manejador(config, self.estado, google_falso))
        threading.Thread(target=self.servidor.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.servidor.server_address[1]}"
        self.verificador = b64url(b"v" * 32)
        self.desafio = b64url(hashlib.sha256(self.verificador.encode()).digest())
        self.state_app = b64url(b"s" * 32)

    def tearDown(self):
        self.servidor.shutdown()
        self.servidor.server_close()

    def get(self, ruta):
        try:
            return abrir(self.base + ruta)
        except urllib.error.HTTPError as error:
            return error

    def post(self, ruta, cuerpo):
        pedido = urllib.request.Request(self.base + ruta, data=json.dumps(cuerpo).encode(), method="POST")
        pedido.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(pedido) as respuesta:
                return respuesta.status, json.loads(respuesta.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())

    def empezar(self):
        consulta = urllib.parse.urlencode({"puerto": 51234, "state": self.state_app, "desafio": self.desafio})
        respuesta = self.get(f"/api/auth/google?{consulta}")
        self.assertEqual(respuesta.status, 302)
        destino = urllib.parse.urlsplit(respuesta.headers["Location"])
        return destino, dict(urllib.parse.parse_qsl(destino.query))

    def volver(self, state, code="codigo-bueno"):
        respuesta = self.get("/api/auth/google/callback?" + urllib.parse.urlencode({"state": state, "code": code}))
        self.assertEqual(respuesta.status, 302)
        destino = urllib.parse.urlsplit(respuesta.headers["Location"])
        return destino, dict(urllib.parse.parse_qsl(destino.query))

    def test_flujo_completo(self):
        destino, a_google = self.empezar()
        self.assertEqual(destino.netloc, "accounts.google.com")
        self.assertEqual(a_google["redirect_uri"], "https://ejemplo.test/api/auth/google/callback")
        self.assertNotIn("secreto", destino.geturl())

        vuelta, a_la_app = self.volver(a_google["state"])
        self.assertEqual(vuelta.netloc, "127.0.0.1:51234")
        self.assertEqual(a_la_app["state"], self.state_app)
        self.assertEqual(self.pedidos_a_google[0]["client_secret"], "secreto")

        estado, tokens = self.post("/api/auth/canjear", {"codigo": a_la_app["code"], "verificador": self.verificador})
        self.assertEqual(estado, 200)
        self.assertEqual(tokens, {"access_token": "acceso", "refresh_token": "renovacion-123", "expires_in": 3599})

        # El código sirve una sola vez
        estado, _ = self.post("/api/auth/canjear", {"codigo": a_la_app["code"], "verificador": self.verificador})
        self.assertEqual(estado, 400)

    def test_canjear_con_otro_verificador_falla(self):
        _, a_google = self.empezar()
        _, a_la_app = self.volver(a_google["state"])
        estado, _ = self.post("/api/auth/canjear", {"codigo": a_la_app["code"], "verificador": b64url(b"x" * 32)})
        self.assertEqual(estado, 400)

    def test_state_falsificado_se_rechaza(self):
        _, a_google = self.empezar()
        cuerpo, _, firma = a_google["state"].partition(".")
        datos = json.loads(base64.urlsafe_b64decode(cuerpo + "=" * (-len(cuerpo) % 4)))
        datos["puerto"] = 9999
        trucho = b64url(json.dumps(datos).encode()) + "." + firma
        respuesta = self.get("/api/auth/google/callback?" + urllib.parse.urlencode({"state": trucho, "code": "codigo-bueno"}))
        self.assertEqual(respuesta.status, 400)
        self.assertEqual(self.pedidos_a_google, [])

    def test_usuario_cancela(self):
        _, a_google = self.empezar()
        respuesta = self.get("/api/auth/google/callback?" + urllib.parse.urlencode({"state": a_google["state"], "error": "access_denied"}))
        a_la_app = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(respuesta.headers["Location"]).query))
        self.assertEqual(a_la_app["error"], "access_denied")
        self.assertNotIn("code", a_la_app)

    def test_puerto_invalido(self):
        consulta = urllib.parse.urlencode({"puerto": 80, "state": self.state_app, "desafio": self.desafio})
        self.assertEqual(self.get(f"/api/auth/google?{consulta}").status, 400)

    def test_renovar(self):
        estado, tokens = self.post("/api/auth/renovar", {"refresh_token": "renovacion-123"})
        self.assertEqual((estado, tokens["access_token"]), (200, "acceso-nuevo"))
        estado, tokens = self.post("/api/auth/renovar", {"refresh_token": "revocada-hace-rato"})
        self.assertEqual((estado, tokens["error"]), (401, "invalid_grant"))

    def test_limite_de_pedidos(self):
        codigos = [self.post("/api/auth/renovar", {"refresh_token": "renovacion-123"})[0] for _ in range(mahzz_api.LIMITE_POR_MINUTO + 1)]
        self.assertEqual(codigos[-1], 429)


if __name__ == "__main__":
    unittest.main()
