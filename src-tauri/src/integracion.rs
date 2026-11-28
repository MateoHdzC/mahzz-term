use std::{
    env,
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde_json::{json, Value};
use tauri::{async_runtime::spawn_blocking, State};
use windows::{
    core::HSTRING,
    Win32::{
        Foundation::ERROR_SUCCESS,
        System::Registry::{
            RegCloseKey, RegDeleteKeyValueW, RegDeleteKeyW, RegDeleteTreeW, RegGetValueW,
            RegOpenKeyExW, RegQueryInfoKeyW, RegSetKeyValueW, HKEY, HKEY_CURRENT_USER, KEY_READ,
            REG_NONE, REG_SZ, RRF_RT_REG_SZ,
        },
        UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST},
    },
};

const CLASES: &str = r"Software\Classes";
const PROGID: &str = "MahzzTerm.Archivo";
const VERBO: &str = "MahzzTerm";
const VERSION: &str = "2";
static CANDADO: Mutex<()> = Mutex::new(());
const MENUS_CARPETA: [&str; 3] = [
    r"Directory\shell",
    r"Directory\Background\shell",
    r"Drive\shell",
];
const EXTENSIONES: &[&str] = &[
    "md",
    "markdown",
    "mdx",
    "txt",
    "log",
    "json",
    "jsonc",
    "yml",
    "yaml",
    "toml",
    "ini",
    "cfg",
    "conf",
    "env",
    "xml",
    "csv",
    "tsv",
    "html",
    "htm",
    "css",
    "scss",
    "sass",
    "less",
    "js",
    "mjs",
    "cjs",
    "jsx",
    "ts",
    "tsx",
    "vue",
    "svelte",
    "astro",
    "py",
    "rb",
    "php",
    "java",
    "kt",
    "cs",
    "fs",
    "vb",
    "c",
    "h",
    "cpp",
    "hpp",
    "cc",
    "rs",
    "go",
    "swift",
    "lua",
    "sh",
    "bash",
    "ps1",
    "psm1",
    "psd1",
    "bat",
    "cmd",
    "sql",
    "graphql",
    "gitignore",
    "gitattributes",
    "editorconfig",
    "svg",
];

fn clave(ruta: &str) -> HSTRING {
    HSTRING::from(format!(r"{CLASES}\{ruta}"))
}

fn escribir(ruta: &str, nombre: &str, valor: &str) -> Result<(), String> {
    let datos: Vec<u16> = valor.encode_utf16().chain(Some(0)).collect();
    let estado = unsafe {
        RegSetKeyValueW(
            HKEY_CURRENT_USER,
            &clave(ruta),
            &HSTRING::from(nombre),
            REG_SZ.0,
            Some(datos.as_ptr().cast()),
            (datos.len() * 2) as u32,
        )
    };
    if estado == ERROR_SUCCESS {
        Ok(())
    } else {
        Err(format!(
            r"No se pudo escribir HKCU\{CLASES}\{ruta}: {}",
            estado.0
        ))
    }
}

fn escribir_vacio(ruta: &str, nombre: &str) -> Result<(), String> {
    let estado = unsafe {
        RegSetKeyValueW(
            HKEY_CURRENT_USER,
            &clave(ruta),
            &HSTRING::from(nombre),
            REG_NONE.0,
            None,
            0,
        )
    };
    if estado == ERROR_SUCCESS {
        Ok(())
    } else {
        Err(format!(
            r"No se pudo escribir HKCU\{CLASES}\{ruta}: {}",
            estado.0
        ))
    }
}

fn leer(ruta: &str, nombre: &str) -> Option<String> {
    let (ruta, nombre) = (clave(ruta), HSTRING::from(nombre));
    let mut largo = 0u32;
    unsafe {
        if RegGetValueW(
            HKEY_CURRENT_USER,
            &ruta,
            &nombre,
            RRF_RT_REG_SZ,
            None,
            None,
            Some(&mut largo),
        ) != ERROR_SUCCESS
        {
            return None;
        }
        let mut bufer = vec![0u16; (largo as usize).div_ceil(2)];
        let puntero = bufer.as_mut_ptr().cast();
        if RegGetValueW(
            HKEY_CURRENT_USER,
            &ruta,
            &nombre,
            RRF_RT_REG_SZ,
            None,
            Some(puntero),
            Some(&mut largo),
        ) != ERROR_SUCCESS
        {
            return None;
        }
        let fin = bufer
            .iter()
            .position(|letra| *letra == 0)
            .unwrap_or(bufer.len());
        Some(String::from_utf16_lossy(&bufer[..fin]))
    }
}

fn borrar_clave(ruta: &str) {
    unsafe {
        let _ = RegDeleteTreeW(HKEY_CURRENT_USER, &clave(ruta));
    }
}

fn borrar_valor(ruta: &str, nombre: &str) {
    unsafe {
        let _ = RegDeleteKeyValueW(HKEY_CURRENT_USER, &clave(ruta), &HSTRING::from(nombre));
    }
}

fn borrar_si_vacia(ruta: &str) {
    let mut manija = HKEY::default();
    unsafe {
        if RegOpenKeyExW(
            HKEY_CURRENT_USER,
            &clave(ruta),
            Some(0),
            KEY_READ,
            &mut manija,
        ) != ERROR_SUCCESS
        {
            return;
        }
        let (mut subclaves, mut valores) = (0u32, 0u32);
        let estado = RegQueryInfoKeyW(
            manija,
            None,
            None,
            None,
            Some(&mut subclaves),
            None,
            None,
            Some(&mut valores),
            None,
            None,
            None,
            None,
        );
        let _ = RegCloseKey(manija);
        if estado == ERROR_SUCCESS && subclaves == 0 && valores == 0 {
            let _ = RegDeleteKeyW(HKEY_CURRENT_USER, &clave(ruta));
        }
    }
}

fn avisar_explorador() {
    unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None) };
}

fn nombre_exe(exe: &Path) -> String {
    exe.file_name()
        .map(|nombre| nombre.to_string_lossy().into_owned())
        .unwrap_or_else(|| "MahzzTerm.exe".into())
}

fn comando_carpeta(exe: &Path) -> String {
    format!("\"{}\" --carpeta \"%V\"", exe.display())
}

fn comando_archivo(exe: &Path) -> String {
    format!("\"{}\" --abrir \"%1\"", exe.display())
}

fn registrada() -> bool {
    leer(PROGID, "IntegracionVersion").is_some()
        || leer(&format!(r"{}\{VERBO}", MENUS_CARPETA[0]), "").is_some()
}

fn al_dia(exe: &Path, etiqueta: &str) -> bool {
    let menu = format!(r"{}\{VERBO}", MENUS_CARPETA[0]);
    leer(&format!(r"{menu}\command"), "").as_deref() == Some(comando_carpeta(exe).as_str())
        && leer(&menu, "").as_deref() == Some(etiqueta)
        && leer(PROGID, "IntegracionVersion").as_deref() == Some(VERSION)
}

fn registrar(exe: &Path, etiqueta: &str) -> Result<(), String> {
    let icono = format!("\"{}\",0", exe.display());
    for menu in MENUS_CARPETA {
        let base = format!(r"{menu}\{VERBO}");
        escribir(&base, "", etiqueta)?;
        escribir(&base, "Icon", &icono)?;
        escribir(&format!(r"{base}\command"), "", &comando_carpeta(exe))?;
    }

    escribir(PROGID, "", "MahzzTerm")?;
    escribir(PROGID, "IntegracionVersion", VERSION)?;
    escribir(&format!(r"{PROGID}\DefaultIcon"), "", &icono)?;
    escribir(
        &format!(r"{PROGID}\shell\open\command"),
        "",
        &comando_archivo(exe),
    )?;
    for extension in EXTENSIONES {
        escribir_vacio(&format!(r".{extension}\OpenWithProgids"), PROGID)?;
    }

    let aplicacion = format!(r"Applications\{}", nombre_exe(exe));
    escribir(&aplicacion, "FriendlyAppName", "MahzzTerm")?;
    escribir(&format!(r"{aplicacion}\DefaultIcon"), "", &icono)?;
    escribir(
        &format!(r"{aplicacion}\shell\open\command"),
        "",
        &comando_archivo(exe),
    )?;
    escribir(&format!(r"*\OpenWithList\{}", nombre_exe(exe)), "", "")?;

    avisar_explorador();
    Ok(())
}

pub fn quitar() {
    if let (Ok(exe), Some(comando)) = (
        env::current_exe(),
        leer(&format!(r"{}\{VERBO}\command", MENUS_CARPETA[0]), ""),
    ) {
        if !comando
            .to_lowercase()
            .contains(&exe.display().to_string().to_lowercase())
        {
            return;
        }
    }
    for menu in MENUS_CARPETA {
        borrar_clave(&format!(r"{menu}\{VERBO}"));
    }
    borrar_clave(PROGID);
    for extension in EXTENSIONES {
        borrar_valor(&format!(r".{extension}\OpenWithProgids"), PROGID);
        borrar_si_vacia(&format!(r".{extension}\OpenWithProgids"));
        borrar_si_vacia(&format!(".{extension}"));
    }
    let nombre = env::current_exe()
        .map(|exe| nombre_exe(&exe))
        .unwrap_or_else(|_| "MahzzTerm.exe".into());
    borrar_clave(&format!(r"Applications\{nombre}"));
    borrar_clave(&format!(r"*\OpenWithList\{nombre}"));
    borrar_si_vacia(r"*\OpenWithList");
    avisar_explorador();
}

#[tauri::command]
pub async fn integracion_windows(activar: bool, etiqueta: String) -> Result<bool, String> {
    spawn_blocking(move || {
        let _turno = CANDADO
            .lock()
            .unwrap_or_else(|envenenado| envenenado.into_inner());
        let exe = env::current_exe().map_err(|error| error.to_string())?;
        if !activar {
            let habia = registrada();
            if habia {
                quitar();
            }
            return Ok(habia);
        }
        if al_dia(&exe, &etiqueta) {
            return Ok(false);
        }
        quitar();
        registrar(&exe, &etiqueta)?;
        Ok(true)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[derive(Default)]
pub struct PedidoInicial(pub Mutex<Option<Value>>);

fn normalizar(ruta: &str) -> Option<PathBuf> {
    let mut texto = ruta.trim().trim_matches('"').to_string();
    if texto.ends_with(':') {
        texto.push('\\');
    }
    let ruta = PathBuf::from(texto);
    let ruta = if ruta.is_absolute() {
        ruta
    } else {
        env::current_dir().ok()?.join(ruta)
    };
    ruta.exists().then_some(ruta)
}

pub fn leer_pedido(argumentos: impl IntoIterator<Item = String>) -> Option<Value> {
    let mut argumentos = argumentos.into_iter().skip(1);
    while let Some(argumento) = argumentos.next() {
        let ruta = match argumento.as_str() {
            "--carpeta" | "--abrir" => argumentos.next()?,
            otro if otro.starts_with("--") => continue,
            _ => argumento,
        };
        let ruta = normalizar(&ruta)?;
        let texto = ruta.to_string_lossy().into_owned();
        return Some(if ruta.is_dir() {
            json!({ "carpeta": texto })
        } else {
            json!({ "archivo": texto })
        });
    }
    None
}

#[tauri::command]
pub fn tomar_pedido_windows(pedido: State<'_, PedidoInicial>) -> Option<Value> {
    pedido
        .0
        .lock()
        .ok()
        .and_then(|mut guardado| guardado.take())
}

#[cfg(test)]
mod pruebas {
    use super::*;

    fn pedir(argumentos: &[&str]) -> Option<Value> {
        leer_pedido(argumentos.iter().map(|texto| texto.to_string()))
    }

    #[test]
    fn entiende_carpetas_archivos_y_discos() {
        let carpeta = env::temp_dir();
        let archivo = carpeta.join("mahzzterm-prueba-pedido.md");
        std::fs::write(&archivo, "# hola").unwrap();
        let texto_carpeta = carpeta.to_string_lossy().into_owned();
        let texto_archivo = archivo.to_string_lossy().into_owned();

        assert_eq!(
            pedir(&["exe", "--carpeta", &texto_carpeta]).unwrap()["carpeta"],
            texto_carpeta.as_str()
        );
        assert_eq!(
            pedir(&["exe", "--abrir", &texto_archivo]).unwrap()["archivo"],
            texto_archivo.as_str()
        );
        assert_eq!(
            pedir(&["exe", &texto_archivo]).unwrap()["archivo"],
            texto_archivo.as_str()
        );
        assert_eq!(
            pedir(&["exe", "--carpeta", "C:\""]).unwrap()["carpeta"],
            "C:\\"
        );
        assert!(pedir(&["exe", "--carpeta", r"C:\no\existe\nada"]).is_none());
        assert!(pedir(&["exe"]).is_none());
        assert!(pedir(&["exe", "--algo"]).is_none());
        std::fs::remove_file(archivo).unwrap();
    }
}
