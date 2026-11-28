use std::{
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use serde_json::{json, Value};
use tauri::async_runtime::spawn_blocking;

const SIN_VENTANA: u32 = 0x0800_0000;
const PREFIJO_RAMA: &str = "mahzz/";

fn git(carpeta: &Path, argumentos: &[&str]) -> Result<String, String> {
    let salida = Command::new("git")
        .args(argumentos)
        .current_dir(carpeta)
        .stdin(Stdio::null())
        .env("GIT_TERMINAL_PROMPT", "0")
        .creation_flags(SIN_VENTANA)
        .output()
        .map_err(|error| format!("no se pudo ejecutar git: {error}"))?;
    if salida.status.success() {
        Ok(String::from_utf8_lossy(&salida.stdout).trim().to_string())
    } else {
        let error = String::from_utf8_lossy(&salida.stderr).trim().to_string();
        let detalle = String::from_utf8_lossy(&salida.stdout).trim().to_string();
        Err(if error.is_empty() { detalle } else { error })
    }
}

fn ruta_windows(texto: &str) -> PathBuf {
    PathBuf::from(texto.replace('/', "\\"))
}

fn repo_principal(carpeta: &Path) -> Result<PathBuf, String> {
    let comun = git(
        carpeta,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )
    .map_err(|_| "Esta carpeta no es un repositorio de git".to_string())?;
    let comun = ruta_windows(&comun);
    Ok(comun.parent().map(Path::to_path_buf).unwrap_or(comun))
}

fn convertir_nombre(nombre: &str) -> String {
    let mut resultado = String::new();
    for caracter in nombre.trim().to_lowercase().chars() {
        let caracter = match caracter {
            'á' | 'à' | 'ä' => 'a',
            'é' | 'è' | 'ë' => 'e',
            'í' | 'ì' | 'ï' => 'i',
            'ó' | 'ò' | 'ö' => 'o',
            'ú' | 'ù' | 'ü' => 'u',
            'ñ' => 'n',
            otro => otro,
        };
        if caracter.is_ascii_alphanumeric() {
            resultado.push(caracter);
        } else if !resultado.ends_with('-') && !resultado.is_empty() {
            resultado.push('-');
        }
    }
    let recortado: String = resultado.trim_matches('-').chars().take(40).collect();
    recortado.trim_matches('-').to_string()
}

fn rama_existe(repo: &Path, rama: &str) -> bool {
    git(
        repo,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("refs/heads/{rama}"),
        ],
    )
    .is_ok()
}

#[tauri::command]
pub async fn crear_tarea(carpeta: String, nombre: String) -> Result<Value, String> {
    spawn_blocking(move || {
        let repo = repo_principal(Path::new(&carpeta))?;
        git(&repo, &["rev-parse", "--verify", "HEAD"]).map_err(|_| "El repositorio todavía no tiene commits".to_string())?;
        let base = convertir_nombre(&nombre);
        if base.is_empty() {
            return Err("Poné un nombre con letras o números".to_string());
        }
        let nombre_repo = repo.file_name().map(|valor| valor.to_string_lossy().into_owned()).unwrap_or_else(|| "repo".to_string());
        let contenedor = repo.parent().ok_or("Ruta inválida")?.join(format!("{nombre_repo}-agentes"));
        let (slug, rama, destino) = (1..)
            .map(|numero| {
                let slug = if numero == 1 { base.clone() } else { format!("{base}-{numero}") };
                let rama = format!("{PREFIJO_RAMA}{slug}");
                let destino = contenedor.join(&slug);
                (slug, rama, destino)
            })
            .find(|(_, rama, destino)| !rama_existe(&repo, rama) && !destino.exists())
            .ok_or("No hay nombre libre")?;
        let destino_texto = destino.to_string_lossy().into_owned();
        git(&repo, &["worktree", "add", "-b", &rama, &destino_texto])?;
        let base_rama = git(&repo, &["branch", "--show-current"]).unwrap_or_default();
        Ok(json!({ "nombre": slug, "rama": rama, "carpeta": destino_texto, "repo": repo, "base": base_rama }))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn listar_tareas(carpeta: String) -> Result<Value, String> {
    spawn_blocking(move || {
        let Ok(repo) = repo_principal(Path::new(&carpeta)) else {
            return Ok(json!({ "repo": null, "tareas": [] }));
        };
        let base = git(&repo, &["branch", "--show-current"]).unwrap_or_default();
        let lista = git(&repo, &["worktree", "list", "--porcelain"])?;
        let mut tareas = Vec::new();
        for bloque in lista.split("\n\n") {
            let ruta = bloque.lines().find_map(|linea| linea.strip_prefix("worktree "));
            let rama = bloque.lines().find_map(|linea| linea.strip_prefix("branch refs/heads/"));
            let (Some(ruta), Some(rama)) = (ruta, rama) else { continue };
            let Some(nombre) = rama.strip_prefix(PREFIJO_RAMA) else { continue };
            let carpeta = ruta_windows(ruta);
            let cambios = git(&carpeta, &["status", "--porcelain"])
                .map(|salida| salida.lines().filter(|linea| !linea.trim().is_empty()).count())
                .unwrap_or(0);
            let commits = if base.is_empty() {
                0
            } else {
                git(&repo, &["rev-list", "--count", &format!("{base}..{rama}")]).ok().and_then(|valor| valor.parse().ok()).unwrap_or(0)
            };
            tareas.push(json!({ "nombre": nombre, "rama": rama, "carpeta": carpeta, "cambios": cambios, "commits": commits }));
        }
        Ok(json!({ "repo": repo, "base": base, "tareas": tareas }))
    })
    .await
    .map_err(|error| error.to_string())?
}

fn datos_tarea(carpeta: &Path) -> Result<(PathBuf, String), String> {
    let repo = repo_principal(carpeta)?;
    let rama = git(carpeta, &["branch", "--show-current"])?;
    if !rama.starts_with(PREFIJO_RAMA) {
        return Err("Esa carpeta no es una tarea de MahzzTerm".to_string());
    }
    Ok((repo, rama))
}

#[tauri::command]
pub async fn unir_tarea(carpeta: String, mensaje: Option<String>) -> Result<Value, String> {
    spawn_blocking(move || {
        let carpeta = PathBuf::from(carpeta);
        let (repo, rama) = datos_tarea(&carpeta)?;
        let nombre = rama.trim_start_matches(PREFIJO_RAMA).to_string();
        if !git(&carpeta, &["status", "--porcelain"])?.is_empty() {
            git(&carpeta, &["add", "-A"])?;
            let mensaje = mensaje
                .filter(|texto| !texto.trim().is_empty())
                .unwrap_or_else(|| format!("Tarea {nombre}"));
            git(&carpeta, &["commit", "-m", &mensaje])?;
        }
        let base = git(&repo, &["branch", "--show-current"])?;
        if base.is_empty() {
            return Err("El repositorio principal no está en ninguna rama".to_string());
        }
        if let Err(error) = git(&repo, &["merge", "--no-ff", "--no-edit", &rama]) {
            let _ = git(&repo, &["merge", "--abort"]);
            return Err(format!(
                "No se pudo unir sin conflictos, así que no cambié nada. Detalle: {error}"
            ));
        }
        git(
            &repo,
            &["worktree", "remove", "--force", &carpeta.to_string_lossy()],
        )?;
        let _ = git(&repo, &["branch", "-d", &rama]);
        Ok(json!({ "unida": nombre, "en": base }))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn descartar_tarea(carpeta: String) -> Result<Value, String> {
    spawn_blocking(move || {
        let carpeta = PathBuf::from(carpeta);
        let (repo, rama) = datos_tarea(&carpeta)?;
        git(
            &repo,
            &["worktree", "remove", "--force", &carpeta.to_string_lossy()],
        )?;
        let _ = git(&repo, &["branch", "-D", &rama]);
        Ok(json!({ "descartada": rama.trim_start_matches(PREFIJO_RAMA) }))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn convierte_nombres() {
        assert_eq!(convertir_nombre("Arreglar el login!"), "arreglar-el-login");
        assert_eq!(convertir_nombre("  Añadir búsqueda  "), "anadir-busqueda");
        assert_eq!(convertir_nombre("!!!"), "");
    }
}
