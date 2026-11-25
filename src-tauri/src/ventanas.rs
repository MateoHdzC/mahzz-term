use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU32, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use serde_json::Value;
use tauri::{
    async_runtime::spawn_blocking, AppHandle, LogicalPosition, Manager, State, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, Window,
};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Settings3, ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
};
use windows::core::Interface;

// Opciones de WebView2 para gastar menos RAM. Todas las ventanas tienen que usar las mismas,
// porque comparten el mismo proceso del navegador. Medido con una pestaña: unos 25 MB menos.
// - La red y la GPU corren dentro del proceso principal en vez de en procesos aparte.
// - El heap joven de JavaScript es chico: la interfaz usa unos 4 MB de JS.
// Las tres primeras desactivaciones son las que Tauri pone por defecto.
// Tiene que coincidir con additionalBrowserArgs de tauri.conf.json.
pub const ARGUMENTOS_NAVEGADOR: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --enable-features=NetworkServiceInProcess2 --in-process-gpu --js-flags=--max-semi-space-size=1";

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

// Con la ventana minimizada, oculta o sin usar, WebView2 libera cachés y comprime memoria.
// Al volver se pone en normal y la interfaz sigue igual: no pierde estado.
#[tauri::command]
pub fn definir_memoria_baja(ventana: WebviewWindow, baja: bool) -> Result<(), String> {
    ventana
        .with_webview(move |webview| unsafe {
            let Ok(nucleo) = webview.controller().CoreWebView2() else {
                return;
            };
            if let Ok(nucleo) = nucleo.cast::<ICoreWebView2_19>() {
                let nivel = if baja {
                    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
                } else {
                    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
                };
                let _ = nucleo.SetMemoryUsageTargetLevel(nivel);
            }
        })
        .map_err(|error| error.to_string())
}

// Se crea en un comando async porque en Windows hacerlo en uno síncrono congela la app.
#[tauri::command]
pub async fn abrir_ventana(
    app: AppHandle,
    traspaso: Option<Value>,
    x: Option<f64>,
    y: Option<f64>,
    traspasos: State<'_, Traspasos>,
) -> Result<String, String> {
    let numero = traspasos.ultima_ventana.fetch_add(1, Ordering::Relaxed) + 1;
    let etiqueta = format!("ventana-{numero}");

    if let Some(datos) = traspaso {
        traspasos
            .pendientes
            .lock()
            .map_err(|error| error.to_string())?
            .insert(etiqueta.clone(), datos);
    }

    let constructor =
        WebviewWindowBuilder::new(&app, &etiqueta, WebviewUrl::App("index.html".into()))
            .title("MahzzTerm")
            .inner_size(1100.0, 700.0)
            .min_inner_size(520.0, 320.0)
            .decorations(false)
            .visible(false)
            .transparent(true)
            .shadow(false)
            .additional_browser_args(ARGUMENTOS_NAVEGADOR)
            .disable_drag_drop_handler();

    let ventana = constructor.build().map_err(|error| error.to_string())?;
    match (x, y) {
        (Some(x), Some(y)) => ventana
            .set_position(LogicalPosition::new(x, y))
            .map_err(|error| error.to_string())?,
        _ => ventana.center().map_err(|error| error.to_string())?,
    }
    preparar_webview(&ventana).map_err(|error| error.to_string())?;
    Ok(etiqueta)
}

// La ventana de origen espera a que la nueva tome la pestaña antes de soltarla. Si no la toma a
// tiempo (tardó o falló al arrancar), se cancela el traspaso, se cierra la ventana nueva y la
// pestaña vuelve a la de origen: nunca queda en el aire.
#[tauri::command]
pub async fn esperar_traspaso(
    app: AppHandle,
    etiqueta: String,
    segundos: u64,
) -> Result<bool, String> {
    spawn_blocking(move || {
        let traspasos = app.state::<Traspasos>();
        let limite = Instant::now() + Duration::from_secs(segundos);
        loop {
            let pendiente = traspasos
                .pendientes
                .lock()
                .map_err(|error| error.to_string())?
                .contains_key(&etiqueta);
            if !pendiente {
                return Ok(true);
            }
            if Instant::now() >= limite {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
        let cancelado = traspasos
            .pendientes
            .lock()
            .map_err(|error| error.to_string())?
            .remove(&etiqueta)
            .is_some();
        if cancelado {
            if let Some(ventana) = app.get_webview_window(&etiqueta) {
                let _ = ventana.destroy();
            }
        }
        Ok(!cancelado)
    })
    .await
    .map_err(|error| error.to_string())?
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
