# mahzz-api

Backend chico que hace el login con Google de MahzzTerm. Existe para que el **client secret de Google nunca viaje dentro de la app**: la app solo conoce `https://mahzzterm.xyz/api`.

```
App ──abre navegador──▶ /api/auth/google ──▶ Google ──▶ /api/auth/google/callback
                                                          │ canjea con el secret
App ◀──127.0.0.1:puerto?code=un-solo-uso──────────────────┘
App ──POST /api/auth/canjear (código + verificador PKCE)──▶ tokens de Google
App ──POST /api/auth/renovar (refresh_token)──────────────▶ acceso nuevo
```

- Solo biblioteca estándar de Python. Sin base de datos: lo pendiente vive en memoria unos segundos.
- El `refresh_token` queda en la PC del usuario (cifrado con DPAPI). Sin el secret no sirve para nada.

## Rutas

| Ruta | Qué hace |
|---|---|
| `GET /api/salud` | Responde `{"ok": true}` |
| `GET /api/auth/google?puerto&state&desafio` | Manda al usuario a Google |
| `GET /api/auth/google/callback` | Vuelta de Google; redirige a `127.0.0.1:puerto` |
| `POST /api/auth/canjear` `{codigo, verificador}` | Entrega los tokens una sola vez |
| `POST /api/auth/renovar` `{refresh_token}` | Acceso nuevo |

## Configuración (una sola vez)

1. En Google Cloud, **en el mismo proyecto que ya usa MahzzTerm** (así no se pierde lo sincronizado en Drive), creá un cliente OAuth de tipo **Aplicación web** con este URI de redirección:
   `https://mahzzterm.xyz/api/auth/google/callback`
2. En la VPS, creá `/srv/apps/mahzz-api/.env` (permisos 600):
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   BASE_URL=https://mahzzterm.xyz
   ```
3. En el `Caddyfile`, dentro del bloque `mahzzterm.xyz`:
   ```
   reverse_proxy /api/* mahzz-api:8080 {
   	header_down -Server
   }
   ```
4. `.\servidor\desplegar.ps1`

## Pruebas

```powershell
cd servidor; python -m unittest -v
```
