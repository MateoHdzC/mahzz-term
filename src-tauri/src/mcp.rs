// Servidor MCP: `MahzzTerm.exe --mcp` habla JSON-RPC por stdin/stdout con la IA (Claude Code,
// Cursor, etc.) y le pasa cada herramienta a la MahzzTerm abierta. Si no está abierta, la abre.
use std::{
    env, fs,
    io::{self, BufRead, Write},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use std::os::windows::process::CommandExt;

use serde_json::{json, Value};
use windows::Win32::{
    Foundation::{SetHandleInformation, HANDLE_FLAGS, HANDLE_FLAG_INHERIT},
    System::Console::{GetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE},
    UI::WindowsAndMessaging::AllowSetForegroundWindow,
};

use crate::control::ruta_control;

const PROCESO_SEPARADO: u32 = 0x0000_0008;
const NUEVO_GRUPO: u32 = 0x0000_0200;

const VERSION_PROTOCOLO: &str = "2025-06-18";
const ESPERA_APERTURA: Duration = Duration::from_secs(25);

const INSTRUCCIONES: &str = "MahzzTerm es una terminal de Windows (PowerShell 7) organizada en pestañas y paneles. \
Cada comando terminado queda como un bloque con su salida, su código de salida y su duración. \
Empezá con listar_pestanas para ver los paneles y sus ids. ejecutar corre un comando y devuelve su bloque; \
para servidores u otros procesos largos usá esperar=false y después leer_pantalla. \
Si un panel tiene un programa interactivo abierto (por ejemplo Claude Code o un servidor), usá enviar_teclas y leer_pantalla. \
Sin `panel`, las herramientas usan el panel activo.";

fn herramientas() -> Value {
    let panel = json!({ "type": "integer", "description": "Id del panel (de listar_pestanas). Sin esto se usa el panel activo." });
    json!([
        {
            "name": "listar_pestanas",
            "description": "Lista las pestañas y paneles abiertos: id, carpeta, programa que corre, si está ocupado, rama de git y host SSH.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "leer_bloques",
            "description": "Lee los últimos comandos terminados de un panel, con su salida, código de salida, duración y carpeta. Ideal para revisar errores y logs.",
            "inputSchema": { "type": "object", "properties": {
                "panel": panel,
                "cantidad": { "type": "integer", "description": "Cuántos bloques (los más recientes). Por defecto 10." },
                "solo_errores": { "type": "boolean", "description": "Solo los que terminaron con código distinto de 0." },
                "max_caracteres": { "type": "integer", "description": "Máximo de caracteres de salida por bloque. Por defecto 20000." }
            } }
        },
        {
            "name": "leer_pantalla",
            "description": "Lee lo que se ve ahora en la terminal de un panel: la salida en vivo de un comando que sigue corriendo (servidores, compilaciones, logs) o la pantalla de un programa interactivo.",
            "inputSchema": { "type": "object", "properties": {
                "panel": panel,
                "lineas": { "type": "integer", "description": "Cuántas líneas del final. Por defecto 200." }
            } }
        },
        {
            "name": "ejecutar",
            "description": "Ejecuta un comando de PowerShell en un panel y, si esperar=true, devuelve su bloque terminado (salida y código). Si se pasa el tiempo, devuelve lo que se ve hasta ese momento y el comando sigue corriendo.",
            "inputSchema": { "type": "object", "properties": {
                "comando": { "type": "string" },
                "panel": panel,
                "esperar": { "type": "boolean", "description": "Esperar a que termine. Por defecto true." },
                "timeout_s": { "type": "integer", "description": "Segundos máximos de espera. Por defecto 60, máximo 900." }
            }, "required": ["comando"] }
        },
        {
            "name": "enviar_teclas",
            "description": "Manda texto y teclas a lo que corre en un panel, para programas interactivos: responder preguntas, cortar con ctrl+c, navegar menús o escribirle a otro agente.",
            "inputSchema": { "type": "object", "properties": {
                "panel": panel,
                "texto": { "type": "string", "description": "Texto a escribir tal cual." },
                "teclas": { "type": "array", "items": { "type": "string" },
                    "description": "Teclas especiales en orden, después del texto: enter, tab, esc, backspace, delete, up, down, left, right, home, end, pageup, pagedown, space, ctrl+c, ctrl+d, ctrl+z, ctrl+l, ctrl+r, ctrl+a, ctrl+e, ctrl+u, ctrl+w." }
            } }
        },
        {
            "name": "nueva_pestana",
            "description": "Abre una pestaña nueva y, opcionalmente, ejecuta un comando en ella. Devuelve el id del panel.",
            "inputSchema": { "type": "object", "properties": {
                "carpeta": { "type": "string", "description": "Carpeta inicial. Por defecto la del panel activo." },
                "comando": { "type": "string" },
                "titulo": { "type": "string", "description": "Nombre para la pestaña." }
            } }
        },
        {
            "name": "dividir_panel",
            "description": "Divide un panel en dos y devuelve el id del panel nuevo.",
            "inputSchema": { "type": "object", "properties": {
                "panel": panel,
                "direccion": { "type": "string", "enum": ["derecha", "abajo"] },
                "comando": { "type": "string" }
            } }
        },
        {
            "name": "cerrar_panel",
            "description": "Cierra un panel (si era el único de la pestaña, cierra la pestaña). Si hay un programa corriendo, hace falta forzar=true.",
            "inputSchema": { "type": "object", "properties": {
                "panel": { "type": "integer" },
                "forzar": { "type": "boolean" }
            }, "required": ["panel"] }
        },
        {
            "name": "enfocar_panel",
            "description": "Muestra la pestaña de un panel y le pasa el foco.",
            "inputSchema": { "type": "object", "properties": { "panel": { "type": "integer" } }, "required": ["panel"] }
        },
        {
            "name": "renombrar_pestana",
            "description": "Cambia el nombre de la pestaña que contiene a un panel. Un título vacío vuelve al nombre automático.",
            "inputSchema": { "type": "object", "properties": {
                "panel": panel,
                "titulo": { "type": "string" }
            }, "required": ["titulo"] }
        },
        {
            "name": "estado_agentes",
            "description": "Lista los agentes de IA que corren en las pestañas (Claude Code, Codex, Gemini CLI…) y si están trabajando, esperando o necesitan respuesta.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "historial",
            "description": "Devuelve los últimos comandos ejecutados en MahzzTerm, con carpeta, fecha y código de salida.",
            "inputSchema": { "type": "object", "properties": {
                "cantidad": { "type": "integer", "description": "Por defecto 50." },
                "filtro": { "type": "string", "description": "Solo comandos que contengan este texto." }
            } }
        },
        {
            "name": "buscar_logs",
            "description": "Busca en los logs de TODOS los comandos terminados en MahzzTerm (cualquier pestaña, últimos 30 días): en el comando y en su salida. Sin consulta devuelve los más recientes.",
            "inputSchema": { "type": "object", "properties": {
                "consulta": { "type": "string", "description": "Texto a buscar, sin distinguir mayúsculas." },
                "solo_errores": { "type": "boolean" },
                "limite": { "type": "integer", "description": "Por defecto 20." },
                "max_caracteres": { "type": "integer", "description": "Máximo de salida por resultado. Por defecto 4000." }
            } }
        },
        {
            "name": "nueva_tarea",
            "description": "Crea una tarea en paralelo para un agente: un worktree de git con su propia rama (mahzz/<nombre>) en una carpeta aparte, abre una pestaña ahí y arranca al agente con las instrucciones. Así varios agentes trabajan a la vez sin pisarse.",
            "inputSchema": { "type": "object", "properties": {
                "nombre": { "type": "string", "description": "Nombre corto de la tarea; se usa para la rama." },
                "instrucciones": { "type": "string", "description": "Lo que tiene que hacer el agente." },
                "agente": { "type": "string", "description": "Comando del agente. Por defecto claude." },
                "carpeta": { "type": "string", "description": "Carpeta del repositorio. Por defecto la del panel activo." }
            }, "required": ["nombre"] }
        },
        {
            "name": "listar_tareas",
            "description": "Lista las tareas en paralelo (worktrees con rama mahzz/…) del repositorio, con sus cambios sin guardar y commits.",
            "inputSchema": { "type": "object", "properties": {
                "carpeta": { "type": "string", "description": "Carpeta del repositorio. Por defecto la del panel activo." }
            } }
        },
        {
            "name": "unir_tarea",
            "description": "Une una tarea terminada: guarda en un commit lo que dejó el agente, la une a la rama actual del repositorio y borra su carpeta. Si hay conflictos, no cambia nada.",
            "inputSchema": { "type": "object", "properties": {
                "carpeta": { "type": "string", "description": "Carpeta de la tarea (de listar_tareas)." }
            }, "required": ["carpeta"] }
        },
        {
            "name": "descartar_tarea",
            "description": "Descarta una tarea: borra su carpeta y su rama con todo lo que hizo el agente.",
            "inputSchema": { "type": "object", "properties": {
                "carpeta": { "type": "string", "description": "Carpeta de la tarea (de listar_tareas)." }
            }, "required": ["carpeta"] }
        },
        {
            "name": "abrir_archivo",
            "description": "Abre un archivo en el visor lateral de MahzzTerm para que la persona lo vea (código, Markdown, HTML, imágenes, PDF…).",
            "inputSchema": { "type": "object", "properties": { "ruta": { "type": "string" } }, "required": ["ruta"] }
        }
    ])
}

struct Conexion {
    puerto: u16,
    clave: String,
    pid: Option<u32>,
}

fn leer_conexion() -> Option<Conexion> {
    let texto = fs::read_to_string(ruta_control()?).ok()?;
    let datos: Value = serde_json::from_str(&texto).ok()?;
    Some(Conexion {
        puerto: u16::try_from(datos["puerto"].as_u64()?).ok()?,
        clave: datos["clave"].as_str()?.to_string(),
        pid: datos["pid"].as_u64().and_then(|pid| u32::try_from(pid).ok()),
    })
}

fn pedir(conexion: &Conexion, accion: &str, args: &Value, espera: Duration) -> Result<Value, String> {
    let agente: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(espera))
        .http_status_as_error(false)
        .build()
        .into();
    let cuerpo = json!({ "accion": accion, "args": args }).to_string();
    let mut respuesta = agente
        .post(&format!("http://127.0.0.1:{}/accion", conexion.puerto))
        .header("Authorization", &format!("Bearer {}", conexion.clave))
        .header("Content-Type", "application/json")
        .send(cuerpo)
        .map_err(|error| error.to_string())?;
    let texto = respuesta.body_mut().with_config().limit(64 * 1024 * 1024).read_to_string().map_err(|error| error.to_string())?;
    serde_json::from_str(&texto).map_err(|error| error.to_string())
}

// Si la app abierta heredara los caños de este proceso, quien lanzó el MCP (por ejemplo
// Claude Code) se quedaría esperando a que se cierre la ventana. Se marcan como no heredables.
fn no_heredar_entrada_salida() {
    for cual in [STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE] {
        unsafe {
            if let Ok(manija) = GetStdHandle(cual) {
                if !manija.is_invalid() {
                    let _ = SetHandleInformation(manija, HANDLE_FLAG_INHERIT.0, HANDLE_FLAGS(0));
                }
            }
        }
    }
}

fn conectada() -> Option<Conexion> {
    let conexion = leer_conexion()?;
    pedir(&conexion, "ping", &json!({}), Duration::from_secs(3)).ok()?;
    Some(conexion)
}

// Le pasa un pedido a la MahzzTerm que ya está abierta. Devuelve false si no hay ninguna
// o si no lo pudo atender (por ejemplo, una versión vieja que no conoce la acción).
pub(crate) fn pasar_a_abierta(accion: &str, args: &Value) -> bool {
    let Some(conexion) = conectada() else { return false };
    // Windows solo deja pasar una ventana al frente si lo permite el proceso que tiene el foco:
    // este, que acaba de abrir el Explorador.
    if let Some(pid) = conexion.pid {
        unsafe {
            let _ = AllowSetForegroundWindow(pid);
        }
    }
    pedir(&conexion, accion, args, Duration::from_secs(15)).is_ok_and(|respuesta| respuesta["ok"] == true)
}

// Si MahzzTerm no está abierta, se abre la misma app (sin --mcp) y se espera a que responda.
fn conectar() -> Result<Conexion, String> {
    if let Some(conexion) = conectada() {
        return Ok(conexion);
    }
    let exe = env::current_exe().map_err(|error| error.to_string())?;
    no_heredar_entrada_salida();
    Command::new(exe)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(PROCESO_SEPARADO | NUEVO_GRUPO)
        .spawn()
        .map_err(|error| format!("No se pudo abrir MahzzTerm: {error}"))?;
    let inicio = Instant::now();
    while inicio.elapsed() < ESPERA_APERTURA {
        thread::sleep(Duration::from_millis(500));
        if let Some(conexion) = conectada() {
            // La interfaz necesita un momento más para tener la primera pestaña lista.
            thread::sleep(Duration::from_millis(1500));
            return Ok(conexion);
        }
    }
    Err("MahzzTerm no respondió después de abrirla".to_string())
}

fn llamar_herramienta(nombre: &str, args: &Value) -> Value {
    let conocida = herramientas().as_array().is_some_and(|lista| lista.iter().any(|h| h["name"] == nombre));
    if !conocida {
        return json!({ "content": [{ "type": "text", "text": format!("Herramienta desconocida: {nombre}") }], "isError": true });
    }
    let espera = Duration::from_secs(args["timeout_s"].as_u64().unwrap_or(60).min(900) + 20);
    let resultado = conectar().and_then(|conexion| pedir(&conexion, nombre, args, espera));
    match resultado {
        Ok(respuesta) if respuesta["ok"] == true => {
            let datos = &respuesta["datos"];
            let texto = datos.as_str().map(str::to_string).unwrap_or_else(|| serde_json::to_string_pretty(datos).unwrap_or_default());
            json!({ "content": [{ "type": "text", "text": texto }], "structuredContent": if datos.is_object() { datos.clone() } else { json!({ "resultado": datos }) } })
        }
        Ok(respuesta) => {
            let error = respuesta["error"].as_str().unwrap_or("Error desconocido");
            json!({ "content": [{ "type": "text", "text": error }], "isError": true })
        }
        Err(error) => json!({ "content": [{ "type": "text", "text": error }], "isError": true }),
    }
}

fn responder(salida: &mut impl Write, id: &Value, resultado: Result<Value, (i64, String)>) {
    let mensaje = match resultado {
        Ok(valor) => json!({ "jsonrpc": "2.0", "id": id, "result": valor }),
        Err((codigo, texto)) => json!({ "jsonrpc": "2.0", "id": id, "error": { "code": codigo, "message": texto } }),
    };
    let _ = writeln!(salida, "{mensaje}");
    let _ = salida.flush();
}

pub fn correr() {
    let entrada = io::stdin();
    let mut salida = io::stdout();
    for linea in entrada.lock().lines() {
        let Ok(linea) = linea else { break };
        if linea.trim().is_empty() {
            continue;
        }
        let Ok(mensaje) = serde_json::from_str::<Value>(&linea) else {
            responder(&mut salida, &Value::Null, Err((-32700, "JSON inválido".to_string())));
            continue;
        };
        // Las notificaciones no tienen id y no llevan respuesta.
        let Some(id) = mensaje.get("id").cloned() else { continue };
        let metodo = mensaje["method"].as_str().unwrap_or("");
        let parametros = &mensaje["params"];
        let resultado = match metodo {
            "initialize" => Ok(json!({
                "protocolVersion": parametros["protocolVersion"].as_str().unwrap_or(VERSION_PROTOCOLO),
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "mahzzterm", "title": "MahzzTerm", "version": env!("CARGO_PKG_VERSION") },
                "instructions": INSTRUCCIONES,
            })),
            "ping" => Ok(json!({})),
            "tools/list" => Ok(json!({ "tools": herramientas() })),
            "tools/call" => {
                let nombre = parametros["name"].as_str().unwrap_or("");
                let args = parametros.get("arguments").cloned().unwrap_or_else(|| json!({}));
                Ok(llamar_herramienta(nombre, &args))
            }
            _ => Err((-32601, format!("Método no soportado: {metodo}"))),
        };
        responder(&mut salida, &id, resultado);
    }
}
