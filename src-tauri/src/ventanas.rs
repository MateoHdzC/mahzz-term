use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU32, Ordering},
        Mutex,
    },
};

use serde_json::Value;
use tauri::{AppHandle, LogicalPosition, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window};
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
use windows::core::Interface;

// Guarda la pestaña que está viajando hasta que su ventana nueva la reclame.
#[derive(Default)]
pub struct Traspasos {
    pendientes: Mutex<HashMap<String, Value>>,
    ultima_ventana: AtomicU32,
}

// Sin esto, teclas como F5 o Ctrl+R recargarían la app en vez de llegar a la terminal.
pub fn preparar_webview(ventana: &WebviewWindow) -> tauri::Result<()> {
    ventana.with_webview(|webview| unsafe {
        let Ok(nucleo) = webview.controller().CoreWebView2() else {
            return;
        };
        let Ok(ajustes) = nucleo.Settings() else {
            return;
        };
        if let Ok(ajustes) = ajustes.cast::<ICoreWebView2Settings3>() {
            let _ = ajustes.SetAreBrowserAcceleratorKeysEnabled(false);
        }
    })
}

// Se crea en un comando async porque en Windows hacerlo en uno síncrono congela la app.
#[tauri::command]
pub async fn abrir_ventana(
    app: AppHandle,
    traspaso: Option<Value>,
    x: Option<f64>,
    y: Option<f64>,
    traspasos: State<'_, Traspasos>,
) -> Result<(), String> {
    let numero = traspasos.ultima_ventana.fetch_add(1, Ordering::Relaxed) + 1;
    let etiqueta = format!("ventana-{numero}");

    if let Some(datos) = traspaso {
        traspasos
            .pendientes
            .lock()
            .map_err(|error| error.to_string())?
            .insert(etiqueta.clone(), datos);
    }

    let constructor = WebviewWindowBuilder::new(&app, &etiqueta, WebviewUrl::App("index.html".into()))
        .title("MazzTerm")
        .inner_size(1100.0, 700.0)
        .min_inner_size(520.0, 320.0)
        .decorations(false)
        .visible(false)
        .transparent(true)
        .shadow(false);

    let ventana = constructor.build().map_err(|error| error.to_string())?;
    match (x, y) {
        (Some(x), Some(y)) => ventana
            .set_position(LogicalPosition::new(x, y))
            .map_err(|error| error.to_string())?,
        _ => ventana.center().map_err(|error| error.to_string())?,
    }
    preparar_webview(&ventana).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn tomar_traspaso(
    ventana: Window,
    traspasos: State<'_, Traspasos>,
) -> Result<Option<Value>, String> {
    Ok(traspasos
        .pendientes
        .lock()
        .map_err(|error| error.to_string())?
        .remove(ventana.label()))
}
