use std::mem::size_of;

use windows::Win32::{
    Foundation::CloseHandle,
    System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    },
};

pub struct Proceso {
    pid: u32,
    padre: u32,
    nombre: String,
}

// Saca una foto de todos los procesos de Windows en este momento.
pub fn listar() -> Vec<Proceso> {
    let mut procesos = Vec::new();
    unsafe {
        let Ok(foto) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return procesos;
        };
        let mut entrada = PROCESSENTRY32W {
            dwSize: size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        if Process32FirstW(foto, &mut entrada).is_ok() {
            loop {
                let largo = entrada
                    .szExeFile
                    .iter()
                    .position(|caracter| *caracter == 0)
                    .unwrap_or(entrada.szExeFile.len());
                procesos.push(Proceso {
                    pid: entrada.th32ProcessID,
                    padre: entrada.th32ParentProcessID,
                    nombre: String::from_utf16_lossy(&entrada.szExeFile[..largo]),
                });
                if Process32NextW(foto, &mut entrada).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(foto);
    }
    procesos
}

fn es_interno(nombre: &str) -> bool {
    nombre.eq_ignore_ascii_case("conhost.exe") || nombre.eq_ignore_ascii_case("openconsole.exe")
}

fn primer_hijo(pid: u32, procesos: &[Proceso]) -> Option<&Proceso> {
    procesos
        .iter()
        .find(|proceso| proceso.padre == pid && !es_interno(&proceso.nombre))
}

// Devuelve el programa que está corriendo dentro del shell, si hay alguno.
pub fn programa_de(pid_shell: u32, procesos: &[Proceso]) -> Option<String> {
    let mut actual = primer_hijo(pid_shell, procesos)?;
    // Los lanzadores .cmd abren un cmd intermedio: interesa el programa real.
    if actual.nombre.eq_ignore_ascii_case("cmd.exe") {
        if let Some(hijo) = primer_hijo(actual.pid, procesos) {
            actual = hijo;
        }
    }
    let nombre = actual.nombre.as_str();
    let sin_extension = nombre
        .strip_suffix(".exe")
        .or_else(|| nombre.strip_suffix(".EXE"))
        .unwrap_or(nombre);
    Some(sin_extension.to_string())
}
