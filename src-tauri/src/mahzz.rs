use std::{
    fs,
    io::{BufRead, BufReader, Read},
    path::PathBuf,
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
    thread,
    time::Duration,
};

use serde_json::{json, Value};
use tauri::{async_runtime::spawn_blocking, ipc::Channel, AppHandle};

use crate::{
    ajustes::cifrar,
    datos::{carpeta_datos, escribir_bytes_seguro},
};

const URL: &str = "http://127.0.0.1:11434";
const IDENTIDAD: &str = "Eres Mahzz-AI, el asistente de programación creado por MahzzStudio, integrado en la terminal MahzzTerm. \
No eres ChatGPT. Hablas en español neutro, claro y directo. Eres experto en PowerShell, Windows, terminal, Python, C#, \
JavaScript y Git. Cuando muestres comandos, ponlos en bloques de código con el lenguaje indicado.";

static TURNO: AtomicU64 = AtomicU64::new(0);
const MODELO_PUBLICO: &str = "dkdidmateo/mahzz";
static CANCELAR_DESCARGA: AtomicBool = AtomicBool::new(false);

#[derive(Default, Clone)]
struct Config {
    usar_api: bool,
    url: String,
    modelo: String,
    key: String,
}

fn ruta_config(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(carpeta_datos(app)?.join("mahzz-ai.dat"))
}

fn leer_config(app: &AppHandle) -> Config {
    let Some(datos) = ruta_config(app)
        .ok()
        .and_then(|ruta| fs::read(ruta).ok())
        .and_then(|cifrado| cifrar(&cifrado, false).ok())
        .and_then(|plano| serde_json::from_slice::<Value>(&plano).ok())
    else {
        return Config::default();
    };
    let texto = |clave: &str| datos[clave].as_str().unwrap_or_default().to_string();
    Config {
        usar_api: datos["usarApi"].as_bool().unwrap_or(false),
        url: texto("url"),
        modelo: texto("modelo"),
        key: texto("key"),
    }
}

fn escribir_config(app: &AppHandle, config: &Config) -> Result<(), String> {
    let datos = json!({ "usarApi": config.usar_api, "url": config.url, "modelo": config.modelo, "key": config.key });
    let texto = serde_json::to_vec(&datos).map_err(|error| error.to_string())?;
    escribir_bytes_seguro(&ruta_config(app)?, &cifrar(&texto, true)?)
}

fn api_completa(config: &Config) -> bool {
    !config.url.is_empty() && !config.modelo.is_empty() && !config.key.is_empty()
}

#[tauri::command]
pub fn mahzz_config(app: AppHandle) -> Value {
    let config = leer_config(&app);
    json!({ "usarApi": config.usar_api, "url": config.url, "modelo": config.modelo, "tieneKey": !config.key.is_empty() })
}

#[tauri::command]
pub fn mahzz_guardar_config(
    app: AppHandle,
    usar_api: bool,
    url: String,
    modelo: String,
    key: String,
) -> Result<(), String> {
    let mut config = leer_config(&app);
    config.usar_api = usar_api;
    config.url = url.trim().trim_end_matches('/').to_string();
    config.modelo = modelo.trim().to_string();
    if !key.trim().is_empty() {
        config.key = key.trim().to_string();
    }
    if usar_api && !api_completa(&config) {
        return Err("Para usar una API completá la dirección, el modelo y la key.".into());
    }
    if !config.url.is_empty() && !url_segura(&config.url) {
        return Err("La dirección de la API tiene que ser https (o http solo en esta PC).".into());
    }
    escribir_config(&app, &config)
}

fn url_segura(direccion: &str) -> bool {
    let Ok(url) = url::Url::parse(direccion) else {
        return false;
    };
    match url.scheme() {
        "https" => true,
        "http" => matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")),
        _ => false,
    }
}

#[tauri::command]
pub fn mahzz_borrar_key(app: AppHandle) -> Result<(), String> {
    let mut config = leer_config(&app);
    config.key.clear();
    config.usar_api = false;
    escribir_config(&app, &config)
}

fn ollama_prendido() -> bool {
    ureq::get(&format!("{URL}/api/version"))
        .config()
        .timeout_global(Some(Duration::from_secs(2)))
        .build()
        .call()
        .is_ok()
}

fn prender_ollama() -> bool {
    if ollama_prendido() {
        return true;
    }
    let Some(local) = std::env::var_os("LOCALAPPDATA") else {
        return false;
    };
    let programa = PathBuf::from(local)
        .join("Programs")
        .join("Ollama")
        .join("ollama app.exe");
    if std::process::Command::new(programa).spawn().is_err() {
        return false;
    }
    for _ in 0..20 {
        thread::sleep(Duration::from_millis(500));
        if ollama_prendido() {
            return true;
        }
    }
    false
}

fn modelos_instalados() -> Vec<String> {
    let Ok(mut respuesta) = ureq::get(&format!("{URL}/api/tags")).call() else {
        return Vec::new();
    };
    let Ok(texto) = respuesta.body_mut().read_to_string() else {
        return Vec::new();
    };
    let Ok(datos) = serde_json::from_str::<Value>(&texto) else {
        return Vec::new();
    };
    datos["models"]
        .as_array()
        .map(|lista| {
            lista
                .iter()
                .filter_map(|m| m["name"].as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

fn es_mahzz(nombre: &str) -> bool {
    nombre
        .rsplit('/')
        .next()
        .is_some_and(|base| base == "mahzz" || base.starts_with("mahzz:"))
}

enum Motor {
    Local(String),
    Api(Config),
}

fn elegir_motor(app: &AppHandle) -> Result<Motor, String> {
    let config = leer_config(app);
    if config.usar_api && api_completa(&config) {
        return Ok(Motor::Api(config));
    }
    if !prender_ollama() {
        return Err("sin_ollama|No encontré Ollama prendido en esta PC.".into());
    }
    let instalados = modelos_instalados();
    let elegido = instalados
        .iter()
        .find(|m| m.as_str() == "mahzz:latest")
        .or_else(|| instalados.iter().find(|m| es_mahzz(m)));
    match elegido {
        Some(modelo) => Ok(Motor::Local(modelo.clone())),
        None => Err(
            "sin_modelo|Ollama está prendido, pero el modelo de Mahzz-AI no está instalado.".into(),
        ),
    }
}

#[tauri::command]
pub async fn mahzz_estado(app: AppHandle) -> Result<Value, String> {
    spawn_blocking(move || match elegir_motor(&app)? {
        Motor::Local(modelo) => Ok(json!({ "proveedor": "local", "modelo": modelo })),
        Motor::Api(config) => Ok(json!({ "proveedor": "api", "modelo": config.modelo })),
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn mahzz_instalar(canal: Channel<Value>) -> Result<(), String> {
    spawn_blocking(move || {
        if !prender_ollama() {
            return Err("sin_ollama|No encontré Ollama en esta PC.".into());
        }
        CANCELAR_DESCARGA.store(false, Ordering::SeqCst);
        let respuesta = ureq::post(&format!("{URL}/api/pull"))
            .config()
            .http_status_as_error(false)
            .build()
            .header("Content-Type", "application/json")
            .send(json!({ "model": MODELO_PUBLICO, "stream": true }).to_string())
            .map_err(|error| format!("Ollama no respondió: {error}"))?;
        let lector = BufReader::new(respuesta.into_body().into_reader());
        for linea in lector.lines() {
            if CANCELAR_DESCARGA.load(Ordering::SeqCst) {
                return Err("cancelada|Cancelaste la instalación.".into());
            }
            let linea = linea.map_err(|error| error.to_string())?;
            let Ok(parte) = serde_json::from_str::<Value>(&linea) else {
                continue;
            };
            if let Some(error) = parte["error"].as_str() {
                return Err(error.to_string());
            }
            let estado = parte["status"].as_str().unwrap_or_default();
            let _ = canal.send(json!({
                "estado": estado,
                "total": parte["total"].as_u64(),
                "completado": parte["completed"].as_u64(),
            }));
            if estado == "success" {
                return Ok(());
            }
        }
        Err(
            "La descarga se cortó antes de terminar. Probá de nuevo: sigue desde donde quedó."
                .into(),
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn mahzz_cancelar_instalacion() {
    CANCELAR_DESCARGA.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn mahzz_detener() {
    TURNO.fetch_add(1, Ordering::SeqCst);
}

#[tauri::command]
pub async fn mahzz_chat(
    app: AppHandle,
    mensajes: Vec<Value>,
    canal: Channel<Value>,
) -> Result<(), String> {
    let turno = TURNO.fetch_add(1, Ordering::SeqCst) + 1;
    spawn_blocking(move || match elegir_motor(&app)? {
        Motor::Local(modelo) => chat_ollama(&modelo, mensajes, &canal, turno),
        Motor::Api(config) => chat_api(&config, mensajes, &canal, turno),
    })
    .await
    .map_err(|error| error.to_string())?
}

fn mandar(canal: &Channel<Value>, tipo: &str, trozo: Option<&str>) -> bool {
    match trozo.filter(|t| !t.is_empty()) {
        Some(trozo) => canal.send(json!({ tipo: trozo })).is_ok(),
        None => true,
    }
}

fn chat_ollama(
    modelo: &str,
    mensajes: Vec<Value>,
    canal: &Channel<Value>,
    turno: u64,
) -> Result<(), String> {
    let cuerpo = json!({ "model": modelo, "messages": mensajes, "stream": true, "think": "low" });
    let respuesta = ureq::post(&format!("{URL}/api/chat"))
        .header("Content-Type", "application/json")
        .send(cuerpo.to_string())
        .map_err(|error| format!("Ollama no respondió: {error}"))?;
    let lector = BufReader::new(respuesta.into_body().into_reader());
    for linea in lector.lines() {
        if TURNO.load(Ordering::SeqCst) != turno {
            break;
        }
        let linea = linea.map_err(|error| error.to_string())?;
        if linea.trim().is_empty() {
            continue;
        }
        let Ok(parte) = serde_json::from_str::<Value>(&linea) else {
            continue;
        };
        if let Some(error) = parte["error"].as_str() {
            return Err(error.to_string());
        }
        let mensaje = &parte["message"];
        if !mandar(canal, "pensando", mensaje["thinking"].as_str())
            || !mandar(canal, "texto", mensaje["content"].as_str())
        {
            return Ok(());
        }
        if parte["done"].as_bool() == Some(true) {
            break;
        }
    }
    Ok(())
}

fn chat_api(
    config: &Config,
    mensajes: Vec<Value>,
    canal: &Channel<Value>,
    turno: u64,
) -> Result<(), String> {
    let mut todos = Vec::with_capacity(mensajes.len() + 1);
    todos.push(json!({ "role": "system", "content": IDENTIDAD }));
    todos.extend(mensajes);
    let cuerpo = json!({ "model": config.modelo, "messages": todos, "stream": true });

    let respuesta = ureq::post(&format!("{}/chat/completions", config.url))
        .config()
        .http_status_as_error(false)
        .build()
        .header("Content-Type", "application/json")
        .header("Authorization", &format!("Bearer {}", config.key))
        .send(cuerpo.to_string())
        .map_err(|error| format!("La API no respondió: {error}"))?;

    let estado = respuesta.status().as_u16();
    if estado >= 400 {
        let mut texto = String::new();
        let _ = respuesta
            .into_body()
            .into_reader()
            .take(4000)
            .read_to_string(&mut texto);
        let detalle = serde_json::from_str::<Value>(&texto)
            .ok()
            .and_then(|datos| {
                datos["error"]["message"]
                    .as_str()
                    .or(datos["error"].as_str())
                    .map(String::from)
            })
            .unwrap_or(texto);
        return Err(format!("La API devolvió {estado}: {}", detalle.trim()));
    }

    let lector = BufReader::new(respuesta.into_body().into_reader());
    for linea in lector.lines() {
        if TURNO.load(Ordering::SeqCst) != turno {
            break;
        }
        let linea = linea.map_err(|error| error.to_string())?;
        let Some(dato) = linea.strip_prefix("data:").map(str::trim) else {
            continue;
        };
        if dato == "[DONE]" {
            break;
        }
        let Ok(parte) = serde_json::from_str::<Value>(dato) else {
            continue;
        };
        if let Some(error) = parte["error"]["message"].as_str() {
            return Err(error.to_string());
        }
        let delta = &parte["choices"][0]["delta"];
        let razonamiento = delta["reasoning_content"]
            .as_str()
            .or(delta["reasoning"].as_str());
        if !mandar(canal, "pensando", razonamiento)
            || !mandar(canal, "texto", delta["content"].as_str())
        {
            return Ok(());
        }
    }
    Ok(())
}
