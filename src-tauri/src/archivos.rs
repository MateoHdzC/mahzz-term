use std::fs;

use tauri::WebviewWindow;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn elegir_carpeta(
    ventana: WebviewWindow,
    inicial: Option<String>,
) -> Result<Option<String>, String> {
    let mut dialogo = ventana.dialog().file().set_parent(&ventana);
    if let Some(inicial) = inicial {
        dialogo = dialogo.set_directory(inicial);
    }
    let Some(eleccion) = dialogo.blocking_pick_folder() else {
        return Ok(None);
    };
    let ruta = eleccion.into_path().map_err(|error| error.to_string())?;
    Ok(Some(ruta.display().to_string()))
}

// Pregunta dónde guardar y escribe el archivo. Devuelve None si la persona cancela.
#[tauri::command]
pub async fn guardar_salida(
    ventana: WebviewWindow,
    nombre: String,
    contenido: String,
) -> Result<Option<String>, String> {
    let eleccion = ventana
        .dialog()
        .file()
        .set_parent(&ventana)
        .set_file_name(&nombre)
        .add_filter("Texto", &["txt", "log"])
        .blocking_save_file();

    let Some(eleccion) = eleccion else {
        return Ok(None);
    };
    let ruta = eleccion.into_path().map_err(|error| error.to_string())?;
    fs::write(&ruta, contenido).map_err(|error| error.to_string())?;
    Ok(Some(ruta.display().to_string()))
}
