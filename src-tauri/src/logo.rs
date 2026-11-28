use std::{
    env, fs,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::Command,
    thread,
    time::Duration,
};

use tauri::{async_runtime::spawn_blocking, image::Image, AppHandle, Manager};
use windows::{
    core::{Interface, HSTRING},
    Win32::{
        Storage::FileSystem::WIN32_FIND_DATAW,
        System::Com::{
            CoCreateInstance, CoInitializeEx, IPersistFile, CLSCTX_INPROC_SERVER,
            COINIT_APARTMENTTHREADED, STGM_READWRITE,
        },
        UI::Shell::{IShellLinkW, SHChangeNotify, ShellLink, SHCNE_ASSOCCHANGED, SHCNF_IDLIST},
    },
};

use crate::datos::carpeta_datos;

fn bytes_del_logo(logo: &str) -> &'static [u8] {
    match logo {
        "azul" => include_bytes!("../../public/logos/azul.png"),
        "oceano" => include_bytes!("../../public/logos/oceano.png"),
        "esmeralda" => include_bytes!("../../public/logos/esmeralda.png"),
        "hielo" => include_bytes!("../../public/logos/hielo.png"),
        "aurora" => include_bytes!("../../public/logos/aurora.png"),
        _ => include_bytes!("../icons/128x128@2x.png"),
    }
}

fn crear_ico(png: &[u8]) -> Vec<u8> {
    let mut ico = Vec::with_capacity(22 + png.len());
    ico.extend_from_slice(&[0, 0, 1, 0, 1, 0]);
    ico.extend_from_slice(&[0, 0, 0, 0]);
    ico.extend_from_slice(&1u16.to_le_bytes());
    ico.extend_from_slice(&32u16.to_le_bytes());
    ico.extend_from_slice(&(png.len() as u32).to_le_bytes());
    ico.extend_from_slice(&22u32.to_le_bytes());
    ico.extend_from_slice(png);
    ico
}

fn carpeta_anclados() -> Option<PathBuf> {
    env::var_os("APPDATA").map(|datos| {
        PathBuf::from(datos).join(r"Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar")
    })
}

fn carpetas_de_accesos(app: &AppHandle) -> Vec<PathBuf> {
    let mut carpetas: Vec<PathBuf> = carpeta_anclados().into_iter().collect();
    if let Some(datos) = env::var_os("APPDATA").map(PathBuf::from) {
        let programas = datos.join(r"Microsoft\Windows\Start Menu\Programs");
        if let Ok(entradas) = fs::read_dir(&programas) {
            carpetas.extend(entradas.flatten().map(|e| e.path()).filter(|r| r.is_dir()));
        }
        carpetas.push(programas);
    }
    if let Ok(escritorio) = app.path().desktop_dir() {
        carpetas.push(escritorio);
    }
    carpetas
}

fn mismo_archivo(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => a.as_os_str().eq_ignore_ascii_case(b.as_os_str()),
    }
}

fn actualizar_accesos(carpetas: &[PathBuf], exe: &Path, icono: &Path) -> Vec<PathBuf> {
    let mut cambiados = Vec::new();
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        for carpeta in carpetas {
            let Ok(entradas) = fs::read_dir(carpeta) else {
                continue;
            };
            for ruta in entradas.flatten().map(|entrada| entrada.path()) {
                let es_acceso = ruta
                    .extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("lnk"));
                if es_acceso && actualizar_acceso(&ruta, exe, icono).unwrap_or(false) {
                    cambiados.push(ruta);
                }
            }
        }
    }
    cambiados
}

unsafe fn actualizar_acceso(ruta: &Path, exe: &Path, icono: &Path) -> windows::core::Result<bool> {
    let acceso: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
    let archivo: IPersistFile = acceso.cast()?;
    let ruta_w = HSTRING::from(ruta.as_os_str());
    archivo.Load(&ruta_w, STGM_READWRITE)?;

    let mut destino = [0u16; 1024];
    acceso.GetPath(&mut destino, std::ptr::null_mut::<WIN32_FIND_DATAW>(), 0)?;
    let largo = destino
        .iter()
        .position(|c| *c == 0)
        .unwrap_or(destino.len());
    let destino = PathBuf::from(String::from_utf16_lossy(&destino[..largo]));
    if !mismo_archivo(&destino, exe) {
        return Ok(false);
    }

    let mut actual = [0u16; 1024];
    let mut indice = 0;
    acceso.GetIconLocation(&mut actual, &mut indice)?;
    let largo = actual.iter().position(|c| *c == 0).unwrap_or(actual.len());
    if String::from_utf16_lossy(&actual[..largo]).eq_ignore_ascii_case(&icono.to_string_lossy())
        && indice == 0
    {
        return Ok(false);
    }

    acceso.SetIconLocation(&HSTRING::from(icono.as_os_str()), 0)?;
    archivo.Save(&ruta_w, true)?;
    Ok(true)
}

fn actualizar_icono_de_accesos(app: &AppHandle, logo: &str) -> Result<bool, String> {
    let exe = env::current_exe().map_err(|error| error.to_string())?;
    let icono = if logo == "clasico" || bytes_del_logo(logo) == bytes_del_logo("clasico") {
        exe.clone()
    } else {
        let carpeta = carpeta_datos(app)?.join("logos");
        fs::create_dir_all(&carpeta).map_err(|error| error.to_string())?;
        let icono = carpeta.join(format!("{logo}.ico"));
        fs::write(&icono, crear_ico(bytes_del_logo(logo))).map_err(|error| error.to_string())?;
        icono
    };
    let cambiados = actualizar_accesos(&carpetas_de_accesos(app), &exe, &icono);
    if !cambiados.is_empty() {
        unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None) };
    }
    let anclados = carpeta_anclados();
    Ok(cambiados.iter().any(|ruta| {
        anclados
            .as_ref()
            .is_some_and(|carpeta| ruta.starts_with(carpeta))
    }))
}

#[tauri::command]
pub async fn aplicar_logo(app: AppHandle, logo: String) -> Result<bool, String> {
    for ventana in app.webview_windows().values() {
        let imagen = Image::from_bytes(bytes_del_logo(&logo)).map_err(|error| error.to_string())?;
        ventana
            .set_icon(imagen)
            .map_err(|error| error.to_string())?;
    }
    spawn_blocking(move || actualizar_icono_de_accesos(&app, &logo))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn reiniciar_explorador() -> Result<(), String> {
    const SIN_CONSOLA: u32 = 0x0800_0000;
    spawn_blocking(|| {
        Command::new("taskkill")
            .args(["/f", "/im", "explorer.exe"])
            .creation_flags(SIN_CONSOLA)
            .status()
            .map_err(|error| error.to_string())?;
        thread::sleep(Duration::from_secs(2));
        let corriendo = Command::new("tasklist")
            .args(["/fi", "IMAGENAME eq explorer.exe", "/nh"])
            .creation_flags(SIN_CONSOLA)
            .output()
            .map(|salida| String::from_utf8_lossy(&salida.stdout).contains("explorer.exe"))
            .unwrap_or(false);
        if !corriendo {
            Command::new("explorer.exe")
                .spawn()
                .map_err(|error| error.to_string())?;
        }
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn todos_los_logos_son_png_validos() {
        for logo in ["clasico", "azul", "oceano", "esmeralda", "hielo", "aurora"] {
            let imagen = Image::from_bytes(bytes_del_logo(logo)).expect(logo);
            assert_eq!((imagen.width(), imagen.height()), (256, 256), "{logo}");
        }
    }

    #[test]
    fn un_logo_desconocido_usa_el_clasico() {
        assert_eq!(bytes_del_logo("no existe"), bytes_del_logo("clasico"));
    }

    #[test]
    fn el_ico_lleva_el_png_entero_despues_de_la_cabecera() {
        let png = bytes_del_logo("aurora");
        let ico = crear_ico(png);
        assert_eq!(&ico[..6], &[0, 0, 1, 0, 1, 0]);
        assert_eq!(
            u32::from_le_bytes(ico[14..18].try_into().unwrap()) as usize,
            png.len()
        );
        assert_eq!(&ico[22..], png);
    }

    #[test]
    fn cambia_solo_los_accesos_a_mahzzterm() {
        let carpeta = env::temp_dir().join(format!("mahzz-accesos-{}", std::process::id()));
        fs::create_dir_all(&carpeta).unwrap();
        let exe = env::current_exe().unwrap();
        let otro = PathBuf::from(r"C:\Windows\notepad.exe");
        let icono = carpeta.join("aurora.ico");
        fs::write(&icono, crear_ico(bytes_del_logo("aurora"))).unwrap();

        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            for (nombre, destino) in [("MahzzTerm.lnk", &exe), ("Bloc.lnk", &otro)] {
                let acceso: IShellLinkW =
                    CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).unwrap();
                acceso.SetPath(&HSTRING::from(destino.as_os_str())).unwrap();
                let archivo: IPersistFile = acceso.cast().unwrap();
                archivo
                    .Save(&HSTRING::from(carpeta.join(nombre).as_os_str()), true)
                    .unwrap();
            }
        }

        let carpetas = [carpeta.clone()];
        assert_eq!(actualizar_accesos(&carpetas, &exe, &icono).len(), 1);
        assert!(actualizar_accesos(&carpetas, &exe, &icono).is_empty());

        let icono_de = |nombre: &str| unsafe {
            let acceso: IShellLinkW =
                CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).unwrap();
            let archivo: IPersistFile = acceso.cast().unwrap();
            archivo
                .Load(
                    &HSTRING::from(carpeta.join(nombre).as_os_str()),
                    STGM_READWRITE,
                )
                .unwrap();
            let mut ruta = [0u16; 1024];
            let mut indice = 0;
            acceso.GetIconLocation(&mut ruta, &mut indice).unwrap();
            let largo = ruta.iter().position(|c| *c == 0).unwrap_or(ruta.len());
            String::from_utf16_lossy(&ruta[..largo])
        };
        assert_eq!(icono_de("MahzzTerm.lnk"), icono.to_string_lossy());
        assert_eq!(icono_de("Bloc.lnk"), "");

        let _ = fs::remove_dir_all(&carpeta);
    }
}
