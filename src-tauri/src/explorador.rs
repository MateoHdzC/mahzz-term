// Leer, guardar y organizar archivos desde el panel de archivos y el visor.
use std::{
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use serde_json::{json, Value};
use tauri::{async_runtime::spawn_blocking, ipc::Response, AppHandle, Manager};
use windows::{
    core::PCWSTR,
    Win32::UI::Shell::{
        SHFileOperationW, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT, FO_DELETE,
        SHFILEOPSTRUCTW,
    },
};

const MAXIMO_TEXTO: u64 = 8 * 1024 * 1024;
const MAXIMO_BINARIO: u64 = 200 * 1024 * 1024;
const CARACTERES_PROHIBIDOS: &[char] = &['\\', '/', ':', '*', '?', '"', '<', '>', '|'];

fn texto_error(error: impl ToString) -> String {
    error.to_string()
}

fn fecha_de(ruta: &Path) -> u64 {
    fs::metadata(ruta)
        .and_then(|datos| datos.modified())
        .ok()
        .and_then(|fecha| fecha.duration_since(UNIX_EPOCH).ok())
        .map(|duracion| duracion.as_millis() as u64)
        .unwrap_or(0)
}

// Un nombre de archivo de Windows: sin barras, sin caracteres reservados y sin ser "." o "..".
fn nombre_valido(nombre: &str) -> Result<&str, String> {
    let nombre = nombre.trim();
    if nombre.is_empty() || nombre == "." || nombre == ".." || nombre.ends_with('.') {
        return Err("Nombre inválido".to_string());
    }
    if nombre.contains(CARACTERES_PROHIBIDOS) || nombre.chars().any(char::is_control) {
        return Err("El nombre no puede tener \\ / : * ? \" < > |".to_string());
    }
    Ok(nombre)
}

#[tauri::command]
pub async fn leer_texto(ruta: String) -> Result<Value, String> {
    spawn_blocking(move || {
        let ruta = PathBuf::from(ruta);
        let tamano = fs::metadata(&ruta).map_err(texto_error)?.len();
        if tamano > MAXIMO_TEXTO {
            return Ok(json!({ "grande": true, "tamano": tamano }));
        }
        let bytes = fs::read(&ruta).map_err(texto_error)?;
        // Un byte nulo en el principio casi siempre indica un archivo binario.
        if bytes.iter().take(8000).any(|byte| *byte == 0) {
            return Ok(json!({ "binario": true, "tamano": tamano }));
        }
        let bom = bytes.starts_with(&[0xEF, 0xBB, 0xBF]);
        let texto = String::from_utf8_lossy(if bom { &bytes[3..] } else { &bytes }).into_owned();
        Ok(json!({
            "texto": texto,
            "crlf": texto.contains("\r\n"),
            "bom": bom,
            "fecha": fecha_de(&ruta),
            "tamano": tamano,
        }))
    })
    .await
    .map_err(texto_error)?
}

// Guarda con los mismos finales de línea y la misma marca BOM que tenía el archivo.
// Si alguien lo cambió afuera desde que se abrió, avisa en vez de pisarlo (salvo que se fuerce).
#[tauri::command]
pub async fn guardar_texto(
    ruta: String,
    texto: String,
    crlf: bool,
    bom: bool,
    fecha: u64,
    forzar: bool,
) -> Result<u64, String> {
    spawn_blocking(move || {
        let ruta = PathBuf::from(ruta);
        let actual = fecha_de(&ruta);
        if !forzar && fecha != 0 && actual != 0 && actual != fecha {
            return Err("CAMBIADO_AFUERA".to_string());
        }
        let normalizado = texto.replace("\r\n", "\n");
        let contenido = if crlf { normalizado.replace('\n', "\r\n") } else { normalizado };
        let mut bytes = Vec::with_capacity(contenido.len() + 3);
        if bom {
            bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
        }
        bytes.extend_from_slice(contenido.as_bytes());
        let temporal = ruta.with_extension("mahzz-guardando");
        fs::write(&temporal, &bytes).map_err(texto_error)?;
        fs::rename(&temporal, &ruta).map_err(|error| {
            let _ = fs::remove_file(&temporal);
            error.to_string()
        })?;
        Ok(fecha_de(&ruta))
    })
    .await
    .map_err(texto_error)?
}

#[tauri::command]
pub fn fecha_archivo(ruta: String) -> u64 {
    fecha_de(Path::new(&ruta))
}

// Los bytes viajan sin convertir a base64: la interfaz los recibe como ArrayBuffer.
#[tauri::command]
pub async fn leer_binario(ruta: String) -> Result<Response, String> {
    spawn_blocking(move || {
        let tamano = fs::metadata(&ruta).map_err(texto_error)?.len();
        if tamano > MAXIMO_BINARIO {
            return Err("Archivo demasiado grande".to_string());
        }
        fs::read(&ruta).map(Response::new).map_err(texto_error)
    })
    .await
    .map_err(texto_error)?
}

// La vista web de un HTML necesita leer su CSS, JS e imágenes con rutas relativas.
// Se habilita solo la carpeta de ese HTML (o el archivo solo, si está en la raíz de un disco).
#[tauri::command]
pub fn permitir_vista_html(app: AppHandle, ruta: String) -> Result<(), String> {
    let archivo = Path::new(&ruta);
    let alcance = app.asset_protocol_scope();
    match archivo.parent() {
        Some(carpeta) if carpeta.parent().is_some() => alcance.allow_directory(carpeta, true),
        _ => alcance.allow_file(archivo),
    }
    .map_err(texto_error)
}

#[tauri::command]
pub fn crear_archivo(carpeta: String, nombre: String) -> Result<String, String> {
    let ruta = Path::new(&carpeta).join(nombre_valido(&nombre)?);
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&ruta)
        .map_err(|error| if error.kind() == std::io::ErrorKind::AlreadyExists { "Ya existe".to_string() } else { error.to_string() })?;
    Ok(ruta.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn crear_carpeta(carpeta: String, nombre: String) -> Result<String, String> {
    let ruta = Path::new(&carpeta).join(nombre_valido(&nombre)?);
    if ruta.exists() {
        return Err("Ya existe".to_string());
    }
    fs::create_dir(&ruta).map_err(texto_error)?;
    Ok(ruta.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn renombrar_ruta(ruta: String, nombre: String) -> Result<String, String> {
    let origen = PathBuf::from(&ruta);
    let padre = origen.parent().ok_or("Ruta inválida")?;
    let destino = padre.join(nombre_valido(&nombre)?);
    // Cambiar solo mayúsculas en Windows es el mismo archivo: se permite.
    let mismo = destino.to_string_lossy().to_lowercase() == origen.to_string_lossy().to_lowercase();
    if destino.exists() && !mismo {
        return Err("Ya existe un archivo con ese nombre".to_string());
    }
    fs::rename(&origen, &destino).map_err(texto_error)?;
    Ok(destino.to_string_lossy().into_owned())
}

// "archivo.txt" → "archivo - copia.txt", "archivo - copia 2.txt"…
fn nombre_libre(carpeta: &Path, nombre: &str) -> PathBuf {
    let candidato = carpeta.join(nombre);
    if !candidato.exists() {
        return candidato;
    }
    let (base, extension) = match nombre.rfind('.') {
        Some(punto) if punto > 0 => (&nombre[..punto], &nombre[punto..]),
        _ => (nombre, ""),
    };
    (1..)
        .map(|numero| {
            let sufijo = if numero == 1 { " - copia".to_string() } else { format!(" - copia {numero}") };
            carpeta.join(format!("{base}{sufijo}{extension}"))
        })
        .find(|ruta| !ruta.exists())
        .expect("siempre hay un nombre libre")
}

fn copiar_recursivo(origen: &Path, destino: &Path) -> std::io::Result<()> {
    if origen.is_dir() {
        fs::create_dir_all(destino)?;
        for entrada in fs::read_dir(origen)? {
            let entrada = entrada?;
            copiar_recursivo(&entrada.path(), &destino.join(entrada.file_name()))?;
        }
        Ok(())
    } else {
        fs::copy(origen, destino).map(|_| ())
    }
}

fn dentro_de(ruta: &Path, carpeta: &Path) -> bool {
    let ruta = ruta.to_string_lossy().to_lowercase();
    let carpeta = carpeta.to_string_lossy().to_lowercase();
    ruta == carpeta || ruta.starts_with(&format!("{}\\", carpeta.trim_end_matches('\\')))
}

// Mueve o copia varias rutas a una carpeta. Devuelve los pares [vieja, nueva].
#[tauri::command]
pub async fn mover_rutas(rutas: Vec<String>, destino: String, copiar: bool) -> Result<Vec<(String, String)>, String> {
    spawn_blocking(move || {
        let carpeta = PathBuf::from(&destino);
        if !carpeta.is_dir() {
            return Err("El destino no es una carpeta".to_string());
        }
        let mut hechos = Vec::new();
        for ruta in rutas {
            let origen = PathBuf::from(&ruta);
            let nombre = origen.file_name().ok_or("Ruta inválida")?.to_string_lossy().into_owned();
            if origen.is_dir() && dentro_de(&carpeta, &origen) {
                return Err(format!("No se puede poner \"{nombre}\" dentro de sí misma"));
            }
            let mismo_lugar = origen.parent().is_some_and(|padre| dentro_de(padre, &carpeta) && dentro_de(&carpeta, padre));
            if copiar {
                let nueva = nombre_libre(&carpeta, &nombre);
                copiar_recursivo(&origen, &nueva).map_err(texto_error)?;
                hechos.push((ruta, nueva.to_string_lossy().into_owned()));
                continue;
            }
            if mismo_lugar {
                continue;
            }
            let nueva = carpeta.join(&nombre);
            if nueva.exists() {
                return Err(format!("Ya existe \"{nombre}\" en el destino"));
            }
            // Entre discos distintos rename falla: se copia y después se borra el original.
            if fs::rename(&origen, &nueva).is_err() {
                copiar_recursivo(&origen, &nueva).map_err(texto_error)?;
                if origen.is_dir() { fs::remove_dir_all(&origen) } else { fs::remove_file(&origen) }.map_err(texto_error)?;
            }
            hechos.push((ruta, nueva.to_string_lossy().into_owned()));
        }
        Ok(hechos)
    })
    .await
    .map_err(texto_error)?
}

// Manda a la papelera de Windows, así se puede recuperar.
#[tauri::command]
pub async fn enviar_papelera(rutas: Vec<String>) -> Result<(), String> {
    spawn_blocking(move || {
        // SHFileOperation espera las rutas separadas por \0 y la lista terminada en \0\0.
        let mut lista: Vec<u16> = Vec::new();
        for ruta in &rutas {
            if !Path::new(ruta).is_absolute() {
                return Err("Ruta inválida".to_string());
            }
            lista.extend(ruta.encode_utf16());
            lista.push(0);
        }
        lista.push(0);
        let mut operacion = SHFILEOPSTRUCTW {
            wFunc: FO_DELETE,
            pFrom: PCWSTR(lista.as_ptr()),
            fFlags: (FOF_ALLOWUNDO.0 | FOF_NOCONFIRMATION.0 | FOF_SILENT.0 | FOF_NOERRORUI.0) as u16,
            ..Default::default()
        };
        let codigo = unsafe { SHFileOperationW(&mut operacion) };
        if codigo != 0 || operacion.fAnyOperationsAborted.as_bool() {
            Err(format!("Windows no pudo mandarlo a la papelera (código {codigo})"))
        } else {
            Ok(())
        }
    })
    .await
    .map_err(texto_error)?
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn valida_nombres() {
        assert!(nombre_valido("notas.md").is_ok());
        assert!(nombre_valido("a/b").is_err());
        assert!(nombre_valido("..").is_err());
        assert!(nombre_valido("raro?.txt").is_err());
    }

    #[test]
    fn busca_nombre_libre_al_copiar() {
        let base = std::env::temp_dir().join(format!("mazz-libre-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        fs::write(base.join("a.txt"), "").unwrap();
        assert_eq!(nombre_libre(&base, "a.txt").file_name().unwrap(), "a - copia.txt");
        fs::write(base.join("a - copia.txt"), "").unwrap();
        assert_eq!(nombre_libre(&base, "a.txt").file_name().unwrap(), "a - copia 2.txt");
        assert!(dentro_de(&base.join("x"), &base));
        let _ = fs::remove_dir_all(&base);
    }
}
