use std::{
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{async_runtime::spawn_blocking, AppHandle, Manager};
use url::Url;

use crate::{
    ajustes::{abrir_externo, cifrar},
    datos::carpeta_datos,
};

// El login pasa por el backend de MahzzTerm (servidor/): el secret de Google vive solo ahí.
const SERVIDOR: &str = "https://mahzzterm.xyz";

const REVOCAR: &str = "https://oauth2.googleapis.com/revoke";
const PERFIL: &str = "https://openidconnect.googleapis.com/v1/userinfo";
const ARCHIVOS: &str = "https://www.googleapis.com/drive/v3/files";
const SUBIDA: &str = "https://www.googleapis.com/upload/drive/v3/files";
// Conserva el nombre de antes del cambio a MahzzTerm: con otro nombre se perdería lo ya sincronizado.
const ARCHIVO_SYNC: &str = "mazzterm-sync.json";
// Igual que la vida del "state" en el backend: la primera vez Google muestra varias pantallas.
const LIMITE_LOGIN: Duration = Duration::from_secs(600);
const LIMITE_RESPUESTA: u64 = 64 * 1024 * 1024;

const PAGINA_LISTA: &str = "<!doctype html><html lang=\"es\"><meta charset=\"utf-8\"><title>MahzzTerm</title><body style=\"margin:0;display:grid;place-items:center;height:100vh;background:#050507;color:#e4e2ec;font-family:Segoe UI,sans-serif\"><main style=\"text-align:center\"><h1 style=\"font-size:24px\">Listo</h1><p>Ya podés volver a MahzzTerm y cerrar esta pestaña.</p></main></body></html>";
const PAGINA_ERROR: &str = "<!doctype html><html lang=\"es\"><meta charset=\"utf-8\"><title>MahzzTerm</title><body style=\"margin:0;display:grid;place-items:center;height:100vh;background:#050507;color:#e4e2ec;font-family:Segoe UI,sans-serif\"><main style=\"text-align:center\"><h1 style=\"font-size:24px\">No se pudo iniciar sesión</h1><p>Volvé a MahzzTerm para ver el motivo y probá de nuevo.</p></main></body></html>";

#[derive(Default)]
pub struct TokenGoogle(Mutex<Option<(String, Instant)>>);

// MAHZZTERM_SERVIDOR permite probar contra un backend local.
fn servidor() -> String {
    std::env::var("MAHZZTERM_SERVIDOR")
        .ok()
        .filter(|valor| !valor.is_empty())
        .unwrap_or_else(|| SERVIDOR.to_string())
        .trim_end_matches('/')
        .to_string()
}

fn pedir_al_servidor(
    ruta: &str,
    cuerpo: &Value,
) -> Result<ureq::http::Response<ureq::Body>, ureq::Error> {
    ureq::post(format!("{}{ruta}", servidor()))
        .header("Content-Type", "application/json")
        .send(cuerpo.to_string())
}

fn ruta_cuenta(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(carpeta_datos(app)?.join("cuenta.dat"))
}

fn leer_cuenta(app: &AppHandle) -> Option<Value> {
    let cifrado = fs::read(ruta_cuenta(app).ok()?).ok()?;
    serde_json::from_slice(&cifrar(&cifrado, false).ok()?).ok()
}

fn perfil_publico(cuenta: &Value) -> Value {
    json!({ "nombre": cuenta["nombre"], "correo": cuenta["correo"], "foto": cuenta["foto"] })
}

fn leer_json(
    respuesta: Result<ureq::http::Response<ureq::Body>, ureq::Error>,
) -> Result<Value, String> {
    let mut respuesta = respuesta.map_err(|error| error.to_string())?;
    let texto = respuesta
        .body_mut()
        .with_config()
        .limit(LIMITE_RESPUESTA)
        .read_to_string()
        .map_err(|error| error.to_string())?;
    serde_json::from_str(&texto).map_err(|error| error.to_string())
}

fn aleatorio() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|error| error.to_string())?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

fn responder(conexion: &mut TcpStream, estado: &str, cuerpo: &str) {
    let _ = write!(
        conexion,
        "HTTP/1.1 {estado}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{cuerpo}",
        cuerpo.len()
    );
}

// Espera la vuelta del navegador en una dirección que solo existe dentro de esta PC.
fn esperar_codigo(servidor: &TcpListener, estado: &str) -> Result<String, String> {
    servidor
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    let inicio = Instant::now();
    while inicio.elapsed() < LIMITE_LOGIN {
        let mut conexion = match servidor.accept() {
            Ok((conexion, _)) => conexion,
            Err(_) => {
                thread::sleep(Duration::from_millis(100));
                continue;
            }
        };
        let _ = conexion.set_nonblocking(false);
        let _ = conexion.set_read_timeout(Some(Duration::from_secs(5)));
        let mut bufer = [0u8; 8192];
        let leidos = conexion.read(&mut bufer).unwrap_or(0);
        let pedido = String::from_utf8_lossy(&bufer[..leidos]);
        let ruta = pedido.split_whitespace().nth(1).unwrap_or("/");
        let Ok(url) = Url::parse(&format!("http://127.0.0.1{ruta}")) else {
            responder(&mut conexion, "400 Bad Request", "");
            continue;
        };
        let valor = |clave: &str| {
            url.query_pairs()
                .find(|(nombre, _)| nombre == clave)
                .map(|(_, valor)| valor.into_owned())
        };
        if valor("state").as_deref() != Some(estado) {
            responder(&mut conexion, "404 Not Found", "");
            continue;
        }
        return match (valor("code"), valor("error")) {
            (Some(codigo), _) => {
                responder(&mut conexion, "200 OK", PAGINA_LISTA);
                Ok(codigo)
            }
            (_, error) => {
                responder(&mut conexion, "200 OK", PAGINA_ERROR);
                Err(format!(
                    "No se pudo iniciar sesión ({})",
                    error.unwrap_or_else(|| "sin código".to_string())
                ))
            }
        };
    }
    Err("Se agotó el tiempo para iniciar sesión".to_string())
}

// La foto se guarda dentro de la app porque la página no carga imágenes externas.
fn descargar_foto(direccion: &str) -> Option<String> {
    let url = Url::parse(direccion).ok()?;
    if url.scheme() != "https" || !url.host_str()?.ends_with(".googleusercontent.com") {
        return None;
    }
    let mut respuesta = ureq::get(direccion).call().ok()?;
    let tipo = respuesta
        .headers()
        .get("content-type")
        .and_then(|valor| valor.to_str().ok())
        .filter(|valor| valor.starts_with("image/"))?
        .to_string();
    let bytes = respuesta.body_mut().read_to_vec().ok()?;
    Some(format!("data:{tipo};base64,{}", STANDARD.encode(bytes)))
}

fn completar_login(app: &AppHandle) -> Result<Value, String> {
    let servidor_local = TcpListener::bind(("127.0.0.1", 0)).map_err(|error| error.to_string())?;
    let puerto = servidor_local
        .local_addr()
        .map_err(|error| error.to_string())?
        .port()
        .to_string();
    let estado = aleatorio()?;
    let verificador = aleatorio()?;
    let desafio = URL_SAFE_NO_PAD.encode(Sha256::digest(verificador.as_bytes()));

    let direccion = Url::parse_with_params(
        &format!("{}/api/auth/google", servidor()),
        [
            ("puerto", puerto.as_str()),
            ("state", estado.as_str()),
            ("desafio", desafio.as_str()),
        ],
    )
    .map_err(|error| error.to_string())?;
    abrir_externo(direccion.to_string())?;

    let codigo = esperar_codigo(&servidor_local, &estado)?;
    let tokens = leer_json(pedir_al_servidor(
        "/api/auth/canjear",
        &json!({ "codigo": codigo, "verificador": verificador }),
    ))?;
    let acceso = tokens["access_token"]
        .as_str()
        .ok_or("Google no devolvió acceso")?;
    let renovacion = tokens["refresh_token"]
        .as_str()
        .ok_or("Google no devolvió la sesión")?;
    let datos = leer_json(
        ureq::get(PERFIL)
            .header("Authorization", format!("Bearer {acceso}"))
            .call(),
    )?;

    let cuenta = json!({
        "renovacion": renovacion,
        "nombre": datos["name"],
        "correo": datos["email"],
        "foto": datos["picture"].as_str().and_then(descargar_foto),
    });
    let texto = serde_json::to_vec(&cuenta).map_err(|error| error.to_string())?;
    fs::write(ruta_cuenta(app)?, cifrar(&texto, true)?).map_err(|error| error.to_string())?;
    Ok(perfil_publico(&cuenta))
}

fn token_acceso(app: &AppHandle) -> Result<String, String> {
    let memoria = app.state::<TokenGoogle>();
    if let Ok(guardado) = memoria.0.lock() {
        if let Some((token, vence)) = guardado.as_ref() {
            if Instant::now() < *vence {
                return Ok(token.clone());
            }
        }
    }
    let cuenta = leer_cuenta(app).ok_or("No hay una sesión iniciada")?;
    let renovacion = cuenta["renovacion"]
        .as_str()
        .ok_or("La sesión no es válida")?;
    let respuesta = pedir_al_servidor("/api/auth/renovar", &json!({ "refresh_token": renovacion }));
    // 401: Google revocó la sesión (o es de antes del backend). Hay que entrar de nuevo.
    if let Err(ureq::Error::StatusCode(401)) = respuesta {
        let _ = fs::remove_file(ruta_cuenta(app)?);
        return Err("La sesión de Google venció. Volvé a iniciar sesión".to_string());
    }
    let tokens = leer_json(respuesta)?;
    let token = tokens["access_token"]
        .as_str()
        .ok_or("Google no renovó la sesión")?
        .to_string();
    let duracion = tokens["expires_in"]
        .as_u64()
        .unwrap_or(3600)
        .saturating_sub(60);
    if let Ok(mut guardado) = memoria.0.lock() {
        *guardado = Some((
            token.clone(),
            Instant::now() + Duration::from_secs(duracion),
        ));
    }
    Ok(token)
}

fn buscar_archivo(token: &str) -> Result<Option<String>, String> {
    let consulta = format!("name='{ARCHIVO_SYNC}'");
    let url = Url::parse_with_params(
        ARCHIVOS,
        [
            ("spaces", "appDataFolder"),
            ("q", consulta.as_str()),
            ("fields", "files(id)"),
        ],
    )
    .map_err(|error| error.to_string())?;
    let lista = leer_json(
        ureq::get(url.as_str())
            .header("Authorization", format!("Bearer {token}"))
            .call(),
    )?;
    Ok(lista["files"][0]["id"].as_str().map(str::to_string))
}

#[tauri::command]
pub fn google_configurado() -> bool {
    true
}

#[tauri::command]
pub async fn iniciar_sesion_google(app: AppHandle) -> Result<Value, String> {
    spawn_blocking(move || completar_login(&app))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn cuenta_google(app: AppHandle) -> Option<Value> {
    leer_cuenta(&app).map(|cuenta| perfil_publico(&cuenta))
}

#[tauri::command]
pub async fn cerrar_sesion_google(app: AppHandle) -> Result<(), String> {
    spawn_blocking(move || {
        if let Some(renovacion) =
            leer_cuenta(&app).and_then(|cuenta| cuenta["renovacion"].as_str().map(str::to_string))
        {
            let _ = ureq::post(REVOCAR).send_form([("token", renovacion.as_str())]);
        }
        if let Ok(mut guardado) = app.state::<TokenGoogle>().0.lock() {
            *guardado = None;
        }
        match fs::remove_file(ruta_cuenta(&app)?) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.to_string()),
            _ => Ok(()),
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn bajar_sincronizacion(app: AppHandle) -> Result<Option<Value>, String> {
    spawn_blocking(move || {
        let token = token_acceso(&app)?;
        let Some(id) = buscar_archivo(&token)? else {
            return Ok(None);
        };
        let url = format!("{ARCHIVOS}/{id}?alt=media");
        leer_json(
            ureq::get(&url)
                .header("Authorization", format!("Bearer {token}"))
                .call(),
        )
        .map(Some)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn subir_sincronizacion(app: AppHandle, contenido: Value) -> Result<(), String> {
    spawn_blocking(move || {
        let token = token_acceso(&app)?;
        let autorizacion = format!("Bearer {token}");
        let id = match buscar_archivo(&token)? {
            Some(id) => id,
            None => {
                let datos =
                    json!({ "name": ARCHIVO_SYNC, "parents": ["appDataFolder"] }).to_string();
                let creado = leer_json(
                    ureq::post(ARCHIVOS)
                        .header("Authorization", &autorizacion)
                        .header("Content-Type", "application/json")
                        .send(datos),
                )?;
                creado["id"]
                    .as_str()
                    .ok_or("Drive no creó el archivo")?
                    .to_string()
            }
        };
        let url = format!("{SUBIDA}/{id}?uploadType=media");
        ureq::patch(&url)
            .header("Authorization", &autorizacion)
            .header("Content-Type", "application/json")
            .send(contenido.to_string())
            .map_err(|error| error.to_string())?;
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}
