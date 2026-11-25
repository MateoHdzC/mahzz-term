// Revisión de cambios: lista lo que se modificó en el repositorio y deja aceptar o revertir cada archivo.
use std::{
    fs,
    os::windows::process::CommandExt,
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
};

use serde_json::{json, Value};
use tauri::async_runtime::spawn_blocking;

const SIN_VENTANA: u32 = 0x0800_0000;
const MAXIMO_LINEAS_DIFF: usize = 4000;
const MAXIMO_BYTES_NUEVO: u64 = 512 * 1024;
const MAXIMO_ARCHIVOS: usize = 1000;

fn git(raiz: &Path, argumentos: &[&str]) -> Result<String, String> {
    let salida = Command::new("git")
        .arg("--no-optional-locks")
        .args(argumentos)
        .current_dir(raiz)
        .stdin(Stdio::null())
        .env("GIT_TERMINAL_PROMPT", "0")
        .creation_flags(SIN_VENTANA)
        .output()
        .map_err(|error| format!("no se pudo ejecutar git: {error}"))?;
    if salida.status.success() {
        Ok(String::from_utf8_lossy(&salida.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&salida.stderr).trim().to_string())
    }
}

// Así git toma la ruta tal cual, sin interpretar comodines como * o ?.
fn literal(ruta: &str) -> String {
    format!(":(literal){ruta}")
}

// Las rutas vienen de git, pero igual se rechaza cualquier cosa que salga del repositorio.
fn ruta_segura(raiz: &Path, relativa: &str) -> Result<PathBuf, String> {
    let ruta = Path::new(relativa);
    let valida = !relativa.is_empty()
        && ruta
            .components()
            .all(|parte| matches!(parte, Component::Normal(_) | Component::CurDir));
    if valida {
        Ok(raiz.join(ruta))
    } else {
        Err("ruta fuera del repositorio".to_string())
    }
}

fn raiz_de(carpeta: &str) -> Option<PathBuf> {
    let salida = git(Path::new(carpeta), &["rev-parse", "--show-toplevel"]).ok()?;
    let raiz = salida.trim();
    (!raiz.is_empty()).then(|| PathBuf::from(raiz.replace('/', "\\")))
}

// git status -z separa con \0. En renombres, después de la ruta nueva viene la vieja.
fn leer_estado(raiz: &Path) -> Result<Vec<Value>, String> {
    let salida = git(
        raiz,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )?;
    let mut partes = salida.split('\0').filter(|parte| !parte.is_empty());
    let mut archivos = Vec::new();
    while let Some(entrada) = partes.next() {
        if entrada.len() < 4 || archivos.len() >= MAXIMO_ARCHIVOS {
            continue;
        }
        let indice = &entrada[0..1];
        let trabajo = &entrada[1..2];
        let ruta = &entrada[3..];
        let origen = if indice == "R" || indice == "C" {
            partes.next()
        } else {
            None
        };
        archivos.push(json!({
            "ruta": ruta,
            "origen": origen,
            "indice": indice,
            "trabajo": trabajo,
        }));
    }
    Ok(archivos)
}

#[tauri::command]
pub async fn listar_cambios(carpeta: String) -> Result<Option<Value>, String> {
    spawn_blocking(move || {
        let Some(raiz) = raiz_de(&carpeta) else {
            return Ok(None);
        };
        let archivos = leer_estado(&raiz)?;
        Ok(Some(json!({ "raiz": raiz, "archivos": archivos })))
    })
    .await
    .map_err(|error| error.to_string())?
}

// Un archivo que git todavía no conoce se muestra entero como agregado.
fn diff_de_nuevo(raiz: &Path, relativa: &str) -> Result<Value, String> {
    let ruta = ruta_segura(raiz, relativa)?;
    let tamano = fs::metadata(&ruta)
        .map_err(|error| error.to_string())?
        .len();
    if tamano > MAXIMO_BYTES_NUEVO {
        return Ok(json!({ "texto": "", "binario": false, "grande": true }));
    }
    let bytes = fs::read(&ruta).map_err(|error| error.to_string())?;
    if bytes.contains(&0) {
        return Ok(json!({ "texto": "", "binario": true, "grande": false }));
    }
    let contenido = String::from_utf8_lossy(&bytes);
    let lineas: Vec<&str> = contenido.lines().collect();
    let mut texto = format!("@@ -0,0 +1,{} @@ archivo nuevo\n", lineas.len());
    for linea in lineas.iter().take(MAXIMO_LINEAS_DIFF) {
        texto.push('+');
        texto.push_str(linea);
        texto.push('\n');
    }
    Ok(json!({ "texto": texto, "binario": false, "grande": lineas.len() > MAXIMO_LINEAS_DIFF }))
}

fn recortar(texto: String) -> Value {
    let binario = texto
        .lines()
        .any(|linea| linea.starts_with("Binary files "));
    let total = texto.lines().count();
    let texto = if total > MAXIMO_LINEAS_DIFF {
        texto
            .lines()
            .take(MAXIMO_LINEAS_DIFF)
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        texto
    };
    json!({ "texto": texto, "binario": binario, "grande": total > MAXIMO_LINEAS_DIFF })
}

#[tauri::command]
pub async fn diff_cambio(
    raiz: String,
    ruta: String,
    origen: Option<String>,
    nuevo: bool,
) -> Result<Value, String> {
    spawn_blocking(move || {
        let raiz = PathBuf::from(raiz);
        if nuevo {
            return diff_de_nuevo(&raiz, &ruta);
        }
        ruta_segura(&raiz, &ruta)?;
        let mut rutas = vec![literal(&ruta)];
        if let Some(origen) = &origen {
            ruta_segura(&raiz, origen)?;
            rutas.push(literal(origen));
        }
        let mut argumentos = vec!["diff", "HEAD", "--no-color", "--no-ext-diff", "-M", "--"];
        argumentos.extend(rutas.iter().map(String::as_str));
        match git(&raiz, &argumentos) {
            Ok(texto) => Ok(recortar(texto)),
            // Repositorio sin commits todavía: se compara contra lo que está en el índice.
            Err(_) => diff_de_nuevo(&raiz, &ruta),
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn aceptar_cambio(
    raiz: String,
    ruta: String,
    origen: Option<String>,
) -> Result<(), String> {
    spawn_blocking(move || {
        let raiz = PathBuf::from(raiz);
        ruta_segura(&raiz, &ruta)?;
        let mut rutas = vec![literal(&ruta)];
        if let Some(origen) = &origen {
            ruta_segura(&raiz, origen)?;
            rutas.push(literal(origen));
        }
        let mut argumentos = vec!["add", "-A", "--"];
        argumentos.extend(rutas.iter().map(String::as_str));
        git(&raiz, &argumentos).map(|_| ())
    })
    .await
    .map_err(|error| error.to_string())?
}

// Deja el archivo como está en el último commit. Si el archivo es nuevo, lo borra.
#[tauri::command]
pub async fn revertir_cambio(
    raiz: String,
    ruta: String,
    origen: Option<String>,
    indice: String,
) -> Result<(), String> {
    spawn_blocking(move || {
        let raiz = PathBuf::from(raiz);
        let completa = ruta_segura(&raiz, &ruta)?;
        if indice == "?" {
            return fs::remove_file(&completa).map_err(|error| error.to_string());
        }
        if indice == "A" {
            return git(&raiz, &["rm", "-f", "-q", "--", &literal(&ruta)]).map(|_| ());
        }
        if let Some(origen) = &origen {
            ruta_segura(&raiz, origen)?;
            git(&raiz, &["rm", "-f", "-q", "--", &literal(&ruta)])?;
            return git(
                &raiz,
                &[
                    "restore",
                    "--source=HEAD",
                    "--staged",
                    "--worktree",
                    "--",
                    &literal(origen),
                ],
            )
            .map(|_| ());
        }
        git(
            &raiz,
            &[
                "restore",
                "--source=HEAD",
                "--staged",
                "--worktree",
                "--",
                &literal(&ruta),
            ],
        )
        .map(|_| ())
    })
    .await
    .map_err(|error| error.to_string())?
}
