use std::{fs, path::Path, slice};

use serde_json::{json, Value};
use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_notification::NotificationExt;
use windows::{
    core::{w, HSTRING, PCWSTR},
    Win32::{
        Foundation::{LocalFree, HLOCAL},
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
        UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
    },
};

use crate::datos::{carpeta_datos, escribir_seguro};

#[tauri::command]
pub fn leer_config(app: AppHandle) -> Result<Value, String> {
    let ruta = carpeta_datos(&app)?.join("config.toml");
    let Ok(texto) = fs::read_to_string(ruta) else {
        return Ok(json!({}));
    };
    // Si el archivo se editó mal a mano, la app arranca con los valores por defecto.
    Ok(toml::from_str(&texto).unwrap_or_else(|_| json!({})))
}

#[tauri::command]
pub fn escribir_config(app: AppHandle, config: Value) -> Result<(), String> {
    let ruta = carpeta_datos(&app)?.join("config.toml");
    let texto = toml::to_string_pretty(&config).map_err(|error| error.to_string())?;
    escribir_seguro(&ruta, &texto)
}

fn nombre_seguro(id: &str) -> Result<String, String> {
    let limpio: String = id
        .chars()
        .filter(|caracter| caracter.is_alphanumeric() || *caracter == '-' || *caracter == '_')
        .collect();
    if limpio.is_empty() {
        return Err("Nombre de tema inválido".to_string());
    }
    Ok(format!("{limpio}.json"))
}

#[tauri::command]
pub fn leer_temas(app: AppHandle) -> Result<Vec<Value>, String> {
    let Ok(archivos) = fs::read_dir(carpeta_datos(&app)?.join("temas")) else {
        return Ok(Vec::new());
    };
    Ok(archivos
        .flatten()
        .filter(|archivo| archivo.path().extension().is_some_and(|extension| extension == "json"))
        .filter_map(|archivo| fs::read_to_string(archivo.path()).ok())
        .filter_map(|texto| serde_json::from_str(&texto).ok())
        .collect())
}

#[tauri::command]
pub fn guardar_tema(app: AppHandle, id: String, tema: Value) -> Result<(), String> {
    let carpeta = carpeta_datos(&app)?.join("temas");
    fs::create_dir_all(&carpeta).map_err(|error| error.to_string())?;
    let texto = serde_json::to_string_pretty(&tema).map_err(|error| error.to_string())?;
    escribir_seguro(&carpeta.join(nombre_seguro(&id)?), &texto)
}

#[tauri::command]
pub fn borrar_tema(app: AppHandle, id: String) -> Result<(), String> {
    let ruta = carpeta_datos(&app)?.join("temas").join(nombre_seguro(&id)?);
    fs::remove_file(ruta).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn leer_sesion(app: AppHandle) -> Result<Value, String> {
    let ruta = carpeta_datos(&app)?.join("sesion.json");
    Ok(fs::read_to_string(ruta)
        .ok()
        .and_then(|texto| serde_json::from_str(&texto).ok())
        .unwrap_or(Value::Null))
}

#[tauri::command]
pub fn guardar_sesion(app: AppHandle, sesion: Value) -> Result<(), String> {
    let ruta = carpeta_datos(&app)?.join("sesion.json");
    escribir_seguro(&ruta, &sesion.to_string())?;
    crate::sesiones::guardar_en_historial(&app, &sesion)
}

// Cifra con el usuario de Windows: copiado a otra PC o a otra cuenta no se puede leer.
pub(crate) fn cifrar(datos: &[u8], proteger: bool) -> Result<Vec<u8>, String> {
    let entrada = CRYPT_INTEGER_BLOB {
        cbData: datos.len() as u32,
        pbData: datos.as_ptr() as *mut u8,
    };
    let mut salida = CRYPT_INTEGER_BLOB::default();
    unsafe {
        if proteger {
            CryptProtectData(&entrada, PCWSTR::null(), None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut salida)
        } else {
            CryptUnprotectData(&entrada, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut salida)
        }
        .map_err(|error| error.to_string())?;
        let resultado = slice::from_raw_parts(salida.pbData, salida.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(salida.pbData as *mut _)));
        Ok(resultado)
    }
}

fn leer_baul(app: &AppHandle) -> Result<Vec<Value>, String> {
    let ruta = carpeta_datos(app)?.join("secretos.dat");
    let Ok(cifrado) = fs::read(ruta) else {
        return Ok(Vec::new());
    };
    serde_json::from_slice(&cifrar(&cifrado, false)?).map_err(|error| error.to_string())
}

fn escribir_baul(app: &AppHandle, baul: &[Value]) -> Result<(), String> {
    let ruta = carpeta_datos(app)?.join("secretos.dat");
    let texto = serde_json::to_vec(baul).map_err(|error| error.to_string())?;
    fs::write(ruta, cifrar(&texto, true)?).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn listar_secretos(app: AppHandle) -> Result<Vec<Value>, String> {
    Ok(leer_baul(&app)?
        .iter()
        .map(|secreto| json!({ "id": secreto["id"], "nombre": secreto["nombre"] }))
        .collect())
}

#[tauri::command]
pub fn guardar_secreto(app: AppHandle, id: String, nombre: String, valor: String) -> Result<(), String> {
    let mut baul = leer_baul(&app)?;
    baul.retain(|secreto| secreto["id"] != id.as_str());
    baul.push(json!({ "id": id, "nombre": nombre, "valor": valor }));
    escribir_baul(&app, &baul)
}

#[tauri::command]
pub fn revelar_secreto(app: AppHandle, id: String) -> Result<Option<String>, String> {
    Ok(leer_baul(&app)?
        .iter()
        .find(|secreto| secreto["id"] == id.as_str())
        .and_then(|secreto| secreto["valor"].as_str().map(str::to_string)))
}

#[tauri::command]
pub fn borrar_secreto(app: AppHandle, id: String) -> Result<(), String> {
    let mut baul = leer_baul(&app)?;
    baul.retain(|secreto| secreto["id"] != id.as_str());
    escribir_baul(&app, &baul)
}

// Solo abre páginas web o archivos que existen, nunca comandos arbitrarios.
#[tauri::command]
pub fn abrir_externo(destino: String) -> Result<(), String> {
    let es_web = destino.starts_with("https://") || destino.starts_with("http://");
    if !es_web && !Path::new(&destino).exists() {
        return Err("El archivo ya no existe".to_string());
    }
    let resultado = unsafe {
        ShellExecuteW(None, w!("open"), &HSTRING::from(destino), None, None, SW_SHOWNORMAL)
    };
    if resultado.0 as isize > 32 {
        Ok(())
    } else {
        Err("Windows no pudo abrirlo".to_string())
    }
}

#[tauri::command]
pub fn avisar_comando(app: AppHandle, titulo: String, cuerpo: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(titulo)
        .body(cuerpo)
        .show()
        .map_err(|error| error.to_string())
}

// Muestra u oculta la ventana principal como un panel que baja desde arriba.
fn alternar_desplegable(app: &AppHandle) {
    let Some(ventana) = app.get_webview_window("main") else {
        return;
    };
    let visible = ventana.is_visible().unwrap_or(false) && ventana.is_focused().unwrap_or(false);
    if visible {
        let _ = ventana.hide();
        return;
    }
    if let Ok(Some(monitor)) = ventana.current_monitor() {
        let escala = monitor.scale_factor();
        let tamano = monitor.size().to_logical::<f64>(escala);
        let _ = ventana.set_size(LogicalSize::new(tamano.width, tamano.height * 0.55));
        let posicion = monitor.position();
        let _ = ventana.set_position(PhysicalPosition::new(posicion.x, posicion.y));
    }
    let _ = ventana.show();
    let _ = ventana.set_focus();
}

#[tauri::command]
pub fn definir_desplegable(app: AppHandle, activo: bool, atajo: String) -> Result<(), String> {
    let atajos = app.global_shortcut();
    atajos.unregister_all().map_err(|error| error.to_string())?;
    if !activo {
        return Ok(());
    }
    atajos
        .on_shortcut(atajo.as_str(), |app, _, evento| {
            if evento.state == ShortcutState::Pressed {
                alternar_desplegable(app);
            }
        })
        .map_err(|error| error.to_string())
}
