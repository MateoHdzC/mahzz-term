use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    os::windows::process::CommandExt,
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex, OnceLock},
    thread,
    time::{Duration, UNIX_EPOCH},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use percent_encoding::percent_decode_str;
use tauri::async_runtime::spawn_blocking;
use url::Url;

const SIN_VENTANA: u32 = 0x0800_0000;
const MAXIMO_PEDIDO: usize = 16 * 1024;
const RUTA_CAMBIOS: &str = "/__mahzz/cambios";

const RECARGA: &str = "<script>(()=>{const d=Date.now();setInterval(async()=>{try{const r=await fetch('/__mahzz/cambios?desde='+d,{cache:'no-store'});if((await r.text())==='1')location.reload()}catch{}},700)})()</script>";

struct Servidor {
    raiz: PathBuf,
    puerto: u16,
    clave: String,
    servidos: Mutex<HashMap<PathBuf, u64>>,
}

fn servidores() -> &'static Mutex<HashMap<PathBuf, Arc<Servidor>>> {
    static SERVIDORES: OnceLock<Mutex<HashMap<PathBuf, Arc<Servidor>>>> = OnceLock::new();
    SERVIDORES.get_or_init(Default::default)
}

fn fecha_de(ruta: &Path) -> u64 {
    fs::metadata(ruta)
        .and_then(|datos| datos.modified())
        .ok()
        .and_then(|fecha| fecha.duration_since(UNIX_EPOCH).ok())
        .map(|duracion| duracion.as_millis() as u64)
        .unwrap_or(0)
}

fn raiz_git(carpeta: &Path) -> Option<PathBuf> {
    let salida = Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .current_dir(carpeta)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(SIN_VENTANA)
        .output()
        .ok()?;
    let texto = String::from_utf8_lossy(&salida.stdout)
        .trim()
        .replace('/', "\\");
    (salida.status.success() && !texto.is_empty()).then(|| PathBuf::from(texto))
}

fn raiz_del_proyecto(html: &Path) -> PathBuf {
    let carpeta = html.parent().unwrap_or(html).to_path_buf();
    if let Some(raiz) = raiz_git(&carpeta) {
        return raiz;
    }
    carpeta
        .ancestors()
        .take(6)
        .find(|ancestro| ancestro.join("package.json").is_file())
        .map(Path::to_path_buf)
        .unwrap_or(carpeta)
}

fn tipo_mime(ruta: &Path) -> &'static str {
    let extension = ruta
        .extension()
        .and_then(|valor| valor.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match extension.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" | "cjs" => "text/javascript; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "txt" | "md" => "text/plain; charset=utf-8",
        "xml" => "application/xml",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "wasm" => "application/wasm",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

fn responder(conexion: &mut TcpStream, estado: &str, tipo: &str, cuerpo: &[u8], cabeza: bool) {
    let encabezado = format!(
        "HTTP/1.1 {estado}\r\nContent-Type: {tipo}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        cuerpo.len()
    );
    let _ = conexion.write_all(encabezado.as_bytes());
    if !cabeza {
        let _ = conexion.write_all(cuerpo);
    }
}

fn ruta_local(raiz: &Path, camino: &str) -> Option<PathBuf> {
    let mut ruta = raiz.to_path_buf();
    for parte in camino.split('/').filter(|parte| !parte.is_empty()) {
        let parte = percent_decode_str(parte).decode_utf8().ok()?;
        let componente = Path::new(parte.as_ref());
        let normal = componente.components().count() == 1
            && matches!(componente.components().next(), Some(Component::Normal(_)));
        if !normal || parte.contains(['\\', ':']) || parte.starts_with('.') {
            return None;
        }
        ruta.push(parte.as_ref());
    }
    if let (Ok(real), Ok(base)) = (ruta.canonicalize(), raiz.canonicalize()) {
        if !real.starts_with(base) {
            return None;
        }
    }
    Some(ruta)
}

fn atender(servidor: &Servidor, mut conexion: TcpStream) {
    let _ = conexion.set_read_timeout(Some(Duration::from_secs(5)));
    let mut bufer = Vec::new();
    let mut parte = [0u8; 4096];
    while !bufer.windows(4).any(|ventana| ventana == b"\r\n\r\n") && bufer.len() < MAXIMO_PEDIDO {
        match conexion.read(&mut parte) {
            Ok(0) | Err(_) => break,
            Ok(leidos) => bufer.extend_from_slice(&parte[..leidos]),
        }
    }
    let pedido = String::from_utf8_lossy(&bufer);
    let mut lineas = pedido.split("\r\n");
    let mut primera = lineas.next().unwrap_or("").split_whitespace();
    let metodo = primera.next().unwrap_or("");
    let destino = primera.next().unwrap_or("/");
    let encabezados: HashMap<String, String> = lineas
        .filter_map(|linea| linea.split_once(':'))
        .map(|(nombre, valor)| (nombre.trim().to_ascii_lowercase(), valor.trim().to_string()))
        .collect();
    let cabeza = metodo == "HEAD";
    if metodo != "GET" && !cabeza {
        responder(
            &mut conexion,
            "405 Method Not Allowed",
            "text/plain",
            b"",
            false,
        );
        return;
    }

    let host_esperado = format!("127.0.0.1:{}", servidor.puerto);
    if encabezados.get("host").map(String::as_str) != Some(host_esperado.as_str()) {
        responder(&mut conexion, "403 Forbidden", "text/plain", b"", cabeza);
        return;
    }
    let Ok(url) = Url::parse(&format!("http://{host_esperado}{destino}")) else {
        responder(&mut conexion, "400 Bad Request", "text/plain", b"", cabeza);
        return;
    };
    let con_clave = url
        .query_pairs()
        .any(|(nombre, valor)| nombre == "mahzz" && valor == servidor.clave);
    let mismo_sitio = encabezados.get("sec-fetch-site").map(String::as_str) == Some("same-origin");
    if !con_clave && !mismo_sitio {
        responder(&mut conexion, "403 Forbidden", "text/plain", b"", cabeza);
        return;
    }

    if url.path() == RUTA_CAMBIOS {
        let desde: u64 = url
            .query_pairs()
            .find(|(nombre, _)| nombre == "desde")
            .and_then(|(_, valor)| valor.parse().ok())
            .unwrap_or(u64::MAX);
        let servidos = servidor
            .servidos
            .lock()
            .map(|mapa| mapa.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        let cambio = servidos.iter().any(|ruta| fecha_de(ruta) > desde);
        responder(
            &mut conexion,
            "200 OK",
            "text/plain",
            if cambio { b"1" } else { b"0" },
            cabeza,
        );
        return;
    }

    let Some(mut ruta) = ruta_local(&servidor.raiz, url.path()) else {
        responder(&mut conexion, "400 Bad Request", "text/plain", b"", cabeza);
        return;
    };
    if ruta.is_dir() {
        ruta.push("index.html");
    }
    let Ok(mut contenido) = fs::read(&ruta) else {
        let camino = url
            .path()
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;");
        let pagina = format!("<h1>404</h1><p>No existe {camino}</p>");
        responder(
            &mut conexion,
            "404 Not Found",
            "text/html; charset=utf-8",
            pagina.as_bytes(),
            cabeza,
        );
        return;
    };
    if let Ok(mut servidos) = servidor.servidos.lock() {
        servidos.insert(ruta.clone(), fecha_de(&ruta));
    }
    let tipo = tipo_mime(&ruta);
    if tipo.starts_with("text/html") {
        let texto = String::from_utf8_lossy(&contenido);
        let con_recarga = match texto.rfind("</body>") {
            Some(posicion) => format!("{}{RECARGA}{}", &texto[..posicion], &texto[posicion..]),
            None => format!("{texto}{RECARGA}"),
        };
        contenido = con_recarga.into_bytes();
    }
    responder(&mut conexion, "200 OK", tipo, &contenido, cabeza);
}

fn iniciar(raiz: PathBuf) -> Result<Arc<Servidor>, String> {
    let escucha = TcpListener::bind(("127.0.0.1", 0)).map_err(|error| error.to_string())?;
    let puerto = escucha
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let mut bytes = [0u8; 18];
    getrandom::fill(&mut bytes).map_err(|error| error.to_string())?;
    let servidor = Arc::new(Servidor {
        raiz,
        puerto,
        clave: URL_SAFE_NO_PAD.encode(bytes),
        servidos: Mutex::new(HashMap::new()),
    });
    let propio = Arc::clone(&servidor);
    thread::spawn(move || {
        for conexion in escucha.incoming().flatten() {
            let servidor = Arc::clone(&propio);
            thread::spawn(move || atender(&servidor, conexion));
        }
    });
    Ok(servidor)
}

#[tauri::command]
pub async fn servir_html(ruta: String) -> Result<String, String> {
    spawn_blocking(move || {
        let html = PathBuf::from(&ruta);
        if !html.is_file() {
            return Err("El archivo no existe".to_string());
        }
        let raiz = raiz_del_proyecto(&html);
        let servidor = {
            let mut mapa = servidores().lock().map_err(|error| error.to_string())?;
            match mapa.get(&raiz) {
                Some(servidor) => Arc::clone(servidor),
                None => {
                    let nuevo = iniciar(raiz.clone())?;
                    mapa.insert(raiz.clone(), Arc::clone(&nuevo));
                    nuevo
                }
            }
        };
        let relativa = html
            .strip_prefix(&servidor.raiz)
            .map_err(|_| "El HTML está fuera del proyecto".to_string())?;
        let mut url = Url::parse(&format!("http://127.0.0.1:{}/", servidor.puerto))
            .map_err(|error| error.to_string())?;
        url.path_segments_mut()
            .map_err(|_| "Dirección inválida".to_string())?
            .pop_if_empty()
            .extend(
                relativa
                    .components()
                    .map(|parte| parte.as_os_str().to_string_lossy().into_owned()),
            );
        url.query_pairs_mut().append_pair("mahzz", &servidor.clave);
        Ok(url.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn no_deja_salir_de_la_raiz() {
        let raiz = Path::new("C:\\proyecto");
        assert_eq!(
            ruta_local(raiz, "/css/estilos.css"),
            Some(raiz.join("css").join("estilos.css"))
        );
        assert_eq!(
            ruta_local(raiz, "/mis%20fotos/a.png"),
            Some(raiz.join("mis fotos").join("a.png"))
        );
        assert_eq!(ruta_local(raiz, "/../secreto.txt"), None);
        assert_eq!(ruta_local(raiz, "/%2e%2e/secreto.txt"), None);
        assert_eq!(ruta_local(raiz, "/a%5C..%5Cb"), None);
        assert_eq!(ruta_local(raiz, "/C:%5Cwindows"), None);
        assert_eq!(ruta_local(raiz, "/.env"), None);
        assert_eq!(ruta_local(raiz, "/.git/config"), None);
        assert_eq!(ruta_local(raiz, "/sub/.oculta/clave.txt"), None);
    }
}
