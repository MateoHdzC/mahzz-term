// Mahzz-AI: el copiloto local. Habla con Ollama desde Rust para no pelear con CORS ni la CSP del webview.
use std::{
    io::{BufRead, BufReader},
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::Duration,
};

use serde_json::{json, Value};
use tauri::{async_runtime::spawn_blocking, ipc::Channel};

const URL: &str = "http://127.0.0.1:11434";
const MODELO: &str = "mahzz:latest";
// Misma base que MahzzAI: se usa con la identidad como instrucción mientras el modelo propio no esté instalado.
const PROVISORIO: &str = "gpt-oss-libre:latest";
const IDENTIDAD: &str = "Eres MahzzAI, el asistente de programación creado por MahzzStudio, integrado en la terminal MahzzTerm. \
No eres ChatGPT. Hablas en español neutro, claro y directo. Eres experto en PowerShell, Windows, terminal, Python, C#, \
JavaScript y Git. Cuando muestres comandos, ponlos en bloques de código con el lenguaje indicado.";

// Cada respuesta tiene un número de turno: detener sube el número y la respuesta en curso se corta sola.
static TURNO: AtomicU64 = AtomicU64::new(0);

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
    let Some(local) = std::env::var_os("LOCALAPPDATA") else { return false };
    let programa = PathBuf::from(local).join("Programs").join("Ollama").join("ollama app.exe");
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
    let Ok(mut respuesta) = ureq::get(&format!("{URL}/api/tags")).call() else { return Vec::new() };
    let Ok(texto) = respuesta.body_mut().read_to_string() else { return Vec::new() };
    let Ok(datos) = serde_json::from_str::<Value>(&texto) else { return Vec::new() };
    datos["models"]
        .as_array()
        .map(|lista| lista.iter().filter_map(|m| m["name"].as_str().map(String::from)).collect())
        .unwrap_or_default()
}

// Devuelve qué modelo se va a usar y si es el provisorio.
fn elegir_modelo() -> Result<(String, bool), String> {
    if !prender_ollama() {
        return Err("No pude prender Ollama. ¿Está instalado?".into());
    }
    let instalados = modelos_instalados();
    if instalados.iter().any(|m| m == MODELO) {
        Ok((MODELO.into(), false))
    } else if instalados.iter().any(|m| m == PROVISORIO) {
        Ok((PROVISORIO.into(), true))
    } else {
        Err("No encontré el modelo de Mahzz-AI en Ollama.".into())
    }
}

#[tauri::command]
pub async fn mahzz_estado() -> Result<Value, String> {
    spawn_blocking(|| {
        let (modelo, provisorio) = elegir_modelo()?;
        Ok(json!({ "modelo": modelo, "provisorio": provisorio }))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn mahzz_detener() {
    TURNO.fetch_add(1, Ordering::SeqCst);
}

// Manda la charla a Ollama y va pasando los trozos por el canal: {"pensando": "..."} o {"texto": "..."}.
#[tauri::command]
pub async fn mahzz_chat(mensajes: Vec<Value>, canal: Channel<Value>) -> Result<(), String> {
    let turno = TURNO.fetch_add(1, Ordering::SeqCst) + 1;
    spawn_blocking(move || {
        let (modelo, provisorio) = elegir_modelo()?;
        let mut todos = Vec::with_capacity(mensajes.len() + 1);
        if provisorio {
            todos.push(json!({ "role": "system", "content": IDENTIDAD }));
        }
        todos.extend(mensajes);
        let cuerpo = json!({ "model": modelo, "messages": todos, "stream": true, "think": "low" });

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
            let Ok(parte) = serde_json::from_str::<Value>(&linea) else { continue };
            if let Some(error) = parte["error"].as_str() {
                return Err(error.to_string());
            }
            let mensaje = &parte["message"];
            for clave in ["thinking", "content"] {
                if let Some(trozo) = mensaje[clave].as_str().filter(|t| !t.is_empty()) {
                    let tipo = if clave == "thinking" { "pensando" } else { "texto" };
                    if canal.send(json!({ tipo: trozo })).is_err() {
                        return Ok(());
                    }
                }
            }
            if parte["done"].as_bool() == Some(true) {
                break;
            }
        }
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}
