use std::{fs, path::PathBuf};

use serde_json::Value;
use tauri::AppHandle;

use crate::datos::{carpeta_datos, escribir_seguro};

// Cuántas sesiones viejas se guardan para poder reanudarlas con `mahzz --resume`.
const MAXIMO_SESIONES: usize = 30;

fn carpeta_sesiones(app: &AppHandle) -> Result<PathBuf, String> {
    let carpeta = carpeta_datos(app)?.join("sesiones");
    fs::create_dir_all(&carpeta).map_err(|error| error.to_string())?;
    Ok(carpeta)
}

// El id es la hora de inicio de la ventana en milisegundos: solo se aceptan dígitos.
fn id_valido(sesion: &Value) -> Option<String> {
    let id = sesion.get("id")?.as_str()?;
    (!id.is_empty() && id.len() <= 20 && id.chars().all(|caracter| caracter.is_ascii_digit()))
        .then(|| id.to_string())
}

// Cada ventana principal tiene su archivo, que se va pisando mientras está abierta.
pub fn guardar_en_historial(app: &AppHandle, sesion: &Value) -> Result<(), String> {
    let Some(id) = id_valido(sesion) else {
        return Ok(());
    };
    let carpeta = carpeta_sesiones(app)?;
    escribir_seguro(&carpeta.join(format!("{id}.json")), &sesion.to_string())?;
    podar(&carpeta);
    Ok(())
}

fn ids_guardados(carpeta: &PathBuf) -> Vec<(u128, PathBuf)> {
    let Ok(entradas) = fs::read_dir(carpeta) else {
        return Vec::new();
    };
    let mut ids: Vec<(u128, PathBuf)> = entradas
        .flatten()
        .filter_map(|entrada| {
            let ruta = entrada.path();
            if ruta.extension()? != "json" {
                return None;
            }
            let numero = ruta.file_stem()?.to_str()?.parse::<u128>().ok()?;
            Some((numero, ruta))
        })
        .collect();
    // Las más nuevas primero.
    ids.sort_by(|a, b| b.0.cmp(&a.0));
    ids
}

fn podar(carpeta: &PathBuf) {
    for (_, ruta) in ids_guardados(carpeta).into_iter().skip(MAXIMO_SESIONES) {
        let _ = fs::remove_file(ruta);
    }
}

#[tauri::command]
pub fn listar_sesiones(app: AppHandle) -> Result<Vec<Value>, String> {
    let carpeta = carpeta_sesiones(&app)?;
    Ok(ids_guardados(&carpeta)
        .into_iter()
        .filter_map(|(_, ruta)| {
            let texto = fs::read_to_string(ruta).ok()?;
            let sesion: Value = serde_json::from_str(&texto).ok()?;
            let tiene_pestanas = sesion
                .get("pestanas")?
                .as_array()
                .is_some_and(|lista| !lista.is_empty());
            tiene_pestanas.then_some(sesion)
        })
        .collect())
}

#[tauri::command]
pub fn borrar_sesion_guardada(app: AppHandle, id: String) -> Result<(), String> {
    if id.is_empty() || !id.chars().all(|caracter| caracter.is_ascii_digit()) {
        return Err("id inválido".to_string());
    }
    let ruta = carpeta_sesiones(&app)?.join(format!("{id}.json"));
    fs::remove_file(ruta).map_err(|error| error.to_string())
}
