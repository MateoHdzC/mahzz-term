mod ajustes;
mod archivos;
mod cambios;
mod control;
mod datos;
mod entorno;
mod explorador;
mod google;
mod mcp;
mod procesos;
mod pty;
mod servidor;
mod sesiones;
mod ventanas;

use datos::Historial;
use entorno::Versiones;
use google::TokenGoogle;
use pty::Sesiones;
use tauri::{Manager, WindowEvent};
use ventanas::Traspasos;

pub fn correr_mcp() {
    mcp::correr();
}

pub fn iniciar() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(Sesiones::default())
        .manage(Traspasos::default())
        .manage(Versiones::default())
        .manage(Historial::default())
        .manage(TokenGoogle::default())
        .manage(control::Control::default())
        .setup(|app| {
            if let Some(ventana) = app.get_webview_window("main") {
                ventanas::preparar_webview(&ventana)?;
            }
            if let Err(error) = control::iniciar(app.handle().clone()) {
                eprintln!("No se pudo iniciar el control por IA: {error}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ajustes::abrir_externo,
            ajustes::avisar_comando,
            ajustes::borrar_secreto,
            ajustes::borrar_tema,
            ajustes::definir_desplegable,
            ajustes::escribir_config,
            ajustes::guardar_secreto,
            ajustes::guardar_sesion,
            ajustes::guardar_tema,
            ajustes::leer_config,
            ajustes::leer_sesion,
            ajustes::leer_temas,
            ajustes::listar_secretos,
            ajustes::revelar_secreto,
            archivos::elegir_carpeta,
            archivos::guardar_salida,
            cambios::aceptar_cambio,
            cambios::diff_cambio,
            cambios::listar_cambios,
            cambios::revertir_cambio,
            control::responder_control,
            control::ruta_ejecutable,
            datos::agregar_historial,
            datos::escribir_guardados,
            datos::fusionar_historial,
            datos::leer_guardados,
            datos::leer_historial,
            datos::leer_specs_usuario,
            explorador::crear_archivo,
            explorador::crear_carpeta,
            explorador::enviar_papelera,
            explorador::fecha_archivo,
            explorador::guardar_texto,
            explorador::leer_binario,
            explorador::leer_texto,
            explorador::mover_rutas,
            explorador::renombrar_ruta,
            entorno::carpeta_usuario,
            entorno::comandos_powershell,
            entorno::datos_proyecto,
            entorno::detectar_proyecto,
            entorno::estado_git,
            entorno::existen_comandos,
            entorno::hosts_ssh,
            entorno::listar_carpeta,
            entorno::listar_ejecutables,
            entorno::listar_rutas,
            entorno::parametros_cmdlet,
            google::bajar_sincronizacion,
            google::cerrar_sesion_google,
            google::cuenta_google,
            google::google_configurado,
            google::iniciar_sesion_google,
            google::subir_sincronizacion,
            pty::crear_sesion,
            pty::escribir_sesion,
            pty::redimensionar_sesion,
            pty::cerrar_sesion,
            pty::pausar_sesion,
            pty::adjuntar_sesion,
            pty::programas_sesiones,
            servidor::servir_html,
            sesiones::borrar_sesion_guardada,
            sesiones::listar_sesiones,
            ventanas::abrir_ventana,
            ventanas::definir_memoria_baja,
            ventanas::tomar_traspaso,
        ])
        .on_window_event(|ventana, evento| {
            if matches!(evento, WindowEvent::Destroyed) {
                ventana.state::<Sesiones>().cerrar_de_ventana(ventana.label());
            }
        })
        .run(tauri::generate_context!())
        .expect("no se pudo iniciar mahzzterm");
}
