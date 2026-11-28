use std::{
    collections::HashMap,
    env,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc, Mutex,
    },
    thread,
};

use base64::{engine::general_purpose::STANDARD, Engine};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use tauri::{
    ipc::{Channel, InvokeResponseBody},
    State, Window,
};

use crate::procesos;

const TAMANO_LECTURA: usize = 64 * 1024;
const MAXIMO_PENDIENTE: usize = 16 * 1024 * 1024;
const INTEGRACION: &str = include_str!("integracion.ps1");
const INTEGRACION_REMOTA: &str = include_str!("integracion-remota.sh");

#[derive(Default)]
struct Destinos {
    salida: Option<Channel>,
    fin: Option<Channel<u32>>,
    pendiente: Vec<u8>,
}

struct Sesion {
    maestro: Box<dyn MasterPty + Send>,
    escritor: Box<dyn Write + Send>,
    terminador: Box<dyn ChildKiller + Send + Sync>,
    pid: Option<u32>,
    ventana: String,
    destinos: Arc<Mutex<Destinos>>,
}

#[derive(Clone, Default)]
pub struct Sesiones {
    mapa: Arc<Mutex<HashMap<u32, Sesion>>>,
    ultimo_id: Arc<AtomicU32>,
}

impl Sesiones {
    pub fn cerrar_de_ventana(&self, etiqueta: &str) {
        if let Ok(mut mapa) = self.mapa.lock() {
            for sesion in mapa
                .values_mut()
                .filter(|sesion| sesion.ventana == etiqueta)
            {
                let _ = sesion.terminador.kill();
            }
        }
    }

    fn quitar(&self, id: u32) -> Option<Sesion> {
        self.mapa.lock().ok()?.remove(&id)
    }
}

fn tamano(filas: u16, columnas: u16) -> PtySize {
    PtySize {
        rows: filas.max(1),
        cols: columnas.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn buscar_en_path(ejecutable: &str) -> Option<PathBuf> {
    env::split_paths(&env::var_os("PATH")?)
        .map(|carpeta| carpeta.join(ejecutable))
        .find(|ruta| ruta.symlink_metadata().is_ok())
}

pub(crate) fn ruta_shell() -> PathBuf {
    buscar_en_path("pwsh.exe")
        .or_else(|| buscar_en_path("powershell.exe"))
        .unwrap_or_else(|| PathBuf::from("powershell.exe"))
}

fn integracion_codificada() -> String {
    let remoto = STANDARD.encode(INTEGRACION_REMOTA.replace("\r\n", "\n"));
    let bytes: Vec<u8> = INTEGRACION
        .replace("__MAHZZ_REMOTO__", &remoto)
        .encode_utf16()
        .flat_map(|unidad| unidad.to_le_bytes())
        .collect();
    STANDARD.encode(bytes)
}

fn comando_shell(carpeta: Option<&str>) -> CommandBuilder {
    let mut comando = CommandBuilder::new(ruta_shell());
    comando.args(["-NoLogo", "-NoExit", "-EncodedCommand"]);
    comando.arg(integracion_codificada());
    comando.env("TERM", "xterm-256color");
    comando.env("COLORTERM", "truecolor");
    comando.env("TERM_PROGRAM", "MahzzTerm");
    comando.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));

    let carpeta_valida = carpeta
        .filter(|ruta| Path::new(ruta).is_dir())
        .map(Into::into)
        .or_else(|| env::var_os("USERPROFILE"));
    if let Some(ruta) = carpeta_valida {
        comando.cwd(ruta);
    }
    comando
}

fn entregar(destinos: &Mutex<Destinos>, datos: &[u8]) {
    let Ok(mut destinos) = destinos.lock() else {
        return;
    };
    if let Some(salida) = &destinos.salida {
        if salida.send(InvokeResponseBody::Raw(datos.to_vec())).is_ok() {
            return;
        }
        destinos.salida = None;
    }
    destinos.pendiente.extend_from_slice(datos);
    if destinos.pendiente.len() > MAXIMO_PENDIENTE {
        let sobrante = destinos.pendiente.len() - MAXIMO_PENDIENTE;
        destinos.pendiente.drain(..sobrante);
    }
}

#[tauri::command]
pub fn crear_sesion(
    filas: u16,
    columnas: u16,
    carpeta: Option<String>,
    salida: Channel,
    fin: Channel<u32>,
    ventana: Window,
    sesiones: State<'_, Sesiones>,
) -> Result<u32, String> {
    let par = native_pty_system()
        .openpty(tamano(filas, columnas))
        .map_err(|error| error.to_string())?;

    let mut proceso = par
        .slave
        .spawn_command(comando_shell(carpeta.as_deref()))
        .map_err(|error| error.to_string())?;
    drop(par.slave);

    let mut lector = par
        .master
        .try_clone_reader()
        .map_err(|error| error.to_string())?;
    let escritor = par
        .master
        .take_writer()
        .map_err(|error| error.to_string())?;
    let terminador = proceso.clone_killer();
    let pid = proceso.process_id();
    let destinos = Arc::new(Mutex::new(Destinos {
        salida: Some(salida),
        fin: Some(fin),
        pendiente: Vec::new(),
    }));

    let id = sesiones.ultimo_id.fetch_add(1, Ordering::Relaxed) + 1;
    sesiones
        .mapa
        .lock()
        .map_err(|error| error.to_string())?
        .insert(
            id,
            Sesion {
                maestro: par.master,
                escritor,
                terminador,
                pid,
                ventana: ventana.label().to_string(),
                destinos: destinos.clone(),
            },
        );

    let destinos_lector = destinos.clone();
    let hilo_lector = thread::spawn(move || {
        let mut bufer = vec![0u8; TAMANO_LECTURA];
        loop {
            match lector.read(&mut bufer) {
                Ok(0) | Err(_) => break,
                Ok(leidos) => entregar(&destinos_lector, &bufer[..leidos]),
            }
        }
    });

    let registro = sesiones.inner().clone();
    thread::spawn(move || {
        let codigo = proceso.wait().map(|estado| estado.exit_code()).unwrap_or(1);
        drop(registro.quitar(id));
        let _ = hilo_lector.join();
        if let Ok(mut destinos) = destinos.lock() {
            if let Some(fin) = destinos.fin.take() {
                let _ = fin.send(codigo);
            }
        }
    });

    Ok(id)
}

#[tauri::command]
pub fn escribir_sesion(
    id: u32,
    datos: String,
    sesiones: State<'_, Sesiones>,
) -> Result<(), String> {
    let mut mapa = sesiones.mapa.lock().map_err(|error| error.to_string())?;
    let sesion = mapa.get_mut(&id).ok_or("La sesión ya no existe")?;
    sesion
        .escritor
        .write_all(datos.as_bytes())
        .and_then(|_| sesion.escritor.flush())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn redimensionar_sesion(
    id: u32,
    filas: u16,
    columnas: u16,
    sesiones: State<'_, Sesiones>,
) -> Result<(), String> {
    let mapa = sesiones.mapa.lock().map_err(|error| error.to_string())?;
    let sesion = mapa.get(&id).ok_or("La sesión ya no existe")?;
    sesion
        .maestro
        .resize(tamano(filas, columnas))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn cerrar_sesion(id: u32, sesiones: State<'_, Sesiones>) -> Result<(), String> {
    let mut mapa = sesiones.mapa.lock().map_err(|error| error.to_string())?;
    if let Some(sesion) = mapa.get_mut(&id) {
        let _ = sesion.terminador.kill();
    }
    Ok(())
}

#[tauri::command]
pub fn pausar_sesion(id: u32, sesiones: State<'_, Sesiones>) -> Result<(), String> {
    let mapa = sesiones.mapa.lock().map_err(|error| error.to_string())?;
    let sesion = mapa.get(&id).ok_or("La sesión ya no existe")?;
    let mut destinos = sesion.destinos.lock().map_err(|error| error.to_string())?;
    destinos.salida = None;
    destinos.fin = None;
    Ok(())
}

#[tauri::command]
pub fn adjuntar_sesion(
    id: u32,
    salida: Channel,
    fin: Channel<u32>,
    ventana: Window,
    sesiones: State<'_, Sesiones>,
) -> Result<(), String> {
    let mut mapa = sesiones.mapa.lock().map_err(|error| error.to_string())?;
    let sesion = mapa.get_mut(&id).ok_or("La sesión ya no existe")?;
    sesion.ventana = ventana.label().to_string();

    let mut destinos = sesion.destinos.lock().map_err(|error| error.to_string())?;
    if !destinos.pendiente.is_empty() {
        let pendiente = std::mem::take(&mut destinos.pendiente);
        salida
            .send(InvokeResponseBody::Raw(pendiente))
            .map_err(|error| error.to_string())?;
    }
    destinos.salida = Some(salida);
    destinos.fin = Some(fin);
    Ok(())
}

#[tauri::command]
pub fn programas_sesiones(
    ids: Vec<u32>,
    sesiones: State<'_, Sesiones>,
) -> Result<HashMap<u32, Option<String>>, String> {
    let lista = procesos::listar();
    let mapa = sesiones.mapa.lock().map_err(|error| error.to_string())?;
    Ok(ids
        .into_iter()
        .map(|id| {
            let programa = mapa
                .get(&id)
                .and_then(|sesion| sesion.pid)
                .and_then(|pid| procesos::programa_de(pid, &lista));
            (id, programa)
        })
        .collect())
}
