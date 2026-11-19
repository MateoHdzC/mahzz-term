use std::{
    collections::HashMap,
    env,
    ffi::OsStr,
    fs,
    io::Read,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant, SystemTime},
};

use serde_json::{json, Value};
use tauri::{async_runtime::spawn_blocking, AppHandle, Manager};

use crate::pty::ruta_shell;

const SIN_VENTANA: u32 = 0x0800_0000;
const VIGENCIA_COMANDOS: Duration = Duration::from_secs(7 * 24 * 60 * 60);
const MAXIMO_ARCHIVOS_REVISADOS: usize = 500;
const MAXIMO_RUTAS: usize = 200;
const MAXIMO_ENTRADAS_CARPETA: usize = 3000;

// Las versiones y parámetros no cambian durante la sesión: se consultan una sola vez.
#[derive(Default)]
pub struct Versiones {
    conocidas: Mutex<HashMap<String, Option<String>>>,
    parametros: Mutex<HashMap<String, Vec<String>>>,
}

// Ejecuta un programa sin mostrar ventana y lo corta si tarda demasiado.
fn ejecutar(programa: &OsStr, argumentos: &[&str], carpeta: Option<&Path>, limite: Duration) -> Option<String> {
    let mut comando = Command::new(programa);
    comando
        .args(argumentos)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(SIN_VENTANA);
    if let Some(carpeta) = carpeta {
        comando.current_dir(carpeta);
    }

    let mut proceso = comando.spawn().ok()?;
    let mut salida = proceso.stdout.take()?;
    let mut errores = proceso.stderr.take()?;
    let lector_salida = thread::spawn(move || {
        let mut texto = String::new();
        let _ = salida.read_to_string(&mut texto);
        texto
    });
    let lector_errores = thread::spawn(move || {
        let mut texto = String::new();
        let _ = errores.read_to_string(&mut texto);
        texto
    });

    let inicio = Instant::now();
    loop {
        match proceso.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if inicio.elapsed() < limite => thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = proceso.kill();
                let _ = proceso.wait();
                return None;
            }
        }
    }
    let texto = lector_salida.join().ok()?;
    let error = lector_errores.join().ok()?;
    Some(if texto.trim().is_empty() { error } else { texto })
}

fn extensiones_ejecutables() -> Vec<String> {
    env::var("PATHEXT")
        .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD;.PS1".to_string())
        .split(';')
        .chain([".PS1"])
        .map(str::to_string)
        .collect()
}

fn existe_con_extension(ruta: &Path, extensiones: &[String]) -> bool {
    if ruta.symlink_metadata().is_ok_and(|datos| !datos.is_dir()) {
        return true;
    }
    extensiones.iter().any(|extension| {
        let mut candidata = ruta.as_os_str().to_os_string();
        candidata.push(extension);
        Path::new(&candidata).symlink_metadata().is_ok()
    })
}

fn existe_comando(nombre: &str, carpeta: Option<&Path>, rutas: &[PathBuf], extensiones: &[String]) -> bool {
    if nombre.contains('\\') || nombre.contains('/') {
        let ruta = Path::new(nombre);
        let completa = match carpeta {
            Some(base) if ruta.is_relative() => base.join(ruta),
            _ => ruta.to_path_buf(),
        };
        return existe_con_extension(&completa, extensiones);
    }
    rutas
        .iter()
        .any(|carpeta| existe_con_extension(&carpeta.join(nombre), extensiones))
}

#[tauri::command]
pub fn existen_comandos(
    nombres: Vec<String>,
    carpeta: Option<String>,
    ruta: Option<String>,
) -> HashMap<String, bool> {
    let valor_path = ruta
        .map(Into::into)
        .or_else(|| env::var_os("PATH"))
        .unwrap_or_default();
    let rutas: Vec<PathBuf> = env::split_paths(&valor_path).collect();
    let extensiones = extensiones_ejecutables();
    let base = carpeta.as_deref().map(Path::new);
    nombres
        .into_iter()
        .map(|nombre| {
            let existe = existe_comando(&nombre, base, &rutas, &extensiones);
            (nombre, existe)
        })
        .collect()
}

// La lista tarda en generarse, por eso se guarda en disco y se renueva cada semana.
#[tauri::command]
pub async fn comandos_powershell(app: AppHandle) -> Result<Vec<String>, String> {
    let cache = app.path().app_cache_dir().map_err(|error| error.to_string())?;
    spawn_blocking(move || {
        let archivo = cache.join("comandos-powershell.txt");
        let vigente = fs::metadata(&archivo)
            .and_then(|datos| datos.modified())
            .ok()
            .and_then(|fecha| SystemTime::now().duration_since(fecha).ok())
            .is_some_and(|edad| edad < VIGENCIA_COMANDOS);

        let texto = if vigente {
            fs::read_to_string(&archivo).unwrap_or_default()
        } else {
            let lista = ejecutar(
                ruta_shell().as_os_str(),
                &[
                    "-NoLogo",
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    "Get-Command -CommandType Cmdlet,Function,Alias,Filter -ErrorAction Ignore | ForEach-Object Name",
                ],
                None,
                Duration::from_secs(45),
            )
            .unwrap_or_default();
            if !lista.trim().is_empty() {
                let _ = fs::create_dir_all(&cache);
                let _ = fs::write(&archivo, &lista);
            }
            lista
        };
        texto
            .lines()
            .map(str::trim)
            .filter(|linea| !linea.is_empty())
            .map(str::to_string)
            .collect()
    })
    .await
    .map_err(|error| error.to_string())
}

fn numero_tras(texto: &str, marca: &str) -> u32 {
    texto
        .split(marca)
        .nth(1)
        .and_then(|resto| resto.split(|caracter: char| !caracter.is_ascii_digit()).next())
        .and_then(|numero| numero.parse().ok())
        .unwrap_or(0)
}

#[tauri::command]
pub async fn estado_git(carpeta: String) -> Result<Option<Value>, String> {
    spawn_blocking(move || {
        let salida = ejecutar(
            OsStr::new("git"),
            &["--no-optional-locks", "status", "--porcelain", "--branch"],
            Some(Path::new(&carpeta)),
            Duration::from_secs(4),
        )?;
        let mut lineas = salida.lines();
        let encabezado = lineas.next()?.strip_prefix("## ")?;
        let cambios = lineas.filter(|linea| !linea.trim().is_empty()).count();
        Some(json!({
            "cambios": cambios,
            "adelante": numero_tras(encabezado, "ahead "),
            "atras": numero_tras(encabezado, "behind "),
        }))
    })
    .await
    .map_err(|error| error.to_string())
}

fn tipo_por_marcadores(carpeta: &Path) -> Option<&'static str> {
    let hay = |nombre: &str| carpeta.join(nombre).exists();
    if hay("package.json") {
        Some("node")
    } else if hay("Cargo.toml") {
        Some("rust")
    } else if hay("pyproject.toml") || hay("requirements.txt") || hay("setup.py") {
        Some("python")
    } else if hay("go.mod") {
        Some("go")
    } else if hay("pom.xml") || hay("build.gradle") || hay("build.gradle.kts") {
        Some("java")
    } else {
        None
    }
}

fn tipo_por_extension(extension: &str) -> Option<&'static str> {
    match extension {
        "uproject" => Some("unreal"),
        "sln" | "csproj" | "cs" => Some("dotnet"),
        "py" => Some("python"),
        "js" | "mjs" | "ts" | "tsx" | "jsx" => Some("node"),
        "rs" => Some("rust"),
        "go" => Some("go"),
        "java" => Some("java"),
        "lua" => Some("lua"),
        "html" => Some("web"),
        _ => None,
    }
}

fn detectar_tipo(carpeta: &Path) -> Option<&'static str> {
    let extensiones: Vec<String> = fs::read_dir(carpeta)
        .ok()?
        .flatten()
        .take(MAXIMO_ARCHIVOS_REVISADOS)
        .filter_map(|entrada| {
            let ruta = entrada.path();
            let extension = ruta.extension()?.to_str()?.to_ascii_lowercase();
            ruta.is_file().then_some(extension)
        })
        .collect();

    if extensiones.iter().any(|extension| extension == "uproject") {
        return Some("unreal");
    }
    tipo_por_marcadores(carpeta)
        .or_else(|| extensiones.iter().find_map(|extension| tipo_por_extension(extension)))
}

fn comando_version(tipo: &str) -> Option<(&'static str, &'static [&'static str])> {
    match tipo {
        "node" => Some(("node", &["--version"])),
        "python" => Some(("python", &["--version"])),
        "rust" => Some(("rustc", &["--version"])),
        "go" => Some(("go", &["version"])),
        "dotnet" => Some(("dotnet", &["--version"])),
        "java" => Some(("java", &["-version"])),
        "lua" => Some(("lua", &["-v"])),
        _ => None,
    }
}

// Toma la primera palabra que parece un número de versión, como 24.18.0.
fn extraer_version(texto: &str) -> Option<String> {
    texto
        .split(|caracter: char| caracter.is_whitespace() || caracter == '"')
        .map(|palabra| palabra.trim_start_matches(['v', 'g', 'o']))
        .find(|palabra| {
            palabra.contains('.') && palabra.chars().next().is_some_and(|inicial| inicial.is_ascii_digit())
        })
        .map(str::to_string)
}

fn version_de(tipo: &str, versiones: &Versiones) -> Option<String> {
    if let Some(conocida) = versiones.conocidas.lock().ok()?.get(tipo) {
        return conocida.clone();
    }
    let version = comando_version(tipo).and_then(|(programa, argumentos)| {
        let salida = ejecutar(OsStr::new(programa), argumentos, None, Duration::from_secs(4))?;
        extraer_version(&salida)
    });
    versiones
        .conocidas
        .lock()
        .ok()?
        .insert(tipo.to_string(), version.clone());
    version
}

#[tauri::command]
pub async fn detectar_proyecto(app: AppHandle, carpeta: String) -> Result<Option<Value>, String> {
    spawn_blocking(move || {
        let tipo = detectar_tipo(Path::new(&carpeta))?;
        let versiones = app.state::<Versiones>();
        Some(json!({ "tipo": tipo, "version": version_de(tipo, &versiones) }))
    })
    .await
    .map_err(|error| error.to_string())
}

// Lista archivos y carpetas que empiezan con lo que se lleva escrito.
#[tauri::command]
pub fn listar_rutas(parcial: String, carpeta: Option<String>) -> Vec<Value> {
    let corte = parcial.rfind(['\\', '/']).map_or(0, |indice| indice + 1);
    let (base, prefijo) = parcial.split_at(corte);
    let actual = carpeta.map_or_else(|| PathBuf::from("."), PathBuf::from);

    let directorio = if base.is_empty() {
        actual
    } else if let Some(resto) = base.strip_prefix('~') {
        let casa = env::var_os("USERPROFILE").map_or_else(|| PathBuf::from("."), PathBuf::from);
        casa.join(resto.trim_start_matches(['\\', '/']))
    } else if Path::new(base).is_absolute() {
        PathBuf::from(base)
    } else {
        actual.join(base)
    };

    let prefijo = prefijo.to_lowercase();
    let Ok(lectura) = fs::read_dir(directorio) else {
        return Vec::new();
    };
    let mut rutas: Vec<(bool, String)> = lectura
        .flatten()
        .take(MAXIMO_ARCHIVOS_REVISADOS * 4)
        .filter_map(|entrada| {
            let nombre = entrada.file_name().to_string_lossy().into_owned();
            nombre
                .to_lowercase()
                .starts_with(&prefijo)
                .then(|| (entrada.path().is_dir(), nombre))
        })
        .collect();
    rutas.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.to_lowercase().cmp(&b.1.to_lowercase())));
    rutas
        .into_iter()
        .take(MAXIMO_RUTAS)
        .map(|(directorio, nombre)| json!({ "nombre": nombre, "directorio": directorio }))
        .collect()
}

// Servidores definidos en ~/.ssh/config. Se omiten comodines y accesos solo para git.
#[tauri::command]
pub fn hosts_ssh() -> Vec<String> {
    let Some(casa) = env::var_os("USERPROFILE") else {
        return Vec::new();
    };
    let texto = fs::read_to_string(PathBuf::from(casa).join(".ssh").join("config")).unwrap_or_default();
    let mut hosts = Vec::new();
    let mut actuales: Vec<String> = Vec::new();
    let mut solo_git = false;

    let mut cerrar = |actuales: &mut Vec<String>, solo_git: bool| {
        if !solo_git {
            hosts.append(actuales);
        }
        actuales.clear();
    };
    for linea in texto.lines() {
        let mut partes = linea.split_whitespace();
        let Some(clave) = partes.next() else { continue };
        if clave.eq_ignore_ascii_case("host") {
            cerrar(&mut actuales, solo_git);
            solo_git = false;
            actuales.extend(
                partes
                    .filter(|nombre| !nombre.contains(['*', '?', '!']))
                    .map(str::to_string),
            );
        } else if clave.eq_ignore_ascii_case("user") && partes.next() == Some("git") {
            solo_git = true;
        }
    }
    cerrar(&mut actuales, solo_git);
    hosts
}

// Contenido de una carpeta para el panel de archivos: primero carpetas, después archivos.
#[tauri::command]
pub fn listar_carpeta(ruta: String) -> Result<Vec<Value>, String> {
    let lectura = fs::read_dir(&ruta).map_err(|error| error.to_string())?;
    let mut entradas: Vec<(bool, String, String)> = lectura
        .flatten()
        .take(MAXIMO_ENTRADAS_CARPETA)
        .filter_map(|entrada| {
            let nombre = entrada.file_name().to_string_lossy().into_owned();
            (nombre != ".git").then(|| {
                let ruta = entrada.path();
                (ruta.is_dir(), nombre, ruta.display().to_string())
            })
        })
        .collect();
    entradas.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.to_lowercase().cmp(&b.1.to_lowercase())));
    Ok(entradas
        .into_iter()
        .map(|(directorio, nombre, ruta)| json!({ "nombre": nombre, "ruta": ruta, "directorio": directorio }))
        .collect())
}

#[tauri::command]
pub async fn listar_ejecutables(ruta: Option<String>) -> Result<Vec<String>, String> {
    spawn_blocking(move || {
        let valor = ruta
            .map(Into::into)
            .or_else(|| env::var_os("PATH"))
            .unwrap_or_default();
        let extensiones: Vec<String> = extensiones_ejecutables()
            .iter()
            .map(|extension| extension.trim_start_matches('.').to_lowercase())
            .collect();
        let mut nombres: Vec<String> = env::split_paths(&valor)
            .filter_map(|carpeta| fs::read_dir(carpeta).ok())
            .flat_map(|lectura| lectura.flatten())
            .filter_map(|entrada| {
                let ruta = entrada.path();
                let extension = ruta.extension()?.to_str()?.to_lowercase();
                extensiones
                    .contains(&extension)
                    .then(|| ruta.file_stem()?.to_str().map(str::to_string))?
            })
            .collect();
        nombres.sort_by_key(|nombre| nombre.to_lowercase());
        nombres.dedup_by_key(|nombre| nombre.to_lowercase());
        nombres
    })
    .await
    .map_err(|error| error.to_string())
}

// Ramas, remotos y scripts de la carpeta para sugerir argumentos reales.
#[tauri::command]
pub async fn datos_proyecto(carpeta: String) -> Result<Value, String> {
    spawn_blocking(move || {
        let ruta = Path::new(&carpeta);
        let lineas = |argumentos: &[&str]| -> Vec<String> {
            ejecutar(OsStr::new("git"), argumentos, Some(ruta), Duration::from_secs(3))
                .unwrap_or_default()
                .lines()
                .map(str::trim)
                .filter(|linea| !linea.is_empty() && !linea.starts_with("fatal:"))
                .map(str::to_string)
                .collect()
        };
        let scripts: Vec<String> = fs::read_to_string(ruta.join("package.json"))
            .ok()
            .and_then(|texto| serde_json::from_str::<Value>(&texto).ok())
            .and_then(|paquete| {
                paquete
                    .get("scripts")?
                    .as_object()
                    .map(|mapa| mapa.keys().cloned().collect())
            })
            .unwrap_or_default();
        json!({
            "ramas": lineas(&["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"]),
            "remotos": lineas(&["remote"]),
            "scripts": scripts,
        })
    })
    .await
    .map_err(|error| error.to_string())
}

// Consulta los parámetros reales de un cmdlet y los recuerda durante la sesión.
#[tauri::command]
pub async fn parametros_cmdlet(app: AppHandle, nombre: String) -> Result<Vec<String>, String> {
    // Solo se aceptan nombres simples porque el valor se usa dentro de un comando.
    if nombre.is_empty() || !nombre.chars().all(|caracter| caracter.is_alphanumeric() || caracter == '-') {
        return Ok(Vec::new());
    }
    spawn_blocking(move || {
        let versiones = app.state::<Versiones>();
        let clave = nombre.to_lowercase();
        if let Some(conocidos) = versiones.parametros.lock().ok().and_then(|mapa| mapa.get(&clave).cloned()) {
            return conocidos;
        }
        let consulta = format!("(Get-Command -Name {nombre} -ErrorAction Ignore).Parameters.Keys");
        let parametros: Vec<String> = ejecutar(
            ruta_shell().as_os_str(),
            &["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", &consulta],
            None,
            Duration::from_secs(8),
        )
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|linea| !linea.is_empty())
        .map(str::to_string)
        .collect();
        if let Ok(mut mapa) = versiones.parametros.lock() {
            mapa.insert(clave, parametros.clone());
        }
        parametros
    })
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn carpeta_usuario() -> Option<String> {
    env::var("USERPROFILE").ok()
}
