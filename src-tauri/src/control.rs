// Servidor de control: recibe pedidos del MCP (`MahzzTerm.exe --mcp`) y se los pasa a la interfaz.
// Escucha solo en 127.0.0.1 con un puerto al azar y pide una clave que se guarda en
// control.json, dentro de la carpeta de datos del usuario.
use std::{
    collections::HashMap,
    env, fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Mutex,
    },
    thread,
    time::Duration,
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

const MAXIMO_CUERPO: usize = 2 * 1024 * 1024;
const ESPERA_POR_DEFECTO: u64 = 30;
const ESPERA_MAXIMA: u64 = 900;

#[derive(Default)]
pub struct Control {
    pendientes: Mutex<HashMap<u64, mpsc::Sender<Value>>>,
    siguiente: AtomicU64,
}

// La misma carpeta que usa la app (%LOCALAPPDATA%\com.mahzz.mahzzterm\datos), pero sin
// necesitar Tauri: el proceso del MCP también la tiene que encontrar.
pub fn ruta_control() -> Option<PathBuf> {
    let carpeta = env::var_os("MAHZZTERM_DATOS")
        .filter(|valor| !valor.is_empty())
        .map(PathBuf::from)
        .or_else(|| env::var_os("LOCALAPPDATA").map(|base| PathBuf::from(base).join("com.mahzz.mahzzterm").join("datos")))?;
    Some(carpeta.join("control.json"))
}

pub fn iniciar(app: AppHandle) -> Result<(), String> {
    let escucha = TcpListener::bind(("127.0.0.1", 0)).map_err(|error| error.to_string())?;
    let puerto = escucha.local_addr().map_err(|error| error.to_string())?.port();
    let mut bytes = [0u8; 24];
    getrandom::fill(&mut bytes).map_err(|error| error.to_string())?;
    let clave = URL_SAFE_NO_PAD.encode(bytes);

    let ruta = ruta_control().ok_or("No se encontró la carpeta de datos")?;
    if let Some(carpeta) = ruta.parent() {
        fs::create_dir_all(carpeta).map_err(|error| error.to_string())?;
    }
    let datos = json!({ "puerto": puerto, "clave": clave, "pid": std::process::id() });
    fs::write(&ruta, datos.to_string()).map_err(|error| error.to_string())?;

    thread::spawn(move || {
        for conexion in escucha.incoming().flatten() {
            let app = app.clone();
            let clave = clave.clone();
            thread::spawn(move || atender(&app, conexion, puerto, &clave));
        }
    });
    Ok(())
}

fn responder(conexion: &mut TcpStream, estado: &str, cuerpo: &Value) {
    let texto = cuerpo.to_string();
    let _ = write!(
        conexion,
        "HTTP/1.1 {estado}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{texto}",
        texto.len()
    );
}

fn atender(app: &AppHandle, mut conexion: TcpStream, puerto: u16, clave: &str) {
    let _ = conexion.set_read_timeout(Some(Duration::from_secs(10)));
    let mut bufer = Vec::new();
    let mut parte = [0u8; 8192];
    let fin_encabezado = loop {
        if let Some(posicion) = bufer.windows(4).position(|ventana| ventana == b"\r\n\r\n") {
            break Some(posicion + 4);
        }
        if bufer.len() > 64 * 1024 {
            break None;
        }
        match conexion.read(&mut parte) {
            Ok(0) | Err(_) => break None,
            Ok(leidos) => bufer.extend_from_slice(&parte[..leidos]),
        }
    };
    let Some(fin_encabezado) = fin_encabezado else {
        return;
    };
    let encabezado = String::from_utf8_lossy(&bufer[..fin_encabezado]).into_owned();
    let mut lineas = encabezado.split("\r\n");
    let primera = lineas.next().unwrap_or("");
    let encabezados: HashMap<String, String> = lineas
        .filter_map(|linea| linea.split_once(':'))
        .map(|(nombre, valor)| (nombre.trim().to_ascii_lowercase(), valor.trim().to_string()))
        .collect();

    let host_esperado = format!("127.0.0.1:{puerto}");
    let autorizado = encabezados.get("authorization").map(String::as_str) == Some(&format!("Bearer {clave}"));
    if !primera.starts_with("POST /accion ") || encabezados.get("host") != Some(&host_esperado) || !autorizado {
        responder(&mut conexion, "403 Forbidden", &json!({ "ok": false, "error": "No autorizado" }));
        return;
    }

    let largo: usize = encabezados.get("content-length").and_then(|valor| valor.parse().ok()).unwrap_or(0);
    if largo > MAXIMO_CUERPO {
        responder(&mut conexion, "413 Payload Too Large", &json!({ "ok": false, "error": "Pedido demasiado grande" }));
        return;
    }
    let mut cuerpo = bufer[fin_encabezado..].to_vec();
    while cuerpo.len() < largo {
        match conexion.read(&mut parte) {
            Ok(0) | Err(_) => break,
            Ok(leidos) => cuerpo.extend_from_slice(&parte[..leidos]),
        }
    }
    let Ok(pedido) = serde_json::from_slice::<Value>(&cuerpo) else {
        responder(&mut conexion, "400 Bad Request", &json!({ "ok": false, "error": "JSON inválido" }));
        return;
    };
    let accion = pedido["accion"].as_str().unwrap_or("").to_string();
    let args = pedido.get("args").cloned().unwrap_or_else(|| json!({}));
    if accion == "ping" {
        responder(&mut conexion, "200 OK", &json!({ "ok": true, "datos": "pong" }));
        return;
    }

    // Desde el Explorador: la ventana vuelve al frente aunque esté minimizada u oculta.
    if accion == "abrir_desde_windows" {
        if let Some(ventana) = app.get_webview_window("main") {
            let _ = ventana.unminimize();
            let _ = ventana.show();
            let _ = ventana.set_focus();
        }
    }

    // Se le pasa el pedido a la interfaz y se espera su respuesta.
    let control = app.state::<Control>();
    let id = control.siguiente.fetch_add(1, Ordering::Relaxed) + 1;
    let (enviar, recibir) = mpsc::channel();
    if let Ok(mut pendientes) = control.pendientes.lock() {
        pendientes.insert(id, enviar);
    }
    let espera = args["timeout_s"].as_u64().unwrap_or(ESPERA_POR_DEFECTO).min(ESPERA_MAXIMA) + 10;
    let resultado = if app.emit_to("main", "mahzz:control", json!({ "id": id, "accion": accion, "args": args })).is_err() {
        json!({ "ok": false, "error": "La ventana principal de MahzzTerm no está abierta" })
    } else {
        recibir
            .recv_timeout(Duration::from_secs(espera))
            .unwrap_or_else(|_| json!({ "ok": false, "error": "MahzzTerm no respondió a tiempo" }))
    };
    if let Ok(mut pendientes) = control.pendientes.lock() {
        pendientes.remove(&id);
    }
    responder(&mut conexion, "200 OK", &resultado);
}

#[tauri::command]
pub fn responder_control(control: State<'_, Control>, id: u64, resultado: Value) {
    let enviar = control.pendientes.lock().ok().and_then(|mut pendientes| pendientes.remove(&id));
    if let Some(enviar) = enviar {
        let _ = enviar.send(resultado);
    }
}

#[tauri::command]
pub fn ruta_ejecutable() -> Option<String> {
    env::current_exe().ok().map(|ruta| ruta.to_string_lossy().into_owned())
}
