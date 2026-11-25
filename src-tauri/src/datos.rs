use std::{
    env,
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::Mutex,
};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};

const MAXIMO_HISTORIAL: usize = 5000;
const MARGEN_COMPACTACION: usize = 500;

#[derive(Default)]
pub struct Historial {
    entradas: Mutex<Option<Vec<Value>>>,
}

// Los datos viven en una carpeta fija del usuario (%LOCALAPPDATA%), no junto al .exe.
// Así la sesión de Google y los ajustes sobreviven a reinicios, actualizaciones y a
// abrir MahzzTerm desde otra ruta. MAHZZTERM_DATOS permite usar otra carpeta (pruebas o portable).
pub(crate) fn carpeta_datos(app: &AppHandle) -> Result<PathBuf, String> {
    // Una variable vacía se ignora para no guardar datos en la carpeta donde se abrió la app.
    if let Some(propia) = env::var_os("MAHZZTERM_DATOS").filter(|valor| !valor.is_empty()) {
        let carpeta = PathBuf::from(propia);
        if fs::create_dir_all(&carpeta).is_ok() {
            return Ok(carpeta);
        }
    }
    let carpeta = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("datos");
    fs::create_dir_all(&carpeta).map_err(|error| error.to_string())?;
    migrar_desde_ejecutable(&carpeta);
    Ok(carpeta)
}

// Las versiones anteriores guardaban todo en `datos` junto al .exe. Se copia lo que falte,
// sin pisar nada, y se deja una marca para no revisar en cada lectura.
fn migrar_desde_ejecutable(destino: &PathBuf) {
    let Some(vieja) = env::current_exe()
        .ok()
        .and_then(|exe| Some(exe.parent()?.join("datos")))
    else {
        return;
    };
    if vieja == *destino || !vieja.is_dir() {
        return;
    }
    let marca = vieja.join(".migrado");
    if marca.exists() {
        return;
    }
    if copiar_faltantes(&vieja, destino).is_ok() {
        let _ = fs::write(marca, destino.to_string_lossy().as_bytes());
    }
}

fn copiar_faltantes(origen: &PathBuf, destino: &PathBuf) -> std::io::Result<()> {
    fs::create_dir_all(destino)?;
    for entrada in fs::read_dir(origen)? {
        let entrada = entrada?;
        let ruta = entrada.path();
        let nueva = destino.join(entrada.file_name());
        if ruta.is_dir() {
            copiar_faltantes(&ruta, &nueva)?;
        } else if !nueva.exists() && ruta.extension().is_none_or(|extension| extension != "tmp") {
            fs::copy(&ruta, &nueva)?;
        }
    }
    Ok(())
}

fn reescribir(ruta: &PathBuf, entradas: &[Value]) -> Result<(), String> {
    let contenido: String = entradas
        .iter()
        .map(|entrada| format!("{entrada}\n"))
        .collect();
    escribir_seguro(ruta, &contenido)
}

// Escribe primero un temporal para no perder el archivo si la app se cierra a la mitad.
pub(crate) fn escribir_seguro(ruta: &PathBuf, contenido: &str) -> Result<(), String> {
    let temporal = ruta.with_extension("tmp");
    fs::write(&temporal, contenido).map_err(|error| error.to_string())?;
    fs::rename(&temporal, ruta).map_err(|error| error.to_string())
}

fn cargar_historial(ruta: &PathBuf) -> Vec<Value> {
    let mut entradas: Vec<Value> = fs::read_to_string(ruta)
        .unwrap_or_default()
        .lines()
        .filter_map(|linea| serde_json::from_str(linea).ok())
        .collect();
    if entradas.len() > MAXIMO_HISTORIAL {
        entradas.drain(..entradas.len() - MAXIMO_HISTORIAL);
        let _ = reescribir(ruta, &entradas);
    }
    entradas
}

#[tauri::command]
pub fn leer_historial(
    app: AppHandle,
    historial: State<'_, Historial>,
) -> Result<Vec<Value>, String> {
    let ruta = carpeta_datos(&app)?.join("historial.jsonl");
    let mut entradas = historial
        .entradas
        .lock()
        .map_err(|error| error.to_string())?;
    Ok(entradas
        .get_or_insert_with(|| cargar_historial(&ruta))
        .clone())
}

#[tauri::command]
pub fn agregar_historial(
    app: AppHandle,
    entrada: Value,
    historial: State<'_, Historial>,
) -> Result<(), String> {
    let ruta = carpeta_datos(&app)?.join("historial.jsonl");
    let mut bloqueo = historial
        .entradas
        .lock()
        .map_err(|error| error.to_string())?;
    let entradas = bloqueo.get_or_insert_with(|| cargar_historial(&ruta));

    let mut archivo = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&ruta)
        .map_err(|error| error.to_string())?;
    writeln!(archivo, "{entrada}").map_err(|error| error.to_string())?;
    entradas.push(entrada);

    if entradas.len() > MAXIMO_HISTORIAL + MARGEN_COMPACTACION {
        let sobrantes = entradas.len() - MAXIMO_HISTORIAL;
        entradas.drain(..sobrantes);
        reescribir(&ruta, entradas)?;
    }
    Ok(())
}

// Suma lo que llegó de otra PC sin repetir comandos ya registrados.
#[tauri::command]
pub fn fusionar_historial(
    app: AppHandle,
    entradas: Vec<Value>,
    historial: State<'_, Historial>,
) -> Result<(), String> {
    let ruta = carpeta_datos(&app)?.join("historial.jsonl");
    let mut bloqueo = historial
        .entradas
        .lock()
        .map_err(|error| error.to_string())?;
    let actuales = bloqueo.get_or_insert_with(|| cargar_historial(&ruta));
    let clave = |entrada: &Value| (entrada["comando"].to_string(), entrada["fecha"].to_string());
    let mut vistas: std::collections::HashSet<_> = actuales.iter().map(clave).collect();
    let antes = actuales.len();
    for entrada in entradas {
        if vistas.insert(clave(&entrada)) {
            actuales.push(entrada);
        }
    }
    if actuales.len() == antes {
        return Ok(());
    }
    actuales.sort_by_key(|entrada| entrada["fecha"].as_u64().unwrap_or(0));
    if actuales.len() > MAXIMO_HISTORIAL {
        let sobrantes = actuales.len() - MAXIMO_HISTORIAL;
        actuales.drain(..sobrantes);
    }
    reescribir(&ruta, actuales)
}

#[tauri::command]
pub fn leer_guardados(app: AppHandle) -> Result<Value, String> {
    let ruta = carpeta_datos(&app)?.join("comandos-guardados.json");
    Ok(fs::read_to_string(ruta)
        .ok()
        .and_then(|texto| serde_json::from_str(&texto).ok())
        .unwrap_or_else(|| json!([])))
}

#[tauri::command]
pub fn escribir_guardados(app: AppHandle, lista: Value) -> Result<(), String> {
    let ruta = carpeta_datos(&app)?.join("comandos-guardados.json");
    let texto = serde_json::to_string_pretty(&lista).map_err(|error| error.to_string())?;
    escribir_seguro(&ruta, &texto)
}

// Cada persona puede sumar autocompletados propios dejando archivos JSON en datos/specs.
#[tauri::command]
pub fn leer_specs_usuario(app: AppHandle) -> Result<Vec<Value>, String> {
    let carpeta = carpeta_datos(&app)?.join("specs");
    let Ok(archivos) = fs::read_dir(carpeta) else {
        return Ok(Vec::new());
    };
    Ok(archivos
        .flatten()
        .filter(|archivo| {
            archivo
                .path()
                .extension()
                .is_some_and(|extension| extension == "json")
        })
        .filter_map(|archivo| fs::read_to_string(archivo.path()).ok())
        .filter_map(|texto| serde_json::from_str(&texto).ok())
        .collect())
}

#[cfg(test)]
mod pruebas {
    use super::copiar_faltantes;
    use std::{env, fs};

    #[test]
    fn la_migracion_copia_lo_que_falta_sin_pisar() {
        let base = env::temp_dir().join(format!("mazz-migracion-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let vieja = base.join("vieja");
        let nueva = base.join("nueva");
        fs::create_dir_all(vieja.join("temas")).unwrap();
        fs::create_dir_all(&nueva).unwrap();
        fs::write(vieja.join("cuenta.dat"), "sesion").unwrap();
        fs::write(vieja.join("config.toml"), "viejo").unwrap();
        fs::write(vieja.join("sesion.tmp"), "a medias").unwrap();
        fs::write(vieja.join("temas").join("violeta.json"), "{}").unwrap();
        fs::write(nueva.join("config.toml"), "nuevo").unwrap();

        copiar_faltantes(&vieja, &nueva).unwrap();

        assert_eq!(
            fs::read_to_string(nueva.join("cuenta.dat")).unwrap(),
            "sesion"
        );
        assert_eq!(
            fs::read_to_string(nueva.join("config.toml")).unwrap(),
            "nuevo"
        );
        assert!(!nueva.join("sesion.tmp").exists());
        assert!(nueva.join("temas").join("violeta.json").exists());
        let _ = fs::remove_dir_all(&base);
    }
}
