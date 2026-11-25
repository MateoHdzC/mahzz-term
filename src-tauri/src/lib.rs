mod ajustes;
mod archivos;
mod cambios;
mod control;
mod datos;
mod entorno;
mod explorador;
mod google;
mod integracion;
mod logo;
mod mahzz;
mod mcp;
mod procesos;
mod pty;
mod registros;
mod servidor;
mod sesiones;
mod tareas;
mod ventanas;

use datos::Historial;
use entorno::Versiones;
use google::TokenGoogle;
use pty::Sesiones;
use std::sync::Mutex;

use tauri::{Manager, WindowEvent};
use ventanas::Traspasos;

pub fn correr_mcp() {
    mcp::correr();
}

pub fn quitar_integracion() {
    integracion::quitar();
}

pub fn iniciar() {
    // Si la abrió el Explorador ("Abrir en MahzzTerm" o "Abrir con") y ya hay una MahzzTerm abierta,
    // se le pasa la carpeta o el archivo a esa y esta copia se cierra sin abrir otra ventana.
    let pedido = integracion::leer_pedido(std::env::args());
    if pedido
        .as_ref()
        .is_some_and(|pedido| mcp::pasar_a_abierta("abrir_desde_windows", pedido))
    {
        return;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(Sesiones::default())
        .manage(Traspasos::default())
        .manage(Versiones::default())
        .manage(Historial::default())
        .manage(TokenGoogle::default())
        .manage(control::Control::default())
        .manage(registros::Registros::default())
        .manage(integracion::PedidoInicial(Mutex::new(pedido)))
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
            mahzz::mahzz_borrar_key,
            mahzz::mahzz_chat,
            mahzz::mahzz_config,
            mahzz::mahzz_detener,
            mahzz::mahzz_estado,
            mahzz::mahzz_guardar_config,
            mahzz::mahzz_instalar,
            mahzz::mahzz_cancelar_instalacion,
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
            integracion::integracion_windows,
            integracion::tomar_pedido_windows,
            pty::crear_sesion,
            pty::escribir_sesion,
            pty::redimensionar_sesion,
            pty::cerrar_sesion,
            pty::pausar_sesion,
            pty::adjuntar_sesion,
            pty::programas_sesiones,
            registros::buscar_registros,
            registros::guardar_registro,
            servidor::servir_html,
            sesiones::borrar_sesion_guardada,
            sesiones::listar_sesiones,
            tareas::crear_tarea,
            tareas::descartar_tarea,
            tareas::listar_tareas,
            tareas::unir_tarea,
            logo::aplicar_logo,
            ventanas::abrir_ventana,
            ventanas::definir_memoria_baja,
            ventanas::esperar_traspaso,
            ventanas::tomar_traspaso,
        ])
        .on_window_event(|ventana, evento| {
            if matches!(evento, WindowEvent::Destroyed) {
                ventana
                    .state::<Sesiones>()
                    .cerrar_de_ventana(ventana.label());
            }
        })
        .run(tauri::generate_context!())
        .expect("no se pudo iniciar mahzzterm");
}
